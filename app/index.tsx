import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePlans } from "./plan-store";
import { useRecipes } from "./recipe-store";

export default function HomeScreen() {
  const router = useRouter();
  const { recipes, deleteRecipe, loading } = useRecipes();
  const { plans } = usePlans();

  const confirmDelete = (id: number, name: string) => {
    Alert.alert(
      "Delete recipe?",
      `This will remove "${name}" from your device.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteRecipe(id),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.homeContainer}>
        <Text style={styles.homeHeader}>My Recipes</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#D97B4F" />
        ) : recipes.length === 0 ? (
          <Text style={styles.emptyText}>
            No recipes yet. Tap the button below to add your first one.
          </Text>
        ) : (
          <ScrollView
            style={{ width: "100%" }}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {recipes.map((r) => (
              <View key={r.id} style={styles.recipeCard}>
                <View style={styles.recipeCardHeader}>
                  <Text style={styles.recipeCardTitle}>{r.name}</Text>
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      onPress={() => router.push(`/new-recipe?id=${r.id}`)}
                    >
                      <Text style={styles.editText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmDelete(r.id, r.name)}
                    >
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.sectionLabel}>Ingredients</Text>
                {r.ingredients.map((ing: any) => (
                  <Text key={ing.id} style={styles.detailLine}>
                    • {ing.name}
                    {ing.amount ? `  —  ${ing.amount} ${ing.unit}` : ""}
                  </Text>
                ))}

                <Text style={styles.sectionLabel}>Steps</Text>
                {r.steps.map((s: any, i: number) => {
                  const usedIngredients = (s.ingredientIds || [])
                    .map((id: number) =>
                      r.ingredients.find((ing: any) => ing.id === id),
                    )
                    .filter(Boolean);
                  return (
                    <View key={s.id} style={styles.stepDetailBlock}>
                      <Text style={styles.detailLine}>
                        {i + 1}. {s.text}
                        {s.timeValue ? `  (${s.timeValue}${s.timeUnit})` : ""}
                      </Text>
                      {s.description ? (
                        <Text style={styles.stepDescription}>
                          {s.description}
                        </Text>
                      ) : null}
                      {usedIngredients.length > 0 && (
                        <Text style={styles.stepIngredientsUsed}>
                          Uses:{" "}
                          {usedIngredients
                            .map((ing: any) => ing.name)
                            .join(", ")}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity
          style={styles.addRecipeButton}
          onPress={() => router.push("/new-recipe")}
        >
          <Text style={styles.addRecipeButtonText}>+ Add Recipe</Text>
        </TouchableOpacity>

        {recipes.length >= 2 && (
          <TouchableOpacity
            style={styles.compileButton}
            onPress={() => router.push("/compile")}
          >
            <Text style={styles.compileButtonText}>Compile Recipes</Text>
          </TouchableOpacity>
        )}

        {plans.length > 0 && (
          <TouchableOpacity
            style={styles.compileButton}
            onPress={() => router.push("/plans")}
          >
            <Text style={styles.compileButtonText}>View Saved Plans</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  homeContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  homeHeader: {
    fontSize: 30,
    fontWeight: "700",
    color: "#2B2118",
    marginBottom: 24,
  },
  emptyText: {
    flex: 1,
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 40,
  },
  recipeCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    width: "100%",
  },
  recipeCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  recipeCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2B2118",
  },
  cardActions: {
    flexDirection: "row",
    gap: 16,
  },
  editText: {
    fontSize: 13,
    color: "#8A5A2E",
    fontWeight: "600",
  },
  deleteText: {
    fontSize: 13,
    color: "#B04A3B",
    fontWeight: "600",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 4,
  },
  detailLine: {
    fontSize: 14,
    color: "#4A3B2C",
    marginBottom: 2,
  },
  stepDetailBlock: {
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: 13,
    color: "#8A7A68",
    marginLeft: 16,
    marginTop: 2,
  },
  stepIngredientsUsed: {
    fontSize: 12,
    color: "#8A5A2E",
    fontStyle: "italic",
    marginLeft: 16,
    marginTop: 2,
  },
  addRecipeButton: {
    backgroundColor: "#D97B4F",
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    marginTop: 12,
    marginBottom: 20,
  },
  addRecipeButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  compileButton: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#D97B4F",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    marginBottom: 20,
  },
  compileButtonText: {
    color: "#D97B4F",
    fontSize: 16,
    fontWeight: "700",
  },
});
