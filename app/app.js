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
  user: null,
  db: {},
  selectedGame: "",
  tab: "db", // "db" | "csv"
  editingRow: null,
  searchDB: "",
  csv: { headers: [], rows: [], processed: null, missingSets: [], codeMismatches: [], nameMismatches: [], noDateSets: [] },
  colMap: { price: "price", comment: "comment", location: "location", setCode: "setCode", cn: "cn", setName: "" },
  outputFormat: "{setCode} - {MM-YYYY}",
  fillLocation: false,
  roundThreshold: 0.75,
  showErrorsOnly: false,
  tableScrollTop: 0,
};

// ─── Utils ───────────────────────────────────

// Migration : anciens fichiers ont "name", nouveaux ont "nameFR"/"nameEN"
function normEntry(s) {
  return {
    setCode:     s.setCode     || "",
    nameFR:      s.nameFR      ?? s.name ?? "",
    nameEN:      s.nameEN      ?? "",
    releaseDate: s.releaseDate || "",
  };
}

function roundToHalf(p, t = state.roundThreshold) {
  if (p <= 0)    return 0;
  if (p <= 0.50) return p;     // 0–0.50€ : garde le prix
  if (p < 0.75)  return 0.50;  // 0.50–0.75€ : revient à 0.50€
  if (p < 1)     return 1;     // 0.75–1€ : passe à 1€
  const base = Math.floor(p);
  const dec  = p - base;
  if (dec >= t)      return base + 1;
  if (dec >= 1 - t)  return base + 0.5;
  return base;
}

const DATE_PLACEHOLDER = "DATE_NON_DEFINI";
const DATE_TOKENS = /\{DD-MM-YYYY\}|\{MM-YYYY\}|\{YYYY-MM-DD\}|\{DD\/MM\/YYYY\}|\{YYYY\}|\{MM\}|\{DD\}/g;

function formatOutput(template, setCode, cn, releaseDate, nameFR, nameEN) {
  const base = template
    .replace(/\{setCode\}/g, setCode)
    .replace(/\{cn\}/g, cn)
    .replace(/\{setName\}/g, nameFR || nameEN || "")
    .replace(/\{nameFR\}/g, nameFR || "")
    .replace(/\{nameEN\}/g, nameEN || "");
  if (!releaseDate) return base.replace(DATE_TOKENS, DATE_PLACEHOLDER);
  const parts = releaseDate.split("-");
  const dd = parts[0] || "", mm = parts[1] || "", yyyy = parts[2] || "";
  return base
    .replace(/\{DD-MM-YYYY\}/g, `${dd}-${mm}-${yyyy}`)
    .replace(/\{MM-YYYY\}/g, `${mm}-${yyyy}`)
    .replace(/\{YYYY-MM-DD\}/g, `${yyyy}-${mm}-${dd}`)
    .replace(/\{DD\/MM\/YYYY\}/g, `${dd}/${mm}/${yyyy}`)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{MM\}/g, mm)
    .replace(/\{DD\}/g, dd);
}

function detectDelimiter(firstLine) {
  // Compte les délimiteurs hors guillemets sur la première ligne
  let commas = 0, semis = 0, inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i];
    if (c === '"') { if (inQ && firstLine[i + 1] === '"') i++; else inQ = !inQ; }
    else if (!inQ) { if (c === ',') commas++; else if (c === ';') semis++; }
  }
  return semis > commas ? ';' : ',';
}

function parseCSV(text) {
  // Découpe en lignes en respectant les champs quotés — les guillemets sont CONSERVÉS
  const lines = []; let cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '""'; i++; } // guillemet échappé ""
      else { inQ = !inQ; cur += c; }                         // guillemet ouvrant/fermant
    } else if (c === "\n" && !inQ) { lines.push(cur); cur = ""; }
    else if (c === "\r" && !inQ) { }
    else cur += c;
  }
  if (cur) lines.push(cur);
  const delim = detectDelimiter((lines[0] || "").replace(/^\uFEFF/, ""));
  return lines.map(line => {
    const f = []; let fd = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { fd += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { f.push(fd); fd = ""; }
      else fd += c;
    }
    f.push(fd); return f;
  });
}

function toCSVField(v) { const s = String(v ?? ""); return '"' + s.replace(/"/g, '""') + '"'; }
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function showSpinner(label = "Chargement…") {
  const el = document.getElementById("spinner");
  document.getElementById("spinner-label").textContent = label;
  el.classList.add("show");
}
function hideSpinner() {
  document.getElementById("spinner").classList.remove("show");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

// ─── Virtual scroll ──────────────────────────
const ROW_H = 29;      // hauteur fixe par ligne (px)
const TABLE_VH = 400;  // hauteur visible du conteneur (px)
const V_BUFFER = 30;   // lignes tampon au-dessus/en-dessous

let _tableCache = null; // { data, headers, missingCodes, noDateCodes, si }

function renderTableRows(scrollTop) {
  if (!_tableCache) return "";
  const { data, headers, missingCodes, noDateCodes, si } = _tableCache;
  const total = data.length;
  const processed = state.csv.processed !== null;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - V_BUFFER);
  const end   = Math.min(total, Math.ceil((scrollTop + TABLE_VH) / ROW_H) + V_BUFFER);
  const padTop = start * ROW_H;
  const padBot = (total - end) * ROW_H;
  const cols = headers.length;

  return `
    ${padTop > 0 ? `<tr style="height:${padTop}px;">${Array(cols).fill(`<td style="padding:0;border:none;"></td>`).join("")}</tr>` : ""}
    ${data.slice(start, end).map((r, i) => {
      const ri = start + i;
      const isMissing = processed && si >= 0 && missingCodes.has(r[si]);
      const isNoDate  = processed && si >= 0 && noDateCodes.has(r[si]);
      const bg = isMissing ? "#e8545418" : isNoDate ? "#facc1510" : (ri % 2 ? T.surface2 + "44" : "transparent");
      const bord = isMissing ? `border-left:2px solid ${T.red};` : isNoDate ? `border-left:2px solid #facc15;` : "";
      return `<tr style="height:${ROW_H}px;background:${bg};${bord}">
        ${r.map((c, ci) => {
          const isP = headers[ci] === state.colMap.price && processed;
          const isC = headers[ci] === state.colMap.comment && processed;
          const isL = headers[ci] === state.colMap.location && processed;
          const isS = ci === si && isMissing;
          return `<td style="${tdStyle()}white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;color:${isS?T.red:isP?T.green:(isC||isL)?T.accent:T.text};font-weight:${(isP||isC||isL||isS)?600:400};">${esc(c)}</td>`;
        }).join("")}
      </tr>`;
    }).join("")}
    ${padBot > 0 ? `<tr style="height:${padBot}px;">${Array(cols).fill(`<td style="padding:0;border:none;"></td>`).join("")}</tr>` : ""}
  `;
}

// ─── Render Engine ───────────────────────────
function render() {
  const scrollTop = document.getElementById("content")?.scrollTop ?? 0;
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
  const content = document.getElementById("content");
  if (content) content.scrollTop = scrollTop;
}

function renderHeader() {
  return `
    <div style="background:${T.surface};border-bottom:1px solid ${T.brd};padding:16px 24px;display:flex;align-items:center;gap:16px;-webkit-app-region:drag;">
      <div style="font-size:18px;font-weight:700;color:${T.accent};letter-spacing:-0.5px;-webkit-app-region:no-drag;">◈ CSV POWERTOOL TRANSFORMER</div>
      <div style="display:flex;gap:2px;margin-left:24px;-webkit-app-region:no-drag;">
        <button class="tab-btn" data-tab="db" style="${tabStyle(state.tab === 'db')}">Base de données</button>
        <button class="tab-btn" data-tab="csv" style="${tabStyle(state.tab === 'csv')}">Traitement CSV</button>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:12px;-webkit-app-region:no-drag;">
        <span style="font-size:11px;color:${T.dim};">${esc(state.user?.email || "")}</span>
        <button id="btn-logout" style="${btnStyle(false)}font-size:10px;color:${T.red};">Déconnexion</button>
      </div>
    </div>
  `;
}

function renderSidebar() {
  const games = Object.keys(state.db);
  return `
    <div style="width:220px;background:${T.surface};border-right:1px solid ${T.brd};flex-shrink:0;display:flex;flex-direction:column;">
      <div style="flex:1;overflow-y:auto;padding:12px 0;">
        <div style="padding:4px 20px 12px;font-size:10px;font-weight:700;color:${T.dim};text-transform:uppercase;letter-spacing:1px;">Jeux</div>
        ${games.map(g => `
          <div style="display:flex;align-items:center;">
            <div class="side-item" data-game="${esc(g)}" style="${sideItemStyle(state.selectedGame === g)}flex:1;cursor:pointer;">${esc(g)}</div>
            <button class="ren-game-btn" data-game="${esc(g)}" style="background:transparent;border:none;color:${T.dim};cursor:pointer;padding:4px 4px;font-size:11px;font-family:${T.font};" title="Renommer">✏</button>
            ${games.length > 1 ? `<button class="del-game-btn" data-game="${esc(g)}" style="background:transparent;border:none;color:${T.red}88;cursor:pointer;padding:4px 6px;font-size:12px;font-family:${T.font};">✕</button>` : ""}
          </div>
        `).join("")}
        <div style="padding:8px 16px;display:flex;flex-direction:column;gap:6px;">
          <div id="new-game-area">
            <button id="btn-new-game" style="${btnStyle(false)}width:100%;">+ Nouveau jeu</button>
          </div>
          <div style="height:1px;background:${T.brd};margin:4px 0;"></div>
          ${state.selectedGame ? `<button id="btn-export-game" style="${btnStyle(false)}width:100%;font-size:10px;">⬇ Exporter "${esc(state.selectedGame)}"</button>` : ""}
          <button id="btn-import-json" style="${btnStyle(false)}width:100%;font-size:10px;">📂 Importer un jeu</button>
          <div style="height:1px;background:${T.brd};margin:4px 0;"></div>
          <button id="btn-export-all" style="${btnStyle(false)}width:100%;font-size:10px;">⬇ Exporter tous les jeux</button>
          <button id="btn-import-bundle" style="${btnStyle(false)}width:100%;font-size:10px;">📦 Importer tous les jeux</button>
          <input type="file" id="bundle-file-input" accept=".json" style="display:none;">
        </div>
      </div>

      <div style="border-top:1px solid ${T.brd};padding:14px 16px;">
        <img src="./logo.png" alt="logo" style="width:64px;opacity:0.85;margin-bottom:10px;display:block;">
        <div style="font-size:10px;color:${T.dim};font-style:italic;margin-bottom:8px;">Besoin d'aide ? Un ajout ?</div>
        <a href="mailto:tanguy@le-tengu.fr" style="display:block;font-size:10px;color:${T.accent};text-decoration:none;margin-bottom:3px;">tanguy@le-tengu.fr</a>
        <div style="font-size:10px;color:${T.dim};">06 72 10 39 93</div>
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
          <th style="${thStyle()}">Nom FR</th>
          <th style="${thStyle()}">Nom EN</th>
          <th style="${thStyle()}">Date de sortie</th>
          <th style="${thStyle()}width:120px;">Actions</th>
        </tr></thead>
        <tbody>
          ${sets.map((s, i) => {
            const e = normEntry(s);
            if (state.searchDB) {
              const q = state.searchDB.toLowerCase();
              if (!e.nameFR.toLowerCase().includes(q) && !e.nameEN.toLowerCase().includes(q) && !e.setCode.toLowerCase().includes(q)) return "";
            }
            return state.editingRow === i ? renderEditRow(e) : renderViewRow(e, i);
          }).join("")}
          ${renderAddRow()}
        </tbody>
      </table>
    </div>
  `;
}

function renderViewRow(e, i) {
  return `
    <tr style="background:${i % 2 ? T.surface2 + '44' : 'transparent'};">
      <td style="${tdStyle()}color:${T.accent};font-weight:600;">${esc(e.setCode)}</td>
      <td style="${tdStyle()}">${esc(e.nameFR)}</td>
      <td style="${tdStyle()}color:${T.dim};">${esc(e.nameEN)}</td>
      <td style="${tdStyle()}color:${T.dim};">${esc(e.releaseDate || "—")}</td>
      <td style="${tdStyle()}">
        <div style="display:flex;gap:4px;">
          <button class="edit-btn" data-idx="${i}" style="${btnStyle(false)}">✎</button>
          <button class="remove-btn" data-idx="${i}" style="${btnStyle(false)}color:${T.red};">✕</button>
        </div>
      </td>
    </tr>
  `;
}

function renderEditRow(e) {
  return `
    <tr style="background:${T.surface2}88;">
      <td style="${tdStyle()}"><input class="edit-field" data-field="setCode" value="${esc(e.setCode)}" style="${inputStyle()}width:70px;"></td>
      <td style="${tdStyle()}"><input class="edit-field" data-field="nameFR" value="${esc(e.nameFR)}" placeholder="Nom FR" style="${inputStyle()}width:100%;"></td>
      <td style="${tdStyle()}"><input class="edit-field" data-field="nameEN" value="${esc(e.nameEN)}" placeholder="Nom EN" style="${inputStyle()}width:100%;"></td>
      <td style="${tdStyle()}"><input class="edit-field" data-field="releaseDate" value="${esc(e.releaseDate)}" placeholder="JJ-MM-AAAA" style="${inputStyle()}width:110px;"></td>
      <td style="${tdStyle()}"><button id="save-edit-btn" style="${btnStyle(true)}">✓</button></td>
    </tr>
  `;
}

function renderAddRow() {
  return `
    <tr style="background:${T.surface2}88;">
      <td style="${tdStyle()}"><input id="new-code" placeholder="Code" style="${inputStyle()}width:70px;"></td>
      <td style="${tdStyle()}"><input id="new-name-fr" placeholder="Nom FR" style="${inputStyle()}width:100%;"></td>
      <td style="${tdStyle()}"><input id="new-name-en" placeholder="Nom EN" style="${inputStyle()}width:100%;"></td>
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
        <div>
          <label style="${labelStyle()}">Nom Extension</label>
          <select class="col-select" data-col="setName" style="${inputStyle()}">
            <option value="" ${!state.colMap.setName ? "selected" : ""}>— Aucune —</option>
            ${headers.map(h => `<option value="${esc(h)}" ${state.colMap.setName === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:28px;">
        <div style="flex:1;min-width:280px;">
          <label style="${labelStyle()}">Format Comment & Location</label>
          <input id="output-format" type="text" value="${esc(state.outputFormat)}" style="${inputStyle()}width:100%;padding:8px 12px;">
          <div style="font-size:10px;color:${T.dim};margin-top:4px;">Variables : <span style="color:${T.accent};">{setCode}</span> <span style="color:${T.accent};">{cn}</span> <span style="color:${T.accent};">{nameFR}</span> <span style="color:${T.accent};">{nameEN}</span> <span style="color:${T.accent};">{setName}</span> <span style="color:${T.accent};">{DD-MM-YYYY}</span> <span style="color:${T.accent};">{MM-YYYY}</span> <span style="color:${T.accent};">{YYYY-MM-DD}</span> <span style="color:${T.accent};">{DD/MM/YYYY}</span> <span style="color:${T.accent};">{YYYY}</span></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
          <label id="fill-location-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:${T.dim};user-select:none;">
            <input type="checkbox" id="fill-location" ${state.fillLocation ? "checked" : ""} style="accent-color:${T.accent};width:16px;height:16px;cursor:pointer;">
            Dupliquer dans Location
          </label>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:11px;color:${T.dim};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">Seuil arrondi</label>
            <input id="round-threshold" type="number" min="0.01" max="0.99" step="0.05" value="${state.roundThreshold}" style="${inputStyle()}width:70px;padding:6px 8px;">
            <div style="position:relative;display:inline-block;">
              <div id="threshold-info-btn" style="width:18px;height:18px;border-radius:50%;background:${T.surface2};border:1px solid ${T.brd};color:${T.dim};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:default;user-select:none;">?</div>
              <div id="threshold-tooltip" style="display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:${T.surface};border:1px solid ${T.brd};border-radius:8px;padding:10px 14px;z-index:999;min-width:180px;box-shadow:0 4px 16px #00000066;">
                <div style="font-size:11px;color:${T.dim};margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Exemples (seuil ${state.roundThreshold})</div>
                <table style="border-collapse:collapse;font-size:12px;width:100%;">
                  <thead><tr>
                    <th style="color:${T.dim};font-weight:600;text-align:left;padding:2px 8px 4px 0;">Prix</th>
                    <th style="color:${T.dim};font-weight:600;text-align:left;padding:2px 8px 4px;">→</th>
                    <th style="color:${T.dim};font-weight:600;text-align:left;padding:2px 0 4px;">Résultat</th>
                  </tr></thead>
                  <tbody>
                    ${(() => {
                      const t = state.roundThreshold;
                      const lT = +(1 - t).toFixed(2);
                      const prices = [
                        +(lT - 0.01).toFixed(2),
                        lT,
                        +(t  - 0.01).toFixed(2),
                        +t.toFixed(2),
                        +(1 + lT).toFixed(2),
                        +(1 + t ).toFixed(2),
                      ].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
                      return prices.map(p => {
                        const r = roundToHalf(p, t);
                        const changed = r !== p;
                        return `<tr>
                          <td style="padding:2px 8px 2px 0;color:${T.dim};">${p.toFixed(2)} €</td>
                          <td style="padding:2px 8px;color:${T.dim};">→</td>
                          <td style="padding:2px 0;color:${changed ? T.green : T.text};font-weight:${changed ? 600 : 400};">${r.toFixed(2)} €</td>
                        </tr>`;
                      }).join("");
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <button id="process-btn" style="${btnStyle(true)}padding:8px 20px;">⚡ Traiter</button>
        </div>
      </div>

      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <label style="${labelStyle()}margin-bottom:0;">${processed ? "Aperçu résultat" : "Aperçu import"} (${state.showErrorsOnly && processed ? state.csv.missingSets.reduce((s,m)=>s+m.count,0) + "/" : ""}${data.length} lignes)</label>
          ${processed && state.csv.missingSets.length > 0 ? `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:${T.red};user-select:none;font-family:${T.font};">
              <input type="checkbox" id="show-errors-only" ${state.showErrorsOnly ? "checked" : ""} style="accent-color:${T.red};width:14px;height:14px;cursor:pointer;">
              N'afficher que les erreurs
            </label>
          ` : ""}
        </div>
        <div id="table-scroll" style="overflow-x:auto;overflow-y:auto;max-height:${TABLE_VH}px;border-radius:8px;border:1px solid ${T.brd};">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr>${headers.map(h => `<th style="${thStyle()}position:sticky;top:0;background:${T.surface};white-space:nowrap;">${esc(h)}</th>`).join("")}</tr></thead>
            <tbody id="table-body">
              ${(() => {
                const missingCodes = new Set(state.csv.missingSets.map(m => m.code));
                const noDateCodes  = new Set(state.csv.noDateSets.map(m => m.setCode));
                const si = headers.indexOf(state.colMap.setCode);
                const visibleData = state.showErrorsOnly && processed
                  ? data.filter(r => si >= 0 && missingCodes.has(r[si]))
                  : data;
                _tableCache = { data: visibleData, headers, missingCodes, noDateCodes, si };
                return renderTableRows(state.tableScrollTop);
              })()}
            </tbody>
          </table>
        </div>
      </div>

      ${processed && state.csv.codeMismatches.length > 0 ? `
        <div style="background:#4ade8018;border:1px solid ${T.green};border-radius:8px;padding:14px 18px;margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;color:${T.green};margin-bottom:4px;">🔀 ${state.csv.codeMismatches.length} correspondance(s) par nom — code différent</div>
          <div style="font-size:12px;color:${T.dim};margin-bottom:12px;">Le nom existe dans la BDD mais avec un code différent. Mettre à jour le code dans la BDD ?</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${state.csv.codeMismatches.map(m => `
              <div style="display:flex;align-items:center;gap:10px;background:${T.surface2};border-radius:6px;padding:8px 12px;">
                <span style="color:${T.dim};font-size:12px;font-weight:600;min-width:50px;">${esc(m.dbCode)}</span>
                <span style="color:${T.dim};font-size:12px;">→</span>
                <span style="color:${T.green};font-size:12px;font-weight:700;min-width:50px;">${esc(m.csvCode)}</span>
                <span style="color:${T.text};font-size:12px;flex:1;">${esc(m.dbName)}</span>
                <button class="codematch-update-btn" data-dbcode="${esc(m.dbCode)}" data-csvcode="${esc(m.csvCode)}" style="${btnStyle(true)}padding:4px 12px;font-size:11px;background:${T.green};">Mettre à jour</button>
                <button class="codematch-ignore-btn" data-csvcode="${esc(m.csvCode)}" style="${btnStyle(false)}padding:4px 12px;font-size:11px;">Ignorer</button>
              </div>
            `).join("")}
          </div>
          ${state.csv.codeMismatches.length > 1 ? `
            <div style="margin-top:10px;display:flex;gap:8px;">
              <button id="codematch-update-all" style="${btnStyle(true)}font-size:11px;background:${T.green};">Tout mettre à jour</button>
              <button id="codematch-ignore-all" style="${btnStyle(false)}font-size:11px;">Tout ignorer</button>
            </div>
          ` : ""}
        </div>
      ` : ""}

      ${processed && state.csv.noDateSets.length > 0 ? `
        <div style="background:#facc1518;border:1px solid #facc15;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;color:#facc15;margin-bottom:8px;">📅 ${state.csv.noDateSets.length} extension(s) sans date dans la BDD</div>
          <div style="font-size:12px;color:${T.dim};margin-bottom:10px;">La colonne comment contiendra <span style="color:#facc15;font-weight:600;">${DATE_PLACEHOLDER}</span> pour ces lignes.</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${state.csv.noDateSets.map(m => `
              <span style="background:${T.surface2};border:1px solid #facc1566;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;color:#facc15;">${esc(m.setCode)} <span style="color:${T.dim};font-weight:400;">${esc(m.nameEN || m.nameFR)}</span></span>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${processed && state.csv.nameMismatches.length > 0 ? `
        <div style="background:#e85d2618;border:1px solid ${T.accent};border-radius:8px;padding:14px 18px;margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;color:${T.accent};margin-bottom:4px;">📝 ${state.csv.nameMismatches.length} nom(s) d'extension différent(s) dans la BDD</div>
          <div style="font-size:12px;color:${T.dim};margin-bottom:8px;">Mettre à jour Nom FR ou Nom EN dans la base de données ?</div>
          <div style="background:#e8545422;border:1px solid #e8545466;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#e85454;">⚠ PowerTool peut se tromper sur le nom des extensions — vérifiez chaque correspondance avant d'accepter.</div>
          ${state.csv.nameMismatches.length > 1 ? `
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <button id="nmmatch-all-fr" style="${btnStyle(false)}font-size:11px;">→ FR tous</button>
              <button id="nmmatch-all-en" style="${btnStyle(true)}font-size:11px;">→ EN tous</button>
            </div>
          ` : ""}
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${state.csv.nameMismatches.map(m => `
              <div style="display:flex;align-items:center;gap:8px;background:${T.surface2};border-radius:6px;padding:8px 12px;flex-wrap:wrap;">
                <span style="color:${T.accent};font-weight:700;font-size:12px;min-width:55px;">${esc(m.setCode)}</span>
                <span style="color:${T.green};font-size:12px;font-weight:600;">CSV: ${esc(m.csvName)}</span>
                <span style="color:${T.dim};font-size:11px;">BDD FR: ${esc(m.nameFR)||'—'} · EN: ${esc(m.nameEN)||'—'}</span>
                <div style="display:flex;gap:4px;margin-left:auto;">
                  <button class="nmmatch-fr-btn" data-code="${esc(m.setCode)}" data-name="${esc(m.csvName)}" style="${btnStyle(false)}padding:3px 10px;font-size:11px;">→ FR</button>
                  <button class="nmmatch-en-btn" data-code="${esc(m.setCode)}" data-name="${esc(m.csvName)}" style="${btnStyle(true)}padding:3px 10px;font-size:11px;">→ EN</button>
                  <button class="nmmatch-ignore-btn" data-code="${esc(m.setCode)}" style="${btnStyle(false)}padding:3px 10px;font-size:11px;">✕</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${processed && state.csv.missingSets.length > 0 ? `
        <div style="background:#e8545422;border:1px solid #e85454;border-radius:8px;padding:14px 18px;margin-bottom:16px;">
          <div style="font-weight:700;font-size:13px;color:#e85454;margin-bottom:8px;">⚠ ${state.csv.missingSets.length} extension(s) non trouvée(s) dans la base "${esc(state.selectedGame)}"</div>
          <div style="font-size:12px;color:${T.text};margin-bottom:10px;">Ces codes n'ont pas de correspondance — la colonne comment ne sera pas remplie pour ces lignes.</div>
          ${state.csv.missingSets.length > 1 ? `
            <button id="missing-create-all" style="${btnStyle(false)}padding:4px 14px;font-size:11px;color:${T.green};border-color:${T.green}44;margin-bottom:10px;">+ Tout créer</button>
          ` : ""}
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${state.csv.missingSets.map(m => `
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="background:${T.surface2};border:1px solid #e8545466;border-radius:4px;padding:3px 10px;font-size:11px;font-weight:600;color:#e85454;">${esc(m.code)} <span style="color:${T.dim};font-weight:400;">(${m.count} carte${m.count > 1 ? 's' : ''})</span></span>
                <button class="missing-create-btn" data-code="${esc(m.code)}" style="${btnStyle(false)}padding:3px 10px;font-size:11px;color:${T.green};border-color:${T.green}44;">+ Créer</button>
              </div>
            `).join("")}
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

  // Export single game
  document.querySelectorAll(".export-game-btn").forEach(btn => {
    btn.onclick = () => {
      const name = btn.dataset.game;
      const sets = state.db[name] || [];
      const blob = new Blob([JSON.stringify(sets, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`"${name}" exporté ⬇`);
    };
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

  // Renommer jeu
  document.querySelectorAll(".ren-game-btn").forEach(btn => {
    btn.onclick = () => {
      const oldName = btn.dataset.game;
      const row = btn.closest("div");
      row.innerHTML = `
        <input id="rename-game-input" value="${esc(oldName)}" style="${inputStyle()}flex:1;padding:3px 6px;font-size:11px;">
        <button id="confirm-rename-game" style="${btnStyle(true)}padding:3px 7px;">✓</button>
      `;
      row.style.display = "flex";
      row.style.gap = "4px";
      row.style.padding = "0 8px 4px";
      const input = document.getElementById("rename-game-input");
      input.focus();
      input.select();
      const confirm = async () => {
        const newName = input.value.trim();
        if (!newName || newName === oldName) { render(); return; }
        if (state.db[newName]) { toast("Un jeu avec ce nom existe déjà"); return; }
        await window.api.renameGame(oldName, newName);
        state.db[newName] = state.db[oldName];
        delete state.db[oldName];
        state.selectedGame = newName;
        render();
        toast(`"${oldName}" → "${newName}"`);
      };
      document.getElementById("confirm-rename-game").onclick = confirm;
      input.onkeydown = (e) => {
        if (e.key === "Enter") confirm();
        if (e.key === "Escape") render();
      };
    };
  });

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

  // Export jeu sélectionné
  const exportGameBtn = document.getElementById("btn-export-game");
  if (exportGameBtn) {
    exportGameBtn.onclick = () => {
      const name = state.selectedGame;
      const sets = state.db[name] || [];
      const blob = new Blob([JSON.stringify(sets, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const now = new Date();
      const date = now.toLocaleDateString("fr-FR").replace(/\//g, "-");
      const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
      a.download = `${name}_${date}_${time}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`"${name}" exporté ⬇`);
    };
  }

  // Export toutes les BDD
  const exportAllBtn = document.getElementById("btn-export-all");
  if (exportAllBtn) {
    exportAllBtn.onclick = () => {
      const bundle = {
        version: 1,
        exportDate: new Date().toISOString(),
        games: Object.entries(state.db).map(([name, sets]) => ({ name, sets })),
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const now = new Date();
      const date = now.toLocaleDateString("fr-FR").replace(/\//g, "-");
      const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
      a.download = `BDD_backup_${date}_${time}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`${bundle.games.length} jeux exportés ⬇`);
    };
  }

  // Import bundle
  const importBundleBtn = document.getElementById("btn-import-bundle");
  const bundleInput = document.getElementById("bundle-file-input");
  if (importBundleBtn && bundleInput) {
    importBundleBtn.onclick = () => bundleInput.click();
    bundleInput.onchange = () => {
      const file = bundleInput.files[0];
      if (!file) return;
      showSpinner("Import bundle…");
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const bundle = JSON.parse(e.target.result);
          const games = bundle.version === 1 ? bundle.games : null;
          if (!Array.isArray(games)) throw new Error("Format invalide");
          for (const { name, sets } of games) {
            await window.api.saveGame(name, sets);
            state.db[name] = sets;
          }
          state.selectedGame = state.selectedGame || games[0]?.name || "";
          render();
          hideSpinner();
          toast(`${games.length} jeux importés ✓`);
        } catch {
          hideSpinner();
          toast("❌ Fichier bundle invalide");
        }
        bundleInput.value = "";
      };
      reader.readAsText(file);
    };
  }

  // Logout
  const logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await window.api.auth.logout();
      state.user = null;
      renderLogin();
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

  // Save edit — normalise les champs avant sauvegarde
  const saveEditBtn = document.getElementById("save-edit-btn");
  if (saveEditBtn) {
    saveEditBtn.onclick = async () => {
      const fields = document.querySelectorAll(".edit-field");
      const sets = state.db[state.selectedGame];
      const entry = normEntry(sets[state.editingRow]);
      fields.forEach(f => { entry[f.dataset.field] = f.value; });
      sets[state.editingRow] = entry;
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
      const code   = document.getElementById("new-code").value.trim();
      const nameFR = document.getElementById("new-name-fr").value.trim();
      const nameEN = document.getElementById("new-name-en").value.trim();
      const date   = document.getElementById("new-date").value.trim();
      if (!code || (!nameFR && !nameEN)) return;
      state.db[state.selectedGame].push({ setCode: code, nameFR, nameEN, releaseDate: date });
      await window.api.saveGame(state.selectedGame, state.db[state.selectedGame]);
      render();
      toast("Extension ajoutée ✓");
    };
  }

  // Name mismatch — → FR
  document.querySelectorAll(".nmmatch-fr-btn").forEach(btn => {
    btn.onclick = async () => {
      const { code, name } = btn.dataset;
      const sets = state.db[state.selectedGame];
      const entry = sets.find(s => s.setCode === code);
      if (entry) {
        const e = normEntry(entry);
        e.nameFR = name;
        Object.assign(entry, e);
        await window.api.saveGame(state.selectedGame, sets);
        state.csv.nameMismatches = state.csv.nameMismatches.filter(m => m.setCode !== code);
        render();
        toast(`Nom FR "${code}" mis à jour ✓`);
      }
    };
  });

  // Name mismatch — → EN
  document.querySelectorAll(".nmmatch-en-btn").forEach(btn => {
    btn.onclick = async () => {
      const { code, name } = btn.dataset;
      const sets = state.db[state.selectedGame];
      const entry = sets.find(s => s.setCode === code);
      if (entry) {
        const e = normEntry(entry);
        e.nameEN = name;
        Object.assign(entry, e);
        await window.api.saveGame(state.selectedGame, sets);
        state.csv.nameMismatches = state.csv.nameMismatches.filter(m => m.setCode !== code);
        render();
        toast(`Nom EN "${code}" mis à jour ✓`);
      }
    };
  });

  // Name mismatch — ignore
  document.querySelectorAll(".nmmatch-ignore-btn").forEach(btn => {
    btn.onclick = () => {
      state.csv.nameMismatches = state.csv.nameMismatches.filter(m => m.setCode !== btn.dataset.code);
      render();
    };
  });

  // Name mismatch — tout accepter FR
  const nmmatchAllFr = document.getElementById("nmmatch-all-fr");
  if (nmmatchAllFr) {
    nmmatchAllFr.onclick = async () => {
      const sets = state.db[state.selectedGame];
      state.csv.nameMismatches.forEach(({ setCode, csvName }) => {
        const entry = sets.find(s => s.setCode === setCode);
        if (entry) { const e = normEntry(entry); e.nameFR = csvName; Object.assign(entry, e); }
      });
      await window.api.saveGame(state.selectedGame, sets);
      state.csv.nameMismatches = [];
      render();
      toast("Tous les noms FR mis à jour ✓");
    };
  }

  // Name mismatch — tout accepter EN
  const nmmatchAllEn = document.getElementById("nmmatch-all-en");
  if (nmmatchAllEn) {
    nmmatchAllEn.onclick = async () => {
      const sets = state.db[state.selectedGame];
      state.csv.nameMismatches.forEach(({ setCode, csvName }) => {
        const entry = sets.find(s => s.setCode === setCode);
        if (entry) { const e = normEntry(entry); e.nameEN = csvName; Object.assign(entry, e); }
      });
      await window.api.saveGame(state.selectedGame, sets);
      state.csv.nameMismatches = [];
      render();
      toast("Tous les noms EN mis à jour ✓");
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

  // Code mismatch — update individual (change setCode in DB)
  document.querySelectorAll(".codematch-update-btn").forEach(btn => {
    btn.onclick = async () => {
      const { dbcode, csvcode } = btn.dataset;
      const sets = state.db[state.selectedGame];
      const entry = sets.find(s => s.setCode === dbcode);
      if (entry) {
        entry.setCode = csvcode;
        await window.api.saveGame(state.selectedGame, sets);
        state.csv.codeMismatches = state.csv.codeMismatches.filter(m => m.csvCode !== csvcode);
        state.csv.missingSets = state.csv.missingSets.filter(m => m.code !== csvcode);
        render();
        toast(`Code "${dbcode}" → "${csvcode}" ✓`);
      }
    };
  });

  // Code mismatch — ignore individual
  document.querySelectorAll(".codematch-ignore-btn").forEach(btn => {
    btn.onclick = () => {
      state.csv.codeMismatches = state.csv.codeMismatches.filter(m => m.csvCode !== btn.dataset.csvcode);
      render();
    };
  });

  // Code mismatch — update all
  const codematchUpdateAll = document.getElementById("codematch-update-all");
  if (codematchUpdateAll) {
    codematchUpdateAll.onclick = async () => {
      const sets = state.db[state.selectedGame];
      const updatedCsvCodes = new Set();
      state.csv.codeMismatches.forEach(({ dbCode, csvCode }) => {
        const entry = sets.find(s => s.setCode === dbCode);
        if (entry) { entry.setCode = csvCode; updatedCsvCodes.add(csvCode); }
      });
      await window.api.saveGame(state.selectedGame, sets);
      state.csv.missingSets = state.csv.missingSets.filter(m => !updatedCsvCodes.has(m.code));
      state.csv.codeMismatches = [];
      render();
      toast("Tous les codes mis à jour ✓");
    };
  }

  // Code mismatch — ignore all
  const codematchIgnoreAll = document.getElementById("codematch-ignore-all");
  if (codematchIgnoreAll) {
    codematchIgnoreAll.onclick = () => { state.csv.codeMismatches = []; render(); };
  }

  // Missing sets — tout créer
  const missingCreateAll = document.getElementById("missing-create-all");
  if (missingCreateAll) {
    missingCreateAll.onclick = async () => {
      const sets = state.db[state.selectedGame];
      const si  = state.csv.headers.indexOf(state.colMap.setCode);
      const sni = state.csv.headers.indexOf(state.colMap.setName);
      state.csv.missingSets.forEach(({ code }) => {
        if (sets.find(s => s.setCode === code)) return;
        const csvRow = si >= 0 ? state.csv.rows.find(r => r[si] === code) : null;
        const csvName = (csvRow && sni >= 0) ? csvRow[sni] : "";
        sets.push({ setCode: code, nameFR: "", nameEN: csvName, releaseDate: "" });
      });
      await window.api.saveGame(state.selectedGame, sets);
      state.db[state.selectedGame] = sets;
      const count = state.csv.missingSets.length;
      state.csv.missingSets = [];
      render();
      toast(`${count} extension(s) créée(s) ✓`);
    };
  }

  // Missing sets — create without date
  document.querySelectorAll(".missing-create-btn").forEach(btn => {
    btn.onclick = async () => {
      const code = btn.dataset.code;
      const sets = state.db[state.selectedGame];
      if (sets.find(s => s.setCode === code)) return;
      // Récupère le nom CSV si disponible (EN en priorité)
      const csvRow = state.csv.rows.find(r => {
        const si = state.csv.headers.indexOf(state.colMap.setCode);
        return si >= 0 && r[si] === code;
      });
      const sni = state.csv.headers.indexOf(state.colMap.setName);
      const csvName = (csvRow && sni >= 0) ? csvRow[sni] : "";
      sets.push({ setCode: code, nameFR: "", nameEN: csvName, releaseDate: "" });
      await window.api.saveGame(state.selectedGame, sets);
      state.db[state.selectedGame] = sets;
      state.csv.missingSets = state.csv.missingSets.filter(m => m.code !== code);
      render();
      toast(`"${code}" créé dans la base ✓`);
    };
  });

  // Show errors only
  const showErrorsOnlyCb = document.getElementById("show-errors-only");
  if (showErrorsOnlyCb) {
    showErrorsOnlyCb.onchange = (e) => {
      state.showErrorsOnly = e.target.checked;
      showSpinner("Filtrage…");
      setTimeout(() => { render(); hideSpinner(); }, 0);
    };
  }

  // Round threshold
  const roundThresholdInput = document.getElementById("round-threshold");
  if (roundThresholdInput) {
    roundThresholdInput.oninput = (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > 0 && v < 1) { state.roundThreshold = v; render(); }
    };
  }

  // Threshold tooltip — repositionné pour rester dans le viewport
  const tipBtn = document.getElementById("threshold-info-btn");
  const tipBox = document.getElementById("threshold-tooltip");
  if (tipBtn && tipBox) {
    tipBtn.addEventListener("mouseenter", () => {
      tipBox.style.display = "block";
      tipBox.style.left = "50%";
      tipBox.style.transform = "translateX(-50%)";
      tipBox.style.top = "auto";
      tipBox.style.bottom = "calc(100% + 8px)";

      const tr = tipBox.getBoundingClientRect();
      const pr = tipBox.offsetParent.getBoundingClientRect();
      const vw = window.innerWidth;

      // Vertical : si ça dépasse en haut → passer en dessous
      if (tr.top < 8) {
        tipBox.style.bottom = "auto";
        tipBox.style.top = "calc(100% + 8px)";
      }

      // Horizontal : recalcule après avoir reset le left
      const br = tipBtn.getBoundingClientRect();
      let left = br.left + br.width / 2 - tr.width / 2 - pr.left;
      left = Math.max(8 - pr.left, Math.min(left, vw - tr.width - 8 - pr.left));
      tipBox.style.left = left + "px";
      tipBox.style.transform = "none";
    });
    tipBtn.addEventListener("mouseleave", () => { tipBox.style.display = "none"; });
  }

  // Virtual scroll
  const tableScroll = document.getElementById("table-scroll");
  if (tableScroll) {
    tableScroll.scrollTop = state.tableScrollTop;
    tableScroll.onscroll = () => {
      state.tableScrollTop = tableScroll.scrollTop;
      const tbody = document.getElementById("table-body");
      if (tbody) tbody.innerHTML = renderTableRows(state.tableScrollTop);
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
  showSpinner("Lecture du fichier…");
  const reader = new FileReader();
  reader.onload = (e) => {
    setTimeout(() => {
      const parsed = parseCSV(e.target.result);
      if (parsed.length < 2) { hideSpinner(); return; }
      const h = parsed[0].map(s => s.replace(/^\uFEFF/, ""));
      state.csv.headers = h;
      state.csv.rows = parsed.slice(1).filter(r => r.some(c => c.trim()));
      state.csv.processed = null;
      state.csv.missingSets = [];
      state.csv.codeMismatches = [];
      state.csv.nameMismatches = [];
      state.csv.noDateSets = [];
      // Auto-detect columns
      if (h.includes("price"))    state.colMap.price   = "price";
      if (h.includes("comment"))  state.colMap.comment = "comment";
      if (h.includes("location")) state.colMap.location = "location";
      if (h.includes("setCode"))  state.colMap.setCode = "setCode";
      if (h.includes("cn"))       state.colMap.cn      = "cn";
      // Nom d'extension : colonne "set" de Cardmarket (pas "nameFR" qui est le nom de carte)
      if (h.includes("set"))                state.colMap.setName = "set";
      else if (h.includes("expansionName")) state.colMap.setName = "expansionName";
      else if (h.includes("setName"))       state.colMap.setName = "setName";
      render();
      hideSpinner();
      toast(`${state.csv.rows.length} lignes importées`);
    }, 0);
  };
  reader.readAsText(file);
}

function processCSV() {
  showSpinner("Traitement en cours…");
  setTimeout(() => {
    const { headers, rows } = state.csv;
    const sets = state.db[state.selectedGame] || [];
    const setMap = {}; sets.forEach(s => { setMap[s.setCode] = s; });
    const { price, comment, location, setCode, cn, setName } = state.colMap;
    const pi = headers.indexOf(price), ci = headers.indexOf(comment),
      li = headers.indexOf(location), si = headers.indexOf(setCode),
      ni = headers.indexOf(cn), sni = setName ? headers.indexOf(setName) : -1;

    // Index par nom (normalisé, FR et EN) pour détection des codes différents
    const setMapByName = {};
    sets.forEach(s => {
      const e = normEntry(s);
      if (e.nameFR) setMapByName[e.nameFR.toLowerCase().trim()] = s;
      if (e.nameEN) setMapByName[e.nameEN.toLowerCase().trim()] = s;
    });

    const missingMap = {}, codeMismatchMap = {}, nameMismatchMap = {}, noDateMap = {};
    const processed = rows.map(row => {
      const r = [...row];
      if (pi >= 0) { const v = parseFloat(r[pi]); if (!isNaN(v)) r[pi] = String(roundToHalf(v)); }
      if (si >= 0) {
        const code = r[si], cnVal = ni >= 0 ? r[ni] : "", info = setMap[code];
        if (info) {
          const e = normEntry(info);
          if (!e.releaseDate && !noDateMap[code]) noDateMap[code] = { setCode: code, nameFR: e.nameFR, nameEN: e.nameEN };
          const formatted = formatOutput(state.outputFormat, code, cnVal, e.releaseDate, e.nameFR, e.nameEN);
          if (ci >= 0) r[ci] = formatted;
          if (li >= 0 && state.fillLocation) r[li] = formatted;
          // Détection nom CSV ≠ nameFR et ≠ nameEN
          if (sni >= 0 && r[sni] && !nameMismatchMap[code]) {
            const csvName = r[sni];
            if (csvName !== e.nameFR && csvName !== e.nameEN) {
              nameMismatchMap[code] = { setCode: code, csvName, nameFR: e.nameFR, nameEN: e.nameEN };
            }
          }
        } else if (code) {
          // Code absent — chercher par nom dans la BDD
          let isCodeMismatch = false;
          if (sni >= 0 && r[sni] && !codeMismatchMap[code]) {
            const dbEntry = setMapByName[r[sni].toLowerCase().trim()];
            if (dbEntry) {
              codeMismatchMap[code] = { csvCode: code, csvName: r[sni], dbCode: dbEntry.setCode, dbName: dbEntry.name };
              isCodeMismatch = true;
            }
          } else if (codeMismatchMap[code]) {
            isCodeMismatch = true;
          }
          if (!isCodeMismatch) {
            if (!missingMap[code]) missingMap[code] = 0;
            missingMap[code]++;
          }
        }
      }
      return r;
    });

    if (si >= 0) {
      processed.sort((a, b) => (a[si] || "").localeCompare(b[si] || ""));
    }

    state.csv.missingSets = Object.entries(missingMap).map(([code, count]) => ({ code, count })).sort((a, b) => a.code.localeCompare(b.code));
    state.csv.codeMismatches = Object.values(codeMismatchMap).sort((a, b) => a.csvCode.localeCompare(b.csvCode));
    state.csv.nameMismatches = Object.values(nameMismatchMap).sort((a, b) => a.setCode.localeCompare(b.setCode));
    state.csv.noDateSets = Object.values(noDateMap).sort((a, b) => a.setCode.localeCompare(b.setCode));
    state.csv.processed = processed;
    render();
    hideSpinner();
    toast("CSV traité ✓");
  }, 0);
}

function downloadCSV() {
  const { headers, processed } = state.csv;
  if (!processed) return;
  const lines = [headers.map(toCSVField).join(",")];
  processed.forEach(r => lines.push(r.map(toCSVField).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const now = new Date();
  const date = now.toLocaleDateString("fr-FR").replace(/\//g, "-");
  const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  a.download = `${state.selectedGame}_${date}_${time}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV téléchargé ⬇");
}

// ─── Login screen ────────────────────────────
function renderLogin(errorMsg = "") {
  const root = document.getElementById("root");
  root.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:${T.bg};-webkit-app-region:drag;">
      <div style="-webkit-app-region:no-drag;background:${T.surface};border:1px solid ${T.brd};border-radius:12px;padding:40px;width:360px;display:flex;flex-direction:column;gap:20px;">
        <div style="font-size:16px;font-weight:700;color:${T.accent};text-align:center;letter-spacing:-0.5px;">◈ CSV POWERTOOL</div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="${labelStyle()}">Email</label>
            <input id="auth-email" type="email" placeholder="vous@exemple.com" style="${inputStyle()}width:100%;padding:10px 12px;">
          </div>
          <div>
            <label style="${labelStyle()}">Mot de passe</label>
            <input id="auth-password" type="password" placeholder="••••••••" style="${inputStyle()}width:100%;padding:10px 12px;">
          </div>
          ${errorMsg ? `<div style="color:${T.red};font-size:11px;text-align:center;">${esc(errorMsg)}</div>` : ""}
          <button id="auth-submit" style="margin-top:4px;padding:10px;background:${T.accent};border:none;border-radius:8px;color:#fff;font-family:${T.font};font-size:13px;font-weight:700;cursor:pointer;">Se connecter</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("auth-submit").onclick = () => submitAuth();
  document.getElementById("auth-password").onkeydown = (e) => { if (e.key === "Enter") submitAuth(); };
}

async function submitAuth() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) return renderLogin("Remplis tous les champs.");
  showSpinner("Connexion…");
  try {
    const result = await window.api.auth.login(email, password);
    state.user = result.user;
    hideSpinner();
    await loadApp();
  } catch (err) {
    hideSpinner();
    renderLogin(err.message || "Erreur de connexion");
  }
}

async function loadApp() {
  showSpinner("Chargement…");
  try {
    state.db = await window.api.getAll();
  } catch {
    state.db = {};
  }
  hideSpinner();
  const games = Object.keys(state.db);
  state.selectedGame = games[0] || "";
  render();
}

// ─── Boot ────────────────────────────────────
(async function init() {
  const session = await window.api.auth.getUser();
  if (session) {
    state.user = session.user;
    await loadApp();
  } else {
    renderLogin();
  }
})();
