// Nutrient definitions used throughout the app.
//
// `fdcNumbers` lists the USDA FoodData Central "nutrientNumber" codes (stable,
// legacy SR numbers) to check, in priority order, when reading a food's
// nutrient data. An empty array means USDA does not reliably report this
// nutrient for whole foods (Foundation / SR Legacy datasets) — these will
// always show as "no data" rather than a possibly-wrong number.
//
// vitaminD is a special case handled in api.js: it prefers µg (328) and
// falls back to converting IU (324) if µg isn't reported.

const NUTRIENT_FIELDS = [
  // --- Macros ---
  { key: "calories", label: "Calories", unit: "kcal", group: "macro", fdcNumbers: ["208", "957", "958"] },
  { key: "protein", label: "Protein", unit: "g", group: "macro", fdcNumbers: ["203"] },
  { key: "carbs", label: "Carbs", unit: "g", group: "macro", fdcNumbers: ["205"] },
  { key: "fat", label: "Fat", unit: "g", group: "macro", fdcNumbers: ["204"] },
  { key: "fiber", label: "Fiber", unit: "g", group: "macro", fdcNumbers: ["291"] },
  { key: "sugar", label: "Sugar", unit: "g", group: "macro", fdcNumbers: ["269"] },

  // --- Minerals ---
  { key: "sodium", label: "Sodium", unit: "mg", group: "mineral", fdcNumbers: ["307"] },
  { key: "potassium", label: "Potassium", unit: "mg", group: "mineral", fdcNumbers: ["306"] },
  { key: "calcium", label: "Calcium", unit: "mg", group: "mineral", fdcNumbers: ["301"] },
  { key: "iron", label: "Iron", unit: "mg", group: "mineral", fdcNumbers: ["303"] },
  { key: "magnesium", label: "Magnesium", unit: "mg", group: "mineral", fdcNumbers: ["304"] },
  { key: "zinc", label: "Zinc", unit: "mg", group: "mineral", fdcNumbers: ["309"] },
  { key: "phosphorus", label: "Phosphorus", unit: "mg", group: "mineral", fdcNumbers: ["305"] },
  { key: "copper", label: "Copper", unit: "mg", group: "mineral", fdcNumbers: ["312"] },
  { key: "manganese", label: "Manganese", unit: "mg", group: "mineral", fdcNumbers: ["315"] },
  { key: "selenium", label: "Selenium", unit: "µg", group: "mineral", fdcNumbers: ["317"] },
  { key: "iodine", label: "Iodine", unit: "µg", group: "mineral", fdcNumbers: ["314"] },
  { key: "molybdenum", label: "Molybdenum", unit: "µg", group: "mineral", fdcNumbers: ["316"] },
  { key: "chloride", label: "Chloride", unit: "mg", group: "mineral", fdcNumbers: [], note: "Not tracked by USDA FoodData Central for whole foods" },
  { key: "chromium", label: "Chromium", unit: "µg", group: "mineral", fdcNumbers: [], note: "Not tracked by USDA FoodData Central for whole foods" },

  // --- Vitamins ---
  { key: "vitaminA", label: "Vitamin A", unit: "µg", group: "vitamin", fdcNumbers: ["320"] },
  { key: "vitaminC", label: "Vitamin C", unit: "mg", group: "vitamin", fdcNumbers: ["401"] },
  { key: "vitaminD", label: "Vitamin D", unit: "µg", group: "vitamin", fdcNumbers: ["328", "324"] },
  { key: "vitaminE", label: "Vitamin E", unit: "mg", group: "vitamin", fdcNumbers: ["323"] },
  { key: "vitaminK", label: "Vitamin K", unit: "µg", group: "vitamin", fdcNumbers: ["430"] },
  { key: "thiamin", label: "Vitamin B1 (Thiamin)", unit: "mg", group: "vitamin", fdcNumbers: ["404"] },
  { key: "riboflavin", label: "Vitamin B2 (Riboflavin)", unit: "mg", group: "vitamin", fdcNumbers: ["405"] },
  { key: "niacin", label: "Vitamin B3 (Niacin)", unit: "mg", group: "vitamin", fdcNumbers: ["406"] },
  { key: "pantothenicAcid", label: "Vitamin B5 (Pantothenic Acid)", unit: "mg", group: "vitamin", fdcNumbers: ["410"] },
  { key: "vitaminB6", label: "Vitamin B6", unit: "mg", group: "vitamin", fdcNumbers: ["415"] },
  { key: "biotin", label: "Vitamin B7 (Biotin)", unit: "µg", group: "vitamin", fdcNumbers: ["416"] },
  { key: "folate", label: "Vitamin B9 (Folate)", unit: "µg", group: "vitamin", fdcNumbers: ["417", "435"] },
  { key: "vitaminB12", label: "Vitamin B12", unit: "µg", group: "vitamin", fdcNumbers: ["418"] },
];

// Daily reference targets — FDA 2020 Daily Values (21 CFR 101.9), the same
// table used on US nutrition labels. A single well-established reference
// rather than age/sex-adjusted DRIs, which keeps this defensible without
// needing personal biometric data. Macro targets (calories/protein/carbs/fat)
// are editable in the UI; everything else uses these fixed values.
const DAILY_VALUES = {
  calories: 2000,
  protein: 50,
  carbs: 275,
  fat: 78,
  fiber: 28,
  sugar: 50, // FDA "Added Sugars" DV, used here as a general ceiling reference
  sodium: 2300,
  potassium: 4700,
  calcium: 1300,
  iron: 18,
  magnesium: 420,
  zinc: 11,
  phosphorus: 1250,
  copper: 0.9,
  manganese: 2.3,
  selenium: 55,
  iodine: 150,
  molybdenum: 45,
  chloride: 2300,
  chromium: 35,
  vitaminA: 900,
  vitaminC: 90,
  vitaminD: 20,
  vitaminE: 15,
  vitaminK: 120,
  thiamin: 1.2,
  riboflavin: 1.3,
  niacin: 16,
  pantothenicAcid: 5,
  vitaminB6: 1.7,
  biotin: 30,
  folate: 400,
  vitaminB12: 2.4,
};

// Nutrients where exceeding the target is the concern, not falling short of it.
const CAUTION_KEYS = ["sodium", "sugar", "chloride"];

// Fatty acid sub-types, summed from multiple FDC nutrient numbers, used only
// to compute the omega ratios below (not shown as standalone totals).
const FATTY_ACID_FIELDS = [
  { key: "omega3", label: "Omega-3", unit: "g", fdcNumbers: ["619", "621", "629", "631"] },
  { key: "omega6", label: "Omega-6", unit: "g", fdcNumbers: ["618", "620"] },
  { key: "omega9", label: "Omega-9 (est., mostly oleic acid)", unit: "g", fdcNumbers: ["617"] },
];

// Ratio definitions shown in the Ratios panel. Values come from combining
// totals (regular nutrients) and fatty acid sums above.
const RATIO_DEFINITIONS = [
  {
    key: "sodiumPotassium",
    label: "Sodium : Potassium",
    numeratorKey: "sodium",
    denominatorKey: "potassium",
    guidance: "Public health guidance favors a ratio at or below 1:1 for cardiovascular health.",
  },
  {
    key: "omega6Omega3",
    label: "Omega-6 : Omega-3",
    numeratorKey: "omega6",
    denominatorKey: "omega3",
    isFattyAcid: true,
    guidance: "Often-cited ideal is roughly 4:1 or lower; typical Western diets run much higher.",
  },
  {
    key: "omega3Omega9",
    label: "Omega-3 : Omega-9",
    numeratorKey: "omega3",
    denominatorKey: "omega9",
    isFattyAcid: true,
    guidance: "Omega-9 is non-essential (your body synthesizes it), so this isn't a standard clinical target like the others — shown for reference only.",
  },
  {
    key: "zincCopper",
    label: "Zinc : Copper",
    numeratorKey: "zinc",
    denominatorKey: "copper",
    guidance: "Ratios much above ~15:1 may impair copper absorption over time.",
  },
];

// Search queries used by the "best next food" recommender — one well-known,
// nutrient-dense real-world source per nutrient, looked up live via FDC
// search so the reported values stay accurate rather than hardcoded.
// Deliberately excludes calories/carbs/fat/sugar/sodium/chloride (not
// "deficiency" nutrients) and chromium/molybdenum (USDA reports no data for
// either, so a recommendation could never be substantiated).
const NUTRIENT_SOURCE_QUERIES = {
  protein: "chicken breast",
  fiber: "chia seeds",
  calcium: "sardines canned",
  iron: "beef liver",
  magnesium: "pumpkin seeds",
  zinc: "oysters",
  potassium: "white beans",
  phosphorus: "salmon atlantic raw",
  copper: "beef liver",
  manganese: "mussels",
  selenium: "brazil nuts",
  iodine: "cod atlantic raw",
  vitaminA: "sweet potato baked",
  vitaminC: "red bell pepper raw",
  vitaminD: "salmon atlantic raw",
  vitaminE: "sunflower seeds",
  vitaminK: "kale raw",
  thiamin: "pork chop",
  riboflavin: "beef liver",
  niacin: "chicken breast",
  pantothenicAcid: "mushrooms",
  vitaminB6: "pistachio nuts",
  biotin: "egg cooked",
  folate: "lentils cooked",
  vitaminB12: "clams",
};

// ============================================================
// Multi-item plain-language estimator — lookup tables used to parse
// sentences like "4 meatballs and half a small plate of spaghetti" into
// separate food segments with a rough quantity multiplier each. None of
// this is real NLP — just enough pattern-matching to turn common phrasing
// into a number we can multiply a portion by. Always a rough estimate.
// ============================================================

// Word-form counts. "few"/"couple"/"several" are deliberately vague —
// picked reasonable representative numbers for a rough estimate.
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  couple: 2, few: 3, several: 4,
};

const FRACTION_WORDS = { half: 0.5, quarter: 0.25, third: 1 / 3 };

const SIZE_MULTIPLIERS = { small: 0.75, medium: 1, regular: 1, large: 1.3, big: 1.3, huge: 1.6 };

// Approximate single-unit weights (grams) for common discrete/countable
// foods — used when someone says "4 meatballs" rather than "a plate of
// meatballs". Without this, we'd have no way to tell a per-item count
// apart from a serving count, and would badly overestimate. These are
// rough averages, not USDA-sourced, and are only used to scale a gram
// amount — the actual nutrition per 100g still comes from a real food
// search.
const UNIT_WEIGHTS_G = {
  meatball: 25,
  egg: 50,
  cookie: 15,
  biscuit: 15,
  slice: 30,
  shrimp: 10,
  wing: 30,
  nugget: 20,
  dumpling: 20,
  pancake: 40,
  strawberry: 12,
  grape: 5,
  olive: 4,
  taco: 90,
  sausage: 50,
  cracker: 3,
  meatpie: 175,
  sushi: 30,
};

// USDA's FNDDS search ranks by literal keyword match, not relevance — a
// handful of common dish words are dominated in their own search results
// by an unrelated product category (e.g. "spaghetti" surfaces ten
// "Spaghetti sauce" variants before any actual spaghetti dish). Swapping
// in the word that actually indexes the intended dish fixes this without
// a general-purpose synonym system. Verified against the live API before
// adding each entry here.
const DISH_QUERY_SYNONYMS = {
  spaghetti: "pasta",
};

// Phrases containing "and" that should NOT be split into separate food
// items when parsing a multi-item description (they're a single dish).
const AND_EXCEPTIONS = [
  "mac and cheese",
  "macaroni and cheese",
  "peanut butter and jelly",
  "rice and beans",
  "salt and pepper",
  "bangers and mash",
  "fish and chips",
  "surf and turf",
  "bread and butter",
  "bacon and eggs",
];

// --- Personalized targets: biometric calculator ---

// Mifflin-St Jeor activity multipliers (BMR -> total daily energy).
const ACTIVITY_MULTIPLIERS = {
  sedentary: { label: "Sedentary (little to no exercise)", value: 1.2 },
  light: { label: "Light exercise (1-3 days/week)", value: 1.375 },
  moderate: { label: "Moderate exercise (3-5 days/week)", value: 1.55 },
  active: { label: "Hard exercise (6-7 days/week)", value: 1.725 },
  veryActive: { label: "Very hard exercise + physical job", value: 1.9 },
};

const KCAL_PER_KJ = 4.184;
const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;

// Region-specific micronutrient reference values, by sex, for an average
// adult (19-50). USA values mirror the FDA Daily Values already in
// DAILY_VALUES (which are unisex, per the nutrition label standard).
// Australia/NZ values are simplified from the NHMRC Nutrient Reference
// Values — a single adult 19-50 band rather than the full age-banded
// table, which is enough to be meaningfully personalized without
// pretending to be a clinical-grade calculator. Calorie/protein/carb/
// fat/fiber/sugar targets are computed from biometrics instead, so they
// aren't repeated here.
const REGIONAL_MICRONUTRIENTS = {
  usa: {
    male: {
      sodium: 2300, potassium: 4700, calcium: 1300, iron: 18, magnesium: 420,
      zinc: 11, phosphorus: 1250, copper: 0.9, manganese: 2.3, selenium: 55,
      iodine: 150, molybdenum: 45, chloride: 2300, chromium: 35,
      vitaminA: 900, vitaminC: 90, vitaminD: 20, vitaminE: 15, vitaminK: 120,
      thiamin: 1.2, riboflavin: 1.3, niacin: 16, pantothenicAcid: 5,
      vitaminB6: 1.7, biotin: 30, folate: 400, vitaminB12: 2.4,
    },
    female: {
      sodium: 2300, potassium: 4700, calcium: 1300, iron: 18, magnesium: 420,
      zinc: 11, phosphorus: 1250, copper: 0.9, manganese: 2.3, selenium: 55,
      iodine: 150, molybdenum: 45, chloride: 2300, chromium: 35,
      vitaminA: 900, vitaminC: 90, vitaminD: 20, vitaminE: 15, vitaminK: 120,
      thiamin: 1.2, riboflavin: 1.3, niacin: 16, pantothenicAcid: 5,
      vitaminB6: 1.7, biotin: 30, folate: 400, vitaminB12: 2.4,
    },
  },
  australia: {
    male: {
      sodium: 2000, potassium: 3800, calcium: 1000, iron: 8, magnesium: 400,
      zinc: 14, phosphorus: 1000, copper: 1.7, manganese: 5.5, selenium: 70,
      iodine: 150, molybdenum: 45, chloride: 2300, chromium: 35,
      vitaminA: 900, vitaminC: 45, vitaminD: 10, vitaminE: 10, vitaminK: 70,
      thiamin: 1.2, riboflavin: 1.3, niacin: 16, pantothenicAcid: 4,
      vitaminB6: 1.3, biotin: 30, folate: 400, vitaminB12: 2.4,
    },
    female: {
      sodium: 2000, potassium: 2800, calcium: 1000, iron: 18, magnesium: 310,
      zinc: 8, phosphorus: 1000, copper: 1.7, manganese: 5, selenium: 60,
      iodine: 150, molybdenum: 45, chloride: 2300, chromium: 25,
      vitaminA: 700, vitaminC: 45, vitaminD: 10, vitaminE: 7, vitaminK: 60,
      thiamin: 1.1, riboflavin: 1.1, niacin: 14, pantothenicAcid: 4,
      vitaminB6: 1.3, biotin: 30, folate: 400, vitaminB12: 2.4,
    },
  },
};
