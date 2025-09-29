import fs from "fs";
import QRCode from "qrcode";
import path from "path";
import {
  getSessionById,
  setSessionFile,
  clearSessionFile,
  touchSession,
} from "../store/sessionStore.js";
import { safeUnlink } from "../store/fileStore.js";
import { SESSION_TTL_SECONDS } from "../config/env.js";
import { setNoCache, requestOrigin } from "../app.js";
import { FRONTEND_BASE } from "../config/env.js";

const ALLOWED_EXTS = new Set([
  ".epub",
  ".mobi",
  ".azw",
  ".azw3",
  ".pdf",
  ".txt",
]);
const isAllowedEbook = (name) =>
  ALLOWED_EXTS.has((path.extname(name) || "").toLowerCase());

export async function uploadFile(req, res) {
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
}

export async function downloadFile(req, res) {
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

    fs.createReadStream(s.file.path).pipe(res);

    res.once("finish", async () => {
      try {
        await safeUnlink(s.file.path);
      } catch {}
      clearSessionFile(s);
      touchSession(s, SESSION_TTL_SECONDS);
    });

    res.once("close", () => {});
  } catch (err) {
    console.error("download error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
}

export async function qrPng(req, res) {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).end();

  const origin = FRONTEND_BASE || requestOrigin(req);
  const joinUrl = `${origin}/join?sessionId=${encodeURIComponent(
    s.id
  )}&t=${encodeURIComponent(s.senderToken)}`;
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
}
