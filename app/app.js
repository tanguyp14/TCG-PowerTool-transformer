/* ═══════════════════════════════════════════════════
   CSV TOOL — Renderer (Vanilla JS, no build step)
   Communicates with main process via window.api
   ═══════════════════════════════════════════════════ */

// ─── Theme ───────────────────────────────────
const T = {
  accent: "#e85d26",
  bg: "#0e0e10",
  surface: "#18181c",
  surface2: "#222228",
  brd: "#2e2e36",
  text: "#e8e6e1",
  dim: "#8a8a94",
  green: "#4ade80",
  red: "#e85454",
  font: "'JetBrains Mono', monospace",
};

// ─── State ───────────────────────────────────
let state = {
  db: {},
  selectedGame: "",
  tab: "db", // "db" | "csv"
  editingRow: null,
  searchDB: "",
  csv: { headers: [], rows: [], processed: null, missingSets: [] },
  colMap: { price: "price", comment: "comment", location: "location", setCode: "setCode", cn: "cn" },
  outputFormat: "{setCode} - {MM-YYYY}",
  fillLocation: false,
  roundThreshold: 0.75,
};

// ─── Utils ───────────────────────────────────
function roundToHalf(p, t = state.roundThreshold) {
  const lower = Math.floor(p / 0.5) * 0.5;
  return (p - lower) >= 0.5 * t ? lower + 0.5 : lower;
}

function formatOutput(template, setCode, cn, releaseDate, setName) {
  // releaseDate is DD-MM-YYYY
  const parts = releaseDate.split("-");
  const dd = parts[0] || "", mm = parts[1] || "", yyyy = parts[2] || "";
  return template
    .replace(/\{setCode\}/g, setCode)
    .replace(/\{cn\}/g, cn)
    .replace(/\{setName\}/g, setName || "")
    .replace(/\{DD-MM-YYYY\}/g, `${dd}-${mm}-${yyyy}`)
    .replace(/\{MM-YYYY\}/g, `${mm}-${yyyy}`)
    .replace(/\{YYYY-MM-DD\}/g, `${yyyy}-${mm}-${dd}`)
    .replace(/\{DD\/MM\/YYYY\}/g, `${dd}/${mm}/${yyyy}`)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd);
}

function parseCSV(text) {
  const lines = []; let cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQ && text[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "\n" && !inQ) { lines.push(cur); cur = ""; }
    else if (c === "\r" && !inQ) { }
    else cur += c;
  }
  if (cur) lines.push(cur);
  return lines.map(line => {
    const f = []; let fd = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { fd += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { f.push(fd); fd = ""; }
      else fd += c;
    }
    f.push(fd); return f;
  });
}

function toCSVField(v) { const s = String(v ?? ""); return '"' + s.replace(/"/g, '""') + '"'; }
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

// ─── Render Engine ───────────────────────────
function render() {
  const root = document.getElementById("root");
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100vh;font-family:${T.font};background:${T.bg};color:${T.text};font-size:13px;">
      ${renderHeader()}
      <div style="display:flex;flex:1;overflow:hidden;">
        ${renderSidebar()}
        <div id="content" style="flex:1;padding:24px;overflow-y:auto;">
          ${state.selectedGame ? (state.tab === "db" ? renderGameDB() : renderCSV()) : `<div style="color:${T.dim};text-align:center;margin-top:80px;">Ajouter un jeu pour commencer</div>`}
        </div>
      </div>
    </div>
  `;
  bindEvents();
}

function renderHeader() {
  return `
    <div style="background:${T.surface};border-bottom:1px solid ${T.brd};padding:16px 24px;display:flex;align-items:center;gap:16px;-webkit-app-region:drag;">
      <div style="font-size:18px;font-weight:700;color:${T.accent};letter-spacing:-0.5px;-webkit-app-region:no-drag;">◈ CSV POWERTOOL TRANSFORMER</div>
      <div style="display:flex;gap:2px;margin-left:24px;-webkit-app-region:no-drag;">
        <button class="tab-btn" data-tab="db" style="${tabStyle(state.tab === 'db')}">Base de données</button>
        <button class="tab-btn" data-tab="csv" style="${tabStyle(state.tab === 'csv')}">Traitement CSV</button>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;-webkit-app-region:no-drag;">
        <button id="btn-dbpath" style="${btnStyle(false)}font-size:10px;">📁 Dossier DB</button>
      </div>
    </div>
  `;
}

function renderSidebar() {
  const games = Object.keys(state.db);
  return `
    <div style="width:220px;background:${T.surface};border-right:1px solid ${T.brd};padding:12px 0;overflow-y:auto;flex-shrink:0;">
      <div style="padding:4px 20px 12px;font-size:10px;font-weight:700;color:${T.dim};text-transform:uppercase;letter-spacing:1px;">Jeux</div>
      ${games.map(g => `
        <div style="display:flex;align-items:center;">
          <div class="side-item" data-game="${esc(g)}" style="${sideItemStyle(state.selectedGame === g)}flex:1;cursor:pointer;">${esc(g)}</div>
          ${games.length > 1 ? `<button class="del-game-btn" data-game="${esc(g)}" style="background:transparent;border:none;color:${T.red}88;cursor:pointer;padding:4px 8px;font-size:12px;font-family:${T.font};">✕</button>` : ""}
        </div>
      `).join("")}
      <div style="padding:8px 16px;display:flex;flex-direction:column;gap:6px;">
        <div id="new-game-area">
          <button id="btn-new-game" style="${btnStyle(false)}width:100%;">+ Nouveau jeu</button>
        </div>
        <button id="btn-import-json" style="${btnStyle(false)}width:100%;font-size:10px;">📂 Importer .json</button>
      </div>
    </div>
  `;
}

function renderGameDB() {
  const sets = state.db[state.selectedGame] || [];
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h2 style="margin:0;font-size:16px;font-weight:700;">Base de données <span style="color:${T.accent};">${esc(state.selectedGame)}</span></h2>
      <div style="display:flex;gap:8px;align-items:center;">
        <span style="background:${T.accent}22;color:${T.accent};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${sets.length} extensions</span>
      </div>
    </div>
    <div style="margin-bottom:12px;">
      <input id="search-db" type="text" placeholder="🔍 Rechercher par nom ou code..." value="${esc(state.searchDB)}" style="${inputStyle()}width:100%;padding:8px 12px;">
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th style="${thStyle()}">Set Code</th>
          <th style="${thStyle()}">Nom de l'extension</th>
          <th style="${thStyle()}">Date de sortie</th>
          <th style="${thStyle()}width:120px;">Actions</th>
        </tr></thead>
        <tbody>
          ${sets.map((s, i) => {
            if (state.searchDB) {
              const q = state.searchDB.toLowerCase();
              if (!s.name.toLowerCase().includes(q) && !s.setCode.toLowerCase().includes(q)) return "";
            }
            return state.editingRow === i ? renderEditRow(s) : renderViewRow(s, i);
          }).join("")}
          ${renderAddRow()}
        </tbody>
      </table>
    </div>
  `;
}

function renderViewRow(s, i) {
  return `
    <tr style="background:${i % 2 ? T.surface2 + '44' : 'transparent'};">
      <td style="${tdStyle()}color:${T.accent};font-weight:600;">${esc(s.setCode)}</td>
      <td style="${tdStyle()}">${esc(s.name)}</td>
      <td style="${tdStyle()}color:${T.dim};">${esc(s.releaseDate || "—")}</td>
      <td style="${tdStyle()}">
        <div style="display:flex;gap:4px;">
          <button class="edit-btn" data-idx="${i}" style="${btnStyle(false)}">✎</button>
          <button class="remove-btn" data-idx="${i}" style="${btnStyle(false)}color:${T.red};">✕</button>
        </div>
      </td>
    </tr>
  `;
}

function renderEditRow(s) {
  return `
    <tr style="background:${T.surface2}88;">
      <td style="${tdStyle()}"><input class="edit-field" data-field="setCode" value="${esc(s.setCode)}" style="${inputStyle()}width:70px;"></td>
      <td style="${tdStyle()}"><input class="edit-field" data-field="name" value="${esc(s.name)}" style="${inputStyle()}width:100%;"></td>
      <td style="${tdStyle()}"><input class="edit-field" data-field="releaseDate" value="${esc(s.releaseDate)}" placeholder="JJ-MM-AAAA" style="${inputStyle()}width:110px;"></td>
      <td style="${tdStyle()}"><button id="save-edit-btn" style="${btnStyle(true)}">✓</button></td>
    </tr>
  `;
}

function renderAddRow() {
  return `
    <tr style="background:${T.surface2}88;">
      <td style="${tdStyle()}"><input id="new-code" placeholder="Code" style="${inputStyle()}width:70px;"></td>
      <td style="${tdStyle()}"><input id="new-name" placeholder="Nom de l'extension" style="${inputStyle()}width:100%;"></td>
      <td style="${tdStyle()}"><input id="new-date" placeholder="JJ-MM-AAAA" style="${inputStyle()}width:110px;"></td>
      <td style="${tdStyle()}"><button id="add-row-btn" style="${btnStyle(true)}">+</button></td>
    </tr>
  `;
}

function renderCSV() {
  const { headers, rows, processed } = state.csv;
  const data = processed || rows;
  return `
    <h2 style="margin:0 0 16px;font-size:16px;font-weight:700;">Traitement CSV — <span style="color:${T.accent};">${esc(state.selectedGame)}</span></h2>

    <div id="dropzone" style="border:2px dashed ${T.brd};border-radius:10px;padding:40px 20px;text-align:center;color:${T.dim};cursor:pointer;margin-bottom:28px;">
      <div style="font-size:28px;margin-bottom:8px;">📂</div>
      <div>Glisser un CSV ici ou <span style="color:${T.accent};font-weight:600;">cliquer pour parcourir</span></div>
    </div>
    <input type="file" id="csv-file-input" accept=".csv" style="display:none;">

    ${headers.length > 0 ? `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
        ${["price|Colonne Prix", "comment|Colonne Comment", "location|Colonne Location", "setCode|Colonne SetCode", "cn|Colonne CN"].map(pair => {
          const [key, label] = pair.split("|");
          return `<div>
            <label style="${labelStyle()}">${label}</label>
            <select class="col-select" data-col="${key}" style="${inputStyle()}">
              ${headers.map(h => `<option value="${esc(h)}" ${state.colMap[key] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
            </select>
          </div>`;
        }).join("")}
      </div>
      <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:28px;">
        <div style="flex:1;min-width:280px;">
          <label style="${labelStyle()}">Format Comment & Location</label>
          <input id="output-format" type="text" value="${esc(state.outputFormat)}" style="${inputStyle()}width:100%;padding:8px 12px;">
          <div style="font-size:10px;color:${T.dim};margin-top:4px;">Variables : <span style="color:${T.accent};">{setCode}</span> <span style="color:${T.accent};">{cn}</span> <span style="color:${T.accent};">{DD-MM-YYYY}</span> <span style="color:${T.accent};">{MM-YYYY}</span> <span style="color:${T.accent};">{YYYY-MM-DD}</span> <span style="color:${T.accent};">{DD/MM/YYYY}</span> <span style="color:${T.accent};">{YYYY}</span> <span style="color:${T.accent};">{setName}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
          <label id="fill-location-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:${T.dim};user-select:none;">
            <input type="checkbox" id="fill-location" ${state.fillLocation ? "checked" : ""} style="accent-color:${T.accent};width:16px;height:16px;cursor:pointer;">
            Dupliquer dans Location
          </label>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:11px;color:${T.dim};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">Seuil arrondi</label>
            <input id="round-threshold" type="number" min="0.01" max="1" step="0.05" value="${state.roundThreshold}" style="${inputStyle()}width:70px;padding:6px 8px;" title="Fraction du pas 0.50 déclenchant l'arrondi supérieur (ex: 0.75 → arrondit à partir de x.375)">
          </div>
          <button id="process-btn" style="${btnStyle(true)}padding:8px 20px;">⚡ Traiter</button>
        </div>
      </div>

      <div style="margin-bottom:28px;">
        <label style="${labelStyle()}">${processed ? "Aperçu résultat" : "Aperçu import"} (${data.length} lignes)</label>
        <div style="overflow-x:auto;max-height:400px;overflow-y:auto;border-radius:8px;border:1px solid ${T.brd};">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr>${headers.map(h => `<th style="${thStyle()}position:sticky;top:0;background:${T.surface};white-space:nowrap;">${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>
              ${data.slice(0, 100).map((r, ri) => `
                <tr style="background:${ri % 2 ? T.surface2 + '44' : 'transparent'};">
                  ${r.map((c, ci) => {
                    const isP = headers[ci] === state.colMap.price && processed;
                    const isC = headers[ci] === state.colMap.comment && processed;
                    const isL = headers[ci] === state.colMap.location && processed;
                    return `<td style="${tdStyle()}white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;color:${isP ? T.green : (isC || isL) ? T.accent : T.text};font-weight:${(isP || isC || isL) ? 600 : 400};">${esc(c)}</td>`;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      ${processed && state.csv.missingSets.length > 0 ? `
        <div style="background:#e8545422;border:1px solid #e85454;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;color:#e85454;margin-bottom:8px;">⚠ ${state.csv.missingSets.length} extension(s) non trouvée(s) dans la base "${esc(state.selectedGame)}"</div>
          <div style="font-size:12px;color:${T.text};margin-bottom:10px;">Ces codes n'ont pas de correspondance — la colonne comment ne sera pas remplie pour ces lignes.</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${state.csv.missingSets.map(m => `<span style="background:${T.surface2};border:1px solid #e8545466;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;color:#e85454;">${esc(m.code)} <span style="color:${T.dim};font-weight:400;">(${m.count} carte${m.count > 1 ? 's' : ''})</span></span>`).join("")}
          </div>
        </div>
      ` : ""}

      ${processed ? `<button id="download-btn" style="${btnStyle(true)}padding:10px 24px;font-size:14px;">⬇ Télécharger le CSV traité</button>` : ""}
    ` : ""}
  `;
}

// ─── Style Helpers ───────────────────────────
function tabStyle(active) {
  return `padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:${T.font};` +
    (active ? `background:${T.accent};color:#fff;border:none;` : `background:transparent;color:${T.dim};border:1px solid ${T.brd};`);
}
function sideItemStyle(active) {
  return `padding:8px 20px;font-size:12px;font-weight:${active ? 700 : 400};` +
    `background:${active ? T.surface2 : 'transparent'};color:${active ? T.accent : T.dim};` +
    `border-left:3px solid ${active ? T.accent : 'transparent'};`;
}
function btnStyle(primary) {
  return `padding:7px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;font-family:${T.font};` +
    (primary ? `background:${T.accent};color:#fff;border:none;` : `background:transparent;color:${T.dim};border:1px solid ${T.brd};`);
}
function inputStyle() {
  return `background:${T.surface2};border:1px solid ${T.brd};border-radius:6px;padding:6px 10px;color:${T.text};font-size:12px;font-family:${T.font};outline:none;`;
}
function thStyle() {
  return `text-align:left;padding:8px 12px;border-bottom:2px solid ${T.brd};color:${T.dim};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;`;
}
function tdStyle() {
  return `padding:6px 12px;border-bottom:1px solid ${T.brd};`;
}
function labelStyle() {
  return `font-size:11px;color:${T.dim};font-weight:600;margin-bottom:6px;display:block;text-transform:uppercase;letter-spacing:0.5px;`;
}

// ─── Event Binding ───────────────────────────
function bindEvents() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => { state.tab = btn.dataset.tab; state.csv.processed = null; state.csv.missingSets = []; render(); };
  });

  // Sidebar game select
  document.querySelectorAll(".side-item").forEach(el => {
    el.onclick = () => { state.selectedGame = el.dataset.game; state.editingRow = null; state.searchDB = ""; render(); };
  });

  // Delete game
  document.querySelectorAll(".del-game-btn").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`Supprimer "${btn.dataset.game}" et son fichier ?`)) return;
      await window.api.deleteGame(btn.dataset.game);
      delete state.db[btn.dataset.game];
      state.selectedGame = Object.keys(state.db)[0] || "";
      render();
      toast("Jeu supprimé");
    };
  });

  // New game
  const newGameBtn = document.getElementById("btn-new-game");
  if (newGameBtn) {
    newGameBtn.onclick = () => {
      const area = document.getElementById("new-game-area");
      area.innerHTML = `
        <div style="display:flex;gap:4px;">
          <input id="new-game-input" placeholder="Nom du jeu" style="${inputStyle()}flex:1;">
          <button id="confirm-new-game" style="${btnStyle(true)}">+</button>
        </div>
      `;
      const input = document.getElementById("new-game-input");
      input.focus();
      const confirm = async () => {
        const name = input.value.trim();
        if (!name || state.db[name]) return;
        state.db[name] = [];
        await window.api.saveGame(name, []);
        state.selectedGame = name;
        render();
        toast(`Jeu "${name}" créé + fichier JSON`);
      };
      document.getElementById("confirm-new-game").onclick = confirm;
      input.onkeydown = (e) => { if (e.key === "Enter") confirm(); };
    };
  }

  // Import JSON
  const importBtn = document.getElementById("btn-import-json");
  if (importBtn) {
    importBtn.onclick = async () => {
      const result = await window.api.importJSON();
      if (!result) return;
      if (result.error) { alert(result.error); return; }
      state.db[result.name] = result.sets;
      state.selectedGame = result.name;
      render();
      toast(`"${result.name}" importé`);
    };
  }

  // DB path
  const dbPathBtn = document.getElementById("btn-dbpath");
  if (dbPathBtn) {
    dbPathBtn.onclick = async () => {
      const p = await window.api.getDbPath();
      toast(`📁 ${p}`);
    };
  }

  // ── Game DB events ──
  // Search
  const searchInput = document.getElementById("search-db");
  if (searchInput) {
    searchInput.oninput = (e) => { state.searchDB = e.target.value; render(); };
    // Restore cursor position after render
    setTimeout(() => {
      const el = document.getElementById("search-db");
      if (el && state.searchDB) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 0);
  }

  // Edit row
  document.querySelectorAll(".edit-btn").forEach(btn => {
    btn.onclick = () => { state.editingRow = parseInt(btn.dataset.idx); render(); };
  });

  // Save edit
  const saveEditBtn = document.getElementById("save-edit-btn");
  if (saveEditBtn) {
    saveEditBtn.onclick = async () => {
      const fields = document.querySelectorAll(".edit-field");
      const sets = state.db[state.selectedGame];
      fields.forEach(f => { sets[state.editingRow][f.dataset.field] = f.value; });
      await window.api.saveGame(state.selectedGame, sets);
      state.editingRow = null;
      render();
      toast("Modifié ✓");
    };
  }

  // Remove row
  document.querySelectorAll(".remove-btn").forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx);
      state.db[state.selectedGame].splice(idx, 1);
      await window.api.saveGame(state.selectedGame, state.db[state.selectedGame]);
      render();
      toast("Extension supprimée");
    };
  });

  // Add row
  const addBtn = document.getElementById("add-row-btn");
  if (addBtn) {
    addBtn.onclick = async () => {
      const code = document.getElementById("new-code").value.trim();
      const name = document.getElementById("new-name").value.trim();
      const date = document.getElementById("new-date").value.trim();
      if (!code || !name) return;
      state.db[state.selectedGame].push({ setCode: code, name, releaseDate: date });
      await window.api.saveGame(state.selectedGame, state.db[state.selectedGame]);
      render();
      toast("Extension ajoutée ✓");
    };
  }

  // ── CSV events ──
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("csv-file-input");
  if (dropzone) {
    dropzone.onclick = () => fileInput.click();
    dropzone.ondragover = (e) => e.preventDefault();
    dropzone.ondrop = (e) => { e.preventDefault(); handleCSVFile(e.dataTransfer.files[0]); };
  }
  if (fileInput) {
    fileInput.onchange = () => handleCSVFile(fileInput.files[0]);
  }

  // Column selects
  document.querySelectorAll(".col-select").forEach(sel => {
    sel.onchange = () => { state.colMap[sel.dataset.col] = sel.value; };
  });

  // Format template
  const formatInput = document.getElementById("output-format");
  if (formatInput) {
    formatInput.oninput = (e) => { state.outputFormat = e.target.value; };
  }

  // Fill location checkbox
  const fillLocCb = document.getElementById("fill-location");
  if (fillLocCb) {
    fillLocCb.onchange = (e) => { state.fillLocation = e.target.checked; };
  }

  // Round threshold
  const roundThresholdInput = document.getElementById("round-threshold");
  if (roundThresholdInput) {
    roundThresholdInput.oninput = (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0 && v <= 1) state.roundThreshold = v;
    };
  }

  // Process
  const processBtn = document.getElementById("process-btn");
  if (processBtn) processBtn.onclick = processCSV;

  // Download
  const downloadBtn = document.getElementById("download-btn");
  if (downloadBtn) downloadBtn.onclick = downloadCSV;
}

// ─── CSV Logic ───────────────────────────────
function handleCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const parsed = parseCSV(e.target.result);
    if (parsed.length < 2) return;
    const h = parsed[0].map(s => s.replace(/^\uFEFF/, ""));
    state.csv.headers = h;
    state.csv.rows = parsed.slice(1).filter(r => r.some(c => c.trim()));
    state.csv.processed = null;
    state.csv.missingSets = [];
    // Auto-detect columns
    if (h.includes("price")) state.colMap.price = "price";
    if (h.includes("comment")) state.colMap.comment = "comment";
    if (h.includes("location")) state.colMap.location = "location";
    if (h.includes("setCode")) state.colMap.setCode = "setCode";
    if (h.includes("cn")) state.colMap.cn = "cn";
    render();
    toast(`${state.csv.rows.length} lignes importées`);
  };
  reader.readAsText(file);
}

function processCSV() {
  const { headers, rows } = state.csv;
  const sets = state.db[state.selectedGame] || [];
  const setMap = {}; sets.forEach(s => { setMap[s.setCode] = s; });
  const { price, comment, location, setCode, cn } = state.colMap;
  const pi = headers.indexOf(price), ci = headers.indexOf(comment),
    li = headers.indexOf(location), si = headers.indexOf(setCode), ni = headers.indexOf(cn);

  const missingMap = {};
  const processed = rows.map(row => {
    const r = [...row];
    // Round price
    if (pi >= 0) { const v = parseFloat(r[pi]); if (!isNaN(v)) r[pi] = String(roundToHalf(v)); }
    // Build formatted string for comment & location
    if (si >= 0) {
      const code = r[si], cnVal = ni >= 0 ? r[ni] : "", info = setMap[code];
      if (info && info.releaseDate) {
        const formatted = formatOutput(state.outputFormat, code, cnVal, info.releaseDate, info.name);
        if (ci >= 0) r[ci] = formatted;
        if (li >= 0 && state.fillLocation) r[li] = formatted;
      } else if (code) {
        if (!missingMap[code]) missingMap[code] = 0;
        missingMap[code]++;
      }
    }
    return r;
  });

  // Sort by setCode (group by extension)
  if (si >= 0) {
    processed.sort((a, b) => {
      const codeA = a[si] || "", codeB = b[si] || "";
      return codeA.localeCompare(codeB);
    });
  }

  state.csv.missingSets = Object.entries(missingMap).map(([code, count]) => ({ code, count })).sort((a, b) => a.code.localeCompare(b.code));
  state.csv.processed = processed;
  render();
  toast("CSV traité ✓");
}

function downloadCSV() {
  const { headers, processed } = state.csv;
  if (!processed) return;
  const lines = [headers.map(toCSVField).join(",")];
  processed.forEach(r => lines.push(r.map(toCSVField).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `export-${state.selectedGame}-processed.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV téléchargé ⬇");
}

// ─── Boot ────────────────────────────────────
(async function init() {
  try {
    state.db = await window.api.getAll();
  } catch {
    state.db = { "Pokémon": [] };
  }
  const games = Object.keys(state.db);
  state.selectedGame = games[0] || "";
  render();
})();
