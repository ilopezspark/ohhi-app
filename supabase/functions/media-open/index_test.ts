// Exercises router.ts (which index.ts only wires up) against a fake Db and
// fake Storage client, so nothing here opens a socket. Named index_test.ts
// to match docs/chat-media-plan.md §9's naming, same as identity's
// index_test.ts, which likewise tests router.ts through the wiring seam.

import { assert, assertEquals } from "@std/assert";
import type { Db, MessageMediaRow, OpenedMedia } from "./db.ts";
import type { StorageClient } from "./storage.ts";
import {
  createHandler,
  RATE_LIMIT_MAX,
  resetRateLimit,
  type RouterDeps,
  routeSegments,
} from "./router.ts";

const SENDER = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const MESSAGE = "55555555-5555-4555-8555-555555555555";

interface FakeState {
  message?: MessageMediaRow | null;
  canRead?: boolean;
  opened?: OpenedMedia | null;
  openedThrows?: Error;
  signFails?: boolean;
}

interface Harness {
  handle: (req: Request) => Promise<Response>;
  calls: string[];
  logs: Record<string, unknown>[];
}

function photoRow(overrides: Partial<MessageMediaRow> = {}): MessageMediaRow {
  return {
    conversation_id: CONVERSATION,
    sender_id: SENDER,
    media_kind: "photo",
    media_path: `${CONVERSATION}/${MESSAGE}.jpg`,
    media_poster_path: null,
    view_limit: 1,
    views_used: 0,
    ...overrides,
  };
}

function videoOpened(overrides: Partial<OpenedMedia> = {}): OpenedMedia {
  return {
    media_path: `${CONVERSATION}/${MESSAGE}.mp4`,
    media_poster_path: `${CONVERSATION}/${MESSAGE}-poster.jpg`,
    media_kind: "video",
    views_used: 1,
    view_limit: 2,
    ...overrides,
  };
}

function harness(state: FakeState, uid: string | null = RECIPIENT): Harness {
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];

  const db: Db = {
    getMessageMedia(messageId) {
      calls.push(`getMessageMedia:${messageId}`);
      return Promise.resolve(state.message ?? null);
    },
    canReadConversation(conversationId, viewerId) {
      calls.push(`canReadConversation:${conversationId}:${viewerId}`);
      return Promise.resolve(state.canRead === true);
    },
    openLimitedMedia(messageId, viewerId) {
      calls.push(`openLimitedMedia:${messageId}:${viewerId}`);
      if (state.openedThrows) return Promise.reject(state.openedThrows);
      return Promise.resolve(state.opened ?? null);
    },
  };

  const storage: StorageClient = {
    from(bucket) {
      return {
        createSignedUrl(path, expiresIn) {
          calls.push(`sign:${bucket}:${path}:${expiresIn}`);
          if (state.signFails) {
            return Promise.resolve({ data: null, error: { message: "nope" } });
          }
          return Promise.resolve({
            data: { signedUrl: `https://signed/${path}` },
            error: null,
          });
        },
      };
    },
  };

  const deps: RouterDeps = {
    db,
    storage,
    callerUid: () => Promise.resolve(uid),
    log: (entry) => logs.push(entry),
  };

  resetRateLimit();
  return { handle: createHandler(deps), calls, logs };
}

function post(
  body: unknown,
  headers: Record<string, string> = { Authorization: "Bearer t" },
): Request {
  return new Request("https://p.supabase.co/functions/v1/media-open", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

Deno.test("routing: both spellings of the mount normalize to no segments", () => {
  assertEquals(routeSegments("/functions/v1/media-open"), []);
  assertEquals(routeSegments("/media-open"), []);
});

// ---------------------------------------------------------------------------
// Auth -- never 401 (plan §4 step 1)
// ---------------------------------------------------------------------------

Deno.test("auth: no verified caller is a generic 404, and no DB call is made", async () => {
  const h = harness({}, null);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "not_found");
  assertEquals(h.calls, []);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

Deno.test("validation: a malformed message_id is 400, not 404", async () => {
  const h = harness({});
  const res = await h.handle(post({ message_id: "not-a-uuid" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "validation_failed");
  assertEquals(h.calls, []);
});

Deno.test("validation: a missing message_id is 400", async () => {
  const h = harness({});
  const res = await h.handle(post({}));
  assertEquals(res.status, 400);
});

Deno.test("validation: malformed JSON is a 400 that does not echo the body", async () => {
  const h = harness({});
  const secret = "message-id-the-caller-typed";
  const res = await h.handle(post(`{ "message_id": "${secret}" `));
  assertEquals(res.status, 400);
  const text = await res.text();
  assertEquals(text.includes(secret), false);
});

// ---------------------------------------------------------------------------
// Keep-in-chat message
// ---------------------------------------------------------------------------

Deno.test("keep-in-chat: view_limit null reads back as not found, so it's a 404", async () => {
  // db.getMessageMedia's own query filters view_limit is not null; the fake
  // stands in for "no such row" the same way the real query would.
  const h = harness({ message: null });
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// Sender path (CM-3)
// ---------------------------------------------------------------------------

Deno.test("sender: mints a signed URL without calling the RPC", async () => {
  const h = harness({ message: photoRow() }, SENDER);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    url: `https://signed/${CONVERSATION}/${MESSAGE}.jpg`,
    kind: "photo",
    expires_in: 60,
    views_remaining: 1,
  });
  assert(!h.calls.some((c) => c.startsWith("openLimitedMedia")));
  assert(!h.calls.some((c) => c.startsWith("canReadConversation")));
});

Deno.test("sender: views_remaining reflects the row even after the recipient has opened it", async () => {
  const h = harness({ message: photoRow({ view_limit: 2, views_used: 1 }) }, SENDER);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals((await res.json()).views_remaining, 1);
});

// ---------------------------------------------------------------------------
// Recipient path
// ---------------------------------------------------------------------------

Deno.test("recipient: not a participant (can_read_conversation false) is 404, no RPC call", async () => {
  const h = harness({ message: photoRow(), canRead: false }, STRANGER);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 404);
  assert(!h.calls.some((c) => c.startsWith("openLimitedMedia")));
});

Deno.test("recipient: happy path calls the RPC once and returns a signed URL", async () => {
  const h = harness({
    message: photoRow(),
    canRead: true,
    opened: {
      media_path: `${CONVERSATION}/${MESSAGE}.jpg`,
      media_poster_path: null,
      media_kind: "photo",
      views_used: 1,
      view_limit: 1,
    },
  }, RECIPIENT);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    url: `https://signed/${CONVERSATION}/${MESSAGE}.jpg`,
    kind: "photo",
    expires_in: 60,
    views_remaining: 0,
  });
  assertEquals(h.calls.filter((c) => c.startsWith("openLimitedMedia")).length, 1);
});

Deno.test("recipient: exhausted is 404 and no URL is minted", async () => {
  const h = harness({ message: photoRow(), canRead: true, opened: null }, RECIPIENT);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 404);
  assert(!h.calls.some((c) => c.startsWith("sign:")));
});

Deno.test("recipient: an RPC exception is also a plain 404, not a 500", async () => {
  const h = harness(
    { message: photoRow(), canRead: true, openedThrows: new Error("row locked") },
    RECIPIENT,
  );
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 404);
});

Deno.test("video: also signs the poster path", async () => {
  const h = harness({
    message: photoRow({ media_kind: "video" }),
    canRead: true,
    opened: videoOpened(),
  }, RECIPIENT);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.kind, "video");
  assertEquals(body.poster_url, `https://signed/${CONVERSATION}/${MESSAGE}-poster.jpg`);
  assertEquals(body.views_remaining, 1);
  assert(
    h.calls.includes(`sign:chat-media-limited:${CONVERSATION}/${MESSAGE}-poster.jpg:60`),
  );
});

Deno.test("signing failure is a 500, not a leaked 404", async () => {
  const h = harness({
    message: photoRow(),
    canRead: true,
    opened: {
      media_path: `${CONVERSATION}/${MESSAGE}.jpg`,
      media_poster_path: null,
      media_kind: "photo",
      views_used: 1,
      view_limit: 1,
    },
    signFails: true,
  }, RECIPIENT);
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 500);
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

Deno.test("routing: wrong method or extra path segments are the generic 404", async () => {
  const h = harness({ message: photoRow() }, SENDER);
  const cases = [
    new Request("https://p.supabase.co/functions/v1/media-open", {
      method: "GET",
      headers: { Authorization: "Bearer t" },
    }),
    new Request("https://p.supabase.co/functions/v1/media-open/extra", {
      method: "POST",
      headers: { Authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ message_id: MESSAGE }),
    }),
  ];
  for (const req of cases) {
    const res = await h.handle(req);
    assertEquals(res.status, 404, `${req.method} ${req.url}`);
  }
});

// ---------------------------------------------------------------------------
// Cache-Control
// ---------------------------------------------------------------------------

Deno.test("Cache-Control: no-store is present on both a success and a refusal", async () => {
  const okHarness = harness({ message: photoRow() }, SENDER);
  const ok = await okHarness.handle(post({ message_id: MESSAGE }));
  assertEquals(ok.headers.get("Cache-Control"), "no-store");

  const refusedHarness = harness({ message: null }, RECIPIENT);
  const refused = await refusedHarness.handle(post({ message_id: MESSAGE }));
  assertEquals(refused.headers.get("Cache-Control"), "no-store");
});

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

Deno.test("rate limit: the 31st request in a window is 429", async () => {
  const h = harness({ message: photoRow() }, SENDER);
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    assertEquals(
      (await h.handle(post({ message_id: MESSAGE }))).status,
      200,
      `request ${i + 1}`,
    );
  }
  const res = await h.handle(post({ message_id: MESSAGE }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, "rate_limited");
});

Deno.test("rate limit: the budget is per user, not global", async () => {
  let uid = SENDER;
  const state: FakeState = { message: photoRow() };
  resetRateLimit();
  const handle = createHandler({
    db: {
      getMessageMedia: () => Promise.resolve(state.message ?? null),
      canReadConversation: () => Promise.resolve(true),
      openLimitedMedia: () => Promise.resolve(null),
    },
    storage: {
      from: () => ({
        createSignedUrl: (path: string) =>
          Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
    callerUid: () => Promise.resolve(uid),
    log: () => {},
  });
  for (let i = 0; i < RATE_LIMIT_MAX; i++) await handle(post({ message_id: MESSAGE }));
  assertEquals((await handle(post({ message_id: MESSAGE }))).status, 429);
  uid = RECIPIENT;
  // RECIPIENT isn't the sender, but canReadConversation is stubbed true and
  // openLimitedMedia null -> 404, still proving the budget reset for a new user.
  assertEquals((await handle(post({ message_id: MESSAGE }))).status, 404);
});

// ---------------------------------------------------------------------------
// Log hygiene
// ---------------------------------------------------------------------------

Deno.test("logs: every line carries route/user/status and no payload", async () => {
  const h = harness({ message: photoRow() }, SENDER);
  await h.handle(post({ message_id: MESSAGE }));
  assertEquals(h.logs.length, 1);
  const entry = h.logs[0];
  assertEquals(entry.fn, "media-open");
  assertEquals(entry.route, "POST /");
  assertEquals(entry.user_id, SENDER);
  assertEquals(entry.status, 200);
  assertEquals(typeof entry.ms, "number");
  assertEquals(JSON.stringify(entry).includes(MESSAGE), false);
});
