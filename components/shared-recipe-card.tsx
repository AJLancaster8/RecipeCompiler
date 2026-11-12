import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Recipe } from "../app/recipe-store";
import { RecipeDetails } from "./recipe-details";
import { RecipeImage } from "./recipe-image";
import { SaveButton } from "./save-button";

// A recipe card showing who made it, with a Save toggle. Used by Discover
// and Saved Recipes (your own recipes are edited from the home screen).
// Tapping it opens the recipe on its own page.
export function SharedRecipeCard({
  recipe,
  onSavedChange,
}: {
  recipe: Recipe;
  onSavedChange: (saved: boolean) => void;
}) {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={() => router.push(`/recipe?id=${recipe.id}`)}
      accessibilityRole="button"
      accessibilityHint="Opens the full recipe"
    >
      <RecipeImage imageUrl={recipe.imageUrl} style={{ aspectRatio: 16 / 9, marginBottom: 12 }} />
      <View style={styles.header}>
        <Text style={styles.title}>{recipe.name}</Text>
        <SaveButton recipeId={recipe.id} saved={recipe.isSaved} onChange={onSavedChange} />
      </View>
      <Text style={styles.authorLine}>
        by {recipe.isMine ? "you" : (recipe.authorName ?? "unknown cook")}
        {!recipe.isPublic ? "  ·  Private" : ""}
      </Text>
      <RecipeDetails recipe={recipe} />
      <Text style={styles.openHint}>View full recipe ›</Text>
    </Pressable>
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
  pressed: {
    opacity: 0.7,
  },
  openHint: {
    fontSize: 13,
    fontWeight: "600",
    color: "#D97B4F",
    marginTop: 4,
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
