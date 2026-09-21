import { StyleSheet, Text, View } from 'react-native';

export interface ChipListProps {
  items: string[];
  testID?: string;
}

/** A static, non-interactive chip row — used for the card's tags and goals (§1: "no interaction here"). */
export function ChipList({ items, testID }: ChipListProps) {
  if (items.length === 0) return null;

  return (
    <View style={styles.row} testID={testID}>
      {items.map((label, i) => (
        <View key={`${label}-${i}`} style={styles.chip}>
          <Text style={styles.chipText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F0F1F3',
  },
  chipText: { fontSize: 13, color: '#333' },
});
