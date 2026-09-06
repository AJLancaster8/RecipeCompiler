import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Plan, PlanStep, PlanStepIngredient, usePlans } from "./plan-store";
import { getRecipeColor } from "./recipe-colors";
import { nextId, useRecipes } from "./recipe-store";

// Converts a step's time unit into seconds so different-unit steps
// (a "5 m" step and a "1 h" step) can be placed on one shared timeline.
function unitToSeconds(unit: "s" | "m" | "h"): number {
  if (unit === "s") return 1;
  if (unit === "m") return 60;
  return 3600;
}

// Turns a raw second count back into a friendly label like "5m" or "1.5h"
function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  if (totalSeconds < 3600) {
    const m = totalSeconds / 60;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
  }
  const h = totalSeconds / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

type TimelineItem = {
  recipeId: number;
  recipeName: string;
  text: string;
  description: string;
  offsetSeconds: number;
  durationSeconds: number;
  ingredients: PlanStepIngredient[];
};

type CombinedIngredient = {
  name: string;
  amounts: { amount: number; unit: string }[];
};

export default function CompiledScreen() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const router = useRouter();
  const { recipes } = useRecipes();
  const { addPlan } = usePlans();
  const [saving, setSaving] = useState(false);

  const selectedRecipes = useMemo(() => {
    if (!ids) return [];
    const idList = ids.split(",").map((x) => Number(x));
    return recipes.filter((r) => idList.includes(r.id));
  }, [ids, recipes]);

  const [planName, setPlanName] = useState("");

  const defaultName = useMemo(
    () => selectedRecipes.map((r) => r.name).join(" + "),
    [selectedRecipes],
  );
  const effectivePlanName = planName.trim().length > 0 ? planName : defaultName;

  // Selection order, reused both for saving the plan and for assigning
  // each recipe a consistent color throughout this screen.
  const recipeIds = useMemo(
    () => selectedRecipes.map((r) => r.id),
    [selectedRecipes],
  );

  // Groups ingredients by name, summing amounts that share the same unit
  // and listing different units side by side on that ingredient's one
  // line — e.g. two recipes each using onions, one "1 whole" and one
  // "3 cup", become a single "Onion — 1 whole; 3 cup" entry instead of
  // two separate lines.
  const combinedIngredients = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; unitTotals: Map<string, number> }
    >();

    selectedRecipes.forEach((r) => {
      r.ingredients.forEach((ing: any) => {
        const key = ing.name.trim().toLowerCase();
        let group = groups.get(key);
        if (!group) {
          group = { name: ing.name.trim(), unitTotals: new Map() };
          groups.set(key, group);
        }
        const current = group.unitTotals.get(ing.unit) || 0;
        group.unitTotals.set(ing.unit, current + ing.amount);
      });
    });

    return Array.from(groups.values())
      .map((g) => ({
        name: g.name,
        amounts: Array.from(g.unitTotals.entries())
          .map(([unit, amount]) => ({ unit, amount }))
          .sort((a, b) => a.unit.localeCompare(b.unit)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedRecipes]);

  // A short "1 whole; 3 cup" style summary for one ingredient's amounts
  // Joins amounts naturally: "1 whole", "1 whole and 3 cup", or
  // "1 whole, 3 cup, and 2 tbsp" for three or more.
  const formatAmounts = (amounts: { amount: number; unit: string }[]) => {
    const parts = amounts.map(
      (a) => `${Math.round(a.amount * 100) / 100} ${a.unit}`,
    );
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  };

  // Builds one shared timeline, aligned so every recipe's LAST step
  // finishes at the same moment (e.g. a side dish and a main course
  // should both be ready together) — rather than all recipes starting
  // together. To do this: find the longest total recipe duration, then
  // give every shorter recipe a start delay equal to the difference, so
  // it still finishes exactly when the longest one does. Within a
  // recipe, a step's "offset" is its start delay plus the total time of
  // every step before it in that same recipe. Steps from every selected
  // recipe are then merged and sorted by that offset. Each step also
  // carries its own resolved ingredient list (name/amount/unit, looked up
  // from the recipe's ingredientIds), so both the timeline here and the
  // saved plan later can show exactly what that step uses.
  const timeline = useMemo(() => {
    const recipeTotals = selectedRecipes.map((r) =>
      r.steps.reduce(
        (sum: number, s: any) =>
          sum + (s.timeValue || 0) * unitToSeconds(s.timeUnit),
        0,
      ),
    );
    const maxTotal = recipeTotals.length > 0 ? Math.max(...recipeTotals) : 0;

    const items: TimelineItem[] = [];

    selectedRecipes.forEach((r, recipeIndex) => {
      const startDelay = maxTotal - recipeTotals[recipeIndex];
      let cumulative = startDelay;
      r.steps.forEach((s: any) => {
        const durationSeconds = (s.timeValue || 0) * unitToSeconds(s.timeUnit);
        const stepIngredients: PlanStepIngredient[] = (s.ingredientIds || [])
          .map((id: number) => r.ingredients.find((ing: any) => ing.id === id))
          .filter(Boolean)
          .map((ing: any) => ({
            name: ing.name,
            amount: ing.amount,
            unit: ing.unit,
          }));

        items.push({
          recipeId: r.id,
          recipeName: r.name,
          text: s.text,
          description: s.description || "",
          offsetSeconds: cumulative,
          durationSeconds,
          ingredients: stepIngredients,
        });
        cumulative += durationSeconds;
      });
    });

    return items.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  }, [selectedRecipes]);

  const handleSavePlan = async () => {
    if (selectedRecipes.length === 0) return;
    setSaving(true);
    try {
      const planSteps: PlanStep[] = timeline.map((t) => ({
        id: nextId(),
        recipeId: t.recipeId,
        recipeName: t.recipeName,
        text: t.text,
        description: t.description,
        offsetSeconds: t.offsetSeconds,
        durationSeconds: t.durationSeconds,
        ingredients: t.ingredients,
      }));

      const plan: Plan = {
        id: nextId(),
        name: effectivePlanName,
        recipeIds: recipeIds,
        ingredients: combinedIngredients.map((ing) => ({
          ...ing,
          checked: false,
        })),
        steps: planSteps,
        activeSteps: [],
      };

      await addPlan(plan);
      Alert.alert("Plan saved!", `"${plan.name}" was saved to your device.`, [
        {
          text: "View Plan",
          onPress: () => router.replace(`/plan?id=${plan.id}`),
        },
      ]);
    } catch (err) {
      Alert.alert(
        "Save failed",
        "There was a problem saving this plan to your device.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Plan Name</Text>
        <TextInput
          style={styles.input}
          placeholder={defaultName}
          value={planName}
          onChangeText={setPlanName}
        />

        <Text style={styles.sectionTitle}>Combined Ingredients</Text>
        {combinedIngredients.length === 0 ? (
          <Text style={styles.emptyText}>No ingredients found.</Text>
        ) : (
          combinedIngredients.map((ing, idx) => (
            <Text key={idx} style={styles.detailLine}>
              • {ing.name} — {formatAmounts(ing.amounts)}
            </Text>
          ))
        )}

        <Text style={styles.sectionTitle}>Timeline</Text>
        <Text style={styles.timelineHint}>
          Timed so every recipe's last step finishes at the same time.
        </Text>
        {timeline.length === 0 ? (
          <Text style={styles.emptyText}>No steps found.</Text>
        ) : (
          timeline.map((step, idx) => {
            const color = getRecipeColor(step.recipeId, recipeIds);
            return (
              <View
                key={idx}
                style={[styles.timelineRow, { borderLeftColor: color }]}
              >
                <View style={styles.timelineOffsetBadge}>
                  <Text style={styles.timelineOffsetText}>
                    {formatSeconds(step.offsetSeconds)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.timelineRecipeTag, { color }]}>
                    {step.recipeName}
                  </Text>
                  <Text style={styles.timelineText}>{step.text}</Text>
                  {step.description ? (
                    <Text style={styles.timelineDescription}>
                      {step.description}
                    </Text>
                  ) : null}
                  {step.ingredients.length > 0 && (
                    <Text style={styles.timelineIngredients}>
                      Uses: {step.ingredients.map((i) => i.name).join(", ")}
                    </Text>
                  )}
                </View>
              </View>
            );
          })
        )}

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSavePlan}
          disabled={saving || selectedRecipes.length === 0}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving..." : "Save Plan"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    padding: 20,
    paddingBottom: 60,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    color: "#4A3B2C",
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#2B2118",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 10,
  },
  timelineHint: {
    fontSize: 12,
    color: "#A89885",
    marginBottom: 10,
    marginTop: -4,
  },
  emptyText: {
    fontSize: 14,
    color: "#8A7A68",
  },
  detailLine: {
    fontSize: 15,
    color: "#2B2118",
    marginBottom: 6,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
    borderLeftWidth: 4,
    paddingLeft: 10,
  },
  timelineOffsetBadge: {
    backgroundColor: "#D97B4F",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
    minWidth: 48,
    alignItems: "center",
  },
  timelineOffsetText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  timelineRecipeTag: {
    fontSize: 11,
    color: "#8A5A2E",
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  timelineText: {
    fontSize: 15,
    color: "#2B2118",
    marginBottom: 2,
  },
  timelineDescription: {
    fontSize: 13,
    color: "#8A7A68",
  },
  timelineIngredients: {
    fontSize: 12,
    color: "#8A5A2E",
    fontStyle: "italic",
    marginTop: 2,
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: "#D97B4F",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
