// One-off backfill: identity and private-card payloads v1 -> v2.
// docs/design/profile-restructure/reconcile.md C7 and E phase 5; follows
// decision 23's rotation pattern (SQL cannot decrypt, so this runs in Deno
// with the key secrets).
//
// Run by ops, once, AFTER migration 0023 is live and the v2 function and app
// are deployed (the notice links to the new editor):
//
//   deno run --allow-env --allow-net --allow-read backfill_v2.ts --dry-run
//   deno run --allow-env --allow-net --allow-read backfill_v2.ts
//
// Environment (names only; values are never printed): OHHI_IDENTITY_KEY_V1,
// OHHI_CARD_KEY_V1 (and any other key_version in use), IDENTITY_DB_URL or
// SUPABASE_DB_URL (a role that is a member of service_role).
//
// Per user, in ONE transaction, with both rows locked:
//   1. identity row at payload_version 1: decrypt, run the word filter over a
//      free-text pronoun, map (mapping.ts), re-encrypt as v2.
//   2. card row at payload_version 1: decrypt, map. Its `into` becomes
//      `interested_in` on the identity payload ONLY if the identity card's
//      audience is `only_me` and `interested_in` is still empty; otherwise it
//      is held back, so nothing that was private-by-share is published
//      without the user seeing the notice first (brief §4, ruling 1).
//   3. write v2 (payload_version = 2); audiences and is_public unchanged.
//   4. when anything moved, was held back or was removed: one
//      `user_notices` row, kind `profile_moved`, payload
//      `{"moved": [...], "held_back": [...], "removed": [...]}` with FIELD
//      NAMES only, never values.
// Idempotent: only rows still at payload_version < 2 are touched, re-checked
// under the lock, so a second run (or a run racing a user's own save) is a
// no-op for rows already on v2. `--dry-run` does everything and rolls back.
//
// Output: one JSON line of counts. It never prints a payload, a typed entry,
// a key or the connection string.

import {
  asServiceRole,
  type CardRow,
  type CardWrite,
  closePool,
  type IdentityWrite,
  lockCardTx,
  lockIdentityTx,
  type Sql,
  type StoredIdentity,
  writeCardTx,
  writeIdentityTx,
} from "./db.ts";
import { decryptPayload, encryptPayload, type KeyDomain } from "./crypto.ts";
import {
  cardFieldsFilled,
  identityFieldsFilled,
  type IdentityPayloadV2,
} from "./fields.ts";
import {
  identityFromStored,
  mapCardV1,
  mapIdentityV1,
  type MapReport,
  mergeReports,
  note,
  pronounFilterCandidates,
  reportIsEmpty,
} from "./mapping.ts";

export const NOTICE_KIND = "profile_moved";

/** The database operations one user's backfill needs, all inside one transaction. */
export interface BackfillStore {
  lockIdentity(userId: string): Promise<StoredIdentity | null>;
  lockCard(userId: string): Promise<CardRow | null>;
  /** The subset of `texts` that fail `private.text_is_clean`. */
  dirtyTexts(texts: readonly string[]): Promise<Set<string>>;
  writeIdentity(userId: string, write: IdentityWrite): Promise<void>;
  writeCard(userId: string, write: CardWrite): Promise<void>;
  insertNotice(userId: string, payload: MapReport): Promise<void>;
}

export interface BackfillCrypto {
  encrypt: (
    domain: KeyDomain,
    payload: unknown,
  ) => Promise<{ ciphertext: Uint8Array; keyVersion: number }>;
  decrypt: (
    domain: KeyDomain,
    ciphertext: Uint8Array,
    keyVersion: number,
  ) => Promise<unknown>;
}

export interface UserOutcome {
  identity: "migrated" | "updated" | "unchanged";
  card: "migrated" | "unchanged";
  notice: MapReport | null;
}

/** Backfills one user. Pure apart from `store` and `crypto`; see the header. */
export async function backfillUser(
  userId: string,
  store: BackfillStore,
  crypto: BackfillCrypto,
): Promise<UserOutcome> {
  const identity = await store.lockIdentity(userId);
  const card = await store.lockCard(userId);
  const reports: MapReport[] = [];

  let identityPayload: IdentityPayloadV2 | null = null;
  let identityOutcome: UserOutcome["identity"] = "unchanged";

  if (identity?.payload_ciphertext && identity.payload_version < 2) {
    const decrypted = await crypto.decrypt(
      "identity",
      identity.payload_ciphertext,
      identity.key_version,
    );
    const candidates = pronounFilterCandidates(decrypted);
    const dirty = candidates.length > 0
      ? await store.dirtyTexts(candidates)
      : new Set<string>();
    const mapped = mapIdentityV1(decrypted, { dirty });
    identityPayload = mapped.payload;
    identityOutcome = "migrated";
    reports.push(mapped.report);
  }

  let cardOutcome: UserOutcome["card"] = "unchanged";
  if (card?.payload_ciphertext && card.payload_version < 2) {
    const decrypted = await crypto.decrypt(
      "card",
      card.payload_ciphertext,
      card.key_version,
    );
    const mapped = mapCardV1(decrypted);
    reports.push(mapped.report);

    if (mapped.interestedIn.length > 0) {
      const extra: MapReport = { moved: [], held_back: [], removed: [] };
      if (identity && identity.audiences.identity === "only_me") {
        if (identityPayload === null) {
          identityPayload = identity.payload_ciphertext
            ? identityFromStored(
              identity.payload_version,
              await crypto.decrypt(
                "identity",
                identity.payload_ciphertext,
                identity.key_version,
              ),
            )
            : identityFromStored(2, {});
        }
        if (identityPayload.interested_in.length === 0) {
          identityPayload.interested_in = mapped.interestedIn;
          if (identityOutcome === "unchanged") identityOutcome = "updated";
          note(extra, "moved", "interested_in");
        } else {
          // The user already chose a v2 value; theirs wins.
          note(extra, "removed", "into");
        }
      } else {
        note(extra, "held_back", "interested_in");
      }
      reports.push(extra);
    }

    const { ciphertext, keyVersion } = await crypto.encrypt("card", mapped.payload);
    await store.writeCard(userId, {
      ciphertext,
      keyVersion,
      fieldsFilled: cardFieldsFilled(mapped.payload),
    });
    cardOutcome = "migrated";
  }

  if (identity && identityPayload && identityOutcome !== "unchanged") {
    const { ciphertext, keyVersion } = await crypto.encrypt("identity", identityPayload);
    await store.writeIdentity(userId, {
      ciphertext,
      keyVersion,
      fieldsFilled: identityFieldsFilled(identityPayload),
      isPublic: identity.is_public,
      audiences: identity.audiences,
    });
  }

  const report = mergeReports(...reports);
  if (reportIsEmpty(report)) {
    return { identity: identityOutcome, card: cardOutcome, notice: null };
  }
  await store.insertNotice(userId, report);
  return { identity: identityOutcome, card: cardOutcome, notice: report };
}

/** The real store, bound to one service_role transaction. */
export function txStore(tx: Sql): BackfillStore {
  return {
    lockIdentity: (userId) => lockIdentityTx(tx, userId),
    lockCard: (userId) => lockCardTx(tx, userId),
    async dirtyTexts(texts) {
      const dirty = new Set<string>();
      for (const text of texts) {
        const rows: { clean: boolean }[] = await tx`
          select private.text_is_clean(${text}::text) as clean
        `;
        if (rows[0]?.clean !== true) dirty.add(text);
      }
      return dirty;
    },
    async writeIdentity(userId, write) {
      await writeIdentityTx(tx, userId, write);
    },
    async writeCard(userId, write) {
      await writeCardTx(tx, userId, write);
    },
    async insertNotice(userId, payload) {
      await tx`
        insert into public.user_notices (user_id, kind, payload)
        values (${userId}::uuid, ${NOTICE_KIND}, ${JSON.stringify(payload)}::jsonb)
      `;
    },
  };
}

class DryRunRollback extends Error {
  constructor() {
    super("dry run");
    this.name = "DryRunRollback";
  }
}

async function main(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const ids = await asServiceRole<{ user_id: string }[]>((tx) =>
    tx`
      select user_id from public.user_identity where payload_version < 2
      union
      select user_id from public.user_private_card where payload_version < 2
    `
  );

  const tally = {
    fn: "identity-backfill-v2",
    dry_run: dryRun,
    users: ids.length,
    identity_migrated: 0,
    identity_updated: 0,
    card_migrated: 0,
    notices: 0,
    failed: 0,
    failed_user_ids: [] as string[],
  };

  for (const { user_id: userId } of ids) {
    try {
      await asServiceRole(async (tx: Sql) => {
        const outcome = await backfillUser(userId, txStore(tx), {
          encrypt: encryptPayload,
          decrypt: decryptPayload,
        });
        if (outcome.identity === "migrated") tally.identity_migrated += 1;
        if (outcome.identity === "updated") tally.identity_updated += 1;
        if (outcome.card === "migrated") tally.card_migrated += 1;
        if (outcome.notice) tally.notices += 1;
        if (dryRun) throw new DryRunRollback();
      });
    } catch (err) {
      if (err instanceof DryRunRollback) continue;
      tally.failed += 1;
      tally.failed_user_ids.push(userId);
      // The class only: a driver message can carry a bound parameter.
      console.error(JSON.stringify({
        fn: "identity-backfill-v2",
        user_id: userId,
        error: err instanceof Error ? err.name : "unknown",
      }));
    }
  }

  console.log(JSON.stringify(tally));
  await closePool();
  if (tally.failed > 0) Deno.exit(1);
}

if (import.meta.main) {
  await main(Deno.args);
}
