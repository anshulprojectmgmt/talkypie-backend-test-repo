import express from "express";
import {
  createAssistant,
  storeCallReport,
  getSessions,
  createLiveKitToken,
} from "../controllers/callReportController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import {
  validateCreateAssistantRequest,
} from "../middlewares/validationMiddleware.js";

const vapiRoutes = express.Router();

vapiRoutes.post(
  "/create-assistant",
  requireAuth,
  validateCreateAssistantRequest,
  createAssistant,
);

vapiRoutes.post("/end-call-report", storeCallReport);

vapiRoutes.get("/sessions", requireAuth, getSessions);

vapiRoutes.get("/livekit-token", requireAuth, createLiveKitToken);

export default vapiRoutes;
