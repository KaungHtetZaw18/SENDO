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
const FRONTEND_BASE = process.env.FRONTEND_BASE || "http://localhost:5173";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 300);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 100);
const SERVE_WEB = process.env.SERVE_WEB === "true";

// allow only your web origin in dev/separate-origin; on same-origin this is a no-op from the browser’s POV
app.use(helmet());
app.use(cors({ origin: FRONTEND_BASE }));
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Sendo", time: Date.now() });
});

/* ----------------------- Helpers ----------------------- */

async function closeAndCleanup(session) {
  try {
    if (session.file?.path && fs.existsSync(session.file.path)) {
      await safeUnlink(session.file.path);
    }
  } catch {}
  closeSession(session);
}

// Allowed e-book extensions
const ALLOWED_EXTS = new Set([
  ".epub",
  ".mobi",
  ".azw",
  ".azw3",
  ".pdf",
  ".txt",
]);
function isAllowedEbook(filename /*, mimetype */) {
  const ext = (path.extname(filename) || "").toLowerCase();
  return ALLOWED_EXTS.has(ext);
}

/* ----------------------- Create Session ----------------------- */
/**
 * POST /api/session
 * Body: { role: 'receiver' }
 * Resp: { ok, sessionId, code, receiverToken, senderLink, qrDataUrl, expiresAt }
 */
app.post("/api/session", async (req, res) => {
  const { role } = req.body || {};
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }

  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  touchSession(s, SESSION_TTL_SECONDS);

  // 🔧 Build a robust base URL:
  // - When served behind a proxy (Render/NGINX), prefer X-Forwarded-Proto + Host
  // - Else fall back to req.protocol + host
  // - Else fall back to FRONTEND_BASE (dev/separate deployment)
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const originFromReq = host ? `${proto}://${host}` : null;

  const base = originFromReq || FRONTEND_BASE;

  const senderLink = `${base}/sender?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  // QR encodes the senderLink
  const qrDataUrl = await QRCode.toDataURL(senderLink, { scale: 6, margin: 1 });

  return res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    senderLink, // ✅ now points to the same origin in single-app deploy
    qrDataUrl,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- Connect (Sender) ----------------------- */
/**
 * POST /api/connect
 * Body: { code } OR { sessionId }
 * Resp: { ok, sessionId, senderToken, expiresAt }
 */
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
  s.status = "connected";
  touchSession(s, SESSION_TTL_SECONDS);

  return res.json({
    ok: true,
    sessionId: s.id,
    senderToken: s.senderToken,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- Status (poll) ----------------------- */
// GET /api/session/:id/status  -> { ok, closed, closedBy, status, hasFile, file, expiresAt, secondsLeft, senderConnected }
app.get("/api/session/:id/status", (req, res) => {
  const s = getSessionById(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });

  const now = Date.now();
  const closed = s.status === "closed" || s.expiresAt <= now;
  const secondsLeft = Math.max(0, Math.floor((s.expiresAt - now) / 1000));

  return res.json({
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

/* ----------------------- Multer (upload storage) ----------------------- */
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sid = req.query.sessionId || req.body.sessionId;
    if (!sid) return cb(new Error("Missing sessionId"), "");
    const dir = sessionDir(String(sid));
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

/* ----------------------- Upload (Sender) ----------------------- */
/**
 * POST /api/upload?sessionId=...&senderToken=...
 * FormData: { file }
 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const { sessionId, senderToken } = req.query || {};
  const s = getSessionById(String(sessionId));
  if (!s) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(404).json({ ok: false, error: "Session not found" });
  }
  if (s.senderToken !== senderToken) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "No file" });
  }

  // e-book extension validation
  if (!isAllowedEbook(req.file.originalname)) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(415).json({
      ok: false,
      error:
        "Only e-book files are allowed (.epub, .mobi, .azw, .azw3, .pdf, .txt)",
    });
  }

  // Replace previous file
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

  return res.json({
    ok: true,
    file: { name: meta.name, size: meta.size, type: meta.type },
  });
});

/* ----------------------- Download (Receiver; auto-delete) ----------------------- */
/**
 * GET /api/download/:sessionId?receiverToken=...
 * Streams file; on stream 'close' -> delete file.
 */
app.get("/api/download/:sessionId", async (req, res) => {
  const s = getSessionById(String(req.params.sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });
  if (s.receiverToken !== req.query.receiverToken) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  if (!s.file?.path || !fs.existsSync(s.file.path)) {
    return res.status(404).json({ ok: false, error: "No file" });
  }

  touchSession(s, SESSION_TTL_SECONDS);
  res.setHeader("Content-Type", s.file.type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(s.file.name)}`
  );

  const stream = fs.createReadStream(s.file.path);
  stream.pipe(res);

  // When the response finishes, delete the file and clear state
  res.on("close", async () => {
    await safeUnlink(s.file.path);
    clearSessionFile(s);
    touchSession(s, SESSION_TTL_SECONDS);
  });
});

/* ----------------------- Heartbeat (extends TTL) ----------------------- */
// POST /api/heartbeat  { sessionId, role: 'receiver'|'sender' }
app.post("/api/heartbeat", (req, res) => {
  const { sessionId, role } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });

  if (s.status === "closed")
    return res.status(410).json({ ok: false, error: "closed" });

  touchSession(s, SESSION_TTL_SECONDS);
  if (role === "sender") s.senderConnected = true;
  return res.json({ ok: true, expiresAt: s.expiresAt });
});

/* ----------------------- Disconnect (both sides) ----------------------- */
// POST /api/disconnect  { sessionId, by: 'sender' | 'receiver' }
app.post("/api/disconnect", async (req, res) => {
  const { sessionId, by = "sender" } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });

  // delete any file
  try {
    if (s.file?.path && fs.existsSync(s.file.path))
      await safeUnlink(s.file.path);
  } catch {}
  clearSessionFile(s);

  closeSession(s, by); // mark closed & who
  return res.json({ ok: true });
});

/* ----------------------- Sweeper (hard expiry & purge) ----------------------- */
setInterval(() => {
  sweepExpired();
}, 60 * 1000);

/* ----------------------- Serve frontend build (Option B) ----------------------- */
if (SERVE_WEB) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const distDir = path.resolve(__dirname, "../web/dist");
  app.use(express.static(distDir));

  // SPA fallback for any non-API route, e.g. /, /sender, /receiver
  // Express v5/path-to-regexp v6: use a regex instead of "*"
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}  (SERVE_WEB=${SERVE_WEB})`);
});
