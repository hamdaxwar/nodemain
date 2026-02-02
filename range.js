const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 

// ================= KONFIGURASI MANDIRI =================
const CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');
const INLINE_JSON_PATH = path.join(process.cwd(), 'inline.json');
const COUNTRY_EMOJI = require('./country.json');

let monitorLoop = null;
let monitorPage = null; 

// Memory Sesi Internal
let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null,
    urlAdmin: null
};

// ================= UTILS =================

function loadConfigFromFile() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const json = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            sessionConfig.token = json.BOT_TOKEN_RANGE || json.BOT_TOKEN_MESSAGE;
            sessionConfig.chatId = String(json.CHAT_ID_RANGE || "").trim();
            sessionConfig.botLink = fixUrl(json.URL_GETNUM);
            sessionConfig.targetUrl = json.URL_TARGET_RANGE;
            sessionConfig.urlAdmin = fixUrl(json.URL_ADMIN);
            return true;
        }
    } catch (err) {
        console.error("[RANGE] Error Config:", err.message);
    }
    return false;
}

function fixUrl(url) {
    if (!url) return "https://t.me/";
    let f = url.trim();
    if (f.startsWith('t.me')) f = 'https://' + f;
    if (f.startsWith('https:t.me')) f = f.replace('https:', 'https://');
    return f;
}

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getEmoji(country) {
    if (!country) return "🏴‍☠️";
    return COUNTRY_EMOJI[country.trim().toUpperCase()] || "🏴‍☠️";
}

/**
 * Menulis data ke inline.json dengan aturan:
 * 1. Maksimal 15 range terbaru.
 * 2. Tidak ada duplikasi (jika sama, hapus yang lama, masukkan yang baru di atas).
 * 3. Konversi Service: Facebook -> FB, WhatsApp -> WA.
 */
function updateInlineJson(newRange, country, serviceRaw) {
    try {
        let currentData = [];
        if (fs.existsSync(INLINE_JSON_PATH)) {
            const fileContent = fs.readFileSync(INLINE_JSON_PATH, 'utf8');
            try {
                currentData = JSON.parse(fileContent || "[]");
            } catch (e) {
                currentData = [];
            }
        }

        // Konversi nama service
        let serviceShort = "Unknown";
        const s = serviceRaw.toUpperCase();
        if (s.includes("FACEBOOK")) serviceShort = "FB";
        else if (s.includes("WHATSAPP")) serviceShort = "WA";

        // Hapus duplikasi jika range sudah ada
        currentData = currentData.filter(item => item.range !== newRange);

        // Tambahkan data baru di urutan teratas
        currentData.unshift({
            range: newRange,
            country: country.toUpperCase(),
            emoji: getEmoji(country),
            service: serviceShort
        });

        // Batasi maksimal 15 data
        const limitedData = currentData.slice(0, 15);
        
        fs.writeFileSync(INLINE_JSON_PATH, JSON.stringify(limitedData, null, 2));
    } catch (e) {
        console.error("[RANGE] Gagal update inline.json:", e.message);
    }
}

// ================= TELEGRAM LOGIC =================

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift();
        const API_URL = `https://api.telegram.org/bot${sessionConfig.token}`;

        try {
            if (SENT_MESSAGES.has(item.rangeKey)) {
                const old = SENT_MESSAGES.get(item.rangeKey);
                await axios.post(`${API_URL}/deleteMessage`, {
                    chat_id: sessionConfig.chatId, 
                    message_id: old.message_id
                }).catch(() => {});
            }

            const buttons = [];
            if (sessionConfig.botLink) buttons.push([{ text: "📞 Get Number", url: sessionConfig.botLink }]);
            if (sessionConfig.urlAdmin) buttons.push([{ text: "🎭 Owner", url: sessionConfig.urlAdmin }]);

            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: buttons }
            });

            if (res.data?.ok) {
                SENT_MESSAGES.set(item.rangeKey, {
                    message_id: res.data.result.message_id
                });
            }
        } catch (e) {
            console.error(`[RANGE] Send Error:`, e.response?.data?.description || e.message);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    IS_PROCESSING_QUEUE = false;
}

// ================= DATA HANDLER =================

async function handleApiData(data) {
    const logs = data?.logs || data?.data || (Array.isArray(data) ? data : []);
    
    for (const item of logs) {
        const serviceRaw = (item.app_name || "").toUpperCase();
        
        // Filter Service
        if (serviceRaw.includes("FACEBOOK") || serviceRaw.includes("WHATSAPP")) {
            const range = item.number || item.range || "";
            const sms = item.sms || "";
            const country = item.country || "Unknown";
            
            if (!range.includes("XXX")) continue;

            const cacheKey = `${range}_${sms.substring(0, 15)}`;
            if (!CACHE_SET.has(cacheKey)) {
                CACHE_SET.add(cacheKey);
                
                const stats = SENT_MESSAGES.get(range) || { count: 0 };
                const newCount = stats.count + 1;
                SENT_MESSAGES.set(range, { ...stats, count: newCount });

                // Update file inline.json secara sinkron
                updateInlineJson(range, country, item.app_name);

                const emoji = getEmoji(country);
                const rangeText = newCount > 1 ? `<code>${range}</code> <b>(x${newCount})</b>` : `<code>${range}</code>`;

                const msg = `🔥 <b>Live Message New Range</b>\n\n` +
                            `📱 Range: ${rangeText}\n` +
                            `${emoji} Country: ${escapeHtml(country.toUpperCase())}\n` +
                            `⚙️ Service: <b>${item.app_name}</b>\n\n` +
                            `🗯️ <b>Message:</b>\n` +
                            `<blockquote>${escapeHtml(sms)}</blockquote>`;

                console.log(`[RANGE] Hit: ${range} - ${item.app_name}`);
                MESSAGE_QUEUE.push({ rangeKey: range, text: msg, newCount });
                processQueue();
            }
        }
    }
}

// ================= MONITORING LOOP =================

async function start() {
    if (monitorLoop) return; 
    loadConfigFromFile();
    console.log("🚀 [RANGE] Module Started (API + Inline JSON 15 Max).");

    monitorLoop = setInterval(async () => {
        if (!state.browser) return;
        loadConfigFromFile();

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const context = state.browser.contexts()[0] || await state.browser.newContext();
                monitorPage = await context.newPage();
                
                // Interceptor API /console/info
                monitorPage.on('response', async (res) => {
                    if (res.url().includes('/console/info')) {
                        try {
                            const json = await res.json();
                            await handleApiData(json);
                        } catch (e) {}
                    }
                });
            }

            if (!sessionConfig.targetUrl) return;

            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'networkidle' }).catch(() => {});
            }

            // Trigger AJAX update
            await monitorPage.reload({ waitUntil: 'networkidle' }).catch(() => {});
            
        } catch (e) {}
    }, 20000); 
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

module.exports = { start, stop, syncSession: loadConfigFromFile };
