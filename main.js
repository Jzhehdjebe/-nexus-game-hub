const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const DATA_FILE = path.join(app.getPath('userData'), 'library.json');

let launcherWindow = null;
let popupWindow = null;
let tray = null;
let popupTimer = null;

// ── library persistence (unchanged) ─────────────────────────────
function loadLibrary() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { games: [], nextId: 1 };
}
function saveLibrary(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── single instance ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openLauncher());
}

// ── launcher window ─────────────────────────────────────────────
function openLauncher() {
  if (launcherWindow) {
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.focus();
    return;
  }
  launcherWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  launcherWindow.loadFile(path.join(__dirname, 'index.html'));
  launcherWindow.on('closed', () => { launcherWindow = null; });
}

// ── popup window ────────────────────────────────────────────────
function armPopupTimer() {
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { if (popupWindow) popupWindow.close(); }, 15000);
}
function createPopup() {
  if (popupWindow) { popupWindow.focus(); return; }
  popupWindow = new BrowserWindow({
    width: 540,
    height: 360,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-popup.js'),
      contextIsolation: true,
    },
  });
  popupWindow.loadFile(path.join(__dirname, 'popup.html'));
  popupWindow.on('closed', () => { popupWindow = null; });
  armPopupTimer();
}
function maybePopup() { if (!launcherWindow) createPopup(); }

// ── tray ────────────────────────────────────────────────────────
function makeTrayIcon() {
  // placeholder white dot; swap for a real icon later via build assets
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const dx = x - 7.5, dy = y - 7.5;
    const a = (dx * dx + dy * dy <= 56) ? 255 : 0;
    buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
function createTray() {
  if (tray) return;
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('NEXUS Game Hub');
  tray.on('double-click', openLauncher);
  const refresh = () => {
    const login = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open NEXUS', click: openLauncher },
      {
        label: 'Start with Windows', type: 'checkbox', checked: login,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--auto'] });
          refresh();
        },
      },
      { type: 'separator' },
      { label: 'Quit NEXUS', click: () => app.quit() },
    ]));
  };
  refresh();
}

// ── IPC: launcher ───────────────────────────────────────────────
ipcMain.handle('load-library', () => loadLibrary());
ipcMain.handle('save-library', (_, data) => { saveLibrary(data); return true; });

ipcMain.handle('launch-game', async (_, gamePath) => {
  if (!gamePath) return { ok: false, error: 'No path provided' };
  const trimmed = gamePath.trim();
  const ext = path.extname(trimmed).toLowerCase();
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+-.]*:\/\//.test(trimmed) || ext === '.lnk' || ext === '.url') {
      spawn('cmd.exe', ['/c', 'start', '', trimmed], { detached: true, stdio: 'ignore', shell: true }).unref();
      return { ok: true };
    }
    if (ext === '.bat' || ext === '.cmd') {
      spawn('cmd.exe', ['/c', trimmed], { detached: true, stdio: 'ignore', shell: true }).unref();
      return { ok: true };
    }
    if (fs.existsSync(trimmed)) {
      spawn(trimmed, [], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    spawn('cmd.exe', ['/c', 'start', '', trimmed], { detached: true, stdio: 'ignore', shell: true }).unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('browse-exe', async () => {
  const result = await dialog.showOpenDialog(launcherWindow || popupWindow, {
    title: 'Select Game Executable or Shortcut',
    filters: [
      { name: 'Games & Shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('browse-image', async () => {
  const result = await dialog.showOpenDialog(launcherWindow || popupWindow, {
    title: 'Select Game Cover Image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('window-minimize', () => launcherWindow && launcherWindow.minimize());
ipcMain.handle('window-close',    () => launcherWindow && launcherWindow.close()); // closes to tray
ipcMain.handle('toggle-fullscreen', () => {
  if (launcherWindow) launcherWindow.setFullScreen(!launcherWindow.isFullScreen());
});

// ── IPC: popup ──────────────────────────────────────────────────
ipcMain.handle('open-nexus', () => {
  if (popupWindow) popupWindow.close();
  openLauncher();
  return { ok: true };
});
ipcMain.handle('close-popup', () => { if (popupWindow) popupWindow.close(); });
ipcMain.handle('reset-timer', () => { armPopupTimer(); return true; });

// ── startup ─────────────────────────────────────────────────────
const argv = process.argv.slice(1);
const AUTO  = argv.includes('--auto');   // login-item boot: tray + popup
const POPUP = argv.includes('--popup');  // test the popup manually

app.whenReady().then(() => {
  createTray();
  powerMonitor.on('unlock-screen', maybePopup);
  powerMonitor.on('resume', maybePopup);

  if (POPUP) createPopup();
  else if (AUTO) setTimeout(createPopup, 2500);
  else openLauncher();

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 3600 * 1000);
  }
});

// stay alive in tray when windows close; real quit via tray menu
app.on('window-all-closed', () => {});
app.on('activate', () => { if (!launcherWindow && !popupWindow) openLauncher(); });