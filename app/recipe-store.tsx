import * as FileSystem from "expo-file-system/legacy";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

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
  id: number;
  name: string;
  ingredients: Ingredient[];
  steps: Step[];
};

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

const RECIPES_FILE = FileSystem.documentDirectory + "recipes.json";

type RecipeContextType = {
  recipes: Recipe[];
  addRecipe: (recipe: Recipe) => Promise<void>;
  updateRecipe: (recipe: Recipe) => Promise<void>;
  deleteRecipe: (id: number) => Promise<void>;
  loading: boolean;
};

const RecipeContext = createContext<RecipeContextType | undefined>(undefined);

async function readRecipesFromDisk(): Promise<Recipe[]> {
  try {
    const info = await FileSystem.getInfoAsync(RECIPES_FILE);
    if (!info.exists) {
      return [];
    }
    const content = await FileSystem.readAsStringAsync(RECIPES_FILE);
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      // Keep the id counter ahead of anything already saved on disk —
      // scanning recipe, ingredient, and step ids (not just the recipe id)
      // since steps reference ingredient ids and everything shares one
      // id space.
      let maxId = 0;
      parsed.forEach((r: any) => {
        maxId = Math.max(maxId, r.id || 0);
        (r.ingredients || []).forEach((i: any) => {
          maxId = Math.max(maxId, i.id || 0);
        });
        (r.steps || []).forEach((s: any) => {
          maxId = Math.max(maxId, s.id || 0);
        });
      });
      if (maxId > idCounter) idCounter = maxId;
      return parsed;
    }
    return [];
  } catch (err) {
    console.warn("Failed to read recipes.json, starting empty:", err);
    return [];
  }
}

async function writeRecipesToDisk(recipes: Recipe[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      RECIPES_FILE,
      JSON.stringify(recipes, null, 2),
    );
  } catch (err) {
    console.warn("Failed to save recipes.json:", err);
    throw err;
  }
}

export function RecipeProvider({ children }: { children: ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  // Load any previously saved recipes from disk when the app starts
  useEffect(() => {
    (async () => {
      const stored = await readRecipesFromDisk();
      setRecipes(stored);
      setLoading(false);
    })();
  }, []);

  const addRecipe = async (recipe: Recipe) => {
    const updated = [...recipes, recipe];
    setRecipes(updated);
    await writeRecipesToDisk(updated);
  };

  const updateRecipe = async (recipe: Recipe) => {
    const updated = recipes.map((r) => (r.id === recipe.id ? recipe : r));
    setRecipes(updated);
    await writeRecipesToDisk(updated);
  };

  const deleteRecipe = async (id: number) => {
    const updated = recipes.filter((r) => r.id !== id);
    setRecipes(updated);
    await writeRecipesToDisk(updated);
  };

  return (
    <RecipeContext.Provider
      value={{ recipes, addRecipe, updateRecipe, deleteRecipe, loading }}
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
