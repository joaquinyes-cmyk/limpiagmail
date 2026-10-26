import { CONFIG } from "./config.js";
import { CATS, TABS, parseSender, mkItem } from "./classifier.js";
import { demoGroups } from "./demo.js";
import { GmailClient, GmailError, FATAL_CODES } from "./gmail.js";

const gmail = new GmailClient({ clientId: CONFIG.CLIENT_ID, scope: CONFIG.SCOPE });
const configured = /^[0-9]+-.+\.apps\.googleusercontent\.com$/.test(CONFIG.CLIENT_ID);
const STORE = "limpia-gmail:ultima-limpieza";

let stop = false;
const state = {
  mode: "demo", items: [], tab: "todo", q: "", sort: "count", open: {},
  batch: null, scanning: false, working: false, stats: null, log: [], trashed: [], delStats: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const mb = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
const ago = (d) => {
  if (d <= 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 30) return "hace " + d + " días";
  const m = Math.round(d / 30);
  return "hace " + m + (m === 1 ? " mes" : " meses");
};

/* ---- Almacenamiento local (solo ids de la última limpieza, para poder deshacer) ---- */
function saveUndo(ids) {
  try {
    if (ids.length) localStorage.setItem(STORE, JSON.stringify(ids));
    else localStorage.removeItem(STORE);
  } catch { /* sin almacenamiento */ }
}
function loadUndo() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

/* ---- Utilidades ---- */
function logErr(where, e) {
  state.log.push({ w: where, code: (e && e.code) || "?", m: String((e && e.message) || e).slice(0, 140) });
  if (state.log.length > 60) state.log.shift();
}
function friendly(e) {
  switch (e && e.code) {
    case "auth": case "auth_popup": return "No se completó el inicio de sesión con Google. Inténtalo de nuevo y acepta el permiso.";
    case "auth_expired": return "La sesión de Google caducó. Pulsa el botón para conectar otra vez.";
    case "access_denied": return "Google no permitió esta acción. Comprueba que tu cuenta está en la lista de usuarios de prueba y que la API de Gmail está activada.";
    case "rate_limited": return "Gmail pide ir más despacio. Espera un minuto y vuelve a intentarlo.";
    case "network": return "No hay conexión con Gmail. Revisa tu internet.";
    case "no_google": return "No se pudo cargar el inicio de sesión de Google. Desactiva bloqueadores de contenido y recarga.";
    default: return "Error inesperado" + (e && e.status ? " (" + e.status + ")" : "") + ".";
  }
}
const fatal = (e) => e instanceof GmailError && FATAL_CODES.has(e.code);

async function pool(list, limit, fn) {
  let i = 0, ok = 0, bad = 0;
  async function worker() {
    while (i < list.length && !stop) {
      const k = i++;
      try { await fn(list[k], k); ok++; }
      catch (e) { bad++; logErr("tarea", e); if (fatal(e)) stop = true; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return { ok, bad };
}

function setStatus(msg, kind) {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "status" + (kind ? " " + kind : "");
  el.textContent = msg;
}
function setProg(text, frac) {
  $("prog").hidden = false;
  $("prog-t").textContent = text;
  $("prog-fill").style.width = Math.max(2, Math.min(100, frac * 100)) + "%";
}

/* ---- Demo ---- */
function buildDemo() {
  state.mode = "demo";
  state.items = demoGroups().map(mkItem).sort((a, b) => b.count - a.count);
  state.items.forEach((it, i) => { it.id = i; });
  Object.assign(state, { tab: "todo", q: "", sort: "count", open: {}, batch: null, stats: null, trashed: [], delStats: null });
}

/* ---- Análisis ---- */
const LABEL_KEY = { CATEGORY_PROMOTIONS: "promo", CATEGORY_SOCIAL: "social", CATEGORY_UPDATES: "updates", CATEGORY_FORUMS: "forums" };

/** Categoría de Gmail del mensaje. En la principal separa los que traen enlace de baja. */
function keyOf(m) {
  for (const l of m.labelIds) if (LABEL_KEY[l]) return LABEL_KEY[l];
  return m.unsub ? "primary" : "main";
}

function addMessage(m, groups, stats) {
  if (m.labelIds.some((l) => l === "SENT" || l === "STARRED" || l === "DRAFT")) { stats.skipped++; return; }
  const key = keyOf(m);
  const pp = parseSender(m.sender);
  let g = groups[pp.addr];
  if (!g) g = groups[pp.addr] = {
    addr: pp.addr, name: pp.name, count: 0, bytes: 0, subs: [], unread: 0, newest: 0, oldest: Infinity,
    cats: { promo: 0, social: 0, updates: 0, primary: 0, forums: 0, main: 0 },
  };
  const t = Number(m.internalDate) || 0;
  if (t > g.newest) g.newest = t;
  if (t && t < g.oldest) g.oldest = t;
  g.count++;
  g.bytes += Number(m.sizeEstimate) || 0;
  g.cats[key]++;
  if (m.labelIds.includes("UNREAD")) g.unread++;
  if (m.subject && !g.subs.includes(m.subject) && g.subs.length < 3) g.subs.push(m.subject);
  stats.threads++;
  stats.by[key]++;
}

async function ensureConnected() {
  if (gmail.connected) return true;
  if (!configured) { renderSetup(); return false; }
  try {
    setStatus("Se abrirá una ventana de Google para que autorices el acceso…");
    await gmail.connect();
    setStatus("");
    return true;
  } catch (e) {
    logErr("conectar", e);
    setStatus(friendly(e), "err");
    return false;
  }
}

async function scan() {
  if (state.scanning || state.working) return;
  if (!(await ensureConnected())) { refreshControls(); return; }
  state.scanning = true; stop = false; setStatus(""); refreshControls();
  const cap = Number($("depth").value) || 10000;
  const full = $("scope").value === "all";
  const q = full ? "in:inbox" : "in:inbox (category:promotions OR category:social OR category:updates OR category:forums)";
  const groups = {};
  const stats = { threads: 0, skipped: 0, pages: 0, errors: 0, by: { promo: 0, social: 0, updates: 0, primary: 0, forums: 0, main: 0 }, more: [], depth: cap, scope: full ? "toda" : "promos" };
  let failure = null, aborted = false, token = null, listed = 0, estimate = 0;

  while (!stop) {
    let page;
    try { page = await gmail.listMessages(q, token, 500); }
    catch (e) { logErr("listar bandeja", e); stats.errors++; failure = e; break; }
    if (!estimate) estimate = page.estimate;
    let ids = page.messages.map((m) => m.id);
    if (listed + ids.length > cap) ids = ids.slice(0, cap - listed);
    let readInPage = 0;
    const total = Math.min(cap, Math.max(estimate, listed + ids.length));
    const r = await pool(ids, 8, async (id) => {
      addMessage(await gmail.getMessage(id), groups, stats);
      readInPage++;
      if (readInPage % 10 === 0) setProg("Leyendo la bandeja: " + nf(listed + readInPage) + " de unos " + nf(total) + " correos · " + nf(Object.keys(groups).length) + " remitentes", (listed + readInPage) / Math.max(1, total));
    });
    if (r.bad) { stats.errors += r.bad; failure = failure || new GmailError("api_error", "Algunos correos no se pudieron leer"); }
    listed += ids.length; stats.pages++;
    token = page.next;
    if (listed >= cap && token) { stats.more.push("la bandeja (límite de " + nf(cap) + " alcanzado)"); break; }
    if (!token) break;
    if (failure && fatal(failure)) break;
  }
  if (stop) aborted = true;
  state.scanning = false;
  $("prog").hidden = true;
  state.stats = stats;
  if (stats.threads === 0) {
    setStatus(failure ? friendly(failure) : aborted ? "Análisis detenido antes de leer correos." : "No encontré correos en la bandeja de entrada.", failure ? "err" : "");
    refreshControls(); renderReport();
    return;
  }
  const now = Date.now();
  const items = Object.values(groups).map((g) => {
    g.last = Math.max(0, Math.floor((now - g.newest) / 864e5));
    g.span = isFinite(g.oldest) ? Math.max(0, (g.newest - g.oldest) / 864e5) : 0;
    return g;
  }).sort((a, b) => b.count - a.count).map(mkItem);
  Object.assign(state, { mode: "gmail", items, tab: "todo", q: "", open: {}, batch: null, trashed: [], delStats: null });
  $("q").value = "";
  let msg = "Listo: " + nf(stats.threads) + " correos leídos, agrupados en " + nf(items.length) + " remitentes." + (stats.skipped ? " Omití " + nf(stats.skipped) + " con estrella o enviados por ti." : "");
  if (stats.more.length) msg += " Quedan correos sin leer: sube la profundidad a «Completa» para revisarlos todos.";
  if (aborted) msg += " El análisis se detuvo antes de terminar.";
  if (failure) msg += " Una parte falló: " + friendly(failure);
  setStatus(msg, failure ? "err" : "ok");
  renderAll();
}

/* ---- Cálculos ---- */
const inbox = () => state.items.filter((i) => i.status === "inbox");
const trash = () => state.items.filter((i) => i.status === "trash");
const selected = () => inbox().filter((i) => i.sel);
const sumC = (a) => a.reduce((t, i) => t + i.count, 0);
const sumMB = (a) => a.reduce((t, i) => t + i.bytes / 1048576, 0);
function visible() {
  const q = state.q.trim().toLowerCase();
  const a = inbox().filter((i) => {
    if (state.tab !== "todo" && i.cat !== state.tab) return false;
    return !q || (i.name + " " + i.addr + " " + i.subs.join(" ")).toLowerCase().includes(q);
  });
  a.sort((x, y) => (state.sort === "recent" ? x.last - y.last : y.count - x.count));
  return a;
}

/* ---- Pintado ---- */
function renderSetup() {
  const el = $("setup");
  if (configured) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = "Falta configurar el ID de cliente de Google. Abre <code>public/js/config.js</code> y sigue los pasos del README. Mientras tanto puedes probar la app con la bandeja de ejemplo.";
}
function refreshControls() {
  const busy = state.scanning || state.working;
  $("scan").disabled = busy;
  $("depth").disabled = busy; $("scope").disabled = busy; $("reset").disabled = busy;
  $("stopscan").hidden = !state.scanning;
  $("disconnect").hidden = !gmail.connected;
  $("mode").textContent = state.mode === "gmail" ? "Gmail conectado" : "Bandeja de ejemplo";
  $("mode").className = "pill" + (state.mode === "gmail" ? " live" : "");
  $("scan").textContent = state.mode === "gmail" ? "Analizar de nuevo" : (gmail.connected ? "Analizar mi Gmail" : "Conectar y analizar mi Gmail");
}
function renderSummary() {
  const all = inbox(), total = sumC(all);
  const junk = sumC(all.filter((i) => ["ofertas", "social", "news"].includes(i.cat)));
  $("headline").textContent = junk > 0 ? "Tienes " + nf(junk) + " correos que probablemente no necesitas" : total > 0 ? "No quedan remitentes de publicidad por revisar" : "Tu bandeja está limpia";
  $("lead").textContent = state.mode === "demo"
    ? "Esto es una bandeja de ejemplo. Pulsa «Conectar y analizar mi Gmail» para revisar tu bandeja de entrada agrupada por remitentes. No se borra nada hasta que lo confirmes."
    : "Revisa los remitentes de la lista y elige cuáles quieres vaciar. Todo va a la papelera de Gmail y no se borra nada hasta que lo confirmes.";
  let seg = "", leg = "";
  const desc = [];
  for (const k of ["ofertas", "social", "news", "review", "keep"]) {
    const c = sumC(all.filter((i) => i.cat === k));
    if (!c || !total) continue;
    seg += '<span style="width:' + (c / total * 100) + "%;background:" + CATS[k].color + '"></span>';
    leg += '<li><i style="background:' + CATS[k].color + '"></i>' + CATS[k].short + " <b>" + nf(c) + "</b></li>";
    desc.push(CATS[k].short + " " + c);
  }
  $("stack").innerHTML = seg;
  $("stack").setAttribute("aria-label", "Composición de la bandeja: " + desc.join(", "));
  $("legend").innerHTML = leg;
  const t = trash(), tl = $("trashline"), pending = loadUndo();
  if (t.length && !state.working) {
    tl.hidden = false;
    tl.innerHTML = "<span>En la papelera desde esta página: <b class=\"num\">" + nf(sumC(t)) + '</b> remitentes\' correos. Gmail los borra solo a los 30 días.</span><button class="link" type="button" id="restore-all">Restaurar todo</button>';
  } else if (!t.length && pending.length && !state.working && gmail.connected) {
    tl.hidden = false;
    tl.innerHTML = "<span>Hay " + nf(pending.length) + ' correos de una limpieza anterior en la papelera.</span><button class="link" type="button" id="restore-saved">Restaurarlos</button>';
  } else tl.hidden = true;
}
function renderTabs() {
  const all = inbox();
  $("tabs").innerHTML = TABS.map(([k, label]) => {
    const n = k === "todo" ? all.length : all.filter((i) => i.cat === k).length;
    return '<button class="tab" role="tab" type="button" data-tab="' + k + '" aria-selected="' + (state.tab === k) + '">' + label + "<small>" + n + "</small></button>";
  }).join("");
}
function rowHTML(it) {
  const open = !!state.open[it.id], extra = it.subs.length - 1;
  let act = "";
  if (it.cat !== "keep") act = '<button class="link" type="button" data-act="protect">Conservar siempre</button>';
  else if (it.forced) act = '<button class="link" type="button" data-act="unprotect">Quitar protección</button>';
  const flag = '<button class="link" type="button" data-act="flag">' + (it.flag ? "Quitar marca de error" : "Marcar clasificación errónea") + "</button>";
  let chips = it.reasons.map((r) => '<span class="chip' + (it.cat === "keep" ? " keep" : "") + '">' + esc(r) + "</span>").join("");
  if (it.flag) chips += '<span class="chip flag">Marcado como error</span>';
  const first = it.subs.length ? "“" + esc(it.subs[0]) + "”" : "Sin asunto";
  return '<li class="row cat-' + it.cat + (it.sel ? " is-sel" : "") + '" data-id="' + it.id + '">' +
    '<input class="pick" type="checkbox" id="pick-' + it.id + '"' + (it.sel ? " checked" : "") + ' aria-label="Eliminar correos de ' + esc(it.name) + '">' +
    '<div class="av" aria-hidden="true">' + esc(it.name.charAt(0).toUpperCase()) + "</div>" +
    '<div class="main">' +
      '<div class="who"><label class="name" for="pick-' + it.id + '">' + esc(it.name) + '</label><span class="addr">' + esc(it.addr) + "</span></div>" +
      '<p class="subj">' + first + (extra > 0 ? ' <button class="more" type="button" data-act="more" aria-expanded="' + open + '">' + (open ? "Ocultar" : "+" + extra + (extra === 1 ? " asunto" : " asuntos")) + "</button>" : "") + "</p>" +
      (open && extra > 0 ? '<ul class="subs">' + it.subs.slice(1).map((s) => "<li>“" + esc(s) + "”</li>").join("") + "</ul>" : "") +
      '<div class="chips">' + chips + "</div>" +
    "</div>" +
    '<div class="meta"><span class="cnt num">' + nf(it.count) + '</span><span class="lbl">correos</span><span class="last">' + ago(it.last) + "</span>" + act + flag + "</div>" +
  "</li>";
}
function syncAll() {
  const v = visible().filter((i) => i.cat !== "keep");
  const on = v.filter((i) => i.sel).length, box = $("all");
  box.disabled = !v.length;
  box.checked = v.length > 0 && on === v.length;
  box.indeterminate = on > 0 && on < v.length;
}
function renderList() {
  const v = visible();
  $("list").innerHTML = v.length ? v.map(rowHTML).join("") : '<li class="empty">No hay remitentes en esta vista.</li>';
  syncAll();
}
function renderBar() {
  const bar = $("bar"), s = selected();
  if (state.batch) {
    bar.className = "bar done";
    bar.innerHTML = '<div class="txt" role="status"><b>' + nf(state.batch.emails) + "</b> correos movidos a la papelera de Gmail" + (state.batch.failed ? " (" + state.batch.failed + " con error)" : "") + '.</div><button class="btn" type="button" id="undo"' + (state.working ? " disabled" : "") + ">Deshacer</button>";
    return;
  }
  bar.className = "bar";
  const prot = s.filter((i) => i.cat === "keep").length;
  bar.innerHTML = '<div class="txt"><b class="num">' + s.length + "</b> " + (s.length === 1 ? "remitente" : "remitentes") + ' · <b class="num">' + nf(sumC(s)) + '</b> correos · <b class="num">' + mb(sumMB(s)) + " MB</b>" + (prot ? '<span class="warn">Incluye ' + prot + " " + (prot === 1 ? "remitente protegido" : "remitentes protegidos") + ". Revísalo antes de confirmar.</span>" : "") + '</div><button class="btn primary" type="button" id="review"' + (s.length && !state.working && !state.scanning ? "" : " disabled") + ">Revisar y eliminar</button>";
}
function buildReport() {
  const L = [], st = state.stats, all = state.items;
  L.push("INFORME DE DIAGNÓSTICO · Limpia Gmail");
  L.push("Modo: " + (state.mode === "gmail" ? "Gmail real" : "ejemplo") + " · " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC");
  if (st) {
    L.push("Análisis: " + st.threads + " correos leídos (" + st.pages + " páginas, tope " + st.depth + "), " + st.skipped + " omitidas, " + st.errors + " errores");
    L.push("Por categoría de Gmail: promociones " + st.by.promo + ", social " + st.by.social + ", actualizaciones " + st.by.updates + ", principal con baja " + st.by.primary + ", foros " + st.by.forums + ", principal completa " + st.by.main + " (alcance: " + st.scope + ")");
    L.push("Sin leer por el límite de profundidad: " + (st.more.length ? st.more.join(", ") : "nada"));
  }
  for (const k of ["ofertas", "social", "news", "review", "keep"]) {
    const a = all.filter((i) => i.cat === k && i.status !== "trash");
    if (a.length) L.push(CATS[k].short + ": " + a.length + " remitentes, " + sumC(a) + " correos");
  }
  const fl = all.filter((i) => i.flag);
  L.push("Marcados como mal clasificados (" + fl.length + "):");
  fl.forEach((i) => L.push("- " + i.addr + " · quedó en «" + CATS[i.cat].short + "» · " + i.count + " correos"));
  const forced = all.filter((i) => i.forced);
  if (forced.length) { L.push("Protegidos a mano:"); forced.forEach((i) => L.push("- " + i.addr)); }
  const tr = all.filter((i) => i.status === "trash");
  if (tr.length || state.delStats) {
    const d = state.delStats || {};
    L.push("Papelera: " + tr.length + " remitentes, " + (d.moved || 0) + " correos movidos, " + (d.failed || 0) + " fallos");
  }
  L.push("Errores (" + state.log.length + "):");
  state.log.forEach((e) => L.push("- " + e.w + " · " + e.code + " · " + e.m));
  return L.join("\n");
}
const renderReport = () => { $("rep-text").value = buildReport(); };
function renderAll() { refreshControls(); renderSetup(); renderSummary(); renderTabs(); renderList(); renderBar(); renderReport(); }

/* ---- Confirmación y borrado ---- */
let lastFocus = null;
function sheetSub(s) {
  const n = sumC(s);
  if (!s.length) return "No hay remitentes seleccionados.";
  return state.mode === "gmail"
    ? "Se moverán a la papelera de Gmail " + nf(n) + " correos de la bandeja de entrada de " + s.length + (s.length === 1 ? " remitente" : " remitentes") + ". La cifra es exacta: se contó ahora mismo en tu Gmail. Se omiten los destacados con estrella. Puedes recuperarlos durante 30 días."
    : "Se moverán " + nf(n) + " correos de " + s.length + (s.length === 1 ? " remitente" : " remitentes") + " a la papelera de ejemplo. No se toca ningún correo real.";
}
function renderSheet() {
  const s = selected().sort((a, b) => b.count - a.count);
  $("sheet-sub").textContent = sheetSub(s);
  $("sheet-list").innerHTML = s.map((i) =>
    '<li><input type="checkbox" checked data-sid="' + i.id + '" id="s-' + i.id + '" aria-label="Incluir a ' + esc(i.name) + '"><label for="s-' + i.id + '"><span class="n">' + esc(i.name) + (i.cat === "keep" ? '<span class="tag">Protegido</span>' : "") + '</span><span class="a">' + esc(i.addr) + '</span></label><span class="c num">' + nf(i.count) + "</span></li>").join("");
  $("sheet-go").textContent = "Eliminar " + nf(sumC(s)) + " correos";
  $("sheet-go").disabled = !(s.length && $("sheet-ok").checked);
}
/** Cuenta los correos exactos de cada remitente seleccionado antes de pedir la confirmación. */
async function openSheet() {
  if (state.mode === "gmail") {
    state.working = true; stop = false; refreshControls(); renderBar();
    const sel = selected();
    let n = 0;
    const r = await pool(sel, 3, async (it) => {
      it.ids = await collectIds(it);
      it.count = it.ids.length;
      n++;
      setProg("Contando los correos exactos de cada remitente: " + n + " de " + sel.length, n / sel.length);
    });
    $("prog").hidden = true; state.working = false;
    if (r.bad || stop) {
      setStatus("No pude contar todos los correos" + (stop ? "." : ": " + friendly(state.log.length ? { code: state.log[state.log.length - 1].code } : {})), "err");
      sel.forEach((it) => { delete it.ids; });
      renderAll();
      return;
    }
    sel.forEach((it) => { if (!it.count) it.sel = false; });
    renderList(); renderBar();
  }
  lastFocus = document.activeElement;
  $("sheet-ok").checked = false; $("sheet-work").hidden = true; $("sheet-ask").hidden = false;
  renderSheet(); $("sheet").hidden = false; $("sheet-back").focus();
}
function closeSheet() {
  if (state.working) return;
  $("sheet").hidden = true; renderList(); renderBar();
  if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
}
const sheetProg = (text, frac) => {
  $("sheet-prog-t").textContent = text;
  $("sheet-prog-fill").style.width = Math.max(2, Math.min(100, frac * 100)) + "%";
};

/** Ids de mensajes de ese remitente en la bandeja de entrada, sin los destacados. */
async function collectIds(it) {
  if (state.mode === "demo") return Array.from({ length: it.count }, (_, i) => "demo-" + it.id + "-" + i);
  const ids = [];
  let token = null, pages = 0;
  do {
    const p = await gmail.listMessages("from:" + it.addr + " in:inbox -is:starred", token, 500);
    p.messages.forEach((m) => ids.push(m.id));
    token = p.next; pages++;
  } while (token && pages < 20 && !stop);
  return ids;
}
async function moveIds(ids, toTrash) {
  if (state.mode === "demo") return;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await (toTrash ? gmail.trash(chunk) : gmail.untrash(chunk));
  }
}

async function doDelete() {
  const sel = selected();
  if (!sel.length || state.working) return;
  state.working = true; stop = false; refreshControls();
  $("sheet-ask").hidden = true; $("sheet-work").hidden = false;
  let moved = [], failed = 0, leftover = 0;
  const doneItems = [];
  for (let i = 0; i < sel.length && !stop; i++) {
    const it = sel[i];
    sheetProg("Buscando correos de " + it.name + " (" + (i + 1) + " de " + sel.length + ")", i / sel.length);
    try {
      const ids = it.ids || (await collectIds(it));
      if (stop) break;
      sheetProg("Moviendo a la papelera: " + it.name + " · " + ids.length + " correos", (i + 0.5) / sel.length);
      await moveIds(ids, true);
      if (state.mode === "gmail") {
        const left = await gmail.listMessages("from:" + it.addr + " in:inbox -is:starred", null, 100);
        if (left.messages.length) { leftover += left.messages.length; logErr("quedaron en la bandeja " + it.addr, { code: "left", message: left.messages.length + " correos" }); }
      }
      moved = moved.concat(ids);
      it.status = "trash";
      doneItems.push(it.id);
    } catch (e) {
      logErr("mover " + it.addr, e); failed++;
      if (fatal(e)) { stop = true; setStatus(friendly(e), "err"); }
    }
  }
  const wasStopped = stop;
  state.working = false;
  state.delStats = { moved: (state.delStats ? state.delStats.moved : 0) + moved.length, failed: (state.delStats ? state.delStats.failed : 0) + failed };
  state.trashed = state.trashed.concat(moved);
  if (state.mode === "gmail") saveUndo(state.trashed);
  state.batch = { emails: moved.length, failed, items: doneItems, ids: moved };
  $("sheet").hidden = true;
  if (leftover) setStatus("Moví " + nf(moved.length) + " correos, pero " + nf(leftover) + " siguen en la bandeja (llegaron mientras tanto). Vuelve a analizar para verlos.", "err");
  else if (failed || wasStopped) setStatus((wasStopped ? "Detuve el proceso. " : "") + nf(moved.length) + " correos movidos" + (failed ? " y " + failed + " remitentes con error. Mira el informe." : "."), failed ? "err" : "");
  renderAll();
}
async function undo() {
  if (!state.batch || state.working) return;
  const b = state.batch;
  state.working = true; stop = false; refreshControls(); renderBar();
  setProg("Restaurando " + nf(b.ids.length) + " correos…", 0.05);
  try {
    await moveIds(b.ids, false);
    state.items.forEach((i) => { if (b.items.includes(i.id)) { i.status = "inbox"; i.sel = true; } });
    const set = new Set(b.ids);
    state.trashed = state.trashed.filter((id) => !set.has(id));
    if (state.mode === "gmail") saveUndo(state.trashed);
    state.batch = null;
    setStatus("Restauré " + nf(b.ids.length) + " correos en tu bandeja de entrada.", "ok");
  } catch (e) {
    logErr("deshacer", e);
    setStatus("No pude restaurar todo: " + friendly(e) + " Puedes recuperarlos desde la Papelera de Gmail.", "err");
  }
  $("prog").hidden = true; state.working = false;
  renderAll();
}
async function restoreAll() {
  if (state.working) return;
  const ids = state.trashed.slice();
  if (!ids.length) { trash().forEach((i) => { i.status = "inbox"; i.sel = false; }); state.batch = null; renderAll(); return; }
  state.working = true; stop = false; refreshControls();
  setProg("Restaurando " + nf(ids.length) + " correos…", 0.05);
  try {
    await moveIds(ids, false);
    trash().forEach((i) => { i.status = "inbox"; i.sel = false; });
    state.trashed = []; state.batch = null; saveUndo([]);
    setStatus("Restauré " + nf(ids.length) + " correos.", "ok");
  } catch (e) {
    logErr("restaurar", e);
    setStatus("No pude restaurar todo: " + friendly(e), "err");
  }
  $("prog").hidden = true; state.working = false;
  renderAll();
}
async function restoreSaved() {
  const ids = loadUndo();
  if (!ids.length || state.working) return;
  state.working = true; refreshControls();
  setProg("Restaurando " + nf(ids.length) + " correos de la limpieza anterior…", 0.05);
  try {
    await gmail.untrash(ids.slice(0, 1000));
    for (let i = 1000; i < ids.length; i += 1000) await gmail.untrash(ids.slice(i, i + 1000));
    saveUndo([]);
    setStatus("Restauré " + nf(ids.length) + " correos de la limpieza anterior.", "ok");
  } catch (e) {
    logErr("restaurar anterior", e);
    setStatus("No pude restaurar: " + friendly(e), "err");
  }
  $("prog").hidden = true; state.working = false;
  renderAll();
}

/* ---- Eventos ---- */
$("scan").addEventListener("click", scan);
$("stopscan").addEventListener("click", () => { stop = true; });
$("disconnect").addEventListener("click", () => {
  gmail.disconnect(); buildDemo(); setStatus("Sesión de Google cerrada. Se revocó el acceso de esta página.", "ok"); renderAll();
});
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  state.tab = b.getAttribute("data-tab"); renderTabs(); renderList();
});
$("q").addEventListener("input", (e) => { state.q = e.target.value; renderList(); });
$("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
$("all").addEventListener("change", (e) => {
  const on = e.target.checked;
  visible().forEach((i) => { if (i.cat !== "keep") i.sel = on; });
  state.batch = null; renderList(); renderBar();
});
$("list").addEventListener("change", (e) => {
  const row = e.target.closest(".row");
  if (!row || !e.target.classList.contains("pick")) return;
  const it = state.items[Number(row.getAttribute("data-id"))];
  it.sel = e.target.checked; state.batch = null;
  row.classList.toggle("is-sel", it.sel);
  syncAll(); renderBar();
});
$("list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const row = b.closest(".row"), it = state.items[Number(row.getAttribute("data-id"))], act = b.getAttribute("data-act");
  if (act === "more") { state.open[it.id] = !state.open[it.id]; renderList(); return; }
  if (act === "flag") { it.flag = !it.flag; renderList(); renderReport(); return; }
  if (act === "protect") { it.cat = "keep"; it.forced = true; it.sel = false; it.reasons = ["Marcado por ti como importante"]; }
  if (act === "unprotect") { it.cat = it.orig; it.forced = false; it.reasons = it.origReasons.slice(); it.sel = false; }
  state.batch = null; renderAll();
});
$("bar").addEventListener("click", (e) => {
  if (e.target.id === "review") openSheet();
  if (e.target.id === "undo") undo();
});
$("trashline").addEventListener("click", (e) => {
  if (e.target.id === "restore-all") restoreAll();
  if (e.target.id === "restore-saved") restoreSaved();
});
$("reset").addEventListener("click", () => { buildDemo(); $("q").value = ""; $("sort").value = "count"; setStatus(""); renderAll(); });
$("sheet-ok").addEventListener("change", renderSheet);
$("sheet-list").addEventListener("change", (e) => {
  const id = e.target.getAttribute("data-sid"); if (id === null) return;
  state.items[Number(id)].sel = e.target.checked;
  const s = selected();
  $("sheet-sub").textContent = sheetSub(s);
  $("sheet-go").textContent = "Eliminar " + nf(sumC(s)) + " correos";
  $("sheet-go").disabled = !(s.length && $("sheet-ok").checked);
});
$("sheet-back").addEventListener("click", closeSheet);
$("sheet-go").addEventListener("click", doDelete);
$("sheet-stop").addEventListener("click", () => { stop = true; $("sheet-prog-t").textContent = "Deteniendo…"; });
$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
$("report").addEventListener("toggle", renderReport);
$("rep-copy").addEventListener("click", () => {
  const t = $("rep-text"); t.value = buildReport();
  const manual = () => { t.focus(); t.select(); $("rep-msg").textContent = "Selecciona el texto y cópialo con Ctrl+C"; };
  try { navigator.clipboard.writeText(t.value).then(() => { $("rep-msg").textContent = "Copiado"; }, manual); } catch { manual(); }
});
document.addEventListener("keydown", (e) => {
  if ($("sheet").hidden) return;
  if (e.key === "Escape") { closeSheet(); return; }
  if (e.key === "Tab") {
    const f = [...$("sheet").querySelectorAll("input:not([disabled]),button:not([disabled])")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

buildDemo();
renderAll();
