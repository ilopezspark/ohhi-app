// OhHi · `identity` edge function — one function, four routes.
// docs/edge-identity-plan.md; decisions 16, 19, 20-24.
//
//   GET  /functions/v1/identity/:user_id        owner or is_public
//   PUT  /functions/v1/identity                 owner only
//   GET  /functions/v1/identity/card/:user_id   owner or private.share_is_active
//   PUT  /functions/v1/identity/card            owner only
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
