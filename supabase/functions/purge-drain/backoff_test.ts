import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { backoffMinutes, DEAD_LETTER_THRESHOLD, isDeadLettered, nextAttemptAt } from "./backoff.ts";

Deno.test("backoffMinutes doubles per attempt", () => {
  assertEquals(backoffMinutes(0), 1);
  assertEquals(backoffMinutes(1), 2);
  assertEquals(backoffMinutes(2), 4);
  assertEquals(backoffMinutes(3), 8);
  assertEquals(backoffMinutes(4), 16);
});

Deno.test("backoffMinutes caps around an hour", () => {
  assertEquals(backoffMinutes(6), 60); // 2^6 = 64, capped to 60
  assertEquals(backoffMinutes(10), 60);
  assertEquals(backoffMinutes(20), 60);
});

Deno.test("backoffMinutes rejects a negative or non-integer attempts", () => {
  assertThrows(() => backoffMinutes(-1));
  assertThrows(() => backoffMinutes(1.5));
});

Deno.test("nextAttemptAt adds the backoff minutes to the given clock", () => {
  const now = () => new Date("2026-09-21T03:15:00.000Z");
  const result = nextAttemptAt(2, now); // 4 minutes
  assertEquals(result.toISOString(), "2026-09-21T03:19:00.000Z");
});

Deno.test("nextAttemptAt uses the real clock by default", () => {
  const before = Date.now();
  const result = nextAttemptAt(0);
  const after = Date.now();
  // 1 minute of backoff, give the test a wide window either side.
  assertEquals(result.getTime() >= before + 59_000, true);
  assertEquals(result.getTime() <= after + 61_000, true);
});

Deno.test("isDeadLettered matches claim_purge_batch's attempts < 5 predicate", () => {
  assertEquals(DEAD_LETTER_THRESHOLD, 5);
  assertEquals(isDeadLettered(0), false);
  assertEquals(isDeadLettered(4), false);
  assertEquals(isDeadLettered(5), true);
  assertEquals(isDeadLettered(6), true);
});
