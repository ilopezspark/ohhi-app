#!/usr/bin/env node
// Validates supabase/seed/demo/cast.json and interactions.json against the
// schema limits in supabase/migrations/20260918000002_core_schema.sql and
// the scripted-state rules from the seed task. Run with:
//   node supabase/seed/demo/validate.mjs
// Exits non-zero on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const cast = JSON.parse(readFileSync(join(__dirname, "cast.json"), "utf8"));
const interactions = JSON.parse(
  readFileSync(join(__dirname, "interactions.json"), "utf8")
);

const errors = [];
const warn = (msg) => errors.push(msg);

// -----------------------------------------------------------------------
// Constants mirrored from the migration
// -----------------------------------------------------------------------

const TAG_LABELS = new Set([
  "nursing", "cs", "business", "bio",
  "library", "gym",
  "coffee", "soccer", "art", "esports", "transfer", "night classes",
]);

const GOALS = new Set(["friends", "study", "dates", "group", "whatever"]);

// public.prompts ids seeded by migration 0015 (20260918000015_profile_fields.sql).
const PROMPT_IDS = new Set([
  "ruining_my_life", "find_me_on_campus", "secret_study_spot", "last_googled", "take_again",
  "cafe_order", "unpopular_opinion", "on_repeat", "late_excuse", "ask_me_about", "after_this",
]);

const PRESENCE_PROFILES = new Set([
  "regular_on_campus", "commuter_nearby", "mostly_away", "night_owl", "rarely_active",
]);

const NOW = new Date("2026-09-28T00:00:00Z");

function ageAt(dobStr, at) {
  const dob = new Date(dobStr + "T00:00:00Z");
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

// -----------------------------------------------------------------------
// cast.json
// -----------------------------------------------------------------------

if (!Array.isArray(cast) || cast.length !== 30) {
  warn(`cast.json: expected an array of 30 people, got ${cast.length}`);
}

const castKeys = new Set();
let totalMainPhotos = 0;
let totalExtraPhotos = 0;

for (const person of cast) {
  const tag = `cast[${person.key}]`;

  if (castKeys.has(person.key)) warn(`${tag}: duplicate key`);
  castKeys.add(person.key);

  if (
    typeof person.first_name !== "string" ||
    person.first_name.length < 2 ||
    person.first_name.length > 20
  ) {
    warn(`${tag}: first_name "${person.first_name}" must be 2-20 chars`);
  }

  if (!/^[a-z0-9._-]+$/.test(person.email_local || "")) {
    warn(`${tag}: email_local "${person.email_local}" looks malformed`);
  }

  const age = ageAt(person.date_of_birth, NOW);
  if (age < 18) warn(`${tag}: age ${age} is under 18 (dob ${person.date_of_birth})`);
  if (age > 36) warn(`${tag}: age ${age} is over the requested 18-36 range`);

  if (person.grad_year < 2026 || person.grad_year > 2029) {
    warn(`${tag}: grad_year ${person.grad_year} out of range 2026-2029`);
  }

  if (
    person.status_line !== null &&
    (typeof person.status_line !== "string" || person.status_line.length > 140)
  ) {
    warn(`${tag}: status_line exceeds 140 chars or is not null/string`);
  }

  // Migration 0015 profile fields (all optional; same limits the RPCs enforce).
  const blank = (s) => typeof s !== "string" || s.trim() === "";
  if (
    person.place_line !== undefined && person.place_line !== null &&
    (blank(person.place_line) || person.place_line.length > 40)
  ) {
    warn(`${tag}: place_line must be null or 1-40 chars`);
  }
  if (person.usual_places !== undefined) {
    const up = person.usual_places;
    if (!Array.isArray(up) || up.length > 3) {
      warn(`${tag}: usual_places must have 0-3 entries`);
    } else {
      for (const x of up) if (blank(x) || x.length > 30) warn(`${tag}: usual place "${x}" must be 1-30 chars`);
      if (new Set(up.map((x) => String(x).trim().toLowerCase())).size !== up.length) warn(`${tag}: duplicate usual places`);
    }
  }
  if (person.prompts !== undefined) {
    const pr = person.prompts;
    if (!Array.isArray(pr) || pr.length > 3) {
      warn(`${tag}: prompts must have 0-3 entries`);
    } else {
      for (const x of pr) {
        if (!x || !PROMPT_IDS.has(x.prompt_id)) warn(`${tag}: prompt_id "${x?.prompt_id}" not in the 0015 prompt list`);
        if (blank(x?.answer) || x.answer.length > 140) warn(`${tag}: answer to "${x?.prompt_id}" must be 1-140 chars`);
        if (x && Object.keys(x).some((k) => k !== "prompt_id" && k !== "answer")) warn(`${tag}: a prompt has keys other than prompt_id/answer`);
      }
      if (new Set(pr.map((x) => x?.prompt_id)).size !== pr.length) warn(`${tag}: a prompt is answered twice`);
    }
  }

  if (!Array.isArray(person.goals) || person.goals.length < 1 || person.goals.length > 3) {
    warn(`${tag}: goals must have 1-3 entries`);
  } else {
    for (const g of person.goals) {
      if (!GOALS.has(g)) warn(`${tag}: goal "${g}" not in user_goal enum`);
    }
    if (new Set(person.goals).size !== person.goals.length) {
      warn(`${tag}: duplicate goals`);
    }
  }

  if (!Array.isArray(person.tags) || person.tags.length > 3) {
    warn(`${tag}: tags must have 0-3 entries`);
  } else {
    for (const t of person.tags) {
      if (!TAG_LABELS.has(t)) warn(`${tag}: tag "${t}" not in CLC tag seed`);
    }
    if (new Set(person.tags).size !== person.tags.length) {
      warn(`${tag}: duplicate tags`);
    }
  }

  if (!PRESENCE_PROFILES.has(person.presence_profile)) {
    warn(`${tag}: presence_profile "${person.presence_profile}" not recognized`);
  }

  const extras = Array.isArray(person.extra_photo_prompts) ? person.extra_photo_prompts.length : -1;
  if (person.photo_count < 1 || person.photo_count > 3) {
    warn(`${tag}: photo_count ${person.photo_count} out of range 1-3`);
  }
  if (extras < 0 || extras > 2) {
    warn(`${tag}: extra_photo_prompts must have 0-2 entries`);
  }
  if (person.photo_count !== 1 + extras) {
    warn(`${tag}: photo_count (${person.photo_count}) != 1 main + ${extras} extra`);
  }

  if (!person.portrait_prompt || !/adult/i.test(person.portrait_prompt)) {
    warn(`${tag}: portrait_prompt must exist and mention "adult" explicitly`);
  }
  if (!/\b(1[89]|[2-3][0-9])[- ]year[- ]old\b/i.test(person.portrait_prompt || "")) {
    warn(`${tag}: portrait_prompt should state an explicit age in years`);
  }

  totalMainPhotos += 1;
  totalExtraPhotos += Math.max(extras, 0);
}

// -----------------------------------------------------------------------
// interactions.json
// -----------------------------------------------------------------------

let totalChatMediaImages = 0;
let totalAlbumImages = 0;
let totalMessages = 0;

for (const account of ["izaac", "debbie"]) {
  const data = interactions[account];
  const tag = `interactions.${account}`;
  if (!data) {
    warn(`${tag}: missing`);
    continue;
  }

  const usedKeys = new Set();
  const checkKey = (k, where) => {
    if (!castKeys.has(k)) warn(`${tag}.${where}: unknown cast key "${k}"`);
    usedKeys.add(k);
  };

  if (!Array.isArray(data.hi_received) || data.hi_received.length < 4 || data.hi_received.length > 5) {
    warn(`${tag}.hi_received: expected 4-5 entries, got ${data.hi_received?.length}`);
  }
  (data.hi_received || []).forEach((h) => checkKey(h.cast_key, "hi_received"));

  if (!Array.isArray(data.hi_sent) || data.hi_sent.length !== 2) {
    warn(`${tag}.hi_sent: expected exactly 2 entries, got ${data.hi_sent?.length}`);
  } else {
    const states = data.hi_sent.map((h) => h.state);
    if (!states.includes("sent")) warn(`${tag}.hi_sent: expected one entry still "sent"`);
    if (!states.some((s) => s === "dismissed" || s === "expired")) {
      warn(`${tag}.hi_sent: expected one entry "dismissed" or "expired"`);
    }
  }
  (data.hi_sent || []).forEach((h) => checkKey(h.cast_key, "hi_sent"));

  const convos = data.conversations || [];
  if (convos.length < 7 || convos.length > 9) {
    warn(`${tag}.conversations: expected 7-9 entries, got ${convos.length}`);
  }

  const statesSeen = new Set();
  let openWithUnreadTailFromOther = false;
  let awaitingMeOpened = false;
  let awaitingThemOpened = false;
  let hasHiBack = false;
  let hasExpired = false;
  let hasLongOpen = false;

  for (const convo of convos) {
    const ctag = `${tag}.conversations[${convo.cast_key}]`;
    checkKey(convo.cast_key, "conversations");
    statesSeen.add(convo.state);
    if (convo.opened_via === "hi_back") hasHiBack = true;
    if (convo.state === "expired") hasExpired = true;

    const msgs = convo.messages || [];
    totalMessages += msgs.length;

    if (msgs.length === 0) {
      warn(`${ctag}: has no messages`);
      continue;
    }

    // First message length <= 240 (opener's first message rule).
    if ((msgs[0].body || "").length > 240) {
      warn(`${ctag}: opener's first message exceeds 240 chars`);
    }
    for (const m of msgs) {
      if ((m.body || "").length > 1000) warn(`${ctag}: message exceeds 1000 chars`);
      if (m.from !== "me" && m.from !== convo.cast_key) {
        warn(`${ctag}: message "from" must be "me" or "${convo.cast_key}", got "${m.from}"`);
      }
      if (m.media) {
        totalChatMediaImages += 1;
        const { kind, view_limit, views_used } = m.media;
        if (kind !== "photo" && kind !== "video") warn(`${ctag}: media.kind invalid "${kind}"`);
        if (kind === "video") warn(`${ctag}: task requires photos only in the seed, found a video`);
        if (![null, 1, 2].includes(view_limit)) warn(`${ctag}: media.view_limit invalid "${view_limit}"`);
        const limit = view_limit === null ? 0 : view_limit;
        if (views_used < 0 || views_used > limit) {
          warn(`${ctag}: media.views_used ${views_used} out of bounds for view_limit ${view_limit}`);
        }
        if (!m.media.prompt) warn(`${ctag}: media missing a prompt`);
      }
    }

    if (convo.state === "awaiting_reply" || convo.state === "expired") {
      if (msgs.length !== 1) {
        warn(`${ctag}: ${convo.state} must have exactly one message, has ${msgs.length}`);
      } else {
        const opener = convo.opened_by === "me" ? "me" : convo.cast_key;
        if (msgs[0].from !== opener) {
          warn(`${ctag}: ${convo.state}'s single message must be from the opener ("${opener}")`);
        }
        if (convo.state === "awaiting_reply") {
          if (opener === "me") awaitingMeOpened = true;
          else awaitingThemOpened = true;
        }
      }
    }

    if (convo.state === "open") {
      const fromMe = msgs.some((m) => m.from === "me");
      const fromThem = msgs.some((m) => m.from === convo.cast_key);
      if (!fromMe || !fromThem) {
        warn(`${ctag}: open conversation should have replies from both sides`);
      }
      if (msgs.length >= 8) hasLongOpen = true;
      // detect an unread tail: trailing run of messages all from the other person
      let i = msgs.length - 1;
      let tail = 0;
      while (i >= 0 && msgs[i].from === convo.cast_key) {
        tail++;
        i--;
      }
      if (tail >= 1 && i >= 0) openWithUnreadTailFromOther = openWithUnreadTailFromOther || tail >= 1;
    }
  }

  if (!hasLongOpen) warn(`${tag}: no "open" conversation with a long (8+) message history`);
  if (!awaitingMeOpened) warn(`${tag}: no awaiting_reply conversation opened by me`);
  if (!awaitingThemOpened) warn(`${tag}: no awaiting_reply conversation opened by the other person`);
  if (!hasHiBack) warn(`${tag}: no conversation opened_via hi_back`);
  if (!hasExpired) warn(`${tag}: no expired conversation`);

  // albums
  const albums = data.albums || {};
  if (!Array.isArray(albums.shared_with_me) || albums.shared_with_me.length !== 2) {
    warn(`${tag}.albums.shared_with_me: expected exactly 2 entries`);
  }
  for (const a of albums.shared_with_me || []) {
    checkKey(a.owner, "albums.shared_with_me");
    if (!a.name || a.name.length > 60) warn(`${tag}.albums.shared_with_me: bad name "${a.name}"`);
    const n = (a.photo_prompts || []).length;
    if (n < 4 || n > 6) warn(`${tag}.albums.shared_with_me[${a.name}]: expected 4-6 photos, got ${n}`);
    totalAlbumImages += n;
  }

  if (!Array.isArray(albums.owned_by_me) || albums.owned_by_me.length !== 2) {
    warn(`${tag}.albums.owned_by_me: expected exactly 2 entries`);
  }
  let sharedOneOwned = false;
  for (const a of albums.owned_by_me || []) {
    if (!a.name || a.name.length > 60) warn(`${tag}.albums.owned_by_me: bad name "${a.name}"`);
    const n = (a.photo_prompts || []).length;
    if (n < 3 || n > 5) warn(`${tag}.albums.owned_by_me[${a.name}]: expected 3-5 photos, got ${n}`);
    totalAlbumImages += n;
    if (a.shared_to) {
      sharedOneOwned = true;
      checkKey(a.shared_to, "albums.owned_by_me.shared_to");
      if (!usedKeys.has(a.shared_to) || !convos.some((c) => c.cast_key === a.shared_to && c.state === "open")) {
        warn(`${tag}.albums.owned_by_me: shared_to "${a.shared_to}" is not an open conversation`);
      }
    }
  }
  if (!sharedOneOwned) warn(`${tag}.albums.owned_by_me: none of my albums is shared to a cast member`);

  // not_in_any_thread: must genuinely not appear anywhere else for this account
  for (const k of data.not_in_any_thread || []) {
    checkKey(k, "not_in_any_thread"); // also validates key exists
    const appearsElsewhere =
      (data.hi_received || []).some((h) => h.cast_key === k) ||
      (data.hi_sent || []).some((h) => h.cast_key === k) ||
      convos.some((c) => c.cast_key === k) ||
      (albums.shared_with_me || []).some((a) => a.owner === k) ||
      (albums.owned_by_me || []).some((a) => a.shared_to === k);
    if (appearsElsewhere) {
      warn(`${tag}.not_in_any_thread: "${k}" actually appears elsewhere`);
    }
  }
}

// -----------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------

const totalImages = totalMainPhotos + totalExtraPhotos + totalChatMediaImages + totalAlbumImages;

console.log("=== Demo seed validation ===");
console.log(`People: ${cast.length}`);
console.log(`Main portraits: ${totalMainPhotos}`);
console.log(`Extra cast photos: ${totalExtraPhotos}`);
console.log(`Chat media images (photos, across both accounts): ${totalChatMediaImages}`);
console.log(`Album photos (across both accounts): ${totalAlbumImages}`);
console.log(`Total images the prompts call for: ${totalImages}`);
console.log(`Total scripted messages (both accounts): ${totalMessages}`);
console.log("");

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(" - " + e);
  process.exit(1);
} else {
  console.log("PASSED: no issues found");
}
