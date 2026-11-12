import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Alert } from "../lib/alert";
import { savedApi } from "../lib/recipe-api";
import { describeRecipeError } from "../app/recipe-store";

// "☆ Save" / "★ Saved" toggle shown on recipe cards. Saves to the server,
// then tells the screen the new state via onChange so it can update its list.
export function SaveButton({
  recipeId,
  saved,
  onChange,
}: {
  recipeId: number;
  saved: boolean;
  onChange: (saved: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !saved;
    setBusy(true);
    try {
      await savedApi.set(recipeId, next);
      onChange(next);
    } catch (err) {
      Alert.alert(next ? "Couldn't save recipe" : "Couldn't unsave recipe", describeRecipeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={toggle}
      disabled={busy}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={saved ? "Remove from saved recipes" : "Save recipe"}
      accessibilityState={{ selected: saved, busy }}
    >
      <Text style={[styles.text, saved && styles.savedText, busy && { opacity: 0.5 }]}>
        {saved ? "★ Saved" : "☆ Save"}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  text: {
    fontSize: 13,
    fontWeight: "600",
    color: "#8A5A2E",
  },
  savedText: {
    color: "#D97B4F",
  },
});
