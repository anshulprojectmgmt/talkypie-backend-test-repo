import { mongooseConnection } from "../config/mongooseConfig.js";
import { UserModel } from "../models/userModel.js";
import { verifyAuthToken } from "../utils/tokenUtils.js";

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication token missing" });
    }

    const payload = verifyAuthToken(token);
    if (!payload?.sub) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    await mongooseConnection();
    const user = await UserModel.findById(payload.sub).select("_id name email");
    if (!user) {
      return res.status(401).json({ error: "User not found for this token" });
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    };
    console.log(req.user);
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Invalid or expired authentication token" });
  }
}
