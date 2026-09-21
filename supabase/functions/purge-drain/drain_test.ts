import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { drainBatch, groupByBucket, isNotFoundError } from "./drain.ts";
import { FakeDb, FakeStorage } from "./test_fakes.ts";
import type { PurgeQueueRow } from "./db.ts";

const fixedNow = () => new Date("2026-09-21T03:15:00.000Z");

Deno.test("groupByBucket groups rows by bucket_id, preserving order within a bucket", () => {
  const rows: PurgeQueueRow[] = [
    { id: "1", bucket_id: "album-photos", object_name: "u1/a.jpg" },
    { id: "2", bucket_id: "profile-photos", object_name: "u1/p.jpg" },
    { id: "3", bucket_id: "album-photos", object_name: "u1/b.jpg" },
  ];
  const groups = groupByBucket(rows);
  assertEquals([...groups.keys()].sort(), ["album-photos", "profile-photos"]);
  assertEquals(groups.get("album-photos")!.map((r) => r.id), ["1", "3"]);
  assertEquals(groups.get("profile-photos")!.map((r) => r.id), ["2"]);
});

Deno.test("isNotFoundError matches a 404 status or a not-found message, nothing else", () => {
  assertEquals(isNotFoundError(null), false);
  assertEquals(isNotFoundError({ message: "boom" }), false);
  assertEquals(isNotFoundError({ message: "boom", status: 404 }), true);
  assertEquals(isNotFoundError({ message: "Object not found" }), true);
  assertEquals(isNotFoundError({ message: "key does not exist" }), true);
  assertEquals(isNotFoundError({ message: "connection reset" }), false);
});

Deno.test("drainBatch calls remove exactly once per bucket, not once per row", async () => {
  const db = new FakeDb();
  const storage = new FakeStorage();
  const a1 = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/a.jpg" });
  const a2 = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/b.jpg" });
  const p1 = db.seedQueueRow({ bucket_id: "profile-photos", object_name: "u1/p.jpg" });

  const result = await drainBatch(
    db,
    storage,
    [a1, a2, p1].map((r) => ({ id: r.id, bucket_id: r.bucket_id, object_name: r.object_name })),
    fixedNow,
  );

  assertEquals(result, { claimed: 3, processed: 3, failed: 0, deadLettered: 0 });
  assertEquals(storage.calls.length, 2); // one call per bucket
  const albumCall = storage.calls.find((c) => c.bucket === "album-photos")!;
  assertEquals(albumCall.paths.sort(), ["u1/a.jpg", "u1/b.jpg"]);
  assertEquals(db.queue.get(a1.id)!.processed_at !== null, true);
  assertEquals(db.queue.get(a2.id)!.processed_at !== null, true);
  assertEquals(db.queue.get(p1.id)!.processed_at !== null, true);
});

Deno.test("drainBatch treats a bucket-level not-found error as done, no per-row retry needed", async () => {
  const db = new FakeDb();
  const storage = new FakeStorage();
  const row = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/gone.jpg" });
  storage.script("album-photos", ["u1/gone.jpg"], {
    error: { message: "Object not found", status: 404 },
  });

  const result = await drainBatch(db, storage, [row], fixedNow);

  assertEquals(result, { claimed: 1, processed: 1, failed: 0, deadLettered: 0 });
  assertEquals(storage.calls.length, 1); // no per-object retry needed for a group-level not-found
  assertEquals(db.queue.get(row.id)!.processed_at !== null, true);
});

Deno.test("drainBatch isolates a per-object failure: one not-found, one real error", async () => {
  const db = new FakeDb();
  const storage = new FakeStorage();
  const ok = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/gone.jpg", attempts: 2 });
  const bad = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/locked.jpg", attempts: 2 });

  // The whole-bucket call fails for a reason that is not "not found" ...
  storage.script("album-photos", ["u1/gone.jpg", "u1/locked.jpg"], {
    error: { message: "internal error" },
  });
  // ... so drainBatch retries per object.
  storage.script("album-photos", ["u1/gone.jpg"], { error: { message: "not found" } });
  storage.script("album-photos", ["u1/locked.jpg"], { error: { message: "permission denied" } });

  const result = await drainBatch(
    db,
    storage,
    [ok, bad].map((r) => ({ id: r.id, bucket_id: r.bucket_id, object_name: r.object_name })),
    fixedNow,
  );

  assertEquals(result.processed, 1);
  assertEquals(result.failed, 1);
  assertEquals(result.deadLettered, 0);

  assertEquals(db.queue.get(ok.id)!.processed_at !== null, true);

  const badRow = db.queue.get(bad.id)!;
  assertEquals(badRow.processed_at, null);
  assertEquals(badRow.last_error, "permission denied");
  // attempts was 2 at write time -> backoff = 2^2 = 4 minutes from fixedNow.
  assertEquals(badRow.next_attempt_at?.toISOString(), "2026-09-21T03:19:00.000Z");
});

Deno.test("drainBatch dead-letters a row once its attempts reach the threshold", async () => {
  const db = new FakeDb();
  const storage = new FakeStorage();
  // Simulate: this is the 5th lease (claim_purge_batch already incremented
  // attempts to 5 before handing the row to drainBatch).
  const row = db.seedQueueRow({ bucket_id: "album-photos", object_name: "u1/stuck.jpg", attempts: 5 });
  storage.script("album-photos", ["u1/stuck.jpg"], { error: { message: "still failing" } });

  const result = await drainBatch(db, storage, [row], fixedNow);

  assertEquals(result.failed, 1);
  assertEquals(result.deadLettered, 1);
  assertEquals(db.queue.get(row.id)!.last_error, "still failing");
});

Deno.test("drainBatch is a no-op on an empty batch", async () => {
  const db = new FakeDb();
  const storage = new FakeStorage();
  const result = await drainBatch(db, storage, [], fixedNow);
  assertEquals(result, { claimed: 0, processed: 0, failed: 0, deadLettered: 0 });
  assertEquals(storage.calls.length, 0);
});
