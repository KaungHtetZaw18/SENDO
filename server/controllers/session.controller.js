import {
  createSession,
  getSessionById,
  getSessionByCode,
  touchSession,
  closeSession,
} from "../store/sessionStore.js";

import { SESSION_TTL_SECONDS, FRONTEND_BASE } from "../config/env.js";
import { setNoCache } from "../app.js";

// --- Receiver starts a session ---
export async function createReceiverSession(req, res) {
  const role = req.body?.role || (req.method === "GET" ? "receiver" : null);
  if (role !== "receiver") {
    return res
      .status(400)
      .json({ ok: false, error: "role must be 'receiver'" });
  }

  const s = createSession({ ttlSeconds: SESSION_TTL_SECONDS });
  s.lastSeenReceiver = Date.now();
  s.lastSeenSender = 0;
  touchSession(s, SESSION_TTL_SECONDS);

  const joinUrl = `${FRONTEND_BASE}/join?sessionId=${encodeURIComponent(
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
}

// --- Sender connects ---
export async function connectSender(req, res) {
  const { code, sessionId } = req.body || {};
  let s = code ? getSessionByCode(String(code).toUpperCase().trim()) : null;
  if (!s && sessionId) s = getSessionById(String(sessionId));
  if (!s)
    return res.status(404).json({ ok: false, error: "Session not found" });

  if (
    s.status === "closed" ||
    (Number.isFinite(s.expiresAt) && s.expiresAt <= Date.now())
  ) {
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
}

// --- Join via QR ---
export function joinViaQR(req, res) {
  const sid = String(req.query.sessionId || "");
  const tok = String(req.query.t || "");
  const s = getSessionById(sid);
  if (!s || s.closed) return res.status(404).send("Session not found");

  res.redirect(
    `${FRONTEND_BASE}/sender?sessionId=${encodeURIComponent(
      s.id
    )}&t=${encodeURIComponent(tok)}`
  );
}

// --- Get session status ---
export async function getStatus(req, res) {
  const s = getSessionById(String(req.params.id));
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });

  const now = Date.now();
  const closed =
    s.status === "closed" ||
    (Number.isFinite(s.expiresAt) && s.expiresAt <= now);

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
    expiresAt: Number.isFinite(s.expiresAt) ? s.expiresAt : null,
    secondsLeft: Number.isFinite(s.expiresAt)
      ? Math.max(0, Math.floor((s.expiresAt - now) / 1000))
      : null,
    senderConnected: s.senderConnected,
  });
}

// --- Heartbeat ---
export async function heartbeat(req, res) {
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
}

// --- Disconnect ---
export async function disconnect(req, res) {
  const { sessionId, by = "sender" } = req.body || {};
  const s = getSessionById(String(sessionId));
  if (!s) return res.status(404).json({ ok: false, error: "not_found" });

  s.file = undefined;
  closeSession(s, by);

  setNoCache(res);
  res.json({ ok: true });
}
