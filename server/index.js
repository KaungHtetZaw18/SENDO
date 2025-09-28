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

/* ----------------------- Security & middleware ----------------------- */
// Helmet CSP: allow self scripts and data: images (for QR if needed)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "default-src": ["'self'"],
      },
    },
  })
);
// In same-origin deploy this is effectively a no-op from browser POV
app.use(cors({ origin: FRONTEND_BASE || true }));
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

function isEreaderUA(req) {
  const ua = String(req.headers["user-agent"] || "");
  // Kobo, Kindle (incl. Silk), Tolino, PocketBook, Nook, Onyx/Ink
  return /(Kobo|Kindle|Silk|Tolino|PocketBook|Nook|E-ink|Eink|InkPalm)/i.test(
    ua
  );
}

function wantsLite(req) {
  const q = req.query || {};
  if (q.mode === "lite") return true;
  if (q.mode === "full") return false;
  return isEreaderUA(req);
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
app.post("/api/session", async (req, res) => {
  const { role } = req.body || {};
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }

  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  touchSession(s, SESSION_TTL_SECONDS);

  // Build base from request (proxy-safe) or fallback to FRONTEND_BASE
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

  // Keep data URL for modern devices; Kobo fallback will use PNG route below
  const qrDataUrl = await QRCode.toDataURL(senderLink, { scale: 6, margin: 1 });

  return res.json({
    ok: true,
    sessionId: s.id,
    code: s.code,
    receiverToken: s.receiverToken,
    senderLink,
    qrDataUrl,
    expiresAt: s.expiresAt,
  });
});

/* ----------------------- PNG QR endpoint (Kobo-friendly) ----------------------- */
app.get("/api/qr/:id.png", async (req, res) => {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).send("not found");

  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = host ? `${proto}://${host}` : FRONTEND_BASE;

  const senderLink = `${base}/sender?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;

  res.type("png");
  await QRCode.toFileStream(res, senderLink, { width: 256, margin: 1 });
});

/* ----------------------- Connect (Sender) ----------------------- */
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

/* ----------------------- Multer (upload) ----------------------- */
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

  if (!isAllowedEbook(req.file.originalname)) {
    if (req.file?.path) await safeUnlink(req.file.path);
    return res.status(415).json({
      ok: false,
      error:
        "Only e-book files are allowed (.epub, .mobi, .azw, .azw3, .pdf, .txt)",
    });
  }

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

/* ----------------------- Download (auto-delete) ----------------------- */
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

  res.on("close", async () => {
    await safeUnlink(s.file.path);
    clearSessionFile(s);
    touchSession(s, SESSION_TTL_SECONDS);
  });
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
  return res.json({ ok: true, expiresAt: s.expiresAt });
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
  return res.json({ ok: true });
});

/* ----------------------- Sweeper ----------------------- */
setInterval(() => {
  sweepExpired();
}, 60 * 1000);

/* ----------------------- Serve frontend build w/ Lite routing ----------------------- */
if (SERVE_WEB) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distDir = path.resolve(__dirname, "../web/dist");
  const indexPath = path.join(distDir, "index.html");
  const litePath = path.join(distDir, "lite.html");

  app.use(express.static(distDir));

  app.get(["/lite", "/lite.html"], (_req, res) => res.sendFile(litePath));

  app.get("/receiver", (req, res) => {
    if (wantsLite(req)) return res.sendFile(litePath);
    return res.sendFile(indexPath);
  });

  app.get(["/", "/sender"], (_req, res) => res.sendFile(indexPath));

  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(indexPath);
  });
}
// --- DEBUG: list the deployed dist/ contents so we know what Render is serving
app.get("/debug/dist", async (_req, res) => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const distDir = path.resolve(__dirname, "../web/dist");

    const fs = await import("fs/promises");
    const entries = await fs.readdir(distDir, { withFileTypes: true });
    const list = await Promise.all(
      entries.map(async (e) => {
        if (e.isDirectory()) {
          const sub = await fs.readdir(path.join(distDir, e.name));
          return e.name + "/ -> " + sub.join(", ");
        }
        return e.name;
      })
    );
    res
      .type("text")
      .send(["DIST DIR:", distDir, "", "FILES:", ...list].join("\n"));
  } catch (err) {
    res
      .status(500)
      .type("text")
      .send("ERR reading dist: " + String(err));
  }
});
// Smart receiver entry: e-readers (or ?mode=lite) -> 302 to /lite.html
app.get("/receiver", (req, res) => {
  if (wantsLite(req)) return res.redirect(302, "/lite.html");
  return res.sendFile(indexPath); // normal React receiver otherwise
});
// --- DEBUG: show UA + wantsLite result
app.get("/debug/ua", (req, res) => {
  res.json({
    ua: req.headers["user-agent"] || "",
    isEreader:
      /(Kobo|Kindle|Silk|Tolino|PocketBook|Nook|E-ink|Eink|InkPalm)/i.test(
        String(req.headers["user-agent"] || "")
      ),
    wantsLite:
      req.query.mode === "lite"
        ? true
        : req.query.mode === "full"
        ? false
        : /(Kobo|Kindle|Silk|Tolino|PocketBook|Nook|E-ink|Eink|InkPalm)/i.test(
            String(req.headers["user-agent"] || "")
          ),
  });
});
app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}  (SERVE_WEB=${SERVE_WEB})`);
});
