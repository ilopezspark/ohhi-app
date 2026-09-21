// AES-256-GCM for user_identity / user_private_card payloads.
// docs/edge-identity-plan.md §3; key rotation per decision 23.
//
// Byte layout of `payload_ciphertext`, exactly:
//
//     payload_ciphertext = nonce(12) || ciphertext‖tag   (tag appended by subtle.encrypt)
//
// `key_version` is a separate column, never embedded in the blob: decrypt looks
// the key up by that column, then splits the blob at byte 12. Overhead is a
// fixed 12 + 16 = 28 bytes over the plaintext JSON.
//
// KEY MATERIAL — the plan's source of truth is Supabase Vault
// (`ohhi_identity_key_v{n}` / `ohhi_card_key_v{n}`). Ops mirrors each Vault
// secret into a function secret of the same name, upper-cased, so this module
// reads it from the environment rather than holding a DB connection of its own:
//
//     Vault `ohhi_identity_key_v1` -> env `OHHI_IDENTITY_KEY_V1`
//     Vault `ohhi_card_key_v1`     -> env `OHHI_CARD_KEY_V1`
//
// Each value is 32 random bytes, base64-encoded. Rotation (decision 23): add
// `..._v2` in Vault, mirror it, bump CURRENT_KEY_VERSION, backfill. The old
// version stays readable because `keyFor()` resolves per version, so both keys
// coexist during the window.
//
// Nothing here logs a key, a nonce, a ciphertext, or a plaintext.
//
// Constant time: the only equality test over secret material is the GCM
// authentication tag, and that comparison happens inside
// `crypto.subtle.decrypt`, which is constant-time by construction. This module
// never compares keys, tags, or ciphertexts with `===`, and never branches on
// where a decrypt failed — every failure is the same `DecryptError`.

import { decodeBase64 } from "@std/encoding/base64";
import { requiredEnv } from "../_shared/env.ts";

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/** The version new writes are encrypted under. Bumped by hand on rotation. */
export const CURRENT_KEY_VERSION = 1;

export type KeyDomain = "identity" | "card";

// Deno's TS lib narrows `BufferSource` to views over a plain `ArrayBuffer`,
// while `Uint8Array` is generic over `ArrayBufferLike`. Every array here is
// ArrayBuffer-backed, so this is a type-level no-op, not a runtime conversion.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

export class DecryptError extends Error {
  constructor(message = "Could not decrypt payload.") {
    super(message);
    this.name = "DecryptError";
  }
}

/** Name of the function secret holding a domain's key at a given version. */
export function keyEnvVar(domain: KeyDomain, version: number): string {
  return `OHHI_${domain.toUpperCase()}_KEY_V${version}`;
}

/** Decodes base64 key material and checks its length. Never logs the value. */
export function decodeKeyMaterial(encoded: string, varName = "key"): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = decodeBase64(encoded.trim());
  } catch {
    throw new Error(`${varName} is not valid base64.`);
  }
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(`${varName} must decode to ${KEY_BYTES} bytes, got ${raw.byteLength}.`);
  }
  return raw;
}

/** Imports 32 raw bytes as a non-extractable AES-GCM key. */
export function importKeyBytes(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error(`AES-256-GCM needs ${KEY_BYTES} key bytes, got ${raw.byteLength}.`);
  }
  return crypto.subtle.importKey("raw", bs(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// In-isolate cache, keyed "domain:version". Holds non-extractable CryptoKeys,
// never raw bytes; nothing is written to disk.
const keyCache = new Map<string, Promise<CryptoKey>>();

/** Resolves a domain's key at a version from the environment, cached per isolate. */
export function keyFor(domain: KeyDomain, version: number): Promise<CryptoKey> {
  const cacheKey = `${domain}:${version}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const varName = keyEnvVar(domain, version);
  // Always a rejected promise, never a synchronous throw: a missing secret and
  // a bad secret must look the same to every caller's `await`.
  const loaded =
    (async () => await importKeyBytes(decodeKeyMaterial(requiredEnv(varName), varName)))()
      .catch((err) => {
        keyCache.delete(cacheKey);
        throw err;
      });
  keyCache.set(cacheKey, loaded);
  return loaded;
}

/** Test seam: drops the cached keys so an env change takes effect. */
export function resetKeyCache(): void {
  keyCache.clear();
}

/** nonce(12) || ciphertext‖tag. A fresh nonce per call, never reused. */
export async function sealWithKey(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce) }, key, bs(plaintext)),
  );
  const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  out.set(nonce, 0);
  out.set(sealed, NONCE_BYTES);
  return out;
}

/** Splits at byte 12 and authenticates. Any failure is one opaque DecryptError. */
export async function openWithKey(
  key: CryptoKey,
  blob: Uint8Array,
): Promise<Uint8Array> {
  if (blob.byteLength < NONCE_BYTES + TAG_BYTES) throw new DecryptError();
  const nonce = blob.subarray(0, NONCE_BYTES);
  const body = blob.subarray(NONCE_BYTES);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(nonce) }, key, bs(body)),
    );
  } catch {
    throw new DecryptError();
  }
}

/** JSON-encodes and seals a payload under the current write version. */
export async function encryptPayload(
  domain: KeyDomain,
  payload: unknown,
): Promise<{ ciphertext: Uint8Array; keyVersion: number }> {
  const key = await keyFor(domain, CURRENT_KEY_VERSION);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return {
    ciphertext: await sealWithKey(key, bytes),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/** Opens a blob using the key named by the row's `key_version` column. */
export async function decryptPayload(
  domain: KeyDomain,
  ciphertext: Uint8Array,
  keyVersion: number,
): Promise<unknown> {
  const key = await keyFor(domain, keyVersion);
  const bytes = await openWithKey(key, ciphertext);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // A payload that authenticates but is not JSON is still a decrypt failure
    // to every caller; never surface the bytes.
    throw new DecryptError();
  }
}
