import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(key) {
  const value = Buffer.from(key || "", "base64");
  if (value.length !== 32) throw new Error("An encryption key of exactly 32 bytes is required.");
  return value;
}
export function seal(value, key, purpose) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
  return ["v1", nonce.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function unseal(value, key, purpose) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported encrypted payload.");
  const nonce = Buffer.from(parts[1], "base64"); const tag = Buffer.from(parts[2], "base64");
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted payload.");
  const cipher = createDecipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(parts[3], "base64")), cipher.final()]);
}
