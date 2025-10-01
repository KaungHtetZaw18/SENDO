// server/store/fileStore.js
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_TMP = path.join(__dirname, "tmp");

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function sessionDir(sessionId) {
  return ensureDir(path.join(ROOT_TMP, sessionId));
}

export async function safeUnlink(p) {
  try {
    await fsp.unlink(p);
  } catch {}
}
