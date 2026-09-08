import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  cancelStepNotification,
  ensureNotificationPermissions,
  notificationsSupported,
  scheduleStepNotification,
} from "./notifications";
import { ActiveStep, PlanStep, usePlans } from "./plan-store";
import { getRecipeColor } from "./recipe-colors";

// Formats a countdown (or any duration) as zero-padded hh:mm:ss
function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Formats a Date's time-of-day as zero-padded hh:mm:ss (24-hour) — used
// to show each step's actual scheduled clock time, computed from the
// plan's scheduledStartAt plus that step's offset.
function formatClockTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  let hours = date.getHours();
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${meridiem}`;
}

// Joins an ingredient's amounts naturally: "1 whole", "1 whole and 3 cup",
// or "1 whole, 3 cup, and 2 tbsp" for three or more — same style used on
// the compiled screen.
function formatAmounts(amounts: { amount: number; unit: string }[]): string {
  const parts = amounts.map(
    (a) => `${Math.round(a.amount * 100) / 100} ${a.unit}`,
  );
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const { plans, updatePlan } = usePlans();

  const plan = useMemo(() => {
    const found = plans.find((p) => p.id === Number(id));
    if (!found) return found;
    // Guard against older saved plans from before activeSteps/scheduledStartAt existed
    return {
      ...found,
      activeSteps: found.activeSteps || [],
      scheduledStartAt: found.scheduledStartAt || Date.now(),
    };
  }, [plans, id]);

  // Ask for notification permission once, up front, so the first "Mark In
  // Progress" tap doesn't stall on a permission prompt.
  useEffect(() => {
    ensureNotificationPermissions();
  }, []);

  // Ticks once a second while any timer is running, just to force a
  // re-render so the live countdowns stay current.
  const [, forceTick] = useState(0);
  const hasRunningTimer = !!plan?.activeSteps.some(
    (a) => a.timerEndAt !== null,
  );
  useEffect(() => {
    if (!hasRunningTimer) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [hasRunningTimer]);

  useEffect(() => {
    if (plan) {
      navigation.setOptions({ title: plan.name });
    }
  }, [plan?.name, navigation]);

  if (!plan) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.emptyText}>This plan couldn't be found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const findActive = (stepId: number) =>
    plan.activeSteps.find((a) => a.stepId === stepId);

  // Only one active step is allowed per recipe — different recipes can
  // each run their own step at the same time, though.
  const activeStepForRecipe = (recipeId: number) =>
    plan.activeSteps.find((a) => {
      const s = plan.steps.find((ps) => ps.id === a.stepId);
      return s && s.recipeId === recipeId;
    });

  const reallyStartStep = async (step: PlanStep, replacing?: ActiveStep) => {
    let activeSteps = plan.activeSteps;

    if (replacing) {
      await cancelStepNotification(replacing.notificationId);
      activeSteps = activeSteps.filter((a) => a.stepId !== replacing.stepId);
    }

    let notificationId: string | null = null;
    if (step.durationSeconds > 0) {
      notificationId = await scheduleStepNotification(
        step.recipeName,
        step.text,
        step.durationSeconds,
      );
    }

    const newActive: ActiveStep = {
      stepId: step.id,
      timerEndAt:
        step.durationSeconds > 0
          ? Date.now() + step.durationSeconds * 1000
          : null,
      timerDurationSeconds: step.durationSeconds,
      notificationId,
    };

    await updatePlan({ ...plan, activeSteps: [...activeSteps, newActive] });
  };

  const startStep = (step: PlanStep) => {
    const conflict = activeStepForRecipe(step.recipeId);
    if (conflict && conflict.stepId !== step.id) {
      const conflictingStep = plan.steps.find((s) => s.id === conflict.stepId);
      Alert.alert(
        "Replace current step?",
        `"${conflictingStep?.text}" is already in progress for ${step.recipeName}. Only one step per recipe can be in progress at a time — start this one instead?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", onPress: () => reallyStartStep(step, conflict) },
        ],
      );
      return;
    }
    reallyStartStep(step);
  };

  const clearActiveStep = async (stepId: number) => {
    const active = findActive(stepId);
    if (active) {
      await cancelStepNotification(active.notificationId);
    }
    await updatePlan({
      ...plan,
      activeSteps: plan.activeSteps.filter((a) => a.stepId !== stepId),
    });
  };

  // Toggles one shopping-list item's checked state and persists it, so
  // reopening the plan later still shows what was already checked off.
  const toggleIngredientChecked = async (index: number) => {
    const updatedIngredients = plan.ingredients.map((ing, i) =>
      i === index ? { ...ing, checked: !ing.checked } : ing,
    );
    await updatePlan({ ...plan, ingredients: updatedIngredients });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.sectionTitle}>Shopping List</Text>
        {plan.ingredients.map((ing, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.checklistRow}
            onPress={() => toggleIngredientChecked(idx)}
          >
            <View
              style={[styles.checkbox, ing.checked && styles.checkboxChecked]}
            >
              {ing.checked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text
              style={[
                styles.checklistText,
                ing.checked && styles.checklistTextChecked,
              ]}
            >
              {ing.name} — {formatAmounts(ing.amounts)}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Steps</Text>
        <Text style={styles.hint}>
          One step per recipe can be in progress at a time — different recipes
          can run simultaneously.
        </Text>
        {!notificationsSupported && (
          <Text style={styles.hint}>
            Timer notifications aren't available in Expo Go on Android (an Expo
            SDK 53+ limitation) — a development build supports them. The
            countdowns above still work either way.
          </Text>
        )}
        {plan.steps.map((step) => {
          const active = findActive(step.id);
          const isActive = !!active;
          const remainingSeconds =
            active && active.timerEndAt !== null
              ? (active.timerEndAt - Date.now()) / 1000
              : null;
          const timerDone = remainingSeconds !== null && remainingSeconds <= 0;
          const color = getRecipeColor(step.recipeId, plan.recipeIds);

          return (
            <View
              key={step.id}
              style={[
                styles.stepCard,
                { borderLeftColor: color },
                isActive && styles.stepCardActive,
              ]}
            >
              <View style={styles.stepTopRow}>
                <View style={styles.offsetBadge}>
                  <Text style={styles.offsetBadgeText}>
                    {formatClockTime(
                      new Date(
                        plan.scheduledStartAt + step.offsetSeconds * 1000,
                      ),
                    )}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.tagRow}>
                    <Text style={[styles.recipeTag, { color }]}>
                      {step.recipeName}
                    </Text>
                    {step.isAppetizer && (
                      <Text style={styles.appetizerBadge}>APPETIZER</Text>
                    )}
                  </View>
                  <Text style={styles.stepText}>{step.text}</Text>
                  {step.description ? (
                    <Text style={styles.stepDescription}>
                      {step.description}
                    </Text>
                  ) : null}
                  {step.ingredients && step.ingredients.length > 0 && (
                    <Text style={styles.stepIngredients}>
                      Uses:{" "}
                      {step.ingredients
                        .map((i) => `${i.name} (${i.amount} ${i.unit})`)
                        .join(", ")}
                    </Text>
                  )}
                </View>
              </View>

              {isActive ? (
                <View style={styles.timerRow}>
                  {active!.timerDurationSeconds > 0 ? (
                    <Text
                      style={[
                        styles.timerText,
                        timerDone && styles.timerTextDone,
                      ]}
                    >
                      {timerDone
                        ? "Time's up!"
                        : formatCountdown(remainingSeconds || 0)}
                    </Text>
                  ) : (
                    <Text style={styles.timerText}>In progress</Text>
                  )}
                  <TouchableOpacity
                    style={styles.clearButton}
                    onPress={() => clearActiveStep(step.id)}
                  >
                    <Text style={styles.clearButtonText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.startButton}
                  onPress={() => startStep(step)}
                >
                  <Text style={styles.startButtonText}>Mark In Progress</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
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
  emptyText: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 40,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8A7A68",
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    color: "#A89885",
    marginBottom: 14,
    marginTop: -4,
  },
  detailLine: {
    fontSize: 15,
    color: "#2B2118",
    marginBottom: 6,
  },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#D9CFC3",
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#D97B4F",
    borderColor: "#D97B4F",
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  checklistText: {
    fontSize: 15,
    color: "#2B2118",
    flexShrink: 1,
  },
  checklistTextChecked: {
    color: "#A89885",
    textDecorationLine: "line-through",
  },
  stepCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderLeftWidth: 5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  stepCardActive: {
    borderColor: "#D97B4F",
    borderWidth: 2,
    backgroundColor: "#FBEFE6",
  },
  stepTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  offsetBadge: {
    backgroundColor: "#D97B4F",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
    minWidth: 88,
    alignItems: "center",
  },
  offsetBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  recipeTag: {
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
  stepText: {
    fontSize: 15,
    color: "#2B2118",
    marginBottom: 2,
  },
  stepDescription: {
    fontSize: 13,
    color: "#8A7A68",
  },
  stepIngredients: {
    fontSize: 12,
    color: "#8A5A2E",
    fontStyle: "italic",
    marginTop: 2,
  },
  startButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#F0E6D8",
    borderRadius: 8,
  },
  startButtonText: {
    color: "#8A5A2E",
    fontWeight: "600",
    fontSize: 14,
  },
  timerRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timerText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#D97B4F",
  },
  timerTextDone: {
    color: "#B04A3B",
  },
  clearButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0D5C7",
  },
  clearButtonText: {
    color: "#8A7A68",
    fontWeight: "600",
    fontSize: 13,
  },
});
