const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ngrok = require('ngrok'); // Import ngrok
const config = require('./config');
const db = require('./helpers/database');
const { state } = require('./helpers/state');

const app = express();
const PORT = 3000; // Kembali ke 3000 tidak apa-apa karena ngrok yang akan urus

app.use(cors());
app.use(bodyParser.json());

const API_FILE = path.join(__dirname, 'api.json');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

app.use((req, res, next) => {
    if (req.path === '/') return res.send("<h1>Zura Bot API Server Running via Ngrok</h1>");
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

// ... (Endpoints post check-api, save-config, dashboard, action tetap sama seperti sebelumnya) ...
app.post('/check-api', (req, res) => res.json({ status: true, message: "Connected" }));

app.post('/save-config', (req, res) => {
    const newConfig = req.body;
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        res.json({ status: true, message: "Config saved. Please restart bot." });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

app.get('/get-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) res.json(JSON.parse(fs.readFileSync(CONFIG_FILE)));
    else res.json({});
});

app.get('/dashboard', (req, res) => {
    const stats = (db.getDashboardStats) ? db.getDashboardStats() : {};
    res.json({
        status: true,
        data: {
            users: stats.user_count || 0,
            total_otp: stats.total_otp || 0,
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
        res.json({ status: true, message: "Action " + action + " executed" });
    } catch (e) { res.status(500).json({ status: false, message: e.message }); }
});

async function startServer() {
    app.listen(PORT, async () => {
        console.log(`[API] Local Server listening on port ${PORT}`);
        
        try {
            // Menyalakan tunnel ngrok
            // Jika kamu punya authtoken ngrok, masukkan: await ngrok.authtoken('TOKEN_MU');
            const url = await ngrok.connect(PORT);
            
            console.log("========================================");
            console.log("🚀 SERVER DASHBOARD ONLINE (NGROK)");
            console.log(`🔗 URL: ${url}`);
            console.log("========================================");
            console.log("Salin URL di atas ke Aplikasi Android kamu.");
        } catch (err) {
            console.error("[NGROK ERROR] Gagal menyalakan tunnel:", err.message);
        }
    });
}

module.exports = { startServer };
