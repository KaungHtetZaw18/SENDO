// server/routes/index.js
import { Router } from "express";
import health from "./health.routes.js";
import session from "./session.routes.js";
import file from "./file.routes.js";
import page from "./page.routes.js";
import { SERVE_WEB } from "../config/env.js";

const router = Router();

// API routes (always)
router.use(health);
router.use(session);
router.use(file);

// Page routes (ONLY when you want the backend to serve HTML)
if (SERVE_WEB) {
  router.use(page);
}

export default router;
