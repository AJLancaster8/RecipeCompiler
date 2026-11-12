import { Href, useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type MenuItem = { label: string; description: string; href: Href };

const MENU_ITEMS: MenuItem[] = [
  {
    label: "Discover Recipes",
    description: "Browse recipes everyone has published",
    href: "/discover",
  },
  {
    label: "Saved Recipes",
    description: "Recipes you've saved from Discover or your own",
    href: "/saved",
  },
  {
    label: "Saved Plans",
    description: "Your compiled cooking plans",
    href: "/plans",
  },
];

// The ☰ button in the top-left of the home screen, and the slide-out menu
// it opens.
export function BurgerMenuButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const go = (href: Href) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        style={styles.burger}
      >
        <View style={styles.bar} />
        <View style={styles.bar} />
        <View style={styles.bar} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Tapping the dimmed area closes the menu */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.panel, { paddingTop: insets.top + 20 }]}
            // Taps inside the panel shouldn't close it
            onPress={() => {}}
          >
            <Text style={styles.menuTitle}>Menu</Text>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={styles.menuItem}
                onPress={() => go(item.href)}
                accessibilityRole="button"
              >
                <Text style={styles.menuItemLabel}>{item.label}</Text>
                <Text style={styles.menuItemDescription}>{item.description}</Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  burger: {
    width: 26,
    height: 20,
    justifyContent: "space-between",
    paddingVertical: 1,
  },
  bar: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "#2B2118",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(43, 33, 24, 0.35)",
  },
  panel: {
    width: "78%",
    maxWidth: 320,
    height: "100%",
    backgroundColor: "#FAF7F2",
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 2, height: 0 },
    elevation: 8,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginBottom: 12,
  },
  menuItem: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  menuItemLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2B2118",
  },
  menuItemDescription: {
    fontSize: 13,
    color: "#8A7A68",
    marginTop: 2,
  },
});
