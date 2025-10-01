// server/routes/page.routes.js
import { Router } from "express";
import { landing, sender, receiver } from "../controllers/page.controller.js";

const r = Router();
r.get("/", landing);
r.get("/sender", sender);
r.get("/receiver", receiver);
export default r;
