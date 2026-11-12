import * as FileSystem from "expo-file-system/legacy";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "../lib/auth";
import { ApiError, recipeApi, savedApi } from "../lib/recipe-api";

export type Ingredient = {
  id: number;
  name: string;
  amount: number; // e.g. 2, 0.5, 500
  unit: string; // e.g. "cup", "g", "tsp"
};

export type Step = {
  id: number;
  text: string;
  description: string;
  timeValue: number; // e.g. 10, 1.5
  timeUnit: "s" | "m" | "h"; // seconds, minutes, hours
  ingredientIds: number[]; // ids of ingredients (from this recipe) used in this step
};

export type Recipe = {
  id: number; // assigned by the server, unique across all devices
  name: string;
  ingredients: Ingredient[];
  steps: Step[];
  isMine: boolean; // true if the signed-in user created it
  canEdit: boolean; // true if the signed-in user may edit/delete it (creator or admin)
  authorId: number; // users.id of the account that created it
  authorName: string | null; // that account's username (null if unknown)
  isPublic: boolean; // true if published to Discover
  isSaved: boolean; // true if the signed-in user has saved it
  savedAt?: string; // when they saved it (only in the Saved Recipes list)
  createdAt?: string;
  updatedAt?: string;
};

// What the app supplies when creating or updating; the server fills in the rest.
export type RecipeDraft = Pick<Recipe, "name" | "ingredients" | "steps" | "isPublic">;

let idCounter = 0;
export const nextId = () => {
  idCounter += 1;
  return idCounter;
};

// Lets other stores (e.g. plan-store) bump this shared counter after
// scanning their own saved data, so ids stay unique across recipes,
// steps, ingredients, AND plans/plan-steps — everything shares one space.
export const advanceIdCounter = (n: number) => {
  if (n > idCounter) idCounter = n;
};

// Keep the counter ahead of every ingredient/step id we've seen, since new
// rows added while editing a recipe must not collide with existing ones.
function advanceCounterPast(recipes: any[]) {
  let maxId = 0;
  recipes.forEach((r: any) => {
    (r.ingredients || []).forEach((i: any) => {
      maxId = Math.max(maxId, i.id || 0);
    });
    (r.steps || []).forEach((s: any) => {
      maxId = Math.max(maxId, s.id || 0);
    });
  });
  advanceIdCounter(maxId);
}

// Last list fetched from the server, so recipes are still viewable offline.
// One per account, since "mine" / "can edit" differ between users.
const cacheFile = (userId: number) =>
  FileSystem.documentDirectory + `recipes-cache-user-${userId}.json`;

async function readCache(userId: number): Promise<Recipe[]> {
  try {
    if (!(await FileSystem.getInfoAsync(cacheFile(userId))).exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(cacheFile(userId)));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to read recipe cache:", err);
    return [];
  }
}

async function writeCache(userId: number | null, recipes: Recipe[]): Promise<void> {
  if (userId == null) return;
  try {
    await FileSystem.writeAsStringAsync(cacheFile(userId), JSON.stringify(recipes));
  } catch (err) {
    console.warn("Failed to write recipe cache:", err);
  }
}

type RecipeContextType = {
  recipes: Recipe[]; // the signed-in user's own recipes
  savedRecipes: Recipe[]; // recipes they've saved (theirs or others' published ones)
  // Everything a plan can be built from: own recipes + saved ones, no duplicates.
  planRecipes: Recipe[];
  refreshSaved: () => Promise<void>;
  addRecipe: (recipe: RecipeDraft) => Promise<Recipe>;
  updateRecipe: (id: number, recipe: RecipeDraft) => Promise<Recipe>;
  deleteRecipe: (id: number) => Promise<void>;
  // Records locally that a recipe was saved/unsaved (the server call is
  // made by SaveButton).
  markSaved: (id: number, saved: boolean) => void;
  refresh: () => Promise<void>;
  loading: boolean; // true until the first load (cache or server) finishes
  refreshing: boolean;
  error: string | null; // last error talking to the server, if any
};

const RecipeContext = createContext<RecipeContextType | undefined>(undefined);

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  console.error("Recipe store error:", err);
  const detail = err instanceof Error ? err.message : String(err);
  return `Something went wrong talking to the recipe server: ${detail}`;
}

export function RecipeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Fixed for this provider's lifetime: the layout remounts it (via `key`)
  // whenever a different user signs in.
  const userId = user?.id ?? null;

  const [recipes, setRecipesState] = useState<Recipe[]>([]);
  const [savedRecipes, setSavedRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planRecipes = useMemo(() => {
    const ownIds = new Set(recipes.map((r) => r.id));
    return [...recipes, ...savedRecipes.filter((r) => !ownIds.has(r.id))];
  }, [recipes, savedRecipes]);

  const refreshSaved = useCallback(async () => {
    if (userId == null) return;
    try {
      const saved = await savedApi.list<Recipe>();
      advanceCounterPast(saved);
      setSavedRecipes(saved);
    } catch (err) {
      // Not fatal: own recipes still work; screens that need saved ones
      // (Saved Recipes) fetch and report errors themselves.
      console.warn("Couldn't load saved recipes:", err);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    if (userId == null) return;
    setRefreshing(true);
    try {
      const fresh = await recipeApi.list<Recipe>();
      advanceCounterPast(fresh);
      setRecipesState(fresh);
      writeCache(userId, fresh);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRefreshing(false);
    }
    await refreshSaved();
  }, [userId, refreshSaved]);

  // Show the user's cached recipes immediately, then fetch the latest from
  // the server. (The layout remounts this provider whenever the signed-in
  // user changes, so state always starts empty for a new user.)
  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    (async () => {
      const cached = await readCache(userId);
      if (cancelled) return;
      advanceCounterPast(cached);
      setRecipesState(cached);
      if (cached.length > 0) setLoading(false);
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh]);

  // The mutations hit the server first and only update local state once
  // it succeeds, so the list never shows a change the server rejected.
  // Errors are re-thrown so the calling screen can tell the user.
  const addRecipe = async (draft: RecipeDraft) => {
    const created = await recipeApi.create<Recipe>(draft);
    setRecipesState((prev) => {
      const next = [...prev, created];
      advanceCounterPast(next);
      writeCache(userId, next);
      return next;
    });
    return created;
  };

  const updateRecipe = async (id: number, draft: RecipeDraft) => {
    const updated = await recipeApi.update<Recipe>(id, draft);
    setRecipesState((prev) => {
      const next = prev.map((r) => (r.id === id ? updated : r));
      advanceCounterPast(next);
      writeCache(userId, next);
      return next;
    });
    return updated;
  };

  const deleteRecipe = async (id: number) => {
    try {
      await recipeApi.remove(id);
    } catch (err) {
      // Already gone on the server — just drop it locally too.
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    setRecipesState((prev) => {
      const next = prev.filter((r) => r.id !== id);
      writeCache(userId, next);
      return next;
    });
    setSavedRecipes((prev) => prev.filter((r) => r.id !== id));
  };

  const markSaved = (id: number, saved: boolean) => {
    setRecipesState((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, isSaved: saved } : r));
      writeCache(userId, next);
      return next;
    });
    if (!saved) setSavedRecipes((prev) => prev.filter((r) => r.id !== id));
    // A newly saved recipe may be someone else's, which we don't have yet.
    else refreshSaved();
  };

  return (
    <RecipeContext.Provider
      value={{
        recipes,
        savedRecipes,
        planRecipes,
        refreshSaved,
        addRecipe,
        updateRecipe,
        deleteRecipe,
        markSaved,
        refresh,
        loading,
        refreshing,
        error,
      }}
    >
      {children}
    </RecipeContext.Provider>
  );
}

export function useRecipes() {
  const context = useContext(RecipeContext);
  if (!context) {
    throw new Error("useRecipes must be used within a RecipeProvider");
  }
  return context;
}

export { describeError as describeRecipeError };
