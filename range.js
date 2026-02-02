const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 

// ================= KONFIGURASI =================
const CONFIG_PATH = path.join(process.cwd(), 'bot_config.json');
const INLINE_JSON_PATH = path.join(process.cwd(), 'inline.json');
const COUNTRY_EMOJI = require('./country.json');

let monitorLoop = null;
let monitorPage = null; 

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
        console.error("[RANGE] Gagal memuat konfigurasi:", err.message);
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

        currentData = currentData.filter(item => item.range !== newRange);
        currentData.unshift({
            range: newRange,
            country: country.toUpperCase(),
            emoji: getEmoji(country),
            service: serviceShort
        });
        fs.writeFileSync(INLINE_JSON_PATH, JSON.stringify(currentData.slice(0, 15), null, 2));
    } catch (e) {}
}

// ================= TELEGRAM QUEUE =================

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
                await axios.post(`${API_URL}/deleteMessage`, { chat_id: sessionConfig.chatId, message_id: old.message_id }).catch(() => {});
            }
            const res = await axios.post(`${API_URL}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "📞 Ambil Nomor", url: sessionConfig.botLink }],
                        [{ text: "🎭 Owner", url: sessionConfig.urlAdmin }]
                    ] 
                }
            });
            if (res.data?.ok) {
                SENT_MESSAGES.set(item.rangeKey, { message_id: res.data.result.message_id });
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1500));
    }
    IS_PROCESSING_QUEUE = false;
}

// ================= SCRAPER ENGINE =================

async function performScrape() {
    if (!monitorPage || monitorPage.isClosed()) return;
    
    try {
        const currentUrl = monitorPage.url();
        if (currentUrl === "about:blank" || (!currentUrl.includes(sessionConfig.targetUrl) && currentUrl !== "about:blank")) {
            console.log(`[RANGE] Mengarahkan ke target: ${sessionConfig.targetUrl}`);
            await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            return; 
        }

        const cards = await monitorPage.locator('div.group.flex.flex-col').all();

        for (const card of cards) {
            try {
                const service = await card.locator('span.text-blue-400, span.text-green-400').first().innerText().catch(() => "");
                const serviceUpper = service.toUpperCase();

                if (serviceUpper.includes("FACEBOOK") || serviceUpper.includes("WHATSAPP")) {
                    const infoBlock = await card.locator('span.text-slate-600').first().innerText().catch(() => "");
                    const parts = infoBlock.split("•");
                    const range = parts[0]?.trim() || "";
                    const country = parts[1]?.trim() || "Unknown";
                    const message = await card.locator('p.font-mono').innerText().catch(() => "");

                    if (!range.includes("XXX")) continue;

                    const cacheKey = `${range}_${message.substring(0, 20)}`;
                    if (!CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);

                        const stats = SENT_MESSAGES.get(range) || { count: 0 };
                        const newCount = stats.count + 1;
                        SENT_MESSAGES.set(range, { ...stats, count: newCount });

                        updateInlineJson(range, country, service);

                        const emoji = getEmoji(country);
                        const rangeText = newCount > 1 ? `<code>${range}</code> <b>(x${newCount})</b>` : `<code>${range}</code>`;

                        const text = `🔥 <b>Live Message New Range</b>\n\n` +
                                    `📱 Range: ${rangeText}\n` +
                                    `${emoji} Negara: ${escapeHtml(country.toUpperCase())}\n` +
                                    `⚙️ Layanan: <b>${service}</b>\n\n` +
                                    `🗯️ <b>Pesan:</b>\n` +
                                    `<blockquote>${escapeHtml(message.replace('➜', '').trim())}</blockquote>`;

                        console.log(`[RANGE] Hit: ${range} (${country})`);
                        MESSAGE_QUEUE.push({ rangeKey: range, text });
                        processQueue();
                    }
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error("[RANGE] Gagal melakukan scraping:", e.message);
    }
}

// ================= MAIN MONITOR =================

async function start() {
    if (monitorLoop) return; 
    loadConfigFromFile();
    
    console.log("🚀 [RANGE] Mencari ketersediaan browser...");

    // Menunggu browser aktif
    const checkState = setInterval(async () => {
        if (state.browser) {
            clearInterval(checkState);
            console.log("✅ [RANGE] Browser terdeteksi. Menyiapkan tab dalam 5 detik...");
            
            setTimeout(async () => {
                const context = state.browser.contexts()[0] || await state.browser.newContext();
                monitorPage = await context.newPage();
                
                if (sessionConfig.targetUrl) {
                    console.log(`[RANGE] Langsung menuju: ${sessionConfig.targetUrl}`);
                    await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
                    // Eksekusi scraping pertama kali secara instan
                    await performScrape();
                }

                // Jalankan interval pemantauan rutin
                monitorLoop = setInterval(async () => {
                    loadConfigFromFile();

                    // Jadwal Refresh 07:00 WIB
                    const now = new Date();
                    const jktTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
                    if (jktTime.getHours() === 7 && jktTime.getMinutes() === 0 && jktTime.getSeconds() < 15) {
                        console.log("[RANGE] Jadwal Refresh Harian (07:00 WIB)...");
                        await monitorPage.reload({ waitUntil: 'networkidle' }).catch(() => {});
                    }

                    await performScrape();
                }, 15000); 

            }, 5000); // Jeda 5 detik sesudah browser terdeteksi
        }
    }, 1000);
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
