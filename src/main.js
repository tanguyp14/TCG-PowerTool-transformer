const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// ─── Database path ───────────────────────────
// In production: userData/database/ (writable, persists across updates)
// In dev: ./app/database/
function getDbPath() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "database");
  }
  return path.join(__dirname, "..", "app", "database");
}

// Seed: copy default DB from resources on first launch
function getSeedPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "database");
  }
  return path.join(__dirname, "..", "app", "database");
}

function ensureDbDir() {
  const dir = getDbPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Copy any seed files not yet present in userData (handles new games added in updates)
  const seed = getSeedPath();
  if (fs.existsSync(seed)) {
    const files = fs.readdirSync(seed);
    for (const f of files) {
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) {
        try {
          fs.copyFileSync(path.join(seed, f), dest);
        } catch {}
      }
    }
  }
  const manifest = path.join(dir, "games.json");
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, "[]", "utf-8");
  return dir;
}

// ─── IPC Handlers ────────────────────────────

ipcMain.handle("db:getAll", async () => {
  const dir = ensureDbDir();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "games.json"), "utf-8"));
  const db = {};
  for (const entry of manifest) {
    const filePath = path.join(dir, entry.file);
    try {
      db[entry.name] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      db[entry.name] = [];
    }
  }
  return db;
});

ipcMain.handle("db:saveGame", async (_event, gameName, sets) => {
  const dir = ensureDbDir();
  const fileName = gameName.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüÿç]+/g, "-").replace(/-+$/, "") + ".json";
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(sets, null, 2), "utf-8");

  const manifestPath = path.join(dir, "games.json");
  let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const existing = manifest.find((m) => m.name === gameName);
  if (existing) {
    existing.file = fileName;
  } else {
    manifest.push({ name: gameName, file: fileName });
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return { ok: true, file: fileName };
});

ipcMain.handle("db:deleteGame", async (_event, gameName) => {
  const dir = ensureDbDir();
  const manifestPath = path.join(dir, "games.json");
  let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entry = manifest.find((m) => m.name === gameName);
  if (entry) {
    const filePath = path.join(dir, entry.file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    manifest = manifest.filter((m) => m.name !== gameName);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }
  return { ok: true };
});

ipcMain.handle("db:renameGame", async (_event, oldName, newName) => {
  const dir = ensureDbDir();
  const manifestPath = path.join(dir, "games.json");
  let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const entry = manifest.find((m) => m.name === oldName);
  if (entry) {
    const oldPath = path.join(dir, entry.file);
    const data = fs.existsSync(oldPath) ? fs.readFileSync(oldPath, "utf-8") : "[]";
    const newFile = newName.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôùûüÿç]+/g, "-").replace(/-+$/, "") + ".json";
    fs.writeFileSync(path.join(dir, newFile), data, "utf-8");
    if (fs.existsSync(oldPath) && entry.file !== newFile) fs.unlinkSync(oldPath);
    entry.name = newName;
    entry.file = newFile;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }
  return { ok: true };
});

ipcMain.handle("db:importJSON", async () => {
  const dir = ensureDbDir();
  const result = await dialog.showOpenDialog({
    title: "Importer une base de données JSON",
    filters: [{ name: "JSON", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const srcPath = result.filePaths[0];
  const baseName = path.basename(srcPath, ".json");
  const gameName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

  try {
    const data = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
    if (!Array.isArray(data)) throw new Error("Not an array");

    const fileName = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
    fs.writeFileSync(path.join(dir, fileName), JSON.stringify(data, null, 2), "utf-8");

    const manifestPath = path.join(dir, "games.json");
    let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!manifest.find((m) => m.name === gameName)) {
      manifest.push({ name: gameName, file: fileName });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    }
    return { name: gameName, sets: data };
  } catch {
    return { error: "Fichier JSON invalide" };
  }
});

ipcMain.handle("db:getPath", async () => {
  return getDbPath();
});

// ─── Window ──────────────────────────────────
function createWindow() {
  const isWin = process.platform === "win32";

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e0e10",
    ...(isWin ? {} : { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 16 } }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // __dirname is src/, index.html is in app/ (sibling folder)
  win.loadFile(path.join(__dirname, "..", "app", "index.html"));

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
