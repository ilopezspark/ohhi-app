import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronUpIcon, ImageIcon, Sheet, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { BEFORE_YOU_MESSAGE_TITLE, beforeYouMessageLine } from './identityCards';

/**
 * "before you message me" (photos & content): this person's requests of
 * whoever writes to them (ruling 4). Boundary colours, as for hard nos
 * (ruling 7: `boundaryBg` warm border / fill, label in `boundaryInk`). On
 * the profile it is just the list: the "these are asks" caption belongs to
 * the editor, not here. Always shown to everyone once filled (ruling 1).
 *
 * Three surfaces (reconcile C4): the full card, last of the restructured
 * cards in the detail list; a one-line strip docked in the sticky action bar
 * right above say-hi, which opens a small sheet with the full list; and the
 * same line, every request spelled out, in the first-message sheet.
 */

function Bullet() {
  return <View style={styles.bullet} />;
}

/** The requests, one per hairline-separated row; each row's testID is `<itemPrefix>-item-<i>`. */
function RequestList({ items, itemPrefix }: { items: string[]; itemPrefix?: string }) {
  return (
    <View>
      {items.map((item, i) => (
        <View
          key={item}
          style={[styles.row, i < items.length - 1 && styles.divider]}
          testID={itemPrefix ? `${itemPrefix}-item-${i}` : undefined}
        >
          <Bullet />
          <Text variant="bodyMedium" style={styles.rowText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header} accessibilityRole="header">
      <ImageIcon size={16} color={colors.boundaryInk} />
      <Text variant="sectionLabel" color={colors.boundaryInk}>
        {BEFORE_YOU_MESSAGE_TITLE}
      </Text>
    </View>
  );
}

/** The card in the detail list. */
export function BeforeYouMessageCard({ items, testID }: { items: string[]; testID?: string }) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <Header />
      <RequestList items={items} itemPrefix={testID} />
    </View>
  );
}

/**
 * The strip above say-hi: `before you message me · <first> +N`, one line,
 * on its own warm fill so it reads the same on the photo and on paper.
 */
export function BeforeYouMessageStrip({ items, onPress, testID }: { items: string[]; onPress: () => void; testID?: string }) {
  const line = beforeYouMessageLine(items);
  if (!line) return null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${line.lead}: ${items.join(', ')}`}
      accessibilityHint="opens the full list"
      onPress={onPress}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
    >
      <Text variant="helper" color={colors.boundaryInk} numberOfLines={1} style={styles.stripText} testID={testID ? `${testID}-text` : undefined}>
        <Text variant="helper" color={colors.boundaryInk} style={styles.lead}>
          {line.lead}
        </Text>
        {` · ${line.rest}`}
      </Text>
      <ChevronUpIcon size={16} color={colors.boundaryInk} />
    </Pressable>
  );
}

/** The small sheet the strip opens. An in-tree `Sheet`: mount it as the screen root's last child. */
export function BeforeYouMessageSheet({ items, onDismiss, testID }: { items: string[]; onDismiss: () => void; testID?: string }) {
  return (
    <Sheet testID={testID} onDismiss={onDismiss}>
      <Header />
      <RequestList items={items} itemPrefix={testID ? `${testID}-list` : undefined} />
    </Sheet>
  );
}

/** The first-message sheet's line: every request spelled out (no second sheet to open from there). */
export function BeforeYouMessageLine({ items, testID }: { items: string[]; testID?: string }) {
  const line = beforeYouMessageLine(items, true);
  if (!line) return null;
  return (
    <View style={styles.strip} testID={testID}>
      <Text variant="helper" color={colors.boundaryInk} style={styles.stripText}>
        <Text variant="helper" color={colors.boundaryInk} style={styles.lead}>
          {line.lead}
        </Text>
        {` · ${line.rest}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.boundaryBg,
    padding: spacing.xlXxl,
    gap: spacing.mdLg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.lg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  rowText: { flex: 1, fontSize: 16, lineHeight: 21 },
  bullet: { width: 6, height: 6, borderRadius: radii.circle, backgroundColor: colors.boundaryInk, marginHorizontal: spacing.smMd },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    backgroundColor: colors.boundaryBg,
    borderRadius: radii.lg,
    paddingVertical: spacing.smMd,
    paddingHorizontal: spacing.mdLg,
    minHeight: 36,
  },
  stripText: { flex: 1 },
  lead: { fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
