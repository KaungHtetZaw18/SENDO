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

// Compatibility route for e-readers that struggle with JSON POST
app.get("/api/session/new", async (req, res) => {
  try {
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

    const qrDataUrl = await QRCode.toDataURL(senderLink, {
      scale: 6,
      margin: 1,
    });

    return res.json({
      ok: true,
      sessionId: s.id,
      code: s.code,
      receiverToken: s.receiverToken,
      senderLink,
      qrDataUrl,
      expiresAt: s.expiresAt,
    });
  } catch (e) {
    console.error("GET /api/session/new error", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
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
    res.send(png);
  } catch {
    res.status(500).end();
  }
});

/* ----------------------- Background sweeps ----------------------- */
// Hard expiry for sessions/files (already deletes stale ones)
setInterval(() => sweepExpired(), 60 * 1000);

// (Optional) You could add a liveness sweeper here to close the session if
// receiver or sender stop heartbeating for X seconds. Not required because
// receiver already sends a 'disconnect' beacon on leave, and TTL handles the rest.

/* ----------------------- Serve frontend (plain files) ----------------------- */
// Serve static frontend (no React build — plain files)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

// No-cache static for e-readers (html/js/css/png)
app.use(
  express.static(publicDir, {
    setHeaders: (res, filePath) => {
      // Turn off caching so Kobo/Kindle always fetch latest
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);

// Receiver (lite)
app.get("/receiver", (_req, res) => {
  res.sendFile(path.join(publicDir, "lite.html"));
});

// Sender
app.get("/sender", (_req, res) => {
  res.sendFile(path.join(publicDir, "sender.html"));
});

// Landing
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

/* ----------------------- Start ----------------------- */
app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}`);
});
