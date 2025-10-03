// server/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import apiRoutes from "./routes/index.js";
import pageRoutes from "./routes/page.routes.js";

import { notFound, errorHandler } from "./middlewares/error.js";
import { sweepExpired } from "./store/sessionStore.js";
import { SERVE_WEB } from "./config/env.js";

// --- helpers ---
export function setNoCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function requestOrigin(req) {
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : "";
}

// --- app setup ---
const app = express();
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

// --- HEALTH (for Render wake) ---
// Keep this very fast (no DB work). CORS enabled so your separate frontend can call it.
app.get("/health", cors({ origin: "*" }), (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

// static only if SERVE_WEB=true
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

if (SERVE_WEB) {
  app.use(express.static(publicDir, { setHeaders: setNoCache }));
  app.use(pageRoutes);
}

// QR assets
app.use("/qr", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});
app.use(
  "/api",
  (req, _res, next) => {
    console.log("API hit:", req.method, req.path);
    next();
  },
  cors({ origin: "*" }),
  apiRoutes
);

// --- 404 & error handling ---
app.use(notFound);
app.use(errorHandler);

// --- background sweeps ---
setInterval(() => {
  try {
    sweepExpired();
  } catch {}
}, 5000);

export default app;
