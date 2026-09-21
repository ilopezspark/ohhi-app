import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scrubbedEmailFor, scrubPurgedUsers } from "./scrub.ts";
import { FakeAdmin, FakeDb } from "./test_fakes.ts";

Deno.test("scrubPurgedUsers scrubs a purged user: randomized email, cleared metadata, banned, never deleted", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  admin.seedUser({ id: "u1", email: "student@campus.edu", phone: "+15550001111" });
  db.cohort = [{ user_id: "u1", deleted_at: "2026-08-01T00:00:00.000Z" }];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result, { candidates: 1, scrubbed: 1, skipped: 0, errors: [] });
  assertEquals(admin.updateCalls.length, 1);
  assertEquals(admin.updateCalls[0].uid, "u1");
  assertEquals(admin.updateCalls[0].attrs.email, scrubbedEmailFor("u1"));
  assertEquals(admin.updateCalls[0].attrs.phone, "");
  assertEquals(admin.updateCalls[0].attrs.user_metadata, {});
  assertEquals(admin.updateCalls[0].attrs.app_metadata, {});
  assertEquals(admin.users.get("u1")!.banned_until !== null, true);
  assertEquals(admin.deleteCalls, []); // decision 31: scrub-and-ban, never delete the row
});

Deno.test("scrubPurgedUsers never touches a candidate whose deleted_at is null", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  admin.seedUser({ id: "u2", email: "still-active@campus.edu" });
  db.cohort = [{ user_id: "u2", deleted_at: null }];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result, { candidates: 1, scrubbed: 0, skipped: 1, errors: [] });
  assertEquals(admin.updateCalls, []);
  assertEquals(admin.users.get("u2")!.email, "still-active@campus.edu");
});

Deno.test("scrubPurgedUsers is idempotent: a user already carrying the deterministic scrubbed email is skipped, not re-scrubbed", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  admin.seedUser({ id: "u3", email: scrubbedEmailFor("u3"), banned_until: "2999-01-01T00:00:00.000Z" });
  db.cohort = [{ user_id: "u3", deleted_at: "2026-08-01T00:00:00.000Z" }];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result, { candidates: 1, scrubbed: 0, skipped: 1, errors: [] });
  assertEquals(admin.updateCalls, []); // no redundant Admin API call
  assertEquals(admin.deleteCalls, []);
});

Deno.test("scrubPurgedUsers treats a user already gone from auth.users as a skip, not a failure", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  // No seedUser call -- getUserById resolves with a null user.
  db.cohort = [{ user_id: "u-missing", deleted_at: "2026-08-01T00:00:00.000Z" }];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result, { candidates: 1, scrubbed: 0, skipped: 1, errors: [] });
});

Deno.test("scrubPurgedUsers records a per-user error without aborting the rest of the cohort", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  admin.seedUser({ id: "u-ok", email: "ok@campus.edu" });
  admin.seedUser({ id: "u-fails", email: "fails@campus.edu" });
  admin.scriptUpdateError("u-fails", "admin API unavailable");
  db.cohort = [
    { user_id: "u-fails", deleted_at: "2026-08-01T00:00:00.000Z" },
    { user_id: "u-ok", deleted_at: "2026-08-01T00:00:00.000Z" },
  ];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result.candidates, 2);
  assertEquals(result.scrubbed, 1);
  assertEquals(result.skipped, 0);
  assertEquals(result.errors, [{ userId: "u-fails", message: "admin API unavailable" }]);
});

Deno.test("scrubPurgedUsers never calls updateUserById for a getUserById error", async () => {
  const db = new FakeDb();
  const admin = new FakeAdmin();
  admin.scriptGetError("u-broken", "network error");
  db.cohort = [{ user_id: "u-broken", deleted_at: "2026-08-01T00:00:00.000Z" }];

  const result = await scrubPurgedUsers(db, admin);

  assertEquals(result.errors, [{ userId: "u-broken", message: "network error" }]);
  assertEquals(admin.updateCalls, []);
});
