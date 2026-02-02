const fs = require('fs');
const path = require('path');
const config = require('../config');

// Path ke bot_config.json (naik satu tingkat ke root)
const BOT_CONFIG_PATH = path.join(__dirname, '../bot_config.json');

// --- Helper Baca JSON Langsung ---
const getLiveConfig = () => {
    try {
        if (fs.existsSync(BOT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(BOT_CONFIG_PATH, 'utf-8'));
        }
    } catch (e) {}
    return {};
};

// --- Core Helper ---
function loadJson(filename, defaultVal = []) {
    if (fs.existsSync(filename)) {
        try {
            return JSON.parse(fs.readFileSync(filename, 'utf8'));
        } catch (e) {
            return defaultVal;
        }
    }
    return defaultVal;
}

function saveJson(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

// --- Specific Data Loaders ---

// Users
function loadUsers() {
    return new Set(loadJson(config.FILES.USER, []));
}

function saveUsers(userId) {
    const users = loadUsers();
    if (!users.has(userId)) {
        users.add(userId);
        saveJson(config.FILES.USER, Array.from(users));
    }
}

// Cache
function loadCache() { return loadJson(config.FILES.CACHE, []); }

function saveCache(entry) {
    const cache = loadCache();
    if (cache.length >= 1000) cache.shift();
    cache.push(entry);
    saveJson(config.FILES.CACHE, cache);
}

function isInCache(number) {
    const cache = loadCache();
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) norm = '+' + norm;
    
    return cache.some(entry => {
        let entryNorm = String(entry.number).trim().replace(/[\s-]/g, "");
        if (!entryNorm.startsWith('+') && /^\d+$/.test(entryNorm)) entryNorm = '+' + entryNorm;
        return entryNorm === norm;
    });
}

// Inline Ranges
function loadInlineRanges() { return loadJson(config.FILES.INLINE_RANGE, []); }
function saveInlineRanges(ranges) { saveJson(config.FILES.INLINE_RANGE, ranges); }

// Akses Get 10
function loadAksesGet10() { return new Set(loadJson(config.FILES.AKSES_GET10, [])); }
function saveAksesGet10(userId) {
    const akses = loadAksesGet10();
    // Simpan sebagai Number di JSON agar konsisten dengan data lama
    akses.add(Number(userId));
    saveJson(config.FILES.AKSES_GET10, Array.from(akses));
}

function hasGet10Access(userId) {
    const liveCfg = getLiveConfig();
    const adminId = String(liveCfg.ADMIN_ID || config.ADMIN_ID);
    
    // Cek apakah dia Admin utama (dari JSON)
    if (String(userId) === adminId) return true;
    
    // Cek apakah dia punya akses tambahan (dari akses_get10.json)
    const akses = loadJson(config.FILES.AKSES_GET10, []);
    return akses.some(id => String(id) === String(userId));
}

// Profiles
function loadProfiles() { return loadJson(config.FILES.PROFILE, {}); }
function saveProfiles(data) { saveJson(config.FILES.PROFILE, data); }

function getUserProfile(userId, firstName = "User") {
    const profiles = loadProfiles();
    const strId = String(userId);
    const today = new Date().toISOString().split('T')[0];

    if (!profiles[strId]) {
        profiles[strId] = {
            name: firstName,
            dana: "Belum Diset",
            dana_an: "Belum Diset",
            balance: 0.000000,
            otp_semua: 0,
            otp_hari_ini: 0,
            last_active: today
        };
        saveProfiles(profiles);
    } else {
        if (profiles[strId].name !== firstName) {
            profiles[strId].name = firstName;
            saveProfiles(profiles);
        }
        if (profiles[strId].last_active !== today) {
            profiles[strId].otp_hari_ini = 0;
            profiles[strId].last_active = today;
            saveProfiles(profiles);
        }
    }
    return profiles[strId];
}

function updateUserDana(userId, danaNumber, danaName) {
    const profiles = loadProfiles();
    const strId = String(userId);
    if (profiles[strId]) {
        profiles[strId].dana = danaNumber;
        profiles[strId].dana_an = danaName;
        saveProfiles(profiles);
        return true;
    }
    return false;
}

// Waitlist
function loadWaitList() { return loadJson(config.FILES.WAIT, []); }
function saveWaitList(data) { saveJson(config.FILES.WAIT, data); }

function addToWaitList(number, userId, username, firstName) {
    let waitList = loadWaitList();
    
    let norm = String(number).trim().replace(/[\s-]/g, "");
    if (!norm.startsWith('+') && /^\d+$/.test(norm)) norm = '+' + norm;

    // Menghilangkan formatting HTML jika ada di username agar JSON bersih
    let identity = username ? username.replace('@', '') : userId;
    
    waitList = waitList.filter(item => item.number !== norm);
    
    waitList.push({
        number: norm,
        user_id: userId,
        username: identity,
        timestamp: Date.now() / 1000
    });
    saveWaitList(waitList);
}

// Utils
function initializeFiles() {
    const files = [
        config.FILES.CACHE, 
        config.FILES.INLINE_RANGE, 
        config.FILES.AKSES_GET10, 
        config.FILES.USER, 
        config.FILES.WAIT
    ];
    files.forEach(f => {
        if (!fs.existsSync(f)) saveJson(f, []);
    });
    if (!fs.existsSync(config.FILES.PROFILE)) saveJson(config.FILES.PROFILE, {});
}

module.exports = {
    loadJson, saveJson,
    loadUsers, saveUsers,
    loadCache, saveCache, isInCache,
    loadInlineRanges, saveInlineRanges,
    loadAksesGet10, saveAksesGet10, hasGet10Access,
    loadProfiles, saveProfiles, getUserProfile, updateUserDana,
    loadWaitList, saveWaitList, addToWaitList,
    initializeFiles
};
