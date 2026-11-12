import { StyleSheet, Text, View } from "react-native";
import type { Recipe } from "../app/recipe-store";

// The ingredients and steps of a recipe, as shown inside a recipe card.
// Shared by the home screen and Discover.
export function RecipeDetails({ recipe }: { recipe: Recipe }) {
  return (
    <>
      <Text style={styles.sectionLabel}>Ingredients</Text>
      {recipe.ingredients.map((ing) => (
        <Text key={ing.id} style={styles.detailLine}>
          • {ing.name}
          {ing.amount ? `  —  ${ing.amount} ${ing.unit}` : ""}
        </Text>
      ))}

      <Text style={styles.sectionLabel}>Steps</Text>
      {recipe.steps.map((s, i) => {
        const usedIngredients = (s.ingredientIds || [])
          .map((id) => recipe.ingredients.find((ing) => ing.id === id))
          .filter((ing) => !!ing);
        return (
          <View key={s.id} style={styles.stepDetailBlock}>
            <Text style={styles.detailLine}>
              {i + 1}. {s.text}
              {s.timeValue ? `  (${s.timeValue}${s.timeUnit})` : ""}
            </Text>
            {s.description ? (
              <Text style={styles.stepDescription}>{s.description}</Text>
            ) : null}
            {usedIngredients.length > 0 && (
              <Text style={styles.stepIngredientsUsed}>
                Uses: {usedIngredients.map((ing) => ing!.name).join(", ")}
              </Text>
            )}
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
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
});
