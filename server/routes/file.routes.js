// server/routes/file.routes.js
import { Router } from "express";
import multer from "multer";
import {
  uploadFile,
  downloadFile,
  qrPng,
} from "../controllers/file.controller.js";
import { sessionDir } from "../store/fileStore.js";
import { MAX_FILE_MB } from "../config/env.js";
import { asyncHandler } from "../middlewares/async.js";

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sid = req.query.sessionId || req.body.sessionId;
    if (!sid) return cb(new Error("Missing sessionId"), "");
    cb(null, sessionDir(String(sid)));
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

const r = Router();
r.post("/api/upload", upload.single("file"), asyncHandler(uploadFile));
r.get("/api/download/:sessionId", asyncHandler(downloadFile));
r.get("/api/qr/:id.png", asyncHandler(qrPng));
export default r;
