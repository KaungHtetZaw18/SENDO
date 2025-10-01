import { Router } from "express";
import health from "./health.routes.js";
import session from "./session.routes.js";
import file from "./file.routes.js";
import { SERVE_WEB } from "../config/env.js";

const router = Router();

// always register API routes
router.use(health);
router.use(session);
router.use(file);

// only attach page routes if backend serves HTML
if (SERVE_WEB) {
  const page = (await import("./page.routes.js")).default;
  router.use(page);
}

export default router;
