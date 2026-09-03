/**
 * MarkFont server — static file host + accounts API.
 *
 * Zero dependencies: node:http, node:sqlite and node:crypto only, so it runs
 * with a bare `node server.js` and no npm install.
 *
 * Accounts use mobile OTP. Codes are generated, texted and verified by the
 * external OTP service, so this project stores no SMS credentials and never
 * sees a code; a verified phone gets a session cookie. Signed-in users can
 * like fonts and file them into their own named collections.
 *
 * The OTP service is only ever called from here, never from the browser.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;

/* ------------------------------ config ------------------------------ */

function loadEnv() {
  const out = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    console.warn("No .env found — copy .env.example to .env. Running in dev SMS mode.");
  }
  return out;
}

const ENV = { ...loadEnv(), ...process.env };
const PORT = Number(ENV.PORT || 8642);
const SESSION_SECRET = ENV.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Codes are generated, delivered and checked by this external service. We
// never see, store or hash a code, and no SMS credentials exist anywhere in
// this project. Calls are made from here, never from the browser.
const OTP_API = (ENV.OTP_API_BASE || "https://otp.eldery.ir").replace(/\/+$/, "");

const OTP_RESEND_MS = 60 * 1000;       // shields the upstream service from spam
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/* ------------------------------ database ---------------------------- */

const db = new DatabaseSync(path.join(ROOT, "markfont.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);
-- Only a resend clock. The codes themselves live with the OTP service.
CREATE TABLE IF NOT EXISTS otp_throttle (
  phone        TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slug)
);
CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, slug)
);
`);

/* ------------------------------ helpers ----------------------------- */

const now = () => Date.now();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/** Accepts 09xxxxxxxxx / +989xxxxxxxxx / 989xxxxxxxxx and normalises to 09xxxxxxxxx. */
function normalizePhone(input) {
  let d = String(input || "")
    .replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
    .replace(/\D/g, "");
  if (d.startsWith("0098")) d = d.slice(4);
  else if (d.startsWith("98") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("9")) d = "0" + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

/** POST to the OTP service and normalise its reply into {ok, data, error}. */
async function otpCall(endpoint, payload) {
  try {
    const res = await fetch(`${OTP_API}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON reply */ }
    if (!res.ok || data.success === false) {
      return { ok: false, error: data.error || `OTP service HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
    return { ok: false, error: timedOut ? "OTP service timed out" : e.message, status: 503 };
  }
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = 1e5) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).mf_session;
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.id, u.phone FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, now());
  return row || null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: "sign in first" }); return null; }
  return user;
}

/* --------------------------- static files --------------------------- */

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff",
  ".woff2": "font/woff2", ".eot": "application/vnd.ms-fontobject",
  ".zip": "application/zip", ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

async function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return json(res, 400, { error: "bad path" }); }
  if (rel === "/" || rel === "") rel = "/index.html";

  // Resolve then confirm containment, so "../" cannot escape the library.
  const full = path.resolve(ROOT, "." + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    return json(res, 403, { error: "forbidden" });
  }
  // The database and secrets live in this folder; never hand them out.
  const base = path.basename(full).toLowerCase();
  if (base === ".env" || base.startsWith("markfont.db")) {
    return json(res, 403, { error: "forbidden" });
  }

  let stat;
  try { stat = await fsp.stat(full); } catch { return json(res, 404, { error: "not found" }); }
  if (stat.isDirectory()) return json(res, 404, { error: "not found" });

  const ext = path.extname(full).toLowerCase();
  const etag = `"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304).end(); return; }

  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    ETag: etag,
    // Font binaries are content-addressed by path and effectively immutable;
    // markup and the catalog must stay fresh.
    "Cache-Control": [".ttf", ".otf", ".woff", ".woff2", ".eot", ".zip"].includes(ext)
      ? "public, max-age=31536000"
      : "no-cache",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(full).pipe(res).on("error", () => res.destroy());
}

/* ------------------------------- API -------------------------------- */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // --- request a login code ---
  if (p === "/api/auth/request-otp" && method === "POST") {
    const { phone } = await readBody(req);
    const num = normalizePhone(phone);
    if (!num) return json(res, 400, { error: "شماره موبایل معتبر نیست" });

    const prev = db.prepare("SELECT last_sent_at FROM otp_throttle WHERE phone = ?").get(num);
    if (prev && now() - prev.last_sent_at < OTP_RESEND_MS) {
      const wait = Math.ceil((OTP_RESEND_MS - (now() - prev.last_sent_at)) / 1000);
      return json(res, 429, { error: `${wait} ثانیه دیگر دوباره تلاش کنید`, retryAfter: wait });
    }

    const sent = await otpCall("/otp/send", { phone: num });
    if (!sent.ok) {
      console.error("OTP send failed:", sent.error);
      return json(res, 502, { error: "ارسال پیامک ناموفق بود" });
    }
    // Only start the clock once the send actually succeeded, so a failed
    // attempt does not lock the user out for a minute.
    db.prepare(
      `INSERT INTO otp_throttle (phone, last_sent_at) VALUES (?, ?)
       ON CONFLICT(phone) DO UPDATE SET last_sent_at = excluded.last_sent_at`
    ).run(num, now());

    return json(res, 200, { ok: true });
  }

  // --- verify the code, open a session ---
  if (p === "/api/auth/verify-otp" && method === "POST") {
    const { phone, code } = await readBody(req);
    const num = normalizePhone(phone);
    if (!num || !/^\d{6}$/.test(String(code || ""))) {
      return json(res, 400, { error: "کد یا شماره نامعتبر است" });
    }
    const check = await otpCall("/otp/verify", { phone: num, code: String(code) });
    // Treat anything short of an explicit pass as a failure, so a malformed
    // or unexpected reply can never open a session.
    if (!check.ok || check.data.verified !== true) {
      return json(res, 400, { error: "کد نادرست یا منقضی شده است" });
    }
    db.prepare("DELETE FROM otp_throttle WHERE phone = ?").run(num);

    let user = db.prepare("SELECT id, phone FROM users WHERE phone = ?").get(num);
    if (!user) {
      db.prepare("INSERT INTO users (phone, created_at) VALUES (?, ?)").run(num, now());
      user = db.prepare("SELECT id, phone FROM users WHERE phone = ?").get(num);
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, user.id, now() + SESSION_TTL_MS);

    return json(res, 200, { ok: true, user: { phone: user.phone } }, {
      "Set-Cookie": `mf_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
  }

  if (p === "/api/auth/logout" && method === "POST") {
    const token = parseCookies(req).mf_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return json(res, 200, { ok: true }, {
      "Set-Cookie": "mf_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
    });
  }

  if (p === "/api/me" && method === "GET") {
    const user = currentUser(req);
    if (!user) return json(res, 200, { user: null });
    return json(res, 200, { user: { phone: user.phone }, ...userData(user.id) });
  }

  // --- likes ---
  if (p === "/api/likes" && method === "POST") {
    const user = requireUser(req, res); if (!user) return;
    const { slug, liked } = await readBody(req);
    if (!slug || typeof slug !== "string") return json(res, 400, { error: "slug required" });
    if (liked) {
      db.prepare("INSERT OR IGNORE INTO likes (user_id, slug, created_at) VALUES (?, ?, ?)")
        .run(user.id, slug, now());
    } else {
      db.prepare("DELETE FROM likes WHERE user_id = ? AND slug = ?").run(user.id, slug);
    }
    return json(res, 200, { ok: true, ...userData(user.id) });
  }

  // --- collections ---
  if (p === "/api/collections" && method === "POST") {
    const user = requireUser(req, res); if (!user) return;
    const { name } = await readBody(req);
    const clean = String(name || "").trim().slice(0, 60);
    if (!clean) return json(res, 400, { error: "نام دسته را وارد کنید" });
    try {
      db.prepare("INSERT INTO collections (user_id, name, created_at) VALUES (?, ?, ?)")
        .run(user.id, clean, now());
    } catch {
      return json(res, 409, { error: "این دسته از قبل وجود دارد" });
    }
    return json(res, 200, { ok: true, ...userData(user.id) });
  }

  let m = p.match(/^\/api\/collections\/(\d+)$/);
  if (m && method === "DELETE") {
    const user = requireUser(req, res); if (!user) return;
    db.prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").run(Number(m[1]), user.id);
    return json(res, 200, { ok: true, ...userData(user.id) });
  }

  m = p.match(/^\/api\/collections\/(\d+)\/items$/);
  if (m && method === "POST") {
    const user = requireUser(req, res); if (!user) return;
    const id = Number(m[1]);
    const owned = db.prepare("SELECT id FROM collections WHERE id = ? AND user_id = ?").get(id, user.id);
    if (!owned) return json(res, 404, { error: "collection not found" });
    const { slug, remove } = await readBody(req);
    if (!slug) return json(res, 400, { error: "slug required" });
    if (remove) {
      db.prepare("DELETE FROM collection_items WHERE collection_id = ? AND slug = ?").run(id, slug);
    } else {
      db.prepare("INSERT OR IGNORE INTO collection_items (collection_id, slug, added_at) VALUES (?, ?, ?)")
        .run(id, slug, now());
    }
    return json(res, 200, { ok: true, ...userData(user.id) });
  }

  return json(res, 404, { error: "unknown endpoint" });
}

/** Everything the client needs to render like/bookmark state in one payload. */
function userData(userId) {
  const likes = db.prepare("SELECT slug FROM likes WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId).map((r) => r.slug);
  const collections = db.prepare(
    "SELECT id, name FROM collections WHERE user_id = ? ORDER BY created_at"
  ).all(userId).map((c) => ({
    ...c,
    items: db.prepare("SELECT slug FROM collection_items WHERE collection_id = ? ORDER BY added_at DESC")
      .all(c.id).map((r) => r.slug),
  }));
  return { likes, collections };
}

/* ------------------------------ server ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "method not allowed" });
    }
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error("request failed:", err.message);
    if (!res.headersSent) json(res, 500, { error: "server error" });
  }
});

// Housekeeping: drop expired sessions and stale resend clocks hourly.
setInterval(() => {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
    db.prepare("DELETE FROM otp_throttle WHERE last_sent_at < ?").run(now() - 24 * 3600 * 1000);
  } catch { /* not worth crashing the server over */ }
}, 3600 * 1000).unref();

server.listen(PORT, () => {
  console.log(`MarkFont running at http://localhost:${PORT}`);
  console.log(`OTP: codes sent and verified by ${OTP_API}`);
});
