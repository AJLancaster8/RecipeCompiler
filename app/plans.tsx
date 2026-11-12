import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePlans } from "./plan-store";
import { useRecipes } from "./recipe-store";

export default function PlansScreen() {
  const router = useRouter();
  const { plans, deletePlan, loading } = usePlans();
  // A plan can use your own recipes and the ones you've saved.
  const { planRecipes } = useRecipes();
  const canCreate = planRecipes.length >= 2;

  const confirmDelete = (id: number, name: string) => {
    Alert.alert(
      "Delete plan?",
      `This will remove "${name}" from your device.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deletePlan(id) },
      ],
    );
  };

  const newPlan = () => {
    if (!canCreate) {
      Alert.alert(
        "Not enough recipes",
        "A plan combines two or more recipes. Create some, or save some from Discover, first.",
      );
      return;
    }
    router.push("/compile");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <TouchableOpacity
          style={[styles.newPlanButton, !canCreate && { opacity: 0.6 }]}
          onPress={newPlan}
          accessibilityRole="button"
        >
          <Text style={styles.newPlanButtonText}>+ New Plan</Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#D97B4F" />
        ) : plans.length === 0 ? (
          <Text style={styles.emptyText}>
            No saved plans yet. Tap “+ New Plan” to combine your recipes (or
            ones you&apos;ve saved) into a cooking plan.
          </Text>
        ) : (
          <ScrollView
            style={{ width: "100%" }}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {plans.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.planCard}
                onPress={() => router.push(`/plan?id=${p.id}`)}
              >
                <View style={styles.planCardHeader}>
                  <Text style={styles.planCardTitle}>{p.name}</Text>
                  <TouchableOpacity onPress={() => confirmDelete(p.id, p.name)}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.planCardMeta}>
                  {p.steps.length} step{p.steps.length !== 1 ? "s" : ""} ·{" "}
                  {p.ingredients.length} ingredient
                  {p.ingredients.length !== 1 ? "s" : ""}
                </Text>
                {(p.activeSteps || []).length > 0 && (
                  <Text style={styles.inProgressTag}>
                    {p.activeSteps.length} step
                    {p.activeSteps.length !== 1 ? "s" : ""} in progress
                  </Text>
                )}
              </TouchableOpacity>
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
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  newPlanButton: {
    backgroundColor: "#D97B4F",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
    marginBottom: 16,
  },
  newPlanButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  emptyText: {
    fontSize: 15,
    color: "#8A7A68",
    textAlign: "center",
    marginTop: 24,
  },
  planCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    width: "100%",
  },
  planCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  planCardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#2B2118",
    flexShrink: 1,
    marginRight: 12,
  },
  deleteText: {
    fontSize: 13,
    color: "#B04A3B",
    fontWeight: "600",
  },
  planCardMeta: {
    fontSize: 13,
    color: "#8A7A68",
  },
  inProgressTag: {
    marginTop: 6,
    fontSize: 12,
    color: "#D97B4F",
    fontWeight: "700",
  },
});
