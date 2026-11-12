import { StyleSheet, Text, View } from "react-native";
import type { Recipe } from "../app/recipe-store";
import { RecipeDetails } from "./recipe-details";
import { SaveButton } from "./save-button";

// A recipe card showing who made it, with a Save toggle. Used by Discover
// and Saved Recipes (your own recipes are edited from the home screen).
export function SharedRecipeCard({
  recipe,
  onSavedChange,
}: {
  recipe: Recipe;
  onSavedChange: (saved: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{recipe.name}</Text>
        <SaveButton recipeId={recipe.id} saved={recipe.isSaved} onChange={onSavedChange} />
      </View>
      <Text style={styles.authorLine}>
        by {recipe.isMine ? "you" : (recipe.authorName ?? "unknown cook")}
        {!recipe.isPublic ? "  ·  Private" : ""}
      </Text>
      <RecipeDetails recipe={recipe} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    width: "100%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2B2118",
    flexShrink: 1,
  },
  authorLine: {
    fontSize: 13,
    color: "#8A7A68",
    marginBottom: 4,
  },
});
