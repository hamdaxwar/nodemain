const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./helpers/database');
const { state } = require('./helpers/state');

const app = express();

/**
 * PORT diubah ke 80 karena Port 3000 diblokir oleh provider RDP Anda.
 * Port 80 adalah standar HTTP yang biasanya terbuka secara default.
 */
const PORT = 80;

app.use(cors());
app.use(bodyParser.json());

const API_FILE = path.join(__dirname, 'api.json');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

// --- Middleware Cek API Key ---
app.use((req, res, next) => {
    // Memberikan tampilan jika dibuka langsung di browser HP
    if (req.path === '/') return res.send("<h1>Zura Bot API Server Running</h1><p>Status: Online (Port 80)</p>");

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

// 3. Ambil Konfigurasi
app.get('/get-config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            res.json(JSON.parse(fs.readFileSync(CONFIG_FILE)));
        } catch(e) { res.json({}); }
    } else {
        res.json({});
    }
});

// 4. Dashboard Stats
app.get('/dashboard', (req, res) => {
    // Pastikan fungsi ini ada di database helper Anda
    const stats = (db.getDashboardStats) ? db.getDashboardStats() : { user_count: 0, total_otp: 0 };
    res.json({
        status: true,
        data: {
            users: stats.user_count || 0,
            total_otp: stats.total_otp || 0,
            today_otp: stats.today_otp || 0,
            otp_fb: stats.otp_fb || 0,
            otp_wa: stats.otp_wa || 0,
            bot_status: (state && state.isBotRunning) ? "ONLINE" : "OFFLINE",
            status_text: (state && state.statusText) ? state.statusText : "Unknown"
        }
    });
});

// 5. Bot Actions (Start, Stop, Restart)
app.post('/action', async (req, res) => {
    const action = req.body.action; 
    const main = require('./main'); 

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
    /**
     * Penting: Menggunakan '0.0.0.0' agar server mendengarkan permintaan 
     * dari luar jaringan (Internet), bukan hanya localhost.
     */
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[API] Aide App Server listening on port ${PORT}`);
    });
}

module.exports = { startServer };
