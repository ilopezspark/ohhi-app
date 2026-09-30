import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { FALLBACK, goBack } from '../routing/goBack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserTags, listTagCatalog, minTagsToSave, setMyTags } from '../api/tags';
import { InvalidInputError } from '../api/errors';
import { FIELD_ERROR_FALLBACK } from '../profile/fields';
import { queryKeys } from '../me/queryKeys';
import { TagPicker } from '../tags/TagPicker';
import { Button, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

/**
 * `/interests`: the interest picker on its own, saving straight away
 * through `set_my_tags` (migration 0018). Opened from the one-time
 * `tags_changed` notice, so someone the migration left with few or no tags
 * can repick without going through the profile editor. Presented modally;
 * `cancel` closes it without saving.
 */
export default function InterestsScreen() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({ queryKey: queryKeys.tagCatalog, queryFn: listTagCatalog });
  const tagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [held, setHeld] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected !== null || !tagsQuery.data) return;
    const ids = [...tagsQuery.data].sort((a, b) => a.position - b.position).map((tag) => tag.tag_id);
    setSelected(ids);
    setHeld(ids.length);
  }, [tagsQuery.data, selected]);

  function close() {
    goBack(FALLBACK.tabs);
  }

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setMyTags(selected);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.tags });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
      close();
    } catch (err) {
      setError(err instanceof InvalidInputError ? err.message : FIELD_ERROR_FALLBACK);
      setSaving(false);
    }
  }

  if (catalogQuery.isError || tagsQuery.isError) {
    return (
      <View style={styles.center} testID="interests-load-error">
        <Text variant="body" color={colors.inkSoft}>
          that didn&apos;t load. try again.
        </Text>
        <Button
          label="try again"
          fullWidth={false}
          onPress={() => {
            void catalogQuery.refetch();
            void tagsQuery.refetch();
          }}
        />
        <Button label="close" variant="ghost" fullWidth={false} onPress={close} />
      </View>
    );
  }

  if (!catalogQuery.data || selected === null) {
    return (
      <View style={styles.center} testID="interests-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  return (
    <TagPicker
      testID="interests-picker"
      title="interests"
      intro="up to 10, in the order you want them shown"
      closeLabel="cancel"
      onClose={close}
      catalog={catalogQuery.data}
      selected={selected}
      onChange={setSelected}
      min={minTagsToSave(held)}
      minNote="pick at least three."
      verb="done"
      onSubmit={save}
      submitting={saving}
      error={error}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, backgroundColor: colors.paper, padding: spacing.xxl },
});
