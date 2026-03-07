import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { mongooseConnection } from "./config/mongooseConfig.js";
import vapiRoutes from "./routes/vapiRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { attachCustomTranscriberWS } from "./customTranscriberServer.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins = [
  "https://talkypie-v4.onrender.com",
  "https://talkypie-v4.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://talkypie-v5.onrender.com",
];

const allowedOrigins = [...new Set([...defaultOrigins, ...configuredOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the TalkyPIES Backend!" });
});

app.use("/auth", authRoutes);
app.use("/vapi", vapiRoutes);

app.use((err, req, res, next) => {
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: err.message });
  }
  console.error("Error occurred:", err);
  return res.status(500).json({ error: "Internal Server Error" });
});

const server = http.createServer(app);
attachCustomTranscriberWS(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", async () => {
  try {
    await mongooseConnection();
    console.log(`Server listening on port ${PORT} (HTTP + WebSocket)`);
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  }
});
