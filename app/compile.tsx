import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRecipes } from "./recipe-store";

export default function CompileScreen() {
  const router = useRouter();
  const { recipes } = useRecipes();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const toggle = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCompile = () => {
    if (selectedIds.length < 2) {
      Alert.alert(
        "Select at least 2 recipes",
        "Choose two or more recipes to combine.",
      );
      return;
    }
    router.push(`/compiled?ids=${selectedIds.join(",")}`);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.subheader}>
          Choose two or more recipes to combine their ingredients and steps.
        </Text>

        <ScrollView
          style={{ width: "100%" }}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {recipes.length === 0 ? (
            <Text style={styles.emptyText}>
              You don't have any saved recipes yet.
            </Text>
          ) : (
            recipes.map((r) => {
              const selected = selectedIds.includes(r.id);
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.recipeOption,
                    selected && styles.recipeOptionSelected,
                  ]}
                  onPress={() => toggle(r.id)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selected && styles.checkboxChecked,
                    ]}
                  >
                    {selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.recipeOptionText}>{r.name}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        <TouchableOpacity
          style={[
            styles.compileButton,
            selectedIds.length < 2 && styles.compileButtonDisabled,
          ]}
          onPress={handleCompile}
          disabled={selectedIds.length < 2}
        >
          <Text style={styles.compileButtonText}>
            Compile{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  subheader: {
    fontSize: 14,
    color: "#8A7A68",
    textAlign: "center",
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 40,
  },
  recipeOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  recipeOptionSelected: {
    borderColor: "#D97B4F",
    backgroundColor: "#FBEFE6",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#D9CFC3",
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#D97B4F",
    borderColor: "#D97B4F",
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  recipeOptionText: {
    fontSize: 16,
    color: "#2B2118",
    fontWeight: "600",
  },
  compileButton: {
    backgroundColor: "#D97B4F",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    marginTop: 12,
    marginBottom: 20,
  },
  compileButtonDisabled: {
    opacity: 0.5,
  },
  compileButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
