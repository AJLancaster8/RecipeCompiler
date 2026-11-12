import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { RecipeImage } from "../components/recipe-image";
import { SaveButton } from "../components/save-button";
import { Alert } from "../lib/alert";
import { buildQuickPlan } from "../lib/quick-plan";
import { ApiError, recipeApi } from "../lib/recipe-api";
import { usePlans } from "./plan-store";
import { describeRecipeError, Recipe, Step, useRecipes } from "./recipe-store";

const UNIT_SECONDS = { s: 1, m: 60, h: 3600 } as const;
const UNIT_LABEL = { s: "sec", m: "min", h: "hr" } as const;

const stepTime = (s: Step) => (s.timeValue ? `${s.timeValue} ${UNIT_LABEL[s.timeUnit]}` : null);

// "1 hr 25 min", "45 min", "30 sec"
function totalTime(steps: Step[]) {
  const sec = steps.reduce((n, s) => n + (s.timeValue || 0) * UNIT_SECONDS[s.timeUnit], 0);
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  if (m) return `${m} min`;
  return `${Math.round(sec)} sec`;
}

// One recipe on its own full page. Opened by tapping a recipe card in
// My Recipes, Discover or Saved Recipes:  /recipe?id=12
export default function RecipeScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipeId = Number(id);
  const { recipes, savedRecipes, markSaved, deleteRecipe } = useRecipes();
  const { tempPlan, startTempPlan } = usePlans();

  // Show the copy we already have straight away, then the server's latest.
  const cached =
    recipes.find((r) => r.id === recipeId) ?? savedRecipes.find((r) => r.id === recipeId) ?? null;
  const [fetched, setFetched] = useState<Recipe | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reload each time the screen comes into view (e.g. back from editing).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      recipeApi.get<Recipe>(recipeId).then(
        (r) => {
          if (!active) return;
          setFetched(r);
          setMissing(false);
          setError(null);
        },
        (err) => {
          if (!active) return;
          if (err instanceof ApiError && err.status === 404) setMissing(true);
          else setError(describeRecipeError(err));
        },
      );
      return () => {
        active = false;
      };
    }, [recipeId]),
  );

  const recipe = missing ? null : (fetched ?? cached);

  if (!recipe) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
        <Stack.Screen options={{ title: "Recipe" }} />
        <View style={styles.center}>
          {missing ? (
            <Text style={styles.emptyText}>
              This recipe isn&apos;t available any more. It may have been deleted, or its author made it
              private.
            </Text>
          ) : error ? (
            <Text style={styles.emptyText}>{error}</Text>
          ) : (
            <ActivityIndicator color="#D97B4F" />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Editing goes through the recipe form, which works on your own recipes.
  const canEditHere = recipe.canEdit && recipes.some((r) => r.id === recipe.id);
  const ingredientName = (ingId: number) => recipe.ingredients.find((i) => i.id === ingId)?.name;

  // "Make This": cook this recipe as a temporary plan (timers, checklist)
  // without adding it to Saved Plans. Only one runs at a time.
  const cookingThis = tempPlan?.recipeIds.length === 1 && tempPlan.recipeIds[0] === recipe.id;
  const startCooking = async () => {
    const plan = buildQuickPlan(recipe);
    await startTempPlan(plan);
    router.push(`/plan?id=${plan.id}`);
  };
  const makeThis = () => {
    if (cookingThis) {
      router.push(`/plan?id=${tempPlan!.id}`);
      return;
    }
    if (tempPlan) {
      Alert.alert(
        "Replace current session?",
        `You're already making "${tempPlan.name}". Start "${recipe.name}" instead? The other session isn't saved and will be cleared.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start", style: "destructive", onPress: startCooking },
        ],
      );
      return;
    }
    startCooking();
  };

  const onSavedChange = (saved: boolean) => {
    setFetched({ ...recipe, isSaved: saved });
    markSaved(recipe.id, saved);
  };

  const confirmDelete = () =>
    Alert.alert(
      "Delete recipe?",
      `This will permanently delete "${recipe.name}" (and remove it from Discover if it's published).`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteRecipe(recipe.id);
              router.back();
            } catch (err) {
              setDeleting(false);
              Alert.alert("Delete failed", describeRecipeError(err));
            }
          },
        },
      ],
    );

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
      <Stack.Screen options={{ title: recipe.name }} />
      <ScrollView contentContainerStyle={styles.container}>
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error} Showing your last saved copy.</Text>
          </View>
        )}

        <RecipeImage imageUrl={recipe.imageUrl} style={{ borderRadius: 14, marginBottom: 16 }} />

        {/* Title, author, save */}
        <Text style={styles.title}>{recipe.name}</Text>
        <View style={styles.metaRow}>
          <View style={styles.author}>
            <Avatar
              username={recipe.authorName ?? "?"}
              avatarUrl={recipe.authorAvatarUrl}
              size={28}
            />
            <Text style={styles.authorText}>
              by {recipe.isMine ? "you" : (recipe.authorName ?? "unknown cook")}
            </Text>
          </View>
          <SaveButton recipeId={recipe.id} saved={recipe.isSaved} onChange={onSavedChange} />
        </View>
        <Text style={recipe.isPublic ? styles.publishedBadge : styles.privateBadge}>
          {recipe.isPublic ? "Published to Discover" : "Private"}
        </Text>

        <TouchableOpacity
          style={styles.makeButton}
          onPress={makeThis}
          disabled={recipe.steps.length === 0}
          accessibilityRole="button"
          accessibilityHint="Opens this recipe as a temporary cooking session with timers"
        >
          <Text style={styles.makeButtonText}>
            {cookingThis ? "▶ Resume Cooking" : "▶ Make This"}
          </Text>
        </TouchableOpacity>

        {/* At a glance */}
        <View style={styles.stats}>
          <Stat value={String(recipe.ingredients.length)} label="Ingredients" />
          <Stat value={String(recipe.steps.length)} label="Steps" />
          <Stat value={totalTime(recipe.steps)} label="Total time" />
        </View>

        {/* Ingredients */}
        <Text style={styles.sectionHeading}>Ingredients</Text>
        <View style={styles.card}>
          {recipe.ingredients.length === 0 ? (
            <Text style={styles.muted}>No ingredients listed.</Text>
          ) : (
            recipe.ingredients.map((ing, i) => (
              <View
                key={ing.id}
                style={[styles.ingredientRow, i < recipe.ingredients.length - 1 && styles.rowBorder]}
              >
                <Text style={styles.ingredientName}>{ing.name}</Text>
                {ing.amount ? (
                  <Text style={styles.ingredientAmount}>
                    {ing.amount} {ing.unit}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/* Steps */}
        <Text style={styles.sectionHeading}>Steps</Text>
        {recipe.steps.length === 0 && <Text style={styles.muted}>No steps listed.</Text>}
        {recipe.steps.map((step, i) => {
          const time = stepTime(step);
          const uses = (step.ingredientIds || []).map(ingredientName).filter(Boolean) as string[];
          return (
            <View key={step.id} style={styles.stepCard}>
              <View style={styles.stepHeader}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepTitle}>{step.text}</Text>
                {time && <Text style={styles.timeChip}>⏱ {time}</Text>}
              </View>
              {step.description ? <Text style={styles.stepDescription}>{step.description}</Text> : null}
              {uses.length > 0 && (
                <View style={styles.usesRow}>
                  {uses.map((name, k) => (
                    <Text key={`${name}-${k}`} style={styles.useChip}>
                      {name}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {canEditHere && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => router.push(`/new-recipe?id=${recipe.id}`)}
              disabled={deleting}
            >
              <Text style={styles.editButtonText}>Edit Recipe</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} disabled={deleting}>
              <Text style={styles.deleteButtonText}>{deleting ? "Deleting..." : "Delete"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
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
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#2B2118",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    gap: 12,
  },
  author: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  authorText: {
    fontSize: 15,
    color: "#4A3B2C",
    fontWeight: "600",
    flexShrink: 1,
  },
  publishedBadge: {
    fontSize: 12,
    color: "#5E8A4F",
    fontWeight: "600",
    marginTop: 8,
  },
  privateBadge: {
    fontSize: 12,
    color: "#8A7A68",
    fontWeight: "600",
    marginTop: 8,
  },
  makeButton: {
    backgroundColor: "#D97B4F",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 18,
  },
  makeButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 17,
  },
  stats: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    marginBottom: 24,
  },
  stat: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#2B2118",
  },
  statLabel: {
    fontSize: 12,
    color: "#8A7A68",
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  muted: {
    fontSize: 14,
    color: "#8A7A68",
    paddingVertical: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  ingredientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    gap: 16,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#EFE8DE",
  },
  ingredientName: {
    fontSize: 15,
    color: "#2B2118",
    flexShrink: 1,
  },
  ingredientAmount: {
    fontSize: 15,
    fontWeight: "600",
    color: "#8A5A2E",
  },
  stepCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#D97B4F",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  stepTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#2B2118",
  },
  timeChip: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8A5A2E",
    backgroundColor: "#F3E4D3",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  stepDescription: {
    fontSize: 14,
    color: "#4A3B2C",
    marginTop: 8,
    marginLeft: 38,
    lineHeight: 20,
  },
  usesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    marginLeft: 38,
  },
  useChip: {
    fontSize: 12,
    color: "#4A3B2C",
    backgroundColor: "#F3EEE6",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  editButton: {
    flex: 2,
    backgroundColor: "#D97B4F",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  editButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  deleteButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#B04A3B",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#B04A3B",
    fontWeight: "700",
    fontSize: 16,
  },
});
