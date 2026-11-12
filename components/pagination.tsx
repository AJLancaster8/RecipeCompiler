import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

// Which page numbers to show: always the first and last, the current page
// and its neighbours, with "…" filling any gaps. e.g. on page 6 of 12:
// 1 … 5 6 7 … 12
function pageItems(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) items.push("gap");
    items.push(p);
  });
  return items;
}

// ‹ 1 2 3 … 9 › page picker.
export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <View style={styles.row} accessibilityRole="toolbar">
      <PageButton
        label="‹"
        disabled={page <= 1}
        onPress={() => onChange(page - 1)}
        accessibilityLabel="Previous page"
      />
      {pageItems(page, pageCount).map((item, i) =>
        item === "gap" ? (
          <Text key={`gap-${i}`} style={styles.gap}>
            …
          </Text>
        ) : (
          <PageButton
            key={item}
            label={String(item)}
            active={item === page}
            onPress={() => onChange(item)}
            accessibilityLabel={`Page ${item}`}
          />
        ),
      )}
      <PageButton
        label="›"
        disabled={page >= pageCount}
        onPress={() => onChange(page + 1)}
        accessibilityLabel="Next page"
      />
    </View>
  );
}

function PageButton({
  label,
  onPress,
  active,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, active && styles.buttonActive, disabled && { opacity: 0.35 }]}
      onPress={onPress}
      disabled={disabled || active}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 12,
  },
  button: {
    minWidth: 38,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0D5C7",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: {
    backgroundColor: "#D97B4F",
    borderColor: "#D97B4F",
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: "#4A3B2C",
  },
  labelActive: {
    color: "#FFFFFF",
  },
  gap: {
    fontSize: 15,
    color: "#8A7A68",
    paddingHorizontal: 2,
  },
});
