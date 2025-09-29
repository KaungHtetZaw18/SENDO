// server/sessionStore.js
import crypto from "crypto";
import { customAlphabet } from "nanoid";

// Public 4-char code (no 0,1,O,I to avoid confusion)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = customAlphabet(CODE_ALPHABET, 4);

const sessionsById = new Map();
const sessionsByCode = new Map();

// Keep closed sessions around briefly so UIs can read closedBy
const TOMBSTONE_MS = 2 * 60 * 1000; // 2 minutes

export function createSession({ ttlSeconds = 300 } = {}) {
  const id = crypto.randomUUID();

  let code = genCode();
  while (sessionsByCode.has(code)) code = genCode();

  const now = Date.now();
  const s = {
    id,
    code,
    receiverToken: crypto.randomUUID(),
    senderToken: crypto.randomUUID(),

    status: "waiting", // 'waiting' | 'connected' | 'closed'
    closedBy: null, // 'sender' | 'receiver' | 'ttl' | 'sender_gone' | 'receiver_gone'
    closedAt: null,

    file: undefined, // { name, size, type, path, uploadedAt }

    createdAt: now,
    lastActivityAt: now,
    expiresAt: ttlSeconds > 0 ? now + ttlSeconds * 1000 : null,

    // liveness (used by sweeper)
    lastSeenReceiver: 0,
    lastSeenSender: 0,
    senderConnected: false,
  };

  sessionsById.set(id, s);
  sessionsByCode.set(code, s);
  return s;
}

export function getSessionById(id) {
  return sessionsById.get(id);
}

export function getSessionByCode(code) {
  return sessionsByCode.get(code);
}

// Roll-forward TTL on activity
export function touchSession(session, ttlSeconds) {
  const now = Date.now();
  session.lastActivityAt = now;
  if (ttlSeconds > 0) session.expiresAt = now + ttlSeconds * 1000;
}

// Mark closed (kept as tombstone for a bit)
export function closeSession(session, closedBy = "ttl") {
  session.status = "closed";
  session.closedBy = closedBy;
  session.closedAt = Date.now();
}

// Hard remove from maps
export function purgeSession(session) {
  sessionsById.delete(session.id);
  sessionsByCode.delete(session.code);
}

export function sweepExpired() {
  const now = Date.now();
  for (const s of sessionsById.values()) {
    if (
      s.status !== "closed" &&
      Number.isFinite(s.expiresAt) &&
      s.expiresAt <= now
    ) {
      closeSession(s, "ttl");
    }
    if (
      s.status === "closed" &&
      s.closedAt &&
      now - s.closedAt > TOMBSTONE_MS
    ) {
      purgeSession(s);
    }
  }
}

// ✅ Correct implementation (your previous file referenced a non-existent SESSIONS)
export function allSessions() {
  return Array.from(sessionsById.values());
}

export function setSessionFile(session, fileMeta) {
  session.file = fileMeta;
  session.lastActivityAt = Date.now();
}

export function clearSessionFile(session) {
  session.file = undefined;
  session.lastActivityAt = Date.now();
}
