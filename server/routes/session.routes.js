// server/routes/session.routes.js
import { Router } from "express";
import {
  createReceiverSession,
  connectSender,
  joinViaQR,
  getStatus,
  heartbeat,
  disconnect,
} from "../controllers/session.controller.js";
import { asyncHandler } from "../middlewares/async.js";

const r = Router();

// creation
r.post("/session", asyncHandler(createReceiverSession));
r.get("/session/new", asyncHandler(createReceiverSession));

// connect
r.post("/connect", asyncHandler(connectSender));
r.get("/join", asyncHandler(joinViaQR));

// status & lifecycle
r.get("/session/:id/status", asyncHandler(getStatus));
r.post("/heartbeat", asyncHandler(heartbeat));
r.post("/disconnect", asyncHandler(disconnect));

export default r;
