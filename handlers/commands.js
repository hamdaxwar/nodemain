const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../helpers/database');
const tg = require('../helpers/telegram');
const { state } = require('../helpers/state');
const scraper = require('../helpers/scraper');
const adminHandler = require('./admin');

// Path ke bot_config.json di root
const BOT_CONFIG_PATH = path.join(__dirname, '../../bot_config.json');

/**
 * Helper untuk membaca konfigurasi dari JSON secara langsung (Live)
 */
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            const data = fs.readFileSync(BOT_CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("[COMMANDS] Gagal membaca bot_config.json:", e.message);
    }
    return {};
};

async function processCommand(msg) {
    if (!msg || !msg.chat) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "User";
    const usernameTg = msg.from.username;
    const mention = usernameTg ? `@${usernameTg}` : `<a href='tg://user?id=${userId}'>${firstName}</a>`;
    const text = (msg.text || "").trim();

    // 1. Ambil Konfigurasi Terbaru
    const liveCfg = getLiveConfig();
    const adminIdFromConfig = String(liveCfg.ADMIN_ID || config.ADMIN_ID);
    const adminUrl = liveCfg.URL_ADMIN || "https://t.me/Imr1d";
    const groupLink1 = liveCfg.URL_GRUP_OTP || config.GROUP_LINK_1;

    // 2. Deteksi Format Range Manual
    const rangePattern = /^\+?\d{3,15}[Xx*#]+$/;
    const isManualRange = rangePattern.test(text);

    // --- FITUR ADMIN ---
    if (String(userId) === adminIdFromConfig) {
        if (text.startsWith("/add")) {
            state.waitingAdminInput.add(userId);
            const prompt = "Silahkan kirim daftar range dalam format:\n<code>range > country > service</code>";
            const mid = await tg.tgSend(userId, prompt);
            if (mid) state.pendingMessage[userId] = mid;
            return;
        } 
        else if (text === "/info") {
            state.waitingBroadcastInput.add(userId);
            const mid = await tg.tgSend(userId, "<b>Pesan Siaran</b>\n\nKirim pesan yang ingin disiarkan.");
            if (mid) state.broadcastMessage[userId] = mid;
            return;
        } 
        else if (text === "/list") {
            await adminHandler.handleListUsers(userId);
            return;
        }
    }

    // --- PERINTAH /GET10 ---
    if (text === "/get10") {
        if (db.hasGet10Access(userId)) {
            state.get10RangeInput.add(userId);
            const mid = await tg.tgSend(userId, "Kirim range untuk 10 nomor sekaligus:");
            if (mid) state.pendingMessage[userId] = mid;
        } else {
            await tg.tgSend(userId, "❌ Anda tidak memiliki akses untuk perintah ini.");
        }
        return;
    }

    // --- LOGIKA AUTO-RANGE (DIRECT INPUT) ---
    if (isManualRange) {
        // Hapus pesan input user agar chat bersih
        try { await tg.tgDelete(chatId, msg.message_id); } catch (e) {}

        // Hapus pesan bot sebelumnya jika ada di state
        if (state.pendingMessage[userId]) {
            try { await tg.tgDelete(chatId, state.pendingMessage[userId]); } catch (e) {}
            delete state.pendingMessage[userId];
        }

        // Cek Verifikasi Grup
        const isMember = await tg.isUserInBothGroups(userId);
        if (!isMember) {
            const midErr = await tg.tgSend(userId, "❌ Silahkan verifikasi /start dulu.");
            state.pendingMessage[userId] = midErr;
            return;
        }

        state.verifiedUsers.add(userId);
        state.get10RangeInput.delete(userId);
        state.manualRangeInput.delete(userId);

        // Tentukan jumlah klik (10 jika dari state get10, else 1)
        const count = state.get10RangeInput.has(userId) ? 10 : 1;
        
        // Kirim loading bar baru
        const midLoading = await tg.tgSend(chatId, scraper.getProgressMessage(0, 0, text, count));
        state.pendingMessage[userId] = midLoading;

        // Jalankan Scraper
        scraper.processUserInput(userId, text, count, usernameTg, firstName, midLoading);
        return;
    }

    // --- STATE INPUT HANDLING ---
    if (state.waitingAdminInput.has(userId)) {
        state.waitingAdminInput.delete(userId);
        const pMsgId = state.pendingMessage[userId];
        delete state.pendingMessage[userId];
        await adminHandler.handleAddRange(userId, text, pMsgId);
        return;
    }

    if (state.waitingBroadcastInput.has(userId)) {
        state.waitingBroadcastInput.delete(userId);
        const pMsgId = state.broadcastMessage[userId];
        delete state.broadcastMessage[userId];
        await adminHandler.handleBroadcast(userId, chatId, text, pMsgId);
        return;
    }

    if (state.waitingDanaInput.has(userId)) {
        const lines = text.split('\n');
        if (lines.length >= 2) {
            state.waitingDanaInput.delete(userId);
            db.updateUserDana(userId, lines[0].trim(), lines.slice(1).join(' ').trim());
            await tg.tgSend(userId, `✅ Dana Berhasil Disimpan!`);
        }
        return;
    }

    if (text === "/setdana") {
        state.waitingDanaInput.add(userId);
        await tg.tgSend(userId, "Kirim format:\n<code>Nomor\nNama</code>");
        return;
    }

    // --- MENU /START ---
    if (text === "/start") {
        // Hapus menu lama jika ada sebelum kirim yang baru
        if (state.pendingMessage[userId]) {
            try { await tg.tgDelete(chatId, state.pendingMessage[userId]); } catch (e) {}
        }

        if (await tg.isUserInBothGroups(userId)) {
            state.verifiedUsers.add(userId);
            db.saveUsers(userId);
            const prof = db.getUserProfile(userId, firstName);
            const msgProfile = `✅ <b>Verifikasi Berhasil, ${mention}</b>\n\n` +
                `💰 <b>Balance</b> : $${prof.balance.toFixed(6)}\n` +
                `📊 <b>Total OTP</b> : ${prof.otp_semua}\n\n` +
                `💡 <i>Kirim range (ex: 228xxx) untuk mulai!</i>`;

            const kb = {
                inline_keyboard: [
                    [{ text: "📲 Get Number", callback_data: "getnum" }, { text: "👨‍💼 Admin", url: adminUrl }],
                    [{ text: "💸 Withdraw", callback_data: "withdraw_menu" }]
                ]
            };
            const midStart = await tg.tgSend(userId, msgProfile, kb);
            state.pendingMessage[userId] = midStart; // Simpan agar bisa dihapus saat user input range
        } else {
            const kb = {
                inline_keyboard: [
                    [{ text: "📌 Gabung Grup 1", url: groupLink1 }],
                    [{ text: "📌 Gabung Grup 2", url: config.GROUP_LINK_2 }],
                    [{ text: "✅ Verifikasi", callback_data: "verify" }]
                ]
            };
            const midVerify = await tg.tgSend(userId, `Halo ${mention}, gabung grup dulu:`, kb);
            state.pendingMessage[userId] = midVerify;
        }
    }
}

module.exports = { processCommand };
