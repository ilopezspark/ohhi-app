#!/usr/bin/env node
// Writes the missing thumbnails for images already in Storage (hosted project Sayohhi).
// The contract is docs/thumbnails.md and migration 0027 (20260918000027_thumbnails.sql).
//
//   node supabase/scripts/backfill-thumbnails.mjs --dry-run
//   node supabase/scripts/backfill-thumbnails.mjs
//   node supabase/scripts/backfill-thumbnails.mjs --bucket album-photos --concurrency 8
//   node supabase/scripts/backfill-thumbnails.mjs --exclude pending-purge.json
//
// For every {dir}/{stem}.jpg in profile-photos, album-photos and chat-media that has no
// {dir}/{stem}.thumb.jpg sibling, downloads the original with the service role, writes a
// thumbnail (JPEG, 480px long edge, quality 70, auto-rotated, no metadata, never enlarged) and
// uploads it with upsert: false. Video posters ({x}-poster.jpg) are images and get one; videos
// (.mp4) and existing .thumb.jpg objects are skipped. chat-media-limited is never touched:
// view-limited media must not leave a second copy (decision 62).
//
// Idempotent: a thumbnail that already exists is never rewritten (listed siblings are skipped,
// and a concurrent "already exists" on upload counts as skipped, not failed).
//
// --exclude <file>: a JSON array of "bucket/name" strings to leave alone. Use it for originals
// with an unprocessed private.storage_purge_queue row: purge-drain is about to delete them, and a
// thumbnail written now would outlive them (the 0027 trigger only enqueues thumbnails that exist
// when the original is enqueued). Produce it with (Supabase MCP execute_sql or psql):
//   select coalesce(json_agg(bucket_id || '/' || object_name), '[]')
//     from private.storage_purge_queue
//    where processed_at is null and bucket_id in ('profile-photos', 'album-photos', 'chat-media');
//
// The service-role key comes from SUPABASE_SERVICE_ROLE_KEY if set, otherwise from
// `supabase projects api-keys --project-ref <ref> -o json` (as supabase/seed/demo/upload.mjs).
// The key is held in memory only: never printed, never written anywhere.
// Uses sharp and @supabase/supabase-js from app/node_modules; no other dependencies.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THUMB_BUCKETS, makeThumb as makeThumbWith, thumbPathFor } from "./thumb-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROJECT_REF = "yvmxyynxpheudnyoveqx";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const BUCKETS = THUMB_BUCKETS;

function fail(message) {
  console.error(`backfill-thumbnails: ${message}`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Arguments
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
function option(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}
const known = new Set(["--dry-run", "--bucket", "--concurrency", "--exclude"]);
for (const a of args) if (a.startsWith("--") && !known.has(a)) fail(`unknown option ${a}`);

const dryRun = flag("--dry-run");
const concurrency = Number(option("--concurrency") ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) fail("--concurrency must be 1..32");
const onlyBucket = option("--bucket");
if (onlyBucket && !BUCKETS.includes(onlyBucket)) fail(`--bucket must be one of ${BUCKETS.join(", ")}`);
const buckets = onlyBucket ? [onlyBucket] : BUCKETS;

let exclude = new Set();
const excludeFile = option("--exclude");
if (excludeFile) {
  let list;
  try {
    list = JSON.parse(readFileSync(resolve(excludeFile), "utf8"));
  } catch (err) {
    fail(`could not read --exclude ${excludeFile}: ${err.message}`);
  }
  if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) fail("--exclude must hold a JSON array of strings");
  exclude = new Set(list);
}

// -----------------------------------------------------------------------------
// Clients (key never printed or written)
// -----------------------------------------------------------------------------

function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  let out;
  try {
    out = execFileSync("supabase", ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      timeout: 60_000,
    });
  } catch (err) {
    // stderr only: stdout could hold keys.
    fail(`could not read the API keys with the Supabase CLI (${String(err.stderr || err.message).trim().split("\n")[0]})`);
  }
  let keys;
  try {
    keys = JSON.parse(out);
  } catch {
    fail("the Supabase CLI did not return JSON for `projects api-keys`");
  }
  const list = Array.isArray(keys) ? keys : keys.keys ?? [];
  const hit =
    list.find((k) => k.name === "service_role" && k.api_key) ??
    list.find((k) => k.type === "secret" && k.api_key);
  if (!hit) fail("no service_role (or secret) key in the CLI's api-keys output");
  return hit.api_key;
}

const require = createRequire(join(REPO, "app", "package.json"));
let createClient, sharp;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch {
  fail("@supabase/supabase-js not found in app/node_modules; run `npm install` in app/");
}
try {
  sharp = require("sharp");
} catch {
  fail("sharp not found in app/node_modules; run `npm install` in app/");
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -----------------------------------------------------------------------------
// Listing (Storage lists one folder level at a time; folders have id === null)
// -----------------------------------------------------------------------------

async function listAll(bucket, prefix = "") {
  const files = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) fail(`list ${bucket}/${prefix} failed: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(bucket, path)));
      else files.push(path);
    }
    if (!data || data.length < PAGE) break;
  }
  return files;
}

const makeThumb = (input) => makeThumbWith(sharp, input);

// -----------------------------------------------------------------------------
// Run
// -----------------------------------------------------------------------------

const totals = {};
const failures = [];

for (const bucket of buckets) {
  const all = await listAll(bucket);
  const names = new Set(all);
  const t = (totals[bucket] = { objects: all.length, existing: 0, todo: 0, written: 0, skipped: 0, excluded: 0, failed: 0, bytesIn: 0, bytesOut: 0 });

  const todo = [];
  for (const path of all) {
    if (path.endsWith(".thumb.jpg")) {
      t.existing++;
      continue;
    }
    if (!path.endsWith(".jpg")) continue; // .mp4 and anything else: no thumbnail
    if (names.has(thumbPathFor(path))) continue;
    if (exclude.has(`${bucket}/${path}`)) {
      t.excluded++;
      continue;
    }
    todo.push(path);
  }
  t.todo = todo.length;
  console.log(`${bucket}: ${all.length} objects, ${t.existing} thumbnails already, ${todo.length} to write${t.excluded ? `, ${t.excluded} excluded` : ""}`);

  if (dryRun) {
    for (const p of todo) console.log(`  would write ${bucket}/${thumbPathFor(p)}`);
    continue;
  }

  let done = 0;
  const queue = [...todo];
  async function one(path) {
    const target = thumbPathFor(path);
    try {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error) throw new Error(`download: ${error.message}`);
      const input = Buffer.from(await data.arrayBuffer());
      const out = await makeThumb(input);
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(target, out, { contentType: "image/jpeg", upsert: false });
      done++;
      if (upErr) {
        if (/exists|duplicate/i.test(upErr.message)) {
          t.skipped++;
          console.log(`  [${bucket} ${done}/${todo.length}] exists ${target}`);
          return;
        }
        throw new Error(`upload: ${upErr.message}`);
      }
      t.written++;
      t.bytesIn += input.length;
      t.bytesOut += out.length;
      console.log(`  [${bucket} ${done}/${todo.length}] ${target} (${Math.round(input.length / 1024)} KB -> ${Math.round(out.length / 1024)} KB)`);
    } catch (err) {
      t.failed++;
      failures.push(`${bucket}/${path}: ${err.message}`);
      console.log(`  [${bucket}] FAILED ${path}: ${err.message}`);
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) await one(queue.shift());
    })
  );
}

console.log("\nsummary" + (dryRun ? " (dry run, nothing written)" : ""));
for (const [bucket, t] of Object.entries(totals)) {
  const sizes = t.written ? `, ${Math.round(t.bytesIn / 1024)} KB of originals -> ${Math.round(t.bytesOut / 1024)} KB of thumbnails` : "";
  console.log(
    `  ${bucket}: ${t.objects} objects, ${t.existing} thumbnails before, ${t.todo} missing` +
      (dryRun ? "" : `, ${t.written} written, ${t.skipped} already there, ${t.failed} failed`) +
      (t.excluded ? `, ${t.excluded} excluded` : "") +
      sizes
  );
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
