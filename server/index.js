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

// If you deploy as a single app (same-origin), we don’t need strict CORS.
// If you host sender/receiver elsewhere, set FRONTEND_BASE and tighten CORS later.
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Sendo", time: Date.now() });
});

/* ----------------------- E-reader detection ----------------------- */
function isEreaderUA(req) {
  const ua = String(req.headers["user-agent"] || "");
  // Common e-reader signatures (Kindle/Kobo/Boox/PocketBook/Tolino/Nook)
  return /(Kobo|Kindle|Silk|NetFront|InkView|E-ink|Eink|Boox|PocketBook|Tolino|Nook|InkPalm)/i.test(
    ua
  );
}
function wantsLite(req) {
  const q = req.query || {};
  if (q.mode === "lite") return true;
  if (q.mode === "full") return false;
  return isEreaderUA(req);
}

/* ----------------------- Ebook validation ----------------------- */
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
// --- Serve static frontend (no React build) ---
if (SERVE_WEB) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // we now ship plain HTML/CSS/JS in web/public
  const staticRoot = path.resolve(__dirname, "../web/public");
  const indexPath = path.join(staticRoot, "index.html"); // receiver page
  const senderPath = path.join(staticRoot, "sender.html");
  const litePath = path.join(staticRoot, "lite.html");

  app.use(express.static(staticRoot, { fallthrough: true }));

  // Kobo/Kindle (or ?mode=lite) -> lite receiver, otherwise regular receiver
  app.get("/receiver", (req, res) => {
    return wantsLite(req) ? res.sendFile(litePath) : res.sendFile(indexPath);
  });

  // Sender page
  app.get("/sender", (_req, res) => res.sendFile(senderPath));

  // Direct access to lite
  app.get(["/lite", "/lite.html"], (_req, res) => res.sendFile(litePath));

  // Landing — show receiver
  app.get("/", (_req, res) => res.sendFile(indexPath));

  // Everything else that isn’t /api/* -> receiver
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(indexPath));
}

/* ----------------------- Create session ----------------------- */
// POST /api/session  { role: 'receiver' }
app.post("/api/session", async (req, res) => {
  const { role } = req.body || {};
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }

  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  touchSession(s, SESSION_TTL_SECONDS);

  // Build origin robustly (works behind Render/NGINX)
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

  // Data URL is still nice to send to non-e-readers; on Kobo we’ll use PNG route
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
// POST /api/connect  { code } OR { sessionId }
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

  res.json({
    ok: true,
    sessionId: s.id,
    senderToken: s.senderToken,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- Status (polling) ----------------------- */
// GET /api/session/:id/status
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
    const dir = sessionDir(String(sid));
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

// POST /api/upload?sessionId=...&senderToken=...
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

  // Replace previous file (single-file rule)
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
// GET /api/download/:sessionId?receiverToken=...
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

    // Kobo/Kindle-friendly headers
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

    // Delete only after successful transfer (plus small grace)
    res.once("finish", async () => {
      try {
        setTimeout(async () => {
          if (fs.existsSync(s.file.path)) await safeUnlink(s.file.path);
          clearSessionFile(s);
          touchSession(s, SESSION_TTL_SECONDS);
        }, 1500);
      } catch {}
    });

    // If client aborts, keep file so they can retry
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

  touchSession(s, SESSION_TTL_SECONDS);
  if (role === "sender") s.senderConnected = true;
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
  closeSession(s, by);
  res.json({ ok: true });
});

/* ----------------------- QR as PNG (reliable on e-readers) ----------------------- */
app.get("/api/qr/:id.png", async (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).end();

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

/* ----------------------- Sweeper ----------------------- */
setInterval(() => sweepExpired(), 60 * 1000);

/* ----------------------- Serve static frontend (no React) ----------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

app.use(express.static(publicDir));

// E-readers get the lite receiver page
app.get("/receiver", (req, res) => {
  // If you want to force lite always, just send lite.html unconditionally.
  // Here we keep smart detection + manual override (?mode=lite|full).
  if (wantsLite(req)) return res.sendFile(path.join(publicDir, "lite.html"));
  return res.sendFile(path.join(publicDir, "lite.html")); // receiver is lite by design
});

// Sender form page
app.get("/sender", (_req, res) => {
  res.sendFile(path.join(publicDir, "sender.html"));
});

// Landing page
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

/* ----------------------- Start ----------------------- */
app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}`);
});
