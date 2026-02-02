const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { state } = require('./helpers/state'); 
const config = require('./config');

let monitorLoop = null;
let monitorPage = null; 

// Inisialisasi Ingatan Sesi
let sessionConfig = {
    token: null,
    chatId: null,
    botLink: null,
    targetUrl: null
};

function syncSession() {
    sessionConfig.token = state.BOT_TOKEN_RANGE || state.BOT_TOKEN;
    sessionConfig.chatId = state.CHAT_ID_RANGE;
    sessionConfig.botLink = state.URL_GETNUM;
    sessionConfig.targetUrl = state.URL_TARGET_RANGE;
    console.log("[RANGE] Sesi Config Sinkron.");
}

let SENT_MESSAGES = new Map();
let CACHE_SET = new Set();
let MESSAGE_QUEUE = []; 
let IS_PROCESSING_QUEUE = false; 

const getCountryEmoji = (countryName) => {
    if (!countryName) return "🏴‍☠️";
    return config.COUNTRY_EMOJI?.[countryName.toUpperCase()] || "🏴‍☠️";
};

async function processQueue() {
    if (IS_PROCESSING_QUEUE || MESSAGE_QUEUE.length === 0) return;
    IS_PROCESSING_QUEUE = true;

    syncSession(); // Pastikan token & chat id terbaru saat mengirim
    const API_URL_RANGE = `https://api.telegram.org/bot${sessionConfig.token}`;

    while (MESSAGE_QUEUE.length > 0) {
        const item = MESSAGE_QUEUE.shift();
        try {
            // Hapus pesan lama jika range yang sama muncul lagi (agar chat bersih)
            if (SENT_MESSAGES.has(item.rangeVal)) {
                const oldData = SENT_MESSAGES.get(item.rangeVal);
                await axios.post(`${API_URL_RANGE}/deleteMessage`, {
                    chat_id: sessionConfig.chatId, 
                    message_id: oldData.message_id
                }).catch(() => {});
            }

            const res = await axios.post(`${API_URL_RANGE}/sendMessage`, {
                chat_id: sessionConfig.chatId,
                text: item.text,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ text: "📞 Get Number", url: sessionConfig.botLink }]] 
                }
            });

            if (res.data && res.data.ok) {
                SENT_MESSAGES.set(item.rangeVal, {
                    message_id: res.data.result.message_id,
                    count: item.newCount,
                    timestamp: Date.now()
                });
            }
        } catch (e) {
            console.error("[RANGE] Telegram Send Error:", e.message);
        }
        await new Promise(r => setTimeout(r, 2000)); // Delay antar pesan
    }
    IS_PROCESSING_QUEUE = false;
}

const formatLiveMessage = (rangeVal, count, countryName, service, fullMessage) => {
    const emoji = getCountryEmoji(countryName);
    const rangeWithCount = count > 1 ? `<code>${rangeVal}</code> <b>(x${count})</b>` : `<code>${rangeVal}</code>`;
    return `🔥 <b>Live Message New Range</b>\n\n` +
           `📱 Range: ${rangeWithCount}\n` +
           `${emoji} Country: ${countryName}\n` +
           `⚙️ Service: ${service}\n\n` +
           `🗯️ <b>Message Available:</b>\n` +
           `<blockquote>${fullMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</blockquote>`;
};

async function start() {
    if (monitorLoop) return; 
    syncSession();
    console.log("🚀 [RANGE] Module Started.");
    
    monitorLoop = setInterval(async () => {
        // Cek apakah bot running dan browser tersedia di state
        if (!state.isBotRunning || !state.browser) return;

        try {
            if (!monitorPage || monitorPage.isClosed()) {
                const contexts = state.browser.contexts();
                const context = contexts.length > 0 ? contexts[0] : await state.browser.newContext();
                monitorPage = await context.newPage();
            }

            // Validasi URL Target
            if (!sessionConfig.targetUrl) return;

            if (!monitorPage.url().includes(sessionConfig.targetUrl)) {
                await monitorPage.goto(sessionConfig.targetUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
            }

            // SELECTOR: Gunakan selector yang lebih fleksibel (partial match)
            // Saya mengubah selector agar tidak terlalu bergantung pada Tailwind class yang rumit
            const CONSOLE_SELECTOR = "div.p-3.rounded-lg"; 
            const elements = await monitorPage.locator(CONSOLE_SELECTOR).all();

            for (const el of elements) {
                try {
                    // Ambil teks mentah dari elemen-elemen di dalam card
                    const textContent = await el.innerText();
                    if (!textContent || !textContent.includes("•")) continue;

                    // Ekstraksi data secara lebih aman
                    const rawC = await el.locator("span.font-mono").first().innerText().catch(() => "");
                    const country = rawC.includes("•") ? rawC.split("•")[1].trim() : "Unknown";
                    
                    const sRaw = await el.locator("span.font-bold").first().innerText().catch(() => "Unknown Service");
                    
                    // Ambil nomor/range (biasanya di elemen font-mono terakhir)
                    const allMono = await el.locator("span.font-mono").all();
                    const phoneRaw = await allMono[allMono.length - 1].innerText().catch(() => "");
                    
                    const msgRaw = await el.locator("p").innerText().catch(() => "");

                    const phone = phoneRaw.replace(/[^0-9X]/g, '');
                    
                    // Cache Key: Unik per nomor dan potongan pesan
                    const cacheKey = `${phone}_${msgRaw.substring(0, 15)}`;

                    // Hanya proses jika mengandung 'XXX' (Range) dan belum pernah dikirim
                    if (phone.includes('XXX') && !CACHE_SET.has(cacheKey)) {
                        CACHE_SET.add(cacheKey);
                        
                        const currentData = SENT_MESSAGES.get(phone) || { count: 0 };
                        const newCount = currentData.count + 1;
                        
                        console.log(`[RANGE] New Hit: ${phone} (${country})`);

                        MESSAGE_QUEUE.push({
                            rangeVal: phone,
                            newCount: newCount,
                            text: formatLiveMessage(phone, newCount, country, sRaw, msgRaw)
                        });
                        
                        processQueue();
                    }
                } catch (innerError) {
                    // Abaikan error per item
                }
            }
        } catch (e) {
            console.error("[RANGE] Loop Error:", e.message);
        }
    }, 15000); // Cek setiap 15 detik
}

function stop() {
    if (monitorLoop) {
        clearInterval(monitorLoop);
        monitorLoop = null;
        if (monitorPage) monitorPage.close().catch(() => {});
        console.log("🛑 [RANGE] Module Stopped.");
    }
}

module.exports = { start, stop, syncSession };
