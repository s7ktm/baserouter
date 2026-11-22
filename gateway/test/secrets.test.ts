import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashKey, keyHint, loadMasterKey, newRouteKey, seal, unseal } from "../src/secrets.ts";

test("a route key is long, random and marked as BaseRouter's", () => {
  const a = newRouteKey();
  const b = newRouteKey();
  expect(a).toMatch(/^br_[0-9a-f]{48}$/);
  expect(a).not.toBe(b);
});

test("a key always hashes to the same value, and the hash does not contain the key", () => {
  const key = newRouteKey();
  const hash = hashKey(key);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(hashKey(key)).toBe(hash);
  expect(hash).not.toContain(key.slice(3));
  expect(hashKey(key + "0")).not.toBe(hash);
});

test("the hash is SHA-256, so a key made elsewhere can be checked", () => {
  expect(hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the hint is the last four characters", () => {
  expect(keyHint("br_0123456789abcdef")).toBe("cdef");
});

test("a sealed provider key opens again with the same master key", () => {
  const master = randomBytes(32);
  const sealed = seal(master, "provider-key-ğüş-1234");
  expect(sealed).not.toContain("provider-key");
  expect(unseal(master, sealed)).toBe("provider-key-ğüş-1234");
});

test("sealing the same key twice gives different text", () => {
  const master = randomBytes(32);
  expect(seal(master, "same")).not.toBe(seal(master, "same"));
});

test("a sealed key does not open with another master key, or after it was changed", () => {
  const master = randomBytes(32);
  const sealed = seal(master, "provider-key");
  expect(() => unseal(randomBytes(32), sealed)).toThrow();
  const parts = sealed.split(".");
  parts[3] = Buffer.from("tampered-key").toString("base64url");
  expect(() => unseal(master, parts.join("."))).toThrow();
  expect(() => unseal(master, "v0.a.b.c")).toThrow();
});

test("the master key is made once, kept in a file only its owner can read, and reused", () => {
  const dir = mkdtempSync(join(tmpdir(), "baserouter-test-"));
  try {
    const first = loadMasterKey(dir);
    expect(first.length).toBe(32);
    expect(statSync(join(dir, "secret.key")).mode & 0o777).toBe(0o600);
    expect(loadMasterKey(dir).equals(first)).toBe(true);
    expect(readFileSync(join(dir, "secret.key"), "utf8").trim()).toBe(first.toString("hex"));

    writeFileSync(join(dir, "secret.key"), "not a key");
    expect(() => loadMasterKey(dir)).toThrow();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
