import { useFocusEffect } from "expo-router";
import { ComponentRef, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Pagination } from "../components/pagination";
import { SharedRecipeCard } from "../components/shared-recipe-card";
import { DiscoverPage, discoverApi } from "../lib/recipe-api";
import { describeRecipeError, Recipe, useRecipes } from "./recipe-store";

const POLL_INTERVAL_MS = 15000;
const SEARCH_DEBOUNCE_MS = 350;

// Every recipe anyone has published, searchable by recipe name, ingredient
// or username, 10 per page. Read-only here — your own recipes are edited
// from the home screen.
export default function DiscoverScreen() {
  const { markSaved } = useRecipes();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const [input, setInput] = useState(""); // what's typed in the search box
  const [query, setQuery] = useState(""); // what we last searched for
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<DiscoverPage<Recipe> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search a moment after typing stops, starting again from page 1.
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === query) return;
    const timer = setTimeout(() => {
      setQuery(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, query]);

  // Fetches the current page. Resolves to an update to apply, so the
  // caller can skip it if the screen closed or the search changed meanwhile.
  const fetchPage = useCallback(async () => {
    try {
      const data = await discoverApi.search<Recipe>(query, page);
      return () => {
        setResult(data);
        // The server snaps out-of-range pages (e.g. after recipes were
        // deleted) to the last real page — follow it.
        if (data.page !== page) setPage(data.page);
        setError(null);
      };
    } catch (err) {
      return () => setError(describeRecipeError(err));
    }
  }, [query, page]);

  // Reload when the screen comes into view or the search/page changes, and
  // keep polling while it's open so deleted or unpublished recipes disappear
  // for everyone without them having to pull to refresh.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refreshNow = () =>
        fetchPage().then((apply) => {
          if (!active) return;
          apply();
          setLoading(false);
        });
      refreshNow();
      const timer = setInterval(refreshNow, POLL_INTERVAL_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [fetchPage]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    (await fetchPage())();
    setRefreshing(false);
  };

  const goToPage = (p: number) => {
    setPage(p);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const onSavedChange = (recipe: Recipe, saved: boolean) => {
    setResult((prev) =>
      prev && {
        ...prev,
        recipes: prev.recipes.map((x) => (x.id === recipe.id ? { ...x, isSaved: saved } : x)),
      },
    );
    // Keeps My Recipes and the recipes available to plans in sync.
    markSaved(recipe.id, saved);
  };

  const recipes = result?.recipes ?? [];
  const total = result?.total ?? 0;
  const pageCount = result?.pageCount ?? 1;
  const searching = query.length > 0;
  const firstShown = (page - 1) * (result?.pageSize ?? 10) + 1;
  const lastShown = firstShown + recipes.length - 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={input}
            onChangeText={setInput}
            placeholder="Search by recipe, ingredient or username"
            placeholderTextColor="#B5A898"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              setQuery(input.trim());
              setPage(1);
            }}
            accessibilityLabel="Search recipes"
          />
          {input.length > 0 && (
            <TouchableOpacity
              onPress={() => setInput("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Text style={styles.clearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

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
                ? "Couldn't load published recipes."
                : searching
                  ? `No published recipes match “${query}”. Try a recipe name, an ingredient, or a username.`
                  : "No one has published a recipe yet. Turn on “Publish to Discover” when saving a recipe to share yours."}
            </Text>
            <TouchableOpacity onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.retryText}>{refreshing ? "Refreshing..." : "Refresh"}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ width: "100%" }}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97B4F" />
            }
          >
            <Text style={styles.intro}>
              {searching ? `${total} ${total === 1 ? "match" : "matches"}` : `${total} published`}
              {pageCount > 1 ? `  ·  showing ${firstShown}–${lastShown}` : ""}
            </Text>
            {recipes.map((r) => (
              <SharedRecipeCard
                key={r.id}
                recipe={r}
                onSavedChange={(saved) => onSavedChange(r, saved)}
              />
            ))}
            <Pagination page={page} pageCount={pageCount} onChange={goToPage} />
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: "#2B2118",
  },
  clearText: {
    fontSize: 16,
    color: "#8A7A68",
    paddingLeft: 8,
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
