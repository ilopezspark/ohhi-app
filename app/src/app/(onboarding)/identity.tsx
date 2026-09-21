import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { me } from '../../api/me';
import { getIdentity } from '../../api/identity';
import { putIdentity } from '../../api/identityWrite';
import { supabase } from '../../api/client';
import { mapSupabaseError } from '../../api/errors';
import { stepToPath } from '../../onboarding/stepResolver';
import { PRONOUN_OPTIONS, PRONOUN_MAX_LENGTH, ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS } from '../../settings/vocab';
import { Banner, Button, Chip, Input, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';
import { Toggle } from '../../onboarding/components/Toggle';

/**
 * `Onb-Identity.html` ("about you") — new onboarding step, decision 20 /
 * `docs/design/system.md`'s previously-`**none**` mapping for this screen
 * (it used to say the closest thing in the app was the post-onboarding
 * `settings/identity.tsx` editor; this is that screen's onboarding-time
 * counterpart, not a replacement for it). Optional and skippable, slotted
 * between `goals` and `photo` per the design's own screen order (the
 * contact sheet's `index.html`: basics -> here for -> about you -> photos).
 * Design step 4 of 8.
 *
 * Writes through `identityWrite.ts`'s `PUT /identity` (owner path), the
 * same whole-object-replace contract `settings/identity.tsx` uses.
 * `is_public` defaults to **off** (decision 20) and is never implied on by
 * filling in a pronoun/orientation — matching the design's own toggle,
 * which renders in its off state.
 *
 * **Copy deviation**: the design's pronoun chip set (he/him, she/her,
 * they/them, he/they, she/they, "+ custom") and orientation set (straight,
 * gay, lesbian, bi, queer, ace, trans, questioning, "rather not say") don't
 * match `settings/vocab.ts`'s `PRONOUN_OPTIONS`/`ORIENTATION_CHIPS` — that
 * file is a checked copy of the identity edge function's own validation
 * allow-list (`supabase/functions/identity/validate.ts`, decisions 20-21,
 * 48), kept in sync by a dedicated test. Submitting a value the edge
 * function doesn't accept would just be refused server-side, so this
 * screen uses `vocab.ts`'s real lists (same primitive `settings/identity.tsx`
 * uses: a fixed pronoun chip row plus a free-text opt-out) rather than the
 * design's exact wording, per the brief's "keep the app's existing
 * validation rules" instruction. Headline/help/banner copy is the design's
 * own text verbatim.
 *
 * Loads any already-saved identity on mount (rather than always starting
 * blank) so navigating back here from `photo.tsx` shows what was actually
 * saved, not a reset form — same load shape as `settings/identity.tsx`,
 * duplicated locally since that route file is outside this pass's
 * ownership (`app/src/app/settings/*` is read-only here).
 */
export default function IdentityScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [pronoun, setPronoun] = useState<string | null>(null);
  const [customPronoun, setCustomPronoun] = useState('');
  const [orientation, setOrientation] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meResult = await me();
        if (!meResult || cancelled) return;
        setUserId(meResult.id);

        const [identity, metaResult] = await Promise.all([
          getIdentity(meResult.id),
          supabase.from('user_identity').select('is_public').eq('user_id', meResult.id).maybeSingle(),
        ]);
        if (cancelled) return;

        if (identity) {
          if (identity.pronouns && (PRONOUN_OPTIONS as readonly string[]).includes(identity.pronouns)) {
            setPronoun(identity.pronouns);
          } else if (identity.pronouns) {
            setCustomPronoun(identity.pronouns);
          }
          setOrientation(identity.orientation);
        }
        setIsPublic(metaResult.data?.is_public ?? false);
      } catch {
        // Nothing saved yet is the overwhelmingly common case here (this is
        // onboarding) — a load failure just leaves the form at its blank
        // default rather than blocking the step.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectivePronoun = pronoun ?? (customPronoun.trim().length > 0 ? customPronoun.trim() : null);
  const customTooLong = customPronoun.trim().length > PRONOUN_MAX_LENGTH;

  const mutation = useMutation({
    mutationFn: () => putIdentity({ pronouns: effectivePronoun, orientation, is_public: isPublic }),
    onSuccess: () => router.replace(stepToPath('photo') as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  function selectPronoun(option: string) {
    setPronoun((prev) => (prev === option ? null : option));
    setCustomPronoun('');
  }

  function onCustomPronounChange(value: string) {
    setCustomPronoun(value);
    setPronoun(null);
  }

  function toggleOrientation(value: string) {
    setOrientation((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= ORIENTATION_MAX_ITEMS) return prev;
      return [...prev, value];
    });
  }

  function handleContinue() {
    if (mutation.isPending || customTooLong || !userId) return;
    setErrorMessage(null);
    mutation.mutate();
  }

  function handleSkip() {
    if (mutation.isPending) return;
    router.replace(stepToPath('photo') as never);
  }

  function goBack() {
    router.replace('/(onboarding)/goals' as never);
  }

  return (
    <OnboardingScreen
      step={4}
      onBack={goBack}
      backTestID="identity-back"
      testID="identity-screen"
      footer={
        <>
          <Button
            label="continue"
            onPress={handleContinue}
            loading={mutation.isPending}
            disabled={mutation.isPending || customTooLong || !loaded}
            testID="identity-continue"
          />
          <Button label="skip for now" variant="ghost" onPress={handleSkip} disabled={mutation.isPending} testID="identity-skip" />
        </>
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        a bit about you
      </Text>
      <Text variant="helper">
        all optional. off your profile unless you turn it on — and never used to sort the grid.
      </Text>

      <View style={{ gap: spacing.smMd }}>
        <Text variant="label">pronouns</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd }} testID="identity-pronoun-options">
          {PRONOUN_OPTIONS.map((option) => (
            <Chip
              key={option}
              testID={`identity-pronoun-${option}`}
              label={option}
              selected={pronoun === option}
              onPress={() => selectPronoun(option)}
            />
          ))}
        </View>
        <Input
          testID="identity-pronoun-custom"
          placeholder="or write your own"
          maxLength={PRONOUN_MAX_LENGTH + 10}
          value={customPronoun}
          onChangeText={onCustomPronounChange}
        />
        {customTooLong ? (
          <Text testID="identity-pronoun-error" variant="helper" color={colors.danger}>
            {`Keep it under ${PRONOUN_MAX_LENGTH} characters.`}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: spacing.smMd }}>
        <Text variant="label">{`i'm (up to ${ORIENTATION_MAX_ITEMS})`}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd }} testID="identity-orientation">
          {ORIENTATION_CHIPS.map((option) => (
            <Chip
              key={option}
              testID={`identity-orientation-${option}`}
              label={option}
              selected={orientation.includes(option)}
              onPress={() => toggleOrientation(option)}
            />
          ))}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lgXl }}>
        <View style={{ flex: 1, gap: spacing.xxs }}>
          <Text variant="bodyStrong" style={{ fontSize: 14 }}>
            show these on my profile
          </Text>
          <Text variant="helper" style={{ fontSize: 12 }}>
            off by default. flip it whenever.
          </Text>
        </View>
        <Toggle value={isPublic} onValueChange={setIsPublic} testID="identity-is-public" accessibilityLabel="show these on my profile" />
      </View>

      <Banner
        title="the rest lives in more about me"
        message="who you're into, safer-sex stuff, kinks — a private section you share one person at a time from a chat. never on the grid, never on your profile. you can fill it in later from me."
        testID="identity-more-about-me-banner"
      />

      {errorMessage ? (
        <Text testID="identity-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}
