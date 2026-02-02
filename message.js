const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state');
const config = require('./config');

let monitorLoop = null;
let monitorPage = null;

// Sesi Memory (Hanya cari lagi jika sesi restart/reload)
let sessionConfig = {
    token: null,
    chatId: null,
    adminUrl: null,
    botLink: null,
    targetUrl: null
};

/**
 * Sinkronisasi Sesi dari State (JSON)
 */
function syncSession() {
    // state.reload() sudah dipanggil di main/state, kita tinggal ambil nilainya
    sessionConfig.token = state.BOT_TOKEN_MESSAGE || state.BOT_TOKEN;
    sessionConfig.chatId = state.CHAT_ID_MESSAGE;
    sessionConfig.adminUrl = state.URL_ADMIN;
    sessionConfig.botLink = state.URL_GETNUM;
    sessionConfig.targetUrl = state.URL_TARGET_MESSAGE;
    console.log("[MESSAGE] Sesi Config Sinkron.");
}

const SMC_JSON_FILE = path.join(process.cwd(), "smc.json");
const WAIT_JSON_FILE = path.join(process.cwd(), "wait.json");
const CACHE_FILE = path.join(process.cwd(), 'otp_cache.json');

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
    // Gunakan nilai dari ingatan sesi
    const API_URL_MESSAGE = `https://api.telegram.org/bot${sessionConfig.token}`;

    const payload = {
        chat_id: sessionConfig.chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };

    if (otpCode) {
    payload.reply_markup = {
        inline_keyboard: [
            [
                {
                    text: ` Copy OTP: ${otpCode}`,
                    copy_text: {
                        text: otpCode
                    }
                },
                {
                    text: "🎭 Owner",
                    url: sessionConfig.adminUrl
                }
            ],
            [
                {
                    text: "📞 Get Number",
                    url: sessionConfig.botLink
                }
            ]
        ]
    };
    }
    
    try {
        await axios.post(`${API_URL_MESSAGE}/sendMessage`, payload);
    } catch (e) {
        console.error("❌ [MESSAGE] Kirim Gagal:", e.message);
    }
}

async function start() {
    if (monitorLoop) return;
    
    // Inisialisasi Ingatan Sesi saat Start
    syncSession();
    console.log("🚀 [MESSAGE] Module Started.");

    monitorLoop = setInterval(async () => {
        if (!state.isBotRunning || !state.browser) return;

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const contexts = state.browser.contexts();
                const context = contexts.length > 0 ? contexts[0] : await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            // Gunakan URL dari ingatan sesi
            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            }

            const responsePromise = monitorPage.waitForResponse(r => r.url().includes("/getnum/info"), { timeout: 5000 }).catch(() => null);
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

                            const user = getUserData(phone);
                            const userTag = user.username !== "unknown" ? `@${user.username}` : `ID: ${user.user_id}`;
                            const emoji = config.COUNTRY_EMOJI[item.country?.trim().toUpperCase()] || "🏴‍☠️";
                            
                            const msg = `💭 <b>New Message Received</b>\n\n` +
                                        `<b>👤 User:</b> ${userTag}\n` +
                                        `<b>📱 Number:</b> <code>${phone}</code>\n` +
                                        `<b>🌍 Country:</b> <b>${item.country} ${emoji}</b>\n` +
                                        `<b>✅ Service:</b> <b>${item.full_number}</b>\n\n` +
                                        `🔐 OTP: <code>${otp}</code>\n\n` +
                                        `<b>FULL MESSAGE:</b>\n` +
                                        `<blockquote>${escapeHtml(item.message)}</blockquote>`;
                            
                            await sendTelegram(msg, otp);
                        }
                    }
                }
            }
        } catch (e) { }
    }, 10000); 
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(()=>{});
        console.log("🛑 [MESSAGE] Module Stopped.");
    }
}

module.exports = { start, stop, syncSession };
