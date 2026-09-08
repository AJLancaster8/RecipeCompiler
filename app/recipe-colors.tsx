// A palette of visually distinct colors, chosen to still feel at home
// with the app's warm color scheme. Recipes are assigned colors in the
// order their ids appear in a given recipeIds list (the order recipes
// were selected when compiling), so the same recipe keeps the same color
// between the Compiled preview and the saved Plan screen — both pass the
// same recipeIds order.
export const RECIPE_COLOR_PALETTE = [
  '#D97B4F', // orange (primary accent)
  '#4F7CAC', // blue
  '#5B8C5A', // green
  '#A65DA6', // purple
  '#C9A227', // mustard
  '#3C9D9B', // teal
  '#B04A3B', // brick red
  '#8A5A2E', // brown
];

export function getRecipeColor(recipeId: number, recipeIds: number[]): string {
  const index = recipeIds.indexOf(recipeId);
  const safeIndex = index === -1 ? 0 : index;
  return RECIPE_COLOR_PALETTE[safeIndex % RECIPE_COLOR_PALETTE.length];
}
