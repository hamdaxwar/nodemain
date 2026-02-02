const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state');
const config = require('./config');

let monitorLoop = null;
let monitorPage = null;

const SMC_JSON_FILE = path.join(__dirname, "smc.json");
const WAIT_JSON_FILE = path.join(__dirname, "wait.json");
const CACHE_FILE = path.join(__dirname, 'otp_cache.json');
const BOT_CONFIG_PATH = path.join(__dirname, 'bot_config.json');

// --- Helper Baca JSON Langsung ---
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error("❌ [MESSAGE] Gagal baca bot_config.json");
    }
    return {};
};

// --- Utils ---
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try { return JSON.parse(fs.readFileSync(CACHE_FILE)); } catch (e) { return {}; }
    }
    return {};
}

function saveToCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function getUserData(phoneNumber) {
    if (!fs.existsSync(WAIT_JSON_FILE)) return { username: "unknown", user_id: null };
    try {
        const waitList = JSON.parse(fs.readFileSync(WAIT_JSON_FILE));
        const cleanTarget = phoneNumber.replace(/[^\d]/g, '');
        for (const entry of waitList) {
            const cleanEntry = String(entry.number || "").replace(/[^\d]/g, '');
            if (cleanTarget === cleanEntry) return { username: entry.username || "unknown", user_id: entry.user_id };
        }
    } catch (e) { }
    return { username: "unknown", user_id: null };
}

function extractOtp(text) {
    if (!text) return null;
    const patterns = [/(\d{3}[\s-]\d{3})/, /(?:code|otp|kode)[:\s]*([\d\s-]+)/i, /\b(\d{4,8})\b/];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            const otp = (m[1] || m[0]).replace(/[^\d]/g, '');
            if (otp) return otp;
        }
    }
    return null;
}

async function sendTelegram(text, otpCode = null) {
    // Ambil data terbaru dari JSON untuk pengiriman
    const liveCfg = getLiveConfig();
    const chatIdMessage = liveCfg.CHAT_ID_MESSAGE || config.CHAT_ID_MESSAGE;
    const adminLink = liveCfg.URL_ADMIN || config.TELEGRAM_ADMIN_LINK;
    const botLink = liveCfg.URL_GETNUM || config.BOT_USERNAME_LINK;

    const payload = {
        chat_id: chatIdMessage,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };

    if (otpCode) {
        payload.reply_markup = {
            inline_keyboard: [
                [
                    { text: ` ${otpCode}`, copy_text: { text: otpCode } }, 
                    { text: "🎭 Owner", url: adminLink }
                ],
                [{ text: "📞 Get Number", url: botLink }]
            ]
        };
    }

    try {
        await axios.post(`${config.API_URL}/sendMessage`, payload);
    } catch (e) {}
}

// --- Module Controls ---
async function start() {
    if (monitorLoop) return;
    console.log("🚀 [MESSAGE] Module Started.");

    const checkState = setInterval(() => {
        if (!state.isBotRunning) { clearInterval(checkState); return; }
        if (state.browser) {
            clearInterval(checkState);
            runLoop();
        }
    }, 2000);

    async function runLoop() {
        monitorLoop = setInterval(async () => {
            if (!state.isBotRunning) {
                stop();
                return;
            }

            // AMBIL URL TARGET MESSAGE DARI JSON SETIAP LOOP
            const liveCfg = getLiveConfig();
            const targetMessageUrl = liveCfg.URL_TARGET_MESSAGE || "https://stexsms.com/mdashboard/getnum";

            try {
                if (!monitorPage || monitorPage.isClosed()) {
                    const contexts = state.browser.contexts();
                    const context = contexts.length > 0 ? contexts[0] : await state.browser.newContext();
                    monitorPage = await context.newPage();
                }

                if (!monitorPage.url().includes(targetMessageUrl)) {
                    await monitorPage.goto(targetMessageUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
                }

                const responsePromise = monitorPage.waitForResponse(r => r.url().includes("/getnum/info"), { timeout: 5000 }).catch(() => null);
                
                // Trigger refresh dengan klik header tabel
                await monitorPage.click('th:has-text("Number Info")', { timeout: 1000 }).catch(() => {});
                
                const response = await responsePromise;
                if (response) {
                    const json = await response.json();
                    const numbers = json?.data?.numbers || [];

                    for (const item of numbers) {
                        if (item.status === 'success' && item.message) {
                            const otp = extractOtp(item.message);
                            const phone = "+" + item.number;
                            const key = `${otp}_${phone}`;
                            const cache = getCache();

                            if (otp && !cache[key]) {
                                cache[key] = { t: new Date().toISOString() };
                                saveToCache(cache);

                                const entry = {
                                    service: item.full_number || "Service",
                                    number: phone,
                                    otp: otp,
                                    full_message: item.message,
                                    timestamp: new Date().toLocaleString()
                                };
                                
                                let existing = [];
                                if (fs.existsSync(SMC_JSON_FILE)) {
                                    try { existing = JSON.parse(fs.readFileSync(SMC_JSON_FILE)); } catch(e){}
                                }
                                existing.push(entry);
                                fs.writeFileSync(SMC_JSON_FILE, JSON.stringify(existing.slice(-100), null, 2));

                                const user = getUserData(phone);
                                const userTag = user.username !== "unknown" ? `@${user.username}` : "unknown";
                                const emoji = config.COUNTRY_EMOJI[item.country?.trim().toUpperCase()] || "🏴‍☠️";
                                const safeFullMessage = escapeHtml(item.message);
                                
                                const msg = `💭 <b>New Message Received</b>\n\n` +
                                            `<b>👤 User:</b> ${userTag}\n` +
                                            `<b>📱 Number:</b> <code>${phone}</code>\n` +
                                            `<b>🌍 Country:</b> <b>${item.country || "N/A"} ${emoji}</b>\n` +
                                            `<b>✅ Service:</b> <b>${item.full_number || "N/A"}</b>\n\n` +
                                            `🔐 OTP: <code>${otp}</code>\n\n` +
                                            `<b>FULL MESSAGE:</b>\n` +
                                            `<blockquote>${safeFullMessage}</blockquote>`;
                                
                                await sendTelegram(msg, otp);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("❌ [MESSAGE] Loop Error:", e.message);
            }
        }, 10000); // 10s interval
    }
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(()=>{});
        monitorPage = null;
        console.log("🛑 [MESSAGE] Module Stopped.");
    }
}

module.exports = { start, stop };
