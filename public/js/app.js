/* Fatima Veloxia 2K26 — Live House Scoreboard
 *
 * Offline-first: every change is saved on this device immediately, then sent to
 * Supabase whenever there is internet. Without Supabase settings (js/config.js)
 * the app runs fully local, like the original offline scoreboard.
 */
(function () {
  "use strict";

  /* ---------- Houses and events ---------- */
  const HOUSES = [
    { key: "fatima",    name: "Fatima House",    color: "#f7c900", cls: "fatima",    input: "pFatima" },
    { key: "carmel",    name: "Carmel House",    color: "#d7193f", cls: "carmel",    input: "pCarmel" },
    { key: "lourdes",   name: "Lourdes House",   color: "#702b16", cls: "lourdes",   input: "pLourdes" },
    { key: "velankani", name: "Velankani House", color: "#003b91", cls: "velankani", input: "pVelankani" }
  ];
  const SPORTS_EVENTS = [
    "SPRINT TO GLORY 100M BOYS (5 & 6)",
    "SPRINT TO GLORY 100M BOYS (9 & 10)",
    "SPRINT TO GLORY 100M BOYS (11 & 12)",
    "FLASH DASH 100M GIRLS (5 & 6)",
    "FLASH DASH 100M GIRLS (9 & 10)",
    "FLASH DASH 100M GIRLS (11 & 12)",
    "PASS THE POWER - 4×100 RELAY RACE GIRLS (SUB JUNIOR)",
    "PASS THE POWER - 4×100 RELAY RACE GIRLS (JUNIOR)",
    "PASS THE POWER - 4×100 RELAY RACE GIRLS (SENIOR)",
    "ONE TEAM, ONE DREAM - 4×100 RELAY RACE BOYS (SUB JUNIOR)",
    "ONE TEAM, ONE DREAM - 4×100 RELAY RACE BOYS (JUNIOR)",
    "ONE TEAM, ONE DREAM - 4×100 RELAY RACE BOYS (SENIOR)",
    "HOUSE POSITION"
  ];
  // Counted in house totals but not listed as a row, as in the original design.
  const HIDDEN_FROM_TABLE = "HOUSE POSITION";

  /* ---------- Storage keys ---------- */
  const LOCAL_KEY = "fatimaLiveScoreboardV1";        // local-only mode (same key as the original offline file)
  const CACHE_KEY = "veloxiaServerCacheV1";          // last copy received from Supabase
  const QUEUE_KEY = "veloxiaPendingChangesV1";       // changes not yet sent to Supabase
  const ADMIN_KEY = "veloxiaAdminEmailV1";           // last confirmed admin on this device
  const SESSION_KEY = "veloxia-admin-session";       // Supabase login, kept by Supabase itself

  const $ = (id) => document.getElementById(id);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const readJSON = (k, fallback) => { try { const v = JSON.parse(ls.get(k)); return v == null ? fallback : v; } catch (e) { return fallback; } };

  /* ---------- Supabase ---------- */
  const CFG = self.VELOXIA_CONFIG || {};
  const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  // A weak signal can leave a request hanging for minutes. Give up after a while and treat it as offline.
  const TIMEOUT_MS = 12000;
  const timedFetch = (url, init) => {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    return fetch(url, Object.assign({}, init, { signal: ctl.signal }))
      .catch((err) => { throw ctl.signal.aborted ? new TypeError("Network request timed out") : err; })
      .finally(() => clearTimeout(timer));
  };
  const db = REMOTE ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: SESSION_KEY },
    global: { fetch: timedFetch }
  }) : null;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const newId = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));

  // Accepts rows from Supabase, the original offline file and old backups (which used "velankanni").
  function normalize(x, i) {
    const src = x.scores || x;
    const scores = {};
    HOUSES.forEach((h) => { scores[h.key] = num(src[h.key] != null ? src[h.key] : (h.key === "velankani" ? src.velankanni : 0)); });
    return {
      id: String(x.id || newId()),
      name: String(x.name || "Unnamed event"),
      created_at: x.created_at || new Date(Date.now() - 100000 + (i || 0)).toISOString(),
      scores
    };
  }
  const rowOf = (ev) => Object.assign({ name: ev.name }, ev.scores);
  const notAllowed = () => Object.assign(new Error("Not allowed"), { code: "42501" });

  const server = {
    async list() {
      const r = await db.from("events").select("*").order("created_at", { ascending: true });
      if (r.error) throw r.error;
      return r.data.map(normalize);
    },
    async add(op) {
      const r = await db.from("events").insert(Object.assign({ id: op.id, created_at: op.created_at }, rowOf(op.ev)));
      if (r.error && r.error.code !== "23505") throw r.error;     // 23505 = already saved on an earlier try
    },
    async update(op) {
      const r = await db.from("events").update(rowOf(op.ev)).eq("id", op.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) {
        // Deleted on another device while this one was offline: the delete wins, so there is nothing left to change.
        const check = await db.from("events").select("id").eq("id", op.id);
        if (check.error) throw check.error;
        if (check.data.length) throw notAllowed();
      }
    },
    async remove(op) {
      const r = await db.from("events").delete().eq("id", op.id).select("id");
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) {
        // A previous attempt may have succeeded before its response was lost.
        const check = await db.from("events").select("id").eq("id", op.id);
        if (check.error) throw check.error;
        if (check.data.length) throw notAllowed();
      }
    },
    async clear() {
      const r = await db.from("events").delete().not("id", "is", null);
      if (r.error) throw r.error;
    }
  };

  /* ---------- State ---------- */
  let base = REMOTE ? readJSON(CACHE_KEY, []) : readJSON(LOCAL_KEY, []);
  base = Array.isArray(base) ? base.map(normalize) : [];
  let queue = readJSON(QUEUE_KEY, []);
  if (!Array.isArray(queue)) queue = [];
  let events = [];
  let editingId = null;
  let isAdmin = !REMOTE, adminEmail = null, loggingIn = false;
  let flushing = false, needLogin = false, reachable = true, subscribed = false, syncError = false;
  let prevTotals = null;

  function applyOps(list, ops) {
    let out = list.map((e) => ({ id: e.id, name: e.name, created_at: e.created_at, scores: Object.assign({}, e.scores) }));
    ops.forEach((op) => {
      if (op.op === "add") { if (!out.some((x) => x.id === op.id)) out.push({ id: op.id, name: op.ev.name, created_at: op.created_at, scores: Object.assign({}, op.ev.scores) }); }
      else if (op.op === "update") out.forEach((x) => { if (x.id === op.id) { x.name = op.ev.name; x.scores = Object.assign({}, op.ev.scores); } });
      else if (op.op === "delete") out = out.filter((x) => x.id !== op.id);
      else if (op.op === "clear") out = [];
    });
    return out.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }

  function refreshView() {
    events = REMOTE ? applyOps(base, queue) : base;
    render();
    updateStatus();
  }

  // Save the whole change first. Only show it after the browser confirms it is stored.
  function commitMany(ops) {
    if (!REMOTE) {
      const next = applyOps(base, ops);
      if (!ls.set(LOCAL_KEY, JSON.stringify(next))) {
        alert("This browser could not save the change on this device. Free up storage and try again.");
        return false;
      }
      base = next;
      refreshView();
      return true;
    }
    const next = queue.concat(ops);
    if (!ls.set(QUEUE_KEY, JSON.stringify(next))) {
      alert("This browser could not save the change on this device. Free up storage and try again.");
      return false;
    }
    queue = next;
    syncError = false;
    refreshView();
    setTimeout(flush, 0);
    return true;
  }
  const commit = (op) => commitMany([op]);

  /* ---------- Sync with Supabase ---------- */
  const isNetworkError = (err) => !navigator.onLine || (!!err && /fetch|network|load failed|timeout|offline/i.test(String(err.message || err)));
  const isAuthError = (err) => !!err && (err.code === "42501" || err.code === "PGRST301" || err.status === 401 || /row-level security|jwt/i.test(err.message || ""));

  async function pull() {
    if (!REMOTE) { refreshView(); return; }
    try {
      base = await server.list();
      reachable = true;
      ls.set(CACHE_KEY, JSON.stringify(base));
    } catch (err) {
      if (isNetworkError(err)) reachable = false; else console.error(err);
    }
    refreshView();
  }

  async function flush() {
    if (!REMOTE || flushing || !queue.length || needLogin || !navigator.onLine) { updateStatus(); return; }
    flushing = true;
    syncError = false;
    updateStatus();
    try {
      const admin = await confirmAdmin();
      if (admin === null) { reachable = false; return; }
      if (!admin) { needLogin = true; setAdmin(false, null); return; }
      while (queue.length) {
        const op = queue[0];
        try {
          await server[op.op === "delete" ? "remove" : op.op](op);
          reachable = true;
        } catch (err) {
          if (isNetworkError(err)) { reachable = false; break; }
          if (isAuthError(err)) {
            const admin = await confirmAdmin();
            if (admin === null) { reachable = false; break; }
            if (!admin) {
              needLogin = true; setAdmin(false, null);
              toastNote("Log in as admin to sync the scores saved on this device.");
              break;
            }
            // The account is allowed, but the change failed. Keep it for recovery.
            console.error("Supabase rejected a saved change", op, err);
            syncError = true;
            break;
          } else { console.error("Supabase rejected a saved change", op, err); syncError = true; break; }
        }
        const remaining = queue.slice(1);
        if (!ls.set(QUEUE_KEY, JSON.stringify(remaining))) { syncError = true; break; }
        queue = remaining;
      }
    } finally { flushing = false; updateStatus(); }
    await pull();
  }

  /* ---------- Rendering ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  function totals() {
    const t = {}; HOUSES.forEach((h) => { t[h.key] = 0; });
    events.forEach((e) => HOUSES.forEach((h) => { t[h.key] += num(e.scores[h.key]); }));
    return t;
  }

  function render() {
    const t = totals();
    const order = [...HOUSES].sort((a, b) => t[b.key] - t[a.key] || a.name.localeCompare(b.name));
    const rankOf = (h) => 1 + new Set(HOUSES.filter((o) => t[o.key] > t[h.key]).map((o) => t[o.key])).size;   // ties share a rank

    $("cards").innerHTML = order.map((h) => {
      const r = rankOf(h), lead = r === 1 && t[h.key] > 0;
      const bump = prevTotals && prevTotals[h.key] !== t[h.key] ? " bump" : "";
      return `<div class="card ${h.cls}${bump}"><div class="house">${h.name.toUpperCase()}</div><div class="score">${fmt(t[h.key])}</div><div class="rank">${lead ? "🏆 " : ""}Rank ${r}</div></div>`;
    }).join("");
    prevTotals = t;

    const rows = events.filter((e) => e.name !== HIDDEN_FROM_TABLE);
    $("eventRows").innerHTML = rows.map((e, i) =>
      `<tr${e.id === editingId ? ' style="outline:3px solid #ffdb54"' : ""}><td>${i + 1}.</td><td>${esc(e.name)}</td>${HOUSES.map((h) => `<td class="num">${fmt(num(e.scores[h.key]))}</td>`).join("")}` +
      `<td class="event-actions"><button type="button" class="secondary" data-edit="${esc(e.id)}">Edit</button> <button type="button" class="danger" data-delete="${esc(e.id)}">Delete</button></td></tr>`
    ).join("");
    $("eventTotals").innerHTML = `<tr class="totalrow"><td colspan="2">Total Points</td>${HOUSES.map((h) => `<td class="num" style="color:${h.color}">${fmt(t[h.key])}</td>`).join("")}<td class="event-actions"></td></tr>`;

    document.title = events.length && t[order[0].key] > 0 ? "Fatima School — " + order[0].name + " leads" : "Fatima Veloxia 2K26 — Live House Scoreboard";
    renderWinner(t);
  }

  /* ---------- Winner screen (?winner=1) ---------- */
  const WINNER_MODE = new URLSearchParams(location.search).get("winner") === "1";
  let shownWinners = null;
  function renderWinner(t) {
    if (!WINNER_MODE) return;
    const top = Math.max(...HOUSES.map((h) => t[h.key]));
    const winners = top > 0 ? HOUSES.filter((h) => t[h.key] === top) : [];   // a tie shows joint winners
    const key = winners.map((h) => h.key).join();
    if (key === shownWinners) return;
    shownWinners = key;
    const stage = $("winnerStage");
    stage.className = "winner-stage " + (!winners.length ? "waiting" : winners.length > 1 ? "tie" : winners[0].cls);
    $("winnerTitle").textContent = !winners.length ? "Winner to be announced" : winners.length > 1 ? "Joint Winners" : "Winner";
    $("winnerNames").innerHTML = winners.map((h) => `<div class="winner-name ${h.cls}">${esc(h.name.replace(/ House$/, ""))}</div>`).join('<div class="winner-amp">&amp;</div>') +
      (winners.length ? `<div class="winner-house">${winners.length > 1 ? "Houses" : "House"}</div>` : "");
    void stage.offsetWidth;            // restart the entrance animation each time the winner changes
    stage.classList.add("reveal");
    document.title = winners.length ? "🏆 " + winners.map((h) => h.name).join(" & ") + " — Winner" : "Fatima Veloxia 2K26 — Winner";
  }
  function startWinnerScreen() {
    document.body.classList.add("winnermode");
    const colors = ["var(--win)", "var(--win)", "#ffd447", "#fff3c4", "#ffb21a"];
    $("winnerConfetti").innerHTML = Array.from({ length: 70 }, () => {
      const r = (a, b) => a + Math.random() * (b - a);
      return `<i style="left:${r(0, 100).toFixed(1)}%;--c:${colors[Math.floor(Math.random() * colors.length)]};--dx:${r(-12, 12).toFixed(1)}vw;--r:${Math.round(r(360, 1080))}deg;` +
        `animation-duration:${r(6, 13).toFixed(1)}s;animation-delay:-${r(0, 13).toFixed(1)}s"></i>`;
    }).join("");
    $("winnerFsBtn").addEventListener("click", toggleFullscreen);
    $("winnerStage").addEventListener("dblclick", toggleFullscreen);
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }

  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  function setNote(cls, text) {
    const note = $("syncNote");
    note.className = "muted offline-note" + (cls ? " " + cls : "") + (text ? "" : " hidden");
    note.textContent = text;
  }
  function updateStatus() {
    const n = queue.length, online = navigator.onLine && reachable;
    let footer = "";
    if (!REMOTE) {
      setNote("", "● OFFLINE MODE — scores are saved automatically on this computer. Use Export Backup to transfer scores to another computer.");
    } else if (n && needLogin) {
      setNote("is-error", "● " + plural(n, "change") + " saved on this device. Log in as admin to sync them.");
      footer = "offline";
    } else if (n && !online) {
      setNote("is-pending", "● OFFLINE — " + plural(n, "change") + " saved on this device. They will sync automatically when the internet is back.");
      footer = "offline";
    } else if (n && syncError) {
      setNote("is-error", "● " + plural(n, "change") + " saved on this device, but sync failed. They will be retried. Export Backup for a copy.");
    } else if (n) {
      setNote("is-pending", "● Syncing " + plural(n, "change") + "…");
    } else if (!online) {
      setNote("is-offline", "● OFFLINE — showing scores saved on this device. You can keep entering points.");
      footer = "offline";
    } else {
      setNote("", "");
      footer = subscribed ? "live" : "";
    }
    $("footerStatus").innerHTML = REMOTE
      ? `<span class="status-dot ${footer}"></span>${footer === "live" ? "Live" : footer === "offline" ? "Offline" : "Online"} &nbsp;•&nbsp; `
      : "";
  }
  let noteTimer = null;
  function toastNote(text) {
    // Brief message in the status line, then back to the normal sync status.
    setNote("is-pending", text);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(updateStatus, 3500);
  }

  /* ---------- Admin login ---------- */
  function setAdmin(on, email) {
    isAdmin = on; adminEmail = on ? email : null;
    document.body.classList.toggle("is-admin", isAdmin);
    document.body.classList.toggle("remote", REMOTE);
    $("logoutBtn").textContent = adminEmail ? "Log Out (" + adminEmail + ")" : "Log Out";
    if (!on && editingId) stopEditing();
    render();
  }

  // Admin whose Supabase login is still saved here. Supabase keeps it when renewing fails only for lack of
  // internet, and deletes it on log out or when the login is no longer valid.
  function savedLogin() {
    const s = readJSON(SESSION_KEY, null), email = ls.get(ADMIN_KEY);
    return s && s.refresh_token && s.user && s.user.email === email ? email : null;
  }

  // true / false, or null when it cannot be checked (offline)
  async function confirmAdmin() {
    try {
      // Right after reconnecting, an expired login may not be renewed yet. Wait for it instead of logging out.
      const s = await db.auth.getSession();
      if (!s.data.session) return savedLogin() ? null : false;
      const r = await db.rpc("is_admin");
      if (r.error) throw r.error;
      return r.data === true;
    } catch (e) { return isNetworkError(e) ? null : false; }
  }

  function openModal(id) { $(id).classList.remove("hidden"); }
  function closeModal(id) { $(id).classList.add("hidden"); }
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m.id); if (m.id === "loginModal" && (e.target === m || e.target.closest("[data-close]"))) finishLogin(false); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("loginModal").classList.contains("hidden")) { closeModal("loginModal"); finishLogin(false); }
    closeModal("pwModal");
  });

  let loginResolve = null;
  function askLogin() {
    return new Promise((resolve) => {
      loginResolve = resolve;
      $("loginPassword").value = ""; $("loginError").textContent = "";
      openModal("loginModal");
      setTimeout(() => ($("loginEmail").value ? $("loginPassword") : $("loginEmail")).focus(), 30);
    });
  }
  function finishLogin(ok) { closeModal("loginModal"); const r = loginResolve; loginResolve = null; if (r) r(ok); }
  $("showPw").addEventListener("change", (e) => { $("loginPassword").type = e.target.checked ? "text" : "password"; });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("loginEmail").value.trim().toLowerCase(), password = $("loginPassword").value;
    const err = $("loginError"), btn = $("loginSubmit");
    if (!email || !password) { err.textContent = "Enter your admin email and password."; return; }
    if (!navigator.onLine) { err.textContent = "You’re offline. Log in once while connected; after that this device can keep entering points without internet."; return; }
    btn.disabled = true; err.textContent = ""; loggingIn = true;
    try {
      const res = await db.auth.signInWithPassword({ email, password });
      if (res.error) {
        err.textContent = /invalid login credentials/i.test(res.error.message) ? "Email or password is incorrect."
          : /confirm/i.test(res.error.message) ? "This login isn’t confirmed yet. Confirm the user in Supabase and try again."
          : "Couldn’t log in: " + res.error.message;
        return;
      }
      if ((await confirmAdmin()) !== true) {
        await db.auth.signOut();
        err.textContent = "This account can’t edit scores. Add its email to the admins list in Supabase.";
        return;
      }
      ls.set(ADMIN_KEY, res.data.user.email);
      needLogin = false;
      setAdmin(true, res.data.user.email);
      finishLogin(true);
      toastNote("✓ Logged in as " + res.data.user.email);
      flush();
    } catch (ex) {
      console.error(ex);
      err.textContent = "Can’t reach the login server. Check the internet connection and try again.";
    } finally { btn.disabled = false; loggingIn = false; }
  });

  async function syncSession(session) {
    if (!REMOTE || loggingIn) return;
    if (!session) {
      // A saved session can expire while the device is offline (or on Wi-Fi with no internet).
      // Keep local entry available to an admin who logged in here before; Supabase checks on sync.
      const cachedEmail = savedLogin();
      setAdmin(!!cachedEmail, cachedEmail);
      updateStatus();
      return;
    }
    let ok = await confirmAdmin();
    if (ok === null) ok = ls.get(ADMIN_KEY) === session.user.email;   // offline: trust this device's last check; Supabase re-checks every change on sync
    else if (ok) ls.set(ADMIN_KEY, session.user.email);
    else { ls.del(ADMIN_KEY); await db.auth.signOut(); }
    if (ok) needLogin = false;
    setAdmin(ok, session.user.email);
    updateStatus();
    if (ok) flush();
  }

  async function requireAdmin() {
    if (!REMOTE || isAdmin) return true;
    return askLogin();
  }

  $("loginBtn").addEventListener("click", () => askLogin());
  $("logoutBtn").addEventListener("click", async () => {
    if (queue.length && !confirm(plural(queue.length, "change") + " haven’t synced yet. They stay saved on this device and sync the next time an admin logs in here. Log out anyway?")) return;
    try { await db.auth.signOut(); } catch (e) {}
    ls.del(ADMIN_KEY);
    setAdmin(false, null);
    toastNote("Logged out. This device can only view scores now.");
  });

  $("changePwBtn").addEventListener("click", () => {
    $("pwNew").value = ""; $("pwConfirm").value = ""; $("pwError").textContent = "";
    openModal("pwModal"); setTimeout(() => $("pwNew").focus(), 30);
  });
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("pwNew").value, b = $("pwConfirm").value, err = $("pwError");
    if (a.length < 10) { err.textContent = "Use at least 10 characters."; return; }
    if (a !== b) { err.textContent = "The two passwords don’t match."; return; }
    if (!navigator.onLine) { err.textContent = "Connect to the internet to change the password."; return; }
    $("pwSubmit").disabled = true; err.textContent = "";
    try {
      const res = await db.auth.updateUser({ password: a });
      if (res.error) { err.textContent = "Password not changed: " + res.error.message; return; }
      closeModal("pwModal"); toastNote("✓ Password changed. Use the new one next time you log in.");
    } catch (ex) { err.textContent = "Can’t reach the login server. Try again."; }
    finally { $("pwSubmit").disabled = false; }
  });

  /* ---------- Score entry ---------- */
  $("eventName").insertAdjacentHTML("beforeend", SPORTS_EVENTS.map((n, i) => `<option value="${esc(n)}">${i + 1}. ${esc(n)}</option>`).join(""));

  function ensureOption(name) {
    const sel = $("eventName");
    if (![...sel.options].some((o) => o.value === name)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(name)}">${esc(name)}</option>`);
    sel.value = name;
  }
  function stopEditing() {
    editingId = null;
    $("scoreForm").reset();
    $("saveBtn").textContent = "＋ Update Scoreboard";
    $("cancelEditBtn").classList.add("hidden");
    $("entryTitle").textContent = "✎ Enter points after each event";
    render();
  }

  $("scoreForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("eventName").value.trim();
    if (!name) { alert("Select a sports event first."); $("eventName").focus(); return; }
    const scores = {};
    for (const h of HOUSES) {
      const v = $(h.input).value.trim();
      if (v === "" || !Number.isFinite(Number(v)) || Number(v) < 0) { alert("Enter a valid non-negative score for every house."); $(h.input).focus(); return; }
      scores[h.key] = Number(v);
    }
    if (!editingId && events.some((x) => x.name === name) &&
        !confirm("“" + name + "” already has scores. Add another entry for it?")) return;
    if (!(await requireAdmin())) return;

    const saved = editingId ? commit({ op: "update", id: editingId, ev: { name, scores } })
      : commit({ op: "add", id: newId(), ev: { name, scores }, created_at: new Date().toISOString() });
    if (saved) stopEditing();
  });
  $("cancelEditBtn").addEventListener("click", stopEditing);

  $("eventRows").addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-edit]"), delBtn = e.target.closest("[data-delete]");
    if (editBtn) {
      const ev = events.find((x) => x.id === editBtn.dataset.edit); if (!ev) return;
      editingId = ev.id;
      ensureOption(ev.name);
      HOUSES.forEach((h) => { $(h.input).value = ev.scores[h.key]; });
      $("saveBtn").textContent = "Save Changes";
      $("cancelEditBtn").classList.remove("hidden");
      $("entryTitle").textContent = "✎ Edit event points";
      render();
      $("entryPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (delBtn) {
      const ev = events.find((x) => x.id === delBtn.dataset.delete); if (!ev) return;
      if (!confirm("Delete “" + ev.name + "”? House totals will be recalculated.")) return;
      if (!(await requireAdmin())) return;
      if (commit({ op: "delete", id: ev.id }) && editingId === ev.id) stopEditing();
    }
  });

  /* ---------- Buttons ---------- */
  $("displayBtn").addEventListener("click", () => window.open(location.origin + location.pathname + "?display=1", "FatimaScoreboardDisplay", "noopener"));
  $("winnerBtn").addEventListener("click", () => window.open(location.origin + location.pathname + "?winner=1", "FatimaScoreboardWinner", "noopener"));

  $("exportBtn").addEventListener("click", () => {
    const data = { app: "Fatima Veloxia 2K26 Scoreboard", version: 2, exportedAt: new Date().toISOString(), events };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "fatima-scoreboard-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = Array.isArray(data) ? data : data.events;
      if (!Array.isArray(incoming)) throw new Error("bad file");
      if (!confirm("Import will replace all current scores with the " + plural(incoming.length, "event") + " in this backup. Continue?")) return;
      if (!(await requireAdmin())) return;
      const ops = [{ op: "clear" }, ...incoming.map(normalize).map((ev) =>
        ({ op: "add", id: isUuid(ev.id) ? ev.id : newId(), ev: { name: ev.name, scores: ev.scores }, created_at: ev.created_at }))];
      if (commitMany(ops)) {
        stopEditing();
        toastNote("✓ Backup imported: " + plural(incoming.length, "event"));
      }
    } catch (err) { alert("That backup file could not be read."); }
  });

  $("resetBtn").addEventListener("click", async () => {
    if (!confirm("Reset ALL event records and house scores? Export a backup first if you may need these scores.")) return;
    if (!(await requireAdmin())) return;
    if (commit({ op: "clear" })) stopEditing();
  });

  /* ---------- Install as app + offline support ---------- */
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("installBtn").classList.remove("hidden"); });
  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) {}
    installPrompt = null; $("installBtn").classList.add("hidden");
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Offline support unavailable:", e)));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  /* ---------- Start ---------- */
  if (new URLSearchParams(location.search).get("display") === "1") {
    document.body.classList.add("displaymode");
  }
  if (WINNER_MODE) startWinnerScreen();
  // Restore a saved admin login straight away: without internet, Supabase can take ~30 s to report it.
  const restored = REMOTE ? savedLogin() : null;
  setAdmin(!REMOTE || !!restored, restored);
  refreshView();

  if (REMOTE) {
    pull().then(flush);
    db.channel("veloxia-events")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => pull())
      .subscribe((status) => { subscribed = status === "SUBSCRIBED"; if (subscribed) pull(); else updateStatus(); });
    setInterval(() => { if (queue.length) flush(); else if (!subscribed) pull(); }, 15000);
    window.addEventListener("online", () => { reachable = true; flush(); pull(); });
    window.addEventListener("offline", updateStatus);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { flush(); pull(); } });
    // Supabase advises not to call it from inside the auth callback, so defer.
    db.auth.onAuthStateChange((evt, session) => setTimeout(() => syncSession(session), 0));
    // Big-screen tab on the same device: show changes saved here even before they reach Supabase.
    window.addEventListener("storage", (e) => {
      if (e.key === QUEUE_KEY) { queue = readJSON(QUEUE_KEY, []); refreshView(); }
      if (e.key === CACHE_KEY) { base = readJSON(CACHE_KEY, []).map(normalize); refreshView(); }
    });
  } else {
    // Keep several local tabs (admin + big-screen display) in step.
    window.addEventListener("storage", (e) => { if (e.key === LOCAL_KEY) { base = readJSON(LOCAL_KEY, []).map(normalize); refreshView(); } });
  }
})();
