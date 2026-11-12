import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SharedRecipeCard } from "../components/shared-recipe-card";
import { savedApi } from "../lib/recipe-api";
import { describeRecipeError, Recipe, useRecipes } from "./recipe-store";

// Every recipe the signed-in user has saved (theirs or other people's
// published ones), most recently saved first.
export default function SavedRecipesScreen() {
  const { markSaved } = useRecipes();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolves to an update to apply, so the caller can skip it if the
  // screen has closed in the meantime.
  const fetchSaved = useCallback(async () => {
    try {
      const saved = await savedApi.list<Recipe>();
      return () => {
        setRecipes(saved);
        setError(null);
      };
    } catch (err) {
      return () => setError(describeRecipeError(err));
    }
  }, []);

  // Reload whenever the screen comes into view, so recipes saved from
  // Discover or My Recipes show up straight away.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchSaved().then((apply) => {
        if (!active) return;
        apply();
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [fetchSaved]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    (await fetchSaved())();
    setRefreshing(false);
  };

  const onSavedChange = (recipe: Recipe, saved: boolean) => {
    if (!saved) {
      // Unsaved: it no longer belongs in this list.
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
    } else {
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, isSaved: true } : r)));
    }
    // Keeps My Recipes and the recipes available to plans in sync.
    markSaved(recipe.id, saved);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <View style={styles.container}>
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#D97B4F" />
        ) : recipes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {error
                ? "Couldn't load your saved recipes."
                : "You haven't saved any recipes yet. Tap “☆ Save” on a recipe in Discover or My Recipes to keep it here."}
            </Text>
            <TouchableOpacity onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.retryText}>{refreshing ? "Refreshing..." : "Refresh"}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={{ width: "100%" }}
            contentContainerStyle={{ paddingBottom: 20 }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97B4F" />
            }
          >
            <Text style={styles.intro}>
              {recipes.length} saved {recipes.length === 1 ? "recipe" : "recipes"}
            </Text>
            {recipes.map((r) => (
              <SharedRecipeCard
                key={r.id}
                recipe={r}
                onSavedChange={(saved) => onSavedChange(r, saved)}
              />
            ))}
          </ScrollView>
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
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  intro: {
    fontSize: 14,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  errorBanner: {
    backgroundColor: "#F6E3DE",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: "#B04A3B",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 40,
  },
  retryText: {
    fontSize: 15,
    color: "#D97B4F",
    fontWeight: "700",
    marginTop: 16,
  },
});
