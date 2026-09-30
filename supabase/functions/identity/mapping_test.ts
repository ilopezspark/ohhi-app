// Every row of reconcile.md B1, including the no-home cases.

import { assertEquals } from "@std/assert";
import { emptyCard, emptyIdentity } from "./fields.ts";
import {
  cardFromStored,
  identityFromStored,
  mapCardV1,
  mapIdentityV1,
  mergeReports,
  pronounFilterCandidates,
  readCardV1,
  readIdentityV1,
  V1_KINK_MAP,
} from "./mapping.ts";

const v1Card = (over: Record<string, string[]> = {}) => ({
  into: [],
  safer_sex: [],
  kinks: [],
  hard_nos: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Identity rows
// ---------------------------------------------------------------------------

Deno.test("B1 pronouns: the four v1 options map exactly, as a one-item list", () => {
  for (const p of ["he/him", "she/her", "they/them", "ask me"]) {
    const { payload, report } = mapIdentityV1({ pronouns: p, orientation: [] });
    assertEquals(payload.pronouns, [p], p);
    assertEquals(report, { moved: [], held_back: [], removed: [] });
  }
});

Deno.test("B1 pronouns: free text up to 16 characters becomes one typed entry", () => {
  const { payload, report } = mapIdentityV1({ pronouns: "  xe/xir ", orientation: [] });
  assertEquals(payload.pronouns, ["xe/xir"]);
  assertEquals(report.held_back, []);
  // Free text matching a v2 option (any case) lands on that option.
  assertEquals(mapIdentityV1({ pronouns: "Xe/Xem", orientation: [] }).payload.pronouns, [
    "xe/xem",
  ]);
});

Deno.test("B1 pronouns: free text over 16 characters has no home and is held back", () => {
  const { payload, report } = mapIdentityV1({
    pronouns: "whatever feels right today",
    orientation: [],
  });
  assertEquals(payload.pronouns, []);
  assertEquals(report.held_back, ["pronouns"]);
});

Deno.test("B1 pronouns: free text failing the word filter is held back", () => {
  const dirty = new Set(["badword/x"]);
  const { payload, report } = mapIdentityV1(
    { pronouns: "badword/x", orientation: [] },
    { dirty },
  );
  assertEquals(payload.pronouns, []);
  assertEquals(report.held_back, ["pronouns"]);
});

Deno.test("pronounFilterCandidates: only a keepable typed pronoun is sent to the filter", () => {
  assertEquals(pronounFilterCandidates({ pronouns: " per/pers " }), ["per/pers"]);
  assertEquals(pronounFilterCandidates({ pronouns: "she/her" }), []);
  assertEquals(pronounFilterCandidates({ pronouns: "x".repeat(17) }), []);
  assertEquals(pronounFilterCandidates({ pronouns: null }), []);
  assertEquals(pronounFilterCandidates({ pronouns: "a\nb" }), []);
});

Deno.test("B1 orientation: every v1 chip maps exactly", () => {
  for (const o of ["bi", "straight", "gay", "queer", "asexual", "rather not say"]) {
    assertEquals(mapIdentityV1({ pronouns: null, orientation: [o] }).payload.orientation, [
      o,
    ]);
  }
  const three = mapIdentityV1({ pronouns: null, orientation: ["bi", "queer", "asexual"] });
  assertEquals(three.payload.orientation, ["bi", "queer", "asexual"]);
  assertEquals(three.report.removed, []);
});

Deno.test("B1 orientation: a pre-redesign value with no v2 home is removed", () => {
  const { payload, report } = mapIdentityV1({
    pronouns: null,
    orientation: ["bi", "fluid"],
  });
  assertEquals(payload.orientation, ["bi"]);
  assertEquals(report.removed, ["orientation"]);
});

Deno.test("mapIdentityV1: every other v2 field starts empty", () => {
  const { payload } = mapIdentityV1({ pronouns: "she/her", orientation: ["bi"] });
  assertEquals({ ...payload, pronouns: [], orientation: [] }, emptyIdentity());
});

// ---------------------------------------------------------------------------
// Card rows
// ---------------------------------------------------------------------------

Deno.test("B1 into -> interested_in: same labels, returned for the identity payload", () => {
  const { payload, interestedIn, report } = mapCardV1(
    v1Card({ into: ["men", "women", "nonbinary people", "everyone"] }),
  );
  assertEquals(interestedIn, ["men", "women", "nonbinary people", "everyone"]);
  assertEquals(payload, emptyCard());
  assertEquals(report, { moved: [], held_back: [], removed: [] });
});

Deno.test("B1 into: a pre-redesign value (top, vers) is removed", () => {
  const { interestedIn, report } = mapCardV1(v1Card({ into: ["top", "men", "vers"] }));
  assertEquals(interestedIn, ["men"]);
  assertEquals(report.removed, ["into"]);
});

Deno.test("B1 safer_sex: the four v1 chips map exactly", () => {
  const chips = ["condoms", "on prep", "on birth control", "ask me"];
  assertEquals(mapCardV1(v1Card({ safer_sex: chips })).payload.safer_sex, chips);
});

Deno.test("B1 safer_sex: tested <mon> '<yy> -> tested recently (D11), once", () => {
  const { payload, report } = mapCardV1(
    v1Card({ safer_sex: ["condoms", "tested apr '26", "tested jan '25"] }),
  );
  assertEquals(payload.safer_sex, ["condoms", "tested recently"]);
  assertEquals(report.removed, []);
});

Deno.test("B1 safer_sex: an unknown value is removed", () => {
  const { payload, report } = mapCardV1(v1Card({ safer_sex: ["undetectable", "on prep"] }));
  assertEquals(payload.safer_sex, ["on prep"]);
  assertEquals(report.removed, ["safer_sex"]);
});

Deno.test("B1 kinks: every v1 chip lands where the table says", () => {
  const expected: Record<string, [string, string]> = {
    "vanilla": ["dynamics", "vanilla"],
    "dom": ["dynamics", "dominant"],
    "sub": ["dynamics", "submissive"],
    "switch": ["dynamics", "switch"],
    "open to discuss": ["dynamics", "would rather talk about it than pick from a list"],
    "light bondage": ["practices", "bondage"],
    "roleplay": ["practices", "roleplay"],
    "exhibitionism": ["practices", "exhibitionism"],
    "voyeurism": ["practices", "voyeurism"],
    "toys": ["practices", "toys"],
  };
  assertEquals(Object.keys(V1_KINK_MAP).sort(), Object.keys(expected).sort());
  for (const [kink, [section, label]] of Object.entries(expected)) {
    const { payload, report } = mapCardV1(v1Card({ kinks: [kink] }));
    assertEquals((payload as unknown as Record<string, string[]>)[section], [label], kink);
    assertEquals(report.removed, [], kink);
  }
});

Deno.test("B1 kinks: a mixed list splits into dynamics and practices, order kept", () => {
  const { payload } = mapCardV1(
    v1Card({ kinks: ["dom", "light bondage", "vanilla", "toys", "open to discuss"] }),
  );
  assertEquals(payload.dynamics, [
    "dominant",
    "vanilla",
    "would rather talk about it than pick from a list",
  ]);
  assertEquals(payload.practices, ["bondage", "toys"]);
});

Deno.test("B1 kinks: a prototype key is just an unknown value", () => {
  const { payload, report } = mapCardV1(v1Card({ kinks: ["constructor", "__proto__"] }));
  assertEquals(payload.dynamics, []);
  assertEquals(payload.practices, []);
  assertEquals(report.removed, ["kinks"]);
});

Deno.test("B1 kinks: an unknown value is removed", () => {
  const { payload, report } = mapCardV1(v1Card({ kinks: ["tickle fights", "sub"] }));
  assertEquals(payload.dynamics, ["submissive"]);
  assertEquals(report.removed, ["kinks"]);
});

Deno.test("B1 hard_nos: the three v1 fixed chips map exactly", () => {
  const chips = ["no pics unasked", "no substances", "nothing off campus"];
  const { payload, report } = mapCardV1(v1Card({ hard_nos: chips }));
  assertEquals(payload.hard_nos, chips);
  assertEquals(report, { moved: [], held_back: [], removed: [] });
});

Deno.test("B1 hard_nos: typed text fits (<=40 into <=60); a typed v2 chip becomes that chip", () => {
  const { payload } = mapCardV1(
    v1Card({ hard_nos: ["no loud music after 10", "No Calls", "no   early   mornings"] }),
  );
  assertEquals(payload.hard_nos, [
    "no loud music after 10",
    "no calls",
    "no early mornings",
  ]);
});

Deno.test("B1 hard_nos: typed entries past v2's cap of five are held back", () => {
  const { payload, report } = mapCardV1(
    v1Card({ hard_nos: ["no pics unasked", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] }),
  );
  assertEquals(payload.hard_nos, ["no pics unasked", "a1", "a2", "a3", "a4", "a5"]);
  assertEquals(report.held_back, ["hard_nos"]);
});

Deno.test("mapCardV1: v2-only sections start empty", () => {
  const { payload } = mapCardV1(v1Card({ kinks: ["vanilla"] }));
  assertEquals(payload.shows_interest, []);
  assertEquals(payload.pace, null);
  assertEquals(payload.living_situation, null);
  assertEquals(payload.hosting, null);
  assertEquals(payload.privacy, []);
});

// ---------------------------------------------------------------------------
// Reading either version, shape-only readers, reports
// ---------------------------------------------------------------------------

Deno.test("identityFromStored/cardFromStored: v1 rows are mapped on read, v2 read as is", () => {
  assertEquals(
    identityFromStored(1, { pronouns: "she/her", orientation: ["bi"] }).pronouns,
    ["she/her"],
  );
  assertEquals(identityFromStored(2, { pronouns: ["she/her", "ey/em"] }).pronouns, [
    "she/her",
    "ey/em",
  ]);
  const card = cardFromStored(1, v1Card({ into: ["men"], kinks: ["dom"] }));
  assertEquals(card.dynamics, ["dominant"]);
  // `into` is not part of the v2 card.
  assertEquals(Object.hasOwn(card, "into"), false);
  assertEquals(cardFromStored(2, { pace: "slow" }).pace, "slow");
});

Deno.test("v1 readers are shape-only and never throw", () => {
  assertEquals(readIdentityV1(null), { pronouns: null, orientation: [] });
  assertEquals(readIdentityV1({ pronouns: "", orientation: "bi" }), {
    pronouns: null,
    orientation: [],
  });
  assertEquals(readCardV1("nonsense"), v1Card());
  assertEquals(readCardV1({ into: [1, "men"] }).into, ["men"]);
});

Deno.test("mergeReports de-duplicates field names per list", () => {
  assertEquals(
    mergeReports(
      { moved: ["interested_in"], held_back: [], removed: ["kinks"] },
      { moved: [], held_back: ["pronouns"], removed: ["kinks", "into"] },
    ),
    { moved: ["interested_in"], held_back: ["pronouns"], removed: ["kinks", "into"] },
  );
});
