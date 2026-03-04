# 🇮🇹 Italian Learning Platform

Piattaforma AI per l'apprendimento della lingua italiana tramite conversazioni con tutor virtuali Sofia e Marco.

## 🎯 Caratteristiche

- 🤖 **Tutor AI intelligenti**: Sofia (conversazione) & Marco (grammatica)
- 🗣️ **Text-to-Speech italiano**: Voci Neural2 di Google Cloud (`it-IT-Neural2-A` / `it-IT-Neural2-C`)
- 📚 **Materiali didattici**: Integrazione con Google Drive e YouTube
- 💰 **Tracking costi**: Dashboard completa per monitorare spese API
- 👤 **Gestione studenti**: Sistema livelli A1→C2, limiti minuti, reportistica
- 🔐 **Auth sicura**: JWT + bcrypt

## 🏗️ Stack Tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Backend | Node.js + Express |
| Database | PostgreSQL |
| AI | Claude Sonnet (Anthropic) |
| TTS | Google Cloud Text-to-Speech |
| Deploy | Render |

## 📦 Setup Locale

```bash
# 1. Clona il repository
git clone https://github.com/saam40ac/italian-learning-platform.git
cd italian-learning-platform

# 2. Installa dipendenze
npm install

# 3. Configura variabili ambiente
cp .env.example .env
# Modifica .env con le tue credenziali

# 4. Avvia il server
npm run dev
```

## ⚙️ Variabili Ambiente

```env
DB_HOST=...
DB_PORT=5432
DB_NAME=italian_learning_db
DB_USER=...
DB_PASSWORD=...
JWT_SECRET=<stringa-casuale-lunga>
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_TTS_API_KEY=...
GOOGLE_API_KEY=...
```

## 🗄️ Database

Usa lo stesso file `01-database-setup.sql` del progetto inglese. Le tabelle sono identiche.

### Materiali di esempio

Inserisci materiali italiani con:
```sql
INSERT INTO materials (title, content, level, category, created_at)
VALUES ('Al Bar', '...dialogo...', 'A1', 'Conversazione', NOW());
```

## 🎤 Voci TTS

| Tutor | Voce Google | Tipo sessione |
|-------|-------------|---------------|
| Sofia | `it-IT-Neural2-A` | Conversazione (default) |
| Marco | `it-IT-Neural2-C` | Grammatica |

## 🌐 API Endpoints

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login studente |
| POST | `/api/auth/register` | Registrazione |
| POST | `/api/chat` | Chat con tutor AI |
| POST | `/api/tts` | Text-to-Speech italiano |
| GET | `/api/user/profile` | Profilo studente |
| GET | `/api/admin/stats` | Statistiche admin |

## 🎨 Branding

- **Verde**: `#009246` (bandiera italiana)  
- **Bianco**: `#FFFFFF`  
- **Rosso**: `#CE2B37` (bandiera italiana)

## 🔗 Progetti Correlati

- 🇬🇧 [Voice Agent Learning (Inglese)](https://github.com/saam40ac/voice-agent-learning)

---

Buon apprendimento! 🇮🇹🚀
