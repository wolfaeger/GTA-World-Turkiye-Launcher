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
  fallbackMs: 120000                             
};

// ---- Log: %APPDATA%\gtaworld-tr-launcher\launcher.log ----
const LOG = path.join(app.getPath("userData"), "launcher.log");
function log(msg) { try { fs.appendFileSync(LOG, new Date().toISOString() + " " + msg + "\n"); } catch {} }
process.on("uncaughtException", (e) => log("HATA: " + (e && e.stack || e)));

let win = null, tray = null, quitting = false, keepAlive = false;
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
function switchToGame() {
  phase = "game"; gameStart = Date.now(); log("oyun işlemi bulundu, oyun RPC'sine geçildi");
  if (launcherRpc) { launcherRpc.destroy(); launcherRpc = null; }
  gameRpc = rpcClient(CFG.gameAppId);
  updateGame();
  gameTimer = setInterval(updateGame, 30000);
  if (closeAfterConnect && live()) setTimeout(closeWindowKeepRpc, 1500);   
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
    cb(err ? null : { game: /"FiveM_[^"]*GTAProcess/i.test(String(out)), title }));
}
const joinedTitle = (t) => /fivem.{0,4}by cfx\.re\s*[-–—]\s*\S/i.test(t || "");
function backToLauncher() {
  clearInterval(gameTimer);
  if (gameRpc) { gameRpc.destroy(); gameRpc = null; }
  if (!launcherRpc) launcherRpc = rpcClient(CFG.launcherAppId);
  launcherRpc.set(launcherActivity("Launcher'da Bekliyor"));
  if (live()) win.webContents.send("connect-reset");
}
function endSession(why) {
  phase = "idle";
  if (!live() || !win.isVisible()) return quitApp(why);
  backToLauncher();
}
function startWatch() {
  const t0 = Date.now();
  let gameSince = 0, lastTitle = null;
  const tick = () => {
    if (quitting || phase === "idle") return;
    fivemProcs((p) => {
      if (p) {
        if (phase === "connecting" && p.game) {
          if (!gameSince) { gameSince = Date.now(); log("oyun işlemi başladı"); }
          if (p.title !== lastTitle) { lastTitle = p.title; log("oyun penceresi başlığı: " + p.title); }
          if (joinedTitle(p.title)) { log("sunucuya girildi (başlıktan)"); return switchToGame(), setTimeout(tick, 10000); }
          if (Date.now() - gameSince > CFG.fallbackMs) { log("başlıktan anlaşılamadı, süre dolduğu için geçildi"); return switchToGame(), setTimeout(tick, 10000); }
        } else if (phase === "game" && !p.game) return endSession("FiveM kapandı");
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
  win.loadFile("index.html");
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}


function closeWindowKeepRpc() {
  keepAlive = true;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.ico")));
    tray.setToolTip("GTAW Türkiye Launcher: Discord durumu çalışıyor");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "Discord durumunu kapat ve çık", click: () => quitApp("tepsi menüsü") }]));
  } catch (e) { log("tepsi hatası: " + e); }
  if (live()) win.destroy();
  log("pencere kapatıldı, arka planda RPC devam ediyor");
}

ipcMain.handle("app-version", () => app.getVersion());
ipcMain.on("minimize", () => live() && win.minimize());
ipcMain.on("close", () => quitApp("kapat butonu"));
ipcMain.on("open-external", (_e, url, opts) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
  
  if (/^fivem:\/\/connect\/[A-Za-z0-9._:\/-]+$/.test(url)) {
    log("Sunucuya Bağlan tıklandı");
    if (launcherRpc) launcherRpc.set(launcherActivity("Sunucuya Bağlanıyor"));
    try {
      const p = spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true });
      p.on("error", () => shell.openExternal(url));
      p.unref();
    } catch { shell.openExternal(url); }
    phase = "connecting"; startWatch();
    closeAfterConnect = !!(opts && opts.closeAfter);
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
  launcherRpc = rpcClient(CFG.launcherAppId);
  launcherRpc.set(launcherActivity("Launcher'da Bekliyor"));
});
app.on("before-quit", () => {
  quitting = true; log("before-quit");
  clearInterval(gameTimer);
  try { launcherRpc && launcherRpc.destroy(); gameRpc && gameRpc.destroy(); tray && tray.destroy(); } catch {}
});
app.on("window-all-closed", () => { if (keepAlive) log("pencere kapandı, arka planda devam"); else quitApp("window-all-closed"); });
