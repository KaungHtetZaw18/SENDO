// server/routes/index.js
import { Router } from "express";
import health from "./health.routes.js";
import session from "./session.routes.js";
import file from "./file.routes.js";
import page from "./page.routes.js"; // <-- static import
import { SERVE_WEB } from "../config/env.js";

const router = Router();

console.log("✅ Registering API routes...");

// API lives under /api because app.js mounts this router at /api
router.use(health); // exposes  GET /api/health
router.use(session); // exposes  /api/session, /api/connect, ...
router.use(file); // exposes  /api/upload, /api/download/:id, /api/qr/:id.png

// Only serve HTML routes if you want backend to serve the static pages
if (SERVE_WEB) {
  router.use(page); // exposes / (landing), /sender, /receiver
}

export default router;
