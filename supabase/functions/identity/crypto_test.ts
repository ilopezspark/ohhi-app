import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import {
  CURRENT_KEY_VERSION,
  decodeKeyMaterial,
  DecryptError,
  decryptPayload,
  encryptPayload,
  importKeyBytes,
  KEY_BYTES,
  keyEnvVar,
  keyFor,
  NONCE_BYTES,
  openWithKey,
  resetKeyCache,
  sealWithKey,
  TAG_BYTES,
} from "./crypto.ts";

function randomKeyBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

function setKeyEnv(domain: "identity" | "card", version: number, bytes: Uint8Array) {
  Deno.env.set(keyEnvVar(domain, version), encodeBase64(bytes));
  resetKeyCache();
}

const utf8 = new TextEncoder();

// ---------------------------------------------------------------------------
// Byte layout (plan §3): nonce(12) || ciphertext‖tag, overhead exactly 28 bytes
// ---------------------------------------------------------------------------

Deno.test("layout: output is nonce(12) + plaintext + tag(16)", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  for (const len of [0, 1, 37, 4096]) {
    const blob = await sealWithKey(key, new Uint8Array(len));
    assertEquals(blob.byteLength, NONCE_BYTES + len + TAG_BYTES);
  }
});

Deno.test("layout: the first 12 bytes are the nonce the tag was computed over", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  const plaintext = utf8.encode("she/her");
  const blob = await sealWithKey(key, plaintext);

  // Re-derive by hand: split at byte 12 and decrypt with the split-out nonce.
  const nonce = blob.slice(0, NONCE_BYTES);
  const body = blob.slice(NONCE_BYTES);
  const manual = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body),
  );
  assertEquals(manual, plaintext);
  assertEquals(await openWithKey(key, blob), plaintext);
});

Deno.test("layout: a blob shorter than nonce+tag is rejected, not indexed past the end", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  for (const len of [0, 11, 12, 27]) {
    await assertRejects(() => openWithKey(key, new Uint8Array(len)), DecryptError);
  }
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

Deno.test("round trip: identity payload, including empty arrays", async () => {
  setKeyEnv("identity", CURRENT_KEY_VERSION, randomKeyBytes());
  for (
    const payload of [
      { pronouns: null, orientation: [] },
      { pronouns: "she/her", orientation: ["bi"] },
      { pronouns: "ask me", orientation: ["gay", "queer", "fluid"] },
    ]
  ) {
    const { ciphertext, keyVersion } = await encryptPayload("identity", payload);
    assertEquals(keyVersion, CURRENT_KEY_VERSION);
    assertEquals(await decryptPayload("identity", ciphertext, keyVersion), payload);
  }
});

Deno.test("round trip: card payload, including all-empty", async () => {
  setKeyEnv("card", CURRENT_KEY_VERSION, randomKeyBytes());
  for (
    const payload of [
      { into: [], safer_sex: [], kinks: [], hard_nos: [] },
      { into: ["top"], safer_sex: ["condoms"], kinks: ["vanilla"], hard_nos: ["no drugs"] },
    ]
  ) {
    const { ciphertext, keyVersion } = await encryptPayload("card", payload);
    assertEquals(await decryptPayload("card", ciphertext, keyVersion), payload);
  }
});

// ---------------------------------------------------------------------------
// Nonce uniqueness
// ---------------------------------------------------------------------------

Deno.test("nonce: two encryptions of identical plaintext differ", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  const plaintext = utf8.encode(JSON.stringify({ pronouns: "he/him", orientation: [] }));
  const a = await sealWithKey(key, plaintext);
  const b = await sealWithKey(key, plaintext);
  assertNotEquals(a, b);
  assertNotEquals(a.slice(0, NONCE_BYTES), b.slice(0, NONCE_BYTES));
});

Deno.test("nonce: 512 encryptions produce 512 distinct nonces", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  const seen = new Set<string>();
  for (let i = 0; i < 512; i++) {
    const blob = await sealWithKey(key, utf8.encode("x"));
    seen.add([...blob.slice(0, NONCE_BYTES)].join(","));
  }
  assertEquals(seen.size, 512);
});

// ---------------------------------------------------------------------------
// Tamper detection and wrong key
// ---------------------------------------------------------------------------

Deno.test("tamper: flipping a bit anywhere in the blob fails authentication", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  const blob = await sealWithKey(key, utf8.encode("she/her"));
  // One offset inside the nonce, one inside the ciphertext, one inside the tag.
  for (const offset of [3, NONCE_BYTES + 1, blob.byteLength - 1]) {
    const tampered = blob.slice();
    tampered[offset] ^= 0x01;
    await assertRejects(() => openWithKey(key, tampered), DecryptError);
  }
});

Deno.test("tamper: truncating the tag fails authentication", async () => {
  const key = await importKeyBytes(randomKeyBytes());
  const blob = await sealWithKey(key, utf8.encode("she/her"));
  await assertRejects(
    () => openWithKey(key, blob.slice(0, blob.byteLength - 1)),
    DecryptError,
  );
});

Deno.test("wrong key: a blob sealed under one key will not open under another", async () => {
  const a = await importKeyBytes(randomKeyBytes());
  const b = await importKeyBytes(randomKeyBytes());
  const blob = await sealWithKey(a, utf8.encode("she/her"));
  await assertRejects(() => openWithKey(b, blob), DecryptError);
});

Deno.test("wrong key: the card key does not open an identity blob", async () => {
  setKeyEnv("identity", CURRENT_KEY_VERSION, randomKeyBytes());
  setKeyEnv("card", CURRENT_KEY_VERSION, randomKeyBytes());
  const { ciphertext } = await encryptPayload("identity", {
    pronouns: "she/her",
    orientation: [],
  });
  await assertRejects(
    () => decryptPayload("card", ciphertext, CURRENT_KEY_VERSION),
    DecryptError,
  );
});

// ---------------------------------------------------------------------------
// key_version handling (decision 23: two versions coexist during a rotation)
// ---------------------------------------------------------------------------

Deno.test("key_version: v1 and v2 keys coexist; the row's column picks the key", async () => {
  const v1 = randomKeyBytes();
  const v2 = randomKeyBytes();
  setKeyEnv("identity", 1, v1);
  Deno.env.set(keyEnvVar("identity", 2), encodeBase64(v2));
  resetKeyCache();

  const key1 = await keyFor("identity", 1);
  const key2 = await keyFor("identity", 2);
  const blobV1 = await sealWithKey(key1, utf8.encode("v1 payload"));

  assertEquals(new TextDecoder().decode(await openWithKey(key1, blobV1)), "v1 payload");
  // Decrypting the same blob under the other version's key must fail.
  await assertRejects(() => openWithKey(key2, blobV1), DecryptError);
  Deno.env.delete(keyEnvVar("identity", 2));
});

Deno.test("key_version: env var names follow OHHI_<DOMAIN>_KEY_V<n>", () => {
  assertEquals(keyEnvVar("identity", 1), "OHHI_IDENTITY_KEY_V1");
  assertEquals(keyEnvVar("card", 1), "OHHI_CARD_KEY_V1");
  assertEquals(keyEnvVar("card", 12), "OHHI_CARD_KEY_V12");
});

Deno.test("key_version: a missing key version throws naming the variable", async () => {
  resetKeyCache();
  Deno.env.delete(keyEnvVar("identity", 9));
  const err = await assertRejects(() => keyFor("identity", 9));
  assert(
    (err as Error).message.includes("OHHI_IDENTITY_KEY_V9"),
    "error should name the missing variable",
  );
});

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

Deno.test("key material: only 32 decoded bytes are accepted", () => {
  assertEquals(decodeKeyMaterial(encodeBase64(randomKeyBytes())).byteLength, KEY_BYTES);
  assertThrows(
    () => decodeKeyMaterial(encodeBase64(new Uint8Array(16))),
    Error,
    "32 bytes",
  );
  assertThrows(() => decodeKeyMaterial("not base64!!"), Error);
});

Deno.test("key material: importKeyBytes refuses a wrong-length key", () => {
  assertThrows(() => importKeyBytes(new Uint8Array(31)), Error);
});

Deno.test("key material: a non-JSON but authentic payload is still a DecryptError", async () => {
  setKeyEnv("identity", CURRENT_KEY_VERSION, randomKeyBytes());
  const key = await keyFor("identity", CURRENT_KEY_VERSION);
  const blob = await sealWithKey(key, utf8.encode("<not json>"));
  await assertRejects(
    () => decryptPayload("identity", blob, CURRENT_KEY_VERSION),
    DecryptError,
  );
});
