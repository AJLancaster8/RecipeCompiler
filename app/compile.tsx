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
  const [appetizerIds, setAppetizerIds] = useState<number[]>([]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const nowSelected = !prev.includes(id);
      if (!nowSelected) {
        // Deselecting a recipe also clears its appetizer mark
        setAppetizerIds((a) => a.filter((x) => x !== id));
      }
      return nowSelected ? [...prev, id] : prev.filter((x) => x !== id);
    });
  };

  const toggleAppetizer = (id: number) => {
    setAppetizerIds((prev) =>
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
    const appetizersParam =
      appetizerIds.length > 0 ? `&appetizers=${appetizerIds.join(",")}` : "";
    router.push(`/compiled?ids=${selectedIds.join(",")}${appetizersParam}`);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.subheader}>
          Choose two or more recipes to combine their ingredients and steps.
          Mark any as an appetizer to have it finish as soon as possible,
          instead of finishing alongside the rest.
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
              const isAppetizer = appetizerIds.includes(r.id);
              return (
                <View
                  key={r.id}
                  style={[
                    styles.recipeOption,
                    selected && styles.recipeOptionSelected,
                  ]}
                >
                  <TouchableOpacity
                    style={styles.recipeMainRow}
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

                  {selected && (
                    <TouchableOpacity
                      style={styles.appetizerRow}
                      onPress={() => toggleAppetizer(r.id)}
                    >
                      <View
                        style={[
                          styles.checkboxSmall,
                          isAppetizer && styles.checkboxChecked,
                        ]}
                      >
                        {isAppetizer && (
                          <Text style={styles.checkmarkSmall}>✓</Text>
                        )}
                      </View>
                      <Text style={styles.appetizerText}>
                        Appetizer (finish ASAP)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
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
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  recipeMainRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  appetizerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    marginLeft: 34,
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
  checkboxSmall: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#D9CFC3",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
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
  checkmarkSmall: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  recipeOptionText: {
    fontSize: 16,
    color: "#2B2118",
    fontWeight: "600",
  },
  appetizerText: {
    fontSize: 13,
    color: "#8A5A2E",
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
