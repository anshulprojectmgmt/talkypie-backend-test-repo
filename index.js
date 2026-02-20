// backend/index.js
import express from "express";
import axios from "axios";
import cors from "cors";
import { mongooseConnection } from "./config/mongooseConfig.js";
import vapiRoutes from "./routes/vapiRoutes.js";
import dotenv from "dotenv";
dotenv.config();
import { attachCustomTranscriberWS } from "./customTranscriberServer.js";
import http from "http";

const app = express();
// app.use(cors());
app.use(
  cors({
    // origin: "https://talkypie-v4.onrender.com",
    // origin: "https://talkypie-frontend-v-3.onrender.com",
    origin: "https://talkypie-frontend-v3.onrender.com",
    // origin: "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  console.log("Hello from the root rout");
  res.json({ message: "Welcome to the TalkyPIES Backend!" });
});

app.use("/vapi", vapiRoutes);

app.use((err, req, res, next) => {
  console.error("Error occurred:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket handler
attachCustomTranscriberWS(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", async () => {
  try {
    await mongooseConnection();
    console.log(`🚀 Server listening on port ${PORT} (HTTP + WebSocket)`);
  } catch (err) {
    console.error("❌ Failed to connect to MongoDB:", err);
    process.exit(1); // crash early, Render will restart
  }
});
