// server/routes/health.routes.js
import { Router } from "express";
import { health } from "../controllers/health.controller.js";

const r = Router();
r.get("/api/health", health);
export default r;
