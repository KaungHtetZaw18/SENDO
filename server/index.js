// server/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import QRCode from "qrcode";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import {
  createSession,
  getSessionById,
  getSessionByCode,
  touchSession,
  closeSession,
  sweepExpired,
  setSessionFile,
  clearSessionFile,
  allSessions,
} from "./sessionStore.js";
import { sessionDir, safeUnlink } from "./fileStore.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 300);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 100);

/* ----------------------- Middleware ----------------------- */
// Single-app deployment: open CORS is fine. If you split sender/receiver origins, restrict this.
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Sendo", time: Date.now() });
});

/* ----------------------- Helpers ----------------------- */
const ALLOWED_EXTS = new Set([
  ".epub",
  ".mobi",
  ".azw",
  ".azw3",
  ".pdf",
  ".txt",
]);
function isAllowedEbook(filename) {
  const ext = (path.extname(filename) || "").toLowerCase();
  return ALLOWED_EXTS.has(ext);
}
function requestOrigin(req) {
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : "";
}

/* ----------------------- Create session ----------------------- */
app.post("/api/session", async (req, res) => {
  const { role } = req.body || {};
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }

  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  // Track last-seen for optional liveness decisions
  s.lastSeenReceiver = Date.now();
  s.lastSeenSender = 0;
  touchSession(s, SESSION_TTL_SECONDS);

  const origin = requestOrigin(req);
  const senderLink = `${origin}/sender?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;
  const qrDataUrl = await QRCode.toDataURL(senderLink, { scale: 6, margin: 1 });

  res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    senderLink,
    qrDataUrl,
    expiresAt: s.expiresAt,
  });
});

// GET /api/session/new  -> create a receiver session (same payload as POST /api/session)
app.get("/api/session/new", async (req, res) => {
  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  touchSession(s, SESSION_TTL_SECONDS);

  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = host ? `${proto}://${host}` : "";

  const senderLink = `${origin}/sender?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;
  const qrDataUrl = await QRCode.toDataURL(senderLink, { scale: 6, margin: 1 });

  res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    senderLink,
    qrDataUrl,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- Sender connect ----------------------- */
app.post("/api/connect", (req, res) => {
  const { code, sessionId } = req.body || {};
  let s = null;
  if (code) s = getSessionByCode(String(code).toUpperCase().trim());
  if (!s && sessionId) s = getSessionById(String(sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });
  if (s.expiresAt <= Date.now() || s.status === "closed")
    return res.status(410).json({ ok: false, error: "Expired/closed" });

  s.senderConnected = true;
  s.lastSeenSender = Date.now();
  s.status = "connected";
  touchSession(s, SESSION_TTL_SECONDS);

  res.json({
    ok: true,
    sessionId: s.id,
    senderToken: s.senderToken,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- Status (polling) ----------------------- */
app.get("/api/session/:id/status", (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });

  const now = Date.now();
  const closed = s.status === "closed" || s.expiresAt <= now;
  const secondsLeft = Math.max(0, Math.floor((s.expiresAt - now) / 1000));

  res.json({
    ok: true,
    closed,
    closedBy: s.closedBy,
    status: s.status,
    hasFile: Boolean(s.file),
    file: s.file
      ? { name: s.file.name, size: s.file.size, type: s.file.type }
      : null,
    expiresAt: s.expiresAt,
    secondsLeft,
    senderConnected: s.senderConnected,
  });
});

/* ----------------------- Upload ----------------------- */
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sid = req.query.sessionId || req.body.sessionId;
    if (!sid) return cb(new Error("Missing sessionId"), "");
    cb(null, sessionDir(String(sid)));
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { sessionId, senderToken } = req.query || {};
  const s = getSessionById(String(sessionId));
  if (!s) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(404).json({ ok: false, error: "Session not found" });
  }
  if (senderToken !== s.senderToken) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
  if (!isAllowedEbook(req.file.originalname)) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(415).json({
      ok: false,
      error: "Only .epub .mobi .azw .azw3 .pdf .txt are allowed",
    });
  }

  // Single-file rule: replace previous file
  if (s.file?.path) await safeUnlink(s.file.path);

  const meta = {
    name: req.file.originalname,
    size: req.file.size,
    type: req.file.mimetype,
    path: req.file.path,
    uploadedAt: Date.now(),
  };
  setSessionFile(s, meta);
  touchSession(s, SESSION_TTL_SECONDS);

  res.json({
    ok: true,
    file: { name: meta.name, size: meta.size, type: meta.type },
  });
});

/* ----------------------- Download (delete after success) ----------------------- */
app.get("/api/download/:sessionId", async (req, res) => {
  const s = getSessionById(String(req.params.sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  const token = String(req.query.receiverToken || "");
  if (token !== s.receiverToken)
    return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (!s.file?.path || !fs.existsSync(s.file.path))
    return res.status(404).json({ ok: false, error: "No file" });

  try {
    const stat = fs.statSync(s.file.path);
    const asciiFallback = s.file.name.replace(/[^\x20-\x7E]+/g, "_");

    res.setHeader("Content-Type", s.file.type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
        s.file.name
      )}`
    );
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("Connection", "close");

    const stream = fs.createReadStream(s.file.path);
    stream.pipe(res);

    // Delete only after successful transfer (+ grace)
    res.once("finish", async () => {
      try {
        setTimeout(async () => {
          if (fs.existsSync(s.file.path)) await safeUnlink(s.file.path);
          clearSessionFile(s);
          touchSession(s, SESSION_TTL_SECONDS);
        }, 1500);
      } catch {}
    });

    // If client aborts, keep file for retry
    res.once("close", () => {});

    touchSession(s, SESSION_TTL_SECONDS);
  } catch (err) {
    console.error("download error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ----------------------- Heartbeat & Disconnect ----------------------- */
app.post("/api/heartbeat", (req, res) => {
  const { sessionId, role } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });
  if (s.status === "closed")
    return res.status(410).json({ ok: false, error: "closed" });

  // Record liveness (handy if later you want a tighter idle sweeper)
  const now = Date.now();
  if (role === "receiver") s.lastSeenReceiver = now;
  if (role === "sender") {
    s.lastSeenSender = now;
    s.senderConnected = true;
  }

  touchSession(s, SESSION_TTL_SECONDS);
  res.json({ ok: true, expiresAt: s.expiresAt });
});

app.post("/api/disconnect", async (req, res) => {
  const { sessionId, by = "sender" } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });

  try {
    if (s.file?.path && fs.existsSync(s.file.path))
      await safeUnlink(s.file.path);
  } catch {}
  clearSessionFile(s);
  closeSession(s, by); // sets status=closed and closedBy=by
  res.json({ ok: true });
});

/* ----------------------- QR as PNG (works on e-readers) ----------------------- */
app.get("/api/qr/:id.png", async (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).end();

  const origin = requestOrigin(req);
  const senderLink = `${origin}/sender?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  try {
    const png = await QRCode.toBuffer(senderLink, {
      type: "png",
      scale: 6,
      margin: 1,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Length", String(png.length));
    res.end(png);
  } catch {
    res.status(500).end();
  }
});

/* ----------------------- Background sweeps ----------------------- */
// Hard expiry for sessions/files (already deletes stale ones)
setInterval(() => sweepExpired(), 60 * 1000);

// ---- Liveness sweeper: close when one side is really gone ----
// ---- Liveness sweeper: close when one side is really gone ----
const SENDER_GONE_MS = 10000; // sender can refresh without being closed
const RECEIVER_GONE_MS = 7000; // snappy cleanup on receiver leave

setInterval(() => {
  try {
    // Direct call to sessionStore
    const all = allSessions(); // 👈 place it here

    const now = Date.now();
    for (const s of all) {
      if (!s || s.status === "closed") continue;

      // Sender vanished?
      if (s.lastSeenSender && now - s.lastSeenSender > SENDER_GONE_MS) {
        try {
          if (s.file?.path && fs.existsSync(s.file.path))
            fs.unlinkSync(s.file.path);
        } catch {}
        clearSessionFile(s);
        closeSession(s, "sender_gone");
        continue;
      }

      // Receiver vanished?
      if (s.lastSeenReceiver && now - s.lastSeenReceiver > RECEIVER_GONE_MS) {
        try {
          if (s.file?.path && fs.existsSync(s.file.path))
            fs.unlinkSync(s.file.path);
        } catch {}
        clearSessionFile(s);
        closeSession(s, "receiver_gone");
        continue;
      }
    }
  } catch (err) {
    console.error("sweeper error", err);
  }
}, 3000);

// (Optional) You could add a liveness sweeper here to close the session if
// receiver or sender stop heartbeating for X seconds. Not required because
// receiver already sends a 'disconnect' beacon on leave, and TTL handles the rest.

/* ----------------------- Serve frontend (plain files) ----------------------- */
// Serve static frontend (no React build — plain files)
// Serve static frontend (plain files) with no-cache (important for e-readers)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

app.use(
  express.static(publicDir, {
    setHeaders: (res) => {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);

// --- SSR Receiver (Kobo/Kindle safe) ---
app.get("/receiver", async (req, res) => {
  try {
    const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
    // seed liveness times
    s.lastSeenReceiver = Date.now();
    s.lastSeenSender = 0;
    touchSession(s, SESSION_TTL_SECONDS);

    const origin = requestOrigin(req);
    const senderLink = `${origin}/sender?sessionId=${encodeURIComponent(
      s.id
    )}&t=${encodeURIComponent(s.senderToken)}`;

    // Precompute a PNG buffer; some devices render it more reliably than a data URL
    const png = await QRCode.toBuffer(senderLink, {
      type: "png",
      scale: 6,
      margin: 1,
    });

    // Send HTML that already contains the code and a QR <img> via a one-time URL
    // We’ll expose the PNG via a short-lived endpoint to avoid base64 bloat in HTML.
    const qrPath = `/api/qr/${encodeURIComponent(s.id)}.png?v=${Date.now()}`;

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Minimal HTML: plain black text, big code, QR, + your lite.js enhancement at the bottom
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Send to Kobo/Kindle</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<style>
  :root { --ink:#000; --muted:#444; --border:#888; --paper:#fff; }
  *,*::before,*::after{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; background:var(--paper); color:var(--ink);
             font-family:-apple-system, system-ui, Segoe UI, Roboto, Arial, sans-serif;}
  h1{ text-align:center; font-size:22px; margin:14px 0 2px;}
  .sub{ text-align:center; color:var(--muted); font-size:12px; margin-bottom:10px;}
  .wrap{ max-width:480px; margin:0 auto 24px; padding:0 10px;}
  .card{ background:var(--paper); border:1px solid var(--border); border-radius:10px; padding:12px; text-align:center;}
  .key{ letter-spacing:8px; font-family:ui-monospace, Menlo, Consolas, monospace;
        font-size:22px; border:1px solid var(--border); border-radius:8px; padding:8px 10px; margin-bottom:10px;}
  #qr{ display:block; width:180px; height:180px; margin:10px auto 0; border:1px solid var(--border); border-radius:6px;}
  .btn{ display:block; width:100%; padding:12px 14px; border:1px solid var(--border); border-radius:10px;
        background:#eee; color:#000; font-weight:700; text-decoration:none; margin-top:12px;}
  #status{ text-align:center; color:var(--ink); font-size:12px; margin-top:8px; min-height:1em;}
  #debug{ text-align:center; color:#b00; font-size:12px; margin-top:6px; min-height:1em;}
  footer{ text-align:center; font-size:12px; color:var(--ink); margin-top:14px;}
</style>
</head>
<body>
  <h1>Send to Kobo/Kindle</h1>
  <div class="sub">E-reader friendly • no animations</div>
  <div class="wrap">
    <div class="card" id="sessionBox">
      <div class="key" id="code">${s.code}</div>
      <img id="qr" alt="QR code" src="${qrPath}">
      <a id="downloadBtn" class="btn" target="_blank" rel="noopener" style="display:none">Download file</a>
      <div id="status">Waiting for Sender to upload…</div>
      <div id="debug"></div>
    </div>
    <footer>Created by <strong>Kaung</strong> • © 2025 Sendo</footer>
  </div>
  <script>
    // Expose the session and receiver token so lite.js can attach and enhance
    window.__SESS_ID__ = ${JSON.stringify(s.id)};
    window.__RECV_TOKEN__ = ${JSON.stringify(s.receiverToken)};
  </script>
  <script src="/lite.js?v=ssr" type="text/javascript"></script>
</body>
</html>`);
  } catch (e) {
    console.error("receiver SSR error:", e);
    res.status(500).send("Receiver is temporarily unavailable.");
  }
});
app.get("/sender", (_req, res) =>
  res.sendFile(path.join(publicDir, "sender.html"))
);
app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
/* ----------------------- Start ----------------------- */
app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}`);
});
