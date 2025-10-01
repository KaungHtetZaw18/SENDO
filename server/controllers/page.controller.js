// server/controllers/page.controller.js
import path from "path";
import { fileURLToPath } from "url";
import { setNoCache } from "../app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../../web/public");

export function landing(_req, res) {
  res.sendFile(path.join(publicDir, "index.html"));
}

export function sender(_req, res) {
  res.sendFile(path.join(publicDir, "sender.html"));
}

export function receiver(_req, res) {
  res.sendFile(path.join(publicDir, "receiver.html"));
}
export async function qrPng(req, res) {
  const id = req.params.id;

  // generate or load PNG buffer for this sessionId
  const pngBuffer = await buildQrForSession(id);

  // ✅ allow embedding across origins
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.type("png").send(pngBuffer);
}
