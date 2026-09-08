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

// Formats a Date's time-of-day as 12-hour with AM/PM, e.g. "6:30:00 PM"
function formatClockTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let hours = date.getHours();
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${meridiem}`;
}

type TimelineItem = {
  recipeId: number;
  recipeName: string;
  text: string;
  description: string;
  offsetSeconds: number;
  durationSeconds: number;
  ingredients: PlanStepIngredient[];
  isAppetizer: boolean;
};

type CombinedIngredient = {
  name: string;
  amounts: { amount: number; unit: string }[];
};

export default function CompiledScreen() {
  const { ids, appetizers } = useLocalSearchParams<{
    ids?: string;
    appetizers?: string;
  }>();
  const router = useRouter();
  const { recipes } = useRecipes();
  const { addPlan } = usePlans();
  const [saving, setSaving] = useState(false);

  const appetizerRecipeIds = useMemo(() => {
    if (!appetizers) return [] as number[];
    return appetizers.split(",").map((x) => Number(x));
  }, [appetizers]);

  const selectedRecipes = useMemo(() => {
    if (!ids) return [];
    const idList = ids.split(",").map((x) => Number(x));
    return recipes.filter((r) => idList.includes(r.id));
  }, [ids, recipes]);

  const [planName, setPlanName] = useState("");
  const [endTimeDigits, setEndTimeDigits] = useState(""); // up to 4 raw digits, e.g. "0630"
  const [endTimeMeridiem, setEndTimeMeridiem] = useState<"AM" | "PM">("PM");

  // Captured once when this screen loads, so "start immediately" has a
  // stable reference point rather than drifting to a new "now" on every
  // render.
  const [generatedAt] = useState(() => new Date());

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

  // Builds one shared timeline in two groups:
  //  - "Main" recipes (not marked as appetizers) are aligned so all of
  //    THEIR last steps finish at the same moment — find the longest
  //    total duration among just the mains, then give every shorter main
  //    a start delay equal to the difference, so it still finishes when
  //    the longest one does.
  //  - Appetizer-marked recipes skip that alignment entirely and always
  //    start at time zero, so they finish as soon as possible rather than
  //    being held back to line up with the mains.
  // Within a recipe, a step's "offset" is its recipe's start delay plus
  // the total time of every step before it in that same recipe. Steps
  // from every selected recipe are then merged and sorted by that
  // offset. Each step also carries its own resolved ingredient list
  // (name/amount/unit, looked up from the recipe's ingredientIds) and
  // whether it belongs to an appetizer, so both the timeline here and the
  // saved plan later can show exactly what that step uses and its group.
  const timeline = useMemo(() => {
    const isAppetizer = (recipeId: number) =>
      appetizerRecipeIds.includes(recipeId);

    const recipeTotal = (r: any) =>
      r.steps.reduce(
        (sum: number, s: any) =>
          sum + (s.timeValue || 0) * unitToSeconds(s.timeUnit),
        0,
      );

    const mainRecipes = selectedRecipes.filter((r) => !isAppetizer(r.id));
    const mainTotals = mainRecipes.map(recipeTotal);
    const mainMaxTotal = mainTotals.length > 0 ? Math.max(...mainTotals) : 0;

    const items: TimelineItem[] = [];

    selectedRecipes.forEach((r) => {
      const appetizer = isAppetizer(r.id);
      const startDelay = appetizer ? 0 : mainMaxTotal - recipeTotal(r);
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
          isAppetizer: appetizer,
        });
        cumulative += durationSeconds;
      });
    });

    return items.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  }, [selectedRecipes, appetizerRecipeIds]);

  // The whole plan's total length: the latest point any step finishes at.
  const totalPlanSeconds = useMemo(() => {
    if (timeline.length === 0) return 0;
    return Math.max(
      ...timeline.map((t) => t.offsetSeconds + t.durationSeconds),
    );
  }, [timeline]);

  // The display starts as "00:00"; each typed digit fills the next
  // position left to right (hour tens, hour ones, minute tens, minute
  // ones), with not-yet-typed positions showing as "0" until filled.
  const paddedDigits = endTimeDigits.padEnd(4, "0");
  const endTimeDisplay = `${paddedDigits.slice(0, 2)}:${paddedDigits.slice(2, 4)}`;

  const addEndTimeDigit = (d: string) => {
    setEndTimeDigits((prev) => (prev.length < 4 ? prev + d : prev));
  };
  const backspaceEndTimeDigit = () => {
    setEndTimeDigits((prev) => prev.slice(0, -1));
  };
  const clearEndTime = () => setEndTimeDigits("");

  // Only treat the end time as set once all 4 digits are entered; a
  // partially-filled or empty box behaves the same as "no end time" —
  // start immediately. Once complete, hour must be 1-12 and minute 0-59.
  const endTimeInvalid = useMemo(() => {
    if (endTimeDigits.length < 4) return false;
    const hour12 = Number(paddedDigits.slice(0, 2));
    const minute = Number(paddedDigits.slice(2, 4));
    return !(hour12 >= 1 && hour12 <= 12 && minute >= 0 && minute <= 59);
  }, [endTimeDigits, paddedDigits]);

  const parsedEndTime = useMemo(() => {
    if (endTimeDigits.length < 4 || endTimeInvalid) return null;
    const hour12 = Number(paddedDigits.slice(0, 2));
    const minute = Number(paddedDigits.slice(2, 4));
    let hour24 = hour12 % 12;
    if (endTimeMeridiem === "PM") hour24 += 12;
    const result = new Date();
    result.setHours(hour24, minute, 0, 0);
    if (result.getTime() <= Date.now()) {
      result.setDate(result.getDate() + 1);
    }
    return result;
  }, [endTimeDigits, endTimeInvalid, paddedDigits, endTimeMeridiem]);

  // If a valid end time was entered, work backward from it so the whole
  // plan finishes exactly then. Otherwise, start right away (from the
  // moment this screen loaded).
  const planStartTime = useMemo(() => {
    if (parsedEndTime) {
      return new Date(parsedEndTime.getTime() - totalPlanSeconds * 1000);
    }
    return generatedAt;
  }, [parsedEndTime, totalPlanSeconds, generatedAt]);

  const scheduledTimeFor = (offsetSeconds: number): Date =>
    new Date(planStartTime.getTime() + offsetSeconds * 1000);

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
        isAppetizer: t.isAppetizer,
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
        scheduledStartAt: planStartTime.getTime(),
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

        <Text style={styles.label}>End Time</Text>
        <View style={styles.endTimeDisplayRow}>
          <Text
            style={[
              styles.endTimeDisplay,
              endTimeInvalid && styles.endTimeDisplayInvalid,
            ]}
          >
            {endTimeDisplay} {endTimeMeridiem}
          </Text>
          {endTimeDigits.length > 0 && (
            <TouchableOpacity onPress={clearEndTime}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
        {endTimeInvalid ? (
          <Text style={styles.errorHint}>
            Hour must be 1-12 and minute 00-59.
          </Text>
        ) : (
          <Text style={styles.timelineHint}>
            Leave at 00:00 (or clear it) to start immediately instead.
          </Text>
        )}

        <View style={styles.meridiemRow}>
          <TouchableOpacity
            style={[
              styles.meridiemButton,
              endTimeMeridiem === "AM" && styles.meridiemButtonActive,
            ]}
            onPress={() => setEndTimeMeridiem("AM")}
          >
            <Text
              style={[
                styles.meridiemButtonText,
                endTimeMeridiem === "AM" && styles.meridiemButtonTextActive,
              ]}
            >
              AM
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.meridiemButton,
              endTimeMeridiem === "PM" && styles.meridiemButtonActive,
            ]}
            onPress={() => setEndTimeMeridiem("PM")}
          >
            <Text
              style={[
                styles.meridiemButtonText,
                endTimeMeridiem === "PM" && styles.meridiemButtonTextActive,
              ]}
            >
              PM
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.keypad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <TouchableOpacity
              key={d}
              style={styles.keypadButton}
              onPress={() => addEndTimeDigit(d)}
            >
              <Text style={styles.keypadButtonText}>{d}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.keypadButton} />
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={() => addEndTimeDigit("0")}
          >
            <Text style={styles.keypadButtonText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={backspaceEndTimeDigit}
          >
            <Text style={styles.keypadButtonText}>⌫</Text>
          </TouchableOpacity>
        </View>

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
          {parsedEndTime
            ? `Scheduled backward so everything's ready by ${formatClockTime(parsedEndTime)}.`
            : "Starting immediately — mains finish together, appetizers finish ASAP."}
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
                    {formatClockTime(scheduledTimeFor(step.offsetSeconds))}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.timelineTagRow}>
                    <Text style={[styles.timelineRecipeTag, { color }]}>
                      {step.recipeName}
                    </Text>
                    {step.isAppetizer && (
                      <Text style={styles.appetizerBadge}>APPETIZER</Text>
                    )}
                  </View>
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
          disabled={saving || selectedRecipes.length === 0 || endTimeInvalid}
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
  errorHint: {
    fontSize: 12,
    color: "#B04A3B",
    marginBottom: 8,
    marginTop: -4,
  },
  endTimeDisplayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
  },
  endTimeDisplay: {
    fontSize: 26,
    fontWeight: "700",
    color: "#2B2118",
    letterSpacing: 1,
  },
  endTimeDisplayInvalid: {
    color: "#B04A3B",
  },
  clearText: {
    fontSize: 13,
    color: "#B04A3B",
    fontWeight: "600",
  },
  meridiemRow: {
    flexDirection: "row",
    marginTop: 10,
    marginBottom: 14,
  },
  meridiemButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E0D5C7",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  meridiemButtonActive: {
    backgroundColor: "#D97B4F",
    borderColor: "#D97B4F",
  },
  meridiemButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#8A7A68",
  },
  meridiemButtonTextActive: {
    color: "#fff",
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  keypadButton: {
    width: "33.33%",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 0.5,
    borderColor: "#E0D5C7",
  },
  keypadButtonText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#2B2118",
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
    minWidth: 88,
    alignItems: "center",
  },
  timelineOffsetText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  timelineTagRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  timelineRecipeTag: {
    fontSize: 11,
    color: "#8A5A2E",
    fontWeight: "700",
    textTransform: "uppercase",
  },
  appetizerBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#5B8C5A",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
    overflow: "hidden",
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
