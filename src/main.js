const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");

const API_URL = process.env.API_URL || (app.isPackaged
  ? "https://csv-api-production-953b.up.railway.app"
  : "http://localhost:3001");

// ─── Token storage (safeStorage) ─────────────
function tokenPath() {
  return path.join(app.getPath("userData"), "auth.token");
}

function saveToken(token) {
  const p = tokenPath();
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(p, safeStorage.encryptString(token));
  } else {
    fs.writeFileSync(p, token, "utf-8");
  }
}

function loadToken() {
  const p = tokenPath();
  if (!fs.existsSync(p)) return null;
  try {
    const data = fs.readFileSync(p);
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(data);
    return data.toString("utf-8");
  } catch { return null; }
}

function clearToken() {
  const p = tokenPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ─── API helper ──────────────────────────────
async function apiFetch(method, route, body, token) {
  const res = await fetch(`${API_URL}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur API");
  return data;
}

// ─── Auth IPC ────────────────────────────────
ipcMain.handle("auth:getUser", async () => {
  const token = loadToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (payload.exp * 1000 < Date.now()) { clearToken(); return null; }
    return { user: { id: payload.id, username: payload.username }, token };
  } catch { clearToken(); return null; }
});

ipcMain.handle("auth:login", async (_e, username, password) => {
  const data = await apiFetch("POST", "/auth/login", { username, password });
  saveToken(data.token);
  return { user: data.user };
});

ipcMain.handle("auth:logout", () => {
  clearToken();
  return { ok: true };
});

// ─── DB IPC (→ API) ──────────────────────────
ipcMain.handle("db:ping", async () => {
  const token = loadToken();
  if (!token) throw new Error("Non authentifié");
  return apiFetch("GET", "/db/ping", undefined, token);
});

ipcMain.handle("db:getAll", async () => {
  const token = loadToken();
  if (!token) throw new Error("Non authentifié");
  return apiFetch("GET", "/db/all", undefined, token);
});

ipcMain.handle("db:saveGame", async (_e, gameName, sets) => {
  const token = loadToken();
  if (!token) throw new Error("Non authentifié");
  return apiFetch("POST", `/db/game/${encodeURIComponent(gameName)}`, { sets }, token);
});

ipcMain.handle("db:deleteGame", async (_e, gameName) => {
  const token = loadToken();
  if (!token) throw new Error("Non authentifié");
  return apiFetch("DELETE", `/db/game/${encodeURIComponent(gameName)}`, undefined, token);
});

ipcMain.handle("db:renameGame", async (_e, oldName, newName) => {
  const token = loadToken();
  if (!token) throw new Error("Non authentifié");
  return apiFetch("PUT", "/db/game/rename", { oldName, newName }, token);
});

ipcMain.handle("db:importJSON", async () => {
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
    const token = loadToken();
    if (!token) throw new Error("Non authentifié");
    await apiFetch("POST", `/db/game/${encodeURIComponent(gameName)}`, { sets: data }, token);
    return { name: gameName, sets: data };
  } catch (err) {
    return { error: err.message || "Fichier JSON invalide" };
  }
});

ipcMain.handle("db:getPath", async () => API_URL);

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

  win.loadFile(path.join(__dirname, "..", "app", "index.html"));

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
