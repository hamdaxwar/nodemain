const fs = require('fs');
const axios = require('axios');
const path = require('path');
const config = require('./config');
const { state } = require('./helpers/state');

let smsLoop = null;

const WAIT_TIMEOUT_SECONDS = 1800; 
const EXTENDED_WAIT_SECONDS = 300;

function loadJson(filename, defaultVal = []) {
    if (fs.existsSync(filename)) {
        try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (e) { return defaultVal; }
    }
    return defaultVal;
}

function saveJson(filename, data) {
    try { fs.writeFileSync(filename, JSON.stringify(data, null, 2)); } catch (e) { }
}

function updateProfileOtp(userId) {
    const profiles = loadJson(config.FILES.PROFILE, {});
    const strId = String(userId);
    const today = new Date().toISOString().split('T')[0];

    if (!profiles[strId]) {
        profiles[strId] = { name: "User", balance: 0.0, otp_semua: 0, otp_hari_ini: 0, last_active: today };
    }
    const p = profiles[strId];
    if (p.last_active !== today) { p.otp_hari_ini = 0; p.last_active = today; }

    const oldBal = p.balance || 0.0;
    p.otp_semua = (p.otp_semua || 0) + 1;
    p.otp_hari_ini = (p.otp_hari_ini || 0) + 1;
    p.balance = oldBal + config.OTP_PRICE;

    saveJson(config.FILES.PROFILE, profiles);
    return { old: oldBal, new: p.balance };
}

async function tgApi(method, data) {
    try {
        await axios.post(`${config.API_URL}/${method}`, data, { timeout: 10000 });
    } catch (e) {}
}

async function checkAndForward() {
    const waitList = loadJson(config.FILES.WAIT, []);
    if (waitList.length === 0) return;

    let smsData = loadJson(config.FILES.SMC, []);
    if (!Array.isArray(smsData)) smsData = [];

    let newWaitList = [];
    const currentTime = Date.now() / 1000;
    let smsChanged = false;

    for (const waitItem of waitList) {
        const waitNum = String(waitItem.number);
        const userId = waitItem.user_id;
        const startTs = waitItem.timestamp || 0;
        const otpRecTime = waitItem.otp_received_time;

        if (otpRecTime) {
            if (currentTime - otpRecTime <= EXTENDED_WAIT_SECONDS) newWaitList.push(waitItem);
            continue;
        }

        if (currentTime - startTs > WAIT_TIMEOUT_SECONDS) {
            await tgApi("sendMessage", {
                chat_id: userId,
                text: `⚠️ <b>Waktu Habis</b>\nNomor <code>${waitNum}</code> dihapus.`,
                parse_mode: "HTML"
            });
            continue;
        }

        let targetSmsIndex = -1;
        for (let i = 0; i < smsData.length; i++) {
            const sms = smsData[i];
            const smsNum = String(sms.number || sms.Number || "");
            if (smsNum === waitNum) { targetSmsIndex = i; break; }
        }

        if (targetSmsIndex !== -1) {
            const sms = smsData[targetSmsIndex];
            smsData.splice(targetSmsIndex, 1);
            smsChanged = true;

            const otp = sms.otp || "N/A";
            const svc = sms.service || "Unknown";
            const raw = (sms.full_message || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            let balTxt = "";
            if (svc.toLowerCase().includes("whatsapp")) {
                balTxt = "<i>WhatsApp OTP no balance</i>";
            } else {
                const bal = updateProfileOtp(userId);
                balTxt = `$${bal.old.toFixed(6)} > $${bal.new.toFixed(6)}`;
            }

            const msgBody = `🔔 <b>New Message Detected</b>\n\n` +
                            `☎️ <b>Nomor:</b> <code>${waitNum}</code>\n` +
                            `⚙️ <b>Service:</b> <b>${svc}</b>\n\n` +
                            `💰 <b>Added:</b> ${balTxt}\n\n` +
                            `🗯️ <b>Full Message:</b>\n<blockquote>${raw}</blockquote>\n\n` +
                            `⚡ <b>Tap the Button To Copy OTP</b> ⚡`;

            const kb = { inline_keyboard: [[{ text: ` ${otp}`, copy_text: { text: otp } }, { text: "💸 Donate", url: "https://t.me/" }]] };
            await tgApi("sendMessage", { chat_id: userId, text: msgBody, reply_markup: kb, parse_mode: "HTML" });

            waitItem.otp_received_time = currentTime;
            newWaitList.push(waitItem);
        } else {
            newWaitList.push(waitItem);
        }
    }

    if (smsChanged) saveJson(config.FILES.SMC, smsData);
    saveJson(config.FILES.WAIT, newWaitList);
}

// --- Module Controls ---
function start() {
    if (smsLoop) return;
    console.log("🚀 [SMS DISTRIBUTOR] Module Started.");
    smsLoop = setInterval(async () => {
        if (!state.isBotRunning) { stop(); return; }
        await checkAndForward();
    }, 2000);
}

function stop() {
    if (smsLoop) {
        clearInterval(smsLoop);
        smsLoop = null;
        console.log("🛑 [SMS DISTRIBUTOR] Module Stopped.");
    }
}

module.exports = { start, stop };

