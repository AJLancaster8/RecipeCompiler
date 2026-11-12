import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, TouchableOpacity, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { BurgerMenuButton } from "../components/burger-menu";
import { AuthProvider, useAuth } from "../lib/auth";
import { PlanProvider } from "./plan-store";
import { RecipeProvider } from "./recipe-store";

// Your profile picture in the top-right of the home screen; opens My Account.
function AccountButton() {
  const { user } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <TouchableOpacity
      onPress={() => router.push("/account")}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="My account"
    >
      <Avatar username={user.username} avatarUrl={user.avatarUrl} size={32} />
    </TouchableOpacity>
  );
}

function AppStack() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FAF7F2",
        }}
      >
        <ActivityIndicator color="#D97B4F" />
      </View>
    );
  }

  const signedIn = !!user;

  // Keyed by account so signing in/out starts the recipe store (and the
  // navigation stack) fresh, with no data left over from the last user.
  return (
    <RecipeProvider key={user?.id ?? "signed-out"}>
      <PlanProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#FAF7F2" },
            headerShadowVisible: false,
            headerTintColor: "#2B2118",
          }}
        >
          {/* Signed-out users can only reach the sign-in screen, and
              signed-in users can't go back to it. */}
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen
              name="index"
              options={{
                title: "My Recipes",
                headerLeft: () => <BurgerMenuButton />,
                headerRight: () => <AccountButton />,
              }}
            />
            <Stack.Screen name="account" options={{ title: "My Account" }} />
            <Stack.Screen name="recipe" options={{ title: "Recipe" }} />
            <Stack.Screen name="discover" options={{ title: "Discover Recipes" }} />
            <Stack.Screen name="saved" options={{ title: "Saved Recipes" }} />
            <Stack.Screen name="new-recipe" options={{ title: "New Recipe" }} />
            <Stack.Screen name="compile" options={{ title: "Compile Recipes" }} />
            <Stack.Screen name="compiled" options={{ title: "Compiled Plan" }} />
            <Stack.Screen name="plans" options={{ title: "Saved Plans" }} />
            <Stack.Screen name="plan" options={{ title: "Plan" }} />
          </Stack.Protected>
        </Stack>
      </PlanProvider>
    </RecipeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
