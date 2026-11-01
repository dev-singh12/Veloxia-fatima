import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const appSource = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const EMAIL = "admin@example.test";
const QUEUE = "veloxiaPendingChangesV1";
const ADMIN = "veloxiaAdminEmailV1";

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

function startApp(storage, network) {
  const elements = new Map();
  const listeners = new Map();
  const alerts = [];
  const element = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: "", innerHTML: "", textContent: "", options: [], dataset: {},
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
        },
        addEventListener(name, callback) { this[name] = callback; },
        insertAdjacentHTML() {}, reset() {}, focus() {}, scrollIntoView() {}
      });
    }
    return elements.get(id);
  };
  const document = {
    body: element("body"),
    getElementById: element,
    querySelectorAll: () => [],
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  const window = {
    supabase: { createClient: () => database },
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  const database = {
    from() {
      return {
        select() { return { order: async () => network.online
          ? { data: network.rows.map((row) => ({ ...row })) }
          : { error: { message: "Failed to fetch" } } }; },
        async insert(row) {
          if (!network.online) return { error: { message: "Failed to fetch" } };
          if (network.reject) return { error: { message: "server rejected row", code: "23514" } };
          if (!network.rows.some((item) => item.id === row.id)) network.rows.push(row);
          return { error: null };
        }
      };
    },
    async rpc() { return network.online ? { data: true } : { error: { message: "Failed to fetch" } }; },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    auth: { onAuthStateChange(callback) {
      setTimeout(() => callback("INITIAL_SESSION", network.session === false ? null : { user: { email: EMAIL } }), 0);
    } }
  };
  const navigator = { get onLine() { return network.online; } };
  const localStorage = {
    getItem: (key) => storage.values.get(key) ?? null,
    setItem(key, value) {
      if (storage.fail) throw new Error("Storage full");
      storage.values.set(key, value);
    },
    removeItem: (key) => storage.values.delete(key)
  };
  const self = { VELOXIA_CONFIG: { supabaseUrl: "https://example.supabase.co", supabaseKey: "public" }, crypto: globalThis.crypto };
  runInNewContext(appSource, {
    self, window, document, navigator, localStorage, crypto: globalThis.crypto,
    location: { protocol: "https:", hostname: "example.test", search: "" },
    URLSearchParams, Date, Math, Number, Set, String, JSON,
    setTimeout, clearTimeout, setInterval: () => 0,
    alert: (message) => alerts.push(message), confirm: () => true,
    console: { error() {}, warn() {} }
  });
  return { element, listeners, alerts };
}

async function enterScores(app, name) {
  app.element("eventName").value = name;
  for (const id of ["pFatima", "pCarmel", "pLourdes", "pVelankani"]) app.element(id).value = "5";
  await app.element("scoreForm").submit({ preventDefault() {} });
  await delay();
}

async function testOfflineQueue() {
  const storage = { values: new Map([[ADMIN, EMAIL]]), fail: false };
  const network = { online: false, rows: [], reject: false };
  let app = startApp(storage, network);
  await delay();
  await enterScores(app, "Offline race");
  assert.equal(JSON.parse(storage.values.get(QUEUE)).length, 1);
  assert.match(app.element("cards").innerHTML, /5/);

  app = startApp(storage, network);
  await delay();
  assert.match(app.element("cards").innerHTML, /5/);
  assert.match(app.element("syncNote").textContent, /1 change saved/);

  network.online = true;
  app.listeners.get("online")();
  await delay();
  assert.equal(network.rows.length, 1);
  assert.equal(JSON.parse(storage.values.get(QUEUE)).length, 0);
}

async function testRejectedSyncKeepsEdit() {
  const storage = { values: new Map([[ADMIN, EMAIL]]), fail: false };
  const network = { online: false, rows: [], reject: true };
  const app = startApp(storage, network);
  await delay();
  await enterScores(app, "Rejected race");
  network.online = true;
  app.listeners.get("online")();
  await delay();
  assert.equal(JSON.parse(storage.values.get(QUEUE)).length, 1);
  assert.match(app.element("syncNote").textContent, /sync failed/);
  network.reject = false;
  app.listeners.get("online")();
  await delay();
  assert.equal(JSON.parse(storage.values.get(QUEUE)).length, 0);
}

async function testStorageFailure() {
  const storage = { values: new Map([[ADMIN, EMAIL]]), fail: false };
  const network = { online: false, rows: [], reject: false };
  const app = startApp(storage, network);
  await delay();
  storage.fail = true;
  await enterScores(app, "Unsaved race");
  assert.equal(storage.values.has(QUEUE), false);
  assert.doesNotMatch(app.element("cards").innerHTML, /<div class="score">5<\/div>/);
  assert.equal(app.element("eventName").value, "Unsaved race");
  assert.match(app.alerts[0], /could not save/);
}

async function testExpiredOfflineSession() {
  const storage = { values: new Map([[ADMIN, EMAIL]]), fail: false };
  const network = { online: false, rows: [], reject: false, session: false };
  const app = startApp(storage, network);
  await delay();
  await enterScores(app, "Session expired race");
  assert.equal(JSON.parse(storage.values.get(QUEUE)).length, 1);
}

async function testWorkerInstall() {
  for (const fail of [true, false]) {
    const handlers = new Map();
    let activated = false;
    const cached = new Map();
    const cache = {
      async addAll(requests) {
        if (fail) throw new Error("core asset unavailable");
        for (const request of requests) cached.set(request.url, { ok: true });
      },
      async add(request) { cached.set(request.url, { ok: true }); },
      async match(url) { return cached.get(url); }
    };
    const self = {
      location: { origin: "https://example.test" },
      addEventListener: (name, callback) => handlers.set(name, callback),
      skipWaiting: async () => { activated = true; }
    };
    const Request = class { constructor(url) { this.url = url; } };
    runInNewContext(workerSource, {
      self, Request, URL,
      importScripts: () => { self.VELOXIA_CONFIG = { buildId: "test" }; },
      caches: { open: async () => cache },
      fetch: async () => { throw new Error("offline"); },
      setTimeout: (callback, ms) => ms === 4000 ? 0 : setTimeout(callback, ms)
    });
    let install;
    handlers.get("install")({ waitUntil: (promise) => { install = promise; } });
    if (fail) await assert.rejects(install, /core asset unavailable/);
    else await install;
    assert.equal(activated, !fail);
    if (!fail) assert.ok(cached.has("/index.html"));
    if (!fail) {
      cached.set("/index.html", { offlinePage: true });
      let response;
      handlers.get("fetch")({
        request: { method: "GET", url: "https://example.test/?display=1", mode: "navigate" },
        respondWith: (promise) => { response = promise; }
      });
      assert.equal((await response).offlinePage, true);
    }
  }
}

await testOfflineQueue();
await testRejectedSyncKeepsEdit();
await testStorageFailure();
await testExpiredOfflineSession();
await testWorkerInstall();
console.log("Offline reload, queued edits, reconnect, rejected sync, expired session, storage failure, and app-shell fallback passed.");
