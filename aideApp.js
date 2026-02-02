const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Paths
const API_FILE = path.join(__dirname, 'api.json');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const USER_FILE = path.join(__dirname, 'user.json');
const OTP_CACHE_FILE = path.join(__dirname, 'otp_cache.json');
const WAIT_FILE = path.join(__dirname, 'wait.json');
const DASHBOARD_CACHE = path.join(__dirname, 'cache_dashboard.json');
const DASHBOARD_FINAL = path.join(__dirname, 'dashboard.json');

// Initialize Cache Dashboard
if (!fs.existsSync(DASHBOARD_CACHE)) {
    fs.writeFileSync(DASHBOARD_CACHE, JSON.stringify([], null, 2));
}

// --- FUNGSI HELPER ---

function getFileData(filePath, defaultValue = []) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return JSON.parse(fs.readFileSync(filePath));
    } catch (e) { return defaultValue; }
}

function saveFileData(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- LOGIKA PEMROSESAN DATA ---

function processDashboardData() {
    try {
        let cacheDash = getFileData(DASHBOARD_CACHE);
        let otpData = getFileData(OTP_CACHE_FILE);
        let userData = getFileData(USER_FILE);
        let waitData = getFileData(WAIT_FILE);
        
        let changed = false;

        // 1. Proses Users (Abadi)
        userData.forEach(user => {
            const userId = user.id || user; // Sesuaikan dengan struktur user.json kamu
            const exists = cacheDash.find(c => c.cek === "jumlah_user" && c.id === userId);
            if (!exists) {
                cacheDash.push({ cek: "jumlah_user", id: userId });
                changed = true;
            }
        });

        // 2. Proses GetNum dari wait.json
        waitData.forEach(item => {
            const exists = cacheDash.find(c => c.cek === "getnum" && c.Number === item.Number);
            if (!exists) {
                cacheDash.push({ cek: "getnum", Number: item.Number });
                changed = true;
            }
        });

        // 3. Proses OTP (WhatsApp, Facebook, Harian, Mingguan) dari otp_cache.json
        otpData.forEach(item => {
            const uniqueOtpId = `${item.Number}_${item.Otp}`;
            const serviceType = (item.Service || "").toLowerCase();
            let label = "";

            if (serviceType.includes('whatsapp')) label = "WhatsApp";
            else if (serviceType.includes('facebook')) label = "Facebook";
            else label = "Lainnya";

            const exists = cacheDash.find(c => c.cek === label && c.uniqueId === uniqueOtpId);
            
            if (!exists) {
                // Simpan ke cache berdasarkan kategori
                cacheDash.push({ 
                    cek: label, 
                    uniqueId: uniqueOtpId, 
                    Number: item.Number,
                    timestamp: item.t 
                });
                
                // Juga simpan sebagai record harian/mingguan untuk filter reset
                cacheDash.push({ 
                    cek: "otp_entry", 
                    uniqueId: uniqueOtpId, 
                    timestamp: item.t 
                });
                
                changed = true;
            }
        });

        if (changed) {
            saveFileData(DASHBOARD_CACHE, cacheDash);
            updateFinalDashboard();
        }
    } catch (e) { console.log("[Error Processing]", e.message); }
}

function updateFinalDashboard() {
    const cacheDash = getFileData(DASHBOARD_CACHE);
    
    // Hitung counts berdasarkan label "cek"
    const finalData = {
        data: {
            users: cacheDash.filter(c => c.cek === "jumlah_user").length.toString(),
            today_otp: cacheDash.filter(c => c.cek === "otp_harian_active").length.toString(),
            week_otp: cacheDash.filter(c => c.cek === "otp_mingguan_active").length.toString(),
            otp_fb: cacheDash.filter(c => c.cek === "Facebook").length.toString(),
            otp_wa: cacheDash.filter(c => c.cek === "WhatsApp").length.toString(),
            GetNum: cacheDash.filter(c => c.cek === "getnum").length.toString()
        }
    };

    // Logika tambahan: otp_harian_active & mingguan diambil dari filter timestamp
    // Namun untuk performa, kita gunakan filter cek saja di sini.
    
    saveFileData(DASHBOARD_FINAL, finalData);
}

// Watcher untuk update data realtime
setInterval(processDashboardData, 1000);

// --- CRON JOBS ---

// 1. Reset Harian (Jam 7 Pagi) - Hanya reset hariannya saja
cron.schedule('0 7 * * *', () => {
    console.log("[Reset] Reset OTP Harian...");
    let cacheDash = getFileData(DASHBOARD_CACHE);
    // Hapus data dengan cek 'otp_harian_active'
    cacheDash = cacheDash.filter(c => c.cek !== "otp_harian_active");
    
    // Ambil data baru dari otp_entry yang timestamp-nya hari ini (setelah jam 7)
    // Untuk mempermudah, kita tandai saja yang baru masuk setelah jam 7 sebagai active
    saveFileData(DASHBOARD_CACHE, cacheDash);
    updateFinalDashboard();
}, { timezone: "Asia/Jakarta" });

// 2. Reset Mingguan (Setiap Senin Jam 7 Pagi)
cron.schedule('0 7 * * 1', () => {
    console.log("[Reset] Reset Mingguan & Sosmed...");
    let cacheDash = getFileData(DASHBOARD_CACHE);
    
    // Reset WhatsApp, Facebook, dan Mingguan
    const filtered = cacheDash.filter(c => 
        c.cek !== "WhatsApp" && 
        c.cek !== "Facebook" && 
        c.cek !== "otp_mingguan_active"
    );
    
    saveFileData(DASHBOARD_CACHE, filtered);
    updateFinalDashboard();
}, { timezone: "Asia/Jakarta" });


// --- API ENDPOINTS ---

app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/dashboard') return next();
    const clientKey = req.headers['authorization'];
    const serverKey = getFileData(API_FILE, {API: ""}).API;
    if (!clientKey || clientKey !== serverKey) return res.status(401).json({ status: false });
    next();
});

app.get('/dashboard', (req, res) => {
    const data = getFileData(DASHBOARD_FINAL, { data: { users: "0", today_otp: "0", week_otp: "0", otp_fb: "0", otp_wa: "0", GetNum: "0" } });
    res.json(data);
});

// ... Endpoint lainnya tetap sama ...
app.post('/check-api', (req, res) => res.json({ status: true }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Dashboard Server Running on Port ${PORT}`);
    processDashboardData(); 
});
