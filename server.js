require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// ============================================
// POSTGRESQL CONNECTION
// ============================================

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'italian_learning_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ PostgreSQL connection error:', err);
    } else {
        console.log('✅ PostgreSQL connected successfully at:', res.rows[0].now);
    }
});

// ── EMAIL SERVICE — Brevo HTTP API (porta 443, mai bloccata da Render) ────────
// Variabili Render richieste:
//   BREVO_API_KEY  → la API key di Brevo (Settings → API Keys → Create API Key)
//   NOTIFY_EMAIL   → training@angelopagliara.it
//   FRONTEND_URL   → https://italianlearning.angelopagliara.it
// ─────────────────────────────────────────────────────────────────────────────
const NOTIFY_TO = process.env.NOTIFY_EMAIL || 'training@angelopagliara.it';
const BREVO_FROM = { name: 'SAAM 4.0 Academy', email: process.env.BREVO_SENDER || 'training@angelopagliara.it' };

async function _brevoSend(to, subject, html) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) throw new Error('BREVO_API_KEY non impostata su Render');
    const https = require('https');
    const body = JSON.stringify({
        sender: BREVO_FROM,
        to: Array.isArray(to) ? to : [{ email: to }],
        subject,
        htmlContent: html
    });
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.brevo.com',
            path: '/v3/smtp/email',
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data || '{}'));
                } else {
                    reject(new Error('Brevo API error ' + res.statusCode + ': ' + data));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Brevo API timeout')); });
        req.write(body);
        req.end();
    });
}
function _htmlWrap(titolo, sub, body) {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
        + 'body{font-family:Arial,sans-serif;background:#f4f7f4;margin:0}'
        + '.w{max-width:600px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}'
        + '.t{background:#009246;padding:22px 32px;color:#fff}.t h1{margin:0;font-size:20px}'
        + '.t p{margin:5px 0 0;font-size:12px;opacity:.85}.b{padding:26px 32px}'
        + '.r{display:flex;border-bottom:1px solid #eee;padding:9px 0}.r:last-child{border-bottom:none}'
        + '.l{width:160px;font-size:12px;font-weight:700;color:#555;flex-shrink:0}.v{font-size:12px;color:#222}'
        + '.btn{display:inline-block;margin:18px 0;background:#009246;color:#fff;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px}'
        + '.f{background:#f0f7f2;padding:14px 32px;font-size:11px;color:#888;text-align:center}'
        + '</style></head><body><div class="w">'
        + '<div class="t"><h1>' + titolo + '</h1><p>' + sub + '</p></div>'
        + '<div class="b">' + body + '</div>'
        + '<div class="f">SAAM 4.0 Academy School &mdash; training@angelopagliara.it</div>'
        + '</div></body></html>';
}
function _row(l, v) { return v ? '<div class="r"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>' : ''; }

async function _sendResetEmail(pool, email, userType) {
    if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY non configurata su Render');
    let userRow, table, pwCol, tokenTable;
    if (userType === 'affiliate') {
        const r = await pool.query('SELECT id, contact_name AS name FROM affiliates WHERE email=$1', [email]);
        userRow = r.rows[0]; table = 'affiliate_password_resets'; pwCol = null; tokenTable = 'affiliate';
    } else {
        const roleFilter = userType === 'admin' ? "AND role='admin'" : "AND role='student'";
        const r = await pool.query('SELECT id, name FROM users WHERE email=$1 ' + roleFilter, [email]);
        userRow = r.rows[0]; table = 'password_resets'; pwCol = userType;
    }
    if (!userRow) return; // risposta silenziosa — sicurezza
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60*60*1000);
    if (userType === 'affiliate') {
        await pool.query('INSERT INTO affiliate_password_resets (affiliate_id,token,expires_at,used) VALUES ($1,$2,$3,false)',
            [userRow.id, token, expires]);
    } else {
        await pool.query('INSERT INTO password_resets (user_id,token,expires_at,used,type) VALUES ($1,$2,$3,false,$4)',
            [userRow.id, token, expires, userType]);
    }
    const feUrl = process.env.FRONTEND_URL || 'https://italianlearning.angelopagliara.it';
    const link = feUrl + '/reset-password.html?type=' + userType + '&token=' + token;
    const icon = userType === 'admin' ? '🔐' : '🔑';
    const label = userType === 'affiliate' ? 'Centro Affiliato' : userType === 'admin' ? 'Amministratore' : 'Studente';
    const html = _htmlWrap(
        icon + ' Reset Password — ' + label,
        'Hai richiesto il ripristino della tua password',
        '<p style="font-size:14px;color:#333">Ciao <strong>' + userRow.name + '</strong>,</p>'
        + '<p style="font-size:14px;color:#333;margin-top:8px">Clicca il pulsante per impostare una nuova password. Il link è valido <strong>1 ora</strong>.</p>'
        + '<a href="' + link + '" class="btn">Reimposta la Password</a>'
        + '<p style="font-size:11px;color:#999">Se non hai richiesto il reset, ignora questa email.</p>'
    );
    await _brevoSend(email, icon + ' Reimposta la tua password — SAAM 4.0', html);
}

async function _sendNotifyAdmin(type, data) {
    if (!process.env.BREVO_API_KEY) return;
    try {
        let subject, body;
        if (type === 'student') {
            const pkg = {basic:'Basic (€9,70/mese)',advanced:'Advanced (€16,70/mese)',gold:'Gold (€27,70/mese)'}[data.package]||data.package;
            subject = '🎓 Nuovo Studente — ' + data.name + ' (' + pkg + ')';
            body = _row('Nome', data.name) + _row('Email', data.email) + _row('Telefono', data.phone||'—')
                 + _row('Piano', pkg) + _row('Affiliato', data.referral_code||'—')
                 + '<div style="margin-top:14px"><span style="background:#009246;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">STUDENTE ATTIVO</span></div>';
        } else {
            subject = '🏢 Nuova Affiliazione — ' + data.organization_name + ' (' + (data.piano_adesione||'n.d.') + ')';
            body = _row('Organizzazione', data.organization_name) + _row('Referente', data.contact_name)
                 + _row('Email', data.email) + _row('Telefono', data.phone) + _row('Città', data.city)
                 + _row('P.IVA', data.vat_number) + _row('Piano', data.piano_adesione)
                 + '<div style="margin-top:14px"><span style="background:#C8900A;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">IN ATTESA APPROVAZIONE</span></div>'
                 + '<p style="margin-top:14px;font-size:13px"><a href="'+(process.env.FRONTEND_URL||'')+'/admin-affiliazioni.html" style="color:#009246;font-weight:700">Apri Dashboard Admin →</a></p>';
        }
        const html = _htmlWrap(subject, new Date().toLocaleString('it-IT'), body);
        await _brevoSend(NOTIFY_TO, subject, html);
    } catch(e) { console.error('[EMAIL NOTIFY]', e.message); }
}

const emailService = {
    notifyNewStudent:  (d) => _sendNotifyAdmin('student', d),
    notifyNewAffiliate:(d) => _sendNotifyAdmin('affiliate', d),
};



const { google } = require('googleapis');



// ── Tracking costi API (inline — non dipende da file esterni) ──
async function trackApiUsage(pool, userId, apiType, units, sessionType, sessionId) {
    try {
        const costPerUnit = apiType === 'claude_input'  ? 0.000003
                          : apiType === 'claude_output' ? 0.000015
                          : apiType === 'tts'           ? 0.000016 : 0;
        const costUsd = (units || 0) * costPerUnit;
        await pool.query(
            `INSERT INTO api_usage (user_id, api_type, units, session_type, session_id, cost_usd, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [userId, apiType, units || 0, sessionType || 'conversation', sessionId || null, costUsd]
        );
    } catch (err) {
        console.error('trackApiUsage error:', err.message);
    }
}
async function trackConversationSession() {} // placeholder compatibilità
// ============================================
// PACCHETTI ABBONAMENTO
// ============================================
const PACKAGES = {
    basic:    { daily_minutes: 30,  monthly_minutes: 900,  label: 'Basic'    },
    advanced: { daily_minutes: 60,  monthly_minutes: 1800, label: 'Advanced' },
    gold:     { daily_minutes: 120, monthly_minutes: 3600, label: 'Gold'     },
    unlimited:{ daily_minutes: 9999,monthly_minutes: 99999,label: 'Unlimited'},
};
function getPackageLimits(pkg) {
    return PACKAGES[pkg] || PACKAGES.basic;
}
// routes/admin-costs rimosso — endpoint costi inline nel server

const app = express();
const PORT = process.env.PORT || 3001;



// ============================================
// GOOGLE APIS SETUP
// ============================================

let driveClient = null;
let youtubeClient = null;

// Initialize Google Drive API
if (process.env.GOOGLE_API_KEY) {
    driveClient = google.drive({
        version: 'v3',
        auth: process.env.GOOGLE_API_KEY
    });
    console.log('✅ Google Drive API initialized');
}

// Initialize YouTube API
if (process.env.GOOGLE_API_KEY) {
    youtubeClient = google.youtube({
        version: 'v3',
        auth: process.env.GOOGLE_API_KEY
    });
    console.log('✅ YouTube API initialized');
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());

// ── WEBHOOK STRIPE (raw body — deve stare PRIMA di express.json) ──
const { stripeWebhook } = require('./server-affiliazioni');
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
// Nota: stripeWebhook usa il pool iniettato tramite affiliazioniInit(pool) più sotto

app.use(express.json());

// ── FILE STATICI (HTML, CSS, immagini) ──
const path = require('path');
app.use(express.static(path.join(__dirname)));

// ── ROUTES AFFILIAZIONI + STRIPE ──
let affiliazioniRoutes;
try {
    const affiliazioniInit = require('./server-affiliazioni');
    affiliazioniRoutes = affiliazioniInit(pool);
    app.use('/api', affiliazioniRoutes);
    console.log('[BOOT] server-affiliazioni caricato OK');
} catch(bootErr) {
    console.error('[BOOT ERROR] server-affiliazioni FALLITO:', bootErr.message, bootErr.stack);
}

// Route diagnostica pubblica — GET /api/ping
app.get('/api/ping', (req, res) => {
    res.json({
        ok: true,
        router_loaded: !!affiliazioniRoutes,
        brevo_api_key: !!process.env.BREVO_API_KEY,
        notify_email: process.env.NOTIFY_EMAIL || 'non impostato',
        frontend_url: process.env.FRONTEND_URL || 'non impostato',
        node_version: process.version,
        time: new Date().toISOString()
    });
});

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});
// (admin-costs route inline — vedi endpoint /api/admin/costs/summary più avanti)

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authenticate(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Token mancante' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT verification error:', err);
        return res.status(401).json({ error: 'Token non valido' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accesso negato: admin richiesto' });
    }
    next();
}

// ============================================
// AUTH ROUTES (unchanged)
// ============================================

app.post('/api/auth/register', async (req, res) => {
    const { email, password, name, role = 'student' } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Email, password e nome richiesti' });
    }

    const client = await pool.connect();
    try {
        const userExists = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Email già registrata' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await client.query(
            `INSERT INTO users (email, password, name, role, minutes_limit, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW()) 
             RETURNING id, email, name, role, minutes_limit`,
            [email.toLowerCase(), hashedPassword, name, role, role === 'admin' ? 999999 : 120]
        );

        const user = result.rows[0];

        // Create student level entry if student
        if (role === 'student') {
            await client.query(
                `INSERT INTO student_levels (user_id, level, created_at) 
                 VALUES ($1, 'A1', NOW())`,
                [user.id]
            );
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Registrazione completata',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                minutes_limit: user.minutes_limit
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Errore durante la registrazione' });
    } finally {
        client.release();
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email e password richiesti' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        await client.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key-change-in-production',
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Login effettuato',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                minutes_limit: user.minutes_limit
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Errore durante il login' });
    } finally {
        client.release();
    }
});

// ============================================
// USER ROUTES
// ============================================

app.get('/api/user/profile', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT u.id, u.email, u.name, u.role, u.minutes_limit, u.created_at,
                    sl.level, sl.topics, sl.target_voice, sl.learning_goals
             FROM users u
             LEFT JOIN student_levels sl ON u.id = sl.user_id
             WHERE u.id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.get('/api/user/usage', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [dailyUsage, monthlyUsage, userLimits] = await Promise.all([
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date = $2',
                [req.user.userId, today]
            ),
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date >= $2',
                [req.user.userId, firstDayOfMonth]
            ),
            client.query(
                "SELECT minutes_limit, COALESCE(package,'basic') as package FROM users WHERE id = $1",
                [req.user.userId]
            )
        ]);

        const userPackage    = userLimits.rows[0]?.package || 'basic';
        const pkgLimits      = getPackageLimits(userPackage);
        const dailyMinutes   = parseFloat(dailyUsage.rows[0].total);
        const monthlyMinutes = parseFloat(monthlyUsage.rows[0].total);
        const dailyLimit     = pkgLimits.daily_minutes;
        const monthlyLimit   = pkgLimits.monthly_minutes;

        res.json({
            daily_minutes:           Math.round(dailyMinutes   * 100) / 100,
            monthly_minutes:         Math.round(monthlyMinutes * 100) / 100,
            daily_limit:             dailyLimit,
            monthly_limit:           monthlyLimit,
            remaining_today:         Math.max(0, Math.round((dailyLimit   - dailyMinutes)   * 100) / 100),
            remaining_month:         Math.max(0, Math.round((monthlyLimit - monthlyMinutes) * 100) / 100),
            // legacy fields kept for compatibility
            minutes_limit:           monthlyLimit,
            remaining_minutes:       Math.max(0, Math.round((monthlyLimit - monthlyMinutes) * 100) / 100),
            package:                 userPackage,
            package_label:           pkgLimits.label,
        });
    } catch (err) {
        console.error('Get usage error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.post('/api/user/usage', authenticate, async (req, res) => {
    const { minutes } = req.body;

    if (typeof minutes !== 'number' || minutes <= 0) {
        return res.status(400).json({ error: 'Minuti non validi' });
    }

    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];

        const existing = await client.query(
            'SELECT id, minutes_used FROM usage WHERE user_id = $1 AND date = $2',
            [req.user.userId, today]
        );

        if (existing.rows.length > 0) {
            await client.query(
                'UPDATE usage SET minutes_used = minutes_used + $1 WHERE id = $2',
                [minutes, existing.rows[0].id]
            );
        } else {
            await client.query(
                'INSERT INTO usage (user_id, date, minutes_used) VALUES ($1, $2, $3)',
                [req.user.userId, today, minutes]
            );
        }

        res.json({ message: 'Utilizzo registrato', minutes_added: minutes });
    } catch (err) {
        console.error('Add usage error:', err);
        res.status(500).json({ error: 'Errore registrazione utilizzo' });
    } finally {
        client.release();
    }
});

// ============================================
// CHAT ENDPOINT - ENHANCED WITH LEARNING MATERIALS
// ============================================

app.post('/api/chat', authenticate, async (req, res) => {
    const { message, conversation_history = [], session_type = 'conversation', level, topic, tutor } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Messaggio richiesto' });
    }

    const client = await pool.connect();
    try {
        // Check usage limits — pacchetto + giornaliero + mensile
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [dailyUsageRow, monthlyUsageRow, userRow, studentLevel] = await Promise.all([
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date = $2',
                [req.user.userId, today]
            ),
            client.query(
                'SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE user_id = $1 AND date >= $2',
                [req.user.userId, firstDayOfMonth]
            ),
            client.query(
                "SELECT minutes_limit, COALESCE(package, 'basic') as package FROM users WHERE id = $1",
                [req.user.userId]
            ),
            client.query(
                'SELECT level, topics FROM student_levels WHERE user_id = $1',
                [req.user.userId]
            )
        ]);

        const userPackage   = userRow.rows[0]?.package || 'basic';
        const pkgLimits     = getPackageLimits(userPackage);
        const dailyMinutes  = parseFloat(dailyUsageRow.rows[0].total);
        const monthlyMinutes= parseFloat(monthlyUsageRow.rows[0].total);
        const dailyLimit    = pkgLimits.daily_minutes;
        const monthlyLimit  = pkgLimits.monthly_minutes;

        if (dailyMinutes >= dailyLimit) {
            return res.status(429).json({
                error: 'Limite giornaliero raggiunto',
                error_type: 'daily_limit',
                minutes_used_today: dailyMinutes,
                daily_limit: dailyLimit,
                package: userPackage,
                package_label: pkgLimits.label
            });
        }
        if (monthlyMinutes >= monthlyLimit) {
            return res.status(429).json({
                error: 'Limite mensile raggiunto',
                error_type: 'monthly_limit',
                minutes_used_month: monthlyMinutes,
                monthly_limit: monthlyLimit,
                package: userPackage,
                package_label: pkgLimits.label
            });
        }

        // Get relevant learning materials
        const studentLevelData = studentLevel.rows[0];
        const userLevel = level || studentLevelData?.level || 'A1';
        const userTopic = topic || session_type;

        const materials = await client.query(
            `SELECT title, content, description 
             FROM materials 
             WHERE is_active = true 
             AND (level = $1 OR level IS NULL)
             AND (topic = $2 OR topic IS NULL)
             AND content IS NOT NULL
             LIMIT 5`,
            [userLevel, userTopic]
        );

        // Determina nome tutor — priorità alla scelta esplicita del frontend
        const selectedTutor = tutor || (session_type === 'grammar' ? 'marco' : 'sofia');
        const tutorName  = selectedTutor === 'marco' ? 'Marco' : 'Sofia';
        const tutorStyle = selectedTutor === 'marco'
            ? 'professionale ma amichevole, specializzato in grammatica italiana'
            : 'calorosa e incoraggiante, esperta di conversazione';

        // Build enhanced system prompt (ITALIANO)
        let systemPrompt = `Sei ${tutorName}, un/una tutor di italiano ${tutorStyle}.
Il tuo obiettivo è aiutare studenti stranieri a imparare l'italiano attraverso conversazioni naturali e coinvolgenti.

Livello studente: ${userLevel}
Tipo sessione: ${session_type}
Argomento: ${userTopic}

Comportamenti chiave:
- Parla SEMPRE in italiano, salvo quando lo studente ha bisogno di una spiegazione nella sua lingua
- Correggi gli errori gentilmente e spiega le regole grammaticali in modo chiaro
- Adatta il tuo livello di linguaggio alla competenza dello studente (${userLevel})
- Usa esempi dalla cultura italiana (cucina, arte, storia, tradizioni regionali)
- Incoraggia lo studente a esprimersi di più
- Sii paziente e motivante
- Alla fine di ogni risposta, proponi una breve esercitazione o domanda di pratica

Linee guida per livello:
- A1/A2: Frasi semplici, vocabolario base, presente e passato prossimo
- B1/B2: Espressioni idiomatiche, congiuntivo, condizionale, stile indiretto
- C1/C2: Conversazioni fluide su temi complessi, sfumature stilistiche, registro formale/informale

Materiali didattici disponibili:
${materials.rows.map(m => `- ${m.title}: ${m.description || ''}`).join('\n')}
`;

        if (session_type === 'grammar') {
            systemPrompt += '\nFocalizzati sulla grammatica: spiega le regole con esempi pratici, correggi gli errori e proponi esercizi.';
        } else if (session_type === 'pronunciation') {
            systemPrompt += '\nFocalizzati sulla pronuncia: indica i suoni difficili per anglofoni (es. "gli", "gn", "sc"), suggerisci tecniche di miglioramento.';
        } else if (session_type === 'vocabulary') {
            systemPrompt += '\nFocalizzati sul vocabolario: insegna parole nuove, sinonimi, contrari e il loro uso in contesto.';
        } else {
            systemPrompt += '\nFai conversazione naturale in italiano, correggendo delicatamente gli errori e ampliando il vocabolario.';
        }

        // Add material content as context
        if (materials.rows.length > 0) {
            systemPrompt += '\n\nEstrati dai materiali didattici:\n';
            materials.rows.forEach(m => {
                if (m.content) {
                    const excerpt = m.content.substring(0, 500);
                    systemPrompt += `\n${m.title}:\n${excerpt}...\n`;
                }
            });
        }

        // Istruzione brevità — risposte brevi per TTS fluente
        systemPrompt += '\n\nIMPORTANTE: Rispondi SEMPRE in massimo 3-4 frasi brevi e dirette. Non fare elenchi. Non aggiungere note. Parla come faresti in una conversazione reale, in modo naturale e conciso.';

        // Call Anthropic API
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 400,
                system: systemPrompt,
                messages: [
                    ...conversation_history,
                    { role: 'user', content: message }
                ]
            })
        });

        if (!anthropicResponse.ok) {
            const errorData = await anthropicResponse.text();
            console.error('Anthropic API error:', errorData);
            return res.status(anthropicResponse.status).json({ 
                error: 'Errore API Anthropic',
                details: errorData
            });
        }

        const data = await anthropicResponse.json();

        // Traccia utilizzo API Claude
        const sessionId = req.body.sessionId || `session-${req.user.userId}-${Date.now()}`;
        if (data.usage) {
            await trackApiUsage(pool, req.user.userId, 'claude_input', data.usage.input_tokens, session_type, sessionId);
            await trackApiUsage(pool, req.user.userId, 'claude_output', data.usage.output_tokens, session_type, sessionId);
            await trackConversationSession(pool, req.user.userId, sessionId, session_type, 0);
            console.log(`Tracked API - Input: ${data.usage.input_tokens}, Output: ${data.usage.output_tokens}`);
        }

        const assistantMessage = data.content[0].text;

        // Estimate minutes used
        const wordCount = assistantMessage.split(/\s+/).length;
        const estimatedMinutes = Math.round((wordCount / 150) * 100) / 100;

        // Update usage
        const existing = await client.query(
            'SELECT id, minutes_used FROM usage WHERE user_id = $1 AND date = $2',
            [req.user.userId, today]
        );

        if (existing.rows.length > 0) {
            await client.query(
                'UPDATE usage SET minutes_used = minutes_used + $1 WHERE id = $2',
                [estimatedMinutes, existing.rows[0].id]
            );
        } else {
            await client.query(
                'INSERT INTO usage (user_id, date, minutes_used) VALUES ($1, $2, $3)',
                [req.user.userId, today, estimatedMinutes]
            );
        }

        // Salva messaggi nello storico
        const msgSessionId = sessionId;
        await client.query(
            `INSERT INTO chat_messages (user_id, session_id, tutor, session_type, role, content)
             VALUES ($1,$2,$3,$4,'user',$5)`,
            [req.user.userId, msgSessionId, selectedTutor, session_type, message]
        ).catch(e => console.error('Save user msg error:', e.message));
        await client.query(
            `INSERT INTO chat_messages (user_id, session_id, tutor, session_type, role, content)
             VALUES ($1,$2,$3,$4,'assistant',$5)`,
            [req.user.userId, msgSessionId, selectedTutor, session_type, assistantMessage]
        ).catch(e => console.error('Save assistant msg error:', e.message));

        res.json({
            response: assistantMessage,
            session_id: msgSessionId,
            minutes_used: estimatedMinutes,
            level: userLevel,
            materials_used: materials.rows.map(m => m.title)
        });
    } catch (err) {
        console.error('Chat error:', err);
        res.status(500).json({ error: 'Errore durante la chat' });
    } finally {
        client.release();
    }
});

// ============================================
// TTS SETTINGS MANAGEMENT (Admin)
// ============================================
// Aggiungi questo codice nel server.js dopo l'endpoint /api/tts

// Get TTS settings (Admin only)
app.get('/api/admin/tts-settings', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        // Check if settings exist
        let result = await client.query(
            `SELECT * FROM api_configs WHERE config_key = 'tts_daily_limit'`
        );

        if (result.rows.length === 0) {
            // Create default setting
            await client.query(
                `INSERT INTO api_configs (config_key, config_value, description)
                 VALUES ('tts_daily_limit', '15', 'Daily premium TTS limit per student')
                 RETURNING *`
            );
            result = await client.query(
                `SELECT * FROM api_configs WHERE config_key = 'tts_daily_limit'`
            );
        }

        res.json({
            dailyLimit: parseInt(result.rows[0].config_value),
            description: result.rows[0].description
        });
    } catch (err) {
        console.error('Get TTS settings error:', err);
        res.status(500).json({ error: 'Failed to get TTS settings' });
    } finally {
        client.release();
    }
});

// Update TTS settings (Admin only)
app.put('/api/admin/tts-settings', authenticate, requireAdmin, async (req, res) => {
    const { dailyLimit } = req.body;

    if (!dailyLimit || dailyLimit < 0) {
        return res.status(400).json({ error: 'Invalid daily limit' });
    }

    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO api_configs (config_key, config_value, description)
             VALUES ('tts_daily_limit', $1, 'Daily premium TTS limit per student')
             ON CONFLICT (config_key) 
             DO UPDATE SET config_value = $1, updated_at = NOW()`,
            [dailyLimit.toString()]
        );

        res.json({ 
            success: true, 
            dailyLimit,
            message: 'TTS settings updated successfully' 
        });
    } catch (err) {
        console.error('Update TTS settings error:', err);
        res.status(500).json({ error: 'Failed to update TTS settings' });
    } finally {
        client.release();
    }
});

// Get student's TTS usage for today
app.get('/api/user/tts-usage', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Get daily limit from settings
        const settingsResult = await client.query(
            `SELECT config_value FROM api_configs WHERE config_key = 'tts_daily_limit'`
        );
        const dailyLimit = settingsResult.rows.length > 0 
            ? parseInt(settingsResult.rows[0].config_value) 
            : 200;

        // Get today's usage
        const usageResult = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, today]
        );

        const usedToday = parseInt(usageResult.rows[0].count);
        const remaining = Math.max(0, dailyLimit - usedToday);

        res.json({
            dailyLimit,
            usedToday,
            remaining,
            canUsePremium: remaining > 0
        });
    } catch (err) {
        console.error('Get TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Track TTS usage (chiamata dall'endpoint /api/tts quando genera audio)
async function trackTTSUsage(client, userId) {
    try {
        await client.query(
            `INSERT INTO tts_usage (user_id, created_at) VALUES ($1, NOW())`,
            [userId]
        );
    } catch (err) {
        console.error('Track TTS usage error:', err);
    }
}

// ============================================
// /api/tts — OpenAI TTS (naturale) con fallback Google WaveNet
// ============================================

app.post('/api/tts', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const { text, voiceGender = 'FEMALE' } = req.body;
        const userId = req.user.userId || req.user.id;  // fix: supporta entrambi

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const limitedText = text.trim().substring(0, 4000);

        // ── Voci OpenAI — più naturali in italiano ──────────────────────
        // nova/shimmer = femminile morbida, onyx = maschile profondo
        const isFemale   = voiceGender === 'FEMALE';
        const openaiVoice = isFemale ? 'nova' : 'onyx';

        // ── Voci Google WaveNet — fallback ──────────────────────────────
        const gVoiceName = isFemale ? 'it-IT-Wavenet-A' : 'it-IT-Wavenet-C';
        const gGender    = isFemale ? 'FEMALE' : 'MALE';

        const openaiKey = process.env.OPENAI_API_KEY;
        const googleKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;

        let audioBase64 = null;
        let usedEngine  = null;

        // ── 1. Prova OpenAI TTS HD ───────────────────────────────────────
        if (openaiKey) {
            try {
                const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${openaiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'tts-1-hd',
                        voice: openaiVoice,
                        input: limitedText,
                        speed: 0.92,
                        response_format: 'mp3'
                    })
                });
                if (resp.ok) {
                    const buffer   = await resp.arrayBuffer();
                    audioBase64    = Buffer.from(buffer).toString('base64');
                    usedEngine     = `openai-${openaiVoice}`;
                } else {
                    const err = await resp.json().catch(()=>({}));
                    console.warn('⚠️ OpenAI TTS error:', resp.status, err?.error?.message);
                }
            } catch(e) { console.warn('⚠️ OpenAI TTS exception:', e.message); }
        }

        // ── 2. Fallback Google WaveNet ───────────────────────────────────
        if (!audioBase64 && googleKey) {
            try {
                const resp = await fetch(
                    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            input: { text: limitedText },
                            voice: { languageCode:'it-IT', name: gVoiceName, ssmlGender: gGender },
                            audioConfig: { audioEncoding:'MP3', speakingRate:0.88, sampleRateHertz:24000 }
                        })
                    }
                );
                if (resp.ok) {
                    const data  = await resp.json();
                    audioBase64 = data.audioContent;
                    usedEngine  = `google-${gVoiceName}`;
                } else {
                    console.warn('⚠️ Google TTS error:', resp.status);
                }
            } catch(e) { console.warn('⚠️ Google TTS exception:', e.message); }
        }

        if (!audioBase64) {
            return res.status(500).json({ error: 'TTS non disponibile', fallbackToLocal: true });
        }

        console.log(`✅ TTS OK | engine: ${usedEngine} | chars: ${limitedText.length} | user: ${userId}`);

        // ── Traccia utilizzo ─────────────────────────────────────────────
        await trackTTSUsage(client, userId);
        const sessionIdTTS = req.body.sessionId || `tts-${userId}-${Date.now()}`;
        await trackApiUsage(pool, userId, 'tts', limitedText.length, req.body.sessionType || 'conversation', sessionIdTTS);

        res.json({
            audioContent: audioBase64,
            voiceUsed:    usedEngine,
            voiceType:    usedEngine?.startsWith('openai') ? 'OpenAI HD' : 'Google WaveNet'
        });

    } catch (error) {
        console.error('❌ TTS error:', error.message);
        res.status(500).json({ error: 'TTS error', fallbackToLocal: true });
    } finally {
        client.release();
    }
});


// ============================================
// MATERIALS ROUTES (Admin only)
// ============================================

app.get('/api/admin/materials', authenticate, requireAdmin, async (req, res) => {
    const { level, topic, type } = req.query;
    
    const client = await pool.connect();
    try {
        let query = `
            SELECT m.*, u.name as created_by_name
            FROM materials m
            LEFT JOIN users u ON m.created_by = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 1;

        if (level) {
            query += ` AND level = $${paramCount}`;
            params.push(level);
            paramCount++;
        }

        if (topic) {
            query += ` AND topic = $${paramCount}`;
            params.push(topic);
            paramCount++;
        }

        if (type) {
            query += ` AND type = $${paramCount}`;
            params.push(type);
            paramCount++;
        }

        query += ' ORDER BY created_at DESC';

        const result = await client.query(query, params);
        res.json({ materials: result.rows });
    } catch (err) {
        console.error('Get materials error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

app.post('/api/admin/materials', authenticate, requireAdmin, async (req, res) => {
    const { title, description, type, url, level, topic } = req.body;

    if (!title || !type || !url) {
        return res.status(400).json({ error: 'Titolo, tipo e URL richiesti' });
    }

    const client = await pool.connect();
    try {
        let content = null;
        let metadata = {};

        // Extract content based on type
        if (type === 'youtube' && youtubeClient) {
            try {
                const videoId = extractYouTubeId(url);
                if (videoId) {
                    // Get video details
                    const videoResponse = await youtubeClient.videos.list({
                        part: 'snippet,contentDetails',
                        id: videoId
                    });

                    if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                        const video = videoResponse.data.items[0];
                        metadata = {
                            duration: video.contentDetails.duration,
                            publishedAt: video.snippet.publishedAt,
                            channelTitle: video.snippet.channelTitle
                        };

                        // Try to get captions
                        try {
                            const captionsResponse = await youtubeClient.captions.list({
                                part: 'snippet',
                                videoId: videoId
                            });

                            if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
                                content = `Video: ${video.snippet.title}\n\n${video.snippet.description}`;
                            }
                        } catch (captionErr) {
                            console.log('Captions not available:', captionErr.message);
                            content = `Video: ${video.snippet.title}\n\n${video.snippet.description}`;
                        }
                    }
                }
            } catch (ytErr) {
                console.error('YouTube API error:', ytErr);
            }
        } else if (type === 'google_drive' && driveClient) {
            try {
                const fileId = extractGoogleDriveId(url);
                if (fileId) {
                    // Get file metadata
                    const fileResponse = await driveClient.files.get({
                        fileId: fileId,
                        fields: 'name,mimeType,size,createdTime'
                    });

                    metadata = {
                        mimeType: fileResponse.data.mimeType,
                        size: fileResponse.data.size,
                        createdTime: fileResponse.data.createdTime
                    };

                    // Try to export as text if it's a Google Doc
                    if (fileResponse.data.mimeType === 'application/vnd.google-apps.document') {
                        try {
                            const exportResponse = await driveClient.files.export({
                                fileId: fileId,
                                mimeType: 'text/plain'
                            });
                            content = exportResponse.data;
                        } catch (exportErr) {
                            console.log('Cannot export file:', exportErr.message);
                        }
                    }
                }
            } catch (driveErr) {
                console.error('Google Drive API error:', driveErr);
            }
        }

        const result = await client.query(
            `INSERT INTO materials (title, description, type, url, level, topic, content, metadata, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             RETURNING *`,
            [title, description, type, url, level, topic, content, JSON.stringify(metadata), req.user.userId]
        );

        res.status(201).json({ 
            message: 'Materiale creato con successo',
            material: result.rows[0]
        });
    } catch (err) {
        console.error('Create material error:', err);
        res.status(500).json({ error: 'Errore creazione materiale' });
    } finally {
        client.release();
    }
});

app.put('/api/admin/materials/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, description, level, topic, is_active } = req.body;

    const client = await pool.connect();
    try {
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (title) {
            updates.push(`title = $${paramCount}`);
            values.push(title);
            paramCount++;
        }

        if (description !== undefined) {
            updates.push(`description = $${paramCount}`);
            values.push(description);
            paramCount++;
        }

        if (level) {
            updates.push(`level = $${paramCount}`);
            values.push(level);
            paramCount++;
        }

        if (topic) {
            updates.push(`topic = $${paramCount}`);
            values.push(topic);
            paramCount++;
        }

        if (typeof is_active === 'boolean') {
            updates.push(`is_active = $${paramCount}`);
            values.push(is_active);
            paramCount++;
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);
        
        const query = `UPDATE materials SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        res.json({ message: 'Materiale aggiornato', material: result.rows[0] });
    } catch (err) {
        console.error('Update material error:', err);
        res.status(500).json({ error: 'Errore aggiornamento' });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/materials/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const client = await pool.connect();
    try {
        const result = await client.query('DELETE FROM materials WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Materiale non trovato' });
        }

        res.json({ message: 'Materiale eliminato' });
    } catch (err) {
        console.error('Delete material error:', err);
        res.status(500).json({ error: 'Errore eliminazione' });
    } finally {
        client.release();
    }
});

// ============================================
// STUDENT LEVEL ROUTES
// ============================================

app.put('/api/user/level', authenticate, async (req, res) => {
    const { level, topics, learning_goals } = req.body;

    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO student_levels (user_id, level, topics, learning_goals, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) 
             DO UPDATE SET level = $2, topics = $3, learning_goals = $4, updated_at = NOW()
             RETURNING *`,
            [req.user.userId, level, topics, learning_goals]
        );

        res.json({ message: 'Livello aggiornato', student_level: result.rows[0] });
    } catch (err) {
        console.error('Update level error:', err);
        res.status(500).json({ error: 'Errore aggiornamento livello' });
    } finally {
        client.release();
    }
});

// ============================================
// ADMIN ROUTES (existing + new)
// ============================================

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                u.id, u.email, u.name, u.role, u.minutes_limit,
                COALESCE(u.package,'basic') as package,
                u.created_at, u.last_login,
                COALESCE(SUM(us.minutes_used), 0) as total_minutes_used,
                COALESCE(SUM(CASE WHEN us.date >= date_trunc('month', NOW()) THEN us.minutes_used ELSE 0 END), 0) as monthly_minutes_used,
                sl.level, sl.topics
            FROM users u
            LEFT JOIN usage us ON u.id = us.user_id
            LEFT JOIN student_levels sl ON u.id = sl.user_id
            GROUP BY u.id, sl.level, sl.topics
            ORDER BY u.created_at DESC
        `);

        res.json({ users: result.rows });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});

// PUT /api/admin/users/:id — gestito dall'endpoint completo /:userId più avanti

app.delete('/api/admin/users/:id', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM usage WHERE user_id = $1', [id]);
        await client.query('DELETE FROM student_levels WHERE user_id = $1', [id]);
        await client.query('DELETE FROM practice_sessions WHERE user_id = $1', [id]);
        await client.query('DELETE FROM student_progress WHERE user_id = $1', [id]);
        
        const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        await client.query('COMMIT');
        res.json({ message: 'Utente eliminato' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Errore eliminazione' });
    } finally {
        client.release();
    }
});

// Assegna pacchetto a uno studente
app.put('/api/admin/users/:id/package', authenticate, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { package: pkg } = req.body;
    if (!PACKAGES[pkg]) return res.status(400).json({ error: 'Pacchetto non valido' });
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE users SET package = $1 WHERE id = $2',
            [pkg, id]
        );
        res.json({ success: true, package: pkg, label: PACKAGES[pkg].label });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore server' });
    } finally { client.release(); }
});

// Riepilogo pacchetti disponibili
app.get('/api/admin/packages', authenticate, requireAdmin, (req, res) => {
    const list = Object.entries(PACKAGES).map(([key, val]) => ({
        key, ...val,
        prices: { basic: 9.70, advanced: 16.70, gold: 27.70, unlimited: 0 }[key] || 0
    }));
    res.json({ packages: list });
});

app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            .toISOString().split('T')[0];

        const [totalUsers, activeToday, minutesToday, minutesMonth, totalMaterials] = await Promise.all([
            client.query("SELECT COUNT(*) as count FROM users WHERE role = 'student'"),
            client.query('SELECT COUNT(DISTINCT user_id) as count FROM usage WHERE date = $1', [today]),
            client.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date = $1', [today]),
            client.query('SELECT COALESCE(SUM(minutes_used), 0) as total FROM usage WHERE date >= $1', [firstDayOfMonth]),
            client.query('SELECT COUNT(*) as count FROM materials WHERE is_active = true')
        ]);

        res.json({
            total_users: parseInt(totalUsers.rows[0].count),
            active_today: parseInt(activeToday.rows[0].count),
            minutes_today: Math.round(parseFloat(minutesToday.rows[0].total) * 100) / 100,
            minutes_month: Math.round(parseFloat(minutesMonth.rows[0].total) * 100) / 100,
            total_materials: parseInt(totalMaterials.rows[0].count)
        });
    } catch (err) {
        console.error('Get stats error:', err);
        res.status(500).json({ error: 'Errore server' });
    } finally {
        client.release();
    }
});


// ── DIAGNOSTICA VOCI TTS ─────────────────────────────────────────────
app.get('/api/admin/tts-voices-test', authenticate, requireAdmin, async (req, res) => {
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API Key non configurata' });

    const testText = 'Ciao, sono Sofia. Benvenuto nella piattaforma.';
    const voices = [
        { name: 'it-IT-Studio-C',  gender: 'FEMALE', type: 'Studio'  },
        { name: 'it-IT-Studio-B',  gender: 'MALE',   type: 'Studio'  },
        { name: 'it-IT-Neural2-A', gender: 'FEMALE', type: 'Neural2' },
        { name: 'it-IT-Neural2-C', gender: 'MALE',   type: 'Neural2' },
    ];
    const results = [];
    for (const v of voices) {
        const version  = v.type === 'Studio' ? 'v1beta1' : 'v1';
        try {
            const r = await fetch(
                `https://texttospeech.googleapis.com/${version}/text:synthesize?key=${apiKey}`,
                { method:'POST', headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({
                      input: { text: testText },
                      voice: { languageCode:'it-IT', name:v.name, ssmlGender:v.gender },
                      audioConfig: { audioEncoding:'MP3' }
                  })
                }
            );
            results.push({ voice: v.name, type: v.type, available: r.ok, status: r.status });
        } catch(e) {
            results.push({ voice: v.name, type: v.type, available: false, error: e.message });
        }
    }
    res.json({ results, recommendation: results.find(r => r.available)?.voice || 'nessuna voce disponibile' });
});

// ============================================
// COSTI REALI — Dashboard Costi
// ============================================

const API_PRICES = {
    claude_input:  0.000003,
    claude_output: 0.000015,
    tts:           0.000016,
};

app.get('/api/admin/costs/summary', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const after = req.query.after || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        const now            = new Date();
        const firstThisMonth = new Date(now.getFullYear(), now.getMonth(),     1).toISOString().split('T')[0];
        const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
        const endLastMonth   = new Date(now.getFullYear(), now.getMonth(),     1).toISOString().split('T')[0];

        // 1. Volumi per tipo nel periodo
        const volumeRows = await client.query(
            `SELECT api_type,
                    COALESCE(SUM(units), 0) AS total_units,
                    COUNT(*) AS requests
             FROM api_usage
             WHERE created_at >= $1
             GROUP BY api_type`,
            [after]
        );
        let inputTokens = 0, outputTokens = 0, ttsChars = 0, ttsRequests = 0;
        volumeRows.rows.forEach(r => {
            const u = parseInt(r.total_units) || 0;
            if (r.api_type === 'claude_input')  { inputTokens  = u; }
            if (r.api_type === 'claude_output') { outputTokens = u; }
            if (r.api_type === 'tts')           { ttsChars = u; ttsRequests = parseInt(r.requests) || 0; }
        });

        // 2. Sessioni e studenti unici
        const sessionRow = await client.query(
            `SELECT COUNT(DISTINCT session_id) AS sessions,
                    COUNT(DISTINCT user_id)   AS students
             FROM api_usage
             WHERE created_at >= $1`,
            [after]
        );
        const totalSessions = parseInt(sessionRow.rows[0]?.sessions || 0);
        const totalStudents = parseInt(sessionRow.rows[0]?.students || 0);

        // 3. Trend giornaliero
        const dailyRows = await client.query(
            `SELECT
                DATE(created_at) AS day,
                COALESCE(SUM(CASE WHEN api_type='claude_input'  THEN units * ${API_PRICES.claude_input}  ELSE 0 END), 0) +
                COALESCE(SUM(CASE WHEN api_type='claude_output' THEN units * ${API_PRICES.claude_output} ELSE 0 END), 0) +
                COALESCE(SUM(CASE WHEN api_type='tts'           THEN units * ${API_PRICES.tts}           ELSE 0 END), 0) AS cost
             FROM api_usage
             WHERE created_at >= $1
             GROUP BY DATE(created_at)
             ORDER BY DATE(created_at) ASC`,
            [after]
        );
        const daily_breakdown = dailyRows.rows.map(r => ({
            date: r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day),
            cost: parseFloat(parseFloat(r.cost || 0).toFixed(8))
        }));

        // 4. Top studenti — ORDER BY con espressioni complete (no alias)
        const topStudents = await client.query(
            `SELECT u.name,
                    COALESCE(u.level, 'A1') AS level,
                    COALESCE(SUM(CASE WHEN au.api_type='claude_input'  THEN au.units ELSE 0 END), 0) AS input_tokens,
                    COALESCE(SUM(CASE WHEN au.api_type='claude_output' THEN au.units ELSE 0 END), 0) AS output_tokens,
                    COALESCE(SUM(CASE WHEN au.api_type='tts'           THEN au.units ELSE 0 END), 0) AS tts_chars,
                    COUNT(DISTINCT au.session_id) AS session_count
             FROM api_usage au
             JOIN users u ON au.user_id = u.id
             WHERE au.created_at >= $1
             GROUP BY u.id, u.name, u.level
             ORDER BY
                COALESCE(SUM(CASE WHEN au.api_type='claude_input'  THEN au.units ELSE 0 END), 0) +
                COALESCE(SUM(CASE WHEN au.api_type='claude_output' THEN au.units ELSE 0 END), 0) DESC
             LIMIT 10`,
            [after]
        );
        const top_students = topStudents.rows.map(s => ({
            name:          s.name,
            level:         s.level || 'A1',
            input_tokens:  parseInt(s.input_tokens)  || 0,
            output_tokens: parseInt(s.output_tokens) || 0,
            tts_chars:     parseInt(s.tts_chars)     || 0,
            session_count: parseInt(s.session_count) || 0,
            cost_usd: (
                (parseInt(s.input_tokens)  || 0) * API_PRICES.claude_input  +
                (parseInt(s.output_tokens) || 0) * API_PRICES.claude_output +
                (parseInt(s.tts_chars)     || 0) * API_PRICES.tts
            ).toFixed(6)
        }));

        // 5. Confronto mese corrente vs scorso
        const costQuery = (dateFrom, dateTo) => {
            const params = dateTo ? [dateFrom, dateTo] : [dateFrom];
            const whereClause = dateTo
                ? `WHERE created_at >= $1 AND created_at < $2`
                : `WHERE created_at >= $1`;
            return client.query(
                `SELECT COALESCE(
                    SUM(CASE WHEN api_type='claude_input'  THEN units*${API_PRICES.claude_input}  ELSE 0 END) +
                    SUM(CASE WHEN api_type='claude_output' THEN units*${API_PRICES.claude_output} ELSE 0 END) +
                    SUM(CASE WHEN api_type='tts'           THEN units*${API_PRICES.tts}           ELSE 0 END),
                 0) AS cost FROM api_usage ${whereClause}`,
                params
            );
        };
        const [thisMonthRow, lastMonthRow] = await Promise.all([
            costQuery(firstThisMonth),
            costQuery(firstLastMonth, endLastMonth)
        ]);

        res.json({
            claude_input_tokens:  inputTokens,
            claude_output_tokens: outputTokens,
            tts_characters:       ttsChars,
            tts_requests:         ttsRequests,
            total_sessions:       totalSessions,
            total_students:       totalStudents,
            daily_breakdown,
            top_students,
            cost_this_month: parseFloat(parseFloat(thisMonthRow.rows[0]?.cost || 0).toFixed(8)),
            cost_last_month: parseFloat(parseFloat(lastMonthRow.rows[0]?.cost || 0).toFixed(8)),
            period_start:    after
        });

    } catch (err) {
        console.error('Costs summary error:', err.message, err.stack);
        res.status(500).json({ error: 'Errore nel calcolo dei costi', detail: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function extractGoogleDriveId(url) {
    const regex = /[-\w]{25,}/;
    const match = url.match(regex);
    return match ? match[0] : null;
}

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Italian Learning Platform API - Sofia & Marco 🇮🇹',
        timestamp: new Date().toISOString(),
        features: {
            google_drive: !!driveClient,
            youtube: !!youtubeClient
        }
    });
});

// Get TTS usage for specific user (Admin only)
app.get('/api/admin/users/:userId/tts-usage', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const result = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, date]
        );

        res.json({
            userId: parseInt(userId),
            date,
            count: parseInt(result.rows[0].count)
        });
    } catch (err) {
        console.error('Get user TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Update user (Admin only)
app.put('/api/admin/users/:userId', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const { name, email, role, level, monthly_limit, minutes_limit, package: pkg, password } = req.body;

        // Usa minutes_limit o monthly_limit (il frontend manda monthly_limit)
        const limitValue = minutes_limit ?? monthly_limit;

        let query = 'UPDATE users SET name = $1, email = $2';
        let params = [name, email];
        let p = 2;

        if (role && ['admin','student'].includes(role)) {
            query += `, role = $${++p}`; params.push(role);
        }
        if (level) {
            query += `, level = $${++p}`; params.push(level);
        }
        if (limitValue !== undefined && limitValue !== null) {
            query += `, minutes_limit = $${++p}`; params.push(parseInt(limitValue) || 120);
        }
        if (pkg && ['basic','advanced','gold','unlimited'].includes(pkg)) {
            query += `, package = $${++p}`; params.push(pkg);
        }
        if (password && password.trim()) {
            const hashedPassword = await bcrypt.hash(password.trim(), 10);
            query += `, password_hash = $${++p}`; params.push(hashedPassword);
        }

        query += `, updated_at = NOW() WHERE id = $${++p} RETURNING id, name, email, role, level, minutes_limit, package, created_at`;
        params.push(userId);

        const result = await client.query(query, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Update user error:', err.message);
        res.status(500).json({ error: 'Errore aggiornamento: ' + err.message });
    } finally {
        client.release();
    }
});

// ============================================
// NUOVI ENDPOINT PER TTS TRACKING E USER EDIT
// ============================================
// Aggiungi questi endpoint al file server.js PRIMA di app.listen()

// Get TTS usage for specific user on specific date (Admin only)
app.get('/api/admin/users/:userId/tts-usage', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const { userId } = req.params;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const result = await client.query(
            `SELECT COUNT(*) as count 
             FROM tts_usage 
             WHERE user_id = $1 AND DATE(created_at) = $2`,
            [userId, date]
        );

        res.json({
            userId: parseInt(userId),
            date,
            count: parseInt(result.rows[0].count)
        });
    } catch (err) {
        console.error('Get user TTS usage error:', err);
        res.status(500).json({ error: 'Failed to get TTS usage' });
    } finally {
        client.release();
    }
});

// Update user (Admin only)

// ════════════════════════════════════════════════════════════
// PASSWORD RESET — STUDENTI / ADMIN
// ════════════════════════════════════════════════════════════

// ── RESET PASSWORD — TUTTE LE TIPOLOGIE (pubblico, no auth) ──────────────────
['student','affiliate','admin'].forEach(function(userType) {
    app.post('/api/public/' + userType + '/forgot-password', async (req, res) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email richiesta' });
        try {
            await _sendResetEmail(pool, email, userType);
            res.json({ success: true, message: "Se l'email è registrata riceverai le istruzioni." });
        } catch(err) {
            console.error('[RESET PASSWORD]', userType, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/public/' + userType + '/reset-password', async (req, res) => {
        const { token, password } = req.body;
        if (!token || !password || password.length < 8)
            return res.status(400).json({ error: 'Dati mancanti o password troppo corta (min. 8 caratteri)' });
        try {
            let userId;
            if (userType === 'affiliate') {
                const { rows } = await pool.query(
                    'SELECT affiliate_id FROM affiliate_password_resets WHERE token=$1 AND used=false AND expires_at>NOW()', [token]);
                if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
                const hash = await bcrypt.hash(password, 12);
                await pool.query('UPDATE affiliates SET password_hash=$1 WHERE id=$2', [hash, rows[0].affiliate_id]);
                await pool.query('UPDATE affiliate_password_resets SET used=true WHERE token=$1', [token]);
            } else {
                const { rows } = await pool.query(
                    'SELECT user_id FROM password_resets WHERE token=$1 AND used=false AND expires_at>NOW() AND type=$2',
                    [token, userType]);
                if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
                const hash = await bcrypt.hash(password, 12);
                await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, rows[0].user_id]);
                await pool.query('UPDATE password_resets SET used=true WHERE token=$1', [token]);
            }
            res.json({ success: true });
        } catch(err) { res.status(500).json({ error: err.message }); }
    });
});

// Test SMTP — GET /api/public/test-email (temporaneo, solo per debug)
app.get('/api/public/test-email', async (req, res) => {
    if (!process.env.BREVO_API_KEY) return res.json({ ok:false, error:'BREVO_API_KEY non impostata su Render' });
    try {
        await _brevoSend(NOTIFY_TO, '✅ Test Email SAAM 4.0',
            '<h2 style="color:#009246">✅ Brevo API funziona!</h2><p>Notifiche email attive su SAAM 4.0.</p>');
        res.json({ ok:true, message:'Email di test inviata a '+NOTIFY_TO });
    } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email richiesta' });
    try {
        await emailService.sendPasswordResetStudent(pool, email);
        res.json({ success: true, message: 'Se l\'email è registrata riceverai le istruzioni.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8)
        return res.status(400).json({ error: 'Dati mancanti o password troppo corta' });
    try {
        const { rows } = await pool.query(
            `SELECT user_id FROM password_resets
             WHERE token = $1 AND used = false AND expires_at > NOW()`, [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Link non valido o scaduto' });
        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, rows[0].user_id]);
        await pool.query('UPDATE password_resets SET used = true WHERE token = $1', [token]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================
// START SERVER
// ============================================

// ============================================
// STORICO CONVERSAZIONI
// ============================================

// Sessioni dello studente (lista)
app.get('/api/user/sessions', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const rows = await client.query(
            `SELECT session_id,
                    tutor,
                    session_type,
                    MIN(created_at) AS started_at,
                    MAX(created_at) AS last_message_at,
                    COUNT(*)        AS message_count
             FROM chat_messages
             WHERE user_id = $1
             GROUP BY session_id, tutor, session_type
             ORDER BY MAX(created_at) DESC
             LIMIT 50`,
            [req.user.userId]
        );
        res.json({ sessions: rows.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { client.release(); }
});

// Messaggi di una sessione
app.get('/api/user/sessions/:sessionId/messages', authenticate, async (req, res) => {
    const client = await pool.connect();
    try {
        const rows = await client.query(
            `SELECT id, role, content, created_at
             FROM chat_messages
             WHERE user_id = $1 AND session_id = $2
             ORDER BY created_at ASC`,
            [req.user.userId, req.params.sessionId]
        );
        res.json({ messages: rows.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { client.release(); }
});

// Admin: tutte le sessioni di uno studente
app.get('/api/admin/users/:userId/sessions', authenticate, requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        const rows = await client.query(
            `SELECT session_id, tutor, session_type,
                    MIN(created_at) AS started_at,
                    COUNT(*)        AS message_count
             FROM chat_messages
             WHERE user_id = $1
             GROUP BY session_id, tutor, session_type
             ORDER BY MIN(created_at) DESC`,
            [req.params.userId]
        );
        res.json({ sessions: rows.rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
    finally { client.release(); }
});


app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`🗄️ Database: PostgreSQL (italian_learning_db)`);
    console.log(`🇮🇹 Tutor: Sofia (it-IT-Neural2-A) & Marco (it-IT-Neural2-C)`);
});
