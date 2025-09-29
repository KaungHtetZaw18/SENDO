import { Router } from "express";
import {
  landing,
  sender,
  receiverSSR,
} from "../controllers/page.controller.js";

const r = Router();
r.get("/", landing);
r.get("/sender", sender);
r.get("/receiver", receiverSSR);
export default r;
