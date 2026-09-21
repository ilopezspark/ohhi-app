import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest, timingSafeEqual, type Deps } from "./index.ts";
import { FakeAdmin, FakeDb, FakeStorage } from "./test_fakes.ts";

const SECRET = "correct-horse-battery-staple";
const fixedNow = () => new Date("2026-09-21T03:15:00.000Z");

function withSecretEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get("PURGE_DRAIN_SECRET");
  if (value === undefined) Deno.env.delete("PURGE_DRAIN_SECRET");
  else Deno.env.set("PURGE_DRAIN_SECRET", value);
  try {
    return fn();
  } finally {
    if (previous === undefined) Deno.env.delete("PURGE_DRAIN_SECRET");
    else Deno.env.set("PURGE_DRAIN_SECRET", previous);
  }
}

function buildFakeDeps(): { deps: Deps; db: FakeDb; storage: FakeStorage; admin: FakeAdmin } {
  const db = new FakeDb();
  const storage = new FakeStorage();
  const admin = new FakeAdmin();
  const deps: Deps = { db, storage, admin, now: fixedNow, timeBudgetMs: 1_000, batchSize: 200 };
  return { deps, db, storage, admin };
}

// --- timingSafeEqual (the constant-time path) -----------------------------

Deno.test("timingSafeEqual: equal strings compare true", async () => {
  assertEquals(await timingSafeEqual("abc123", "abc123"), true);
});

Deno.test("timingSafeEqual: different strings of the same length compare false", async () => {
  assertEquals(await timingSafeEqual("abc123", "abc124"), false);
});

Deno.test("timingSafeEqual: different lengths compare false without throwing", async () => {
  assertEquals(await timingSafeEqual("short", "a-much-longer-value-entirely"), false);
});

Deno.test("timingSafeEqual: empty strings only match empty strings", async () => {
  assertEquals(await timingSafeEqual("", ""), true);
  assertEquals(await timingSafeEqual("", "x"), false);
});

// --- handleRequest: secret header accepted/rejected ------------------------

Deno.test("handleRequest: missing header is refused with 401 and buildDeps is never called", async () => {
  await withSecretEnv(SECRET, async () => {
    let buildDepsCalled = false;
    const req = new Request("https://example.com/purge-drain", { method: "POST" });

    const res = await handleRequest(req, () => {
      buildDepsCalled = true;
      return buildFakeDeps().deps;
    });

    assertEquals(res.status, 401);
    assertEquals(buildDepsCalled, false);
    const body = await res.json();
    assertEquals(body.error.code, "unauthenticated");
  });
});

Deno.test("handleRequest: wrong secret is refused with 401 and buildDeps is never called, no query executed", async () => {
  await withSecretEnv(SECRET, async () => {
    let buildDepsCalled = false;
    const req = new Request("https://example.com/purge-drain", {
      method: "POST",
      headers: { "x-purge-drain-secret": "wrong-value" },
    });

    const res = await handleRequest(req, () => {
      buildDepsCalled = true;
      return buildFakeDeps().deps;
    });

    assertEquals(res.status, 401);
    assertEquals(buildDepsCalled, false);
  });
});

Deno.test("handleRequest: missing PURGE_DRAIN_SECRET env is an internal_error, not a 401, and never calls buildDeps", async () => {
  await withSecretEnv(undefined, async () => {
    let buildDepsCalled = false;
    const req = new Request("https://example.com/purge-drain", {
      method: "POST",
      headers: { "x-purge-drain-secret": "anything" },
    });

    const res = await handleRequest(req, () => {
      buildDepsCalled = true;
      return buildFakeDeps().deps;
    });

    assertEquals(res.status, 500);
    assertEquals(buildDepsCalled, false);
    const body = await res.json();
    assertEquals(body.error.code, "internal_error");
  });
});

Deno.test("handleRequest: correct secret runs the drain and writes one purge_runs row", async () => {
  await withSecretEnv(SECRET, async () => {
    const { deps, db } = buildFakeDeps();
    db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/a.jpg" });
    db.cohort = [{ user_id: "u1", deleted_at: "2026-08-01T00:00:00.000Z" }];

    const req = new Request("https://example.com/purge-drain", {
      method: "POST",
      headers: { "x-purge-drain-secret": SECRET },
    });

    const res = await handleRequest(req, () => deps);

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.claimed, 1);
    assertEquals(body.drainedOk, 1);

    assertEquals(db.runs.size, 1);
    const run = [...db.runs.values()][0];
    assertEquals(run.claimed, 1);
    assertEquals(run.drained_ok, 1);
    assertNotEquals(run.finished_at, null);

    assertEquals(db.closed, true); // connection is always closed after a run
  });
});

Deno.test("handleRequest: a thrown error during the run still closes the db connection and returns internal_error", async () => {
  await withSecretEnv(SECRET, async () => {
    const { deps, db } = buildFakeDeps();
    // Force claimPurgeBatch to throw so runPurgeDrain's outer try/catch in
    // handleRequest is exercised (not just runPurgeDrain's own).
    db.claimPurgeBatch = () => {
      throw new Error("boom");
    };
    // startPurgeRun still needs to work so finishPurgeRun's finally branch
    // inside runPurgeDrain runs before this error would ever reach
    // handleRequest -- but to isolate handleRequest's own catch, break
    // startPurgeRun instead so the throw happens before runPurgeDrain's own
    // try begins.
    db.startPurgeRun = () => {
      throw new Error("boom");
    };

    const req = new Request("https://example.com/purge-drain", {
      method: "POST",
      headers: { "x-purge-drain-secret": SECRET },
    });

    const res = await handleRequest(req, () => deps);

    assertEquals(res.status, 500);
    assertEquals(db.closed, true);
  });
});
