import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_PREFIX = "tp";
const TOKEN_VERSION = 1;
const DEFAULT_EXPIRES_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  const padded =
    padLength === 0 ? normalized : normalized + "=".repeat(4 - padLength);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getTokenSecret() {
  return process.env.AUTH_TOKEN_SECRET || "talkypie-dev-secret-change-me";
}

function signValue(value) {
  const digest = createHmac("sha256", getTokenSecret()).update(value).digest();
  return base64UrlEncode(digest);
}

export function createAuthToken(
  payload,
  expiresInSeconds = DEFAULT_EXPIRES_SECONDS,
) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    v: TOKEN_VERSION,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = signValue(encodedPayload);
  return `${TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid token");
  }

  const [prefix, encodedPayload, signature] = token.split(".");
  if (!prefix || !encodedPayload || !signature || prefix !== TOKEN_PREFIX) {
    throw new Error("Invalid token format");
  }

  const expectedSignature = signValue(encodedPayload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    throw new Error("Token expired");
  }

  return payload;
}
