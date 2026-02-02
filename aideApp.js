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
const CACHE_DASHBOARD = path.join(__dirname, 'cache_dashboard.json');
const DASHBOARD_FINAL = path.join(__dirname, 'dashboard.json');

// ================= INIT CACHE DASHBOARD =================
if (!fs.existsSync(CACHE_DASHBOARD)) {
  fs.writeFileSync(CACHE_DASHBOARD, JSON.stringify([], null, 2));
}

// ================= UTIL =================
function readJSON(file, def) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file));
  } catch {
    return def;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ================= CACHE CHECK =================
function isDuplicate(cache, cek, key) {
  return cache.some(item => item.cek === cek && item.key === key);
}

function addCache(cache, cek, key, extra = {}) {
  cache.push({ cek, key, ...extra });
}

// ================= MAIN LOGIC =================
function updateDashboardFromOtpCache() {
  let cache = readJSON(CACHE_DASHBOARD, []);

  const otpCache = readJSON(OTP_CACHE_FILE, []);
  const users = readJSON(USER_FILE, []);
  const waitData = readJSON(WAIT_FILE, []);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfDay - 7 * 24 * 60 * 60 * 1000;

  let todayOtp = 0;
  let weekOtp = 0;
  let otpFb = 0;
  let otpWa = 0;
  let getNum = 0;
  let userCount = 0;

  // ===== OTP CACHE PROCESS =====
  otpCache.forEach(item => {
    const number = item.Number;
    const otp = item.Otp || item.otp;
    const service = item.Service || "";
    const time = new Date(item.t).getTime();

    const uniqueKey = `${number}_${otp}_${service}`;

    // OTP HARIAN
    if (time >= startOfDay) {
      if (!isDuplicate(cache, "otp_harian", uniqueKey)) {
        todayOtp++;
        addCache(cache, "otp_harian", uniqueKey, { Number: number, Otp: otp });
      }
    }

    // OTP MINGGUAN
    if (time >= startOfWeek) {
      if (!isDuplicate(cache, "otp_mingguan", uniqueKey)) {
        weekOtp++;
        addCache(cache, "otp_mingguan", uniqueKey, { Number: number, Otp: otp });
      }
    }

    // OTP FACEBOOK
    if (service.toLowerCase().includes("facebook")) {
      if (!isDuplicate(cache, "Facebook", number)) {
        otpFb++;
        addCache(cache, "Facebook", number, { Number: number, Service: "Facebook" });
      }
    }

    // OTP WHATSAPP
    if (service.toLowerCase().includes("whatsapp")) {
      if (!isDuplicate(cache, "WhatsApp", number)) {
        otpWa++;
        addCache(cache, "WhatsApp", number, { Number: number, Service: "WhatsApp" });
      }
    }
  });

  // ===== GETNUM PROCESS =====
  waitData.forEach(item => {
    const number = item.Number || item.number;
    if (number && !isDuplicate(cache, "getnum", number)) {
      getNum++;
      addCache(cache, "getnum", number, { Number: number });
    }
  });

  // ===== USER PROCESS =====
  users.forEach(u => {
    const id = u.id || u.ID || u;
    if (id && !isDuplicate(cache, "jumlah_user", id)) {
      userCount++;
      addCache(cache, "jumlah_user", id, { id_user: id });
    }
  });

  writeJSON(CACHE_DASHBOARD, cache);

  const finalData = {
    status: global.BOT_STATUS || "stop",
    data: {
      users: userCount.toString(),
      today_otp: todayOtp.toString(),
      week_otp: weekOtp.toString(),
      otp_fb: otpFb.toString(),
      otp_wa: otpWa.toString(),
      GetNum: getNum.toString()
    }
  };

  writeJSON(DASHBOARD_FINAL, finalData);
}

// ================= RESET LOGIC =================

// Reset OTP HARIAN jam 7 WIB
cron.schedule('0 7 * * *', () => {
  let cache = readJSON(CACHE_DASHBOARD, []);
  cache = cache.filter(item => item.cek !== "otp_harian");
  writeJSON(CACHE_DASHBOARD, cache);
  updateDashboardFromOtpCache();
}, { timezone: "Asia/Jakarta" });

// Reset OTP MINGGUAN tiap 7 hari
cron.schedule('0 7 */7 * *', () => {
  let cache = readJSON(CACHE_DASHBOARD, []);
  cache = cache.filter(item => !["otp_mingguan", "Facebook", "WhatsApp"].includes(item.cek));
  writeJSON(CACHE_DASHBOARD, cache);
  updateDashboardFromOtpCache();
}, { timezone: "Asia/Jakarta" });

// ================= WATCHER OTP CACHE =================
setInterval(updateDashboardFromOtpCache, 1000);

// ================= AUTH MIDDLEWARE =================
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/dataref') return next();
  const clientKey = req.headers['authorization'];
  let serverKey = "";
  if (fs.existsSync(API_FILE)) {
    try {
      serverKey = JSON.parse(fs.readFileSync(API_FILE)).API;
    } catch {}
  }
  if (!clientKey || clientKey !== serverKey) {
    return res.status(401).json({ status: false });
  }
  next();
});

// ================= API =================

// refresh data from apk
app.get('/dataref', (req, res) => {
  updateDashboardFromOtpCache();
  const dashboard = readJSON(DASHBOARD_FINAL, {});
  const config = readJSON(CONFIG_FILE, {});
  res.json({ dashboard, config });
});

app.get('/dashboard', (req, res) => {
  updateDashboardFromOtpCache();
  res.json(readJSON(DASHBOARD_FINAL, {}));
});

app.post('/check-api', (req, res) => res.json({ status: true }));

app.post('/save-config', (req, res) => {
  writeJSON(CONFIG_FILE, req.body);
  res.json({ status: true });
});

app.get('/get-config', (req, res) => {
  res.json(readJSON(CONFIG_FILE, {}));
});

app.post('/action', async (req, res) => {
  const { action } = req.body;
  const main = require('./main');

  try {
    if (action === 'stop') {
      await main.stopBot();
      global.BOT_STATUS = "stop";
    } else if (action === 'start') {
      await main.startBot();
      global.BOT_STATUS = "running";
    } else if (action === 'refresh') {
      await main.restartBot();
      global.BOT_STATUS = "running";
    }

    updateDashboardFromOtpCache();
    res.json({ status: true });
  } catch (e) {
    res.status(500).json({ status: false });
  }
});

// ================= START SERVER =================
app.listen(PORT, '0.0.0.0', () => {
  global.BOT_STATUS = "running";
  console.log(`[API] Server Running on Port ${PORT}`);
  updateDashboardFromOtpCache();
});
