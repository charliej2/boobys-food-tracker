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
