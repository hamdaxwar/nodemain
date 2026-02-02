const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./helpers/database');
const { state } = require('./helpers/state');

const app = express();
const PORT = 3000; 

app.use(cors());
app.use(bodyParser.json());

const API_FILE = path.join(__dirname, 'api.json');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

app.get('/', (req, res) => res.send("<h1>Zura Bot API Server Online</h1><p>Gunakan URL Ngrok yang aktif di CMD.</p>"));

// Middleware Cek API Key
app.use((req, res, next) => {
    if (req.path === '/') return next();
    const clientKey = req.headers['authorization'] || req.body.api_key;
    let serverKey = "";
    if (fs.existsSync(API_FILE)) {
        try { serverKey = JSON.parse(fs.readFileSync(API_FILE)).API; } catch (e) {}
    }
    if (!clientKey || clientKey !== serverKey) {
        return res.status(401).json({ status: false, message: "Unauthorized: Invalid API Key" });
    }
    next();
});

// --- Endpoints ---
app.post('/check-api', (req, res) => res.json({ status: true, message: "Connected" }));

app.post('/save-config', (req, res) => {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
        res.json({ status: true, message: "Config saved." });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

app.get('/get-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try { res.json(JSON.parse(fs.readFileSync(CONFIG_FILE))); } catch(e) { res.json({}); }
    } else { res.json({}); }
});

app.get('/dashboard', (req, res) => {
    const stats = (db.getDashboardStats) ? db.getDashboardStats() : {};
    res.json({
        status: true,
        data: {
            users: stats.user_count || 0,
            bot_status: (state && state.isBotRunning) ? "ONLINE" : "OFFLINE",
            status_text: (state && state.statusText) ? state.statusText : "Idle"
        }
    });
});

app.post('/action', async (req, res) => {
    const action = req.body.action;
    const main = require('./main');
    try {
        if (action === 'stop') await main.stopBot();
        else if (action === 'start') await main.startBot();
        else if (action === 'refresh') await main.restartBot();
        res.json({ status: true, message: "Action " + action + " success" });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

function startServer() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[API] Server Dashboard internal aktif di port ${PORT}`);
        console.log(`[TIPS] Jika port diblokir, jalankan 'ngrok http ${PORT}' di CMD terpisah.`);
    });
}

module.exports = { startServer };
