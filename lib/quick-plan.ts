import type { Plan, PlanIngredient, PlanStep } from "../app/plan-store";
import { nextId, Recipe } from "../app/recipe-store";

const UNIT_SECONDS = { s: 1, m: 60, h: 3600 } as const;

// Turns one recipe into a plan that starts now — the same shape the Compile
// screen builds for several recipes, so the plan screen's timers, checklist
// and notifications all work on it. Used by "Make This".
export function buildQuickPlan(recipe: Recipe): Plan {
  // Shopping list: one row per ingredient name, amounts summed per unit.
  const groups = new Map<string, { name: string; totals: Map<string, number> }>();
  for (const ing of recipe.ingredients) {
    const key = ing.name.trim().toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { name: ing.name.trim(), totals: new Map() };
      groups.set(key, group);
    }
    group.totals.set(ing.unit, (group.totals.get(ing.unit) ?? 0) + ing.amount);
  }
  const ingredients: PlanIngredient[] = [...groups.values()].map((g) => ({
    name: g.name,
    amounts: [...g.totals.entries()].map(([unit, amount]) => ({ unit, amount })),
    checked: false,
  }));

  // Steps run back to back, each starting when the previous one ends.
  let offset = 0;
  const steps: PlanStep[] = recipe.steps.map((s) => {
    const durationSeconds = (s.timeValue || 0) * UNIT_SECONDS[s.timeUnit];
    const step: PlanStep = {
      id: nextId(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      text: s.text,
      description: s.description || "",
      offsetSeconds: offset,
      durationSeconds,
      ingredients: (s.ingredientIds || [])
        .map((id) => recipe.ingredients.find((i) => i.id === id))
        .filter((i) => !!i)
        .map((i) => ({ name: i!.name, amount: i!.amount, unit: i!.unit })),
      isAppetizer: false,
    };
    offset += durationSeconds;
    return step;
  });

  return {
    id: nextId(),
    name: recipe.name,
    recipeIds: [recipe.id],
    ingredients,
    steps,
    activeSteps: [],
    scheduledStartAt: Date.now(),
  };
}
