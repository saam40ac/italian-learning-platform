// ============================================
// API USAGE TRACKING UTILITY
// ============================================
// File: utils/tracking.js
// 
// IMPORTANTE: Questo file traccia l'utilizzo di Claude API e Google TTS
// calcolando i costi con margine del 50% per budget safety

// Prezzi con MARGINE DEL 50% per budget safety
// Prezzi base: Claude Input $3, Output $15, TTS $16
// Con margine 50%: Input $4.50, Output $22.50, TTS $24
const PRICING = {
    claudeInputPerMToken: 4.50,    // $3 * 1.5 = $4.50 per 1M input tokens
    claudeOutputPerMToken: 22.50,  // $15 * 1.5 = $22.50 per 1M output tokens
    ttsPerMChars: 24.00,           // $16 * 1.5 = $24 per 1M chars (Google Neural2)
};

/**
 * Traccia l'utilizzo delle API e calcola i costi
 * @param {Object} pool - PostgreSQL pool connection
 * @param {Number} userId - ID dell'utente
 * @param {String} service - Tipo servizio: 'claude_input', 'claude_output', 'tts'
 * @param {Number} unitsUsed - Numero di token o caratteri utilizzati
 * @param {String} sessionType - Tipo di sessione (opzionale) es: 'conversation', 'grammar'
 * @param {String} sessionId - ID della sessione (opzionale)
 */
async function trackApiUsage(pool, userId, service, unitsUsed, sessionType = null, sessionId = null) {
    // Validazione input
    if (!userId || !service || !unitsUsed || unitsUsed <= 0) {
        console.warn('⚠️ Invalid tracking data:', { userId, service, unitsUsed });
        return { success: false, error: 'Invalid input data' };
    }

    try {
        // Calcola costo in base al servizio
        let costUsd = 0;
        
        if (service === 'claude_input') {
            costUsd = (unitsUsed / 1000000) * PRICING.claudeInputPerMToken;
        } else if (service === 'claude_output') {
            costUsd = (unitsUsed / 1000000) * PRICING.claudeOutputPerMToken;
        } else if (service === 'tts') {
            costUsd = (unitsUsed / 1000000) * PRICING.ttsPerMChars;
        } else {
            console.warn('⚠️ Unknown service type:', service);
            return { success: false, error: 'Unknown service type' };
        }

        // Salva nel database
        await pool.query(`
            INSERT INTO api_usage (user_id, service, units_used, cost_usd, session_type, session_id, created_at, date)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), CURRENT_DATE)
        `, [userId, service, unitsUsed, costUsd, sessionType, sessionId]);

        console.log(`✅ Tracked ${service}: ${formatNumber(unitsUsed)} units, $${costUsd.toFixed(4)} for user ${userId}`);
        
        return { success: true, costUsd };
    } catch (error) {
        console.error('❌ Error tracking API usage:', error);
        // Non bloccare la richiesta se il tracking fallisce
        return { success: false, error: error.message };
    }
}

/**
 * Crea o aggiorna una sessione di conversazione
 * @param {Object} pool - PostgreSQL pool connection
 * @param {Number} userId - ID dell'utente
 * @param {String} sessionId - ID della sessione
 * @param {String} sessionType - Tipo di sessione
 * @param {Number} durationMinutes - Durata in minuti (opzionale)
 */
async function trackConversationSession(pool, userId, sessionId, sessionType, durationMinutes = 0) {
    try {
        // Controlla se la sessione esiste già
        const existing = await pool.query(
            'SELECT id, message_count, duration_minutes FROM conversations WHERE session_id = $1',
            [sessionId]
        );

        if (existing.rows.length > 0) {
            // Aggiorna sessione esistente
            await pool.query(`
                UPDATE conversations 
                SET message_count = message_count + 1,
                    duration_minutes = duration_minutes + $1,
                    updated_at = NOW()
                WHERE session_id = $2
            `, [durationMinutes, sessionId]);
            
            console.log(`✅ Updated session ${sessionId}`);
        } else {
            // Crea nuova sessione
            await pool.query(`
                INSERT INTO conversations (user_id, session_id, session_type, duration_minutes, message_count, created_at)
                VALUES ($1, $2, $3, $4, 1, NOW())
            `, [userId, sessionId, sessionType, durationMinutes]);
            
            console.log(`✅ Created new session ${sessionId}`);
        }

        return { success: true };
    } catch (error) {
        console.error('❌ Error tracking conversation session:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Formatta numero con separatori di migliaia
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Ottieni statistiche di utilizzo per un periodo
 */
async function getUsageStats(pool, startDate, endDate, userId = null) {
    try {
        let query = `
            SELECT 
                service,
                SUM(units_used) as total_units,
                SUM(cost_usd) as total_cost,
                COUNT(*) as request_count
            FROM api_usage
            WHERE created_at BETWEEN $1 AND $2
        `;
        
        const params = [startDate, endDate];
        
        if (userId) {
            query += ' AND user_id = $3';
            params.push(userId);
        }
        
        query += ' GROUP BY service';
        
        const result = await pool.query(query, params);
        
        return {
            success: true,
            stats: result.rows
        };
    } catch (error) {
        console.error('❌ Error getting usage stats:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    trackApiUsage,
    trackConversationSession,
    getUsageStats,
    PRICING
};
