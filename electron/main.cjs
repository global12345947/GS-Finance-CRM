const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const CONFIG_FILE = path.join(app.getPath("userData"), "gs-crm-config.json");
const IS_DEV = !app.isPackaged;

let mainWindow = null;
let tray = null;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "Global Smart CRM",
    icon: getIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  const config = loadConfig();
  if (config.serverUrl) {
    loadServer(config.serverUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "setup.html"));
  }
}

function loadServer(url) {
  const normalised = url.replace(/\/+$/, "");
  mainWindow.loadURL(normalised);

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return; // aborted — ignore
    console.error(`[Electron] Ошибка загрузки: ${code} ${desc}`);
    mainWindow.loadFile(path.join(__dirname, "setup.html"));
  });
}

function getIconPath() {
  const ico = path.join(__dirname, "resources", "icon.ico");
  if (fs.existsSync(ico)) return ico;
  return undefined;
}

function createTray() {
  const iconPath = getIconPath();
  if (!iconPath) return;
  tray = new Tray(iconPath);
  tray.setToolTip("Global Smart CRM");
  tray.on("click", () => {
    if (mainWindow) mainWindow.show();
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть CRM", click: () => mainWindow && mainWindow.show() },
    { type: "separator" },
    { label: "Выход", click: () => { tray = null; app.quit(); } },
  ]));
}

// ===================== IPC =====================

ipcMain.handle("save-server-url", async (_event, url) => {
  const config = loadConfig();
  config.serverUrl = url.replace(/\/+$/, "");
  saveConfig(config);
  loadServer(config.serverUrl);
  return { ok: true };
});

ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("test-connection", async (_event, url) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${url.replace(/\/+$/, "")}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("reset-server", () => {
  const config = loadConfig();
  delete config.serverUrl;
  saveConfig(config);
  mainWindow.loadFile(path.join(__dirname, "setup.html"));
  return { ok: true };
});

// ===================== APP =====================

app.whenReady().then(() => {
  createMainWindow();
  createTray();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
