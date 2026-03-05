import { mongooseConnection } from "../config/mongooseConfig.js";
import { UserModel } from "../models/userModel.js";
import { hashPassword, verifyPassword } from "../utils/passwordUtils.js";
import { createAuthToken } from "../utils/tokenUtils.js";

const TOKEN_EXPIRES_SECONDS = 60 * 60 * 24 * 7;

function serializeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
  };
}

function buildAuthResponse(user) {
  const token = createAuthToken(
    {
      sub: user._id.toString(),
      email: user.email,
      name: user.name,
    },
    TOKEN_EXPIRES_SECONDS,
  );

  return {
    token,
    expiresIn: TOKEN_EXPIRES_SECONDS,
    user: serializeUser(user),
  };
}

export async function signup(req, res) {
  try {
    await mongooseConnection();

    const { name, email, password } = req.body;
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await UserModel.create({
      name,
      email,
      passwordHash,
    });

    return res.status(201).json(buildAuthResponse(user));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    console.error("Signup error:", error);
    return res.status(500).json({ error: "Failed to create account" });
  }
}

export async function login(req, res) {
  try {
    await mongooseConnection();

    const { email, password } = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    return res.status(200).json(buildAuthResponse(user));
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Failed to login" });
  }
}

export async function getCurrentUser(req, res) {
  return res.status(200).json({ user: req.user });
}
