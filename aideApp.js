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

// --- Middleware Cek API Key ---
app.use((req, res, next) => {
    // Skip cek untuk endpoint root atau health check jika perlu
    if (req.path === '/') return res.send("Zura Bot API Server Running");

    const clientKey = req.headers['authorization'] || req.body.api_key;
    
    let serverKey = "";
    if (fs.existsSync(API_FILE)) {
        try {
            serverKey = JSON.parse(fs.readFileSync(API_FILE)).API;
        } catch (e) {}
    }

    if (!clientKey || clientKey !== serverKey) {
        return res.status(401).json({ status: false, message: "Unauthorized: Invalid API Key" });
    }
    next();
});

// --- Endpoints ---

// 1. Cek Koneksi & API Key
app.post('/check-api', (req, res) => {
    res.json({ status: true, message: "Connected" });
});

// 2. Simpan Konfigurasi
app.post('/save-config', (req, res) => {
    const newConfig = req.body;
    // Validasi dasar
    if (!newConfig.BOT_TOKEN || !newConfig.EMAIL) {
        return res.status(400).json({ status: false, message: "Data config tidak lengkap" });
    }

    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        res.json({ status: true, message: "Config saved. Please restart bot." });
    } catch (e) {
        res.status(500).json({ status: false, message: "Failed to save config: " + e.message });
    }
});

// 3. Ambil Konfigurasi (Untuk ditampilkan di form edit app)
app.get('/get-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        res.json(JSON.parse(fs.readFileSync(CONFIG_FILE)));
    } else {
        res.json({});
    }
});

// 4. Dashboard Stats
app.get('/dashboard', (req, res) => {
    const stats = db.getDashboardStats();
    res.json({
        status: true,
        data: {
            users: stats.user_count,
            total_otp: stats.total_otp,
            today_otp: stats.today_otp,
            otp_fb: stats.otp_fb,
            otp_wa: stats.otp_wa,
            bot_status: state.isBotRunning ? "ONLINE" : "OFFLINE",
            status_text: state.statusText
        }
    });
});

// 5. Bot Actions (Start, Stop, Restart)
app.post('/action', async (req, res) => {
    const action = req.body.action; // 'start', 'stop', 'refresh'
    const main = require('./main'); // Lazy load main to access exported functions

    try {
        if (action === 'stop') {
            await main.stopBot();
            res.json({ status: true, message: "Bot Stopped" });
        } else if (action === 'start') {
            await main.startBot();
            res.json({ status: true, message: "Bot Started" });
        } else if (action === 'refresh') {
            await main.restartBot();
            res.json({ status: true, message: "Bot Restarted (Config Reloaded)" });
        } else {
            res.status(400).json({ status: false, message: "Unknown action" });
        }
    } catch (e) {
        res.status(500).json({ status: false, message: "Error: " + e.message });
    }
});

function startServer() {
    app.listen(PORT, () => {
        console.log(`[API] Aide App Server listening on port ${PORT}`);
    });
}

module.exports = { startServer };

