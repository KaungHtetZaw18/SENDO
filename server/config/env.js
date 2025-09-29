import dotenv from "dotenv";
dotenv.config();
const origin = FRONTEND_BASE || requestOrigin(req);
export const PORT = Number(process.env.PORT || 3001);

export const SERVE_WEB = process.env.SERVE_WEB === "true";

export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 0);

export const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 100);

export const SENDER_GONE_MS = Number(process.env.SENDER_GONE_MS || 30000);
export const RECEIVER_GONE_MS = Number(process.env.RECEIVER_GONE_MS || 30000);

export const FILE_INACTIVITY_MS =
  Number(process.env.FILE_INACTIVITY_MINUTES || 30) * 60 * 1000;

export const FRONTEND_BASE =
  process.env.FRONTEND_BASE || "http://localhost:" + PORT;
