const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../helpers/database');
const tg = require('../helpers/telegram');
const { state } = require('../helpers/state');

// Path menuju bot_config.json
const BOT_CONFIG_PATH = path.join(__dirname, '../bot_config.json');

/**
 * Helper untuk membaca konfigurasi dari JSON secara langsung (Live)
 */
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {}
    return {};
};

async function handleAddRange(userId, text, pMsgId) {
    const newRanges = [];
    const lines = text.trim().split('\n');
    
    lines.forEach(line => {
        if (line.includes(' > ')) {
            const parts = line.split(' > ');
            const rangeP = parts[0].trim();
            const countryN = parts[1].trim().toUpperCase();
            const serviceN = parts.length > 2 ? parts[2].trim().toUpperCase() : "WA";
            
            // Mengambil emoji dari config central
            const emoji = config.COUNTRY_EMOJI[countryN] || "🗺️";
            
            newRanges.push({ 
                range: rangeP, 
                country: countryN, 
                emoji: emoji, 
                service: serviceN 
            });
        }
    });

    if (newRanges.length > 0) {
        const current = db.loadInlineRanges();
        current.push(...newRanges);
        db.saveInlineRanges(current);
        await tg.tgEdit(userId, pMsgId, `✅ Berhasil menyimpan ${newRanges.length} range baru.`);
    } else {
        await tg.tgEdit(userId, pMsgId, "❌ Format tidak valid. Gunakan format:\n<code>range > country > service</code>");
    }
}

async function handleBroadcast(userId, chatId, text, pMsgId) {
    if (text.trim().toLowerCase() === ".batal") {
        await tg.tgEdit(chatId, pMsgId, "❌ Siaran dibatalkan.");
    } else {
        await tg.tgEdit(chatId, pMsgId, "✅ Memulai siaran ke seluruh user...");
        // Fungsi broadcast biasanya memakan waktu, jadi kita beri info awal
        await tg.tgBroadcast(text, userId);
    }
}

async function handleListUsers(userId) {
    const profiles = db.loadProfiles();
    const userIds = Object.keys(profiles);

    if (userIds.length === 0) {
        await tg.tgSend(userId, "❌ Belum ada data user yang terdaftar di database.");
    } else {
        await tg.tgSend(userId, `<b>📋 Mengambil data ${userIds.length} user...</b>`);
        
        let chunk = "";
        let count = 0;
        
        for (const uid of userIds) {
            const pdata = profiles[uid];
            chunk += `👤 <b>Name:</b> ${pdata.name || 'Unknown'}\n` +
                     `🆔 <b>ID:</b> <code>${uid}</code>\n` +
                     `🧾 <b>Dana:</b> <code>${pdata.dana || '-'}</code>\n` +
                     `💰 <b>Balance:</b> $${(pdata.balance || 0).toFixed(6)}\n` +
                     `📊 <b>Total OTP:</b> ${pdata.otp_semua || 0}\n\n`;
            
            count++;
            
            // Kirim setiap 10 user agar tidak terkena limit Telegram (Flood Control)
            if (count % 10 === 0) {
                await tg.tgSend(userId, chunk);
                chunk = "";
                await new Promise(r => setTimeout(r, 800)); // Delay antar chunk
            }
        }
        
        // Kirim sisa data jika ada
        if (chunk) {
            await tg.tgSend(userId, chunk);
        }
    }
}

module.exports = {
    handleAddRange,
    handleBroadcast,
    handleListUsers
};
