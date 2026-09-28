// OhHi · `media-open` edge function — one route.
// docs/chat-media-plan.md §4; decisions CM-1..CM-4.
//
//   POST /functions/v1/media-open  { message_id: uuid }
//
// This file is wiring only: the caller-JWT verifier, the direct-Postgres
// `Db`, and the service-role Storage client are handed to the router, which
// holds the whole request path (see router.ts). Keeping them apart is what
// lets router_test.ts exercise routing and authorization with fakes and no
// network — the same split `identity/index.ts` uses.

import { callerUid } from "../_shared/supabase.ts";
import { createDb } from "./db.ts";
import { createStorageClient } from "./storage.ts";
import { createHandler } from "./router.ts";

Deno.serve(
  createHandler({
    db: createDb(),
    callerUid,
    storage: createStorageClient(),
  }),
);
