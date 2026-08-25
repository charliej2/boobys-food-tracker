// USDA FoodData Central integration.
//
// Regular food search uses only "Foundation" and "SR Legacy" data types —
// these are generic whole/basic foods with clean, complete nutrient panels.
// "Branded" foods are excluded from that search: it turns out that dataset
// is retail packaged/grocery products (submitted by manufacturers), not
// restaurant menu items — searching it for e.g. "Big Mac" returns unrelated
// grocery products with matching keywords, not McDonald's nutrition data.
// No free database contains actual restaurant-chain menu nutrition, so
// that case is handled via the dish-estimator (Survey/FNDDS data, see
// searchDishEstimateAPI below) plus manual entry, not a "Branded" search.

const FDC_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const FDC_DATA_TYPES = "Foundation,SR Legacy";
const FDC_PAGE_SIZE = 25;

async function searchFoodsAPI(query, signal) {
  const url =
    `${FDC_BASE_URL}/foods/search` +
    `?api_key=${encodeURIComponent(FDC_API_KEY)}` +
    `&query=${encodeURIComponent(query)}` +
    `&dataType=${encodeURIComponent(FDC_DATA_TYPES)}` +
    `&pageSize=${FDC_PAGE_SIZE}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("USDA API rate limit reached — please wait a moment and try again.");
    }
    throw new Error(`USDA API error (status ${response.status})`);
  }

  const data = await response.json();
  return data.foods || [];
}

// Searches USDA's "Survey (FNDDS)" dataset — composite, as-eaten dishes
// (e.g. "Macaroni or noodles with cheese", "Burrito, chicken, cheese") each
// with a typical serving weight. This is what powers the "describe what you
// ate" estimator: it's a real, if generic, average — not specific to any
// restaurant or recipe, but far better than a blind guess.
// Uses POST because the dataType value "Survey (FNDDS)" contains
// parentheses that the GET endpoint rejects with a 400.
async function searchDishEstimateAPI(query, signal) {
  const response = await fetch(`${FDC_BASE_URL}/foods/search?api_key=${encodeURIComponent(FDC_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      query,
      dataType: ["Survey (FNDDS)"],
      pageSize: 10,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("USDA API rate limit reached — please wait a moment and try again.");
    }
    throw new Error(`USDA API error (status ${response.status})`);
  }

  const data = await response.json();
  return data.foods || [];
}

// Strips leading zeros so UPC-A (12-digit), EAN-13 (13-digit, often a
// UPC-A zero-padded to 13), and GTIN-14 representations of the same
// barcode all compare equal, regardless of which form the scanner read
// or which form USDA stored in gtinUpc.
function normalizeUPC(code) {
  return String(code || "").replace(/^0+/, "");
}

// FDC's `query` search matches gtinUpc as an exact string, not a normalized
// number — and USDA stores gtinUpc at inconsistent lengths across records
// (8-digit UPC-E, 12-digit UPC-A, 13-digit EAN-13, 14-digit GTIN-14 all
// appear, even across near-identical products from the same brand). A
// scanner typically reads a 12- or 13-digit code, so querying only that
// exact string can miss a record USDA stored zero-padded to a different
// length. Generate every zero-padded length actually seen in the data so at
// least one query string exactly matches however USDA stored it.
function upcQueryVariants(upc) {
  const bare = normalizeUPC(upc);
  const variants = new Set([String(upc || "")]);
  [8, 12, 13, 14].forEach((len) => {
    if (bare.length <= len) variants.add(bare.padStart(len, "0"));
  });
  return Array.from(variants);
}

// Looks up a scanned barcode against USDA's "Branded" dataset — retail
// packaged/grocery products, the one dataset that actually carries a
// GTIN/UPC field. This is a deliberate, narrow exception to the
// Branded-exclusion note above: barcode scanning is inherently about a
// specific packaged product, so Branded is the correct (only) source here.
// Uses POST since dataType values can contain characters GET's dataType
// param mishandles, and to stay consistent with searchDishEstimateAPI.
//
// Queries every zero-padded length variant of the UPC in parallel (see
// upcQueryVariants) since FDC only exact-string-matches gtinUpc — a single
// query in the "wrong" padding for that particular record returns nothing.
async function searchByUPCAPI(upc, signal) {
  const variants = upcQueryVariants(upc);

  const responses = await Promise.all(
    variants.map((query) =>
      fetch(`${FDC_BASE_URL}/foods/search?api_key=${encodeURIComponent(FDC_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          query,
          dataType: ["Branded"],
          pageSize: 25,
        }),
      })
    )
  );

  if (responses.some((r) => r.status === 429)) {
    throw new Error("USDA API rate limit reached — please wait a moment and try again.");
  }
  const failed = responses.find((r) => !r.ok);
  if (failed) {
    throw new Error(`USDA API error (status ${failed.status})`);
  }

  const results = await Promise.all(responses.map((r) => r.json()));
  const byId = new Map();
  results.forEach((data) => {
    (data.foods || []).forEach((f) => byId.set(f.fdcId, f));
  });
  const foods = Array.from(byId.values());

  // FDC's search matches the UPC as a keyword against several fields, so a
  // loose text match can surface unrelated products alongside the real one.
  // Prefer results whose gtinUpc is an exact match once zero-padding is
  // normalized; fall back to the raw keyword results only if none match.
  const exact = foods.filter((f) => f.gtinUpc && normalizeUPC(f.gtinUpc) === normalizeUPC(upc));
  return exact.length > 0 ? exact : foods;
}

// Local search over the bundled AFCD (Australian Food Composition Database)
// dataset — see afcd-data.js. AFCD is a static download with no live API, so
// this runs entirely client-side (no network) against the AFCD_FOODS array
// defined there, and complements the live USDA search rather than replacing
// it: USDA Foundation/SR Legacy covers generic foods well but with US-centric
// naming/coverage, while AFCD adds Australian foods and works even if USDA
// is unreachable.
//
// AFCD names are stored "Category, descriptor, descriptor…" (e.g. "Chicken,
// breast, lean flesh, raw") rather than natural-language phrasing like
// "Chicken breast" — a literal substring match against the raw query would
// miss most everyday searches. Token matching (every query word must appear
// somewhere in the name, in any order) handles both phrasings.
function searchAfcdFoods(query, limit = 15) {
  if (typeof AFCD_FOODS === "undefined") return [];

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored = [];
  for (const food of AFCD_FOODS) {
    const lowerName = food.name.toLowerCase();
    if (!tokens.every((t) => lowerName.includes(t))) continue;
    // Prefer names where the first query word appears earliest (closer to a
    // literal match), then shorter names as a secondary tiebreaker (more
    // likely to be the plain/generic form rather than a specific dish).
    const firstIndex = lowerName.indexOf(tokens[0]);
    scored.push({ food, firstIndex, length: lowerName.length });
  }

  scored.sort((a, b) => a.firstIndex - b.firstIndex || a.length - b.length);
  return scored.slice(0, limit).map((s) => s.food);
}

// Extracts a typical gram portion for a dish-estimate search result.
// Search results (unlike the food-detail endpoint) sometimes include a
// single representative portion in foodMeasures; falls back to a sane
// default serving size if none is present.
function estimateDefaultGrams(fdcFood) {
  const measures = fdcFood.foodMeasures || [];
  const withWeight = measures.find((m) => m.gramWeight > 0);
  if (withWeight) return Math.round(withWeight.gramWeight);
  return 200; // generic "average portion" fallback
}

// Converts a raw FDC food record into our internal shape:
// { fdcId, name, category, dataType, per100: { <nutrientKey>: value|null } }
function normalizeFdcFood(fdcFood) {
  const byNumber = {};
  (fdcFood.foodNutrients || []).forEach((n) => {
    const num = String(n.nutrientNumber);
    if (n.value != null && !(num in byNumber)) {
      byNumber[num] = n.value;
    }
  });

  const per100 = {};
  NUTRIENT_FIELDS.forEach((field) => {
    if (field.key === "vitaminD") {
      if (byNumber["328"] != null) {
        per100.vitaminD = byNumber["328"];
      } else if (byNumber["324"] != null) {
        per100.vitaminD = byNumber["324"] * 0.025; // IU -> µg
      } else {
        per100.vitaminD = null;
      }
      return;
    }

    if (field.fdcNumbers.length === 0) {
      per100[field.key] = null;
      return;
    }

    let value = null;
    for (const num of field.fdcNumbers) {
      if (byNumber[num] != null) {
        value = byNumber[num];
        break;
      }
    }
    per100[field.key] = value;
  });

  // Fatty acid sub-types (omega-3/6/9), summed across whichever component
  // nutrient numbers USDA reported. Used only for the Ratios panel.
  const fattyAcids = {};
  FATTY_ACID_FIELDS.forEach((field) => {
    let sum = null;
    field.fdcNumbers.forEach((num) => {
      if (byNumber[num] != null) {
        sum = (sum || 0) + byNumber[num];
      }
    });
    fattyAcids[field.key] = sum;
  });

  return {
    fdcId: fdcFood.fdcId,
    name: fdcFood.description,
    category: fdcFood.foodCategory || fdcFood.dataType,
    dataType: fdcFood.dataType,
    per100,
    fattyAcids,
  };
}

// ============================================================
// Health score (Yuka/Open Food Facts-style heuristic, Branded foods only)
// ============================================================
//
// NOT a validated clinical grading system, and not a reproduction of any
// proprietary app's algorithm — a transparent estimate built from two
// published, non-proprietary public-health references:
//  1. The UK Food Standards Agency's sugar/saturated-fat/salt "traffic
//     light" per-100g thresholds (the same ones printed on UK food labels),
//     plus a fiber/protein bonus in the same spirit as France's Nutri-Score.
//  2. A curated list of additives with documented regulatory action (EU/FDA
//     bans) or scientific scrutiny (IARC classifications, NTP/CSPI review),
//     matched by keyword against the product's ingredient list.
// Branded-food ingredient lists are free text, not structured additive
// data, so matching can miss unusual phrasing or, rarely, false-positive on
// an unrelated ingredient name (e.g. a "natural red 40 flower extract").
// Treat the result as a rough guide, not a definitive verdict — same
// caveat these consumer apps themselves carry.

const HEALTH_SCORE_HIGH_CONCERN_ADDITIVES = [
  { pattern: /partially hydrogenated/i, label: "Partially hydrogenated oil (artificial trans fat)" },
  { pattern: /potassium bromate/i, label: "Potassium bromate" },
  { pattern: /titanium dioxide/i, label: "Titanium dioxide" },
  { pattern: /\bred\s*(dye\s*)?#?\s*3\b|erythrosine/i, label: "Red 3 (erythrosine)" },
  { pattern: /\bbha\b|butylated hydroxyanisole/i, label: "BHA (butylated hydroxyanisole)" },
  { pattern: /\bbht\b|butylated hydroxytoluene/i, label: "BHT (butylated hydroxytoluene)" },
  { pattern: /\btbhq\b|tert(iary)?[- ]butylhydroquinone/i, label: "TBHQ" },
  { pattern: /brominated vegetable oil|\bbvo\b/i, label: "Brominated vegetable oil" },
  { pattern: /azodicarbonamide/i, label: "Azodicarbonamide" },
  { pattern: /sodium nitrite|sodium nitrate|potassium nitrite|potassium nitrate/i, label: "Nitrite/nitrate preservative" },
  { pattern: /propylparaben/i, label: "Propylparaben" },
];

const HEALTH_SCORE_MODERATE_CONCERN_ADDITIVES = [
  { pattern: /high fructose corn syrup/i, label: "High fructose corn syrup" },
  { pattern: /monosodium glutamate|\bmsg\b/i, label: "MSG (monosodium glutamate)" },
  { pattern: /aspartame/i, label: "Aspartame" },
  { pattern: /acesulfame potassium|ace-k/i, label: "Acesulfame potassium" },
  { pattern: /sucralose/i, label: "Sucralose" },
  { pattern: /\bred\s*40\b/i, label: "Red 40" },
  { pattern: /\byellow\s*5\b/i, label: "Yellow 5" },
  { pattern: /\byellow\s*6\b/i, label: "Yellow 6" },
  { pattern: /\bblue\s*1\b/i, label: "Blue 1" },
  { pattern: /\bblue\s*2\b/i, label: "Blue 2" },
  { pattern: /carrageenan/i, label: "Carrageenan" },
  { pattern: /sodium benzoate|potassium benzoate/i, label: "Benzoate preservative" },
  { pattern: /potassium sorbate/i, label: "Potassium sorbate" },
  { pattern: /polysorbate 80/i, label: "Polysorbate 80" },
  { pattern: /propylene glycol/i, label: "Propylene glycol" },
  { pattern: /artificial flavor|artificial color/i, label: "Artificial flavor/color" },
];

function findHealthScoreAdditives(ingredientsText, list) {
  if (!ingredientsText) return [];
  const found = [];
  list.forEach(({ pattern, label }) => {
    if (pattern.test(ingredientsText) && !found.includes(label)) {
      found.push(label);
    }
  });
  return found;
}

function clampHealthScore(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// FSA traffic-light banding for one nutrient, per 100g/100ml.
function healthScoreTrafficLight(value, lowMax, highMin) {
  if (value == null) return "unknown";
  if (value <= lowMax) return "green";
  if (value >= highMin) return "red";
  return "amber";
}

const HEALTH_SCORE_TRAFFIC_LIGHT_POINTS = { green: 15, amber: 7, red: 0, unknown: 7 };

// Fiber/protein bonus, Nutri-Score-inspired: award a fraction of the max for
// each threshold cleared, so a product doesn't need to hit the top band to
// get partial credit.
function healthScoreTieredBonus(value, thresholds, maxPoints) {
  if (value == null) return 0;
  const step = maxPoints / thresholds.length;
  let points = 0;
  thresholds.forEach((t) => {
    if (value >= t) points += step;
  });
  return points;
}

// Nutrition component of the health score, out of 70 points: up to 45 from
// avoiding high sugar/saturated fat/salt, up to 25 from fiber + protein.
function healthScoreNutritionPoints(per100, saturatedFatPer100) {
  const sugarLight = healthScoreTrafficLight(per100.sugar, 5, 22.5);
  const satFatLight = healthScoreTrafficLight(saturatedFatPer100, 1.5, 5);
  const saltGrams = per100.sodium != null ? (per100.sodium * 2.5) / 1000 : null;
  const saltLight = healthScoreTrafficLight(saltGrams, 0.3, 1.5);

  let points =
    HEALTH_SCORE_TRAFFIC_LIGHT_POINTS[sugarLight] +
    HEALTH_SCORE_TRAFFIC_LIGHT_POINTS[satFatLight] +
    HEALTH_SCORE_TRAFFIC_LIGHT_POINTS[saltLight];

  points += healthScoreTieredBonus(per100.fiber, [0.9, 1.9, 2.8, 3.7, 4.7], 12.5);
  points += healthScoreTieredBonus(per100.protein, [1.6, 3.2, 4.8, 6.4, 8.0], 12.5);

  return { points, sugarLight, satFatLight, saltLight };
}

function healthScoreGrade(score) {
  if (score >= 85) return { label: "Excellent", color: "#1a7d3c" };
  if (score >= 70) return { label: "Good", color: "#5fa83f" };
  if (score >= 50) return { label: "Fair", color: "#e0a800" };
  if (score >= 30) return { label: "Poor", color: "#e07a1f" };
  return { label: "Bad", color: "#c0392b" };
}

// Computes the 0-100 health score for a scanned Branded product. Takes the
// raw FDC record (for ingredients text and saturated fat, which isn't part
// of the app's normalized per100 shape) alongside the already-normalized
// food (for per100 sugar/sodium/fiber/protein).
function calculateHealthScore(fdcFood, food) {
  const saturatedFat = (fdcFood.foodNutrients || []).find((n) => String(n.nutrientNumber) === "606");
  const saturatedFatPer100 = saturatedFat && saturatedFat.value != null ? saturatedFat.value : null;

  const { points: nutritionPoints, sugarLight, satFatLight, saltLight } = healthScoreNutritionPoints(
    food.per100,
    saturatedFatPer100
  );

  const highConcernAdditives = findHealthScoreAdditives(fdcFood.ingredients, HEALTH_SCORE_HIGH_CONCERN_ADDITIVES);
  const moderateConcernAdditives = findHealthScoreAdditives(fdcFood.ingredients, HEALTH_SCORE_MODERATE_CONCERN_ADDITIVES);
  const additivePenalty = Math.min(30, highConcernAdditives.length * 10 + moderateConcernAdditives.length * 5);
  const additivePoints = 30 - additivePenalty;

  const score = Math.round(clampHealthScore(nutritionPoints + additivePoints, 0, 100));

  return {
    score,
    grade: healthScoreGrade(score),
    sugarLight,
    satFatLight,
    saltLight,
    highConcernAdditives,
    moderateConcernAdditives,
  };
}

// Fetches common household serving sizes (e.g. "1 large egg = 50g") for a
// food. Only available via the food detail endpoint — search results never
// include portion data. Returns [] if the food has none on record.
async function fetchFoodPortions(fdcId, signal) {
  const url = `${FDC_BASE_URL}/food/${fdcId}?api_key=${encodeURIComponent(FDC_API_KEY)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`USDA API error (status ${response.status})`);
  }

  const data = await response.json();
  return (data.foodPortions || [])
    .filter((p) => p.gramWeight > 0)
    .map((p) => {
      const unitName = p.measureUnit && p.measureUnit.name !== "undetermined" ? p.measureUnit.name : "";
      const text = (p.portionDescription && p.portionDescription !== "None") ? p.portionDescription : (p.modifier || unitName || "portion");
      return {
        label: `${text} (${Math.round(p.gramWeight * 10) / 10}g)`,
        grams: p.gramWeight,
      };
    });
}
