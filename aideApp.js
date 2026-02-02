const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron'); // Pastikan install: npm install node-cron

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Paths
const API_FILE = path.join(__dirname, 'api.json');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const USER_FILE = path.join(__dirname, 'user.json');
const OTP_CACHE_FILE = path.join(__dirname, 'otp_cache.json');
const SMC_FILE = path.join(__dirname, 'smc.json');
const CACHE_FILE = path.join(__dirname, 'cache.json');
const DASHBOARD_CACHE = path.join(__dirname, 'cache_dashboard.json');
const DASHBOARD_FINAL = path.join(__dirname, 'dashboard.json');

// Initialize Dashboard Cache if not exists
if (!fs.existsSync(DASHBOARD_CACHE)) {
    fs.writeFileSync(DASHBOARD_CACHE, JSON.stringify({
        today_otp: 0,
        otp_fb: 0,
        otp_wa: 0,
        processed_ids: [] // Untuk mencegah duplikat dari smc.json
    }, null, 2));
}

// --- LOGIKA PENANGKAP DATA REALTIME (SMC.JSON) ---
// Fungsi ini harus dipanggil sesering mungkin atau via watcher
function trackSmcData() {
    try {
        if (!fs.existsSync(SMC_FILE)) return;
        const smc = JSON.parse(fs.readFileSync(SMC_FILE));
        let dash = JSON.parse(fs.readFileSync(DASHBOARD_CACHE));
        let changed = false;

        smc.forEach(item => {
            // Gunakan kombinasi Number + OTP sebagai ID unik agar tidak duplikat
            const uniqueId = `${item.Number}_${item.otp}`;
            if (!dash.processed_ids.includes(uniqueId)) {
                dash.today_otp++;
                const service = (item.Service || "").toLowerCase();
                if (service.includes('whatsapp')) dash.otp_wa++;
                if (service.includes('facebook')) dash.otp_fb++;
                
                dash.processed_ids.push(uniqueId);
                // Batasi array agar tidak bengkak (simpan 1000 ID terakhir saja)
                if (dash.processed_ids.length > 1000) dash.processed_ids.shift();
                changed = true;
            }
        });

        if (changed) {
            fs.writeFileSync(DASHBOARD_CACHE, JSON.stringify(dash, null, 2));
            updateFinalDashboard();
        }
    } catch (e) { console.log("[Error Track SMC]", e.message); }
}

// Watcher: Cek smc.json setiap 500ms agar lebih cepat dari script penghapus
setInterval(trackSmcData, 500);

// --- LOGIKA UPDATE DASHBOARD.JSON ---
function updateFinalDashboard() {
    try {
        const users = fs.existsSync(USER_FILE) ? JSON.parse(fs.readFileSync(USER_FILE)).length : 0;
        const otpCache = fs.existsSync(OTP_CACHE_FILE) ? JSON.parse(fs.readFileSync(OTP_CACHE_FILE)) : {};
        const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE)) : [];
        const dashCache = JSON.parse(fs.readFileSync(DASHBOARD_CACHE));

        // Hitung total OTP hari ini dari otp_cache.json (berdasarkan timestamp hari ini)
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfWeek = startOfDay - (7 * 24 * 60 * 60 * 1000);

        let weekCount = 0;
        Object.values(otpCache).forEach(val => {
            const t = new Date(val.t).getTime();
            if (t >= startOfWeek) weekCount++;
        });

        const finalData = {
            data: {
                users: users.toString(),
                today_otp: dashCache.today_otp.toString(),
                week_otp: weekCount.toString(),
                otp_fb: dashCache.otp_fb.toString(),
                otp_wa: dashCache.otp_wa.toString(),
                GetNum: cache.length.toString()
            }
        };

        fs.writeFileSync(DASHBOARD_FINAL, JSON.stringify(finalData, null, 2));
    } catch (e) { console.log("[Error Update Dashboard]", e.message); }
}

// --- CRON JOB: RESET JAM 7 PAGI WIB ---
// '0 7 * * *' = Setiap hari jam 07:00
// Pakai timezone Jakarta
cron.schedule('0 7 * * *', () => {
    console.log("[Reset] Pembersihan harian jam 7 pagi...");
    const emptyDash = {
        today_otp: 0,
        otp_fb: 0,
        otp_wa: 0,
        processed_ids: []
    };
    fs.writeFileSync(DASHBOARD_CACHE, JSON.stringify(emptyDash, null, 2));
    updateFinalDashboard();
}, {
    timezone: "Asia/Jakarta"
});

// --- API ENDPOINTS ---

// Auth Middleware (Sesuai script lama)
app.use((req, res, next) => {
    if (req.path === '/') return next();
    const clientKey = req.headers['authorization'];
    let serverKey = "";
    if (fs.existsSync(API_FILE)) {
        try { serverKey = JSON.parse(fs.readFileSync(API_FILE)).API; } catch (e) {}
    }
    if (!clientKey || clientKey !== serverKey) {
        return res.status(401).json({ status: false });
    }
    next();
});

app.get('/dashboard', (req, res) => {
    if (fs.existsSync(DASHBOARD_FINAL)) {
        res.json(JSON.parse(fs.readFileSync(DASHBOARD_FINAL)));
    } else {
        updateFinalDashboard();
        res.json({ data: { users: "0", today_otp: "0", week_otp: "0", otp_fb: "0", otp_wa: "0", GetNum: "0" } });
    }
});

app.post('/check-api', (req, res) => res.json({ status: true }));

app.post('/save-config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    res.json({ status: true });
});

app.get('/get-config', (req, res) => {
    const data = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE)) : {};
    res.json(data);
});

app.post('/action', async (req, res) => {
    const { action } = req.body;
    const main = require('./main');
    try {
        if (action === 'stop') await main.stopBot();
        else if (action === 'start') await main.startBot();
        else if (action === 'refresh') await main.restartBot();
        res.json({ status: true });
    } catch (e) { res.status(500).json({ status: false }); }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server Running on Port ${PORT}`);
    updateFinalDashboard(); // Initial build
});
