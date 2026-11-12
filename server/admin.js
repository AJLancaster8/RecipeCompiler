// Admin dashboard for the recipe server: live CPU / memory / storage stats,
// grouped errors, and a read-only browser for every table in the databases.
//
// Open http://<server>:3000/admin in a browser and sign in with an admin
// account (promote one with `npm run make-admin -- <username>`).
//
// Endpoints (all need an admin session token, except the page itself):
//   GET    /admin                       the dashboard page (admin.html)
//   GET    /admin/api/stats             process, request and storage stats
//   GET    /admin/api/errors            grouped errors
//   DELETE /admin/api/errors            clear the error list
//   GET    /admin/api/tables            every database → tables, columns, row counts
//   GET    /admin/api/table?db=&table=&page=&pageSize=&sort=&dir=&q=
//                                       one page of a table's rows

/* global __dirname */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const SAMPLE_INTERVAL_MS = 3000;
const MAX_SAMPLES = 200; // 10 minutes of history
const MAX_ERROR_GROUPS = 200;
const RECENT_PER_GROUP = 10;
const MAX_PAGE_SIZE = 200;

// Columns that are never shown in full. Password hashes and session token
// hashes aren't passwords, but there's no reason to put them on screen.
const HIDDEN_COLUMNS = {
  "accounts.users.password_hash": () => "•••••• (hidden)",
  "accounts.sessions.token_hash": (v) => `${String(v).slice(0, 8)}…`,
  "accounts.avatars.data": (v) => `<image, ${(v.length / 1024).toFixed(1)} KB>`,
};

const ADMIN_HTML_PATH = path.join(__dirname, "admin.html");
const startedAt = Date.now();
const cores = os.availableParallelism ? os.availableParallelism() : os.cpus().length;

// ---------- live process samples ----------

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

const samples = []; // { t, cpu, rss, heapUsed, heapTotal, external, requests, avgMs, loopMs }
let lastCpu = process.cpuUsage();
let lastTime = process.hrtime.bigint();
// Requests since the last sample (admin dashboard polling isn't counted).
let windowRequests = 0;
let windowDurationMs = 0;
let totalRequests = 0;

function takeSample() {
  const now = process.hrtime.bigint();
  const elapsedUs = Number(now - lastTime) / 1000;
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  lastTime = now;
  const mem = process.memoryUsage();
  samples.push({
    t: Date.now(),
    // Percent of ONE core (can exceed 100% if work runs on several threads).
    cpu: elapsedUs > 0 ? ((cpu.user + cpu.system) / elapsedUs) * 100 : 0,
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    requests: windowRequests,
    avgMs: windowRequests ? windowDurationMs / windowRequests : 0,
    loopMs: eventLoop.mean / 1e6,
  });
  if (samples.length > MAX_SAMPLES) samples.shift();
  windowRequests = 0;
  windowDurationMs = 0;
  eventLoop.reset();
}

function startSampling() {
  takeSample();
  setInterval(takeSample, SAMPLE_INTERVAL_MS).unref();
}

// ---------- errors ----------

const errorGroups = new Map(); // key → group

// "/recipes/12" → "/recipes/:id" so the same error on different recipes
// lands in one group.
function routePattern(rawUrl) {
  const pathname = String(rawUrl || "").split("?")[0];
  return (
    pathname
      .split("/")
      .map((seg) => (/^\d+$/.test(seg) ? ":id" : seg))
      .join("/") || "/"
  );
}

function recordError({ method, url, status, message, stack, userId }) {
  const route = routePattern(url);
  const msg = String(message || `HTTP ${status}`).slice(0, 500);
  const key = `${status}|${method}|${route}|${msg}`;
  const now = new Date().toISOString();
  let group = errorGroups.get(key);
  if (!group) {
    if (errorGroups.size >= MAX_ERROR_GROUPS) {
      // Drop the group that's been quiet the longest.
      let oldestKey = null;
      for (const [k, g] of errorGroups) {
        if (!oldestKey || g.lastSeen < errorGroups.get(oldestKey).lastSeen) oldestKey = k;
      }
      errorGroups.delete(oldestKey);
    }
    group = { key, status, method, route, message: msg, count: 0, firstSeen: now, lastSeen: now, stack: null, recent: [] };
    errorGroups.set(key, group);
  }
  group.count++;
  group.lastSeen = now;
  if (stack) group.stack = String(stack).slice(0, 4000);
  group.recent.unshift({ at: now, url: String(url).slice(0, 300), userId: userId ?? null });
  if (group.recent.length > RECENT_PER_GROUP) group.recent.pop();
}

// Called for every finished request (see server/index.js).
function recordRequest(req, res, startNs) {
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const isAdmin = String(req.url).startsWith("/admin");
  if (!isAdmin && req.method !== "OPTIONS") {
    totalRequests++;
    windowRequests++;
    windowDurationMs += durationMs;
  }
  if (res.statusCode >= 400) {
    recordError({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      message: res.errorMessage,
      stack: res.errorStack,
      userId: res.userId,
    });
  }
}

// ---------- databases ----------

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function tablesOf(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => t.name);
}

// table name → bytes on disk (its indexes included), via SQLite's dbstat.
function tableSizes(db) {
  try {
    const owner = new Map(
      db.prepare("SELECT name, tbl_name FROM sqlite_master").all().map((r) => [r.name, r.tbl_name])
    );
    const sizes = new Map();
    for (const { name, bytes } of db.prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name").all()) {
      const table = owner.get(name) ?? name;
      sizes.set(table, (sizes.get(table) ?? 0) + Number(bytes));
    }
    return sizes;
  } catch {
    return new Map(); // dbstat not compiled in — sizes just aren't shown
  }
}

function createAdmin({ databases, dataDir, userFromRequest, send }) {
  // databases: { accounts: { db, path }, recipes: {...}, saved: {...} }

  function storage() {
    const dbs = Object.entries(databases).map(([name, { db, path: p }]) => {
      const files = { db: fileSize(p), wal: fileSize(`${p}-wal`), shm: fileSize(`${p}-shm`) };
      const sizes = tableSizes(db);
      return {
        name,
        file: path.basename(p),
        files,
        total: files.db + files.wal + files.shm,
        tables: tablesOf(db).map((t) => ({
          name: t,
          rows: Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(t)}`).get().n),
          bytes: sizes.get(t) ?? null,
        })),
      };
    });
    // Anything else in the data folder (backups from migrations, etc.).
    let otherBytes = 0;
    const known = new Set(Object.values(databases).flatMap(({ path: p }) => [p, `${p}-wal`, `${p}-shm`]));
    try {
      for (const f of fs.readdirSync(dataDir)) {
        const full = path.join(dataDir, f);
        if (!known.has(full)) otherBytes += fileSize(full);
      }
    } catch {
      // ignore
    }
    let disk = null;
    try {
      const s = fs.statfsSync(dataDir);
      disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    } catch {
      // statfs unsupported here
    }
    return { dataDir, databases: dbs, otherBytes, disk };
  }

  function stats() {
    return {
      now: Date.now(),
      startedAt,
      uptimeSec: process.uptime(),
      node: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      pid: process.pid,
      cores,
      systemMemory: { total: os.totalmem(), free: os.freemem() },
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      samples,
      totalRequests,
      errorCount: [...errorGroups.values()].reduce((n, g) => n + g.count, 0),
      storage: storage(),
    };
  }

  function tableRows(url) {
    const dbName = url.searchParams.get("db");
    const table = url.searchParams.get("table");
    const entry = databases[dbName];
    if (!entry) return { status: 404, body: { error: "Unknown database" } };
    const { db } = entry;
    // Table and column names are only ever used if they're real ones.
    if (!tablesOf(db).includes(table)) return { status: 404, body: { error: "Unknown table" } };
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => ({
      name: c.name,
      type: c.type,
      pk: c.pk > 0,
      hidden: Boolean(HIDDEN_COLUMNS[`${dbName}.${table}.${c.name}`]),
    }));
    const colNames = columns.map((c) => c.name);

    const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50, 1), MAX_PAGE_SIZE);
    const sort = colNames.includes(url.searchParams.get("sort")) ? url.searchParams.get("sort") : null;
    const dir = url.searchParams.get("dir") === "desc" ? "DESC" : "ASC";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);

    let where = "";
    const params = [];
    if (q) {
      const searchable = columns.filter((c) => !c.hidden).map((c) => c.name);
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where = `WHERE ${searchable.map((c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(" OR ")}`;
      params.push(...searchable.map(() => like));
    }
    const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} ${where}`).get(...params).n);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), pageCount);
    const order = sort ? `ORDER BY ${quoteIdent(sort)} ${dir}` : "ORDER BY rowid";
    const rows = db
      .prepare(`SELECT * FROM ${quoteIdent(table)} ${where} ${order} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map((row) =>
        colNames.map((c) => {
          const mask = HIDDEN_COLUMNS[`${dbName}.${table}.${c}`];
          const v = row[c];
          if (mask && v != null) return mask(v);
          return typeof v === "bigint" ? Number(v) : v;
        })
      );
    return { status: 200, body: { db: dbName, table, columns, rows, page, pageSize, pageCount, total, sort, dir: dir.toLowerCase(), q } };
  }

  function databaseList() {
    return Object.entries(databases).map(([name, { db, path: p }]) => ({
      name,
      file: path.basename(p),
      tables: tablesOf(db).map((t) => ({
        name: t,
        rows: Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(t)}`).get().n),
        columns: db.prepare(`PRAGMA table_info(${quoteIdent(t)})`).all().map((c) => c.name),
      })),
    }));
  }

  function serveHtml(res) {
    let html;
    try {
      html = fs.readFileSync(ADMIN_HTML_PATH);
    } catch {
      return send(res, 500, { error: "admin.html is missing" });
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    res.end(html);
  }

  // parts: path segments, e.g. ["admin", "api", "stats"]
  async function handleAdmin(req, res, parts, url) {
    if (parts.length === 1 && req.method === "GET") return serveHtml(res);
    if (parts[1] !== "api" || parts.length !== 3) return send(res, 404, { error: "Not found" });

    const user = userFromRequest(req);
    if (!user) return send(res, 401, { error: "You need to sign in" });
    res.userId = user.id;
    if (user.role !== "admin") return send(res, 403, { error: "Only admins can open the dashboard" });

    const action = parts[2];
    if (action === "stats" && req.method === "GET") return send(res, 200, stats());
    if (action === "errors" && req.method === "GET") {
      const groups = [...errorGroups.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
      return send(res, 200, { groups });
    }
    if (action === "errors" && req.method === "DELETE") {
      errorGroups.clear();
      return send(res, 204);
    }
    if (action === "tables" && req.method === "GET") return send(res, 200, { databases: databaseList() });
    if (action === "table" && req.method === "GET") {
      const { status, body } = tableRows(url);
      return send(res, status, body);
    }
    return send(res, 404, { error: "Not found" });
  }

  return { handleAdmin, recordRequest, startSampling };
}

module.exports = { createAdmin };
