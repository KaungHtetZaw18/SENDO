// server/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import apiRoutes from "./routes/index.js"; // your API routes
import pageRoutes from "./routes/page.routes.js"; // frontend pages

import { notFound, errorHandler } from "./middlewares/error.js";
import { sweepExpired } from "./store/sessionStore.js";
import { PORT, SERVE_WEB } from "./config/env.js";

// --- small helpers ---
export function setNoCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function requestOrigin(req) {
  const proto =
    req.headers["x-forwarded-proto"]?.split(",")[0] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : "";
}

// --- app + middleware ---
const app = express();
app.use(
  helmet({
    // allow images/assets to be embedded by a different origin (5173 -> 3001)
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // disable COEP during dev with split origins
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

// --- static (only if SERVE_WEB=true) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public");

if (SERVE_WEB) {
  app.use(express.static(publicDir, { setHeaders: setNoCache }));
  app.use(pageRoutes); // serve landing, sender, receiver
}

app.use("/qr", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});
// --- API routes (always) ---
app.use(apiRoutes);

// --- 404 + centralized error JSON ---
app.use(notFound);
app.use(errorHandler);

// --- background sweeps (TTL + liveness) ---
setInterval(() => {
  try {
    sweepExpired();
  } catch {}
}, 5000);

export default app;
