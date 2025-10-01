// server/controllers/health.controller.js
import { setNoCache } from "../app.js";
export function health(_req, res) {
  setNoCache(res);
  res.json({ ok: true, name: "Sendo", time: Date.now() });
}
