#!/usr/bin/env node
// Validates supabase/seed/demo/cast.json and interactions.json against the
// schema limits in supabase/migrations/20260918000002_core_schema.sql, the
// profile fields of 0015, the tags / about / word filter of 0018 (whose tag
// catalog and CLC programs are read from the migration file itself), the CLC
// program list of 0019 (read from that migration file too), and
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

// The tag catalog (migration 0018 §4): 411 global interest tags, one line per
// category, labels separated by " · ", a "(commuter)" / "(residential)" suffix
// marking the campus type. Parsed from the migration itself so a label that is
// not in the migration's catalog always fails. CLC is a commuter campus, so the
// residential tags are not offered to demo users.
const MIGRATION_0018 = join(__dirname, "..", "..", "migrations", "20260918000018_tags_and_about.sql");
const CAMPUS_TYPE = "commuter"; // CLC (migration 0018 §2)
const TAG_CATALOG = new Map(); // label -> { category, campusType }
{
  const sql = readFileSync(MIGRATION_0018, "utf8");
  const start = sql.indexOf("insert into public.tags (campus_id, label, category, category_new, campus_type, sort_order)");
  const end = sql.indexOf(") as src(category, items)", start);
  if (start < 0 || end < 0) throw new Error("validate: could not find the tag catalog in migration 0018 §4");
  const block = sql.slice(start, end);
  const lineRe = /^\s*\('([a-z_]+)', '((?:[^']|'')*)'\),?\s*$/gm;
  let m;
  while ((m = lineRe.exec(block))) {
    for (const rawItem of m[2].replace(/''/g, "'").split(" · ")) {
      const suffix = rawItem.match(/ \((commuter|residential)\)$/);
      const label = suffix ? rawItem.slice(0, -suffix[0].length) : rawItem;
      if (TAG_CATALOG.has(label)) throw new Error(`validate: tag "${label}" appears twice in the 0018 catalog`);
      TAG_CATALOG.set(label, { category: m[1], campusType: suffix ? suffix[1] : "all" });
    }
  }
  if (TAG_CATALOG.size !== 411) throw new Error(`validate: parsed ${TAG_CATALOG.size} tags from migration 0018, expected 411`);
}

// public.programs for CLC: the major/minor catalog. Migration 0018 §5 seeded
// nine; migration 0019 §1 made CLC's list the 50 of private.default_programs()
// (the nine included). Both are read from the migration files: 0018's nine
// must match the list below and be part of 0019's list, and PROGRAMS is
// 0019's list.
const MIGRATION_0019 = join(__dirname, "..", "..", "migrations", "20260918000019_more_programs.sql");
const PROGRAMS_0018 = new Set([
  "art", "bio", "business", "criminal justice", "cs",
  "early childhood education", "education", "nursing", "welding",
]);
{
  const sql = readFileSync(MIGRATION_0018, "utf8");
  const start = sql.indexOf("insert into public.programs (campus_id, label, sort_order)");
  const end = sql.indexOf(") as v(label, sort_order)", start);
  if (start < 0 || end < 0) throw new Error("validate: could not find the CLC programs in migration 0018 §5");
  const found = new Set([...sql.slice(start, end).matchAll(/\('([a-z ]+)', \d+\)/g)].map((x) => x[1]));
  if (found.size !== PROGRAMS_0018.size || [...PROGRAMS_0018].some((p) => !found.has(p))) {
    throw new Error(`validate: the CLC programs in migration 0018 §5 (${[...found].join(", ")}) differ from validate.mjs`);
  }
}
const PROGRAMS = new Set();
{
  const sql = readFileSync(MIGRATION_0019, "utf8");
  const start = sql.indexOf("create function private.default_programs()");
  const end = sql.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error("validate: could not find private.default_programs() in migration 0019 §1");
  const body = sql.slice(start, end);
  const arr = body.slice(body.indexOf("unnest(array["), body.indexOf("]) with ordinality"));
  for (const m of arr.matchAll(/'([a-z ]+)'/g)) {
    if (PROGRAMS.has(m[1])) throw new Error(`validate: program "${m[1]}" appears twice in migration 0019`);
    PROGRAMS.add(m[1]);
  }
  const tail = body.match(/union all\s+select '([a-z ]+)', \d+::smallint/);
  if (!tail) throw new Error("validate: could not find the last default program (undecided) in migration 0019 §1");
  PROGRAMS.add(tail[1]);
  if (PROGRAMS.size !== 50) throw new Error(`validate: parsed ${PROGRAMS.size} programs from migration 0019, expected 50`);
  const missing = [...PROGRAMS_0018].filter((p) => !PROGRAMS.has(p));
  if (missing.length) throw new Error(`validate: migration 0019 drops 0018 programs: ${missing.join(", ")}`);
}

// Migration 0018 §1 enums.
const GRADUATING_TERMS = new Set(["spring", "summer", "fall", "winter"]);
const WORK_TYPES = new Set([
  "food_service", "retail", "warehouse", "delivery", "healthcare_aide",
  "childcare", "tutoring", "landscaping", "construction", "trades_apprentice",
  "office_or_admin", "customer_service", "security", "campus_job",
  "internship", "family_business", "freelance", "military_or_reserves",
  "rideshare", "not_working_right_now", "rather_not_say",
]);
const WORK_HOURS = ["part_time", "full_time", "nights", "weekends", "seasonal", "on_call"]; // enum order
const ABOUT_KEYS = new Set(["minor", "graduating_term", "graduating_unsure", "work_type", "job_title", "work_hours"]);

// The word filter's contact patterns (migration 0018 §7, private.blocked_terms,
// match_kind 'pattern', run on the lowercased text) and its core slur list.
const CONTACT_PATTERNS = [
  ["a 10-digit phone number", /(^|[^0-9])(\+?1[ .-]?)?\(?[2-9][0-9]{2}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}([^0-9]|$)/],
  ["an email address", /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/],
  ["a link", /(https?:\/\/|www\.)[a-z0-9]/],
  ["a bare web address", /(^|[^a-z0-9@._-])[a-z0-9-]+\.(com|net|org|io|me|co|app|gg|tv|ly|xyz|link|bio|us|info|biz|site|online)([^a-z0-9]|$)/],
  ["a social handle", /(^|[^a-z])(ig|insta|instagram|snap|snapchat|tiktok|twitter|discord|telegram|whatsapp|kik|venmo|cashapp|onlyfans) *[:@] *@?[a-z0-9_.]{2,}/],
  ["an @handle", /(^|[^a-z0-9_.])@([a-z][a-z0-9]*[_.][a-z0-9_.]*[a-z0-9]|[a-z]+[0-9]{2,})/],
];
// The migration 0018 core slur list, base64-encoded so the repo holds none of
// them in plain text (same encodings as the migration and
// docs/design/tags-about/blocked-terms-proposed.md).
const SLURS = [
  "bmlnZ2Vy", "bmlnZ2E=", "ZmFnZ290", "a2lrZQ==", "d2V0YmFjaw==", "Z29vaw==", "cmFnaGVhZA==",
  "dG93ZWxoZWFk", "emlwcGVyaGVhZA==", "c2hlbWFsZQ==", "cG9yY2ggbW9ua2V5", "anVuZ2xlIGJ1bm55",
].map((b) => Buffer.from(b, "base64").toString("utf8"));
function dirtyReason(text) {
  const t = String(text).toLowerCase();
  for (const [what, re] of CONTACT_PATTERNS) if (re.test(t)) return what;
  const words = " " + t.replace(/[^a-z]+/g, " ").trim() + " ";
  for (const s of SLURS) if (words.includes(` ${s} `) || words.includes(` ${s}s `)) return "a blocked word";
  return null;
}

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

  if (person.grad_year !== null && (!Number.isInteger(person.grad_year) || person.grad_year < 2026 || person.grad_year > 2034)) {
    warn(`${tag}: grad_year ${person.grad_year} must be null or 2026-2034`);
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

  // Tags (migration 0018): 3-10 interests from the global catalog, in the
  // order picked (the first two show on the grid tile), none residential.
  if (!Array.isArray(person.tags) || person.tags.length < 3 || person.tags.length > 10) {
    warn(`${tag}: tags must have 3-10 entries`);
  } else {
    for (const t of person.tags) {
      const entry = TAG_CATALOG.get(t);
      if (!entry) warn(`${tag}: tag "${t}" not in the migration 0018 catalog`);
      else if (entry.campusType !== "all" && entry.campusType !== CAMPUS_TYPE) {
        warn(`${tag}: tag "${t}" is ${entry.campusType}-only; CLC is ${CAMPUS_TYPE}`);
      }
    }
    if (new Set(person.tags).size !== person.tags.length) {
      warn(`${tag}: duplicate tags`);
    }
  }

  // Major and the about section (migration 0018 §5, §6, §15).
  if (person.major !== undefined && person.major !== null && !PROGRAMS.has(person.major)) {
    warn(`${tag}: major "${person.major}" is not a CLC program`);
  }
  const about = person.about;
  if (about !== undefined && about !== null) {
    if (typeof about !== "object" || Array.isArray(about)) {
      warn(`${tag}: about must be an object`);
    } else {
      for (const k of Object.keys(about)) if (!ABOUT_KEYS.has(k)) warn(`${tag}: about has unknown key "${k}"`);
      if (about.minor !== undefined && about.minor !== null) {
        if (!PROGRAMS.has(about.minor)) warn(`${tag}: minor "${about.minor}" is not a CLC program`);
        if (!person.major) warn(`${tag}: a minor needs a major`);
        if (about.minor === person.major) warn(`${tag}: the minor must differ from the major`);
      }
      if (about.graduating_term !== undefined && about.graduating_term !== null) {
        if (!GRADUATING_TERMS.has(about.graduating_term)) warn(`${tag}: graduating_term "${about.graduating_term}" is not spring/summer/fall/winter`);
        if (person.grad_year === null) warn(`${tag}: a graduating term needs a grad_year`);
      }
      if (about.graduating_unsure !== undefined && typeof about.graduating_unsure !== "boolean") {
        warn(`${tag}: graduating_unsure must be true or false`);
      }
      if (about.graduating_unsure === true) {
        if (person.grad_year !== null) warn(`${tag}: graduating_unsure needs grad_year null`);
        if (about.graduating_term !== undefined && about.graduating_term !== null) warn(`${tag}: graduating_unsure can't have a term`);
      }
      if (about.work_type !== undefined && about.work_type !== null && !WORK_TYPES.has(about.work_type)) {
        warn(`${tag}: work_type "${about.work_type}" is not in the work_type enum`);
      }
      if (about.job_title !== undefined && about.job_title !== null) {
        if (blank(about.job_title) || about.job_title.length > 48) warn(`${tag}: job_title must be 1-48 chars`);
        else if (about.job_title !== about.job_title.toLowerCase()) warn(`${tag}: job_title should be lowercase`);
      }
      if (about.work_hours !== undefined && about.work_hours !== null) {
        const wh = about.work_hours;
        if (!Array.isArray(wh) || wh.length < 1 || wh.length > 3) {
          warn(`${tag}: work_hours must be null or 1-3 values`);
        } else {
          for (const h of wh) if (!WORK_HOURS.includes(h)) warn(`${tag}: work_hours value "${h}" is not in the work_hours enum`);
          if (new Set(wh).size !== wh.length) warn(`${tag}: work_hours must not repeat`);
          if (wh.includes("part_time") && wh.includes("full_time")) warn(`${tag}: work_hours can't have both part_time and full_time`);
          const sorted = [...wh].sort((a, b) => WORK_HOURS.indexOf(a) - WORK_HOURS.indexOf(b));
          if (sorted.join() !== wh.join()) warn(`${tag}: work_hours must be in enum order (${WORK_HOURS.join(", ")})`);
          if (about.work_type === "not_working_right_now") warn(`${tag}: work_hours need a job (work_type is not_working_right_now)`);
        }
      }
    }
  } else if (person.grad_year === null) {
    // grad_year null without graduating_unsure is allowed by the schema; flag it
    // so a missing year is a choice, not an accident.
    warn(`${tag}: grad_year is null but about.graduating_unsure is not set`);
  }
  // The word filter (migration 0018 §7) on every free-text profile field.
  const texts = [
    ["status_line", person.status_line],
    ["place_line", person.place_line],
    ...(person.usual_places ?? []).map((x) => ["usual place", x]),
    ...(person.prompts ?? []).map((x) => [`prompt ${x?.prompt_id}`, x?.answer]),
    ["job_title", about?.job_title],
  ];
  for (const [field, text] of texts) {
    if (typeof text !== "string") continue;
    const why = dirtyReason(text);
    if (why) warn(`${tag}: ${field} "${text}" would be refused by the word filter (${why})`);
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

const unsureCount = cast.filter((p) => p.about?.graduating_unsure === true).length;
if (unsureCount > 1) warn(`cast: graduating_unsure is set for ${unsureCount} people (at most one)`);

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
