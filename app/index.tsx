import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { RecipeDetails } from "../components/recipe-details";
import { RecipeImage } from "../components/recipe-image";
import { SaveButton } from "../components/save-button";
import { usePlans } from "./plan-store";
import { describeRecipeError, Recipe, useRecipes } from "./recipe-store";

export default function HomeScreen() {
  const router = useRouter();
  const {
    recipes,
    planRecipes,
    deleteRecipe,
    markSaved,
    loading,
    refresh,
    refreshing,
    error,
  } = useRecipes();
  const { plans } = usePlans();

  const confirmDelete = (id: number, name: string) => {
    Alert.alert(
      "Delete recipe?",
      `This will permanently delete "${name}" (and remove it from Discover if it's published).`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteRecipe(id).catch((err) =>
              Alert.alert("Delete failed", describeRecipeError(err)),
            ),
        },
      ],
    );
  };

  // Tapping a card opens the recipe on its own page.
  const renderCard = (r: Recipe) => (
    <Pressable
      key={r.id}
      style={({ pressed }) => [styles.recipeCard, pressed && { opacity: 0.7 }]}
      onPress={() => router.push(`/recipe?id=${r.id}`)}
      accessibilityRole="button"
      accessibilityHint="Opens the full recipe"
    >
      <RecipeImage imageUrl={r.imageUrl} style={{ aspectRatio: 16 / 9, marginBottom: 12 }} />
      <View style={styles.recipeCardHeader}>
        <Text style={styles.recipeCardTitle}>{r.name}</Text>
        <View style={styles.cardActions}>
          <SaveButton
            recipeId={r.id}
            saved={r.isSaved}
            onChange={(saved) => markSaved(r.id, saved)}
          />
          {r.canEdit && (
            <>
              <TouchableOpacity
                onPress={() => router.push(`/new-recipe?id=${r.id}`)}
              >
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(r.id, r.name)}>
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      <Text style={r.isPublic ? styles.publishedBadge : styles.privateBadge}>
        {r.isPublic ? "Published to Discover" : "Private"}
      </Text>

      <RecipeDetails recipe={r} />
      <Text style={styles.openHint}>View full recipe ›</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.homeContainer}>
        <Text style={styles.homeHeader}>Recipes</Text>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {error}
              {recipes.length > 0 ? " Showing your last saved copy." : ""}
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#D97B4F" />
        ) : recipes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              No recipes yet. Tap the button below to add your first one.
            </Text>
            {error && (
              <TouchableOpacity onPress={refresh} disabled={refreshing}>
                <Text style={styles.retryText}>
                  {refreshing ? "Retrying..." : "Retry"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView
            style={{ width: "100%" }}
            contentContainerStyle={{ paddingBottom: 20 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor="#D97B4F"
              />
            }
          >
            <Text style={styles.listHeading}>My Recipes</Text>
            {recipes.map(renderCard)}
          </ScrollView>
        )}

        <TouchableOpacity
          style={styles.addRecipeButton}
          onPress={() => router.push("/new-recipe")}
        >
          <Text style={styles.addRecipeButtonText}>+ Add Recipe</Text>
        </TouchableOpacity>

        {/* Saved recipes count too — a plan can mix them with your own. */}
        {planRecipes.length >= 2 && (
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
  emptyWrap: {
    flex: 1,
    alignItems: "center",
  },
  retryText: {
    fontSize: 15,
    color: "#D97B4F",
    fontWeight: "700",
    marginTop: 16,
  },
  errorBanner: {
    backgroundColor: "#F6E3DE",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    width: "100%",
  },
  errorText: {
    fontSize: 13,
    color: "#B04A3B",
  },
  listHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 8,
  },
  publishedBadge: {
    fontSize: 12,
    color: "#5E8A4F",
    fontWeight: "600",
    marginTop: -4,
    marginBottom: 4,
  },
  privateBadge: {
    fontSize: 12,
    color: "#8A7A68",
    fontWeight: "600",
    marginTop: -4,
    marginBottom: 4,
  },
  emptyText: {
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
  openHint: {
    fontSize: 13,
    fontWeight: "600",
    color: "#D97B4F",
    marginTop: 4,
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
