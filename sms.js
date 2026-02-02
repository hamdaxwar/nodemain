const fs = require('fs');
const axios = require('axios');
const path = require('path');
const config = require('./config'); 
const { state } = require('./helpers/state'); 

let smsLoop = null;

const WAIT_TIMEOUT_SECONDS = 1800; 
const EXTENDED_WAIT_SECONDS = 300;
const DELETE_DELAY_MS = 2000; // Jeda 2 detik sebelum hapus dari smc.json

// --- Helper JSON ---
function loadJson(filename, defaultVal = []) {
    if (fs.existsSync(filename)) {
        try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (e) { return defaultVal; }
    }
    return defaultVal;
}

function saveJson(filename, data) {
    try { fs.writeFileSync(filename, JSON.stringify(data, null, 2)); } catch (e) { }
}

/**
 * Update Profile & Balance menggunakan harga dari state
 */
function updateProfileOtp(userId) {
    const profiles = loadJson(state.FILES.PROFILE, {});
    const strId = String(userId);
    const today = new Date().toISOString().split('T')[0];

    if (!profiles[strId]) {
        profiles[strId] = { 
            name: "User", 
            balance: 0.0, 
            otp_semua: 0, 
            otp_hari_ini: 0, 
            last_active: today 
        };
    }
    const p = profiles[strId];
    if (p.last_active !== today) { p.otp_hari_ini = 0; p.last_active = today; }

    const oldBal = parseFloat(p.balance || 0.0);
    const otpPrice = parseFloat(state.OTP_PRICE || 0.003500);
    
    p.otp_semua = (p.otp_semua || 0) + 1;
    p.otp_hari_ini = (p.otp_hari_ini || 0) + 1;
    p.balance = oldBal + otpPrice;

    saveJson(state.FILES.PROFILE, profiles);
    return { old: oldBal, new: p.balance };
}

/**
 * Telegram API menggunakan Token Utama dari Ingatan Sesi (state)
 */
async function tgApi(method, data) {
    try {
        // Menggunakan token utama GetNum dari state
        const apiUrl = state.API_URL; 
        if (!apiUrl) return;
        await axios.post(`${apiUrl}/${method}`, data, { timeout: 10000 });
    } catch (e) {}
}

/**
 * Logic Distribusi SMS
 */
async function checkAndForward() {
    const waitList = loadJson(state.FILES.WAIT, []);
    if (waitList.length === 0) return;

    let smsData = loadJson(state.FILES.SMC, []);
    if (!Array.isArray(smsData)) smsData = [];

    let newWaitList = [];
    const currentTime = Date.now() / 1000;

    for (const waitItem of waitList) {
        const waitNum = String(waitItem.number);
        const userId = waitItem.user_id;
        const startTs = waitItem.timestamp || 0;
        const otpRecTime = waitItem.otp_received_time;

        // Jika sudah pernah terima OTP, biarkan di list selama masa extended
        if (otpRecTime) {
            if (currentTime - otpRecTime <= EXTENDED_WAIT_SECONDS) newWaitList.push(waitItem);
            continue;
        }

        // Cek Timeout
        if (currentTime - startTs > WAIT_TIMEOUT_SECONDS) {
            await tgApi("sendMessage", {
                chat_id: userId,
                text: `⚠️ <b>Waktu Habis</b>\nNomor <code>${waitNum}</code> telah kadaluarsa.`,
                parse_mode: "HTML"
            });
            continue;
        }

        // Cari SMS yang cocok
        const targetSmsIndex = smsData.findIndex(sms => {
            const smsNum = String(sms.number || sms.Number || "");
            return smsNum === waitNum || smsNum.includes(waitNum.replace('+', ''));
        });

        if (targetSmsIndex !== -1) {
            const sms = smsData[targetSmsIndex];

            const otp = sms.otp || "N/A";
            const svc = sms.service || "Unknown";
            const raw = (sms.full_message || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            let balTxt = "";
            if (svc.toLowerCase().includes("whatsapp")) {
                balTxt = "<i>WhatsApp OTP no balance</i>";
            } else {
                const bal = updateProfileOtp(userId);
                balTxt = `<code>$${bal.old.toFixed(6)}</code> → <code>$${bal.new.toFixed(6)}</code>`;
            }

            const msgBody = `🔔 <b>New Message Detected</b>\n\n` +
                            `☎️ <b>Nomor:</b> <code>${waitNum}</code>\n` +
                            `⚙️ <b>Service:</b> <b>${svc}</b>\n\n` +
                            `💰 <b>Added:</b> ${balTxt}\n\n` +
                            `🗯️ <b>Full Message:</b>\n<blockquote>${raw}</blockquote>\n\n` +
                            `⚡ <b>Tap OTP Untuk Copy</b> ⚡`;

            const kb = { 
                inline_keyboard: [
                    [
                        { text: `📋 ${otp}`, copy_text: { text: otp } }, 
                        { text: "💸 Donate", url: "https://zurastore.my.id/donage" }
                    ]
                ] 
            };

            await tgApi("sendMessage", { 
                chat_id: userId, 
                text: msgBody, 
                reply_markup: kb, 
                parse_mode: "HTML" 
            });

            // Tandai OTP diterima agar nomor tetap di list selama 5 menit (Extended)
            waitItem.otp_received_time = currentTime;
            newWaitList.push(waitItem);

            // JEDA 2 DETIK BARU HAPUS DARI SMC.JSON
            setTimeout(() => {
                let currentSms = loadJson(state.FILES.SMC, []);
                // Filter ulang untuk membuang item yang sudah diproses berdasarkan timestamp/isi
                const updatedSms = currentSms.filter(s => 
                    !(String(s.number || s.Number).includes(waitNum.replace('+', '')) && (s.otp === otp))
                );
                saveJson(state.FILES.SMC, updatedSms);
            }, DELETE_DELAY_MS);

        } else {
            newWaitList.push(waitItem);
        }
    }

    saveJson(state.FILES.WAIT, newWaitList);
}

/**
 * Module Controls
 */
function start() {
    if (smsLoop) return;
    console.log("🚀 [SMS DISTRIBUTOR] Module Started (Memory Mode).");
    smsLoop = setInterval(async () => {
        // Hanya jalan jika bot utama running
        if (!state.isBotRunning) return;
        await checkAndForward();
    }, 3000); // Interval 3 detik
}

function stop() {
    if (smsLoop) {
        clearInterval(smsLoop);
        smsLoop = null;
        console.log("🛑 [SMS DISTRIBUTOR] Module Stopped.");
    }
}

module.exports = { start, stop };
