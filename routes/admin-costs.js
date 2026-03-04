// ============================================
// ADMIN COSTS ROUTES
// ============================================
// File: routes/admin-costs.js
//
// IMPORTANTE: Questo file crea l'endpoint /api/admin/costs
// che la Dashboard Costi usa per ottenere i dati

const express = require('express');
const router = express.Router();

/**
 * GET /api/admin/costs
 * Ottiene statistiche dei costi per la dashboard admin
 * Query params:
 *   - period: 'current', 'last', '7days', '30days'
 */
function createCostsRoute(pool, authenticate, requireAdmin) {
    router.get('/api/admin/costs', authenticate, requireAdmin, async (req, res) => {
        const client = await pool.connect();
        try {
            const period = req.query.period || 'current';
            let startDate, endDate;

            // Determina il periodo in base al parametro
            const now = new Date();
            
            if (period === 'current') {
                // Mese corrente
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = now;
            } else if (period === 'last') {
                // Mese scorso
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            } else if (period === '7days') {
                // Ultimi 7 giorni
                startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                endDate = now;
            } else if (period === '30days') {
                // Ultimi 30 giorni
                startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                endDate = now;
            } else {
                return res.status(400).json({ error: 'Invalid period parameter' });
            }

            console.log(`📊 Loading costs data for period: ${period} (${startDate.toISOString()} to ${endDate.toISOString()})`);

            // Query 1: Totali per servizio
            const totalsQuery = await client.query(`
                SELECT 
                    service,
                    SUM(units_used) as total_units,
                    SUM(cost_usd) as total_cost,
                    COUNT(*) as request_count
                FROM api_usage
                WHERE created_at BETWEEN $1 AND $2
                GROUP BY service
            `, [startDate, endDate]);

            // Query 2: Statistiche sessioni
            const sessionsQuery = await client.query(`
                SELECT 
                    COUNT(DISTINCT session_id) as total_sessions,
                    COALESCE(SUM(duration_minutes), 0) as total_minutes,
                    COUNT(*) as total_messages
                FROM conversations
                WHERE created_at BETWEEN $1 AND $2
            `, [startDate, endDate]);

            // Query 3: Numero studenti
            const studentsQuery = await client.query(`
                SELECT COUNT(*) as total_students
                FROM users
                WHERE role = 'student'
            `);

            // Query 4: Costi giornalieri ultimi 7 giorni
            const dailyCostsQuery = await client.query(`
                SELECT 
                    date,
                    SUM(CASE WHEN service = 'claude_input' THEN cost_usd ELSE 0 END) as claude_input,
                    SUM(CASE WHEN service = 'claude_output' THEN cost_usd ELSE 0 END) as claude_output,
                    SUM(CASE WHEN service = 'tts' THEN cost_usd ELSE 0 END) as tts
                FROM api_usage
                WHERE date >= CURRENT_DATE - INTERVAL '7 days'
                GROUP BY date
                ORDER BY date DESC
                LIMIT 7
            `);

            // Query 5: Costo mese precedente (per confronto)
            const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            
            const previousMonthQuery = await client.query(`
                SELECT 
                    COALESCE(SUM(cost_usd), 0) as total_cost
                FROM api_usage
                WHERE created_at BETWEEN $1 AND $2
            `, [lastMonthStart, lastMonthEnd]);

            // Prepara la risposta
            const response = {
                claudeInputTokens: 0,
                claudeOutputTokens: 0,
                ttsCharacters: 0,
                totalSessions: parseInt(sessionsQuery.rows[0]?.total_sessions || 0),
                totalMinutes: parseFloat(sessionsQuery.rows[0]?.total_minutes || 0),
                totalMessages: parseInt(sessionsQuery.rows[0]?.total_messages || 0),
                totalStudents: parseInt(studentsQuery.rows[0]?.total_students || 0),
                previousMonthCost: parseFloat(previousMonthQuery.rows[0]?.total_cost || 0),
                dailyCosts: dailyCostsQuery.rows.map(row => ({
                    date: row.date.toISOString().split('T')[0],
                    claudeInput: parseFloat(row.claude_input || 0),
                    claudeOutput: parseFloat(row.claude_output || 0),
                    tts: parseFloat(row.tts || 0)
                })),
                period: period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            };

            // Popola i totali dai risultati
            totalsQuery.rows.forEach(row => {
                if (row.service === 'claude_input') {
                    response.claudeInputTokens = parseInt(row.total_units || 0);
                } else if (row.service === 'claude_output') {
                    response.claudeOutputTokens = parseInt(row.total_units || 0);
                } else if (row.service === 'tts') {
                    response.ttsCharacters = parseInt(row.total_units || 0);
                }
            });

            console.log(`✅ Costs data loaded successfully:`, {
                claudeInputTokens: response.claudeInputTokens,
                claudeOutputTokens: response.claudeOutputTokens,
                ttsCharacters: response.ttsCharacters,
                totalSessions: response.totalSessions
            });

            res.json(response);

        } catch (error) {
            console.error('❌ Error loading costs data:', error);
            res.status(500).json({ 
                error: 'Internal server error',
                message: error.message 
            });
        } finally {
            client.release();
        }
    });

    return router;
}

module.exports = createCostsRoute;
