import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM helpers for sensitive blobs (session cookies, ID numbers).
 * Requires ENCRYPTION_KEY (any string; derived via SHA-256).
 * Without ENCRYPTION_KEY we still prefix plaintext with "plain:" for fixture/dev —
 * NEVER use that mode in production.
 */
function deriveKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 8) return null;
  return createHash("sha256").update(raw).digest();
}

export function encryptSensitive(plaintext: string): string {
  const key = deriveKey();
  if (!key) {
    return `plain:${plaintext}`;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSensitive(blob: string): string {
  if (blob.startsWith("plain:")) return blob.slice("plain:".length);
  const key = deriveKey();
  if (!key) throw new Error("ENCRYPTION_KEY required to decrypt");
  const parts = blob.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) throw new Error("Invalid ciphertext");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hasEncryptionKey(): boolean {
  return Boolean(deriveKey());
}
