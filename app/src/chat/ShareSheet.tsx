import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AlbumRow } from '../api/albums';
import { currentUserId } from '../api/session';
import { listSharesForSubject, shareCardSections } from '../api/shares';
import { CARD_GROUP_LABELS, CARD_SECTION_LABELS } from '../me/card/fieldLabels';
import { fetchMyCard, MY_CARD_QUERY_KEY, sectionValues, tickableSections } from '../me/card/myCard';
import type { GatedSection } from '../profile/fields';
import { CARD_GROUPS } from '../settings/vocab';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AlbumIcon, CameraIcon, CheckIcon, PersonIcon } from '../ui/icons';
import { Button, Sheet, Text } from '../ui';

export interface ShareSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** `Chat-Share.html`'s "share with maya" title. */
  otherName: string;
  /**
   * The other person's id. Optional: when given, the card step starts from
   * the ticks of the card share they already have (if any) and says that
   * sharing again replaces it.
   */
  otherId?: string;
  /** Gates the whole sheet's "a photo" row — mirrors `composerState().canAttachMedia`. */
  canAttachMedia: boolean;
  /**
   * Gates "an album" / "the private card" — the server's mutuality check
   * (`enforce_share_rules` / `conversation_is_mutual`) is exactly
   * `state = 'open'` (`src/api/shares.ts#listShareCandidates`'s own doc
   * comment). Neutral copy when false; never says why.
   */
  canShareBeyondPhoto: boolean;
  onPickPhoto: () => void;
  albums: AlbumRow[] | undefined;
  albumsLoading: boolean;
  onShareAlbum: (albumId: string) => void;
  sharingAlbumId: string | null;
  /**
   * Share the private card with the intimacy sections ticked on this share
   * (owner ruling 6), in group order; `[]` shares the getting-closer group and
   * the boundaries only. The caller sends it through `api/shares.ts#shareCard`,
   * which also replaces an existing share without a gap.
   */
  onSharePrivateCard: (sections: GatedSection[]) => void;
  sharingCard: boolean;
  error?: string | null;
}

type Step = 'menu' | 'albums' | 'card';

/** The caller's active card share to `viewerId`, or null. */
async function activeCardShareSections(viewerId: string): Promise<GatedSection[] | null> {
  const shares = await listSharesForSubject('private_card', await currentUserId());
  const active = shares.find((share) => share.viewer_id === viewerId && !share.revoked_at);
  return active ? shareCardSections(active) : null;
}

/**
 * `Chat-Share.html`'s share tray — a photo / an album / the private card —
 * as a stepped `Sheet`: the menu, then an album picker for "an album", or
 * the card's ticking step for "more about me".
 *
 * The card step (owner ruling 6): getting closer and the boundaries always
 * go with the card; the sender ticks which intimacy sections go on this
 * share, and only sections with something in them can be ticked. Sharing
 * again with different ticks goes through the same call, which swaps the old
 * share for the new one in one step.
 */
export function ShareSheet({
  visible,
  onDismiss,
  otherName,
  otherId,
  canAttachMedia,
  canShareBeyondPhoto,
  onPickPhoto,
  albums,
  albumsLoading,
  onShareAlbum,
  sharingAlbumId,
  onSharePrivateCard,
  sharingCard,
  error,
}: ShareSheetProps) {
  const [step, setStep] = useState<Step>('menu');
  const [ticked, setTicked] = useState<GatedSection[]>([]);

  useEffect(() => {
    if (visible) setStep('menu');
  }, [visible]);

  const onCardStep = visible && step === 'card';
  const cardQuery = useQuery({ queryKey: MY_CARD_QUERY_KEY, queryFn: fetchMyCard, enabled: onCardStep });
  const existingQuery = useQuery({
    queryKey: ['share-sheet-card-share', otherId ?? ''],
    queryFn: () => activeCardShareSections(otherId!),
    enabled: onCardStep && !!otherId,
    staleTime: 0,
    gcTime: 0,
  });

  const tickable = tickableSections(cardQuery.data);
  const existing = existingQuery.data ?? null;

  // Start from what they already have (only what can still be ticked), else nothing ticked.
  useEffect(() => {
    if (!onCardStep) return;
    setTicked((existing ?? []).filter((section) => tickable.includes(section)));
    // `tickable` is derived from the card read; re-run when either read lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCardStep, existingQuery.data, cardQuery.data]);

  if (!visible) return null;

  const albumNames = (albums ?? []).map((a) => a.name).slice(0, 3).join(' · ');

  function toggleTick(section: GatedSection) {
    setTicked((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : CARD_GROUPS.gated.filter((s) => s === section || prev.includes(s))
    );
  }

  const errorLine = error ? (
    <Text variant="helper" color={colors.danger} testID="share-sheet-error">
      {error}
    </Text>
  ) : null;

  const backLink = (testID: string) => (
    <Pressable accessibilityRole="button" testID={testID} onPress={() => setStep('menu')}>
      <Text variant="helper" color={colors.ink}>
        ‹ back
      </Text>
    </Pressable>
  );

  return (
    <Sheet onDismiss={onDismiss} testID="share-sheet">
      {step === 'menu' ? (
        <>
          <Text variant="title" style={{ fontSize: 17 }}>
            share with {otherName}
          </Text>

          <View style={styles.rows}>
            {canAttachMedia ? (
              <ShareRow
                testID="share-sheet-photo"
                icon={<CameraIcon size={20} color={colors.ink} />}
                title="a photo or video"
                subtitle="from your camera roll, or recently shared"
                onPress={() => {
                  onDismiss();
                  onPickPhoto();
                }}
              />
            ) : null}

            <ShareRow
              testID="share-sheet-album"
              icon={<AlbumIcon size={20} color={colors.ink} />}
              title="an album"
              subtitle={canShareBeyondPhoto ? albumNames || 'your albums' : SHARE_UNAVAILABLE_COPY}
              disabled={!canShareBeyondPhoto}
              onPress={() => setStep('albums')}
            />

            <ShareRow
              testID="share-sheet-card"
              icon={<PersonIcon size={20} color={colors.ink} />}
              title="more about me"
              subtitle={
                canShareBeyondPhoto
                  ? `your private card: ${CARD_GROUP_LABELS.standard}, ${CARD_GROUP_LABELS.always_attached}, and anything you tick`
                  : SHARE_UNAVAILABLE_COPY
              }
              disabled={!canShareBeyondPhoto || sharingCard}
              onPress={() => setStep('card')}
            />
          </View>

          {errorLine}

          <Text variant="helper" style={styles.footer}>
            anything you share here, you can take back from {otherName}&apos;s profile. they&apos;ll know
            it&apos;s gone, not why.
          </Text>
        </>
      ) : step === 'albums' ? (
        <>
          {backLink('share-sheet-albums-back')}
          <Text variant="title" style={{ fontSize: 17 }}>
            share an album
          </Text>

          {albumsLoading ? (
            <ActivityIndicator testID="share-sheet-albums-loading" />
          ) : (albums ?? []).length === 0 ? (
            <Text variant="helper" testID="share-sheet-albums-empty">
              You don&apos;t have any albums yet.
            </Text>
          ) : (
            <View style={styles.rows}>
              {(albums ?? []).map((album) => (
                <ShareRow
                  key={album.id}
                  testID={`share-sheet-album-${album.id}`}
                  icon={<AlbumIcon size={20} color={colors.ink} />}
                  title={album.name}
                  subtitle={`${album.photo_count} photo${album.photo_count === 1 ? '' : 's'}`}
                  disabled={sharingAlbumId !== null}
                  busy={sharingAlbumId === album.id}
                  onPress={() => onShareAlbum(album.id)}
                />
              ))}
            </View>
          )}

          {errorLine}
        </>
      ) : (
        <>
          {backLink('share-sheet-card-back')}
          <Text variant="title" style={{ fontSize: 17 }}>
            share your card with {otherName}
          </Text>
          <Text variant="helper" testID="share-sheet-card-note">
            {`${CARD_GROUP_LABELS.standard} and ${CARD_GROUP_LABELS.always_attached} always go with it. tick anything from ${CARD_GROUP_LABELS.gated} you want them to see too. they tap to open each one.`}
          </Text>

          {cardQuery.isPending ? (
            <ActivityIndicator testID="share-sheet-card-loading" />
          ) : (
            <View style={styles.rows} testID="share-sheet-ticks">
              {CARD_GROUPS.gated.map((section) => {
                const canTick = tickable.includes(section);
                const count = sectionValues(cardQuery.data?.[section]).length;
                return (
                  <TickRow
                    key={section}
                    testID={`share-sheet-tick-${section}`}
                    label={CARD_SECTION_LABELS[section]}
                    subtitle={canTick ? `${count} picked` : 'nothing filled in yet'}
                    checked={ticked.includes(section)}
                    disabled={!canTick || sharingCard}
                    onPress={() => toggleTick(section)}
                  />
                );
              })}
            </View>
          )}

          {cardQuery.isError ? (
            <Text variant="helper" color={colors.inkSoft} testID="share-sheet-card-read-error">
              your card didn&apos;t load, so only {CARD_GROUP_LABELS.standard} and {CARD_GROUP_LABELS.always_attached} can go
              right now.
            </Text>
          ) : null}

          {existing ? (
            <Text variant="helper" color={colors.inkSoft} testID="share-sheet-card-replaces">
              {otherName} already has your card. sharing again replaces what they can see.
            </Text>
          ) : null}

          {errorLine}

          <Button
            testID="share-sheet-card-confirm"
            label={existing ? 'share again' : 'share'}
            loading={sharingCard}
            disabled={sharingCard || cardQuery.isPending}
            onPress={() => onSharePrivateCard(CARD_GROUPS.gated.filter((section) => ticked.includes(section)))}
          />
        </>
      )}
    </Sheet>
  );
}

const SHARE_UNAVAILABLE_COPY = "you can share once you've both said something";

interface ShareRowProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  testID: string;
}

function ShareRow({ icon, title, subtitle, disabled, busy, onPress, testID }: ShareRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      <View style={styles.rowIcon}>{busy ? <ActivityIndicator size="small" /> : icon}</View>
      <View style={styles.rowBody}>
        <Text variant="rowLabel">{title}</Text>
        <Text variant="helper" style={{ fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

interface TickRowProps {
  label: string;
  subtitle: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}

/** One intimacy section on the card step: a checkbox row. */
function TickRow({ label, subtitle, checked, disabled, onPress, testID }: TickRowProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.rowPressed, disabled && styles.rowDisabled]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <CheckIcon size={14} color={colors.onDark} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text variant="rowLabel">{label}</Text>
        <Text variant="helper" style={{ fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, paddingVertical: spacing.md },
  rowPressed: { opacity: 0.7 },
  rowDisabled: { opacity: 0.5 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...shadows.sm,
  },
  rowBody: { gap: 2, flexShrink: 1 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  boxChecked: { backgroundColor: colors.ink },
  footer: { textAlign: 'center' },
});
