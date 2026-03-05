import express from "express";
import {
  getCurrentUser,
  login,
  signup,
} from "../controllers/authController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import {
  validateLoginRequest,
  validateSignupRequest,
} from "../middlewares/validationMiddleware.js";

const authRoutes = express.Router();

authRoutes.post("/signup", validateSignupRequest, signup);
authRoutes.post("/login", validateLoginRequest, login);
authRoutes.get("/me", requireAuth, getCurrentUser);

export default authRoutes;
