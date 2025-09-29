import { Router } from "express";
import health from "./health.routes.js";
import session from "./session.routes.js";
import file from "./file.routes.js";
import page from "./page.routes.js";

const router = Router();
router.use(health);
router.use(session);
router.use(file);
router.use(page);
export default router;
