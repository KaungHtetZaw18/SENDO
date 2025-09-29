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
r.post("/api/session", asyncHandler(createReceiverSession));
r.get("/api/session/new", asyncHandler(createReceiverSession));

// connect
r.post("/api/connect", asyncHandler(connectSender));
r.get("/join", asyncHandler(joinViaQR));

// status & lifecycle
r.get("/api/session/:id/status", asyncHandler(getStatus));
r.post("/api/heartbeat", asyncHandler(heartbeat));
r.post("/api/disconnect", asyncHandler(disconnect));

export default r;
