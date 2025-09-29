// server/app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import routes from "./routes/index.js";
import { notFound, errorHandler } from "./middlewares/error.js";
import {
  allSessions,
  sweepExpired,
  clearSessionFile,
  closeSession,
} from "./store/sessionStore.js";
import { PORT, SENDER_GONE_MS, RECEIVER_GONE_MS } from "./config/env.js";

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
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));

// --- static (no cache) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/public"); // app.js is in server/, so ../web/public
app.use(express.static(publicDir, { setHeaders: setNoCache }));

// --- routes ---
app.use(routes);

// --- 404 + centralized error JSON ---
app.use(notFound);
app.use(errorHandler);

// --- background sweeps (TTL + liveness) ---
setInterval(() => {
  try {
    // keep this: will be a no-op when SESSION_TTL_SECONDS=0
    sweepExpired();
  } catch {}
}, 5000);

export default app;
