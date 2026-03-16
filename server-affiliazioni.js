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
// ── EMAIL SERVICE — Brevo HTTP API ───────────────────────────────────────────
const _NOTIFY_TO = process.env.NOTIFY_EMAIL || 'training@angelopagliara.it';
const _BREVO_FROM = { name: 'SAAM 4.0 Academy', email: process.env.BREVO_SENDER || 'training@angelopagliara.it' };

function _brevoHdr(titolo, sub) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
        + 'body{font-family:Arial,sans-serif;background:#f4f7f4;margin:0}'
        + '.w{max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}'
        + '.t{background:#009246;padding:22px 32px;color:#fff}.t h1{margin:0;font-size:20px}.t p{margin:5px 0 0;font-size:12px;opacity:.85}'
        + '.b{padding:26px 32px}.r{display:flex;border-bottom:1px solid #eee;padding:9px 0}.r:last-child{border-bottom:none}'
        + '.l{width:160px;font-size:12px;font-weight:700;color:#555;flex-shrink:0}.v{font-size:12px;color:#222}'
        + '.f{background:#f0f7f2;padding:14px 32px;font-size:11px;color:#888;text-align:center}'
        + '</style></head><body><div class="w">'
        + '<div class="t"><h1>' + titolo + '</h1><p>' + sub + '</p></div><div class="b">';
}
function _brevoFtr() {
    return '</div><div class="f">SAAM 4.0 Academy School &mdash; training@angelopagliara.it</div></div></body></html>';
}
function _brevoRow(l, v) { return v ? '<div class="r"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>' : ''; }

async function _brevoSendAff(to, subject, html) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error('BREVO_API_KEY non impostata su Render');
    const https = require('https');
    const body = JSON.stringify({
        sender: _BREVO_FROM,
        to: [{ email: to }],
        subject, htmlContent: html
    });
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
            headers: { 'accept':'application/json', 'api-key':apiKey,
                       'content-type':'application/json', 'content-length':Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data||'{}'));
                else reject(new Error('Brevo ' + res.statusCode + ': ' + data));
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Brevo API timeout')); });
        req.write(body); req.end();
    });
}

const emailService = {
    async notifyNewStudent(data) {
        if (!process.env.BREVO_API_KEY) return;
        const { name, email, phone, package: pkg, referral_code } = data;
        const pkgLabel = {basic:'Basic (€ 9,70/mese)',advanced:'Advanced (€ 16,70/mese)',gold:'Gold (€ 27,70/mese)'}[pkg]||pkg;
        const html = _brevoHdr('🎓 Nuovo Studente Iscritto', 'Iscrizione completata il ' + new Date().toLocaleString('it-IT'))
            + _brevoRow('Nome', name) + _brevoRow('Email', email) + _brevoRow('Telefono', phone||'—')
            + _brevoRow('Piano', pkgLabel) + _brevoRow('Codice affiliato', referral_code||'—')
            + '<div style="margin-top:14px"><span style="background:#009246;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">STUDENTE ATTIVO</span></div>'
            + _brevoFtr();
        await _brevoSendAff(_NOTIFY_TO, '🎓 Nuovo Studente — ' + name + ' (' + pkgLabel + ')', html);
        console.log('[EMAIL] Notifica nuovo studente:', email);
    },
    async notifyNewAffiliate(data) {
        if (!process.env.BREVO_API_KEY) return;
        const { organization_name, contact_name, email, phone, city, vat_number, pec, piano_adesione } = data;
        const feUrl = process.env.FRONTEND_URL || 'https://italian-learning-platform.onrender.com';
        const html = _brevoHdr('🏢 Nuova Richiesta di Affiliazione', 'Richiesta ricevuta il ' + new Date().toLocaleString('it-IT'))
            + _brevoRow('Organizzazione', organization_name) + _brevoRow('Referente', contact_name)
            + _brevoRow('Email', email) + _brevoRow('Telefono', phone) + _brevoRow('Città', city)
            + _brevoRow('P.IVA', vat_number) + _brevoRow('PEC', pec) + _brevoRow('Piano', piano_adesione)
            + '<div style="margin-top:14px"><span style="background:#C8900A;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">IN ATTESA APPROVAZIONE</span></div>'
            + '<p style="margin-top:14px;font-size:13px"><a href="' + feUrl + '/admin-affiliazioni.html" style="color:#009246;font-weight:700">Apri Dashboard Admin →</a></p>'
            + _brevoFtr();
        await _brevoSendAff(_NOTIFY_TO, '🏢 Nuova Affiliazione — ' + organization_name + ' (' + (piano_adesione||'n.d.') + ')', html);
        console.log('[EMAIL] Notifica nuova affiliazione:', email);
    },
    async sendPasswordResetAffiliate(pool, email) {
        if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non impostata su Render');
        const { rows } = await pool.query('SELECT id, contact_name FROM affiliates WHERE email=$1', [email]);
        if (!rows[0]) return;
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60*60*1000);
        await pool.query('INSERT INTO affiliate_password_resets (affiliate_id,token,expires_at,used) VALUES ($1,$2,$3,false) ON CONFLICT DO NOTHING',
            [rows[0].id, token, expires]);
        const link = (process.env.FRONTEND_URL||'https://italian-learning-platform.onrender.com') + '/reset-password.html?type=affiliate&token=' + token;
        const html = _brevoHdr('🔑 Reset Password — Centro Affiliato', 'Hai richiesto il ripristino della tua password')
            + '<p style="font-size:14px;color:#333">Ciao <strong>' + rows[0].contact_name + '</strong>,<br><br>Clicca il pulsante per impostare una nuova password. Valido <strong>1 ora</strong>.</p>'
            + '<a href="' + link + '" style="display:inline-block;margin:18px 0;background:#009246;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Reimposta la Password</a>'
            + '<p style="font-size:12px;color:#999">Se non hai richiesto il reset, ignora questa email.</p>'
            + _brevoFtr();
        await _brevoSendAff(email, '🔑 Reimposta la tua password — SAAM 4.0', html);
    },
    async sendPasswordResetStudent(pool, email) {
        if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non impostata su Render');
        const { rows } = await pool.query('SELECT id, name FROM users WHERE email=$1', [email]);
        if (!rows[0]) return;
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60*60*1000);
        await pool.query('INSERT INTO password_resets (user_id,token,expires_at,used,type) VALUES ($1,$2,$3,false,$4)',
            [rows[0].id, token, expires, 'student']);
        const link = (process.env.FRONTEND_URL||'https://italian-learning-platform.onrender.com') + '/reset-password.html?type=student&token=' + token;
        const html = _brevoHdr('🔑 Reset Password — Studente', 'Hai richiesto il ripristino della tua password')
            + '<p style="font-size:14px;color:#333">Ciao <strong>' + rows[0].name + '</strong>,<br><br>Clicca il pulsante per impostare una nuova password. Valido <strong>1 ora</strong>.</p>'
            + '<a href="' + link + '" style="display:inline-block;margin:18px 0;background:#009246;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Reimposta la Password</a>'
            + '<p style="font-size:12px;color:#999">Se non hai richiesto il reset, ignora questa email.</p>'
            + _brevoFtr();
        await _brevoSendAff(email, '🔑 Reimposta la tua password — SAAM 4.0', html);
    },
    async sendPasswordResetAdmin(pool, email) {
        if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non impostata su Render');
        const { rows } = await pool.query("SELECT id, name FROM users WHERE email=$1 AND role='admin'", [email]);
        if (!rows[0]) return;
        const token = require('crypto').randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60*60*1000);
        await pool.query('INSERT INTO password_resets (user_id,token,expires_at,used,type) VALUES ($1,$2,$3,false,$4)',
            [rows[0].id, token, expires, 'admin']);
        const link = (process.env.FRONTEND_URL||'https://italian-learning-platform.onrender.com') + '/reset-password.html?type=admin&token=' + token;
        const html = _brevoHdr('🔐 Reset Password — Amministratore', 'Accesso amministrativo')
            + '<p style="font-size:14px;color:#333">Ciao <strong>' + rows[0].name + '</strong>,<br><br>Clicca il pulsante per reimpostare la password admin. Valido <strong>1 ora</strong>.</p>'
            + '<a href="' + link + '" style="display:inline-block;margin:18px 0;background:#1A3A5C;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Reimposta la Password Admin</a>'
            + '<p style="font-size:12px;color:#999">Se non hai richiesto il reset, contatta training@angelopagliara.it.</p>'
            + _brevoFtr();
        await _brevoSendAff(email, '🔐 Reset Password ADMIN — SAAM 4.0', html);
    },
};
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

                // Aggiorna utente con pacchetto e minuti corretti
                const pkgLimits = PACKAGES[pkg];
                await pool.query(
                    `UPDATE users SET package = $1, stripe_customer_id = $2,
                     subscription_status = 'active', affiliate_id = $3,
                     minutes_limit = $5
                     WHERE id = $4`,
                    [pkg, customerId, affiliateId, userId, pkgLimits?.minutes_day || 30]
                );

                // Notifica email admin — nuovo studente pagante
                try {
                    const userRow = await pool.query('SELECT name, email, phone FROM users WHERE id = $1', [userId]);
                    if (userRow.rows[0]) {
                        try {
                            await emailService.notifyNewStudent({
                                name: userRow.rows[0].name,
                                email: userRow.rows[0].email,
                                phone: userRow.rows[0].phone,
                                package: pkg,
                                referral_code: session.metadata?.affiliate_id ? `ID affiliato: ${affiliateId}` : null
                            });
                            console.log('[EMAIL] Notifica studente inviata OK a', process.env.NOTIFY_EMAIL);
                        } catch(e) {
                            console.error('[EMAIL] notifyNewStudent ERRORE:', e.message);
                        }
                    }
                } catch(e) { console.error('[EMAIL] lookup utente:', e.message); }

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
    const { organization_name, contact_name, email, phone, address, city, vat_number, pec, codice_sdi, notes_applicant, piano_adesione, commission_requested } = req.body;
    if (!organization_name || !contact_name || !email) {
        return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    }
    try {
        const existing = await pool.query('SELECT id FROM affiliates WHERE email = $1', [email]);
        if (existing.rows[0]) return res.status(409).json({ error: 'Email già registrata' });

        const referral_code = await generateReferralCode(organization_name);
        // Componi notes con piano scelto in evidenza
        const noteParts = [];
        if (piano_adesione) noteParts.push(`📋 PIANO SCELTO: ${piano_adesione}`);
        if (notes_applicant) noteParts.push(notes_applicant);
        const finalNotes = noteParts.join(' | ') || null;

        await pool.query(
            `INSERT INTO affiliates (organization_name, contact_name, email, phone, address, city, vat_number, pec, codice_sdi, referral_code, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [organization_name, contact_name, email, phone, address, city, vat_number, pec || null, codice_sdi || null, referral_code, finalNotes]
        );
        // Notifica email admin
        try {
            await emailService.notifyNewAffiliate({
                organization_name, contact_name, email, phone, city, piano_adesione,
                vat_number, pec
            });
            console.log('[EMAIL] Notifica affiliazione inviata OK a', process.env.NOTIFY_EMAIL);
        } catch(e) {
            console.error('[EMAIL] notifyNewAffiliate ERRORE:', e.message);
        }

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
                       s.amount_eur, s.current_period_end, s.cancel_at_period_end,
                       COALESCE(SUM(CASE WHEN us.date >= date_trunc('month', NOW()) THEN us.minutes_used ELSE 0 END), 0) AS monthly_minutes_used
                FROM users u
                LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
                LEFT JOIN usage us ON us.user_id = u.id
                WHERE u.affiliate_id = $1
                GROUP BY u.id, s.amount_eur, s.current_period_end, s.cancel_at_period_end
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
                status: affiliate.status,
                contract_start: affiliate.contract_start,
                contract_end:   affiliate.contract_end,
                notes:          affiliate.notes
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
                   (SELECT COUNT(*) FROM users WHERE affiliate_id = a.id) AS total_students,
                   (SELECT COUNT(*) FROM subscriptions WHERE affiliate_id = a.id AND status='active') AS active_subs,
                   (SELECT COALESCE(SUM(amount_eur),0) FROM subscriptions WHERE affiliate_id = a.id AND status='active') AS mrr,
                   (SELECT COALESCE(SUM(commission_eur),0) FROM affiliate_commissions WHERE affiliate_id = a.id AND status='pending') AS pending_commission
            FROM affiliates a
            ORDER BY a.requested_at DESC`
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
             approved_at=NOW(), approved_by=$3,
             contract_start=NOW(), contract_end=NOW() + INTERVAL '1 year'
             WHERE id=$4`,
            [commission_rate || 20, passwordHash, req.user.userId || req.user.id, affId]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// GENERAZIONE PDF CONTRATTO AFFILIAZIONE — inline, nessun file esterno
// ═══════════════════════════════════════════════════════════════════

// ── Helper functions — definite PRIMA di _buildContractPDF ──

function pdfHBox(doc,text,ML,CW,VERDE) {
    var y=doc.y+4;
    doc.rect(ML,y,CW,25).fill('#F0F7F2');
    doc.rect(ML,y,4,25).fill(VERDE);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(VERDE).text(text,ML+12,y+6,{width:CW-20});
    doc.y=y+31;
}
function pdfH2(doc,text,ML,VERDE) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE).text(text,ML,doc.y+5);
    doc.moveDown(0.2);
}
function pdfArt(doc,num,title,ML,CW,VERDE,NERO) {
    var y=doc.y+4;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(VERDE)
       .text('Art. '+num+' \u2014 ',ML,y,{continued:true});
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NERO).text(title);
    doc.moveTo(ML,doc.y+1).lineTo(ML+CW,doc.y+1).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
    doc.moveDown(0.15);
}
function pdfBody(doc,text,ML,CW) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#3A3A3A')
       .text(text,ML,doc.y+3,{width:CW});
    doc.moveDown(0.3);
}
function pdfRows(doc,data,ML,CW) {
    var rowH=19, col1=128, y=doc.y+3;
    data.forEach(function(r,i){
        doc.rect(ML,y,CW,rowH).fillAndStroke(i%2===0?'#F7FAF7':'#FFFFFF','#E0E8E0');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#444').text(r[0],ML+5,y+6,{width:col1-8});
        doc.font('Helvetica').fontSize(7.5).fillColor('#1A1A1A').text(r[1],ML+col1+4,y+6,{width:CW-col1-10,ellipsis:true});
        y+=rowH;
    });
    doc.y=y+3;
}
function pdfPlanTbl(doc,ML,CW,cr,VERDE,BIANCO) {
    var y=doc.y+4, cols=[70,115,140,150];
    var hdrs=['Piano','Canone Mensile','Commissione ('+cr+'%)','Incasso Netto Centro'];
    var data=[
        ['Basic',   '\u20ac 9,70', '\u20ac '+(9.70 *cr/100).toFixed(2),'\u20ac '+(9.70 *cr/100).toFixed(2)+'/mese'],
        ['Advanced','\u20ac 16,70','\u20ac '+(16.70*cr/100).toFixed(2),'\u20ac '+(16.70*cr/100).toFixed(2)+'/mese'],
        ['Gold',    '\u20ac 27,70','\u20ac '+(27.70*cr/100).toFixed(2),'\u20ac '+(27.70*cr/100).toFixed(2)+'/mese'],
    ];
    var x=ML;
    cols.forEach(function(w,i){
        doc.rect(x,y,w,16).fillAndStroke('#007A38','#006030');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BIANCO).text(hdrs[i],x+3,y+5,{width:w-6,align:'center'});
        x+=w;
    });
    data.forEach(function(row,ri){
        x=ML;
        var ry=y+16+ri*15;
        row.forEach(function(cell,ci){
            doc.rect(x,ry,cols[ci],15).fillAndStroke(ri%2===0?'#F5F9F5':BIANCO,'#CCDDCC');
            doc.font(ci>=2?'Helvetica-Bold':'Helvetica').fontSize(7.5).fillColor(ci>=2?VERDE:'#222')
               .text(cell,x+3,ry+4,{width:cols[ci]-6,align:'center'});
            x+=cols[ci];
        });
    });
    doc.y=y+16+data.length*15+6;
}
function pdfSigBox(doc,x,y,w,role,org,ref,VERDE,GR2) {
    doc.roundedRect(x,y,w,122,6).fillAndStroke('#F5F9F5',VERDE);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(VERDE).text(role,x,y+10,{align:'center',width:w});
    doc.font('Helvetica').fontSize(8.5).fillColor('#4A4A4A').text(org,x,y+24,{align:'center',width:w});
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GR2).text(ref,x,y+37,{align:'center',width:w});
    doc.moveTo(x+16,y+82).lineTo(x+w-16,y+82).lineWidth(0.8).strokeColor(VERDE).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(VERDE)
       .text('\u2611 Preferibilmente Firma Digitale (D.Lgs. 82/2005)',x,y+87,{align:'center',width:w});
    doc.font('Helvetica-Oblique').fontSize(7).fillColor(GR2)
       .text('oppure Firma Autografa e Timbro',x,y+99,{align:'center',width:w});
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#BBBBBB')
       .text('(Codice del Consumo Digitale)',x,y+110,{align:'center',width:w});
}
function pdfSig2Box(doc,x,y,w,label,VERDE,GR2) {
    doc.roundedRect(x,y,w,58,4).fillAndStroke('#FAFAFA','#DDDDDD');
    doc.moveTo(x+16,y+36).lineTo(x+w-16,y+36).lineWidth(0.6).strokeColor('#AAAAAA').stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(VERDE)
       .text('\u2611 Preferibilmente Firma Digitale',x,y+40,{align:'center',width:w});
    doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(GR2).text(label,x,y+50,{align:'center',width:w});
}

function _buildContractPDF(affiliate) {
    return new Promise(function(resolve, reject) {
        var PDFDocument;
        try { PDFDocument = require('pdfkit'); }
        catch(e) { return reject(new Error('pdfkit non installato: ' + e.message)); }
        var path = require('path');
        var fs   = require('fs');

        var VERDE='#009246', ROSSO='#CE2B37', NERO='#1A1A1A', GRIGIO='#4A4A4A';
        var GR2='#7A7A7A', BIANCO='#FFFFFF', ORO='#C8900A';

        var CONC = {
            rag:'SAAM 4.0 Academy School', pm:'Angelo Pagliara',
            sede:'Via Dott. Cosimo Argentieri, 24 \u2014 72022 Latiano (BR) \u2014 Italia',
            piva:'02490040744', email:'training@angelopagliara.it',
            pec:'angelopagliara@mypec.eu', siti:'www.angelopagliara.it \u2014 www.saam40.net'
        };

        function fmtDate(d){ return d.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}); }
        var TODAY = fmtDate(new Date());
        var YEAR1 = fmtDate(new Date(Date.now()+365*24*60*60*1000));
        var CNUM  = String(affiliate.id||0).padStart(3,'0')+' / '+new Date().getFullYear();
        var prem  = !!(affiliate.notes && affiliate.notes.toLowerCase().includes('premium'));
        var cr    = affiliate.commission_rate || (prem?30:20);
        var quota = prem ? '\u20ac 197,00' : '\u20ac 97,00';
        var subt  = 'Contratto N. '+CNUM+' \u2014 '+(affiliate.organization_name||'Centro');

        var doc = new PDFDocument({
            size:'A4',
            margins:{top:62, bottom:50, left:60, right:60},
            bufferPages: true,
            info:{Title:'Contratto Affiliazione', Author:'SAAM 4.0 Academy School'}
        });

        var chunks=[];
        doc.on('data', function(c){ chunks.push(c); });
        doc.on('end',  function(){ resolve(Buffer.concat(chunks)); });
        doc.on('error', reject);

        var W=595.28, H=841.89, ML=60, CW=475.28;

        // ══ COPERTINA ══
        var logoPath = path.join(__dirname,'logo_contratto.jpg');
        if (!fs.existsSync(logoPath)) logoPath = path.join(__dirname,'logo_contratto.png');
        var logoBotY = 14;
        if (fs.existsSync(logoPath)) {
            var lh = Math.round(CW * 436 / 800);
            doc.image(logoPath, ML, 14, {width:CW, height:lh});
            logoBotY = 14 + lh + 8;
        } else {
            doc.rect(0,0,W,7).fill(VERDE).rect(0,7,W,4).fill(ROSSO);
            doc.font('Helvetica-Bold').fontSize(20).fillColor(VERDE)
               .text('SAAM 4.0 ACADEMY SCHOOL',ML,24,{align:'center',width:CW});
            logoBotY = 54;
        }

        var lw=CW/3;
        doc.rect(ML,      logoBotY,lw,3).fill(VERDE)
           .rect(ML+lw,   logoBotY,lw,3).fill('#EEEEEE')
           .rect(ML+lw*2, logoBotY,lw,3).fill(ROSSO);
        logoBotY += 12;

        doc.font('Helvetica').fontSize(9).fillColor(GR2)
           .text('Piattaforma AI di Apprendimento della Lingua Italiana',ML,logoBotY,{align:'center',width:CW});
        doc.font('Helvetica-Bold').fontSize(24).fillColor(NERO)
           .text('CONTRATTO DI AFFILIAZIONE',ML,logoBotY+16,{align:'center',width:CW});
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO)
           .text('Accordo di Partnership \u2014 Programma Centri Accreditati',ML,logoBotY+44,{align:'center',width:CW});

        var BY = logoBotY + 62;
        doc.roundedRect(ML,BY,CW,128,8).fillAndStroke('#F0F7F2',VERDE);
        var iX=ML+18;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2).text('N. CONTRATTO',iX,BY+14);
        doc.font('Helvetica-Bold').fontSize(14).fillColor(NERO).text(CNUM,iX,BY+25);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2).text('DATA STIPULA',iX,BY+52);
        doc.font('Helvetica').fontSize(11).fillColor(NERO).text(TODAY,iX,BY+63);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GR2).text('DURATA',iX,BY+90);
        doc.font('Helvetica').fontSize(9).fillColor(NERO)
           .text('12 mesi \u2014 dal '+TODAY+' al '+YEAR1,iX,BY+101);

        var bc=prem?VERDE:ORO, bf=prem?'#D1F0DC':'#FFF3CD';
        var BDX=ML+CW-158, BDY=BY+14;
        doc.roundedRect(BDX,BDY,140,100,7).fillAndStroke(bf,bc);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GR2).text('PIANO SCELTO',BDX,BDY+10,{align:'center',width:140});
        doc.font('Helvetica-Bold').fontSize(18).fillColor(bc).text(prem?'PREMIUM':'STANDARD',BDX,BDY+24,{align:'center',width:140});
        doc.font('Helvetica-Bold').fontSize(13).fillColor(bc).text(quota+'/anno',BDX,BDY+50,{align:'center',width:140});
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO).text('Commissioni '+cr+'%',BDX,BDY+72,{align:'center',width:140});

        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#BBBBBB')
           .text('Documento generato automaticamente dalla piattaforma \u2014 Verificare prima della firma',
                 ML,BY+142,{align:'center',width:CW});

        // ══ PAG CONTENUTO (flusso continuo) ══
        doc.addPage();

        pdfHBox(doc,'1. PARTI CONTRAENTI',ML,CW,VERDE);
        pdfH2(doc,'IL CONCEDENTE',ML,VERDE);
        pdfRows(doc,[
            ['Ragione Sociale', CONC.rag+' (P.M.: '+CONC.pm+')'],
            ['Sede Legale',     CONC.sede],
            ['P.IVA / C.F.',   CONC.piva],
            ['Email',          CONC.email],
            ['PEC',            CONC.pec],
            ['Siti Web',       CONC.siti],
        ],ML,CW);
        doc.moveDown(0.5);
        pdfH2(doc,'IL CENTRO AFFILIATO',ML,VERDE);
        pdfRows(doc,[
            ['Ragione Sociale',     affiliate.organization_name||'\u2014'],
            ['Forma Giuridica',     '___________________________'],
            ['Sede Legale',         (affiliate.address||'___')+' \u2014 '+(affiliate.city||'___')],
            ['P.IVA / C.F.',        affiliate.vat_number||'___________________________'],
            ['Referente',           affiliate.contact_name||'\u2014'],
            ['Email Istituzionale', affiliate.email||'\u2014'],
            ['PEC',                 affiliate.pec||'___________________________'],
            ['Codice SDI',          affiliate.codice_sdi||'___________________________'],
            ['Telefono',            affiliate.phone||'___________________________'],
            ['IBAN (pagamenti)',     '___________________________'],
        ],ML,CW);
        doc.moveDown(0.5);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(GR2)
           .text('Le parti come sopra identificate convengono e stipulano quanto segue.',ML,doc.y,{width:CW,align:'center'});
        doc.moveDown(1.2);

        pdfArt(doc,2,'Oggetto del Contratto',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il presente Contratto disciplina i termini e le condizioni dell\'affiliazione del Centro al Programma Partner di SAAM 4.0 Academy School, piattaforma AI di apprendimento della lingua italiana. Il Centro acquisisce il diritto non esclusivo di promuovere, distribuire e gestire l\'accesso dei propri studenti alla Piattaforma, in cambio di una commissione sulle sottoscrizioni generate tramite il proprio codice univoco.',ML,CW);
        pdfArt(doc,3,'Piani di Abbonamento e Struttura Commissioni',ML,CW,VERDE,NERO);
        pdfBody(doc,'Gli studenti iscritti tramite il Centro accedono alla Piattaforma attraverso i seguenti piani mensili:',ML,CW);
        pdfPlanTbl(doc,ML,CW,cr,VERDE,BIANCO);
        pdfArt(doc,4,'Quota Annuale di Adesione',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Centro corrisponde al Concedente una Quota Annuale di Adesione di '+quota+' (piano '+(prem?'Premium':'Standard')+'), con commissioni al '+cr+'%. La quota e\u2019 dovuta al momento dell\'approvazione e successivamente con cadenza annuale entro 30 giorni dalla data anniversario. Il mancato pagamento entro 15 giorni dalla scadenza comporta la sospensione dell\'accesso alla Dashboard Partner. La quota non e\u2019 rimborsabile.',ML,CW);
        pdfArt(doc,5,'Codice di Affiliazione e Tracciamento',ML,CW,VERDE,NERO);
        doc.font('Helvetica').fontSize(9.5).fillColor('#3A3A3A')
           .text('Al Centro viene assegnato il Codice Univoco: ',ML,doc.y+3,{continued:true});
        doc.font('Helvetica-Bold').fontSize(10).fillColor(VERDE)
           .text(affiliate.referral_code||'SAAM-XXXXX');
        pdfBody(doc,'Tale codice e\u2019 personale, non cedibile, accessibile dalla Dashboard Partner e utilizzabile nella pagina di registrazione pubblica tramite il parametro ?ref=CODICE.',ML,CW);
        pdfArt(doc,6,'Pagamento delle Provvigioni',ML,CW,VERDE,NERO);
        pdfBody(doc,'Le provvigioni ('+cr+'% sul canone mensile netto per studente attivo) sono calcolate il giorno 5 del mese successivo e liquidate entro il giorno 15 mediante bonifico bancario all\'IBAN comunicato dal Centro. Non sono corrisposte provvigioni su abbonamenti in prova, oggetto di chargeback o rimborso.',ML,CW);
        pdfArt(doc,7,'Account di Prova (Trial)',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Centro ha diritto ad attivare 1 account di prova settimanale (durata 7 giorni, limite 30 minuti, senza commissioni), tramite la Dashboard Partner. L\'abuso sistematico di questa funzionalita\u2019 comporta la revoca del diritto.',ML,CW);
        pdfArt(doc,8,'Dashboard Partner',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Concedente mette a disposizione una Dashboard Partner con: panoramica studenti attivi, MRR e commissioni maturate, monitoraggio minuti, reportistica mensile, attivazione account di prova e proiezione ricavi. Le credenziali sono comunicate all\'approvazione.',ML,CW);
        pdfArt(doc,9,'Obblighi del Centro Affiliato',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Centro si impegna a: promuovere la Piattaforma con correttezza; non cedere il codice a terzi; non registrare studenti fittizi; comunicare tempestivamente variazioni di IBAN o dati aziendali; rispettare il GDPR; non promuovere concorrenti diretti con materiali del Concedente.',ML,CW);
        pdfArt(doc,10,'Obblighi del Concedente',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Concedente garantisce: SLA minimo 99% mensile; aggiornamenti della Piattaforma senza costi aggiuntivi; preavviso di 30 giorni per variazioni tariffarie; supporto tecnico via email entro 48 ore lavorative; trasmissione mensile del riepilogo commissioni.',ML,CW);
        pdfArt(doc,11,'Durata, Rinnovo e Recesso',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Contratto ha durata di 12 mesi (dal '+TODAY+' al '+YEAR1+') con rinnovo automatico annuale, salvo disdetta scritta con 30 giorni di preavviso. Il recesso non da\u2019 diritto al rimborso della quota residua. Il Concedente puo\u2019 risolvere immediatamente per: frode, violazione grave degli obblighi, mancato pagamento oltre 15 giorni dalla scadenza.',ML,CW);
        pdfArt(doc,12,'Proprieta\u2019 Intellettuale e Riservatezza',ML,CW,VERDE,NERO);
        pdfBody(doc,'Tutti i contenuti della Piattaforma sono di proprieta\u2019 esclusiva del Concedente. Le parti si obbligano alla riservatezza su tutte le informazioni commerciali e tecniche per tutta la durata del contratto e per i 3 anni successivi alla cessazione.',ML,CW);
        pdfArt(doc,13,'GDPR e Protezione dei Dati',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il trattamento dei dati personali avviene nel rispetto del Regolamento UE 2016/679 (GDPR). Le parti sottoscriveranno, ove necessario, apposito Accordo di Responsabilita\u2019 del Trattamento (DPA) ai sensi dell\'Art. 28 GDPR.',ML,CW);
        pdfArt(doc,14,'Foro Competente e Legge Applicabile',ML,CW,VERDE,NERO);
        pdfBody(doc,'Il Contratto e\u2019 regolato dalla legge italiana. Le parti tenteranno in primo luogo una risoluzione amichevole entro 30 giorni. In mancanza di accordo, il Foro esclusivamente competente e\u2019 quello di Brindisi (BR).',ML,CW);

        // ══ PAGINA FIRME ══
        doc.addPage();
        pdfHBox(doc,'DICHIARAZIONI FINALI E FIRME',ML,CW,VERDE);
        doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO)
           .text('Le parti dichiarano di aver letto, compreso e accettato integralmente il presente Contratto. Le seguenti clausole sono specificamente approvate ai sensi degli artt. 1341 e 1342 c.c.:',ML,doc.y+6,{width:CW});
        doc.moveDown(0.4);
        ['Art. 11 \u2014 Risoluzione immediata per inadempimento del Centro',
         'Art. 12 \u2014 Riservatezza triennale post-contratto',
         'Art. 13 \u2014 Limitazione di responsabilita\u2019 del Concedente',
         'Art. 14 \u2014 Clausola di proroga della competenza del Foro (Brindisi BR)'
        ].forEach(function(c){
            doc.font('Helvetica').fontSize(9).fillColor(GRIGIO)
               .text('\u2022 '+c,ML+16,doc.y+3,{width:CW-16});
        });
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NERO)
           .text('Luogo:  ___________________________     Data: '+TODAY,ML,doc.y,{width:CW});
        doc.moveDown(1.2);
        var sY=doc.y, hw=(CW-30)/2, sx2=ML+hw+30;
        pdfSigBox(doc,ML, sY,hw,'PER IL CONCEDENTE','SAAM 4.0 Academy School','Angelo Pagliara \u2014 Project Manager',VERDE,GR2);
        pdfSigBox(doc,sx2,sY,hw,'PER IL CENTRO AFFILIATO',affiliate.organization_name||'___',affiliate.contact_name||'___',VERDE,GR2);
        var s2y=sY+134;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GR2)
           .text('FIRMA SPECIFICA PER APPROVAZIONE CLAUSOLE EX ARTT. 1341-1342 C.C.',ML,s2y,{align:'center',width:CW});
        pdfSig2Box(doc,ML, s2y+12,hw,'Firma Concedente',VERDE,GR2);
        pdfSig2Box(doc,sx2,s2y+12,hw,'Firma Centro Affiliato',VERDE,GR2);
        var alY=s2y+80;
        doc.moveTo(ML,alY).lineTo(ML+CW,alY).lineWidth(0.5).strokeColor('#EEEEEE').stroke();
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GR2)
           .text('ALLEGATI: A \u2014 Specifiche Tecniche  |  B \u2014 Linee Guida Brand  |  C \u2014 Accordo GDPR (DPA)',
                 ML,alY+6,{align:'center',width:CW});

        // ══ HEADER su ogni pagina (no footer, no numeri) ══
        var range = doc.bufferedPageRange();
        for (var pi=0; pi<range.count; pi++) {
            doc.switchToPage(pi);
            if (pi === 0) continue;
            doc.rect(0,0,W,5).fill(VERDE);
            doc.rect(0,5,W,3).fill(ROSSO);
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor(VERDE)
               .text('SAAM 4.0 ACADEMY SCHOOL \u2014 CONTRATTO DI AFFILIAZIONE',ML,13,{width:CW*0.55});
            doc.font('Helvetica').fontSize(7).fillColor('#AAAAAA')
               .text(subt,ML+CW*0.55,13,{width:CW*0.45,align:'right'});
            doc.moveTo(ML,27).lineTo(ML+CW,27).lineWidth(0.4).strokeColor('#DDDDDD').stroke();
        }

        doc.flushPages();
        doc.end();
    });
}



// ── Endpoint scarico contratto ──
router.get('/admin/affiliates/:id/contract', authMiddleware, adminOnly, async (req, res) => {
    const affId = parseInt(req.params.id);
    if (isNaN(affId)) return res.status(400).json({ error: 'ID non valido' });
    try {
        const { rows } = await pool.query(
            `SELECT a.*, u.name AS approved_by_name
             FROM affiliates a
             LEFT JOIN users u ON u.id = a.approved_by
             WHERE a.id = $1`, [affId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Centro non trovato' });

        const pdfBuffer = await _buildContractPDF(rows[0]);

        const safeName = (rows[0].organization_name || 'centro')
            .replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Contratto-SAAM40-${safeName}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
    } catch (err) {
        console.error('[CONTRACT PDF ERROR]', err.message, err.stack);
        res.status(500).json({ error: 'Errore generazione PDF: ' + err.message });
    }
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
                       (SELECT COUNT(*) FROM subscriptions WHERE affiliate_id = a.id AND status='active') AS active_subs,
                       (SELECT COALESCE(SUM(amount_eur),0) FROM subscriptions WHERE affiliate_id = a.id AND status='active') AS mrr
                FROM affiliates a
                WHERE a.status='active'
                ORDER BY mrr DESC LIMIT 10`)
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

// ════════════════════════════════════════════════════════════
// ADMIN: CONTRATTI IN SCADENZA — Export mensile
// ════════════════════════════════════════════════════════════

// Lista centri con scadenza nel mese indicato (default: mese corrente)
router.get('/admin/affiliates/expiring', authMiddleware, adminOnly, async (req, res) => {
    const { month } = req.query; // formato YYYY-MM, default mese corrente
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    try {
        const { rows } = await pool.query(`
            SELECT
                a.id, a.organization_name, a.contact_name, a.email, a.phone, a.city,
                a.referral_code, a.commission_rate,
                a.contract_start::date AS contract_start,
                a.contract_end::date   AS contract_end,
                EXTRACT(DAY FROM a.contract_end - NOW())::int AS giorni_rimanenti,
                a.notes,
                (SELECT COUNT(*) FROM users WHERE affiliate_id = a.id) AS total_students,
                (SELECT COALESCE(SUM(amount_eur),0) FROM subscriptions WHERE affiliate_id = a.id AND status='active') AS mrr
            FROM affiliates a
            WHERE a.status = 'active'
              AND to_char(a.contract_end, 'YYYY-MM') = $1
            ORDER BY a.contract_end ASC`,
            [targetMonth]
        );
        res.json({ month: targetMonth, affiliates: rows, count: rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Lista centri con scadenza entro N giorni (per alert)
router.get('/admin/affiliates/expiring-soon', authMiddleware, adminOnly, async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    try {
        const { rows } = await pool.query(`
            SELECT
                a.id, a.organization_name, a.contact_name, a.email, a.phone,
                a.contract_end::date AS contract_end,
                EXTRACT(DAY FROM a.contract_end - NOW())::int AS giorni_rimanenti
            FROM affiliates a
            WHERE a.status = 'active'
              AND a.contract_end IS NOT NULL
              AND a.contract_end BETWEEN NOW() AND NOW() + ($1 || ' days')::INTERVAL
            ORDER BY a.contract_end ASC`,
            [days]
        );
        res.json({ affiliates: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// PASSWORD RESET — AFFILIATI
// ════════════════════════════════════════════════════════════

// Richiesta reset password affiliato
router.post('/public/affiliate/forgot-password', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email richiesta' });
    try {
        await emailService.sendPasswordResetAffiliate(pool, email);
        return res.json({ success: true, message: "Se l'email è registrata riceverai le istruzioni." });
    } catch (err) {
        console.error('[RESET AFFILIATE]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

// Verifica token e reset password affiliato
router.post('/public/affiliate/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Dati mancanti' });
    try {
        const { rows } = await pool.query(
            `SELECT affiliate_id FROM affiliate_password_resets
             WHERE token = $1 AND used = false AND expires_at > NOW()`, [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
        const hash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE affiliates SET password_hash = $1 WHERE id = $2', [hash, rows[0].affiliate_id]);
        await pool.query('UPDATE affiliate_password_resets SET used = true WHERE token = $1', [token]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// PASSWORD RESET — STUDENTI
// ════════════════════════════════════════════════════════════

router.post('/public/student/forgot-password', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email richiesta' });
    try {
        await emailService.sendPasswordResetStudent(pool, email);
        return res.json({ success: true, message: "Se l'email è registrata riceverai le istruzioni." });
    } catch (err) {
        console.error('[RESET STUDENT]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

router.post('/public/student/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Dati mancanti' });
    try {
        const { rows } = await pool.query(
            `SELECT user_id FROM password_resets
             WHERE token=$1 AND used=false AND expires_at>NOW() AND type='student'`, [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
        const hash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, rows[0].user_id]);
        await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// PASSWORD RESET — ADMIN
// ════════════════════════════════════════════════════════════

router.post('/public/admin/forgot-password', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email richiesta' });
    try {
        await emailService.sendPasswordResetAdmin(pool, email);
        return res.json({ success: true, message: "Se l'email è registrata riceverai le istruzioni." });
    } catch (err) {
        console.error('[RESET ADMIN]', err.message);
        return res.status(500).json({ error: err.message });
    }
});

router.post('/public/admin/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Dati mancanti' });
    try {
        const { rows } = await pool.query(
            `SELECT user_id FROM password_resets
             WHERE token=$1 AND used=false AND expires_at>NOW() AND type='admin'`, [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
        const hash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, rows[0].user_id]);
        await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// TEST SMTP — solo admin, per diagnostica
// GET /api/admin/test-email
// ════════════════════════════════════════════════════════════
router.get('/admin/test-email', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (!process.env.BREVO_API_KEY) {
            return res.status(500).json({ ok:false, error:'BREVO_API_KEY non impostata su Render' });
        }
        await _brevoSendAff(
            process.env.NOTIFY_EMAIL || 'training@angelopagliara.it',
            '✅ Test Email — SAAM 4.0 funziona!',
            '<h2 style="color:#009246">✅ Brevo API funziona!</h2><p>Le notifiche email sono attive.</p>'
        );
        res.json({ ok:true, message:'Email di test inviata a ' + (process.env.NOTIFY_EMAIL || 'training@angelopagliara.it') });
    } catch(err) {
        res.status(500).json({ ok:false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════
// LEZIONI PERSONALIZZATE LIVE
// ════════════════════════════════════════════════════════════

const LESSON_PRICE      = 30.00;
const LESSON_TEACHER_SHARE = 0.70;  // 70% al docente/centro
const LESSON_DAYS = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];

// ── Helpers ──────────────────────────────────────────────────
function lessonShares(price) {
    const teacher  = Math.round(price * LESSON_TEACHER_SHARE * 100) / 100;
    const platform = Math.round((price - teacher) * 100) / 100;
    return { teacher, platform };
}

// Genera slot disponibili per le prossime N settimane
// escludendo quelli già prenotati (paid/confirmed/completed)
async function getAvailableSlots(teacherId, weeksAhead = 4) {
    const slots = await pool.query(
        'SELECT * FROM teacher_slots WHERE teacher_id=$1 AND is_active=true ORDER BY day_of_week, start_time',
        [teacherId]
    );
    const bookedRows = await pool.query(
        `SELECT lesson_at FROM bookings
         WHERE teacher_id=$1 AND status IN ('paid','confirmed','completed')
         AND lesson_at > NOW() AND lesson_at < NOW() + INTERVAL '${weeksAhead} weeks'`,
        [teacherId]
    );
    const bookedSet = new Set(bookedRows.rows.map(r => new Date(r.lesson_at).getTime()));

    const result = [];
    const now = new Date();
    for (let w = 0; w < weeksAhead; w++) {
        for (const slot of slots.rows) {
            // Calcola la data del prossimo giorno-settimana corrispondente
            const d = new Date(now);
            d.setDate(d.getDate() + ((slot.day_of_week - d.getDay() + 7) % 7) + w * 7);
            const [hh, mm] = slot.start_time.split(':');
            d.setHours(parseInt(hh), parseInt(mm), 0, 0);
            // Scarta date passate o entro 24h
            if (d.getTime() < Date.now() + 24 * 60 * 60 * 1000) continue;
            if (!bookedSet.has(d.getTime())) {
                result.push({
                    slot_id: slot.id,
                    datetime: d.toISOString(),
                    day_label: LESSON_DAYS[slot.day_of_week],
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                });
            }
        }
    }
    return result.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

// ── PUBLIC: lista docenti attivi con slot disponibili ────────
router.get('/public/teachers', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT t.id, t.name, t.bio, t.photo_url, t.subjects,
                   t.price_per_hour, t.zoom_link,
                   a.organization_name AS center_name, a.city AS center_city
            FROM teachers t
            JOIN affiliates a ON a.id = t.affiliate_id
            WHERE t.is_active = true AND t.approved_at IS NOT NULL
            AND a.status = 'active'
            ORDER BY t.name`);
        res.json({ teachers: rows });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUBLIC: slot disponibili di un docente ───────────────────
router.get('/public/teachers/:id/slots', async (req, res) => {
    const teacherId = parseInt(req.params.id);
    if (isNaN(teacherId)) return res.status(400).json({ error: 'ID non valido' });
    try {
        const { rows } = await pool.query(
            'SELECT id FROM teachers WHERE id=$1 AND is_active=true AND approved_at IS NOT NULL',
            [teacherId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Docente non trovato' });
        const slots = await getAvailableSlots(teacherId, 4);
        res.json({ slots });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── AUTH: crea sessione Stripe per prenotare una lezione ─────
router.post('/lessons/checkout', authMiddleware, async (req, res) => {
    const { teacher_id, lesson_at, notes } = req.body;
    if (!teacher_id || !lesson_at) return res.status(400).json({ error: 'Dati mancanti' });
    try {
        // Solo studenti Advanced o Gold
        const userRow = await pool.query(
            "SELECT id, name, email, package FROM users WHERE id=$1", [req.user.userId]
        );
        const user = userRow.rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        if (!['advanced','gold'].includes(user.package))
            return res.status(403).json({ error: 'Le lezioni personalizzate sono disponibili per i piani Advanced e Gold.' });

        // Verifica docente
        const tRow = await pool.query(
            `SELECT t.*, a.id AS aff_id FROM teachers t
             JOIN affiliates a ON a.id = t.affiliate_id
             WHERE t.id=$1 AND t.is_active=true AND t.approved_at IS NOT NULL AND a.status='active'`,
            [teacher_id]
        );
        if (!tRow.rows[0]) return res.status(404).json({ error: 'Docente non disponibile' });
        const teacher = tRow.rows[0];

        // Verifica slot non già prenotato
        const lessonDate = new Date(lesson_at);
        const conflictRow = await pool.query(
            `SELECT id FROM bookings WHERE teacher_id=$1 AND lesson_at=$2
             AND status IN ('paid','confirmed','completed')`,
            [teacher_id, lessonDate]
        );
        if (conflictRow.rows[0]) return res.status(409).json({ error: 'Slot non più disponibile.' });

        const shares = lessonShares(LESSON_PRICE);
        const stripe = getStripe();
        const feUrl  = process.env.FRONTEND_URL || 'https://italian-learning-platform.onrender.com';

        // Crea prenotazione pending
        const bookRow = await pool.query(
            `INSERT INTO bookings
             (student_id, teacher_id, affiliate_id, lesson_at, amount_eur,
              teacher_share_eur, platform_share_eur, zoom_link, notes, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING id`,
            [user.id, teacher_id, teacher.aff_id, lessonDate,
             LESSON_PRICE, shares.teacher, shares.platform,
             teacher.zoom_link, notes || null]
        );
        const bookingId = bookRow.rows[0].id;

        const dateLabel = lessonDate.toLocaleString('it-IT', {
            weekday:'long', day:'2-digit', month:'long', year:'numeric',
            hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome'
        });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: user.email,
            line_items: [{
                price_data: {
                    currency: 'eur',
                    unit_amount: Math.round(LESSON_PRICE * 100),
                    product_data: {
                        name: `Lezione personalizzata con ${teacher.name}`,
                        description: `${dateLabel} · 60 minuti · via Zoom`,
                    }
                },
                quantity: 1,
            }],
            metadata: { booking_id: bookingId, type: 'lesson' },
            success_url: `${feUrl}/prenotazione-lezioni.html?success=1&booking=${bookingId}`,
            cancel_url:  `${feUrl}/prenotazione-lezioni.html?cancelled=1`,
        });

        // Salva session id
        await pool.query(
            'UPDATE bookings SET stripe_session_id=$1 WHERE id=$2',
            [session.id, bookingId]
        );

        res.json({ checkout_url: session.url });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUBLIC: verifica pagamento e conferma prenotazione ───────
router.get('/public/lessons/verify/:sessionId', async (req, res) => {
    try {
        const stripe  = getStripe();
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        if (session.payment_status !== 'paid')
            return res.status(400).json({ error: 'Pagamento non completato' });

        const bookingId = parseInt(session.metadata.booking_id);
        const piId      = session.payment_intent;

        const { rows } = await pool.query(
            `UPDATE bookings SET status='paid', stripe_payment_intent_id=$1, updated_at=NOW()
             WHERE id=$2 AND status='pending' RETURNING *`,
            [piId, bookingId]
        );
        if (!rows[0]) return res.json({ already_confirmed: true });
        const booking = rows[0];

        // Dati studente e docente per le email
        const [stuRow, tchRow] = await Promise.all([
            pool.query('SELECT name, email FROM users WHERE id=$1', [booking.student_id]),
            pool.query(`SELECT t.name, t.email, t.zoom_link,
                               a.organization_name AS center_name
                        FROM teachers t JOIN affiliates a ON a.id=t.affiliate_id
                        WHERE t.id=$1`, [booking.teacher_id]),
        ]);
        const stu = stuRow.rows[0];
        const tch = tchRow.rows[0];
        const dateLabel = new Date(booking.lesson_at).toLocaleString('it-IT', {
            weekday:'long', day:'2-digit', month:'long', year:'numeric',
            hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome'
        });

        // Email allo studente
        if (process.env.BREVO_API_KEY && stu) {
            await _brevoSendAff(stu.email, `✅ Lezione confermata con ${tch?.name}`, `
                <h2 style="color:#009246">✅ Prenotazione Confermata!</h2>
                <p>Ciao <strong>${stu.name}</strong>,</p>
                <p>La tua lezione personalizzata è confermata.</p>
                <table style="border-collapse:collapse;width:100%;margin:16px 0">
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Docente</td><td style="padding:8px">${tch?.name} — ${tch?.center_name}</td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Data e ora</td><td style="padding:8px">${dateLabel}</td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Durata</td><td style="padding:8px">60 minuti</td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Link Zoom</td><td style="padding:8px"><a href="${booking.zoom_link}">${booking.zoom_link}</a></td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Importo pagato</td><td style="padding:8px">€${booking.amount_eur}</td></tr>
                </table>
                <p style="font-size:12px;color:#888">SAAM 4.0 Academy School — training@angelopagliara.it</p>`
            ).catch(e => console.error('[EMAIL booking student]', e.message));
        }

        // Email al docente
        if (process.env.BREVO_API_KEY && tch?.email) {
            await _brevoSendAff(tch.email, `📅 Nuova lezione prenotata — ${dateLabel}`, `
                <h2 style="color:#009246">📅 Nuova Prenotazione!</h2>
                <p>Ciao <strong>${tch.name}</strong>,</p>
                <p>Hai una nuova lezione prenotata e pagata.</p>
                <table style="border-collapse:collapse;width:100%;margin:16px 0">
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Studente</td><td style="padding:8px">${stu?.name}</td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Data e ora</td><td style="padding:8px">${dateLabel}</td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Il tuo link Zoom</td><td style="padding:8px"><a href="${booking.zoom_link}">${booking.zoom_link}</a></td></tr>
                  <tr><td style="padding:8px;background:#f0f7f2;font-weight:700">Il tuo compenso</td><td style="padding:8px">€${booking.teacher_share_eur} (liquidazione mensile)</td></tr>
                </table>
                <p style="font-size:12px;color:#888">SAAM 4.0 Academy School — training@angelopagliara.it</p>`
            ).catch(e => console.error('[EMAIL booking teacher]', e.message));
        }

        // Notifica admin
        if (process.env.BREVO_API_KEY) {
            await _brevoSendAff(
                process.env.NOTIFY_EMAIL || 'training@angelopagliara.it',
                `💰 Nuova lezione pagata — ${stu?.name} con ${tch?.name}`,
                `<h2>💰 Lezione pagata — €${booking.amount_eur}</h2>
                 <p>Studente: ${stu?.name} | Docente: ${tch?.name} | Data: ${dateLabel}</p>
                 <p>Quota SAAM: €${booking.platform_share_eur} | Quota docente: €${booking.teacher_share_eur}</p>`
            ).catch(e => console.error('[EMAIL booking admin]', e.message));
        }

        res.json({ success: true, booking });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── PUBLIC: verifica booking by id (per pagina success) ────────
router.get('/public/lessons/verify-booking/:bookingId', async (req, res) => {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) return res.status(400).json({ error: 'ID non valido' });
    try {
        const { rows } = await pool.query(
            `SELECT b.id, b.status, b.lesson_at, b.zoom_link, b.amount_eur,
                    t.name AS teacher_name, a.organization_name AS center_name
             FROM bookings b
             JOIN teachers t ON t.id=b.teacher_id
             JOIN affiliates a ON a.id=b.affiliate_id
             WHERE b.id=$1`, [bookingId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Prenotazione non trovata' });
        res.json({ booking: rows[0] });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── AUTH: storico prenotazioni studente ──────────────────────
router.get('/lessons/my-bookings', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT b.id, b.lesson_at, b.status, b.amount_eur, b.zoom_link, b.notes,
                   t.name AS teacher_name, t.photo_url AS teacher_photo,
                   a.organization_name AS center_name
            FROM bookings b
            JOIN teachers t ON t.id = b.teacher_id
            JOIN affiliates a ON a.id = b.affiliate_id
            WHERE b.student_id = $1
            ORDER BY b.lesson_at DESC`, [req.user.userId]);
        res.json({ bookings: rows });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── TEACHER AUTH: login docente (usa email+password) ─────────
router.post('/teacher/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Dati mancanti' });
    try {
        const { rows } = await pool.query(
            'SELECT * FROM teachers WHERE email=$1 AND is_active=true', [email]
        );
        if (!rows[0]) return res.status(401).json({ error: 'Credenziali non valide' });
        // Usa stessa tabella password_resets per reset — password hashata con bcrypt
        const ok = await bcrypt.compare(password, rows[0].password_hash || '');
        if (!ok) return res.status(401).json({ error: 'Credenziali non valide' });
        const token = jwt.sign(
            { teacherId: rows[0].id, role: 'teacher', affiliateId: rows[0].affiliate_id },
            JWT_SECRET, { expiresIn: '7d' }
        );
        res.json({ token, teacher: {
            id: rows[0].id, name: rows[0].name, email: rows[0].email,
            bio: rows[0].bio, photo_url: rows[0].photo_url, zoom_link: rows[0].zoom_link
        }});
    } catch(err) { res.status(500).json({ error: err.message }); }
});

function teacherAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token mancante' });
    try {
        req.teacher = jwt.verify(token, JWT_SECRET);
        if (req.teacher.role !== 'teacher') throw new Error('Ruolo non valido');
        next();
    } catch { return res.status(401).json({ error: 'Token non valido' }); }
}

// ── TEACHER: la sua dashboard ────────────────────────────────
router.get('/teacher/dashboard', teacherAuth, async (req, res) => {
    try {
        const [teacherRow, slotsRow, bookingsRow] = await Promise.all([
            pool.query(
                `SELECT t.*, a.organization_name AS center_name, a.city AS center_city
                 FROM teachers t JOIN affiliates a ON a.id=t.affiliate_id
                 WHERE t.id=$1`, [req.teacher.teacherId]),
            pool.query(
                'SELECT * FROM teacher_slots WHERE teacher_id=$1 ORDER BY day_of_week, start_time',
                [req.teacher.teacherId]),
            pool.query(
                `SELECT b.id, b.lesson_at, b.status, b.amount_eur, b.teacher_share_eur,
                        b.zoom_link, b.notes, b.paid_to_center,
                        u.name AS student_name, u.email AS student_email
                 FROM bookings b JOIN users u ON u.id=b.student_id
                 WHERE b.teacher_id=$1
                 ORDER BY b.lesson_at DESC LIMIT 50`, [req.teacher.teacherId]),
        ]);
        if (!teacherRow.rows[0]) return res.status(404).json({ error: 'Docente non trovato' });

        const upcomingBookings = bookingsRow.rows.filter(b =>
            ['paid','confirmed'].includes(b.status) && new Date(b.lesson_at) > new Date()
        );
        const totalEarned = bookingsRow.rows
            .filter(b => b.status === 'completed')
            .reduce((s, b) => s + parseFloat(b.teacher_share_eur), 0);
        const pendingPayout = bookingsRow.rows
            .filter(b => ['paid','confirmed','completed'].includes(b.status) && !b.paid_to_center)
            .reduce((s, b) => s + parseFloat(b.teacher_share_eur), 0);

        res.json({
            teacher: teacherRow.rows[0],
            slots: slotsRow.rows,
            bookings: bookingsRow.rows,
            stats: {
                upcoming: upcomingBookings.length,
                total_lessons: bookingsRow.rows.filter(b => b.status === 'completed').length,
                total_earned_eur: totalEarned.toFixed(2),
                pending_payout_eur: pendingPayout.toFixed(2),
            }
        });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── TEACHER: gestione disponibilità ─────────────────────────
router.post('/teacher/slots', teacherAuth, async (req, res) => {
    const { day_of_week, start_time } = req.body;
    if (day_of_week === undefined || !start_time)
        return res.status(400).json({ error: 'Dati mancanti' });
    const [hh] = start_time.split(':');
    const end_time = `${String(parseInt(hh)+1).padStart(2,'0')}:${start_time.split(':')[1]}`;
    try {
        await pool.query(
            `INSERT INTO teacher_slots (teacher_id, day_of_week, start_time, end_time)
             VALUES ($1,$2,$3,$4) ON CONFLICT (teacher_id, day_of_week, start_time) DO UPDATE SET is_active=true`,
            [req.teacher.teacherId, day_of_week, start_time, end_time]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

router.delete('/teacher/slots/:id', teacherAuth, async (req, res) => {
    try {
        await pool.query(
            'UPDATE teacher_slots SET is_active=false WHERE id=$1 AND teacher_id=$2',
            [req.params.id, req.teacher.teacherId]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── TEACHER: aggiorna profilo ────────────────────────────────
router.put('/teacher/profile', teacherAuth, async (req, res) => {
    const { bio, photo_url, zoom_link, subjects, phone } = req.body;
    if (!zoom_link) return res.status(400).json({ error: 'Il link Zoom è obbligatorio' });
    try {
        const { rows } = await pool.query(
            `UPDATE teachers SET bio=$1, photo_url=$2, zoom_link=$3, subjects=$4, phone=$5
             WHERE id=$6 RETURNING *`,
            [bio||null, photo_url||null, zoom_link, subjects||null, phone||null, req.teacher.teacherId]
        );
        res.json({ teacher: rows[0] });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: lista tutti i docenti ─────────────────────────────
router.get('/admin/teachers', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT t.*, a.organization_name AS center_name, a.city AS center_city,
                   (SELECT COUNT(*) FROM bookings b WHERE b.teacher_id=t.id AND b.status='completed') AS lessons_completed,
                   (SELECT COALESCE(SUM(teacher_share_eur),0) FROM bookings b
                    WHERE b.teacher_id=t.id AND b.status IN ('paid','confirmed','completed') AND NOT b.paid_to_center) AS pending_payout
            FROM teachers t JOIN affiliates a ON a.id=t.affiliate_id
            ORDER BY t.is_active DESC, t.name`);
        res.json({ teachers: rows });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: approva/disattiva docente ─────────────────────────
router.put('/admin/teachers/:id/approve', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE teachers SET approved_at=NOW(), approved_by=$1, is_active=true WHERE id=$2 RETURNING *`,
            [req.user.userId, req.params.id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Docente non trovato' });
        res.json({ success: true, teacher: rows[0] });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

router.put('/admin/teachers/:id/status', authMiddleware, adminOnly, async (req, res) => {
    const { is_active } = req.body;
    try {
        await pool.query('UPDATE teachers SET is_active=$1 WHERE id=$2', [is_active, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: crea docente ───────────────────────────────────────
router.post('/admin/teachers', authMiddleware, adminOnly, async (req, res) => {
    const { affiliate_id, name, email, phone, bio, photo_url, zoom_link, subjects } = req.body;
    if (!affiliate_id || !name || !email || !zoom_link)
        return res.status(400).json({ error: 'affiliate_id, name, email, zoom_link obbligatori' });
    try {
        // Password temporanea hashata
        const tempPwd = Math.random().toString(36).slice(-8);
        const hash = await bcrypt.hash(tempPwd, 12);
        const { rows } = await pool.query(
            `INSERT INTO teachers (affiliate_id, name, email, phone, bio, photo_url, zoom_link, subjects, password_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [affiliate_id, name, email, phone||null, bio||null, photo_url||null, zoom_link, subjects||null, hash]
        );
        res.json({ success: true, teacher: rows[0], temp_password: tempPwd });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: tutte le prenotazioni (con filtro stato) ──────────
router.get('/admin/bookings', authMiddleware, adminOnly, async (req, res) => {
    const { status, from, to } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { params.push(status); where += ` AND b.status=$${params.length}`; }
    if (from)   { params.push(from);   where += ` AND b.lesson_at >= $${params.length}`; }
    if (to)     { params.push(to);     where += ` AND b.lesson_at <= $${params.length}`; }
    try {
        const { rows } = await pool.query(`
            SELECT b.*,
                   u.name AS student_name, u.email AS student_email,
                   t.name AS teacher_name,
                   a.organization_name AS center_name
            FROM bookings b
            JOIN users u ON u.id=b.student_id
            JOIN teachers t ON t.id=b.teacher_id
            JOIN affiliates a ON a.id=b.affiliate_id
            ${where}
            ORDER BY b.lesson_at DESC LIMIT 200`, params);

        const summary = {
            total: rows.length,
            revenue_eur: rows.filter(b => ['paid','confirmed','completed'].includes(b.status))
                             .reduce((s,b) => s + parseFloat(b.amount_eur), 0).toFixed(2),
            unpaid_to_centers: rows.filter(b => ['paid','confirmed','completed'].includes(b.status) && !b.paid_to_center)
                                   .reduce((s,b) => s + parseFloat(b.teacher_share_eur), 0).toFixed(2),
        };
        res.json({ bookings: rows, summary });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── ADMIN: segna lezioni come pagate al centro ───────────────
router.put('/admin/bookings/mark-paid-centers', authMiddleware, adminOnly, async (req, res) => {
    const { affiliate_id } = req.body;
    let where = "status IN ('paid','confirmed','completed') AND paid_to_center=false";
    const params = [];
    if (affiliate_id) { params.push(affiliate_id); where += ` AND affiliate_id=$${params.length}`; }
    try {
        const { rowCount } = await pool.query(
            `UPDATE bookings SET paid_to_center=true, paid_to_center_at=NOW()
             WHERE ${where}`, params
        );
        res.json({ success: true, updated: rowCount });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Funzione di inizializzazione — chiamata da server.js con il pool attivo
function init(dbPool) {
    pool = dbPool;
    return router;
}

module.exports = init;
module.exports.stripeWebhook = stripeWebhook;
module.exports.init = init;
