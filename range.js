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
 * Menulis data ke inline.json (Maks 15, No Duplicate)
 */
function updateInlineJson(newRange, country, serviceRaw) {
    try {
        let currentData = [];
        if (fs.existsSync(INLINE_JSON_PATH)) {
            try {
                currentData = JSON.parse(fs.readFileSync(INLINE_JSON_PATH, 'utf8') || "[]");
            } catch (e) { currentData = []; }
        }

        let serviceShort = serviceRaw.toUpperCase().includes("FACEBOOK") ? "FB" : 
                          (serviceRaw.toUpperCase().includes("WHATSAPP") ? "WA" : "??");

        // Filter duplikasi
        currentData = currentData.filter(item => item.range !== newRange);

        currentData.unshift({
            range: newRange,
            country: country.toUpperCase(),
            emoji: getEmoji(country),
            service: serviceShort
        });

        fs.writeFileSync(INLINE_JSON_PATH, JSON.stringify(currentData.slice(0, 15), null, 2));
    } catch (e) {
        console.error("[RANGE] Update Inline Error:", e.message);
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

            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "📞 Get Number", url: sessionConfig.botLink }],
                        [{ text: "🎭 Owner", url: sessionConfig.urlAdmin }]
                    ] 
                }
            });

            if (res.data?.ok) {
                SENT_MESSAGES.set(item.rangeKey, { message_id: res.data.result.message_id });
            }
        } catch (e) {
            console.error(`[RANGE] TG Error:`, e.response?.data?.description || e.message);
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    IS_PROCESSING_QUEUE = false;
}

// ================= MONITORING LOOP =================

async function start() {
    if (monitorLoop) return; 
    loadConfigFromFile();
    console.log("🚀 [RANGE] Module Scraper Started (Daily Refresh 07:00 WIB).");

    monitorLoop = setInterval(async () => {
        if (!state.browser) return;
        loadConfigFromFile();

        // LOGIKA REFRESH JAM 7 PAGI WIB
        const now = new Date();
        const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
        if (jktTime.getHours() === 7 && jktTime.getMinutes() === 0 && jktTime.getSeconds() < 20) {
            if (monitorPage) {
                console.log("[RANGE] Jam 07:00 WIB - Melakukan Auto-Refresh Halaman...");
                await monitorPage.reload({ waitUntil: 'networkidle' }).catch(() => {});
            }
        }

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const context = state.browser.contexts()[0] || await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            if (!sessionConfig.targetUrl) return;

            // Paksa kembali ke URL target jika berubah
            const currentUrl = monitorPage.url();
            if (!currentUrl.includes(sessionConfig.targetUrl) && currentUrl !== "about:blank") {
                console.log("[RANGE] URL berubah, memaksa kembali ke target...");
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            }

            // Scrape data berdasarkan struktur div class baru
            const cards = await monitorPage.locator('div.group.flex.flex-col').all();

            for (const card of cards) {
                try {
                    // Ambil Service (Facebook/WhatsApp)
                    const service = await card.locator('span.text-blue-400, span.text-green-400').first().innerText().catch(() => "");
                    const serviceUpper = service.toUpperCase();

                    // Filter Hanya FB dan WA
                    if (serviceUpper.includes("FACEBOOK") || serviceUpper.includes("WHATSAPP")) {
                        
                        // Ambil Range & Country dari blok info sebelah kiri
                        const infoBlock = await card.locator('span.text-slate-600').first().innerText().catch(() => "");
                        // InfoBlock format: "224657799XXX • PostPaid"
                        const range = infoBlock.split("•")[0].trim();
                        const country = infoBlock.split("•")[1]?.trim() || "Unknown";
                        
                        // Ambil Pesan SMS
                        const message = await card.locator('p.font-mono').innerText().catch(() => "");

                        if (!range.includes("XXX")) continue;

                        const cacheKey = `${range}_${message.substring(0, 20)}`;
                        if (!CACHE_SET.has(cacheKey)) {
                            CACHE_SET.add(cacheKey);

                            const stats = SENT_MESSAGES.get(range) || { count: 0 };
                            const newCount = stats.count + 1;
                            SENT_MESSAGES.set(range, { ...stats, count: newCount });

                            // Simpan ke inline.json
                            updateInlineJson(range, country, service);

                            const emoji = getEmoji(country);
                            const rangeText = newCount > 1 ? `<code>${range}</code> <b>(x${newCount})</b>` : `<code>${range}</code>`;

                            const msg = `🔥 <b>Live Message New Range</b>\n\n` +
                                        `📱 Range: ${rangeText}\n` +
                                        `${emoji} Country: ${escapeHtml(country.toUpperCase())}\n` +
                                        `⚙️ Service: <b>${service}</b>\n\n` +
                                        `🗯️ <b>Message:</b>\n` +
                                        `<blockquote>${escapeHtml(message.replace('➜', '').trim())}</blockquote>`;

                            console.log(`[RANGE] Hit: ${range} - ${service}`);
                            MESSAGE_QUEUE.push({ rangeKey: range, text: msg });
                            processQueue();
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }, 15000); // Cek setiap 15 detik (Tanpa refresh paksa halaman)
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
    }
}

module.exports = { start, stop, syncSession: loadConfigFromFile };
