const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

// Load Env
dotenv.config();

// ================= Konfigurasi Global =================
const CONFIG_FILE = "bot_config.json";
const botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const BOT_TOKEN = botConfig.BOT_TOKEN_GETNUM; 
const ADMIN_ID = botConfig.ADMIN_ID; // Mengambil ID Admin dari config
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const WAIT_TIMEOUT_SECONDS = parseInt(process.env.WAIT_TIMEOUT_SECONDS || "1800");
const EXTENDED_WAIT_SECONDS = 300;
const OTP_REWARD_PRICE = 0.003500;

const SMC_FILE = "smc.json";
const WAIT_FILE = "wait.json";
const PROFILE_FILE = "profile.json";
const SETTINGS_FILE = "settings.json";
const DONATE_LINK = "https://zurastore.my.id/donate/";

let offset = 0; // Untuk tracking pesan masuk

// ================= Fungsi Utilitas =================

function normalize(phone) {
    if (!phone) return "";
    return String(phone).replace(/[^\d]/g, '');
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function loadJson(filename, defaultVal = []) {
    if (fs.existsSync(filename)) {
        try {
            return JSON.parse(fs.readFileSync(filename, 'utf8'));
        } catch (e) { return defaultVal; }
    }
    return defaultVal;
}

function saveJson(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } catch (e) { console.error(`[ERROR] Gagal simpan ${filename}:`, e.message); }
}

async function tgApi(method, data) {
    try {
        const response = await axios.post(`${API}/${method}`, data, { timeout: 10000 });
        return response.data;
    } catch (e) {
        if (e.response && e.response.status === 429) {
            const retryAfter = (e.response.data.parameters?.retry_after || 5) * 1000;
            await new Promise(r => setTimeout(r, retryAfter));
            return tgApi(method, data);
        }
        return null;
    }
}

// ================= Handler Command Admin =================

async function handleCommands() {
    const updates = await tgApi("getUpdates", { offset: offset, timeout: 10 });
    if (!updates || !updates.result) return;

    for (const update of updates.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = String(msg.chat.id);
        const text = msg.text.toLowerCase();

        // Hanya Admin yang boleh akses
        if (chatId !== String(ADMIN_ID)) continue;

        if (text === "/onbalance") {
            saveJson(SETTINGS_FILE, { balance_enabled: true });
            await tgApi("sendMessage", { chat_id: chatId, text: "✅ <b>Sistem Balance DIAKTIFKAN</b>", parse_mode: "HTML" });
        } 
        else if (text === "/offbalance") {
            saveJson(SETTINGS_FILE, { balance_enabled: false });
            await tgApi("sendMessage", { chat_id: chatId, text: "❌ <b>Sistem Balance DINONAKTIFKAN</b>", parse_mode: "HTML" });
        }
    }
}

// ================= Logika Utama Monitor =================

function updateProfileOtp(userId) {
    const profiles = loadJson(PROFILE_FILE, {});
    const strId = String(userId);
    const today = new Date().toISOString().split('T')[0];

    if (!profiles[strId]) {
        profiles[strId] = { name: "User", balance: 0.0, otp_semua: 0, otp_hari_ini: 0, last_active: today };
    }

    const p = profiles[strId];
    if (p.last_active !== today) {
        p.otp_hari_ini = 0;
        p.last_active = today;
    }

    const oldBal = p.balance || 0.0;
    p.otp_semua = (p.otp_semua || 0) + 1;
    p.otp_hari_ini = (p.otp_hari_ini || 0) + 1;
    p.balance = oldBal + OTP_REWARD_PRICE;

    saveJson(PROFILE_FILE, profiles);
    return { old: oldBal, new: p.balance };
}

async function checkAndForward() {
    const globalSettings = loadJson(SETTINGS_FILE, { balance_enabled: true });
    const waitList = loadJson(WAIT_FILE, []);
    if (waitList.length === 0) return;

    let smsData = loadJson(SMC_FILE, []);
    if (!Array.isArray(smsData)) smsData = [];

    let newWaitList = [];
    const currentTime = Date.now() / 1000;
    let smsChanged = false;

    for (const waitItem of waitList) {
        const waitNumClean = normalize(waitItem.number);
        const userId = waitItem.user_id;
        const startTs = waitItem.timestamp || 0;
        const otpRecTime = waitItem.otp_received_time;

        if (otpRecTime) {
            if (currentTime - otpRecTime > EXTENDED_WAIT_SECONDS) continue;
            newWaitList.push(waitItem);
            continue;
        }

        if (currentTime - startTs > WAIT_TIMEOUT_SECONDS) {
            await tgApi("sendMessage", { chat_id: userId, text: `⚠️ <b>Waktu Habis</b>\nNomor <code>${waitItem.number}</code> dihapus.`, parse_mode: "HTML" });
            continue;
        }

        let targetSmsIndex = -1;
        for (let i = 0; i < smsData.length; i++) {
            const smsNumClean = normalize(smsData[i].number || smsData[i].Number);
            if (smsNumClean === waitNumClean || smsNumClean.endsWith(waitNumClean) || waitNumClean.endsWith(smsNumClean)) {
                targetSmsIndex = i;
                break;
            }
        }

        if (targetSmsIndex !== -1) {
            const sms = smsData[targetSmsIndex];
            smsData.splice(targetSmsIndex, 1);
            smsChanged = true;

            const otp = sms.otp || sms.OTP || "N/A";
            const svc = sms.service || "Unknown";
            const raw = escapeHtml(sms.full_message || sms.FullMessage || "");

            let balTxt = "";
            if (!globalSettings.balance_enabled) {
                balTxt = "<b>Balance Sedang Nonaktif</b>";
            } else if (svc.toLowerCase().includes("whatsapp")) {
                balTxt = "<i>WhatsApp OTP (No Reward)</i>";
            } else {
                const bal = updateProfileOtp(userId);
                balTxt = `$${bal.old.toFixed(6)} > $${bal.new.toFixed(6)}`;
            }

            const msgBody = `🔔 <b>Pesan OTP Terdeteksi</b>\n\n☎️ <b>Nomor:</b> <code>${waitItem.number}</code>\n⚙️ <b>Service:</b> <b>${svc}</b>\n\n💰 <b>Added:</b> ${balTxt}\n\n🗯️ <b>Full Message:</b>\n<blockquote>${raw}</blockquote>`;
            const kb = { inline_keyboard: [[{ text: ` ${otp}`, copy_text: { text: otp } }, { text: "💸 Donate", url: DONATE_LINK }]] };

            const success = await tgApi("sendMessage", { chat_id: userId, text: msgBody, reply_markup: kb, parse_mode: "HTML" });
            if (success) waitItem.otp_received_time = currentTime;
            newWaitList.push(waitItem);
        } else {
            newWaitList.push(waitItem);
        }
    }

    if (smsChanged) saveJson(SMC_FILE, smsData);
    saveJson(WAIT_FILE, newWaitList);
}

// ================= Loop Utama =================

async function start() {
    console.log("========================================");
    console.log(`[STARTED] SMS Forwarder & Admin Cmd`);
    console.log(`[ADMIN ID] ${ADMIN_ID}`);
    console.log("========================================");
    
    if (fs.existsSync(SMC_FILE)) saveJson(SMC_FILE, []);

    while (true) {
        try {
            await handleCommands(); // Cek command /onbalance atau /offbalance
            await checkAndForward(); // Cek SMS
        } catch (e) {
            console.error(`[LOOP ERROR]`, e.message);
        }
        await new Promise(r => setTimeout(r, 2000)); // Jeda 2 detik
    }
}

start();
