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

// ---------- App & constants ----------
const app = express();
const PORT = process.env.PORT || 3001;
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 300);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 100);

// liveness thresholds (balanced to avoid chattiness/memory churn)
const SENDER_GONE_MS = 15000;
const RECEIVER_GONE_MS = 12000;

// ---------- Middleware ----------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

// Small helper to set no-cache headers consistently
function setNoCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

// Where am I?
function requestOrigin(req) {
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : "";
}

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  setNoCache(res);
  res.json({ ok: true, name: "Sendo", time: Date.now() });
});

// ---------- Ebook allowlist ----------
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

// ---------- Session creation (Receiver) ----------
app.post("/api/session", async (req, res) => {
  const { role } = req.body || {};
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }
  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  s.lastSeenReceiver = Date.now();
  s.lastSeenSender = 0;
  touchSession(s, SESSION_TTL_SECONDS);

  // QR will point to /join so scanning connects Sender immediately
  const origin = requestOrigin(req);
  const joinUrl = `${origin}/join?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  setNoCache(res);
  res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    joinUrl,
    expiresAt: s.expiresAt,
  });
});

// GET-first creation for very old browsers (same payload)
app.get("/api/session/new", async (req, res) => {
  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  s.lastSeenReceiver = Date.now();
  s.lastSeenSender = 0;
  touchSession(s, SESSION_TTL_SECONDS);

  const origin = requestOrigin(req);
  const joinUrl = `${origin}/join?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  setNoCache(res);
  res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    joinUrl,
    expiresAt: s.expiresAt,
  });
});

// ---------- Sender "connect" by code (keyboard entry) ----------
app.post("/api/connect", (req, res) => {
  const { code, sessionId } = req.body || {};
  let s = null;
  if (code) s = getSessionByCode(String(code).toUpperCase().trim());
  if (!s && sessionId) s = getSessionById(String(sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });
  if (s.expiresAt <= Date.now() || s.status === "closed") {
    return res.status(410).json({ ok: false, error: "Expired/closed" });
  }
  s.senderConnected = true;
  s.lastSeenSender = Date.now();
  s.status = "connected";
  touchSession(s, SESSION_TTL_SECONDS);

  setNoCache(res);
  res.json({
    ok: true,
    sessionId: s.id,
    senderToken: s.senderToken,
    expiresAt: s.expiresAt,
  });
});

// ---------- Sender "connect" by QR (scan) ----------
// This is the new path embedded in the QR. Opening it marks sender connected
// and forwards to the sender UI with session info in the URL for the client JS.
app.get("/join", (req, res) => {
  const sid = String(req.query.sessionId || "");
  const tok = String(req.query.t || "");
  const s = getSessionById(sid);

  if (!s) {
    setNoCache(res);
    return res.redirect("/?e=not_found");
  }
  if (s.senderToken !== tok) {
    setNoCache(res);
    return res.redirect("/?e=bad_token");
  }
  if (s.status === "closed" || s.expiresAt <= Date.now()) {
    setNoCache(res);
    return res.redirect("/?e=expired");
  }

  // mark connected
  s.senderConnected = true;
  s.lastSeenSender = Date.now();
  s.status = "connected";
  touchSession(s, SESSION_TTL_SECONDS);

  // forward into sender page (client JS will pick these up from query)
  setNoCache(res);
  res.redirect(
    `/sender?sessionId=${encodeURIComponent(s.id)}&t=${encodeURIComponent(
      s.senderToken
    )}`
  );
});

// ---------- Status (polled by both sides) ----------
app.get("/api/session/:id/status", (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });

  const now = Date.now();
  const closed = s.status === "closed" || s.expiresAt <= now;

  setNoCache(res);
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
    secondsLeft: Math.max(0, Math.floor((s.expiresAt - now) / 1000)),
    senderConnected: s.senderConnected,
  });
});

// ---------- Upload (Sender) ----------
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
    return res
      .status(415)
      .json({
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

  setNoCache(res);
  res.json({
    ok: true,
    file: { name: meta.name, size: meta.size, type: meta.type },
  });
});

// ---------- Download (Receiver) ----------
app.get("/api/download/:sessionId", async (req, res) => {
  const s = getSessionById(String(req.params.sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  const token = String(req.query.receiverToken || "");
  if (token !== s.receiverToken)
    return res.status(401).json({ ok: false, error: "Unauthorized" });

  if (!s.file?.path || !fs.existsSync(s.file.path)) {
    return res.status(404).json({ ok: false, error: "No file" });
  }

  try {
    const stat = fs.statSync(s.file.path);
    const ascii = s.file.name.replace(/[^\x20-\x7E]+/g, "_");

    // No cache + content headers
    setNoCache(res);
    res.setHeader("Content-Type", s.file.type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
        s.file.name
      )}`
    );
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("Connection", "close");

    const stream = fs.createReadStream(s.file.path);
    stream.pipe(res);

    // After successful transfer, free disk + keep session open for a bit
    res.once("finish", async () => {
      try {
        await safeUnlink(s.file.path);
      } catch {}
      clearSessionFile(s);
      touchSession(s, SESSION_TTL_SECONDS);
    });

    // keep file if user aborted (so they can retry)
    res.once("close", () => {});
  } catch (err) {
    console.error("download error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ---------- Heartbeat & Disconnect ----------
app.post("/api/heartbeat", (req, res) => {
  const { sessionId, role } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });
  if (s.status === "closed")
    return res.status(410).json({ ok: false, error: "closed" });

  const now = Date.now();
  if (role === "receiver") s.lastSeenReceiver = now;
  if (role === "sender") {
    s.lastSeenSender = now;
    s.senderConnected = true;
  }
  touchSession(s, SESSION_TTL_SECONDS);

  setNoCache(res);
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
  closeSession(s, by); // 'sender' | 'receiver'
  setNoCache(res);
  res.json({ ok: true });
});

// ---------- QR (PNG) that encodes /join ----------
app.get("/api/qr/:id.png", async (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).end();

  const origin = requestOrigin(req);
  const joinUrl = `${origin}/join?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  try {
    const png = await QRCode.toBuffer(joinUrl, {
      type: "png",
      scale: 6,
      margin: 1,
    });
    setNoCache(res);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.end(png);
  } catch {
    res.status(500).end();
  }
});

// ---------- Background sweeps (TTL + liveness) ----------
setInterval(() => {
  try {
    sweepExpired(); // closes expired sessions (kept briefly as tombstones)

    const now = Date.now();
    for (const s of allSessions()) {
      if (!s || s.status === "closed") continue;

      // sender gone?
      if (s.lastSeenSender && now - s.lastSeenSender > SENDER_GONE_MS) {
        try {
          if (s.file?.path && fs.existsSync(s.file.path))
            fs.unlinkSync(s.file.path);
        } catch {}
        clearSessionFile(s);
        closeSession(s, "sender_gone");
        continue;
      }
      // receiver gone?
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
  } catch (e) {
    // swallow; keep memory stable
  }
}, 5000);

// ---------- Static (no cache) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

app.use(
  express.static(publicDir, {
    setHeaders: (res) => setNoCache(res),
  })
);

// ---------- SSR Receiver (e-ink safe) ----------
app.get("/receiver", async (req, res) => {
  try {
    const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
    s.lastSeenReceiver = Date.now();
    s.lastSeenSender = 0;
    touchSession(s, SESSION_TTL_SECONDS);

    const origin = requestOrigin(req);
    const qrPath = `/api/qr/${encodeURIComponent(s.id)}.png?v=${Date.now()}`;

    setNoCache(res);
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
html,body{ margin:0; padding:0; background:#fff; color:#000;
  font-family:-apple-system, system-ui, Segoe UI, Roboto, Arial, sans-serif; }
.wrap{ max-width:480px; margin:0 auto 24px; padding:0 10px; }
h1{ text-align:center; font-size:22px; margin:14px 0 2px; }
.sub{ text-align:center; color:#444; font-size:12px; margin-bottom:10px; }
.card{ background:#fff; border:1px solid #888; border-radius:10px; padding:12px; text-align:center; }
.key{ letter-spacing:8px; font-family:ui-monospace, Menlo, Consolas, monospace; font-size:22px; border:1px solid #888; border-radius:8px; padding:8px 10px; margin-bottom:10px;}
#qr{ display:block; width:180px; height:180px; margin:10px auto 0; border:1px solid #888; border-radius:6px;}
.btn{ display:block; width:100%; padding:12px 14px; border:1px solid #888; border-radius:10px; background:#eee; color:#000; font-weight:700; text-decoration:none; margin-top:12px;}
#status,#debug{ text-align:center; font-size:12px; margin-top:8px; min-height:1em; }
#debug{ color:#b00; }
footer{ text-align:center; font-size:12px; color:#000; margin-top:14px; }
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
    // Let lite.js enhance without having to create a session again
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

// ---------- Sender (static) ----------
app.get("/sender", (_req, res) =>
  res.sendFile(path.join(publicDir, "sender.html"))
);

// ---------- Landing ----------
app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}`);
});
