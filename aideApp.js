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
const SMC_FILE = path.join(__dirname, 'smc.json');
const CACHE_FILE = path.join(__dirname, 'cache.json');
const WAIT_FILE = path.join(__dirname, 'wait.json');

const DASHBOARD_CACHE = path.join(__dirname, 'cache_dashboard.json');
const DASHBOARD_FINAL = path.join(__dirname, 'dashboard.json');

// Initialize Dashboard Cache if not exists
if (!fs.existsSync(DASHBOARD_CACHE)) {
    fs.writeFileSync(DASHBOARD_CACHE, JSON.stringify({
        today_otp: 0,
        week_otp: 0,
        otp_fb: 0,
        otp_wa: 0,
        getnum: 0,
        jumlah_user: 0,
        processed: [] // untuk menghindari duplikat
    }, null, 2));
}

// --- HELPERS ---
function readJson(filePath, defaultValue) {
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        return JSON.parse(fs.readFileSync(filePath));
    } catch (e) {
        return defaultValue;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function uniqueKey(obj) {
    // key untuk cek duplikat sesuai "cek" nya
    const cek = obj.cek;
    if (cek === "otp_harian" || cek === "otp_mingguan") {
        return `${cek}_${obj.Number}_${obj.Otp}`;
    }
    if (cek === "WhatsApp" || cek === "Facebook") {
        return `${cek}_${obj.Number}_${obj.Service}`;
    }
    if (cek === "getnum") {
        return `${cek}_${obj.Number}`;
    }
    if (cek === "jumlah_user") {
        return `${cek}_${obj.id_user}`;
    }
    return JSON.stringify(obj);
}

// --- LOGIKA UPDATE DASHBOARD.JSON ---
function updateFinalDashboard(status = "stopped") {
    try {
        const dashCache = readJson(DASHBOARD_CACHE, {
            today_otp: 0,
            week_otp: 0,
            otp_fb: 0,
            otp_wa: 0,
            getnum: 0,
            jumlah_user: 0,
            processed: []
        });

        const users = readJson(USER_FILE, []).length;
        const finalData = {
            data: {
                users: users.toString(),
                today_otp: dashCache.today_otp.toString(),
                week_otp: dashCache.week_otp.toString(),
                otp_fb: dashCache.otp_fb.toString(),
                otp_wa: dashCache.otp_wa.toString(),
                GetNum: dashCache.getnum.toString(),
                bot_status: status
            }
        };

        writeJson(DASHBOARD_FINAL, finalData);
    } catch (e) {
        console.log("[Error Update Dashboard]", e.message);
    }
}

// --- LOGIKA PEMBACA OTP CACHE ---
function processOtpCache() {
    try {
        const otpCache = readJson(OTP_CACHE_FILE, []);
        let dash = readJson(DASHBOARD_CACHE, {
            today_otp: 0,
            week_otp: 0,
            otp_fb: 0,
            otp_wa: 0,
            getnum: 0,
            jumlah_user: 0,
            processed: []
        });

        let changed = false;

        otpCache.forEach(item => {
            const service = (item.Service || "").toLowerCase();
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const startOfWeek = startOfDay - (7 * 24 * 60 * 60 * 1000);

            // OTP HARIAN
            if (item.t && new Date(item.t).getTime() >= startOfDay) {
                const obj = {
                    cek: "otp_harian",
                    Number: item.Number,
                    Otp: item.Otp
                };
                const key = uniqueKey(obj);
                if (!dash.processed.includes(key)) {
                    dash.today_otp++;
                    dash.processed.push(key);
                    changed = true;
                }
            }

            // OTP MINGGUAN
            if (item.t && new Date(item.t).getTime() >= startOfWeek) {
                const obj = {
                    cek: "otp_mingguan",
                    Number: item.Number,
                    Otp: item.Otp
                };
                const key = uniqueKey(obj);
                if (!dash.processed.includes(key)) {
                    dash.week_otp++;
                    dash.processed.push(key);
                    changed = true;
                }
            }

            // OTP WHATSAPP
            if (service.includes("whatsapp")) {
                const obj = {
                    cek: "WhatsApp",
                    Number: item.Number,
                    Service: "WhatsApp"
                };
                const key = uniqueKey(obj);
                if (!dash.processed.includes(key)) {
                    dash.otp_wa++;
                    dash.processed.push(key);
                    changed = true;
                }
            }

            // OTP FACEBOOK
            if (service.includes("facebook")) {
                const obj = {
                    cek: "Facebook",
                    Number: item.Number,
                    Service: "Facebook"
                };
                const key = uniqueKey(obj);
                if (!dash.processed.includes(key)) {
                    dash.otp_fb++;
                    dash.processed.push(key);
                    changed = true;
                }
            }
        });

        // Batasi array agar tidak bengkak (simpan 5000 ID terakhir saja)
        if (dash.processed.length > 5000) {
            dash.processed = dash.processed.slice(dash.processed.length - 5000);
        }

        if (changed) {
            writeJson(DASHBOARD_CACHE, dash);
            updateFinalDashboard();
        }
    } catch (e) {
        console.log("[Error Process OTP Cache]", e.message);
    }
}

// --- LOGIKA GETNUM dari wait.json ---
function processWait() {
    try {
        const wait = readJson(WAIT_FILE, []);
        let dash = readJson(DASHBOARD_CACHE, {
            today_otp: 0,
            week_otp: 0,
            otp_fb: 0,
            otp_wa: 0,
            getnum: 0,
            jumlah_user: 0,
            processed: []
        });

        let changed = false;

        wait.forEach(item => {
            if (!item.Number) return;

            const obj = {
                cek: "getnum",
                Number: item.Number
            };
            const key = uniqueKey(obj);
            if (!dash.processed.includes(key)) {
                dash.getnum++;
                dash.processed.push(key);
                changed = true;
            }
        });

        if (changed) {
            writeJson(DASHBOARD_CACHE, dash);
            updateFinalDashboard();
        }
    } catch (e) {
        console.log("[Error Process Wait]", e.message);
    }
}

// --- LOGIKA JUMLAH USER dari user.json ---
function processUser() {
    try {
        const users = readJson(USER_FILE, []);
        let dash = readJson(DASHBOARD_CACHE, {
            today_otp: 0,
            week_otp: 0,
            otp_fb: 0,
            otp_wa: 0,
            getnum: 0,
            jumlah_user: 0,
            processed: []
        });

        let changed = false;

        users.forEach(u => {
            if (!u.id_user) return;

            const obj = {
                cek: "jumlah_user",
                id_user: u.id_user
            };
            const key = uniqueKey(obj);
            if (!dash.processed.includes(key)) {
                dash.jumlah_user++;
                dash.processed.push(key);
                changed = true;
            }
        });

        if (changed) {
            writeJson(DASHBOARD_CACHE, dash);
            updateFinalDashboard();
        }
    } catch (e) {
        console.log("[Error Process User]", e.message);
    }
}

// --- CRON JOB RESET ---
cron.schedule('0 7 * * *', () => {
    console.log("[Reset Harian] jam 7 pagi WIB...");
    let dash = readJson(DASHBOARD_CACHE, {
        today_otp: 0,
        week_otp: 0,
        otp_fb: 0,
        otp_wa: 0,
        getnum: 0,
        jumlah_user: 0,
        processed: []
    });

    // Reset harian
    dash.today_otp = 0;

    // Hanya hapus processed yang berkaitan dengan otp_harian
    dash.processed = dash.processed.filter(k => !k.startsWith("otp_harian_"));

    writeJson(DASHBOARD_CACHE, dash);
    updateFinalDashboard();
}, { timezone: "Asia/Jakarta" });

// Reset mingguan (setiap 7 hari sekali)
cron.schedule('0 7 * * 0', () => {
    console.log("[Reset Mingguan] Minggu jam 7 pagi WIB...");
    let dash = readJson(DASHBOARD_CACHE, {
        today_otp: 0,
        week_otp: 0,
        otp_fb: 0,
        otp_wa: 0,
        getnum: 0,
        jumlah_user: 0,
        processed: []
    });

    dash.week_otp = 0;
    dash.otp_fb = 0;
    dash.otp_wa = 0;

    dash.processed = dash.processed.filter(k => {
        return !k.startsWith("otp_mingguan_") &&
               !k.startsWith("WhatsApp_") &&
               !k.startsWith("Facebook_");
    });

    writeJson(DASHBOARD_CACHE, dash);
    updateFinalDashboard();
}, { timezone: "Asia/Jakarta" });

// --- RUN PROCESS PERIODIC ---
setInterval(processOtpCache, 500);
setInterval(processWait, 1000);
setInterval(processUser, 5000);

// --- AUTH MIDDLEWARE ---
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

// --- API ENDPOINTS ---
app.get('/dashboard', (req, res) => {
    if (fs.existsSync(DASHBOARD_FINAL)) {
        res.json(JSON.parse(fs.readFileSync(DASHBOARD_FINAL)));
    } else {
        updateFinalDashboard();
        res.json({ data: { users: "0", today_otp: "0", week_otp: "0", otp_fb: "0", otp_wa: "0", GetNum: "0", bot_status: "stopped" } });
    }
});

app.post('/check-api', (req, res) => res.json({ status: true }));

app.post('/save-config', (req, res) => {
    writeJson(CONFIG_FILE, req.body);
    res.json({ status: true });
});

app.get('/get-config', (req, res) => {
    const data = readJson(CONFIG_FILE, {});
    res.json(data);
});

app.post('/action', async (req, res) => {
    const { action } = req.body;
    const main = require('./main');

    try {
        if (action === 'stop') {
            await main.stopBot();
            updateFinalDashboard("stopped");
        }
        else if (action === 'start') {
            await main.startBot();
            updateFinalDashboard("running");
        }
        else if (action === 'refresh') {
            await main.restartBot();
            updateFinalDashboard("restarting");
        }

        res.json({ status: true });
    } catch (e) {
        res.status(500).json({ status: false });
    }
});

// --- /dataref endpoint ---
app.get('/dataref', (req, res) => {
    updateFinalDashboard();
    const dashboard = readJson(DASHBOARD_FINAL, { data: {} });
    const config = readJson(CONFIG_FILE, {});
    res.json({ status: true, dashboard, config });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Server Running on Port ${PORT}`);
    updateFinalDashboard("stopped");
});
