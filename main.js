const { app, BrowserWindow, ipcMain, shell, net, Tray, Menu, nativeImage, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec, spawn } = require("child_process");
const { Client: RpcClient } = require("@xhayper/discord-rpc");
const { autoUpdater } = require("electron-updater");

// ---- Ayarlar ----
const CFG = {
  launcherAppId: "1558433088500146196",          
  gameAppId: "1544924631331250178",              
  image: "gtaworld",
  imageText: "GTA World Türkiye",
  playerCountUrl: "https://ucp-tr.gta.world/player-count",
  joinUrl: "https://cfx.re/join/3yybopy",
  discordUrl: "https://discord.gg/gtaworldtr",
  infoLine: "forum-tr.gta.world",
  fallbackMs: 120000,
  closeDelayMs: 4000,                            // 'Sunucuya Bağlan'dan kaç ms sonra tepsiye inilsin
  noStartMs: 20000                               // FiveM bu sürede hiç başlamazsa launcher geri gelir                             
};

// ---- Log: %APPDATA%\gtaworld-tr-launcher\launcher.log ----
const LOG = path.join(app.getPath("userData"), "launcher.log");
function log(msg) { try { fs.appendFileSync(LOG, new Date().toISOString() + " " + msg + "\n"); } catch {} }
process.on("uncaughtException", (e) => log("HATA: " + (e && e.stack || e)));

// ---- Kullanıcı ayarları: %APPDATA%\\gtaworld-tr-launcher\\settings.json ----
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = { closeAfterConnect: true, discordRpc: true, splash: true, bgSlideshow: true, bgSeconds: 8, refreshSeconds: 30 };
const RULES = {
  closeAfterConnect: (v) => typeof v === "boolean",
  discordRpc: (v) => typeof v === "boolean",
  splash: (v) => typeof v === "boolean",
  bgSlideshow: (v) => typeof v === "boolean",
  bgSeconds: (v) => [5, 8, 15].includes(v),
  refreshSeconds: (v) => [15, 30, 60].includes(v)
};
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch {}
  const out = { ...DEFAULTS };
  for (const k of Object.keys(RULES)) if (RULES[k](s[k])) out[k] = s[k];
  return out;
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { log("ayar kaydedilemedi: " + e.message); }
}
let settings = loadSettings();

// ---- Oynama süresi: %APPDATA%\\gtaworld-tr-launcher\\playtime.json ----
// Sayaç launcher'ın kurulduğu andan başlar (UCP'den geçmiş veri çekilemiyor). Gün gün saklanır, hafta/ay buradan hesaplanır.
const PLAY_FILE = path.join(app.getPath("userData"), "playtime.json");
const pad2 = (n) => String(n).padStart(2, "0");
const dayKey = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
function loadPlay() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(PLAY_FILE, "utf8")); } catch {}
  const days = {};
  if (s.days && typeof s.days === "object") for (const [k, v] of Object.entries(s.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(v) && v >= 0) days[k] = Math.floor(v);
  const a = s.anchor;   // UCP'deki toplam saat: { sec: girilen süre, tracked: o an launcher'ın ölçtüğü toplam }
  const anchor = a && Number.isFinite(a.sec) && a.sec >= 0 && Number.isFinite(a.tracked) && a.tracked >= 0 ? { sec: Math.floor(a.sec), tracked: Math.floor(a.tracked) } : null;
  return {
    total: Number.isFinite(s.total) && s.total >= 0 ? Math.floor(s.total) : 0, days, anchor,
    lastOnline: Number.isFinite(s.lastOnline) && s.lastOnline > 0 ? Math.floor(s.lastOnline) : 0,
    since: typeof s.since === "string" && !isNaN(Date.parse(s.since)) ? s.since : new Date(Date.now()).toISOString()
  };
}
function savePlay() { try { fs.writeFileSync(PLAY_FILE, JSON.stringify(play)); } catch (e) { log("oynama süresi kaydedilemedi: " + e.message); } }
let play = loadPlay();
if (!fs.existsSync(PLAY_FILE)) savePlay();
function playStats(now = new Date(Date.now())) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));   // hafta pazartesi başlar
  const wk = dayKey(monday), td = dayKey(now), mo = td.slice(0, 7);
  let week = 0, month = 0;
  for (const [k, v] of Object.entries(play.days)) { if (k > td) continue; if (k >= wk) week += v; if (k.slice(0, 7) === mo) month += v; }   // bugünden sonrası (saat geri alınırsa) sayılmaz
  const total = play.anchor ? play.anchor.sec + Math.max(0, play.total - play.anchor.tracked) : play.total;   // UCP saati girildiyse üstüne eklemeye devam eder
  return { week, month, total, tracked: play.total, since: play.since, lastOnline: play.lastOnline, online: lastCredit > 0 };
}
let lastCredit = 0;   // 0: şu an sayılmıyor
function sendPlayStats() { if (live()) win.webContents.send("play-stats", playStats()); }
// joined=true iken çağrıldıkça son çağrıdan bu yana geçen süreyi ekler. Uyku/duraklama gibi uzun boşlukları saymaz.
function creditPlay(joined) {
  const t = Date.now();
  if (!joined) { if (lastCredit) { lastCredit = 0; sendPlayStats(); } return; }   // sunucudan çıkıldı
  play.lastOnline = t;
  if (!lastCredit) { lastCredit = t; savePlay(); sendPlayStats(); return; }
  let sec = Math.round((t - lastCredit) / 1000);
  lastCredit = t;
  if (sec <= 0) return;
  if (sec > 40) sec = 10;
  play.total += sec;
  const k = dayKey(new Date(t));
  play.days[k] = (play.days[k] || 0) + sec;
  const cutoff = dayKey(new Date(t - 70 * 86400000));
  for (const d of Object.keys(play.days)) if (d < cutoff) delete play.days[d];
  savePlay();
  sendPlayStats();
}

let win = null, tray = null, quitting = false, keepAlive = false, splashShown = false, closeTimer = null, noticePending = null;
let launcherRpc = null, gameRpc = null, gameTimer = null, phase = "idle", closeAfterConnect = false;
const startedAt = Date.now();
const live = () => win && !win.isDestroyed();

function quitApp(why) { log("kapanıyor: " + why); app.quit(); }
if (!app.requestSingleInstanceLock()) app.quit();


function rpcClient(clientId) {
  const o = { c: null, ready: false, pending: null, dead: false };
  const connect = async () => {
    if (o.dead || o.ready) return;
    const c = new RpcClient({ clientId });
    c.on("ready", () => { o.c = c; o.ready = true; if (o.pending) o.set(o.pending); });
    c.on("disconnected", () => { o.ready = false; if (!o.dead) setTimeout(connect, 20000); });
    try { await c.login(); } catch { if (!o.dead) setTimeout(connect, 20000); }
  };
  o.set = (activity) => { o.pending = activity; if (o.ready && o.c && o.c.user) o.c.user.setActivity(activity).catch(() => {}); };
  o.destroy = () => { o.dead = true; try { o.c && o.c.destroy(); } catch {} };
  connect();
  return o;
}
const launcherActivity = (details) => ({ details, startTimestamp: startedAt, largeImageKey: CFG.image, largeImageText: CFG.imageText });


let lastCount = { players: 0, max: 2000 };
async function updateGame() {
  if (quitting || !gameRpc) return;
  try {
    const d = await (await net.fetch(CFG.playerCountUrl)).json();
    lastCount = { players: d.players, max: d.maxplayers };
  } catch {}
  gameRpc.set({
    details: "Oyuncu Sayısı: " + lastCount.players + "/" + lastCount.max,
    state: CFG.infoLine,
    startTimestamp: gameStart,
    largeImageKey: CFG.image,
    largeImageText: CFG.imageText,
    buttons: [{ label: "Sunucuya Bağlan", url: CFG.joinUrl }, { label: "Discord'a Katıl", url: CFG.discordUrl }]
  });
}
let gameStart = 0;
function switchToGame(joined) {
  lastCredit = 0; creditPlay(!!joined);
  phase = "game"; gameStart = Date.now(); log("oyun işlemi bulundu, oyun RPC'sine geçildi");
  if (launcherRpc) { launcherRpc.destroy(); launcherRpc = null; }
  if (settings.discordRpc) { gameRpc = rpcClient(CFG.gameAppId); updateGame(); }
  gameTimer = setInterval(updateGame, 30000);
  if (live()) win.webContents.send("game-state", "game");
}


let procErrCount = 0;
async function fivemProcs(cb) {
  let title = "";
  try {
    const srcs = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    const names = srcs.map((x) => x.name);
    title = names.find(joinedTitle) || names.find((n) => /fivem/i.test(n)) || "";
  } catch (e) { if (procErrCount++ < 3) log("pencere listesi hatası: " + e.message); }
  exec("tasklist /NH /FO CSV", { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) =>
    cb(err ? null : { game: /"FiveM_[^"]*GTAProcess/i.test(String(out)), any: /"FiveM[^"]*\.exe"/i.test(String(out)), title }));
}
const joinedTitle = (t) => /fivem.{0,4}by cfx\.re\s*[-–—]\s*\S/i.test(t || "");
function backToLauncher() {
  clearInterval(gameTimer);
  destroyTray(); keepAlive = false;
  if (gameRpc) { gameRpc.destroy(); gameRpc = null; }
  if (settings.discordRpc) {
    if (!launcherRpc) launcherRpc = rpcClient(CFG.launcherAppId);
    launcherRpc.set(launcherActivity("Launcher'da Bekliyor"));
  }
  if (live()) win.webContents.send("connect-reset");
}
function endSession(why) {
  log("oturum bitti: " + why + " -> launcher geri getiriliyor");
  phase = "idle"; lastCredit = 0; clearTimeout(closeTimer); closeTimer = null;
  openLauncher();      // pencere tepsideyse/kapalıysa geri getirir
  backToLauncher();    // tepsiyi kaldırır, Discord durumunu ve butonu sıfırlar
  sendPlayStats();
}
// FiveM hiç açılmadıysa launcher'ı geri getirir ve uyarı gösterir
function sendNotice() {
  if (noticePending && live() && !win.webContents.isLoading()) { win.webContents.send("notice", noticePending); noticePending = null; }
}
function connectFailed() {
  log("FiveM " + CFG.noStartMs / 1000 + " sn içinde başlamadı, launcher geri getirildi");
  phase = "idle"; clearTimeout(closeTimer); closeTimer = null;
  noticePending = "no-start";
  openLauncher();
  backToLauncher();
  sendNotice();
}
function startWatch() {
  const t0 = Date.now();
  let gameSince = 0, lastTitle = null, seenFivem = false, lastSeen = 0;
  const tick = () => {
    if (quitting || phase === "idle") return;
    fivemProcs((p) => {
      if (p) {
        if (p.any || p.game) { seenFivem = true; lastSeen = Date.now(); }
        if (phase === "connecting" && p.game) {
          if (!gameSince) { gameSince = Date.now(); log("oyun işlemi başladı"); }
          if (p.title !== lastTitle) { lastTitle = p.title; log("oyun penceresi başlığı: " + p.title); }
          if (joinedTitle(p.title)) { log("sunucuya girildi (başlıktan)"); return switchToGame(true), setTimeout(tick, 10000); }
          if (Date.now() - gameSince > CFG.fallbackMs) { log("başlıktan anlaşılamadı, süre dolduğu için geçildi"); return switchToGame(false), setTimeout(tick, 10000); }
        } else if (phase === "game" && !p.game) return endSession("FiveM kapandı");
        else if (phase === "game") creditPlay(joinedTitle(p.title));          // sadece başlık sunucuyu gösterirken say
      }
      if (p && phase === "connecting") {
        const running = p.any || p.game;
        if (!seenFivem && Date.now() - t0 > CFG.noStartMs) return connectFailed();                       // hiç başlamadı
        if (seenFivem && !running && Date.now() - lastSeen > 15000) return endSession("FiveM bağlanmadan kapandı"); // başladı ama kapandı
      }
      if (phase === "connecting" && Date.now() - t0 > 600000) return endSession("FiveM başlamadı");
      setTimeout(tick, phase === "game" ? 10000 : 4000);
    });
  };
  tick();
}


function create() {
  win = new BrowserWindow({
    width: 992, height: 572,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), webSecurity: false }
  });
  win.setMenu(null);
  // Açılış ekranı sadece uygulama ilk açılışında gösterilir (tepsiden tekrar açılışta atlanır)
  const showSplash = settings.splash && !splashShown;
  splashShown = true;
  win.loadFile("index.html", showSplash ? undefined : { query: { nosplash: "1" } });
  win.webContents.on("did-finish-load", () => {
    if ((phase === "game" || phase === "connecting") && live()) win.webContents.send("game-state", phase);
    sendNotice();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}


// Ayarlardan Discord durumu açılıp kapatılınca RPC istemcilerini duruma göre yeniden kurar
function applyRpc() {
  if (quitting) return;
  refreshTray();
  if (!settings.discordRpc) {
    if (launcherRpc) { launcherRpc.destroy(); launcherRpc = null; }
    if (gameRpc) { gameRpc.destroy(); gameRpc = null; }
    return;
  }
  if (phase === "game") {
    if (!gameRpc) { gameRpc = rpcClient(CFG.gameAppId); updateGame(); }
  } else if (!launcherRpc) {
    launcherRpc = rpcClient(CFG.launcherAppId);
    launcherRpc.set(launcherActivity(phase === "connecting" ? "Sunucuya Bağlanıyor" : "Launcher'da Bekliyor"));
  }
}

// ---- Sistem tepsisi: Discord Durumu (Açık/Kapalı), Launcher'ı Aç, Kapat ----
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: "Discord Durumu: " + (settings.discordRpc ? "Açık" : "Kapalı"), click: () => updateSettings({ discordRpc: !settings.discordRpc }, true) },
    { label: "Launcher'ı Aç", click: openLauncher },
    { type: "separator" },
    { label: "Kapat", click: () => quitApp("tepsi menüsü") }
  ]);
}
function refreshTray() {
  if (!tray) return;
  try {
    tray.setToolTip("GTAW Türkiye Launcher: Discord durumu " + (settings.discordRpc ? "çalışıyor" : "kapalı"));
    tray.setContextMenu(trayMenu());
  } catch (e) { log("tepsi güncelleme hatası: " + e); }
}
function ensureTray() {
  if (tray) return true;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.ico")));
    tray.on("click", openLauncher);
    refreshTray();
    return true;
  } catch (e) { log("tepsi hatası: " + e); tray = null; return false; }
}
function destroyTray() { try { tray && tray.destroy(); } catch {} tray = null; }
function openLauncher() {
  if (!live()) create();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function closeWindowKeepRpc() {
  if (!ensureTray()) { log("tepsi kurulamadı, pencere açık bırakıldı"); return; }
  keepAlive = true;
  if (live()) win.destroy();
  log("pencere kapatıldı, arka planda RPC devam ediyor");
}

ipcMain.handle("app-version", () => app.getVersion());

ipcMain.handle("settings-get", () => settings);
function updateSettings(patch, notifyWindow) {
  if (!patch || typeof patch !== "object") return settings;
  const prev = settings, next = { ...settings };
  for (const k of Object.keys(patch)) if (RULES[k] && RULES[k](patch[k])) next[k] = patch[k];
  settings = next; saveSettings();
  if (phase === "connecting") closeAfterConnect = next.closeAfterConnect;
  if (next.discordRpc !== prev.discordRpc) applyRpc();
  if (notifyWindow && live()) win.webContents.send("settings-changed", settings);
  return settings;
}
ipcMain.handle("play-stats", () => playStats());
// UCP'deki "Toplam Aktivite" saatini girer (örn. "1610.6", "1610,6 saat"). Boş bırakılırsa sadece launcher'ın ölçtüğü süre kullanılır.
ipcMain.handle("play-set-total", (_e, v) => {
  const s = (v == null ? "" : String(v)).trim().replace(/\s*(saat|sa|h)\.?$/i, "").replace(",", ".").trim();
  if (s === "") play.anchor = null;
  else {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(s) || parseFloat(s) > 200000) return { ok: false };
    play.anchor = { sec: Math.round(parseFloat(s) * 3600), tracked: play.total };
  }
  savePlay(); sendPlayStats();
  return { ok: true, stats: playStats() };
});
ipcMain.handle("settings-set", (_e, patch) => updateSettings(patch, false));
ipcMain.handle("settings-reset", () => {
  const prev = settings;
  settings = { ...DEFAULTS }; saveSettings();
  if (phase === "connecting") closeAfterConnect = settings.closeAfterConnect;
  if (settings.discordRpc !== prev.discordRpc) applyRpc();
  return settings;
});
ipcMain.handle("open-log", () => {
  if (fs.existsSync(LOG)) { shell.showItemInFolder(LOG); return true; }
  shell.openPath(app.getPath("userData")); return true;
});

// FiveM klasörlerini açar. mods ve plugins yoksa oluşturulur.
// Yol arayüzden alınmaz, sadece bu sabit listeden seçilir.
const FIVEM_DIRS = { app: "", mods: "mods", plugins: "plugins" };
ipcMain.handle("fivem-open-folder", async (_e, name) => {
  if (!Object.prototype.hasOwnProperty.call(FIVEM_DIRS, name)) return { ok: false, reason: "error" };
  const local = process.env.LOCALAPPDATA;
  const base = local ? path.join(local, "FiveM", "FiveM.app") : "";
  if (!base || !fs.existsSync(base)) return { ok: false, reason: "notfound" };
  const dir = FIVEM_DIRS[name] ? path.join(base, FIVEM_DIRS[name]) : base;
  try {
    let created = false;
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); created = true; log("klasör oluşturuldu: " + dir); }
    else if (!fs.statSync(dir).isDirectory()) return { ok: false, reason: "error" };
    const err = await shell.openPath(dir);
    if (err) { log("klasör açılamadı: " + err); return { ok: false, reason: "error" }; }
    return { ok: true, created };
  } catch (e) {
    log("klasör açma hatası: " + e.message);
    return { ok: false, reason: "error" };
  }
});

// FiveM'in sunucu kaynak önbelleğini siler (server-cache, server-cache-priv).
// Oyun dosyaları (cache\game) ve kullanıcı ayarlarına dokunulmaz.
ipcMain.handle("fivem-clear-cache", async () => {
  const local = process.env.LOCALAPPDATA;
  const base = local ? path.join(local, "FiveM", "FiveM.app", "data") : "";
  if (!base || !fs.existsSync(base)) return { ok: false, reason: "notfound" };
  const running = phase !== "idle" || await new Promise((resolve) =>
    exec("tasklist /NH /FO CSV", { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) =>
      resolve(!err && /"FiveM[^"]*\.exe"/i.test(String(out)))));
  if (running) return { ok: false, reason: "running" };
  let cleared = 0;
  try {
    for (const name of ["server-cache", "server-cache-priv"]) {
      const dir = path.join(base, name);
      if (!fs.existsSync(dir)) continue;
      await fs.promises.rm(dir, { recursive: true, force: true });
      cleared++;
    }
    log("FiveM önbelleği temizlendi (" + cleared + " klasör)");
    return { ok: true, cleared };
  } catch (e) {
    log("önbellek temizleme hatası: " + e.message);
    return { ok: false, reason: "error" };
  }
});
ipcMain.on("minimize", () => live() && win.minimize());
ipcMain.on("close", () => {
  if (tray && (phase === "game" || phase === "connecting") && live()) { log("pencere tepsiye alındı"); win.destroy(); return; }
  quitApp("kapat butonu");
});
ipcMain.on("open-external", (_e, url, opts) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
  
  if (/^fivem:\/\/connect\/[A-Za-z0-9._:\/-]+$/.test(url)) {
    if (phase === "game") return;
    log("Sunucuya Bağlan tıklandı");
    if (launcherRpc) launcherRpc.set(launcherActivity("Sunucuya Bağlanıyor"));
    try {
      const p = spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true });
      p.on("error", () => shell.openExternal(url));
      p.unref();
    } catch { shell.openExternal(url); }
    if (phase !== "connecting") { phase = "connecting"; startWatch(); }
    closeAfterConnect = settings.closeAfterConnect;
    clearTimeout(closeTimer);
    if (closeAfterConnect) closeTimer = setTimeout(() => { if ((phase === "connecting" || phase === "game") && live()) closeWindowKeepRpc(); }, CFG.closeDelayMs);
  }
});


ipcMain.handle("ping", (_e, url) => new Promise((resolve) => {
  if (!/^https:\/\//.test(url)) return resolve(false);
  const req = net.request({ url, method: "GET", redirect: "follow" });
  const t = setTimeout(() => { req.abort(); resolve(false); }, 10000);
  req.on("response", (r) => { clearTimeout(t); resolve(r.statusCode < 500); req.abort(); });
  req.on("error", () => { clearTimeout(t); resolve(false); });
  req.end();
}));


ipcMain.handle("fivem-installed", () => new Promise((resolve) => {
  const exe = path.join(process.env.LOCALAPPDATA || "", "FiveM", "FiveM.exe");
  if (fs.existsSync(exe)) return resolve(true);
  exec('reg query "HKCU\\Software\\Classes\\fivem" /ve', (err) => resolve(!err));
}));


autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = {
  info: (x) => log("güncelleyici: " + x),
  warn: (x) => log("güncelleyici uyarı: " + x),
  error: (x) => log("güncelleyici hata: " + x)
};
const parseVer = (v) => String(v).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
let pendingUpdate = null;

ipcMain.handle("update-check", async () => {
  if (!app.isPackaged) return { state: "none" };           
  try {
    const r = await autoUpdater.checkForUpdates();
    const info = r && r.updateInfo;
    log("sürüm kontrolü: mevcut " + app.getVersion() + ", son " + (info && info.version));
    if (!info || !isNewer(info.version, app.getVersion())) return { state: "current" };
    pendingUpdate = info;
    return { state: "new", version: info.version };
  } catch (e) { log("sürüm kontrolü hatası: " + e.message); return { state: "none" }; }
});


ipcMain.handle("update-apply", async () => {
  if (!pendingUpdate) return { ok: false };
  try {
    await autoUpdater.downloadUpdate();
    log("güncelleme indirildi, kuruluyor: " + pendingUpdate.version);
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
    return { ok: true };
  } catch (e) { log("güncelleme hatası: " + e.message); return { ok: false }; }
});

app.on("second-instance", () => { if (!live()) create(); else { win.show(); if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  create();
  if (settings.discordRpc) {
    launcherRpc = rpcClient(CFG.launcherAppId);
    launcherRpc.set(launcherActivity("Launcher'da Bekliyor"));
  }
});
app.on("before-quit", () => {
  quitting = true; log("before-quit");
  clearInterval(gameTimer);
  try { launcherRpc && launcherRpc.destroy(); gameRpc && gameRpc.destroy(); tray && tray.destroy(); } catch {}
});
app.on("window-all-closed", () => { if (keepAlive && (phase === "game" || phase === "connecting")) log("pencere kapandı, arka planda devam"); else quitApp("window-all-closed"); });
