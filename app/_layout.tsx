import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PlanProvider } from "./plan-store";
import { RecipeProvider } from "./recipe-store";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RecipeProvider>
        <PlanProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: "#FAF7F2" },
              headerShadowVisible: false,
              headerTintColor: "#2B2118",
            }}
          >
            <Stack.Screen name="index" options={{ title: "My Recipes" }} />
            <Stack.Screen name="new-recipe" options={{ title: "New Recipe" }} />
            <Stack.Screen
              name="compile"
              options={{ title: "Compile Recipes" }}
            />
            <Stack.Screen
              name="compiled"
              options={{ title: "Compiled Plan" }}
            />
            <Stack.Screen name="plans" options={{ title: "Saved Plans" }} />
            <Stack.Screen name="plan" options={{ title: "Plan" }} />
          </Stack>
        </PlanProvider>
      </RecipeProvider>
    </SafeAreaProvider>
  );
}
