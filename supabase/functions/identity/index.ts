// OhHi · `identity` edge function — one function, five routes, payload v2.
// docs/edge-identity-plan.md; decisions 16, 19, 20-24; the profile restructure
// (docs/design/profile-restructure/reconcile.md and its owner rulings).
//
//   GET  /functions/v1/identity/:user_id                        owner, or per-card audience
//   PUT  /functions/v1/identity                                 owner only (v1 or v2 body)
//   GET  /functions/v1/identity/card/:user_id                   owner, or an active card share
//   GET  /functions/v1/identity/card/:user_id/reveal/:section   owner, or a share that ticked it
//   PUT  /functions/v1/identity/card                            owner only (v2 body)
//
// See README.md for the exact request and response shapes.
//
// This file is wiring only: the caller-JWT verifier, the crypto, and the
// service-role Postgres client are handed to the router, which holds the whole
// request path (see router.ts). Keeping them apart is what lets index_test.ts
// exercise routing and authorization with fakes and no network.

import { callerUid } from "../_shared/supabase.ts";
import { createDb } from "./db.ts";
import { decryptPayload, encryptPayload } from "./crypto.ts";
import { createHandler } from "./router.ts";

Deno.serve(
  createHandler({
    db: createDb(),
    callerUid,
    encrypt: encryptPayload,
    decrypt: decryptPayload,
  }),
);
