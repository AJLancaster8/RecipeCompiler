import Constants from "expo-constants";
import { Platform } from "react-native";

// Where the recipe server lives. Set EXPO_PUBLIC_API_URL (e.g. in a .env
// file: EXPO_PUBLIC_API_URL=http://192.168.1.20:3000) for a real server.
// In development without it, assume the server runs on the same computer
// as the Expo dev server, on port 3000.
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  // The website build is served by the recipe server itself, so it talks to
  // whichever server it was loaded from.
  if (Platform.OS === "web" && !__DEV__ && typeof window !== "undefined") {
    return window.location.origin;
  }
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri ? hostUri.split(":")[0] : "localhost";
  return `http://${host}:3000`;
}

const API_BASE_URL = resolveBaseUrl();

const REQUEST_TIMEOUT_MS = 10000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type User = {
  id: number;
  username: string;
  email: string;
  role: "user" | "admin";
  createdAt: string;
  // Server path of the profile picture (e.g. "/users/3/avatar?v=..."), or
  // null if none is set. Turn it into a full URL with apiUrl().
  avatarUrl: string | null;
};

// A full URL for a path the server handed out (e.g. a picture's, which
// already starts with /api).
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

type AuthResponse = { token: string; user: User };

// The recipe fields the client sends. The server adds id/owner/timestamps.
export type RecipeInput = {
  name: string;
  ingredients: unknown[];
  steps: unknown[];
  isPublic: boolean;
};

// The auth store sets these: the current session token, and what to do when
// the server says that token is no longer valid (expired or signed out
// elsewhere).
let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    // Every data route lives under /api on the server.
    res = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, `Couldn't reach the recipe server at ${API_BASE_URL}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // fall through — handled below
  }
  if (!res.ok) {
    // A 401 from a sign-in attempt just means wrong password; anywhere else
    // it means our session is gone.
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, data?.error || `Server responded ${res.status}`);
  }
  return data as T;
}

export const authApi = {
  register: (username: string, email: string, password: string) =>
    request<AuthResponse>("POST", "/auth/register", { username, email, password }),
  // `login` is a username or an email address.
  login: (login: string, password: string) =>
    request<AuthResponse>("POST", "/auth/login", { login, password }),
  me: () => request<{ user: User }>("GET", "/auth/me"),
  logout: () => request<void>("POST", "/auth/logout"),
  // `base64` is the image's bytes (JPEG, PNG or WebP, 2 MB max).
  setAvatar: (base64: string) => request<{ user: User }>("PUT", "/auth/avatar", { image: base64 }),
  removeAvatar: () => request<{ user: User }>("DELETE", "/auth/avatar"),
};

export const recipeApi = {
  // The signed-in user's own recipes (published or not).
  list: <T>() => request<T[]>("GET", "/recipes"),
  // Every published recipe, from everyone (the Discover list).
  listPublic: <T>() => request<T[]>("GET", "/recipes?scope=public"),
  // One recipe (yours, or anyone's published one).
  get: <T>(id: number) => request<T>("GET", `/recipes/${id}`),
  create: <T>(recipe: RecipeInput) => request<T>("POST", "/recipes", recipe),
  update: <T>(id: number, recipe: RecipeInput) =>
    request<T>("PUT", `/recipes/${id}`, recipe),
  remove: (id: number) => request<void>("DELETE", `/recipes/${id}`),
  // `base64` is JPEG/PNG/WebP data (3 MB max). Both return the updated recipe.
  setImage: <T>(id: number, base64: string) =>
    request<T>("PUT", `/recipes/${id}/image`, { image: base64 }),
  removeImage: <T>(id: number) => request<T>("DELETE", `/recipes/${id}/image`),
};

export type DiscoverPage<T> = {
  recipes: T[];
  page: number; // 1-based; the server snaps out-of-range pages to a real one
  pageSize: number;
  total: number; // matching recipes across all pages
  pageCount: number;
  query: string;
};

export const discoverApi = {
  // One page (10 recipes) of published recipes, newest first. `query`
  // matches recipe names, ingredient names and usernames.
  search: <T>(query: string, page: number) =>
    request<DiscoverPage<T>>(
      "GET",
      `/discover?q=${encodeURIComponent(query)}&page=${page}`,
    ),
};

export const savedApi = {
  // Recipes the signed-in user has saved, most recently saved first.
  list: <T>() => request<T[]>("GET", "/saved"),
  save: (recipeId: number) => request<unknown>("PUT", `/saved/${recipeId}`),
  unsave: (recipeId: number) => request<void>("DELETE", `/saved/${recipeId}`),
  // Saves or unsaves, whichever `saved` says.
  set: (recipeId: number, saved: boolean) =>
    saved
      ? request<unknown>("PUT", `/saved/${recipeId}`).then(() => undefined)
      : request<void>("DELETE", `/saved/${recipeId}`),
};
