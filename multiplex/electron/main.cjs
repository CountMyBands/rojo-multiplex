const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const hiddenAtLaunch = process.argv.includes("--hidden");
const hasLock = app.requestSingleInstanceLock();
let mainWindow = null;
let tray = null;
let managerModule = null;
let managerOrigin = null;
let configPath = null;
let quitting = false;

if (!hasLock) app.quit();
else app.on("second-instance", () => showWindow());

function fallbackIcon(color = "#e13835") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1a1a19"/><rect x="7" y="7" width="8" height="8" fill="${color}"/><rect x="17" y="17" width="8" height="8" fill="${color}"/><path d="M13 11h5a3 3 0 0 1 3 3v4M19 21h-5a3 3 0 0 1-3-3v-5" fill="none" stroke="white" stroke-width="2"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({ width: 20, height: 20 });
}

function assetPath(name) {
  return app.isPackaged ? path.join(process.resourcesPath, "assets", name) : path.join(app.getAppPath(), "electron", "assets", name);
}

function appIcon() {
  const loaded = nativeImage.createFromPath(assetPath("icon.png"));
  return loaded.isEmpty() ? fallbackIcon() : loaded;
}

function prepareConfig() {
  const dataRoot = app.isPackaged ? app.getPath("userData") : app.getAppPath();
  fs.mkdirSync(dataRoot, { recursive: true });
  configPath = path.join(dataRoot, "rojo-multiplex.json");
  if (!fs.existsSync(configPath)) {
    const source = path.join(app.getAppPath(), "rojo-multiplex.example.json");
    fs.copyFileSync(source, configPath);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  managerOrigin = `http://127.0.0.1:${Number(config.managerPort) || 34871}`;
}

async function ensureManager() {
  if (managerModule) return;
  const managerPath = path.join(app.getAppPath(), "manager.mjs");
  const bundledRojo = app.isPackaged ? path.join(process.resourcesPath, "rojo.exe") : path.join(app.getAppPath(), "bin", "rojo.exe");
  if (fs.existsSync(bundledRojo)) process.env.ROJO_MULTIPLEX_ROJO = bundledRojo;
  process.env.ROJO_MULTIPLEX_EMBEDDED = "1";
  managerModule = await import(pathToFileURL(managerPath).href);
  await managerModule.start({ configPath });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    title: "Rojo Multiplex",
    backgroundColor: "#0d0d0d",
    autoHideMenuBar: true,
    show: false,
    icon: assetPath("icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.once("ready-to-show", () => { if (!hiddenAtLaunch) showWindow(); });
  void mainWindow.loadURL(`${managerOrigin}/`);
}

function createTray() {
  tray = new Tray(appIcon().resize({ width: 20, height: 20, quality: "best" }));
  tray.setToolTip("Rojo Multiplex");
  tray.on("click", showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Rojo Multiplex", click: showWindow },
    { type: "separator" },
    { label: "Launch at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"] }) },
    { type: "separator" },
    { label: "Quit", click: () => void quitApp() },
  ]));
}

ipcMain.handle("select-project", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add a Rojo project",
    properties: ["openFile"],
    filters: [
      { name: "Rojo project files", extensions: ["json", "jsonc"] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("install-plugin", async () => {
  let pluginSource = app.isPackaged
    ? path.join(process.resourcesPath, "RojoMultiplex.rbxm")
    : path.join(app.getAppPath(), "..", "build", "RojoMultiplex.rbxm");

  if (!fs.existsSync(pluginSource) && !app.isPackaged) {
    const repoRoot = path.resolve(app.getAppPath(), "..");
    fs.mkdirSync(path.dirname(pluginSource), { recursive: true });
    const result = spawnSync("rojo", ["build", path.join(repoRoot, "plugin.project.json"), "--output", pluginSource], { windowsHide: true, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Rojo plugin build failed.");
  }
  if (!fs.existsSync(pluginSource)) throw new Error("The packaged Studio plugin is missing.");
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is unavailable.");
  const pluginsFolder = path.join(localAppData, "Roblox", "Plugins");
  fs.mkdirSync(pluginsFolder, { recursive: true });
  fs.copyFileSync(pluginSource, path.join(pluginsFolder, "RojoMultiplex.rbxm"));
  return { ok: true, path: pluginsFolder };
});

async function quitApp() {
  if (quitting) return;
  quitting = true;
  if (managerModule) await managerModule.shutdown();
  app.quit();
}

if (hasLock) {
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.rojomultiplex.manager");
    Menu.setApplicationMenu(null);
    prepareConfig();
    await ensureManager();
    createWindow();
    createTray();
  }).catch((error) => {
    dialog.showErrorBox("Rojo Multiplex failed to start", error.stack || error.message);
    app.quit();
  });
  app.on("activate", showWindow);
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void quitApp();
  });
}
