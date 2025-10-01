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
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

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

// --- API routes (always under /api) ---
app.use("/api", apiRoutes);

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
