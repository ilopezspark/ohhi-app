import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { AlbumRow } from '../api/albums';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AlbumIcon, CameraIcon, PersonIcon } from '../ui/icons';
import { Sheet, Text } from '../ui';

export interface ShareSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** `Chat-Share.html`'s "share with maya" title. */
  otherName: string;
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
  onSharePrivateCard: () => void;
  sharingCard: boolean;
  error?: string | null;
}

/**
 * `Chat-Share.html`'s share tray — a photo / an album / the private card —
 * as a two-step `Sheet` (menu, then an album picker when "an album" is
 * tapped). Static shape from `ui/Sheet`; this component owns the step state
 * and the three actions' wiring.
 */
export function ShareSheet({
  visible,
  onDismiss,
  otherName,
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
  const [step, setStep] = useState<'menu' | 'albums'>('menu');

  useEffect(() => {
    if (visible) setStep('menu');
  }, [visible]);

  if (!visible) return null;

  const albumNames = (albums ?? []).map((a) => a.name).slice(0, 3).join(' · ');

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
                  title="a photo"
                  subtitle="from your camera roll"
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
                    ? "pronouns, who you're into, safer sex, kinks — the private card"
                    : SHARE_UNAVAILABLE_COPY
                }
                disabled={!canShareBeyondPhoto || sharingCard}
                busy={sharingCard}
                onPress={onSharePrivateCard}
              />
            </View>

            {error ? (
              <Text variant="helper" color={colors.danger} testID="share-sheet-error">
                {error}
              </Text>
            ) : null}

            <Text variant="helper" style={styles.footer}>
              anything you share here, you can take back from {otherName}&apos;s profile. they&apos;ll know
              it&apos;s gone, not why.
            </Text>
          </>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              testID="share-sheet-albums-back"
              onPress={() => setStep('menu')}
            >
              <Text variant="helper" color={colors.ink}>
                ‹ back
              </Text>
            </Pressable>
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

            {error ? (
              <Text variant="helper" color={colors.danger} testID="share-sheet-error">
                {error}
              </Text>
            ) : null}
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
  footer: { textAlign: 'center' },
});
