// ============================================================
// server-affiliazioni.js
// Modulo Routes: Affiliazioni + Stripe Subscriptions
// Saam 4.0 Italian Voice
//
// DA AGGIUNGERE IN server.js:
//   const affiliazioniRoutes = require('./server-affiliazioni');
//   app.use('/api', affiliazioniRoutes);
//
// Aggiungere PRIMA del middleware express.json():
//   app.use('/api/stripe/webhook', express.raw({type:'application/json'}), require('./server-affiliazioni').stripeWebhook);
// ============================================================

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
// Pool DB iniettato da server.js tramite module.exports (usa la connessione già attiva)
let pool;
// Inizializzazione lazy — evita crash se STRIPE_SECRET_KEY non è ancora impostata su Render
let _stripe = null;
function getStripe() {
    if (!_stripe) {
        if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY mancante nelle variabili di ambiente Render');
        _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    }
    return _stripe;
}
const stripe = new Proxy({}, { get: (_, prop) => getStripe()[prop] });

const JWT_SECRET   = process.env.JWT_SECRET || 'saam-italian-voice-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://italian-learning-platform.onrender.com';

// Packages config (mirror di server.js)
const PACKAGES = {
    basic:     { label: 'Basic',    price_eur: 9.70,  minutes_day: 30,   minutes_month: 900,   stripe_price: process.env.STRIPE_PRICE_BASIC },
    advanced:  { label: 'Advanced', price_eur: 16.70, minutes_day: 60,   minutes_month: 1800,  stripe_price: process.env.STRIPE_PRICE_ADVANCED },
    gold:      { label: 'Gold',     price_eur: 27.70, minutes_day: 120,  minutes_month: 3600,  stripe_price: process.env.STRIPE_PRICE_GOLD },
};

// ─── MIDDLEWARE AUTH ─────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token mancante' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { return res.status(401).json({ error: 'Token non valido' }); }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accesso negato' });
    next();
}

// Auth middleware per affiliati (JWT separato con role:'affiliate')
function affiliateAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token mancante' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'affiliate' && decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        req.affiliate = decoded;
        next();
    } catch { return res.status(401).json({ error: 'Token non valido' }); }
}

// ─── HELPER: genera codice referral univoco ──────────────────────────────────
async function generateReferralCode(orgName) {
    const prefix = 'SAAM';
    const slug = orgName.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4).padEnd(3, 'X');
    const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `${prefix}-${slug}${rand}`;
    // Verifica unicità
    const { rows } = await pool.query('SELECT id FROM affiliates WHERE referral_code = $1', [code]);
    if (rows.length > 0) return generateReferralCode(orgName + '1'); // retry
    return code;
}

// ─── HELPER: calcola e salva commissioni mensili ─────────────────────────────
async function calculateMonthlyCommissions(periodMonth) {
    // Calcola provvigioni per tutti gli affiliati attivi per il mese indicato (YYYY-MM)
    const { rows: affiliates } = await pool.query(
        "SELECT id, commission_rate FROM affiliates WHERE status = 'active'"
    );
    for (const affiliate of affiliates) {
        const { rows: subs } = await pool.query(
            `SELECT s.id, s.user_id, s.amount_eur FROM subscriptions s
             WHERE s.affiliate_id = $1 AND s.status = 'active'
             AND to_char(s.current_period_start, 'YYYY-MM') = $2`,
            [affiliate.id, periodMonth]
        );
        for (const sub of subs) {
            const commissionEur = (sub.amount_eur * affiliate.commission_rate / 100).toFixed(2);
            // Upsert (evita duplicati)
            await pool.query(
                `INSERT INTO affiliate_commissions
                 (affiliate_id, user_id, subscription_id, period_month, gross_amount_eur, commission_rate, commission_eur)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT DO NOTHING`,
                [affiliate.id, sub.user_id, sub.id, periodMonth, sub.amount_eur, affiliate.commission_rate, commissionEur]
            );
        }
    }
}

// ════════════════════════════════════════════════════════════
// STRIPE WEBHOOK (esportato separatamente per raw body)
// ════════════════════════════════════════════════════════════
async function stripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {

            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId       = parseInt(session.metadata?.user_id);
                const affiliateId  = session.metadata?.affiliate_id ? parseInt(session.metadata.affiliate_id) : null;
                const pkg          = session.metadata?.package;
                const customerId   = session.customer;
                const subscriptionId = session.subscription;

                if (!userId || !pkg) break;

                // Recupera dettagli subscription da Stripe
                const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
                const pkgData   = PACKAGES[pkg];

                // Salva subscription nel DB
                await pool.query(
                    `INSERT INTO subscriptions
                     (user_id, affiliate_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
                      package, status, current_period_start, current_period_end, amount_eur)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),to_timestamp($9),$10)
                     ON CONFLICT (stripe_subscription_id) DO UPDATE SET status = 'active'`,
                    [userId, affiliateId, customerId, subscriptionId, stripeSub.items.data[0].price.id,
                     pkg, 'active',
                     stripeSub.current_period_start, stripeSub.current_period_end,
                     pkgData?.price_eur || 0]
                );

                // Aggiorna utente
                await pool.query(
                    `UPDATE users SET package = $1, stripe_customer_id = $2,
                     subscription_status = 'active', affiliate_id = $3
                     WHERE id = $4`,
                    [pkg, customerId, affiliateId, userId]
                );

                console.log(`✅ Stripe checkout completato | user: ${userId} | pkg: ${pkg}`);
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                const subId   = invoice.subscription;
                if (!subId) break;

                const stripeSub = await stripe.subscriptions.retrieve(subId);
                await pool.query(
                    `UPDATE subscriptions SET status = 'active',
                     current_period_start = to_timestamp($1),
                     current_period_end   = to_timestamp($2),
                     updated_at = NOW()
                     WHERE stripe_subscription_id = $3`,
                    [stripeSub.current_period_start, stripeSub.current_period_end, subId]
                );

                // Aggiorna status utente
                const { rows } = await pool.query(
                    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]
                );
                if (rows[0]) {
                    await pool.query(
                        "UPDATE users SET subscription_status = 'active' WHERE id = $1",
                        [rows[0].user_id]
                    );
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subId   = invoice.subscription;
                if (!subId) break;

                await pool.query(
                    "UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE stripe_subscription_id = $1",
                    [subId]
                );
                const { rows } = await pool.query(
                    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [subId]
                );
                if (rows[0]) {
                    await pool.query(
                        "UPDATE users SET subscription_status = 'past_due' WHERE id = $1",
                        [rows[0].user_id]
                    );
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object;
                await pool.query(
                    "UPDATE subscriptions SET status = 'canceled', canceled_at = NOW(), updated_at = NOW() WHERE stripe_subscription_id = $1",
                    [sub.id]
                );
                const { rows } = await pool.query(
                    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1', [sub.id]
                );
                if (rows[0]) {
                    await pool.query(
                        "UPDATE users SET subscription_status = 'canceled', package = 'none' WHERE id = $1",
                        [rows[0].user_id]
                    );
                }
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object;
                await pool.query(
                    `UPDATE subscriptions SET
                     status = $1, cancel_at_period_end = $2,
                     current_period_end = to_timestamp($3), updated_at = NOW()
                     WHERE stripe_subscription_id = $4`,
                    [sub.status, sub.cancel_at_period_end, sub.current_period_end, sub.id]
                );
                break;
            }
        }
        res.json({ received: true });
    } catch (err) {
        console.error('Webhook handler error:', err);
        res.status(500).json({ error: 'Webhook processing error' });
    }
}

// ════════════════════════════════════════════════════════════
// PUBLIC: REGISTRAZIONE STUDENTE
// ════════════════════════════════════════════════════════════

// Verifica codice referral (pubblico)
router.get('/public/referral/:code', async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT id, organization_name, contact_name FROM affiliates WHERE referral_code = $1 AND status = 'active'",
            [req.params.code.toUpperCase()]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Codice non valido o centro non attivo' });
        res.json({ valid: true, affiliate: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crea checkout Stripe per nuovo abbonamento
router.post('/public/subscribe', async (req, res) => {
    const { name, email, password, package: pkg, referral_code, phone } = req.body;

    if (!name || !email || !password || !PACKAGES[pkg]) {
        return res.status(400).json({ error: 'Dati mancanti o pacchetto non valido' });
    }

    try {
        // Verifica email non già registrata
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows[0]) return res.status(409).json({ error: 'Email già registrata' });

        // Trova affiliato se codice presente
        let affiliateId = null;
        if (referral_code) {
            const { rows } = await pool.query(
                "SELECT id FROM affiliates WHERE referral_code = $1 AND status = 'active'",
                [referral_code.toUpperCase()]
            );
            if (rows[0]) affiliateId = rows[0].id;
        }

        // Hash password e crea utente (status: pending fino a pagamento)
        const passwordHash = await bcrypt.hash(password, 12);
        const { rows: newUser } = await pool.query(
            `INSERT INTO users (name, email, password, role, level, package, phone,
             affiliate_id, referral_code_used, registered_via, subscription_status)
             VALUES ($1,$2,$3,'student','A1',$4,$5,$6,$7,$8,'incomplete')
             RETURNING id`,
            [name, email, passwordHash, pkg, phone || null, affiliateId,
             referral_code?.toUpperCase() || null, affiliateId ? 'affiliate' : 'direct']
        );
        const userId = newUser[0].id;

        // Crea customer Stripe
        const customer = await stripe.customers.create({
            name, email,
            metadata: { user_id: userId.toString(), package: pkg }
        });
        await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customer.id, userId]);

        // Crea Checkout Session
        const pkgData = PACKAGES[pkg];
        const session = await stripe.checkout.sessions.create({
            customer: customer.id,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{ price: pkgData.stripe_price, quantity: 1 }],
            success_url: `${FRONTEND_URL}/registrazione-studente.html?success=1&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${FRONTEND_URL}/registrazione-studente.html?canceled=1`,
            metadata: {
                user_id:      userId.toString(),
                affiliate_id: affiliateId?.toString() || '',
                package:      pkg
            },
            subscription_data: {
                metadata: { user_id: userId.toString(), package: pkg }
            },
            locale: 'it',
            allow_promotion_codes: true,
        });

        res.json({ checkout_url: session.url, user_id: userId });
    } catch (err) {
        console.error('Subscribe error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Verifica stato pagamento post-checkout
router.get('/public/subscribe/verify/:sessionId', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        if (session.payment_status === 'paid') {
            // Recupera token per auto-login
            const userId = parseInt(session.metadata.user_id);
            const { rows } = await pool.query('SELECT id, name, email, role, level, package FROM users WHERE id = $1', [userId]);
            if (!rows[0]) return res.status(404).json({ error: 'Utente non trovato' });
            const token = jwt.sign({ userId: rows[0].id, role: rows[0].role }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: rows[0] });
        } else {
            res.json({ success: false, status: session.payment_status });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// UTENTE: GESTIONE ABBONAMENTO
// ════════════════════════════════════════════════════════════

// Stato abbonamento corrente
router.get('/user/subscription', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { rows } = await pool.query(
            `SELECT s.*, a.organization_name AS affiliate_name
             FROM subscriptions s
             LEFT JOIN affiliates a ON a.id = s.affiliate_id
             WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
            [userId]
        );
        res.json({ subscription: rows[0] || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cancella abbonamento (a fine periodo)
router.post('/user/subscription/cancel', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { rows } = await pool.query(
            "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status = 'active' LIMIT 1",
            [userId]
        );
        if (!rows[0]?.stripe_subscription_id) return res.status(404).json({ error: 'Nessun abbonamento attivo' });

        await stripe.subscriptions.update(rows[0].stripe_subscription_id, { cancel_at_period_end: true });
        await pool.query(
            'UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE stripe_subscription_id = $1',
            [rows[0].stripe_subscription_id]
        );
        res.json({ success: true, message: 'Abbonamento sospeso a fine periodo' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Riattiva abbonamento annullato
router.post('/user/subscription/reactivate', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { rows } = await pool.query(
            "SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND cancel_at_period_end = TRUE LIMIT 1",
            [userId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Nessun abbonamento da riattivare' });

        await stripe.subscriptions.update(rows[0].stripe_subscription_id, { cancel_at_period_end: false });
        await pool.query(
            'UPDATE subscriptions SET cancel_at_period_end = FALSE, updated_at = NOW() WHERE stripe_subscription_id = $1',
            [rows[0].stripe_subscription_id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Portale Stripe self-service (cambio carta, storico fatture)
router.post('/user/subscription/portal', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { rows } = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [userId]);
        if (!rows[0]?.stripe_customer_id) return res.status(404).json({ error: 'Cliente Stripe non trovato' });

        const portal = await stripe.billingPortal.sessions.create({
            customer:   rows[0].stripe_customer_id,
            return_url: `${FRONTEND_URL}/tutor-italiano.html`,
        });
        res.json({ url: portal.url });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// AFFILIATI: AUTH
// ════════════════════════════════════════════════════════════

// Form di registrazione centro (pubblico — richiesta accreditamento)
router.post('/public/affiliate/apply', async (req, res) => {
    const { organization_name, contact_name, email, phone, address, city, vat_number, notes_applicant } = req.body;
    if (!organization_name || !contact_name || !email) {
        return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    }
    try {
        const existing = await pool.query('SELECT id FROM affiliates WHERE email = $1', [email]);
        if (existing.rows[0]) return res.status(409).json({ error: 'Email già registrata' });

        const referral_code = await generateReferralCode(organization_name);
        await pool.query(
            `INSERT INTO affiliates (organization_name, contact_name, email, phone, address, city, vat_number, referral_code, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [organization_name, contact_name, email, phone, address, city, vat_number, referral_code, notes_applicant || null]
        );
        res.json({ success: true, message: 'Richiesta inviata. Sarai contattato per l\'approvazione.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Login affiliato
router.post('/affiliate/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { rows } = await pool.query(
            "SELECT * FROM affiliates WHERE email = $1 AND status = 'active'", [email]
        );
        if (!rows[0]) return res.status(401).json({ error: 'Credenziali non valide o account non attivo' });
        if (!rows[0].password_hash) return res.status(401).json({ error: 'Password non impostata. Contatta il supporto.' });

        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

        await pool.query('UPDATE affiliates SET last_login = NOW() WHERE id = $1', [rows[0].id]);
        const token = jwt.sign(
            { affiliateId: rows[0].id, role: 'affiliate', org: rows[0].organization_name },
            JWT_SECRET, { expiresIn: '7d' }
        );
        res.json({ token, affiliate: {
            id: rows[0].id, organization_name: rows[0].organization_name,
            contact_name: rows[0].contact_name, referral_code: rows[0].referral_code,
            commission_rate: rows[0].commission_rate
        }});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// AFFILIATI: DASHBOARD
// ════════════════════════════════════════════════════════════

// Dashboard overview
router.get('/affiliate/dashboard', affiliateAuth, async (req, res) => {
    const affId = req.affiliate.affiliateId;
    try {
        const [aff, students, commissions, trials] = await Promise.all([
            pool.query('SELECT * FROM affiliates WHERE id = $1', [affId]),
            pool.query(`
                SELECT u.id, u.name, u.email, u.package, u.subscription_status, u.created_at,
                       s.amount_eur, s.current_period_end, s.cancel_at_period_end
                FROM users u
                LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
                WHERE u.affiliate_id = $1
                ORDER BY u.created_at DESC`, [affId]),
            pool.query(`
                SELECT period_month,
                       SUM(gross_amount_eur) AS gross,
                       SUM(commission_eur)   AS commission,
                       status
                FROM affiliate_commissions WHERE affiliate_id = $1
                GROUP BY period_month, status
                ORDER BY period_month DESC LIMIT 12`, [affId]),
            pool.query(`
                SELECT * FROM trial_accounts WHERE affiliate_id = $1
                ORDER BY issued_at DESC LIMIT 20`, [affId]),
        ]);

        const affiliate = aff.rows[0];
        const activeStudents = students.rows.filter(s => s.subscription_status === 'active');
        const mrr = activeStudents.reduce((sum, s) => sum + parseFloat(s.amount_eur || 0), 0);
        const pendingCommission = commissions.rows
            .filter(c => c.status === 'pending')
            .reduce((sum, c) => sum + parseFloat(c.commission), 0);

        res.json({
            affiliate: {
                id: affiliate.id, organization_name: affiliate.organization_name,
                referral_code: affiliate.referral_code, commission_rate: affiliate.commission_rate,
                status: affiliate.status
            },
            stats: {
                total_students: students.rows.length,
                active_subscriptions: activeStudents.length,
                mrr_eur: mrr.toFixed(2),
                my_commission_mrr: (mrr * affiliate.commission_rate / 100).toFixed(2),
                pending_commission_eur: pendingCommission.toFixed(2),
            },
            students: students.rows,
            commissions: commissions.rows,
            trials: trials.rows,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Attiva trial settimanale (max 1 a settimana)
router.post('/affiliate/trial', affiliateAuth, async (req, res) => {
    const affId = req.affiliate.affiliateId;
    const { client_name, client_email } = req.body;

    if (!client_name || !client_email) return res.status(400).json({ error: 'Nome e email cliente richiesti' });

    try {
        // Controlla limite: max 1 trial per settimana
        const { rows: weekTrials } = await pool.query(
            `SELECT id FROM trial_accounts
             WHERE affiliate_id = $1 AND issued_at >= NOW() - INTERVAL '7 days'`,
            [affId]
        );
        if (weekTrials.length >= 1) {
            return res.status(429).json({ error: 'Hai già attivato un account prova questa settimana. Potrai attivarne un altro tra 7 giorni.' });
        }

        // Verifica email non già usata
        const existUser = await pool.query('SELECT id FROM users WHERE email = $1', [client_email]);
        if (existUser.rows[0]) return res.status(409).json({ error: 'Email già registrata nel sistema' });

        // Crea utente trial
        const tempPassword = crypto.randomBytes(6).toString('hex');
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const { rows: newUser } = await pool.query(
            `INSERT INTO users (name, email, password, role, level, package, affiliate_id, registered_via, subscription_status)
             VALUES ($1,$2,$3,'student','A1','basic',$4,'trial','trialing') RETURNING id`,
            [client_name, client_email, passwordHash, affId]
        );
        const userId = newUser[0].id;

        // Aggiungi utilizzo giornaliero limitato a 30 min
        await pool.query(
            'INSERT INTO trial_accounts (affiliate_id, user_id, client_name, client_email, expires_at, minutes_limit) VALUES ($1,$2,$3,$4,$5,30)',
            [affId, userId, client_name, client_email, expiresAt]
        );

        res.json({
            success: true,
            trial: { client_name, client_email, temp_password: tempPassword, expires_at: expiresAt },
            message: `Account prova creato. Credenziali temporanee: ${client_email} / ${tempPassword}`
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Proiezione economica mese corrente
router.get('/affiliate/projection', affiliateAuth, async (req, res) => {
    const affId = req.affiliate.affiliateId;
    try {
        const { rows: aff } = await pool.query('SELECT commission_rate FROM affiliates WHERE id = $1', [affId]);
        const rate = aff[0]?.commission_rate || 0;

        const { rows: subs } = await pool.query(
            `SELECT s.package, s.amount_eur, u.name, u.email
             FROM subscriptions s JOIN users u ON u.id = s.user_id
             WHERE s.affiliate_id = $1 AND s.status = 'active'`, [affId]
        );

        const grossMrr  = subs.reduce((s, r) => s + parseFloat(r.amount_eur || 0), 0);
        const myShare   = grossMrr * rate / 100;

        // Breakdown per pacchetto
        const breakdown = {};
        subs.forEach(s => {
            if (!breakdown[s.package]) breakdown[s.package] = { count: 0, gross: 0, commission: 0 };
            breakdown[s.package].count++;
            breakdown[s.package].gross     += parseFloat(s.amount_eur);
            breakdown[s.package].commission += parseFloat(s.amount_eur) * rate / 100;
        });

        res.json({
            commission_rate: rate,
            active_subscriptions: subs.length,
            gross_mrr_eur: grossMrr.toFixed(2),
            my_share_eur:  myShare.toFixed(2),
            breakdown,
            expected_payment_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5).toISOString().split('T')[0],
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// SUPER-ADMIN: GESTIONE AFFILIAZIONI
// ════════════════════════════════════════════════════════════

// Lista tutti gli affiliati
router.get('/admin/affiliates', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT a.*,
                   COUNT(DISTINCT u.id)                                        AS total_students,
                   COUNT(DISTINCT CASE WHEN s.status='active' THEN s.id END)   AS active_subs,
                   COALESCE(SUM(CASE WHEN s.status='active' THEN s.amount_eur END),0) AS mrr,
                   COALESCE(SUM(CASE WHEN ac.status='pending' THEN ac.commission_eur END),0) AS pending_commission
            FROM affiliates a
            LEFT JOIN users u ON u.affiliate_id = a.id
            LEFT JOIN subscriptions s ON s.affiliate_id = a.id
            LEFT JOIN affiliate_commissions ac ON ac.affiliate_id = a.id
            GROUP BY a.id ORDER BY a.requested_at DESC`
        );
        res.json({ affiliates: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approvazione affiliato + impostazione password + commissione
router.put('/admin/affiliates/:id/approve', authMiddleware, adminOnly, async (req, res) => {
    const { commission_rate, password } = req.body;
    const affId = parseInt(req.params.id);
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            `UPDATE affiliates SET status='active', commission_rate=$1, password_hash=$2,
             approved_at=NOW(), approved_by=$3 WHERE id=$4`,
            [commission_rate || 20, passwordHash, req.user.userId || req.user.id, affId]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aggiorna commissione affiliato
router.put('/admin/affiliates/:id/commission', authMiddleware, adminOnly, async (req, res) => {
    const { commission_rate } = req.body;
    try {
        await pool.query('UPDATE affiliates SET commission_rate=$1 WHERE id=$2', [commission_rate, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sospendi / riattiva affiliato
router.put('/admin/affiliates/:id/status', authMiddleware, adminOnly, async (req, res) => {
    const { status } = req.body; // active | suspended | rejected
    try {
        await pool.query('UPDATE affiliates SET status=$1 WHERE id=$2', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Riepilogo globale super-admin
router.get('/admin/affiliates/summary', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [totals, byMonth, topAffiliates] = await Promise.all([
            pool.query(`
                SELECT
                  (SELECT COUNT(*) FROM affiliates WHERE status='active')                              AS active_affiliates,
                  (SELECT COUNT(*) FROM users WHERE affiliate_id IS NOT NULL)                          AS total_students,
                  (SELECT COUNT(*) FROM subscriptions WHERE status='active' AND affiliate_id IS NOT NULL) AS active_subs,
                  (SELECT COALESCE(SUM(amount_eur),0) FROM subscriptions WHERE status='active' AND affiliate_id IS NOT NULL) AS total_mrr,
                  (SELECT COALESCE(SUM(commission_eur),0) FROM affiliate_commissions WHERE status='pending') AS total_pending_commissions`),
            pool.query(`
                SELECT to_char(s.created_at,'YYYY-MM') AS month,
                       COUNT(s.id) AS new_subs, SUM(s.amount_eur) AS gross
                FROM subscriptions s WHERE s.affiliate_id IS NOT NULL
                GROUP BY 1 ORDER BY 1 DESC LIMIT 12`),
            pool.query(`
                SELECT a.organization_name, a.referral_code, a.commission_rate,
                       COUNT(DISTINCT s.id) FILTER (WHERE s.status='active') AS active_subs,
                       COALESCE(SUM(s.amount_eur) FILTER (WHERE s.status='active'),0) AS mrr
                FROM affiliates a
                LEFT JOIN subscriptions s ON s.affiliate_id = a.id
                WHERE a.status='active'
                GROUP BY a.id ORDER BY mrr DESC LIMIT 10`)
        ]);
        res.json({ totals: totals.rows[0], by_month: byMonth.rows, top_affiliates: topAffiliates.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lista provvigioni da pagare (per il pagamento mensile)
router.get('/admin/commissions/pending', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT ac.*, a.organization_name, a.payout_method, a.payout_iban, a.email AS affiliate_email
            FROM affiliate_commissions ac
            JOIN affiliates a ON a.id = ac.affiliate_id
            WHERE ac.status = 'pending'
            ORDER BY ac.period_month DESC, ac.commission_eur DESC`
        );
        res.json({ commissions: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Marca provvigioni come pagate
router.put('/admin/commissions/mark-paid', authMiddleware, adminOnly, async (req, res) => {
    const { commission_ids, payment_ref } = req.body;
    if (!commission_ids?.length) return res.status(400).json({ error: 'Nessuna provvigione selezionata' });
    try {
        await pool.query(
            `UPDATE affiliate_commissions SET status='paid', paid_at=NOW(), payment_ref=$1
             WHERE id = ANY($2::int[])`,
            [payment_ref || 'MANUAL', commission_ids]
        );
        res.json({ success: true, updated: commission_ids.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Calcola e genera provvigioni per un mese
router.post('/admin/commissions/calculate', authMiddleware, adminOnly, async (req, res) => {
    const { period_month } = req.body; // YYYY-MM
    if (!period_month) return res.status(400).json({ error: 'period_month richiesto (YYYY-MM)' });
    try {
        await calculateMonthlyCommissions(period_month);
        const { rows } = await pool.query(
            'SELECT COUNT(*) AS cnt, SUM(commission_eur) AS total FROM affiliate_commissions WHERE period_month=$1',
            [period_month]
        );
        res.json({ success: true, records: rows[0].cnt, total_eur: rows[0].total });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Funzione di inizializzazione — chiamata da server.js con il pool attivo
function init(dbPool) {
    pool = dbPool;
    return router;
}

module.exports = init;
module.exports.stripeWebhook = stripeWebhook;
module.exports.init = init;
