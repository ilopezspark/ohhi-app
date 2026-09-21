import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { supabase } from '../../api/client';
import { uploadProfilePhoto, type UserPhotoRow } from '../../api/photos';
import { tintForPhoto } from '../../photos/tint';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';

type SelectedAsset = { uri: string; width: number; height: number };
type Phase = 'picking' | 'preview' | 'uploading' | 'pending' | 'error';

const MAIN_PHOTO_POSITION = 0;

/**
 * Onboarding photo step (`docs/app-onboarding-grid-plan.md` §2), main photo
 * only (position 0). Standalone screen — reads the current user off the
 * Supabase session itself rather than taking it as a prop, per this build's
 * route contract. On success: `router.replace('/(onboarding)/tags')`. Back:
 * `router.replace('/(onboarding)/goals')`.
 *
 * Onboarding does not block on moderation (`complete_onboarding()` accepts
 * `pending` or `ok` at position 0) — this screen lets the user continue past
 * a successful upload immediately, showing the pending-review explanation
 * rather than waiting for approval.
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
    router.replace('/(onboarding)/goals' as never);
  }

  function goNext() {
    router.replace('/(onboarding)/tags' as never);
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
    } catch {
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
  const previewTint = userId ? tintForPhoto(userId, MAIN_PHOTO_POSITION) : '#cccccc';

  return (
    <View style={styles.container} testID="photo-screen">
      <Pressable
        testID="photo-back-button"
        onPress={goBack}
        disabled={uploading}
        accessibilityState={{ disabled: uploading }}
      >
        <Text style={styles.back}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Add your main photo</Text>
      <Text style={styles.body}>This is what people on the grid see first.</Text>

      {phase === 'picking' ? (
        <View style={styles.pickerRow}>
          <Pressable testID="photo-pick-library" style={styles.button} onPress={pickFromLibrary}>
            <Text style={styles.buttonText}>Choose from library</Text>
          </Pressable>
          <Pressable testID="photo-pick-camera" style={styles.button} onPress={pickFromCamera}>
            <Text style={styles.buttonText}>Take a photo</Text>
          </Pressable>
        </View>
      ) : null}

      {permissionMessage ? (
        <Text testID="photo-permission-message" style={styles.error}>
          {permissionMessage}
        </Text>
      ) : null}

      {selected && (phase === 'preview' || phase === 'uploading' || phase === 'error') ? (
        <View style={styles.previewFrame}>
          <TintedPlaceholder tint={previewTint} style={StyleSheet.absoluteFill} />
          <Image testID="photo-preview-image" source={{ uri: selected.uri }} style={styles.previewImage} />
        </View>
      ) : null}

      {phase === 'preview' || phase === 'uploading' ? (
        <View style={styles.pickerRow}>
          <Pressable
            testID="photo-retake-button"
            style={[styles.buttonSecondary, uploading && styles.buttonDisabled]}
            disabled={uploading}
            accessibilityState={{ disabled: uploading }}
            onPress={handleRetake}
          >
            <Text style={styles.buttonSecondaryText}>Retake</Text>
          </Pressable>
          <Pressable
            testID="photo-upload-button"
            style={[styles.button, uploading && styles.buttonDisabled]}
            disabled={uploading}
            accessibilityState={{ disabled: uploading }}
            onPress={handleUpload}
          >
            {uploading ? (
              <ActivityIndicator testID="photo-uploading-indicator" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Use this photo</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View>
          <Text testID="photo-error" style={styles.error}>
            {errorMessage}
          </Text>
          <Pressable testID="photo-retry-button" style={styles.button} onPress={handleUpload}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'pending' ? (
        <View>
          <View style={styles.previewFrame}>
            <TintedPlaceholder tint={savedPhoto?.tint ?? previewTint} pending style={StyleSheet.absoluteFill} />
            {selected ? (
              <Image testID="photo-preview-image" source={{ uri: selected.uri }} style={styles.previewImage} />
            ) : null}
          </View>
          <Text testID="photo-pending-copy" style={styles.body}>
            Photo submitted — we&apos;ll check it; you&apos;ll be visible once it&apos;s approved.
          </Text>
          <Pressable testID="photo-retake-button" style={styles.buttonSecondary} onPress={handleRetake}>
            <Text style={styles.buttonSecondaryText}>Retake</Text>
          </Pressable>
          <Pressable testID="photo-continue-button" style={styles.button} onPress={goNext}>
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  back: { color: '#208AEF', fontSize: 14, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { color: '#555', fontSize: 14 },
  error: { color: '#b00020', fontSize: 13 },
  pickerRow: { flexDirection: 'row', gap: 12 },
  previewFrame: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'center',
    marginVertical: 12,
  },
  previewImage: { width: '100%', height: '100%' },
  button: {
    flex: 1,
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondaryText: { color: '#208AEF', fontWeight: '600' },
});
