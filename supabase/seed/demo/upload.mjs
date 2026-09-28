#!/usr/bin/env node
// Uploads the demo seed's images to Supabase Storage (hosted project Sayohhi).
//
//   node supabase/seed/demo/upload.mjs --dry-run   # check files and paths, no network
//   node supabase/seed/demo/upload.mjs             # upload everything in upload-plan.json
//
// Reads upload-plan.json (written by build-seed.mjs). Every entry names a local
// file, a bucket and an object path; entries with "skip" are not uploaded.
// Object paths that start with {izaac}/ or {debbie}/ (the real accounts' own
// albums) are resolved at run time to that account's user id, by first name
// and a non-demo email domain, exactly as the seed SQL resolves them.
//
// The service-role key comes from SUPABASE_SERVICE_ROLE_KEY if set, otherwise
// from `supabase projects api-keys --project-ref <ref> -o json` (the CLI reads
// the repo-root .env for its access token). The key is held in memory only:
// never printed, never written anywhere.
//
// Uploads use upsert: true, so a re-run replaces objects in place.
// Uses @supabase/supabase-js from app/node_modules; no other dependencies.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const PROJECT_REF = "yvmxyynxpheudnyoveqx";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const DEMO_DOMAIN = "demo.sayohhi.com";
const REAL_ACCOUNTS = { izaac: "Izaac", debbie: "Debbie" };
const CONCURRENCY = 4;

const dryRun = process.argv.includes("--dry-run");

function fail(message) {
  console.error(`upload: ${message}`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// Plan
// -----------------------------------------------------------------------------

const planPath = join(HERE, "upload-plan.json");
if (!existsSync(planPath)) fail("upload-plan.json not found; run `node supabase/seed/demo/build-seed.mjs` first");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const entries = plan.images.filter((e) => !e.skip);
const skipped = plan.images.filter((e) => e.skip);
const missing = entries.filter((e) => !existsSync(join(REPO, e.file)));

console.log(`plan: ${plan.images.length} images, ${entries.length} to upload, ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skip ${s.name}: ${s.skip}`);
if (missing.length) {
  console.log(`missing local files (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.file}`);
}

const byBucket = entries.reduce((acc, e) => ((acc[e.bucket] = (acc[e.bucket] ?? 0) + 1), acc), {});
console.log(`by bucket: ${Object.entries(byBucket).map(([b, n]) => `${b} ${n}`).join(", ")}`);

if (dryRun) {
  for (const e of entries) console.log(`  ${e.bucket}/${e.path}  <-  ${e.file}${existsSync(join(REPO, e.file)) ? "" : "  (missing)"}`);
  console.log(missing.length ? `\ndry run: ${missing.length} file(s) still missing` : "\ndry run: every file is present");
  process.exit(missing.length ? 2 : 0);
}
if (missing.length) fail(`${missing.length} local file(s) missing; generate the images first (see the list above)`);

// -----------------------------------------------------------------------------
// Service-role key (never printed or written)
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
let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch {
  fail("@supabase/supabase-js not found in app/node_modules; run `npm install` in app/");
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -----------------------------------------------------------------------------
// Real-account placeholders
// -----------------------------------------------------------------------------

async function resolveRealAccount(key) {
  const firstName = REAL_ACCOUNTS[key];
  if (!firstName) fail(`unknown placeholder {${key}}`);
  const { data, error } = await supabase.from("profiles").select("id, first_name").ilike("first_name", firstName);
  if (error) fail(`profiles lookup for ${firstName} failed: ${error.message}`);
  const candidates = [];
  for (const row of data ?? []) {
    if ((row.first_name ?? "").toLowerCase() !== firstName.toLowerCase()) continue;
    const { data: u, error: uerr } = await supabase.auth.admin.getUserById(row.id);
    if (uerr) fail(`auth lookup for ${firstName} failed: ${uerr.message}`);
    const domain = (u?.user?.email ?? "").split("@")[1]?.toLowerCase();
    if (domain && domain !== DEMO_DOMAIN) candidates.push(row.id);
  }
  if (candidates.length !== 1) fail(`expected exactly one real account named ${firstName}, found ${candidates.length}`);
  return candidates[0];
}

const placeholders = new Set(entries.map((e) => e.ownerPlaceholder).filter(Boolean));
const resolved = {};
for (const key of placeholders) resolved[key] = await resolveRealAccount(key);
const objectPath = (e) => e.path.replace(/^\{(\w+)\}/, (_, k) => resolved[k]);

// -----------------------------------------------------------------------------
// Upload
// -----------------------------------------------------------------------------

let done = 0;
const failures = [];
async function uploadOne(e) {
  const path = objectPath(e);
  const body = readFileSync(join(REPO, e.file));
  const { error } = await supabase.storage.from(e.bucket).upload(path, body, {
    contentType: e.contentType ?? "image/jpeg",
    upsert: true,
  });
  done++;
  if (error) {
    failures.push(`${e.bucket}/${path}: ${error.message}`);
    console.log(`  [${done}/${entries.length}] FAILED ${e.name}: ${error.message}`);
  } else {
    console.log(`  [${done}/${entries.length}] ${e.bucket}/${path}`);
  }
}

const queue = [...entries];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await uploadOne(queue.shift());
  })
);

if (failures.length) {
  console.error(`\n${failures.length} upload(s) failed:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`\nuploaded ${entries.length} object(s)`);
