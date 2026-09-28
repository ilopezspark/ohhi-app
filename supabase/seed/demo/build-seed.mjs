#!/usr/bin/env node
// Demo seed generator for the hosted OhHi project (CLC / Sayohhi).
//
//   node supabase/seed/demo/build-seed.mjs
//
// Reads cast.json, interactions.json and images/manifest.json (optional: a
// missing manifest is a warning, not an error) and writes, next to itself:
//
//   seed.generated.sql       the seed: 30 demo users on demo.sayohhi.com plus
//                            the scripted hi's, conversations, chat media,
//                            albums and shares for the two real accounts, the
//                            private.demo_heartbeat() liveness function and its
//                            pg_cron job. Idempotent: re-running changes nothing.
//   unseed.generated.sql     removes every row the seed wrote, the job, the
//                            functions and the campus domain, and enqueues the
//                            storage objects for purge-drain.
//   rehearsal.generated.sql  seed twice, assertions, unseed twice, baseline
//                            comparison, then a raise so nothing persists. Run
//                            it with apply_migration (name tmp_demo_rehearsal).
//   upload-plan.json         one entry per image: local file, bucket, object path.
//
// Every seeded row id is a UUID v5 of a fixed namespace and a content key, so
// the seed, the unseed and the upload plan agree without a tracking table.
// The two real accounts are never named by id here: the SQL resolves them at
// run time by first name and a non-demo email domain, and raises (rolling the
// whole seed back) if either is missing or ambiguous.
//
// No dependencies beyond the Node standard library.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

// -----------------------------------------------------------------------------
// Fixed constants. Changing NAMESPACE changes every id: never do that while a
// seed is applied (the unseed would no longer find the rows).
// -----------------------------------------------------------------------------

const NAMESPACE = "d3e0c5a1-7b2f-4c6e-9a8d-1f5b3c7e9a20";
const DEMO_DOMAIN = "demo.sayohhi.com";
const CAMPUS_SLUG = "clc";
const JOB_NAME = "demo-heartbeat";
const ACCOUNTS = [
  { key: "izaac", firstName: "Izaac" },
  { key: "debbie", firstName: "Debbie" },
];
// app/src/theme/tokens.ts colors.avatarTints, in order (the nine curated tones).
const AVATAR_TINTS = [
  "#E8C9B4", "#C9D6E3", "#D5E0CB", "#EBD5B0", "#D9B79C",
  "#DAE5D2", "#D3DDE8", "#EFD6CB", "#F0E3C6",
];
const EXPIRED_HI_MIN_MINUTES = 7 * 24 * 60 + 60; // an expired hi must be > 7 days old
const UNREAD_WINDOW_MINUTES = 60;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function uuidv5(name, namespace = NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const id = (...parts) => uuidv5(parts.join(":"));

// Mirrors app/src/photos/tint.ts (FNV-1a over `${userId}:${position}`).
function tintForPhoto(userId, position) {
  let hash = 0x811c9dc5;
  const seed = `${userId}:${position}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TINTS[(hash >>> 0) % AVATAR_TINTS.length];
}

function smallHash(s) {
  return createHash("md5").update(s).digest().readUInt32BE(0);
}

const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const u = (s) => `'${s}'::uuid`;
const ago = (minutes) => `(v_now - make_interval(mins => ${Math.round(minutes)}))`;

// JPEG width/height from the first SOF marker; null when unreadable.
function jpegSize(file) {
  try {
    const buf = readFileSync(file);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const warnings = [];
const warn = (m) => {
  warnings.push(m);
  console.warn("warning: " + m);
};
const adjustments = []; // content the schema could not represent as written
const adjust = (m) => adjustments.push(m);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

const cast = JSON.parse(readFileSync(join(HERE, "cast.json"), "utf8"));
const interactions = JSON.parse(readFileSync(join(HERE, "interactions.json"), "utf8"));

const manifestPath = join(HERE, "images", "manifest.json");
const manifestNames = new Map(); // name -> relative file (from images/)
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entries = Array.isArray(manifest)
    ? manifest
    : Array.isArray(manifest.images)
      ? manifest.images
      : Object.entries(manifest).map(([k, v]) => (typeof v === "object" ? { name: k, ...v } : { name: k, file: v }));
  for (const e of entries) {
    const name = e.name ?? e.key ?? e.id;
    if (!name) continue;
    manifestNames.set(String(name).replace(/\.jpg$/, ""), e.file ?? e.path ?? `${name}.jpg`);
  }
  console.log(`manifest: ${manifestNames.size} entries`);
} else {
  warn("images/manifest.json not found; deriving file names from the naming convention (<group>/<name>.jpg)");
}

function imageFile(name) {
  // name is "<group>/<name>", e.g. "cast/maya-0"
  let rel = `${name}.jpg`;
  if (manifestNames.size) {
    const hit = manifestNames.get(name) ?? manifestNames.get(name.split("/")[1]);
    if (hit) rel = hit.includes("/") ? hit : `${name.split("/")[0]}/${hit}`;
    else warn(`manifest has no entry for ${name}; using ${rel}`);
  }
  const abs = join(HERE, "images", rel);
  return { rel: relative(REPO, abs).replace(/\\/g, "/"), abs, exists: existsSync(abs) };
}

// -----------------------------------------------------------------------------
// Model
// -----------------------------------------------------------------------------

const castByKey = new Map(cast.map((p) => [p.key, p]));
if (cast.length !== 30) throw new Error(`cast.json: expected 30 people, found ${cast.length}`);

const people = cast.map((p) => {
  const uid = id("user", p.key);
  return {
    ...p,
    uid,
    email: `${p.email_local}@${DEMO_DOMAIN}`,
    createdDaysAgo: 10 + (smallHash(`created:${p.key}`) % 35),
    photos: Array.from({ length: p.photo_count }, (_, pos) => ({
      id: id("user_photo", p.key, pos),
      position: pos,
      path: `${uid}/${pos}.jpg`,
      tint: tintForPhoto(uid, pos),
      image: `cast/${p.key}-${pos}`,
    })),
  };
});
const personByKey = new Map(people.map((p) => [p.key, p]));
const demo = (key) => {
  const p = personByKey.get(key);
  if (!p) throw new Error(`unknown cast key ${key}`);
  return p;
};

const uploads = [];
for (const p of people) {
  for (const ph of p.photos) {
    const f = imageFile(ph.image);
    uploads.push({ name: ph.image, file: f.rel, exists: f.exists, bucket: "profile-photos", path: ph.path, contentType: "image/jpeg" });
  }
}

const accounts = [];
const seeded = { his: [], conversations: [], messages: [], albums: [], albumPhotos: [], shares: [], mediaViews: [] };
const keepAlive = { his: [], conversations: [] }; // re-anchored by the heartbeat

for (const acct of ACCOUNTS) {
  const data = interactions[acct.key];
  if (!data) throw new Error(`interactions.json: missing ${acct.key}`);
  const A = { ...acct, var: `v_${acct.key}`, his: [], conversations: [], albums: [], shares: [], expect: {} };

  const pairUsed = new Map(); // cast key -> what
  const claim = (k, what) => {
    if (pairUsed.has(k)) throw new Error(`${acct.key}: ${k} appears as both ${pairUsed.get(k)} and ${what}`);
    pairUsed.set(k, what);
  };

  // --- hi's received (cast -> real) ---
  for (const h of data.hi_received) {
    claim(h.cast_key, "hi_received");
    const hid = id("hi", acct.key, "received", h.cast_key);
    A.his.push({ id: hid, from: demo(h.cast_key).uid, to: null, state: h.state, minutes: h.minutes_ago, dir: "received", cast: h.cast_key });
  }
  // --- hi's sent (real -> cast) ---
  for (const h of data.hi_sent) {
    claim(h.cast_key, "hi_sent");
    const hid = id("hi", acct.key, "sent", h.cast_key);
    let minutes = h.minutes_ago;
    if (h.state === "expired" && minutes < EXPIRED_HI_MIN_MINUTES) {
      adjust(`${acct.key}.hi_sent[${h.cast_key}] is "expired" at ${minutes} minutes old, but a hi only expires 7 days after it is sent (enforce_hi_rules stamps expires_at = created_at + 7 days); seeded ${EXPIRED_HI_MIN_MINUTES} minutes old instead.`);
      minutes = EXPIRED_HI_MIN_MINUTES;
    }
    if (!["sent", "expired", "dismissed"].includes(h.state)) throw new Error(`${acct.key}: unsupported hi_sent state ${h.state}`);
    A.his.push({ id: hid, from: null, to: demo(h.cast_key).uid, state: h.state, minutes, dir: "sent", cast: h.cast_key });
  }

  // --- conversations ---
  data.conversations.forEach((c, ci) => {
    claim(c.cast_key, "conversation");
    const other = demo(c.cast_key);
    const cid = id("conversation", acct.key, c.cast_key);
    const msgs = c.messages;
    let openerIsMe = c.opened_by === "me";
    if (c.opened_via === "hi_back") {
      // hi_back(): the original hi sender is the opener (opened_by_id) and must
      // speak first. The script's "wei/brandon said hi first, I hi'd back"
      // means the cast member sent the hi, so the cast member is the opener.
      if (openerIsMe) {
        adjust(`${acct.key}.conversations[${c.cast_key}] is opened_via "hi_back" with opened_by "me", but hi_back() makes the original hi sender (${c.cast_key}) the conversation's opened_by_id; seeded with ${c.cast_key} as opener and an answered hi ${c.cast_key} -> ${acct.key}.`);
      }
      openerIsMe = false;
    }
    const openerKey = openerIsMe ? "me" : c.cast_key;
    if (msgs[0].from !== openerKey) throw new Error(`${acct.key}/${c.cast_key}: first message must come from the opener`);
    if (["awaiting_reply", "expired"].includes(c.state) && msgs.length !== 1) throw new Error(`${acct.key}/${c.cast_key}: ${c.state} needs exactly one message`);
    if (c.state === "open" && !msgs.some((m) => m.from !== openerKey)) throw new Error(`${acct.key}/${c.cast_key}: open needs a reply`);
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].minutes_ago >= msgs[i - 1].minutes_ago) throw new Error(`${acct.key}/${c.cast_key}: messages must be strictly chronological`);
    }
    if (c.state === "expired" && msgs[0].minutes_ago < 7 * 24 * 60) throw new Error(`${acct.key}/${c.cast_key}: expired must be older than 7 days`);

    const firstMin = msgs[0].minutes_ago;
    const convCreatedMin = c.opened_via === "hi_back" ? firstMin + 30 : firstMin + 1;
    let hiBack = null;
    if (c.opened_via === "hi_back") {
      hiBack = { id: id("hi", acct.key, "hi_back", c.cast_key), from: other.uid, to: null, state: "answered", minutes: firstMin + 90, dir: "received", cast: c.cast_key };
      A.his.push(hiBack);
    }

    const messages = msgs.map((m, mi) => {
      const mid = id("message", acct.key, c.cast_key, mi);
      const fromMe = m.from === "me";
      const msg = { id: mid, idx: mi, fromMe, body: m.body, minutes: m.minutes_ago, media: null };
      if (m.media) {
        if (m.media.kind !== "photo") throw new Error("only photos are seeded");
        const limited = m.media.view_limit !== null;
        const bucket = limited ? "chat-media-limited" : "chat-media";
        const path = `${cid}/${mid}.jpg`;
        const name = `chat/${acct.key}-${ci}-${mi}`;
        const f = imageFile(name);
        const size = f.exists ? jpegSize(f.abs) : null;
        const exhausted = limited && m.media.views_used >= m.media.view_limit;
        msg.media = {
          bucket, path, viewLimit: m.media.view_limit, viewsUsed: m.media.views_used, exhausted,
          width: size?.width ?? null, height: size?.height ?? null, bytes: f.exists ? statSync(f.abs).size : null,
        };
        if (exhausted) {
          adjust(`${acct.key}.conversations[${c.cast_key}] message ${mi}: view_limit ${m.media.view_limit} with views_used ${m.media.views_used} is exhausted; decision 62 deletes exhausted media from storage, so ${name}.jpg is not uploaded (the bubble renders as "Opened").`);
          uploads.push({ name, file: f.rel, exists: f.exists, bucket, path, contentType: "image/jpeg", skip: "exhausted view-limited media is deleted on its last view (decision 62)" });
        } else {
          uploads.push({ name, file: f.rel, exists: f.exists, bucket, path, contentType: "image/jpeg" });
        }
        // Views are counted opens by the recipient.
        for (let o = 1; o <= m.media.views_used; o++) {
          msg.media.views = msg.media.views || [];
          msg.media.views.push({ ordinal: o, viewerIsMe: !fromMe, minutes: Math.max(1, m.minutes_ago - 3 * o) });
        }
      }
      return msg;
    });

    // Unread for the real account: the thread's last message is from the other
    // person, and (the note says so, or it is under an hour old, or it is an
    // unanswered request from them). Otherwise read up to the last message.
    const last = messages[messages.length - 1];
    const noteUnread = /unread/i.test(c.note || "");
    let unread = false;
    let readUpTo = last.minutes; // minutes-ago of last_read_at, or null for no row
    if (!last.fromMe) {
      if (c.state === "awaiting_reply" && !openerIsMe) {
        unread = true;
        readUpTo = null;
      } else if (noteUnread || last.minutes < UNREAD_WINDOW_MINUTES) {
        unread = true;
        const mine = messages.filter((m) => m.fromMe);
        readUpTo = mine.length ? mine[mine.length - 1].minutes : null;
      }
    }

    const firstReply = messages.find((m) => (openerIsMe ? !m.fromMe : m.fromMe));
    A.conversations.push({
      id: cid, idx: ci, cast: c.cast_key, other: other.uid, openerIsMe, via: c.opened_via, state: c.state,
      createdMin: convCreatedMin, messages, unread, readUpTo, hiBack,
      mutualSinceMin: firstReply ? firstReply.minutes : null,
      lastMin: last.minutes,
    });
    if (c.state === "awaiting_reply") {
      keepAlive.conversations.push({ id: cid, message: messages[0].id, minutes: messages[0].minutes, created: convCreatedMin });
    }
  });

  // --- albums (album index runs over shared_with_me then owned_by_me) ---
  const albumList = [
    ...data.albums.shared_with_me.map((a) => ({ ...a, kind: "shared_with_me" })),
    ...data.albums.owned_by_me.map((a) => ({ ...a, kind: "owned_by_me" })),
  ];
  albumList.forEach((a, ai) => {
    const ownerIsMe = a.kind === "owned_by_me";
    const ownerKey = ownerIsMe ? null : a.owner;
    const viewerKey = ownerIsMe ? a.shared_to : null;
    const aid = id("album", acct.key, a.kind, ownerIsMe ? "me" : a.owner, a.name);
    const partner = ownerKey ?? viewerKey;
    let shareMin = null;
    if (partner) {
      const conv = A.conversations.find((c) => c.cast === partner);
      if (!conv || conv.state !== "open" || conv.mutualSinceMin === null) {
        throw new Error(`${acct.key}: album "${a.name}" is shared with ${partner} but there is no mutual open conversation (enforce_share_rules)`);
      }
      shareMin = Math.max(1, Math.round(conv.mutualSinceMin - (conv.mutualSinceMin - conv.lastMin) / 2));
    }
    const createdMin = (shareMin ?? 1440) + 2880;
    const photos = a.photo_prompts.map((_, pi) => {
      const pid = id("album_photo", acct.key, aid, pi);
      const name = `albums/${acct.key}-${ai}-${pi}`;
      const f = imageFile(name);
      const ownerPath = ownerIsMe ? `{${acct.key}}` : demo(ownerKey).uid;
      const path = `${ownerPath}/${aid}/${pid}.jpg`;
      uploads.push({ name, file: f.rel, exists: f.exists, bucket: "album-photos", path, contentType: "image/jpeg", ...(ownerIsMe ? { ownerPlaceholder: acct.key } : {}) });
      return { id: pid, idx: pi, minutes: createdMin - 5 - pi };
    });
    const album = { id: aid, idx: ai, name: a.name, ownerIsMe, owner: ownerIsMe ? null : demo(ownerKey).uid, createdMin, photos };
    A.albums.push(album);
    if (partner) {
      A.shares.push({
        id: id("share", acct.key, aid),
        ownerIsMe,
        demoUid: demo(partner).uid,
        albumId: aid,
        minutes: shareMin,
      });
    }
  });

  // his: every pending hi (sent) is kept alive by the heartbeat
  for (const h of A.his) if (h.state === "sent") keepAlive.his.push({ id: h.id, minutes: h.minutes });

  // expectations for the rehearsal
  A.expect = {
    hisReceivedSent: A.his.filter((h) => h.dir === "received" && h.state === "sent").length,
    hisReceivedTotal: A.his.filter((h) => h.dir === "received").length,
    hisSentTotal: A.his.filter((h) => h.dir === "sent").length,
    hisSentPending: A.his.filter((h) => h.dir === "sent" && h.state === "sent").length,
    conversations: A.conversations.length,
    messages: A.conversations.reduce((n, c) => n + c.messages.length, 0),
    albumsOwned: A.albums.filter((a) => a.ownerIsMe).length,
    albumPhotosOwned: A.albums.filter((a) => a.ownerIsMe).reduce((n, a) => n + a.photos.length, 0),
    albumsSharedIn: A.shares.filter((s) => !s.ownerIsMe).length,
    albumPhotosSharedIn: A.albums.filter((a) => !a.ownerIsMe).reduce((n, a) => n + a.photos.length, 0),
    sharesOut: A.shares.filter((s) => s.ownerIsMe).length,
    sharesIn: A.shares.filter((s) => !s.ownerIsMe).length,
    unread: A.conversations.filter((c) => c.unread).length,
    mediaViews: A.conversations.reduce((n, c) => n + c.messages.reduce((k, m) => k + (m.media?.views?.length ?? 0), 0), 0),
  };

  for (const h of A.his) seeded.his.push(h.id);
  for (const c of A.conversations) {
    seeded.conversations.push(c.id);
    for (const m of c.messages) seeded.messages.push(m.id);
  }
  for (const a of A.albums) {
    seeded.albums.push({ id: a.id, ownerIsMe: a.ownerIsMe });
    for (const p of a.photos) seeded.albumPhotos.push({ id: p.id, ownerIsMe: a.ownerIsMe });
  }
  for (const s of A.shares) seeded.shares.push(s.id);
  accounts.push(A);
}

// -----------------------------------------------------------------------------
// SQL: shared fragments
// -----------------------------------------------------------------------------

const DEMO_EMAIL_PRED = (col) => `lower(split_part(${col}, '@', 2)) = '${DEMO_DOMAIN}'`;
const arr = (ids) => (ids.length ? `array[${ids.map((x) => `'${x}'`).join(", ")}]::uuid[]` : `'{}'::uuid[]`);
const demoIds = people.map((p) => p.uid);

const header = (title) => `-- ${title}
--
-- GENERATED by supabase/seed/demo/build-seed.mjs on ${new Date().toISOString()}. Do not edit by hand:
-- change cast.json / interactions.json / build-seed.mjs and regenerate.
--
-- !!! DEMO DATA. THE DEMO MUST BE REMOVED BEFORE LAUNCH (apply unseed.generated.sql). !!!
--
-- Id scheme: every seeded row id is uuid_v5('${NAMESPACE}', '<table>:<content keys>').
-- Demo users are the auth.users on @${DEMO_DOMAIN}; the real accounts are resolved at
-- run time by first name and a non-demo email domain.
`;

// -----------------------------------------------------------------------------
// SQL: liveness functions (part of the seed)
// -----------------------------------------------------------------------------

function heartbeatSql() {
  const hisVals = keepAlive.his.map((h) => `('${h.id}'::uuid, ${h.minutes})`).join(",\n      ");
  const convVals = keepAlive.conversations.map((c) => `('${c.id}'::uuid, '${c.message}'::uuid, ${c.minutes}, ${c.created})`).join(",\n      ");
  return `-- =============================================================================
-- Liveness: private.demo_hash, private.demo_presence_plan, private.demo_heartbeat
-- =============================================================================
-- The plan is a pure function of (demo user, time): each person's
-- presence_profile (stored in auth.users.raw_user_meta_data on the demo user)
-- sets a base score for the campus-local hour, a per-person-per-hour hash adds a
-- slow-moving component and a per-person-per-10-minute hash a small jitter.
-- Ranking the scores and cutting at per-bucket counts gives, at every moment:
-- 6-9 on campus, 5-8 nearby, the rest away; 8-12 online; 2-4 here now between
-- 08:00 and 22:00 campus time, none overnight. Only ever reads demo users.

create or replace function private.demo_hash(p_key text)
returns double precision
language sql
immutable
set search_path = ''
as $fn$
  select ('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint / 4294967296.0;
$fn$;
revoke execute on function private.demo_hash(text) from public, anon, authenticated;

create or replace function private.demo_presence_plan(p_at timestamptz default now())
returns table (user_id uuid, tier public.presence_tier, is_online boolean, here_now boolean, idle_minutes integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  with clock as (
    select floor(extract(epoch from p_at) / 600)::bigint as b10,
           floor(extract(epoch from p_at) / 3600)::bigint as b60,
           extract(hour from p_at at time zone c.timezone)::int as hr
      from public.campuses c
     where c.slug = '${CAMPUS_SLUG}'
  ),
  counts as (
    select k.*,
           6 + floor(private.demo_hash('n_on:' || k.b10) * 4)::int as n_on,
           5 + floor(private.demo_hash('n_near:' || k.b10) * 4)::int as n_near,
           8 + floor(private.demo_hash('n_online:' || k.b10) * 5)::int as n_online,
           case when k.hr between 8 and 21 then 2 + floor(private.demo_hash('n_here:' || k.b10) * 3)::int else 0 end as n_here
      from clock k
  ),
  demo as (
    select u.id, coalesce(u.raw_user_meta_data ->> 'presence_profile', 'mostly_away') as prof
      from auth.users u
      join public.profiles p on p.id = u.id
     where ${DEMO_EMAIL_PRED("u.email")}
       and p.status = 'active'
  ),
  placed as (
    select d.id, d.prof, n.*,
           row_number() over (order by
             (case d.prof
                when 'regular_on_campus' then case when n.hr between 8 and 17 then 3.0 when n.hr between 18 and 21 then 1.5 else 0.4 end
                when 'commuter_nearby'   then case when n.hr between 8 and 21 then 1.8 else 0.9 end
                when 'night_owl'         then case when n.hr between 8 and 16 then 1.0 when n.hr between 17 and 21 then 2.2 else 2.6 end
                when 'mostly_away'       then 0.6
                else 0.1
              end)
             + 1.6 * private.demo_hash(d.id::text || ':place:' || n.b60)
             + 0.5 * private.demo_hash(d.id::text || ':jitter:' || n.b10) desc, d.id) as prank
      from demo d cross join counts n
  ),
  tiered as (
    select pl.*,
           case when pl.prank <= pl.n_on then 'on_campus'::public.presence_tier
                when pl.prank <= pl.n_on + pl.n_near then 'nearby'::public.presence_tier
                else 'away'::public.presence_tier end as t
      from placed pl
  ),
  here as (
    select tr.*,
           tr.t = 'on_campus'
             and row_number() over (partition by (tr.t = 'on_campus') order by
                   (case tr.prof when 'regular_on_campus' then 0.5 when 'night_owl' then 0.3 else 0 end)
                   + private.demo_hash(tr.id::text || ':here:' || tr.b60) desc, tr.id) <= tr.n_here as hn
      from tiered tr
  ),
  onl as (
    select h.*,
           row_number() over (order by
             (case when h.hn then 10 else 0 end)
             + (case when h.t = 'on_campus' then 0.8 else 0 end)
             + (case h.prof
                  when 'regular_on_campus' then 1.6
                  when 'commuter_nearby'   then 1.3
                  when 'night_owl'         then case when h.hr between 17 and 23 or h.hr < 3 then 2.2 else 0.9 end
                  when 'mostly_away'       then 0.7
                  else 0.0
                end)
             + 1.2 * private.demo_hash(h.id::text || ':online:' || h.b60)
             + 0.4 * private.demo_hash(h.id::text || ':onjit:' || h.b10) desc, h.id) as orank
      from here h
  )
  select o.id,
         o.t,
         o.orank <= o.n_online,
         o.hn,
         case when o.orank <= o.n_online
              then floor(private.demo_hash(o.id::text || ':idle:' || o.b10) * 10)::int
              else 16 + floor(private.demo_hash(o.id::text || ':idle:' || o.b60)
                              * case o.prof when 'rarely_active' then 5760 when 'mostly_away' then 720 else 300 end)::int
         end
    from onl o;
$fn$;
comment on function private.demo_presence_plan(timestamptz) is 'DEMO ONLY (remove before launch). Deterministic presence plan for the @${DEMO_DOMAIN} demo users at p_at.';
revoke execute on function private.demo_presence_plan(timestamptz) from public, anon, authenticated;

create or replace function private.demo_heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_now  timestamptz := now();
  v_bad  integer;
  v_prev text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- Never touch a non-demo user: every row the plan names must be a demo user.
  select count(*) into v_bad
    from private.demo_presence_plan(v_now) pl
    left join auth.users u on u.id = pl.user_id
   where u.id is null or not (${DEMO_EMAIL_PRED("u.email")});
  if v_bad > 0 then
    raise exception 'demo_heartbeat: the plan named % non-demo user(s); refusing', v_bad;
  end if;

  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- Location: refresh every demo user's tier (effective tier needs <= 1 hour).
  update public.user_presence up
     set tier = pl.tier, tier_computed_at = v_now
    from private.demo_presence_plan(v_now) pl
    join auth.users u on u.id = pl.user_id
   where up.user_id = pl.user_id
     and ${DEMO_EMAIL_PRED("u.email")};

  -- Online: within 15 minutes for the chosen few; everyone else ages naturally,
  -- pulled back past the 15-minute line if they were online, and capped so a
  -- profile never looks older than its presence_profile allows.
  update public.profiles p
     set last_active_at = case
           when pl.is_online then v_now - make_interval(mins => pl.idle_minutes)
           when p.last_active_at > v_now - interval '16 minutes' then v_now - make_interval(mins => 16 + (pl.idle_minutes % 5))
           when p.last_active_at < v_now - make_interval(mins => pl.idle_minutes) then v_now - make_interval(mins => pl.idle_minutes)
           else p.last_active_at
         end
    from private.demo_presence_plan(v_now) pl
    join auth.users u on u.id = pl.user_id
   where p.id = pl.user_id
     and ${DEMO_EMAIL_PRED("u.email")};

  -- Here now: set for the chosen on-campus few (2-hour cap respected), cleared
  -- for everyone else. Only rows whose value changes are written, which keeps
  -- the broadcast_here_now realtime trigger quiet.
  update public.profiles p
     set here_now_until = case when pl.here_now then v_now + interval '30 minutes' else null end
    from private.demo_presence_plan(v_now) pl
    join auth.users u on u.id = pl.user_id
   where p.id = pl.user_id
     and ${DEMO_EMAIL_PRED("u.email")}
     and (pl.here_now or p.here_now_until is not null);

  -- Keep the scripted pending state alive. A seeded hi still 'sent' that is
  -- within a day of expiring, and a seeded conversation still 'awaiting_reply'
  -- that is over six days old, are re-anchored to their scripted age, so the
  -- hourly expire-stale job never closes them. Only the seeded ids below, only
  -- while untouched (a dismissed hi or an answered conversation is left alone).
  update public.his h
     set created_at = v_now - make_interval(mins => k.minutes),
         expires_at = v_now - make_interval(mins => k.minutes) + interval '7 days'
    from (values
      ${hisVals}
    ) as k(id, minutes)
   where h.id = k.id
     and h.state = 'sent'
     and h.expires_at < v_now + interval '1 day';

  with k(id, message_id, minutes, created) as (values
      ${convVals}
  ), stale as (
    select k.* from k
      join public.conversations c on c.id = k.id
     where c.state = 'awaiting_reply'
       and c.created_at < v_now - interval '6 days'
       and (select count(*) from public.messages m where m.conversation_id = c.id) = 1
  ), moved as (
    update public.messages m
       set created_at = v_now - make_interval(mins => s.minutes)
      from stale s
     where m.id = s.message_id
    returning m.conversation_id
  )
  update public.conversations c
     set created_at = v_now - make_interval(mins => s.created),
         last_message_at = v_now - make_interval(mins => s.minutes)
    from stale s
   where c.id = s.id;

  perform set_config('app.bypass_profiles_guard', v_prev, true);
end;
$fn$;
comment on function private.demo_heartbeat() is 'DEMO ONLY (remove before launch). Run every 10 minutes by the ${JOB_NAME} pg_cron job: rotates presence for the @${DEMO_DOMAIN} demo users only, and keeps the seeded pending hi''s and awaiting_reply conversations from expiring.';
revoke execute on function private.demo_heartbeat() from public, anon, authenticated;
`;
}

// -----------------------------------------------------------------------------
// SQL: seed
// -----------------------------------------------------------------------------

function seedPlan() {
  // Everything the seed writes, keyed by the deterministic ids above. The SQL
  // program below walks it; the real accounts appear only by key.
  const planPeople = people.map((p) => ({
    id: p.uid, key: p.key, email: p.email, first_name: p.first_name, grad_year: p.grad_year,
    status_line: p.status_line, dob: p.date_of_birth, created_days: p.createdDaysAgo,
    presence_profile: p.presence_profile, goals: p.goals, tags: p.tags,
    photos: p.photos.map((ph) => ({ id: ph.id, pos: ph.position, path: ph.path, tint: ph.tint })),
  }));
  const accts = accounts.map((A) => ({
    key: A.key,
    first_name: A.firstName,
    his: A.his.map((h) => ({ id: h.id, dir: h.dir, demo: h.from ?? h.to, state: h.state, min: h.minutes, cast: h.cast })),
    conversations: A.conversations.map((c) => ({
      id: c.id, cast: c.cast, demo: c.other, opener_is_me: c.openerIsMe, via: c.via, state: c.state,
      created_min: c.createdMin, last_min: c.lastMin, read_min: c.readUpTo,
      messages: c.messages.map((m) => ({
        id: m.id, me: m.fromMe, body: m.body, min: m.minutes,
        ...(m.media
          ? {
              media: {
                path: m.media.path, view_limit: m.media.viewLimit, views_used: m.media.viewsUsed,
                bytes: m.media.bytes, width: m.media.width, height: m.media.height,
                views: (m.media.views ?? []).map((v) => ({ ordinal: v.ordinal, me: v.viewerIsMe, min: v.minutes })),
              },
            }
          : {}),
      })),
    })),
    albums: A.albums.map((a) => ({
      id: a.id, name: a.name, owner_is_me: a.ownerIsMe, owner: a.owner, created_min: a.createdMin,
      photos: a.photos.map((p) => ({ id: p.id, min: p.minutes })),
    })),
    shares: A.shares.map((s) => ({ id: s.id, owner_is_me: s.ownerIsMe, demo: s.demoUid, album: s.albumId, min: s.minutes })),
  }));
  return { people: planPeople, accounts: accts };
}

// The plan as a dollar-quoted jsonb literal, one person / one account section
// per line so a diff of two generations stays readable.
function planLiteral() {
  const plan = seedPlan();
  const body =
    '{"people": [\n' +
    plan.people.map((p) => JSON.stringify(p)).join(",\n") +
    '\n], "accounts": [\n' +
    plan.accounts
      .map((a) =>
        [
          `{"key": ${JSON.stringify(a.key)}, "first_name": ${JSON.stringify(a.first_name)},`,
          ` "his": [\n${a.his.map((h) => "  " + JSON.stringify(h)).join(",\n")}],`,
          ` "conversations": [\n${a.conversations.map((c) => "  " + JSON.stringify(c)).join(",\n")}],`,
          ` "albums": [\n${a.albums.map((x) => "  " + JSON.stringify(x)).join(",\n")}],`,
          ` "shares": [\n${a.shares.map((x) => "  " + JSON.stringify(x)).join(",\n")}]}`,
        ].join("\n")
      )
      .join(",\n") +
    "\n]}";
  if (body.includes("$plan$")) throw new Error("content contains the $plan$ delimiter");
  return `$plan$${body}$plan$::jsonb`;
}

// The seed's main block, as a plpgsql body (the rehearsal wraps the same body
// in a function so it can run it twice without repeating the text).
function seedBody() {
  return `
declare
  v_plan   jsonb := ${planLiteral()};
  v_now    timestamptz := now();
  v_prev   text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
  v_campus uuid;
  v_n      integer;
  v_state  text;
  v_demo   uuid[];
  v_reals  uuid[] := '{}';
  v_seeded_conversations uuid[];
  v_real   jsonb := '{}';
  v_me     uuid;
  v_other  uuid;
  v_owner  uuid;
  v_acc    jsonb;
  v_h      jsonb;
  v_c      jsonb;
  v_m      jsonb;
  v_v      jsonb;
  v_al     jsonb;
  v_s      jsonb;
begin
  select id into v_campus from public.campuses where slug = '${CAMPUS_SLUG}';
  if v_campus is null then
    raise exception 'demo seed: campus ${CAMPUS_SLUG} not found';
  end if;

  select array_agg((p ->> 'id')::uuid) into v_demo from jsonb_array_elements(v_plan -> 'people') p;
  select array_agg((c ->> 'id')::uuid) into v_seeded_conversations
    from jsonb_array_elements(v_plan -> 'accounts') a, jsonb_array_elements(a -> 'conversations') c;

  -- Resolve each real account by first name: exactly one, not on the demo
  -- domain, active, verified, on CLC. Anything else rolls the seed back.
  for v_acc in select value from jsonb_array_elements(v_plan -> 'accounts') loop
    select count(*) into v_n
      from public.profiles p join auth.users u on u.id = p.id
     where lower(p.first_name) = lower(v_acc ->> 'first_name') and not (${DEMO_EMAIL_PRED("u.email")});
    if v_n <> 1 then
      raise exception 'demo seed: expected exactly one real account named %, found %', v_acc ->> 'first_name', v_n;
    end if;
    select p.id into v_me
      from public.profiles p join auth.users u on u.id = p.id
     where lower(p.first_name) = lower(v_acc ->> 'first_name') and not (${DEMO_EMAIL_PRED("u.email")});
    if not exists (select 1 from public.profiles
                    where id = v_me and status = 'active' and verification_status = 'verified' and campus_id = v_campus) then
      raise exception 'demo seed: the real account % must be active, verified and on campus ${CAMPUS_SLUG}', v_acc ->> 'first_name';
    end if;
    if v_me = any(v_reals) then
      raise exception 'demo seed: two real accounts resolved to the same user';
    end if;
    v_reals := v_reals || v_me;
    v_real := v_real || jsonb_build_object(v_acc ->> 'key', v_me);
  end loop;

  -- A deterministic demo id must never belong to a non-demo account.
  if exists (select 1 from auth.users u where u.id = any(v_demo) and not (${DEMO_EMAIL_PRED("u.email")})) then
    raise exception 'demo seed: a demo user id is taken by a non-demo account';
  end if;

  -- No conversation may exist between a real account and a demo user other
  -- than the ones this seed writes. The real accounts' conversation with each
  -- other is never read or written here.
  if exists (
    select 1 from public.conversations c
     where ((c.user_a_id = any(v_reals) and c.user_b_id = any(v_demo))
         or (c.user_b_id = any(v_reals) and c.user_a_id = any(v_demo)))
       and not (c.id = any(v_seeded_conversations))
  ) then
    raise exception 'demo seed: an unexpected conversation exists between a real account and a demo user';
  end if;

  -- Privileged writes follow (verification_status, historical states); the
  -- flag is transaction-local and restored at the end.
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- ---------------------------------------------------------------------------
  -- Demo users. No password, and banned_until keeps anyone from signing in as
  -- one. The presence_profile in user metadata drives demo_presence_plan().
  -- ---------------------------------------------------------------------------
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
     raw_app_meta_data, raw_user_meta_data, banned_until,
     confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
     phone_change, phone_change_token, reauthentication_token)
  select (p ->> 'id')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p ->> 'email', '',
         v_now - make_interval(days => (p ->> 'created_days')::int),
         v_now - make_interval(days => (p ->> 'created_days')::int),
         v_now - make_interval(days => (p ->> 'created_days')::int),
         '{"provider":"email","providers":["email"],"demo":true}'::jsonb,
         jsonb_build_object('demo', true, 'cast_key', p ->> 'key', 'presence_profile', p ->> 'presence_profile'),
         timestamptz '2999-01-01 00:00:00+00', '', '', '', '', '', '', '', ''
    from jsonb_array_elements(v_plan -> 'people') p
  on conflict (id) do nothing;

  -- profiles_from_auth() derives campus_id from the demo domain and stamps
  -- email_verified; verification_status is raised to verified right after.
  insert into public.profiles (id, first_name, grad_year, status_line, status, last_active_at, created_at, updated_at)
  select (p ->> 'id')::uuid, p ->> 'first_name', (p ->> 'grad_year')::smallint, p ->> 'status_line', 'active',
         v_now - interval '2 hours',
         v_now - make_interval(days => (p ->> 'created_days')::int),
         v_now - make_interval(days => (p ->> 'created_days')::int)
    from jsonb_array_elements(v_plan -> 'people') p
  on conflict (id) do nothing;

  update public.profiles
     set verification_status = 'verified'
   where id = any(v_demo) and verification_status <> 'verified';

  if (select count(*) from public.profiles
       where id = any(v_demo) and campus_id = v_campus and status = 'active' and verification_status = 'verified')
     <> cardinality(v_demo) then
    raise exception 'demo seed: demo profiles are not all active, verified and on campus ${CAMPUS_SLUG}';
  end if;

  insert into public.users_private (user_id, school_email, date_of_birth, created_at)
  select (p ->> 'id')::uuid, p ->> 'email', (p ->> 'dob')::date, v_now - make_interval(days => (p ->> 'created_days')::int)
    from jsonb_array_elements(v_plan -> 'people') p
  on conflict (user_id) do nothing;

  insert into public.user_presence (user_id, campus_id, tier, tier_computed_at, is_visible, created_at)
  select d, v_campus, 'away', v_now, true, v_now from unnest(v_demo) as d
  on conflict (user_id) do nothing;

  insert into public.user_goals (user_id, goal, created_at)
  select (p ->> 'id')::uuid, g::public.user_goal, v_now - make_interval(days => (p ->> 'created_days')::int)
    from jsonb_array_elements(v_plan -> 'people') p, jsonb_array_elements_text(p -> 'goals') g
  on conflict do nothing;

  insert into public.user_tags (user_id, tag_id, position, created_at)
  select (p ->> 'id')::uuid, t.id, (x.ord - 1)::smallint, v_now
    from jsonb_array_elements(v_plan -> 'people') p
    cross join lateral jsonb_array_elements_text(p -> 'tags') with ordinality as x(label, ord)
    join public.tags t on t.campus_id = v_campus and t.label = x.label
  on conflict do nothing;
  if (select count(*) from public.user_tags where user_id = any(v_demo))
     <> (select count(*) from jsonb_array_elements(v_plan -> 'people') p, jsonb_array_elements(p -> 'tags')) then
    raise exception 'demo seed: a demo tag label did not resolve against the CLC tag seed';
  end if;

  -- Photos: approved (ok) as a moderator would; written as the table owner, so
  -- user_photos_guard() leaves moderation_state alone.
  insert into public.user_photos (id, user_id, position, storage_path, moderation_state, tint, created_at)
  select (ph ->> 'id')::uuid, (p ->> 'id')::uuid, (ph ->> 'pos')::smallint, ph ->> 'path', 'ok', ph ->> 'tint',
         v_now - make_interval(days => (p ->> 'created_days')::int)
    from jsonb_array_elements(v_plan -> 'people') p, jsonb_array_elements(p -> 'photos') ph
  on conflict do nothing;

  -- ---------------------------------------------------------------------------
  -- The real accounts' scripted activity. Every block is skipped when its row
  -- already exists, so a re-run never rewrites what a real account has since
  -- done (a dismissed hi, a reply, a revoked share).
  -- ---------------------------------------------------------------------------
  for v_acc in select value from jsonb_array_elements(v_plan -> 'accounts') loop
    v_me := (v_real ->> (v_acc ->> 'key'))::uuid;

    -- Hi's first: enforce_hi_rules() refuses a hi once a conversation exists.
    -- The trigger stamps state = sent and expires_at = now() + 7 days; the
    -- scripted state and a 7-day expiry from the scripted time follow.
    for v_h in select value from jsonb_array_elements(v_acc -> 'his') loop
      if not exists (select 1 from public.his where id = (v_h ->> 'id')::uuid) then
        v_other := (v_h ->> 'demo')::uuid;
        insert into public.his (id, from_user_id, to_user_id, created_at)
        values ((v_h ->> 'id')::uuid,
                case when v_h ->> 'dir' = 'received' then v_other else v_me end,
                case when v_h ->> 'dir' = 'received' then v_me else v_other end,
                v_now - make_interval(mins => (v_h ->> 'min')::int));
        update public.his
           set state = (v_h ->> 'state')::public.hi_state, expires_at = created_at + interval '7 days'
         where id = (v_h ->> 'id')::uuid;
      end if;
    end loop;

    -- Conversations: created directly (deterministic id, historical time) in
    -- awaiting_reply, then every message goes through enforce_message_rules()
    -- and advance_conversation() one statement at a time, so the opener rule,
    -- the media-only-when-open rule and 0010's path binding all run for real.
    for v_c in select value from jsonb_array_elements(v_acc -> 'conversations') loop
      continue when exists (select 1 from public.conversations where id = (v_c ->> 'id')::uuid);
      v_other := (v_c ->> 'demo')::uuid;
      insert into public.conversations (id, user_a_id, user_b_id, opened_by_id, opened_via, state, created_at)
      values ((v_c ->> 'id')::uuid, least(v_me, v_other), greatest(v_me, v_other),
              case when (v_c ->> 'opener_is_me')::boolean then v_me else v_other end,
              (v_c ->> 'via')::public.opened_via, 'awaiting_reply',
              v_now - make_interval(mins => (v_c ->> 'created_min')::int));

      for v_m in select value from jsonb_array_elements(v_c -> 'messages') with ordinality as e(value, ord) order by ord loop
        insert into public.messages
          (id, conversation_id, sender_id, body, media_path, media_kind, view_limit, views_used,
           media_bytes, media_width, media_height, created_at)
        values ((v_m ->> 'id')::uuid, (v_c ->> 'id')::uuid,
                case when (v_m ->> 'me')::boolean then v_me else v_other end,
                v_m ->> 'body',
                v_m #>> '{media,path}',
                case when v_m ? 'media' then 'photo'::public.media_kind end,
                (v_m #>> '{media,view_limit}')::smallint,
                coalesce((v_m #>> '{media,views_used}')::smallint, 0),
                (v_m #>> '{media,bytes}')::int,
                (v_m #>> '{media,width}')::smallint,
                (v_m #>> '{media,height}')::smallint,
                v_now - make_interval(mins => (v_m ->> 'min')::int));
        -- Counted opens by the recipient, consistent with views_used.
        for v_v in select value from jsonb_array_elements(coalesce(v_m #> '{media,views}', '[]')) loop
          insert into public.message_media_views (message_id, viewer_id, ordinal, viewed_at)
          values ((v_m ->> 'id')::uuid,
                  case when (v_v ->> 'me')::boolean then v_me else v_other end,
                  (v_v ->> 'ordinal')::smallint,
                  v_now - make_interval(mins => (v_v ->> 'min')::int));
        end loop;
      end loop;

      if v_c ->> 'state' = 'expired' then
        update public.conversations set state = 'expired' where id = (v_c ->> 'id')::uuid;
      end if;
      -- advance_conversation() stamps now(); the thread's real last activity:
      update public.conversations
         set last_message_at = v_now - make_interval(mins => (v_c ->> 'last_min')::int)
       where id = (v_c ->> 'id')::uuid;
      -- The real account's read marker (no row = never opened, i.e. unread).
      if v_c ->> 'read_min' is not null then
        insert into public.message_reads (user_id, conversation_id, last_read_at)
        values (v_me, (v_c ->> 'id')::uuid, v_now - make_interval(mins => (v_c ->> 'read_min')::int));
      end if;

      select state::text into v_state from public.conversations where id = (v_c ->> 'id')::uuid;
      if v_state <> v_c ->> 'state' then
        raise exception 'demo seed: conversation with % ended in state %, scripted %', v_c ->> 'cast', v_state, v_c ->> 'state';
      end if;
    end loop;

    -- Albums (photos ok, photo_count kept by maintain_album_photo_count()).
    for v_al in select value from jsonb_array_elements(v_acc -> 'albums') loop
      continue when exists (select 1 from public.albums where id = (v_al ->> 'id')::uuid);
      v_owner := case when (v_al ->> 'owner_is_me')::boolean then v_me else (v_al ->> 'owner')::uuid end;
      insert into public.albums (id, owner_id, name, created_at)
      values ((v_al ->> 'id')::uuid, v_owner, v_al ->> 'name', v_now - make_interval(mins => (v_al ->> 'created_min')::int));
      insert into public.album_photos (id, album_id, storage_path, moderation_state, created_at)
      select (ph ->> 'id')::uuid, (v_al ->> 'id')::uuid,
             v_owner::text || '/' || (v_al ->> 'id') || '/' || (ph ->> 'id') || '.jpg', 'ok',
             v_now - make_interval(mins => (ph ->> 'min')::int)
        from jsonb_array_elements(v_al -> 'photos') ph;
    end loop;

    -- Shares, both directions; enforce_share_rules() checks the album owner and
    -- the mutual conversation.
    for v_s in select value from jsonb_array_elements(v_acc -> 'shares') loop
      continue when exists (select 1 from public.shares where id = (v_s ->> 'id')::uuid);
      insert into public.shares (id, owner_id, viewer_id, subject_type, subject_id, created_at)
      values ((v_s ->> 'id')::uuid,
              case when (v_s ->> 'owner_is_me')::boolean then v_me else (v_s ->> 'demo')::uuid end,
              case when (v_s ->> 'owner_is_me')::boolean then (v_s ->> 'demo')::uuid else v_me end,
              'album', (v_s ->> 'album')::uuid,
              v_now - make_interval(mins => (v_s ->> 'min')::int));
    end loop;
  end loop;

  perform set_config('app.bypass_profiles_guard', v_prev, true);
end;
`;
}

function seedSql({ wrapForRehearsal = false } = {}) {
  const parts = [];
  parts.push(header("OhHi demo seed (CLC): 30 demo people plus scripted activity for the two real test accounts"));
  parts.push(`-- Apply with apply_migration, then remove the history row it records:
--   supabase migration repair --status reverted <version>
-- Order: images generated -> node build-seed.mjs -> node upload.mjs -> this file.
`);
  parts.push(`-- 1. The reserved demo domain on CLC (the unseed removes it).
update public.campuses
   set email_domains = array_append(email_domains, '${DEMO_DOMAIN}')
 where slug = '${CAMPUS_SLUG}'
   and not ('${DEMO_DOMAIN}' = any(email_domains));
`);
  parts.push(heartbeatSql());
  parts.push(`-- =============================================================================
-- 2. People and activity: one block, so any failure rolls the whole seed back.
-- =============================================================================`);
  if (wrapForRehearsal) {
    parts.push(`create function pg_temp._demo_seed() returns void language plpgsql as $seed$${seedBody()}$seed$;
select pg_temp._demo_seed();`);
  } else {
    parts.push(`do $seed$${seedBody()}$seed$;`);
  }
  parts.push(`
-- =============================================================================
-- 3. Liveness job and a first beat
-- =============================================================================
select cron.schedule('${JOB_NAME}', '*/10 * * * *', $$select private.demo_heartbeat()$$);
select private.demo_heartbeat();
`);
  return parts.join("\n");
}

// -----------------------------------------------------------------------------
// SQL: unseed
// -----------------------------------------------------------------------------

function unseedSql({ wrapForRehearsal = false } = {}) {
  const open = wrapForRehearsal
    ? "create function pg_temp._demo_unseed_rows() returns void language plpgsql as $unseed$"
    : "do $unseed$";
  const close = wrapForRehearsal ? "$unseed$;\nselect pg_temp._demo_unseed_rows();" : "$unseed$;";
  const realAlbums = seeded.albums.filter((a) => a.ownerIsMe).map((a) => a.id);
  const realAlbumPhotos = seeded.albumPhotos.filter((p) => p.ownerIsMe).map((p) => p.id);
  const allAlbums = seeded.albums.map((a) => a.id);
  return `${header("OhHi demo UNSEED: removes everything seed.generated.sql wrote")}
-- Apply with apply_migration, then remove the history row it records:
--   supabase migration repair --status reverted <version>
--
-- Storage objects cannot be deleted from SQL (storage.protect_delete()): every
-- demo object is enqueued in private.storage_purge_queue and removed by the
-- deployed purge-drain edge function (daily at 03:15 UTC, or trigger it by hand;
-- see docs/handoff-0002.md "Deploy checklist" step 7). The notice at the end
-- reports how many were enqueued.
--
-- The two real accounts' own rows are never updated: only rows the seed wrote
-- (deterministic ids), and rows that reference a demo user, are deleted.

-- 1. The liveness job and functions.
do $unseed$
begin
  if exists (select 1 from cron.job where jobname = '${JOB_NAME}') then
    perform cron.unschedule('${JOB_NAME}');
  end if;
end;
$unseed$;
drop function if exists private.demo_heartbeat();
drop function if exists private.demo_presence_plan(timestamptz);
drop function if exists private.demo_hash(text);

-- 2. Rows.
${open}
declare
  v_prev   text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
  v_ids    uuid[];
  v_uid    uuid;
  v_queued integer;
  v_before integer;
  v_left   integer;
  v_seeded_his           uuid[] := ${arr(seeded.his)};
  v_seeded_conversations uuid[] := ${arr(seeded.conversations)};
  v_seeded_messages      uuid[] := ${arr(seeded.messages)};
  v_seeded_shares        uuid[] := ${arr(seeded.shares)};
  v_seeded_albums        uuid[] := ${arr(allAlbums)};
  v_real_albums          uuid[] := ${arr(realAlbums)};
  v_real_album_photos    uuid[] := ${arr(realAlbumPhotos)};
  v_demo_fixed           uuid[] := ${arr(demoIds)};
begin
  -- Demo users are exactly the auth users on @${DEMO_DOMAIN}.
  select coalesce(array_agg(u.id), '{}') into v_ids
    from auth.users u where ${DEMO_EMAIL_PRED("u.email")};
  if exists (select 1 from auth.users u where u.id = any(v_demo_fixed) and not (${DEMO_EMAIL_PRED("u.email")})) then
    raise exception 'demo unseed: a seeded demo id belongs to a non-demo account; refusing';
  end if;

  select count(*) into v_before from private.storage_purge_queue;
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- 2a. Storage objects under rows 2b deletes before purge_user can see them:
  -- the seeded conversations' chat media and the real accounts' seeded album
  -- photos. (Everything under a demo user's own folder, and chat media in any
  -- other conversation with a demo user, is enqueued by purge_user in 2c.)
  insert into private.storage_purge_queue (bucket_id, object_name)
  select o.bucket_id, o.name
    from storage.objects o
   where (
          (o.bucket_id in ('chat-media', 'chat-media-limited')
             and (storage.foldername(o.name))[1] = any(v_seeded_conversations::text[]))
       or (o.bucket_id = 'album-photos' and (storage.foldername(o.name))[2] = any(v_real_albums::text[]))
         )
     and not exists (
           select 1 from private.storage_purge_queue q
            where q.bucket_id = o.bucket_id and q.object_name = o.name and q.processed_at is null);

  -- 2b. Seeded rows attached to the real accounts, by deterministic id.
  delete from public.shares
   where id = any(v_seeded_shares)
      or (subject_type = 'album' and subject_id = any(v_seeded_albums));
  delete from public.album_photos where id = any(v_real_album_photos) or album_id = any(v_real_albums);
  delete from public.albums where id = any(v_real_albums);
  delete from public.message_media_views where message_id = any(v_seeded_messages)
     or message_id in (select m.id from public.messages m where m.conversation_id = any(v_seeded_conversations));
  delete from public.message_reads where conversation_id = any(v_seeded_conversations);
  delete from public.messages where conversation_id = any(v_seeded_conversations);
  delete from public.conversations where id = any(v_seeded_conversations);
  delete from public.his where id = any(v_seeded_his);

  -- 2c. Each demo user through private.purge_user (conversations, hi's and
  -- shares in either direction, including any made live during the demo; their
  -- albums, photos, tags, goals, presence, devices, prefs, consents, identity).
  -- purge_user enqueues any remaining storage objects itself.
  foreach v_uid in array v_ids loop
    perform private.purge_user(v_uid);
  end loop;

  -- 2d. What purge_user deliberately leaves, plus anything that references a
  -- demo user and would block deleting the profile.
  delete from public.verification_denylist
   where moderation_action_id in (
     select ma.id from public.moderation_actions ma
      where ma.subject_id = any(v_ids) or ma.actor_id = any(v_ids)
         or ma.report_id in (select r.id from public.reports r where r.reporter_id = any(v_ids) or r.subject_id = any(v_ids)));
  delete from public.moderation_actions
   where subject_id = any(v_ids) or actor_id = any(v_ids)
      or report_id in (select r.id from public.reports r where r.reporter_id = any(v_ids) or r.subject_id = any(v_ids));
  delete from public.reports where reporter_id = any(v_ids) or subject_id = any(v_ids);
  delete from public.blocks where blocker_id = any(v_ids) or blocked_id = any(v_ids);
  delete from public.verifications where user_id = any(v_ids);
  delete from private.verification_start_rate_limit where user_id = any(v_ids);
  delete from public.users_private where user_id = any(v_ids);
  delete from public.profiles where id = any(v_ids);
  delete from auth.users where id = any(v_ids);

  perform set_config('app.bypass_profiles_guard', v_prev, true);

  -- 3. The reserved domain.
  update public.campuses
     set email_domains = array_remove(email_domains, '${DEMO_DOMAIN}')
   where slug = '${CAMPUS_SLUG}' and '${DEMO_DOMAIN}' = any(email_domains);

  -- 4. Nothing seeded may remain.
  select (select count(*) from auth.users u where ${DEMO_EMAIL_PRED("u.email")})
       + (select count(*) from public.profiles where id = any(v_demo_fixed))
       + (select count(*) from public.his where id = any(v_seeded_his))
       + (select count(*) from public.conversations where id = any(v_seeded_conversations))
       + (select count(*) from public.messages where id = any(v_seeded_messages))
       + (select count(*) from public.albums where id = any(v_seeded_albums))
       + (select count(*) from public.shares where id = any(v_seeded_shares))
    into v_left;
  if v_left <> 0 then
    raise exception 'demo unseed: % seeded row(s) remain', v_left;
  end if;

  select count(*) - v_before into v_queued from private.storage_purge_queue;
  raise notice 'demo unseed: removed % demo user(s); enqueued % storage object(s) for purge-drain', coalesce(array_length(v_ids, 1), 0), v_queued;
end;
${close}
`;
}

// -----------------------------------------------------------------------------
// SQL: rehearsal (seed twice, assert, unseed twice, compare, raise)
// -----------------------------------------------------------------------------

const BASELINE_TABLES = [
  "auth.users", "public.profiles", "public.users_private", "public.user_presence", "public.user_photos",
  "public.user_tags", "public.user_goals", "public.his", "public.conversations", "public.messages",
  "public.message_reads", "public.message_media_views", "public.albums", "public.album_photos",
  "public.shares", "public.consents", "public.notification_prefs", "public.blocks", "public.reports",
  "public.campuses", "private.storage_purge_queue",
];

function rehearsalSql(seed, unseed) {
  const baseline = `
create temp table _demo_results (n serial, ok boolean, label text) on commit drop;
create temp table _demo_baseline (k text primary key, v text) on commit drop;
create or replace function pg_temp._demo_snapshot() returns table (k text, v text)
language plpgsql as $fn$
begin
${BASELINE_TABLES.map(
  (t) => `  return query select 'rows:${t}', (select count(*)::text from ${t});
  return query select 'hash:${t}', (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from ${t} x);`
).join("\n")}
  return query select 'objects:' || b.id, (select count(*)::text from storage.objects o where o.bucket_id = b.id) from storage.buckets b;
  return query select 'cron', (select string_agg(jobname, ',' order by jobname) from cron.job);
  return query select 'fn:demo', (select count(*)::text from pg_proc where proname like 'demo\\_%' and pronamespace = 'private'::regnamespace);
end $fn$;
create or replace function pg_temp._chk(p_ok boolean, p_label text) returns void
language sql as $fn$ insert into _demo_results (ok, label) values (coalesce(p_ok, false), p_label); $fn$;
insert into _demo_baseline select * from pg_temp._demo_snapshot();
`;

  const exp = accounts.map((A) => A.expect);
  const asserts = [];
  const push = (s) => asserts.push(s);

  push(`  perform pg_temp._chk((select count(*) from auth.users u where ${DEMO_EMAIL_PRED("u.email")}) = ${people.length}, '30 demo auth users on @${DEMO_DOMAIN}');`);
  push(`  perform pg_temp._chk((select count(*) from public.profiles p join public.campuses c on c.id = p.campus_id where p.id = any(v_demo) and c.slug = '${CAMPUS_SLUG}' and p.status = 'active' and p.verification_status = 'verified') = ${people.length}, 'demo profiles are active, verified, on CLC');`);
  push(`  perform pg_temp._chk((select count(*) from public.user_photos where user_id = any(v_demo) and moderation_state = 'ok') = ${people.reduce((n, p) => n + p.photo_count, 0)}, 'demo photos: ${people.reduce((n, p) => n + p.photo_count, 0)} ok rows');`);
  push(`  perform pg_temp._chk((select count(*) from public.users_private where user_id = any(v_demo) and date_of_birth is not null) = ${people.length}, 'demo users_private rows carry a DOB');`);
  push(`  perform pg_temp._chk((select count(*) from cron.job where jobname = '${JOB_NAME}' and schedule = '*/10 * * * *') = 1, 'cron job ${JOB_NAME} scheduled every 10 minutes');`);
  push(`  perform pg_temp._chk(current_setting('app.bypass_profiles_guard', true) is distinct from 'on', 'bypass flag restored after the seed');`);

  accounts.forEach((A, i) => {
    const e = exp[i];
    const me = `v_${A.key}`;
    push(`  -- ${A.firstName}: data as the table owner`);
    push(`  perform pg_temp._chk((select count(*) from public.his where to_user_id = ${me} and from_user_id = any(v_demo) and state = 'sent') = ${e.hisReceivedSent}, '${A.key}: ${e.hisReceivedSent} pending hi''s received');`);
    push(`  perform pg_temp._chk((select count(*) from public.his where to_user_id = ${me} and from_user_id = any(v_demo)) = ${e.hisReceivedTotal}, '${A.key}: ${e.hisReceivedTotal} hi''s received in total (incl. answered hi-backs)');`);
    push(`  perform pg_temp._chk((select count(*) from public.his where from_user_id = ${me} and to_user_id = any(v_demo)) = ${e.hisSentTotal}, '${A.key}: ${e.hisSentTotal} hi''s sent');`);
    for (const h of A.his) {
      push(`  perform pg_temp._chk((select state::text = '${h.state}' and expires_at = created_at + interval '7 days' from public.his where id = '${h.id}'), '${A.key}: hi ${h.dir} ${h.cast} is ${h.state}');`);
    }
    push(`  perform pg_temp._chk((select count(*) from public.conversations where (user_a_id = ${me} and user_b_id = any(v_demo)) or (user_b_id = ${me} and user_a_id = any(v_demo))) = ${e.conversations}, '${A.key}: ${e.conversations} conversations with demo users');`);
    push(`  perform pg_temp._chk((select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where (c.user_a_id = ${me} and c.user_b_id = any(v_demo)) or (c.user_b_id = ${me} and c.user_a_id = any(v_demo))) = ${e.messages}, '${A.key}: ${e.messages} messages');`);
    for (const c of A.conversations) {
      push(`  perform pg_temp._chk((select state::text = '${c.state}' and opened_via::text = '${c.via}' and opened_by_id = ${c.openerIsMe ? me : `'${c.other}'`} and last_message_at = (select max(created_at) from public.messages where conversation_id = c.id) from public.conversations c where id = '${c.id}'), '${A.key}/${c.cast}: ${c.state}, ${c.via}, opener and last_message_at');`);
    }
    push(`  perform pg_temp._chk((select count(*) from public.message_media_views v join public.messages m on m.id = v.message_id where m.conversation_id = any(v_convs_${A.key})) = ${e.mediaViews}, '${A.key}: ${e.mediaViews} counted media views');`);
    push(`  perform pg_temp._chk((select bool_and(case when view_limit is null then media_path ~ ('^' || conversation_id || '/' || id || '\\.jpg$') else media_path = conversation_id || '/' || id || '.jpg' and views_used <= view_limit and views_used = (select count(*) from public.message_media_views v where v.message_id = m.id) end) from public.messages m where media_path is not null and conversation_id = any(v_convs_${A.key})), '${A.key}: chat media paths bound, views_used consistent');`);
    push(`  perform pg_temp._chk((select count(*) from public.albums where owner_id = ${me} and id = any(v_albums)) = ${e.albumsOwned} and (select coalesce(sum(photo_count), 0) from public.albums where owner_id = ${me} and id = any(v_albums)) = ${e.albumPhotosOwned}, '${A.key}: owns ${e.albumsOwned} albums with ${e.albumPhotosOwned} photos (photo_count trigger)');`);
    push(`  perform pg_temp._chk((select count(*) from public.shares where owner_id = ${me} and viewer_id = any(v_demo) and revoked_at is null) = ${e.sharesOut} and (select count(*) from public.shares where viewer_id = ${me} and owner_id = any(v_demo) and revoked_at is null) = ${e.sharesIn}, '${A.key}: shares out ${e.sharesOut}, in ${e.sharesIn}');`);

    // as the user
    const hiSent = A.his.find((h) => h.dir === "sent" && h.state === "sent");
    const hiExpired = A.his.find((h) => h.dir === "sent" && h.state === "expired");
    const firstConv = A.conversations[0];
    const probe = demo(firstConv.cast);
    push(`  -- ${A.firstName}: through the app's own RPCs and policies
  perform set_config('request.jwt.claim.sub', ${me}::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ${me}, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.grid_for_me() g where g.user_id = any(v_demo);
  select count(*) into v_n2 from public.his where to_user_id = ${me} and state = 'sent' and from_user_id = any(v_demo);
  select count(*) into v_n3 from public.conversations c where c.id = any(v_convs_${A.key});
  select count(*) into v_n4 from public.conversations c
    left join lateral (select m.sender_id, m.created_at from public.messages m where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
    left join public.message_reads r on r.conversation_id = c.id and r.user_id = ${me}
   where c.id = any(v_convs_${A.key}) and c.last_message_at is not null and lm.sender_id <> ${me}
     and (r.last_read_at is null or c.last_message_at > r.last_read_at);
  select count(*) into v_n5 from public.albums a where a.owner_id = any(v_demo);
  select count(*) into v_n6 from public.album_photos ap join public.albums a on a.id = ap.album_id where a.owner_id = any(v_demo);
  select count(*), max(array_length(photos, 1)), max(conversation_id::text) into v_n7, v_n8, v_txt from public.profile_card_for('${probe.uid}');
  select my_hi_state::text into v_txt2 from public.profile_card_for('${demo(hiSent.cast).uid}');
  select my_hi_state::text into v_txt3 from public.profile_card_for('${demo(hiExpired.cast).uid}');
  execute 'reset role';
  perform pg_temp._chk(v_n = ${people.length}, '${A.key}: grid_for_me() shows all ${people.length} demo people (got ' || v_n || ')');
  perform pg_temp._chk(v_n2 = ${e.hisReceivedSent}, '${A.key}: Hi''s tab (RLS) lists ${e.hisReceivedSent} (got ' || v_n2 || ')');
  perform pg_temp._chk(v_n3 = ${e.conversations}, '${A.key}: chat list (RLS) has ${e.conversations} demo threads (got ' || v_n3 || ')');
  perform pg_temp._chk(v_n4 = ${e.unread}, '${A.key}: ${e.unread} unread threads by the app''s rule (got ' || v_n4 || ')');
  perform pg_temp._chk(v_n5 = ${e.albumsSharedIn} and v_n6 = ${e.albumPhotosSharedIn}, '${A.key}: sees ${e.albumsSharedIn} shared albums / ${e.albumPhotosSharedIn} photos (got ' || v_n5 || '/' || v_n6 || ')');
  perform pg_temp._chk(v_n7 = 1 and v_n8 = ${probe.photo_count} and v_txt = '${firstConv.id}', '${A.key}: profile_card_for(${probe.key}) returns the card, ${probe.photo_count} photos, the thread');
  perform pg_temp._chk(v_txt2 = 'sent' and v_txt3 = 'expired', '${A.key}: card my_hi_state sent (${hiSent.cast}) / expired (${hiExpired.cast})');`);
  });

  // heartbeat
  push(`  -- Heartbeat: touches demo rows only
  select md5(string_agg(x::text, '|' order by x::text)) into v_h1 from public.profiles x where not (x.id = any(v_demo));
  select md5(string_agg(x::text, '|' order by x::text)) into v_h2 from public.user_presence x where not (x.user_id = any(v_demo));
  select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) into v_h3 from public.his x where not (x.id = any(v_his));
  select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) into v_h4 from public.conversations x where not (x.id = any(v_all_convs));
  select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) into v_h5 from public.messages x where not (x.conversation_id = any(v_all_convs));
  perform private.demo_heartbeat();
  perform pg_temp._chk(
    v_h1 = (select md5(string_agg(x::text, '|' order by x::text)) from public.profiles x where not (x.id = any(v_demo)))
    and v_h2 = (select md5(string_agg(x::text, '|' order by x::text)) from public.user_presence x where not (x.user_id = any(v_demo)))
    and v_h3 = (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.his x where not (x.id = any(v_his)))
    and v_h4 = (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.conversations x where not (x.id = any(v_all_convs)))
    and v_h5 = (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.messages x where not (x.conversation_id = any(v_all_convs))),
    'heartbeat leaves every non-demo profile, presence, hi, conversation and message byte-identical');
  select extract(hour from now() at time zone timezone)::int into v_hr from public.campuses where slug = '${CAMPUS_SLUG}';
  perform set_config('request.jwt.claim.sub', v_izaac::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_izaac, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) filter (where tier = 'on_campus'), count(*) filter (where tier = 'nearby'), count(*) filter (where is_online), count(*) filter (where here_now)
    into v_n, v_n2, v_n3, v_n4
    from public.grid_for_me() g where g.user_id = any(v_demo);
  execute 'reset role';
  perform pg_temp._chk(v_n between 6 and 9 and v_n2 between 5 and 8 and v_n3 between 8 and 12
                       and (case when v_hr between 8 and 21 then v_n4 between 2 and 4 else v_n4 = 0 end),
    'grid after a beat (campus hour ' || v_hr || '): on campus ' || v_n || ', nearby ' || v_n2 || ', online ' || v_n3 || ', here now ' || v_n4);
  select count(*) into v_n from generate_series(0, 1007) s(i)
   cross join lateral (
     select count(*) filter (where p.tier = 'on_campus') as oc, count(*) filter (where p.tier = 'nearby') as nb,
            count(*) filter (where p.is_online) as onl, count(*) filter (where p.here_now) as hn,
            count(*) filter (where p.here_now and (p.tier <> 'on_campus' or not p.is_online)) as bad,
            (select extract(hour from (now() + s.i * interval '10 minutes') at time zone timezone)::int from public.campuses where slug = '${CAMPUS_SLUG}') as hr
       from private.demo_presence_plan(now() + s.i * interval '10 minutes') p) z
   where not (z.oc between 6 and 9 and z.nb between 5 and 8 and z.onl between 8 and 12 and z.bad = 0
              and case when z.hr between 8 and 21 then z.hn between 2 and 4 else z.hn = 0 end);
  perform pg_temp._chk(v_n = 0, 'presence plan holds its ranges in all 1008 ten-minute buckets of the next 7 days (' || v_n || ' violations)');
  select count(distinct p.user_id) into v_n from generate_series(0, 143) s(i)
   cross join lateral private.demo_presence_plan(now() + s.i * interval '10 minutes') p where p.tier = 'on_campus';
  perform pg_temp._chk(v_n >= 15, 'presence rotates: ' || v_n || ' different people on campus over 24 hours');
  -- keep-alive: age a pending hi and an awaiting conversation, beat, expect them re-anchored
  update public.his set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = '${keepAlive.his[0].id}';
  update public.conversations set created_at = now() - interval '6 days 12 hours' where id = '${keepAlive.conversations[0].id}';
  perform private.demo_heartbeat();
  perform pg_temp._chk((select state = 'sent' and created_at = now() - make_interval(mins => ${keepAlive.his[0].minutes}) and expires_at > now() + interval '6 days' from public.his where id = '${keepAlive.his[0].id}'), 'heartbeat keeps a seeded pending hi from expiring');
  perform pg_temp._chk((select c.state = 'awaiting_reply' and c.created_at = now() - make_interval(mins => ${keepAlive.conversations[0].created}) and m.created_at = now() - make_interval(mins => ${keepAlive.conversations[0].minutes}) from public.conversations c join public.messages m on m.conversation_id = c.id where c.id = '${keepAlive.conversations[0].id}'), 'heartbeat keeps a seeded awaiting_reply conversation from expiring');
  perform pg_temp._chk(current_setting('app.bypass_profiles_guard', true) is distinct from 'on', 'bypass flag restored after the heartbeat');`);

  const decl = `do $assert$
declare
  v_demo uuid[] := ${arr(demoIds)};
  v_his uuid[] := ${arr(seeded.his)};
  v_all_convs uuid[] := ${arr(seeded.conversations)};
  v_albums uuid[] := ${arr(seeded.albums.map((a) => a.id))};
${accounts.map((A) => `  v_convs_${A.key} uuid[] := ${arr(A.conversations.map((c) => c.id))};`).join("\n")}
  v_izaac uuid; v_debbie uuid;
  v_n int; v_n2 int; v_n3 int; v_n4 int; v_n5 int; v_n6 int; v_n7 int; v_n8 int; v_hr int;
  v_txt text; v_txt2 text; v_txt3 text; v_h1 text; v_h2 text; v_h3 text; v_h4 text; v_h5 text;
begin
${ACCOUNTS.map((a) => `  select p.id into v_${a.key} from public.profiles p join auth.users u on u.id = p.id where lower(p.first_name) = lower(${q(a.firstName)}) and not (${DEMO_EMAIL_PRED("u.email")});`).join("\n")}
  perform pg_temp._chk((select count(*) from public.profiles) = (select v::int from _demo_baseline where k = 'rows:public.profiles') + ${people.length}, 'idempotent: the second seed run added nothing (profiles = baseline + ${people.length})');
  perform pg_temp._chk((select count(*) from public.messages) = (select v::int from _demo_baseline where k = 'rows:public.messages') + ${accounts.reduce((n, A) => n + A.expect.messages, 0)}, 'idempotent: messages = baseline + ${accounts.reduce((n, A) => n + A.expect.messages, 0)}');
${asserts.join("\n")}
end;
$assert$;
`;

  const final = `do $final$
declare
  v_out   text;
  v_fail  integer;
  v_total integer;
begin
  -- After two unseeds: the database matches the baseline taken before the seed.
  perform pg_temp._chk(not exists (
      select 1 from _demo_baseline b full join pg_temp._demo_snapshot() s on s.k = b.k
       where b.v is distinct from s.v),
    'after unseed every table, bucket, cron job list and campus row matches the baseline: ' || coalesce((
      select string_agg(coalesce(b.k, s.k) || ' ' || coalesce(b.v, '-') || ' -> ' || coalesce(s.v, '-'), '; ')
        from _demo_baseline b full join pg_temp._demo_snapshot() s on s.k = b.k
       where b.v is distinct from s.v), 'no differences'));
  perform pg_temp._chk(not exists (select 1 from cron.job where jobname = '${JOB_NAME}'), 'no ${JOB_NAME} cron job after unseed');
  perform pg_temp._chk(not exists (select 1 from public.campuses where '${DEMO_DOMAIN}' = any(email_domains)), 'demo domain removed from CLC');

  select count(*) filter (where not ok), count(*) into v_fail, v_total from _demo_results;
  select string_agg(case when ok then 'ok ' else 'NOT OK ' end || n || ' - ' || label, E'\\n' order by n) into v_out from _demo_results;
  raise exception E'tmp_demo_rehearsal (always rolls back)\\n%\\n\\n% passed, % failed (of %)', v_out, v_total - v_fail, v_fail, v_total;
end;
$final$;
`;

  return `-- tmp_demo_rehearsal: GENERATED by build-seed.mjs. Runs the seed twice, asserts, runs the unseed
-- twice, compares against a baseline taken first, and ALWAYS raises, so nothing persists.
-- Run with apply_migration (name tmp_demo_rehearsal); the report is in the error text.
${baseline}
-- ======================= seed (first run) =======================
${seed}
-- ======================= seed (second run: must change nothing) =======================
update public.campuses
   set email_domains = array_append(email_domains, '${DEMO_DOMAIN}')
 where slug = '${CAMPUS_SLUG}'
   and not ('${DEMO_DOMAIN}' = any(email_domains));
select pg_temp._demo_seed();
select cron.schedule('${JOB_NAME}', '*/10 * * * *', $$select private.demo_heartbeat()$$);
select private.demo_heartbeat();
-- ======================= assertions =======================
${decl}
-- ======================= unseed (twice) =======================
${unseed}
-- second run: must be a no-op
do $unseed2$
begin
  if exists (select 1 from cron.job where jobname = '${JOB_NAME}') then
    perform cron.unschedule('${JOB_NAME}');
  end if;
end;
$unseed2$;
drop function if exists private.demo_heartbeat();
drop function if exists private.demo_presence_plan(timestamptz);
drop function if exists private.demo_hash(text);
select pg_temp._demo_unseed_rows();
-- ======================= compare and raise =======================
${final}`;
}

// -----------------------------------------------------------------------------
// Write
// -----------------------------------------------------------------------------

const seed = seedSql();
const unseed = unseedSql();
writeFileSync(join(HERE, "seed.generated.sql"), seed);
writeFileSync(join(HERE, "unseed.generated.sql"), unseed);
writeFileSync(join(HERE, "rehearsal.generated.sql"), rehearsalSql(seedSql({ wrapForRehearsal: true }), unseedSql({ wrapForRehearsal: true })));
writeFileSync(
  join(HERE, "upload-plan.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      note: "Object paths starting with {izaac}/ or {debbie}/ are resolved by upload.mjs to that real account's user id at upload time. Entries with skip are not uploaded.",
      manifest_found: manifestNames.size > 0,
      images: uploads,
    },
    null,
    2
  ) + "\n"
);

const missing = uploads.filter((x) => !x.exists && !x.skip).length;
console.log(`people: ${people.length}, photos: ${people.reduce((n, p) => n + p.photo_count, 0)}`);
for (const A of accounts) console.log(`${A.key}: ${JSON.stringify(A.expect)}`);
console.log(`upload plan: ${uploads.length} images (${uploads.filter((x) => x.skip).length} skipped, ${missing} files not present yet)`);
if (adjustments.length) {
  console.log("\ncontent the schema could not represent as written:");
  for (const a of adjustments) console.log(" - " + a);
}
if (warnings.length) console.log(`\n${warnings.length} warning(s)`);
console.log("\nwrote seed.generated.sql, unseed.generated.sql, rehearsal.generated.sql, upload-plan.json");
