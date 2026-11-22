// Everything secret in one place: route keys, the sealing of provider keys,
// and the file that holds the key they are sealed with.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROUTE_KEY_PREFIX = "br_";

// A route key is 192 random bits. It is shown once and only its hash is kept.
export function newRouteKey(): string {
  return ROUTE_KEY_PREFIX + randomBytes(24).toString("hex");
}

// Plain SHA-256 is enough here: the input is a long random token, not a password.
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function keyHint(key: string): string {
  return key.slice(-4);
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

// The master key lives next to the database, readable only by its owner. It protects
// provider keys in a copied or backed-up database file, not on a machine someone
// already controls.
export function loadMasterKey(dataDir: string): Buffer {
  const path = join(dataDir, "secret.key");
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
    if (key.length !== 32) throw new Error(`${path} is not a 32-byte key. Restore it from a backup, or remove it and add your providers again.`);
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex") + "\n", { mode: 0o600, flag: "wx" });
  return key;
}

// AES-256-GCM. Stored as "v1.<iv>.<tag>.<ciphertext>", each part base64url.
export function seal(master: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(master: Buffer, sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Unknown sealed format");
  const decipher = createDecipheriv("aes-256-gcm", master, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
