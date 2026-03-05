import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scryptCallback);
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derivedKey = await scryptAsync(password, salt, KEY_BYTES);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const derivedKey = await scryptAsync(password, salt, KEY_BYTES);
  const hashBuffer = Buffer.from(hash, "hex");
  const derivedBuffer = Buffer.from(derivedKey);

  if (hashBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, derivedBuffer);
}
