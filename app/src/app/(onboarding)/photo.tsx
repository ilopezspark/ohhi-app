import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { supabase } from '../../api/client';
import { uploadProfilePhoto, type UserPhotoRow } from '../../api/photos';
import { tintForPhoto } from '../../photos/tint';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { stepToPath } from '../../onboarding/stepResolver';
import { Badge, Button, PlusIcon, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

type SelectedAsset = { uri: string; width: number; height: number };
type Phase = 'picking' | 'preview' | 'uploading' | 'pending' | 'error';

const MAIN_PHOTO_POSITION = 0;

/**
 * `Onb-Photos.html`. Onboarding photo step (`docs/app-onboarding-grid-plan.md`
 * §2), main photo only (position 0) — kept exactly as before this pass.
 * Design step 5 of 8. On success: `router.replace('/(onboarding)/tags')`.
 * Back: `router.replace('/(onboarding)/identity')` (was `goals`; `identity`
 * now sits between `goals` and this step, see `identity.tsx`).
 *
 * Onboarding does not block on moderation (`complete_onboarding()` accepts
 * `pending` or `ok` at position 0) — this screen lets the user continue past
 * a successful upload immediately, showing the pending-review explanation
 * rather than waiting for approval.
 *
 * **Deviation**: the design's 3-tile grid shows two more dashed "add photo"
 * slots alongside the main one ("up to three"). This screen only ever
 * writes position 0 (existing scope, `MAIN_PHOTO_POSITION` — multi-photo
 * isn't implemented in onboarding), so the other two slots render as
 * inert/disabled placeholders rather than wiring up positions 1-2, which
 * would be a scope change, not a restyle.
 */
export default function PhotoScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('picking');
  const [selected, setSelected] = useState<SelectedAsset | null>(null);
  const [savedPhoto, setSavedPhoto] = useState<UserPhotoRow | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function goBack() {
    if (uploading) return;
    router.replace('/(onboarding)/identity' as never);
  }

  function goNext() {
    router.replace(stepToPath('tags') as never);
  }

  function pickAsset(result: ImagePicker.ImagePickerResult) {
    if (result.canceled) return;
    const asset = result.assets[0];
    setPermissionMessage(null);
    setErrorMessage(null);
    setSavedPhoto(null);
    setSelected({ uri: asset.uri, width: asset.width, height: asset.height });
    setPhase('preview');
  }

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPermissionMessage('Allow photo library access to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    pickAsset(result);
  }

  async function pickFromCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPermissionMessage('Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    pickAsset(result);
  }

  async function handleUpload() {
    if (!selected || phase === 'uploading') return;
    setPhase('uploading');
    setErrorMessage(null);
    try {
      const row = await uploadProfilePhoto({
        position: MAIN_PHOTO_POSITION,
        uri: selected.uri,
        width: selected.width,
        height: selected.height,
      });
      setSavedPhoto(row);
      setPhase('pending');
    } catch (err) {
      // Log the real cause in dev only — the user-facing copy below stays
      // generic on purpose (api/errors.ts's RefusedError/UnknownError
      // convention), so this is the only place the underlying error (e.g. a
      // Postgres/PostgREST error code) is ever visible.
      if (__DEV__) {
        console.error('[onboarding/photo] upload failed', err);
      }
      setErrorMessage("That didn't work. Please try again.");
      setPhase('error');
    }
  }

  function handleRetake() {
    setSelected(null);
    setSavedPhoto(null);
    setErrorMessage(null);
    setPhase('picking');
  }

  const uploading = phase === 'uploading';
  const previewTint = userId ? tintForPhoto(userId, MAIN_PHOTO_POSITION) : colors.avatarTints[0];
  const hasPreview = !!selected && (phase === 'preview' || phase === 'uploading' || phase === 'error');

  return (
    <OnboardingScreen step={5} onBack={goBack} backTestID="photo-back-button" testID="photo-screen">
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        add a photo
      </Text>
      <Text variant="helper">your first one should be just you, face visible. that&apos;s the one on the grid.</Text>

      <View style={styles.grid}>
        <View style={styles.tile}>
          {hasPreview || phase === 'pending' ? (
            <>
              <TintedPlaceholder
                tint={phase === 'pending' ? savedPhoto?.tint ?? previewTint : previewTint}
                pending={phase === 'pending'}
                style={StyleSheet.absoluteFill}
              />
              {selected ? (
                <Image testID="photo-preview-image" source={{ uri: selected.uri }} style={styles.tileImage} />
              ) : null}
            </>
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.avatarTints[0] }]} />
          )}
          <Badge label="main" style={styles.mainBadge} />
        </View>
        <View style={[styles.tile, styles.tileDashed]} />
        <View style={[styles.tile, styles.tileDashed]} />
      </View>

      {phase === 'picking' ? (
        <View style={styles.pickerRow}>
          <Pressable testID="photo-pick-library" style={styles.pickButton} onPress={pickFromLibrary}>
            <PlusIcon size={18} color={colors.subtle} />
            <Text variant="rowLabel">Choose from library</Text>
          </Pressable>
          <Pressable testID="photo-pick-camera" style={styles.pickButton} onPress={pickFromCamera}>
            <PlusIcon size={18} color={colors.subtle} />
            <Text variant="rowLabel">Take a photo</Text>
          </Pressable>
        </View>
      ) : null}

      {permissionMessage ? (
        <Text testID="photo-permission-message" variant="helper" color={colors.danger}>
          {permissionMessage}
        </Text>
      ) : null}

      <Text variant="helper">up to three. no group shots first, no filters that hide your face.</Text>

      {phase === 'preview' || phase === 'uploading' ? (
        <View style={styles.actionRow}>
          <Button
            label="Retake"
            variant="secondary"
            fullWidth={false}
            style={styles.actionButton}
            disabled={uploading}
            testID="photo-retake-button"
            onPress={handleRetake}
          />
          <Button
            label="Use this photo"
            fullWidth={false}
            style={styles.actionButton}
            loading={uploading}
            disabled={uploading}
            testID="photo-upload-button"
            onPress={handleUpload}
          />
        </View>
      ) : null}
      {uploading ? (
        <ActivityIndicator testID="photo-uploading-indicator" color={colors.ink} style={styles.hidden} />
      ) : null}

      {phase === 'error' ? (
        <View style={{ gap: spacing.mdLg }}>
          <Text testID="photo-error" variant="helper" color={colors.danger}>
            {errorMessage}
          </Text>
          <Button label="Try again" testID="photo-retry-button" onPress={handleUpload} />
        </View>
      ) : null}

      {phase === 'pending' ? (
        <View style={{ gap: spacing.mdLg }}>
          <Text testID="photo-pending-copy" variant="helper">
            Photo submitted — we&apos;ll check it; you&apos;ll be visible once it&apos;s approved.
          </Text>
          <View style={styles.actionRow}>
            <Button
              label="Retake"
              variant="secondary"
              fullWidth={false}
              style={styles.actionButton}
              testID="photo-retake-button"
              onPress={handleRetake}
            />
            <Button
              label="Continue"
              fullWidth={false}
              style={styles.actionButton}
              testID="photo-continue-button"
              onPress={goNext}
            />
          </View>
        </View>
      ) : null}
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
  },
  tileDashed: {
    borderWidth: 2,
    borderColor: colors.dashed,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mainBadge: { position: 'absolute', top: 8, left: 8 },
  pickerRow: { flexDirection: 'row', gap: spacing.mdLg },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smMd,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.dashed,
    borderStyle: 'dashed',
    paddingVertical: spacing.lg,
  },
  actionRow: { flexDirection: 'row', gap: spacing.mdLg },
  actionButton: { flex: 1 },
  // `opacity: 0` (not `display: 'none'`) — RNTL's queries treat
  // `display: 'none'` as hidden-from-accessibility and exclude it, which
  // would make `getByTestId('photo-uploading-indicator')` fail even though
  // the element is mounted. `Button`'s own internal spinner (no testID of
  // its own) is what's actually visible to the user while uploading; this
  // one exists only so the existing test hook keeps working.
  hidden: { position: 'absolute', opacity: 0 },
});
