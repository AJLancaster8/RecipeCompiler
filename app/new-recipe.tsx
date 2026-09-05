import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { SafeAreaView } from "react-native-safe-area-context";
import { nextId, useRecipes } from "./recipe-store";

// The fixed spot (distance from the top of the screen) every focused text box
// should land at. Tweak this one number to move where boxes center — every
// box will land at exactly this same spot, regardless of its height or type.
const FOCUSED_INPUT_TARGET_Y = Dimensions.get("window").height * 0.35;

type IngredientRow = { id: number; name: string; amount: string; unit: string };
type StepRow = {
  id: number;
  text: string;
  description: string;
  timeValue: string;
  timeUnit: "s" | "m" | "h";
  ingredientIds: number[];
};

const emptyIngredientRow = (): IngredientRow => ({
  id: nextId(),
  name: "",
  amount: "",
  unit: "g",
});
const emptyStepRow = (): StepRow => ({
  id: nextId(),
  text: "",
  description: "",
  timeValue: "",
  timeUnit: "m",
  ingredientIds: [],
});

const TIME_UNITS: { label: string; value: "s" | "m" | "h" }[] = [
  { label: "s", value: "s" },
  { label: "m", value: "m" },
  { label: "h", value: "h" },
];

const INGREDIENT_UNITS: { label: string; value: string }[] = [
  { label: "Teaspoons (tsp)", value: "tsp" },
  { label: "Tablespoons (tbsp)", value: "tbsp" },
  { label: "Cups (cup)", value: "cup" },
  { label: "Fluid ounces (fl oz)", value: "fl oz" },
  { label: "Milliliters (ml)", value: "ml" },
  { label: "Liters (l)", value: "l" },
  { label: "Grams (g)", value: "g" },
  { label: "Kilograms (kg)", value: "kg" },
  { label: "Ounces (oz)", value: "oz" },
  { label: "Pounds (lb)", value: "lb" },
  { label: "Pinch", value: "pinch" },
  { label: "Whole / count", value: "whole" },
];

export default function RecipeFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { recipes, addRecipe, updateRecipe } = useRecipes();

  const scrollRef = useRef<any>(null);
  const scrollOffsetRef = useRef(0);

  // Called on every TextInput's onFocus. Measures where that box currently
  // sits on screen and scrolls just enough to move it to the same fixed
  // target spot every time — instead of relying on the library's per-input
  // height-based guess, which is why it landed differently before.
  const handleInputFocus = (event: any) => {
    const target = event.target;
    if (!target || !target.measure) return;
    target.measure(
      (
        _x: number,
        _y: number,
        _w: number,
        h: number,
        _pageX: number,
        pageY: number,
      ) => {
        const inputCenter = pageY + h / 2;
        const delta = inputCenter - FOCUSED_INPUT_TARGET_Y;
        const newOffset = Math.max(0, scrollOffsetRef.current + delta);
        scrollRef.current?.scrollToPosition(0, newOffset, true);
      },
    );
  };

  // If an id param is present and matches a saved recipe, we're editing it
  const editingRecipe = id
    ? recipes.find((r) => r.id === Number(id))
    : undefined;
  const isEditing = !!editingRecipe;

  const [recipeName, setRecipeName] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    emptyIngredientRow(),
  ]);
  const [steps, setSteps] = useState<StepRow[]>([emptyStepRow()]);
  const [saving, setSaving] = useState(false);

  // Which step's unit dropdown (if any) is currently open
  const [unitPickerStepId, setUnitPickerStepId] = useState<number | null>(null);
  // Which ingredient's unit dropdown (if any) is currently open
  const [unitPickerIngredientId, setUnitPickerIngredientId] = useState<
    number | null
  >(null);

  // Pre-fill the form when editing an existing recipe
  useEffect(() => {
    if (editingRecipe) {
      setRecipeName(editingRecipe.name);
      setIngredients(
        editingRecipe.ingredients.length > 0
          ? editingRecipe.ingredients.map((i: any) => ({
              id: i.id,
              name: i.name ?? "",
              amount:
                i.amount === undefined || i.amount === null
                  ? ""
                  : String(i.amount),
              unit: i.unit ?? "g",
            }))
          : [emptyIngredientRow()],
      );
      setSteps(
        editingRecipe.steps.length > 0
          ? editingRecipe.steps.map((s: any) => ({
              id: s.id,
              text: s.text ?? "",
              description: s.description ?? "",
              timeValue:
                s.timeValue === undefined || s.timeValue === null
                  ? ""
                  : String(s.timeValue),
              timeUnit: s.timeUnit ?? "m",
              ingredientIds: Array.isArray(s.ingredientIds)
                ? s.ingredientIds
                : [],
            }))
          : [emptyStepRow()],
      );
    }
    // Only re-run if we switch which recipe id we're editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Update the header title depending on create vs edit mode
  useLayoutEffect(() => {
    navigation.setOptions({ title: isEditing ? "Edit Recipe" : "New Recipe" });
  }, [isEditing, navigation]);

  // ---- Ingredients handlers ----
  const addIngredient = () => {
    setIngredients((prev) => [...prev, emptyIngredientRow()]);
  };

  const updateIngredientName = (rowId: number, text: string) => {
    setIngredients((prev) =>
      prev.map((item) => (item.id === rowId ? { ...item, name: text } : item)),
    );
  };

  const updateIngredientAmount = (rowId: number, text: string) => {
    setIngredients((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, amount: text } : item,
      ),
    );
  };

  const updateIngredientUnit = (rowId: number, unit: string) => {
    setIngredients((prev) =>
      prev.map((item) => (item.id === rowId ? { ...item, unit } : item)),
    );
    setUnitPickerIngredientId(null);
  };

  const removeIngredient = (rowId: number) => {
    setIngredients((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.id !== rowId);
    });
  };

  // ---- Steps handlers ----
  const addStep = () => {
    setSteps((prev) => [...prev, emptyStepRow()]);
  };

  const updateStepText = (rowId: number, text: string) => {
    setSteps((prev) =>
      prev.map((item) => (item.id === rowId ? { ...item, text } : item)),
    );
  };

  const updateStepDescription = (rowId: number, text: string) => {
    setSteps((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, description: text } : item,
      ),
    );
  };

  const toggleStepIngredient = (stepId: number, ingredientId: number) => {
    setSteps((prev) =>
      prev.map((item) => {
        if (item.id !== stepId) return item;
        const already = item.ingredientIds.includes(ingredientId);
        return {
          ...item,
          ingredientIds: already
            ? item.ingredientIds.filter((id) => id !== ingredientId)
            : [...item.ingredientIds, ingredientId],
        };
      }),
    );
  };

  const updateStepTime = (rowId: number, text: string) => {
    setSteps((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, timeValue: text } : item,
      ),
    );
  };

  const updateStepUnit = (rowId: number, unit: "s" | "m" | "h") => {
    setSteps((prev) =>
      prev.map((item) =>
        item.id === rowId ? { ...item, timeUnit: unit } : item,
      ),
    );
    setUnitPickerStepId(null);
  };

  const removeStep = (rowId: number) => {
    setSteps((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.id !== rowId);
    });
  };

  // Converts a text box's string to a number for storage. Empty box -> 0.
  // Returns null if the text isn't a valid number, so the caller can warn
  // the person instead of silently saving bad data.
  const parseAmount = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return 0;
    const n = parseFloat(trimmed);
    return isNaN(n) ? null : n;
  };

  // ---- Save/submit ----
  const handleSave = async () => {
    const nonEmptyIngredients = ingredients
      .map((i) => ({
        id: i.id,
        name: i.name.trim(),
        amountRaw: i.amount.trim(),
        unit: i.unit,
      }))
      .filter((i) => i.name.length > 0);

    const nonEmptySteps = steps
      .map((s) => ({
        id: s.id,
        text: s.text.trim(),
        description: s.description.trim(),
        timeValueRaw: s.timeValue.trim(),
        timeUnit: s.timeUnit,
        ingredientIds: s.ingredientIds,
      }))
      .filter((s) => s.text.length > 0);

    if (!recipeName.trim()) {
      Alert.alert("Missing name", "Please enter a recipe name.");
      return;
    }
    if (nonEmptyIngredients.length === 0) {
      Alert.alert("Missing ingredients", "Please add at least one ingredient.");
      return;
    }
    if (nonEmptySteps.length === 0) {
      Alert.alert("Missing steps", "Please add at least one step.");
      return;
    }

    const badIngredient = nonEmptyIngredients.find(
      (i) => parseAmount(i.amountRaw) === null,
    );
    if (badIngredient) {
      Alert.alert(
        "Invalid amount",
        `The amount for "${badIngredient.name}" isn't a valid number.`,
      );
      return;
    }

    const badStep = nonEmptySteps.find(
      (s) => parseAmount(s.timeValueRaw) === null,
    );
    if (badStep) {
      Alert.alert(
        "Invalid time",
        `The time for "${badStep.text}" isn't a valid number.`,
      );
      return;
    }

    const cleanedIngredients = nonEmptyIngredients.map((i) => ({
      id: i.id,
      name: i.name,
      amount: parseAmount(i.amountRaw) as number,
      unit: i.unit,
    }));

    const survivingIngredientIds = new Set(cleanedIngredients.map((i) => i.id));

    const cleanedSteps = nonEmptySteps.map((s) => ({
      id: s.id,
      text: s.text,
      description: s.description,
      timeValue: parseAmount(s.timeValueRaw) as number,
      timeUnit: s.timeUnit,
      // Drop references to any ingredient row that got removed/blanked out
      ingredientIds: s.ingredientIds.filter((id) =>
        survivingIngredientIds.has(id),
      ),
    }));

    setSaving(true);
    try {
      if (isEditing && editingRecipe) {
        await updateRecipe({
          id: editingRecipe.id,
          name: recipeName.trim(),
          ingredients: cleanedIngredients,
          steps: cleanedSteps,
        });
        Alert.alert("Updated!", `"${recipeName.trim()}" was updated.`, [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        await addRecipe({
          id: nextId(),
          name: recipeName.trim(),
          ingredients: cleanedIngredients,
          steps: cleanedSteps,
        });
        Alert.alert(
          "Saved!",
          `"${recipeName.trim()}" was saved to your device.`,
          [{ text: "OK", onPress: () => router.back() }],
        );
      }
    } catch (err) {
      Alert.alert(
        "Save failed",
        "There was a problem saving this recipe to your device.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid={true}
        enableAutomaticScroll={false}
        onScroll={(e: any) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {/* Recipe name */}
        <View style={styles.section}>
          <Text style={styles.label}>Recipe Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Grandma's Lasagna"
            value={recipeName}
            onChangeText={setRecipeName}
            onFocus={handleInputFocus}
          />
        </View>

        {/* Ingredients */}
        <View style={styles.section}>
          <Text style={styles.label}>Ingredients</Text>
          {ingredients.map((item, index) => (
            <View key={item.id} style={styles.ingredientBlock}>
              <TextInput
                style={styles.input}
                placeholder={`Ingredient ${index + 1}`}
                value={item.name}
                onChangeText={(text) => updateIngredientName(item.id, text)}
                onFocus={handleInputFocus}
              />
              <View style={styles.ingredientAmountRow}>
                <TextInput
                  style={[styles.input, styles.amountInput]}
                  placeholder="Amount"
                  value={item.amount}
                  onChangeText={(text) => updateIngredientAmount(item.id, text)}
                  onFocus={handleInputFocus}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  style={styles.unitButton}
                  onPress={() => setUnitPickerIngredientId(item.id)}
                >
                  <Text style={styles.unitButtonText}>{item.unit}</Text>
                  <Text style={styles.unitButtonCaret}>▾</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeIngredient(item.id)}
                  disabled={ingredients.length === 1}
                >
                  <Text
                    style={[
                      styles.removeButtonText,
                      ingredients.length === 1 && styles.disabledText,
                    ]}
                  >
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <Text style={styles.hint}>e.g. "Flour" — "2" — "cup"</Text>
          <TouchableOpacity style={styles.addButton} onPress={addIngredient}>
            <Text style={styles.addButtonText}>+ Add Ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* Ingredient unit picker dropdown, shared across all ingredient rows */}
        <Modal
          visible={unitPickerIngredientId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setUnitPickerIngredientId(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setUnitPickerIngredientId(null)}
          >
            <ScrollView style={styles.unitPickerBoxScrollable} bounces={false}>
              {INGREDIENT_UNITS.map((u) => (
                <TouchableOpacity
                  key={u.value}
                  style={styles.unitOption}
                  onPress={() => {
                    if (unitPickerIngredientId !== null) {
                      updateIngredientUnit(unitPickerIngredientId, u.value);
                    }
                  }}
                >
                  <Text style={styles.unitOptionText}>{u.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </Modal>

        {/* Steps */}
        <View style={styles.section}>
          <Text style={styles.label}>Steps</Text>
          {steps.map((item, index) => (
            <View key={item.id} style={styles.stepBlock}>
              <View style={styles.stepTopRow}>
                <View style={styles.stepNumberCircle}>
                  <Text style={styles.stepNumberText}>{index + 1}</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.stepInput]}
                  placeholder={`Step ${index + 1}`}
                  value={item.text}
                  onChangeText={(text) => updateStepText(item.id, text)}
                  onFocus={handleInputFocus}
                  multiline
                />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => removeStep(item.id)}
                  disabled={steps.length === 1}
                >
                  <Text
                    style={[
                      styles.removeButtonText,
                      steps.length === 1 && styles.disabledText,
                    ]}
                  >
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={[styles.input, styles.descriptionInput]}
                placeholder="Description (optional details for this step)"
                value={item.description}
                onChangeText={(text) => updateStepDescription(item.id, text)}
                onFocus={handleInputFocus}
                multiline
              />

              {ingredients.filter((i) => i.name.trim().length > 0).length >
                0 && (
                <>
                  <Text style={styles.chipsLabel}>
                    Ingredients used in this step
                  </Text>
                  <View style={styles.ingredientChipsWrap}>
                    {ingredients
                      .filter((i) => i.name.trim().length > 0)
                      .map((ing) => {
                        const selected = item.ingredientIds.includes(ing.id);
                        return (
                          <TouchableOpacity
                            key={ing.id}
                            style={[
                              styles.chip,
                              selected && styles.chipSelected,
                            ]}
                            onPress={() =>
                              toggleStepIngredient(item.id, ing.id)
                            }
                          >
                            <Text
                              style={[
                                styles.chipText,
                                selected && styles.chipTextSelected,
                              ]}
                            >
                              {ing.name.trim()}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                </>
              )}

              <View style={styles.timeRow}>
                <TextInput
                  style={[styles.input, styles.timeValueInput]}
                  placeholder="Time"
                  value={item.timeValue}
                  onChangeText={(text) => updateStepTime(item.id, text)}
                  onFocus={handleInputFocus}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity
                  style={styles.unitButton}
                  onPress={() => setUnitPickerStepId(item.id)}
                >
                  <Text style={styles.unitButtonText}>{item.timeUnit}</Text>
                  <Text style={styles.unitButtonCaret}>▾</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={styles.addButton} onPress={addStep}>
            <Text style={styles.addButtonText}>+ Add Step</Text>
          </TouchableOpacity>
        </View>

        {/* Unit picker dropdown, shared across all step rows */}
        <Modal
          visible={unitPickerStepId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setUnitPickerStepId(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setUnitPickerStepId(null)}
          >
            <View style={styles.unitPickerBox}>
              {TIME_UNITS.map((u) => (
                <TouchableOpacity
                  key={u.value}
                  style={styles.unitOption}
                  onPress={() => {
                    if (unitPickerStepId !== null)
                      updateStepUnit(unitPickerStepId, u.value);
                  }}
                >
                  <Text style={styles.unitOptionText}>
                    {u.value === "s"
                      ? "Seconds (s)"
                      : u.value === "m"
                        ? "Minutes (m)"
                        : "Hours (h)"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Save Recipe"}
          </Text>
        </TouchableOpacity>

        {/* Extra buffer space so the keyboard never covers the last field or button */}
        <View style={styles.keyboardBuffer} />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  container: {
    padding: 20,
    paddingBottom: 60,
  },
  keyboardBuffer: {
    height: 200,
  },
  section: {
    marginBottom: 28,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
    color: "#4A3B2C",
  },
  hint: {
    fontSize: 12,
    color: "#A8988570",
    marginBottom: 8,
    marginTop: -2,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#2B2118",
  },

  ingredientBlock: {
    marginBottom: 14,
  },
  ingredientAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  amountInput: {
    flex: 1,
    marginRight: 8,
  },

  stepBlock: {
    marginBottom: 14,
  },
  stepTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  stepInput: {
    flex: 1,
    minHeight: 44,
    textAlignVertical: "top",
  },
  timeInput: {
    marginLeft: 34,
  },
  descriptionInput: {
    marginLeft: 34,
    marginBottom: 10,
    minHeight: 40,
    textAlignVertical: "top",
    fontSize: 14,
  },
  chipsLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8A7A68",
    marginLeft: 34,
    marginBottom: 6,
  },
  ingredientChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginLeft: 34,
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#E0D5C7",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: {
    backgroundColor: "#D97B4F",
    borderColor: "#D97B4F",
  },
  chipText: {
    fontSize: 13,
    color: "#4A3B2C",
    fontWeight: "500",
  },
  chipTextSelected: {
    color: "#fff",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 34,
  },
  timeValueInput: {
    flex: 1,
    marginRight: 8,
  },
  unitButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0D5C7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 60,
    justifyContent: "space-between",
  },
  unitButtonText: {
    fontSize: 15,
    color: "#2B2118",
    fontWeight: "600",
  },
  unitButtonCaret: {
    fontSize: 12,
    color: "#8A7A68",
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(43, 33, 24, 0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  unitPickerBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 8,
    width: 220,
    overflow: "hidden",
  },
  unitPickerBoxScrollable: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    maxHeight: 340,
    width: 240,
  },
  unitOption: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#F0E6D8",
  },
  unitOptionText: {
    fontSize: 15,
    color: "#2B2118",
    fontWeight: "500",
  },
  stepNumberCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#D97B4F",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },

  removeButton: {
    marginLeft: 8,
    padding: 8,
  },
  removeButtonText: {
    fontSize: 18,
    color: "#B04A3B",
    fontWeight: "600",
  },
  disabledText: {
    color: "#D9CFC3",
  },
  addButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#F0E6D8",
    borderRadius: 8,
  },
  addButtonText: {
    color: "#8A5A2E",
    fontWeight: "600",
    fontSize: 14,
  },
  saveButton: {
    marginTop: 10,
    backgroundColor: "#D97B4F",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
});
