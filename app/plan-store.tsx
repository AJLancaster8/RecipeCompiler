import * as FileSystem from "expo-file-system/legacy";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { advanceIdCounter } from "./recipe-store";

export type PlanIngredientAmount = {
  amount: number;
  unit: string;
};

export type PlanIngredient = {
  name: string;
  amounts: PlanIngredientAmount[]; // e.g. [{amount:1, unit:"whole"}, {amount:3, unit:"cup"}]
  checked: boolean; // one checkbox per ingredient name, covering all its amounts
};

export type PlanStepIngredient = {
  name: string;
  amount: number;
  unit: string;
};

export type PlanStep = {
  id: number;
  recipeId: number;
  recipeName: string;
  text: string;
  description: string;
  offsetSeconds: number;
  durationSeconds: number;
  ingredients: PlanStepIngredient[]; // the specific ingredients this step uses
  isAppetizer: boolean; // marked to finish ASAP rather than aligned with the mains
};

export type ActiveStep = {
  stepId: number;
  timerEndAt: number | null; // epoch ms the timer should hit zero, or null if no timer
  timerDurationSeconds: number;
  notificationId: string | null; // scheduled OS notification id, for cancelling
};

export type Plan = {
  id: number;
  name: string;
  recipeIds: number[];
  ingredients: PlanIngredient[];
  steps: PlanStep[];
  // Steps currently marked "in progress" — at most one per recipeId,
  // but different recipes can each have their own active step at once.
  activeSteps: ActiveStep[];
  // Epoch ms that a step's offsetSeconds counts from — either the target
  // end time worked backward from, or the moment the plan was compiled
  // if no end time was given. Used to show each step's real clock time.
  scheduledStartAt: number;
};

const PLANS_FILE = FileSystem.documentDirectory + "plans.json";

type PlanContextType = {
  plans: Plan[];
  addPlan: (plan: Plan) => Promise<void>;
  updatePlan: (plan: Plan) => Promise<void>;
  deletePlan: (id: number) => Promise<void>;
  loading: boolean;
};

const PlanContext = createContext<PlanContextType | undefined>(undefined);

async function readPlansFromDisk(): Promise<Plan[]> {
  try {
    const info = await FileSystem.getInfoAsync(PLANS_FILE);
    if (!info.exists) {
      return [];
    }
    const content = await FileSystem.readAsStringAsync(PLANS_FILE);
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      // Keep the shared id counter ahead of anything saved here too, since
      // plan ids and plan-step ids come from the same nextId() used by
      // recipes/ingredients/steps.
      let maxId = 0;
      parsed.forEach((p: any) => {
        maxId = Math.max(maxId, p.id || 0);
        (p.steps || []).forEach((s: any) => {
          maxId = Math.max(maxId, s.id || 0);
        });
      });
      advanceIdCounter(maxId);

      // Normalize each plan so older saved data (from before activeSteps
      // or checked existed) doesn't crash the UI — always guarantee an
      // activeSteps array and a checked flag on every ingredient.
      return parsed.map((p: any) => ({
        ...p,
        activeSteps: Array.isArray(p.activeSteps) ? p.activeSteps : [],
        scheduledStartAt:
          typeof p.scheduledStartAt === "number"
            ? p.scheduledStartAt
            : Date.now(),
        // Migrate older saved plans: earlier versions stored one entry
        // per name+unit combo (e.g. two separate rows for "Onion, 1
        // whole" and "Onion, 3 cup"). Group those by name into the new
        // shape — one row per ingredient name with an amounts list —
        // so old data still displays correctly. A grouped ingredient is
        // "checked" only if every one of its old rows was checked.
        ingredients: (() => {
          const raw = p.ingredients || [];
          const alreadyGrouped =
            raw.length > 0 && Array.isArray(raw[0].amounts);
          if (alreadyGrouped) {
            return raw.map((ing: any) => ({
              name: ing.name,
              amounts: ing.amounts,
              checked: typeof ing.checked === "boolean" ? ing.checked : false,
            }));
          }
          const groups = new Map<
            string,
            { name: string; amounts: any[]; allChecked: boolean }
          >();
          raw.forEach((ing: any) => {
            const key = ing.name.trim().toLowerCase();
            const existing = groups.get(key);
            const amountEntry = { amount: ing.amount, unit: ing.unit };
            if (existing) {
              existing.amounts.push(amountEntry);
              existing.allChecked = existing.allChecked && !!ing.checked;
            } else {
              groups.set(key, {
                name: ing.name.trim(),
                amounts: [amountEntry],
                allChecked: !!ing.checked,
              });
            }
          });
          return Array.from(groups.values()).map((g) => ({
            name: g.name,
            amounts: g.amounts,
            checked: g.allChecked,
          }));
        })(),
        steps: (p.steps || []).map((s: any) => ({
          ...s,
          ingredients: Array.isArray(s.ingredients) ? s.ingredients : [],
          isAppetizer:
            typeof s.isAppetizer === "boolean" ? s.isAppetizer : false,
        })),
      }));
    }
    return [];
  } catch (err) {
    console.warn("Failed to read plans.json, starting empty:", err);
    return [];
  }
}

async function writePlansToDisk(plans: Plan[]): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PLANS_FILE,
      JSON.stringify(plans, null, 2),
    );
  } catch (err) {
    console.warn("Failed to save plans.json:", err);
    throw err;
  }
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await readPlansFromDisk();
      setPlans(stored);
      setLoading(false);
    })();
  }, []);

  const addPlan = async (plan: Plan) => {
    const updated = [...plans, plan];
    setPlans(updated);
    await writePlansToDisk(updated);
  };

  const updatePlan = async (plan: Plan) => {
    const updated = plans.map((p) => (p.id === plan.id ? plan : p));
    setPlans(updated);
    await writePlansToDisk(updated);
  };

  const deletePlan = async (id: number) => {
    const updated = plans.filter((p) => p.id !== id);
    setPlans(updated);
    await writePlansToDisk(updated);
  };

  return (
    <PlanContext.Provider
      value={{ plans, addPlan, updatePlan, deletePlan, loading }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlans() {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("usePlans must be used within a PlanProvider");
  }
  return context;
}
