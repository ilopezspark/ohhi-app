import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { deleteMyAccount } from '../../api/account';
import { mapSupabaseError } from '../../api/errors';
import { signOutAndReset } from '../../settings/signOut';
import { ScreenHeader, PillButton, RowCard, SectionLabel, SettingsRow, Text, VerificationPill, useHeaderInsets } from '../../ui';
import { footerBottomPadding } from '../../ui/keyboardInset';
import { ChevronRightIcon } from '../../ui/icons';
import { colors, radii, spacing } from '../../theme/tokens';
import { useSettingsData } from '../../me/settings/useSettingsData';
import { DetailRow } from '../../me/settings/DetailRow';
import { verificationLabel, isVerified } from '../../me/settings/verification';
import { INFO_LINKS } from '../../me/links';

/**
 * `docs/design/me-redesign/brief.md`'s Settings screen (`03-settings.png`)
 * — everything administrative, reached from the Me tab's gear. Data and the
 * three optimistic toggle pairs live in `useSettingsData`; this file is
 * layout + the delete-account two-tap confirm (ruling 11's replacement for
 * the old `/settings/account` screen — see `app/src/app/settings/account.tsx`'s
 * new redirect).
 */
export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const bottomInset = useHeaderInsets().bottom;
  const {
    meData,
    campus,
    schoolEmail,
    blockedCount,
    hereNow,
    paused,
    presenceError,
    onToggleHereNow,
    onTogglePause,
    hiAndChatsOn,
    someoneNewOn,
    notificationError,
    onToggleHiAndChats,
    onToggleSomeoneNew,
  } = useSettingsData();

  const [signingOut, setSigningOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOutAndReset(queryClient);
    } finally {
      setSigningOut(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMyAccount();
      await signOutAndReset(queryClient);
    } catch (error) {
      setDeleting(false);
      setDeleteError(mapSupabaseError(error).message);
    }
  }

  const verified = isVerified(meData?.verification_status);
  const campusValue = campus ? `${campus.slug.toUpperCase()} · ${campus.city}` : '';
  const appVersion = Constants.expoConfig?.version ?? '';
  const campusShort = meData?.campus_slug ? meData.campus_slug.toUpperCase() : '';

  return (
    <View style={styles.safe} testID="settings-screen">
      <ScreenHeader title="settings" titleSize={28} onBack={() => router.back()} />
      <ScrollView
        // log out / delete and the footer lines end clear of the home
        // indicator / navigation bar (the shared bar rule).
        contentContainerStyle={[styles.scroll, { paddingBottom: footerBottomPadding(bottomInset, { edge: spacing.huge }) }]}
      >
        <View style={styles.section}>
          <SectionLabel label="account" />
          <RowCard style={styles.cardPadding}>
            <DetailRow
              testID="settings-row-campus"
              title="my campus"
              right={
                <>
                  <Text variant="micro" color={colors.inkSoft}>
                    {campusValue}
                  </Text>
                  <ChevronRightIcon size={20} color={colors.inkFaint} />
                </>
              }
              onPress={() => router.push('/me/campus' as never)}
            />
            <DetailRow
              testID="settings-row-verification"
              title="verification"
              right={
                <>
                  <VerificationPill verified={verified} label={verificationLabel(meData?.verification_status)} />
                  <ChevronRightIcon size={20} color={colors.inkFaint} />
                </>
              }
              onPress={() => router.push('/me/verification' as never)}
            />
            <SettingsRow
              testID="settings-row-school-email"
              title="school email"
              accessory={{ kind: 'value', text: schoolEmail ?? '' }}
            />
          </RowCard>
        </View>

        <View style={styles.section}>
          <SectionLabel label="who can see you" />
          <RowCard style={styles.cardPadding}>
            <SettingsRow
              testID="settings-row-here-now"
              title="here now"
              subtitle="turns off by itself after 2 hours"
              accessory={{ kind: 'toggle', value: hereNow, onValueChange: onToggleHereNow }}
            />
            <SettingsRow
              testID="settings-row-pause-grid"
              title="pause my grid"
              subtitle="hides you from everyone. your chats stay put."
              accessory={{ kind: 'toggle', value: paused, onValueChange: onTogglePause }}
            />
          </RowCard>
          {presenceError ? (
            <Text variant="micro" color={colors.danger} testID="settings-presence-error">
              {presenceError}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <SectionLabel label="notifications" />
          <RowCard style={styles.cardPadding}>
            <SettingsRow
              testID="settings-row-hi-and-chats"
              title="hi's and chats"
              accessory={{ kind: 'toggle', value: hiAndChatsOn, onValueChange: onToggleHiAndChats }}
            />
            <SettingsRow
              testID="settings-row-someone-new"
              title="someone new around"
              subtitle="one an hour at most, never at night"
              accessory={{ kind: 'toggle', value: someoneNewOn, onValueChange: onToggleSomeoneNew }}
            />
          </RowCard>
          {notificationError ? (
            <Text variant="micro" color={colors.danger} testID="settings-notification-error">
              {notificationError}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <SectionLabel label="safety" />
          <RowCard style={styles.cardPadding}>
            <DetailRow
              testID="settings-row-blocked"
              title="blocked"
              right={
                <>
                  <Text variant="micro" color={colors.inkSoft}>
                    {blockedCount}
                  </Text>
                  <ChevronRightIcon size={20} color={colors.inkFaint} />
                </>
              }
              onPress={() => router.push('/me/blocked' as never)}
            />
            <SettingsRow
              testID="settings-row-report"
              title="report someone"
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push('/me/report-help' as never)}
            />
          </RowCard>
        </View>

        <View style={styles.section}>
          <SectionLabel label="the boring but important stuff" />
          <RowCard style={styles.cardPadding}>
            {INFO_LINKS.map((link) => (
              <SettingsRow
                key={link.slug}
                testID={`settings-row-info-${link.slug}`}
                title={link.title}
                subtitle={link.subtitle}
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push(`/me/info/${link.slug}` as never)}
              />
            ))}
          </RowCard>
        </View>

        <View style={styles.footerActions}>
          <PillButton testID="settings-log-out" label="log out" loading={signingOut} onPress={onSignOut} />

          {!confirmingDelete ? (
            <Pressable
              testID="settings-delete-account-start"
              accessibilityRole="button"
              accessibilityLabel="delete my account"
              onPress={() => setConfirmingDelete(true)}
              style={styles.deleteRow}
            >
              <Text variant="labelLg" color={colors.danger}>
                delete my account
              </Text>
            </Pressable>
          ) : (
            <View style={styles.deleteConfirm} testID="settings-delete-confirm-group">
              <Text variant="micro" color={colors.inkSoft} style={styles.deleteCopy}>
                your profile, photos and conversations stop being visible right away. we keep the
                account for 30 days in case you change your mind — signing back in before then does
                not undo this, it purges the old account for good and starts you fresh.
              </Text>
              {deleteError ? (
                <Text variant="micro" color={colors.danger} testID="settings-delete-error">
                  {deleteError}
                </Text>
              ) : null}
              <Pressable
                testID="settings-delete-account-confirm"
                accessibilityRole="button"
                accessibilityLabel="yes, delete my account"
                disabled={deleting}
                onPress={onDelete}
                style={[styles.deleteConfirmPill, deleting && styles.disabled]}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.onDark} />
                ) : (
                  <Text variant="labelLg" color={colors.onDark}>
                    yes, delete it
                  </Text>
                )}
              </Pressable>
              <Pressable
                testID="settings-delete-account-cancel"
                accessibilityRole="button"
                accessibilityLabel="cancel"
                disabled={deleting}
                onPress={() => setConfirmingDelete(false)}
              >
                <Text variant="labelLg" color={colors.inkSoft}>
                  cancel
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text variant="micro" color={colors.inkFaint} style={styles.footerLine}>
            {`ohhi ${appVersion} · built for ${campusShort}`}
          </Text>
          <Text variant="micro" color={colors.inkFaint} style={styles.footerLine}>
            we never store where you are, only how far apart you are.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, gap: spacing.xl },
  section: { gap: spacing.smMd },
  cardPadding: { paddingHorizontal: spacing.lgXl },
  footerActions: { gap: spacing.mdLg, alignItems: 'center', marginTop: spacing.smMd },
  deleteRow: { paddingVertical: spacing.smMd },
  deleteConfirm: { width: '100%', alignItems: 'center', gap: spacing.mdLg },
  deleteCopy: { textAlign: 'center' },
  deleteConfirmPill: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingVertical: spacing.lgXl,
  },
  disabled: { opacity: 0.6 },
  footer: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  footerLine: { textAlign: 'center' },
});
