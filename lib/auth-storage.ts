import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Where the sign-in session token is kept between app launches. On phones
// it goes in the OS keychain/keystore (encrypted); expo-secure-store has no
// web implementation, so the web build uses localStorage instead.
const TOKEN_KEY = "recipecompiler.session-token";

function webStorage(): Storage | null {
  try {
    return (globalThis as any).localStorage ?? null;
  } catch {
    return null;
  }
}

export async function loadToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return webStorage()?.getItem(TOKEN_KEY) ?? null;
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (err) {
    console.warn("Could not read saved sign-in:", err);
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") webStorage()?.setItem(TOKEN_KEY, token);
    else await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (err) {
    // Still signed in for this session; they'll just need to sign in again
    // next launch.
    console.warn("Could not save sign-in:", err);
  }
}

export async function clearToken(): Promise<void> {
  try {
    if (Platform.OS === "web") webStorage()?.removeItem(TOKEN_KEY);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (err) {
    console.warn("Could not clear saved sign-in:", err);
  }
}
