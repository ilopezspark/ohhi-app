import { assertEquals } from "@std/assert";
import { ageOn, classifyDocumentDob, parseIsoDate, utcDate } from "./age.ts";

// Every "now" below is a fixed UTC instant, so the suite never depends on the day it runs.
const at = (iso: string) => new Date(iso);

// ---------------------------------------------------------------------------------------------
// The 18 boundary
// ---------------------------------------------------------------------------------------------

Deno.test("age: 17 years and 364 days is a minor", () => {
  // 18th birthday is 2026-10-01; the day before is 17y 364d.
  assertEquals(classifyDocumentDob("2008-10-01", at("2026-09-30T12:00:00Z")), { kind: "minor", dob: "2008-10-01", age: 17 });
});

Deno.test("age: exactly 18 today is an adult", () => {
  assertEquals(classifyDocumentDob("2008-09-30", at("2026-09-30T00:00:00Z")), { kind: "adult", dob: "2008-09-30", age: 18 });
});

Deno.test("age: exactly 18 today, at the last UTC second of the day, is still an adult", () => {
  assertEquals(classifyDocumentDob("2008-09-30", at("2026-09-30T23:59:59Z")).kind, "adult");
});

Deno.test("age: the UTC date is used, not the local one (00:30 UTC on the birthday is already the birthday)", () => {
  // 00:30 UTC on 30 September is still 29 September in Chicago; this module uses UTC on purpose
  // (the SQL authority is the stricter one, see age.ts's header).
  assertEquals(classifyDocumentDob("2008-09-30", at("2026-09-30T00:30:00Z")).kind, "adult");
  assertEquals(classifyDocumentDob("2008-09-30", at("2026-09-29T23:59:59Z")).kind, "minor");
});

Deno.test("age: one day past 18 is an adult; a long-adult date is an adult", () => {
  assertEquals(classifyDocumentDob("2008-09-29", at("2026-09-30T12:00:00Z")).kind, "adult");
  assertEquals(classifyDocumentDob("1990-01-11", at("2026-09-30T12:00:00Z")), { kind: "adult", dob: "1990-01-11", age: 36 });
});

Deno.test("age: a child's date is a minor (never 'invalid')", () => {
  assertEquals(classifyDocumentDob("2015-06-01", at("2026-09-30T12:00:00Z")), { kind: "minor", dob: "2015-06-01", age: 11 });
});

Deno.test("age: a date of birth of today is a minor aged 0, not invalid", () => {
  assertEquals(classifyDocumentDob("2026-09-30", at("2026-09-30T12:00:00Z")), { kind: "minor", dob: "2026-09-30", age: 0 });
});

// ---------------------------------------------------------------------------------------------
// Leap days
// ---------------------------------------------------------------------------------------------

Deno.test("leap day: born 29 February 2008 is still 17 on 28 February 2026", () => {
  assertEquals(classifyDocumentDob("2008-02-29", at("2026-02-28T23:00:00Z")), { kind: "minor", dob: "2008-02-29", age: 17 });
});

Deno.test("leap day: born 29 February 2008 is 18 on 1 March 2026", () => {
  assertEquals(classifyDocumentDob("2008-02-29", at("2026-03-01T00:00:00Z")), { kind: "adult", dob: "2008-02-29", age: 18 });
});

Deno.test("leap day: 'today' is 29 February (2028): born 28 February 2010 is 18, born 1 March 2010 is 17", () => {
  assertEquals(classifyDocumentDob("2010-02-28", at("2028-02-29T12:00:00Z")).kind, "adult");
  assertEquals(classifyDocumentDob("2010-03-01", at("2028-02-29T12:00:00Z")).kind, "minor");
});

Deno.test("leap day: 29 February in a non-leap year is malformed, not rolled to 1 March", () => {
  assertEquals(classifyDocumentDob("2007-02-29", at("2026-09-30T12:00:00Z")), { kind: "invalid", reason: "malformed" });
});

Deno.test("ageOn: the whole-years rule directly", () => {
  const dob = { year: 2008, month: 2, day: 29 };
  assertEquals(ageOn(dob, { year: 2026, month: 2, day: 28 }), 17);
  assertEquals(ageOn(dob, { year: 2026, month: 3, day: 1 }), 18);
  assertEquals(ageOn({ year: 2000, month: 1, day: 1 }, { year: 1999, month: 12, day: 31 }), -1);
});

// ---------------------------------------------------------------------------------------------
// Missing, malformed, future, implausible
// ---------------------------------------------------------------------------------------------

Deno.test("invalid: missing (null, undefined, empty)", () => {
  const now = at("2026-09-30T12:00:00Z");
  assertEquals(classifyDocumentDob(null, now), { kind: "invalid", reason: "missing" });
  assertEquals(classifyDocumentDob(undefined, now), { kind: "invalid", reason: "missing" });
  assertEquals(classifyDocumentDob("", now), { kind: "invalid", reason: "missing" });
});

Deno.test("invalid: malformed shapes are refused, never guessed", () => {
  const now = at("2026-09-30T12:00:00Z");
  for (const raw of [
    "2001-13-01", // month 13
    "2001-00-10", // month 0
    "2001-04-31", // 31 April
    "2001-02-30",
    "2001-01-00",
    "01/02/2003",
    "2003/01/02",
    "2001-1-5",
    "20010105",
    "2001-01-05T00:00:00Z", // a timestamp, not a date
    " 2001-01-05",
    "2001-01-05 ",
    "not a date",
    "0000-01-01",
  ]) {
    assertEquals(classifyDocumentDob(raw, now), { kind: "invalid", reason: "malformed" }, raw);
  }
});

Deno.test("invalid: a non-string value from the payload is malformed", () => {
  const now = at("2026-09-30T12:00:00Z");
  assertEquals(classifyDocumentDob(20010105 as unknown as string, now), { kind: "invalid", reason: "malformed" });
  assertEquals(classifyDocumentDob({} as unknown as string, now), { kind: "invalid", reason: "malformed" });
});

Deno.test("invalid: a future date (tomorrow, next year) is refused", () => {
  const now = at("2026-09-30T12:00:00Z");
  assertEquals(classifyDocumentDob("2026-10-01", now), { kind: "invalid", reason: "future" });
  assertEquals(classifyDocumentDob("2030-01-01", now), { kind: "invalid", reason: "future" });
});

Deno.test("invalid: 121 or older is implausible; 120 is accepted", () => {
  const now = at("2026-09-30T12:00:00Z");
  assertEquals(classifyDocumentDob("1906-09-30", now), { kind: "adult", dob: "1906-09-30", age: 120 });
  assertEquals(classifyDocumentDob("1905-10-01", now), { kind: "adult", dob: "1905-10-01", age: 120 });
  assertEquals(classifyDocumentDob("1905-09-30", now), { kind: "invalid", reason: "implausible" });
  assertEquals(classifyDocumentDob("1800-01-01", now), { kind: "invalid", reason: "implausible" });
});

Deno.test("parseIsoDate / utcDate: plain building blocks", () => {
  assertEquals(parseIsoDate("2004-02-29"), { year: 2004, month: 2, day: 29 });
  assertEquals(parseIsoDate("0099-03-04"), { year: 99, month: 3, day: 4 });
  assertEquals(parseIsoDate(null), null);
  assertEquals(utcDate(at("2026-01-01T00:00:00Z")), { year: 2026, month: 1, day: 1 });
  assertEquals(utcDate(at("2025-12-31T23:59:59-06:00")), { year: 2026, month: 1, day: 1 });
});
