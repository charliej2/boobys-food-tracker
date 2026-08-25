// --- State ---
let selectedEntries = []; // { entryId, foodId, quantity, unitGrams, unitLabel }
let entryCounter = 0;
const foodCache = new Map(); // fdcId -> normalized food (+ lazy-loaded portions)

// Targets now cover every tracked nutrient (not just macros) so the
// biometric calculator below can personalize the whole panel. Defaults
// to the existing FDA Daily Values until the user calculates or edits.
let targets = {};
NUTRIENT_FIELDS.forEach((field) => {
  targets[field.key] = DAILY_VALUES[field.key];
});

// --- Units & personalization state ---
let energyUnit = "kcal"; // "kcal" | "kJ"
let unitSystem = "metric"; // "metric" | "imperial"
let region = "usa"; // "usa" | "australia"

// Saved meals (persisted) + in-progress meal builder state
const MEALS_STORAGE_KEY = "trakd_saved_meals_v1";
let savedMeals = [];
let mealBuilderIngredients = []; // { entryId, foodId, quantity }
let mealBuilderEntryCounter = 0;
let editingMealId = null;

// --- DOM refs ---
const searchInput = document.getElementById("search-input");
const foodListEl = document.getElementById("food-list");
const selectedListEl = document.getElementById("selected-list");
const macroTotalsEl = document.getElementById("macro-totals");
const mineralTotalsEl = document.getElementById("mineral-totals");
const vitaminTotalsEl = document.getElementById("vitamin-totals");
const targetsFormEl = document.getElementById("targets-form");
const ratioListEl = document.getElementById("ratio-list");
const flagListEl = document.getElementById("flag-list");
const recommenderResultEl = document.getElementById("recommender-result");
const findFoodBtn = document.getElementById("find-food-btn");
const toggleSupplementBtn = document.getElementById("toggle-supplement-btn");
const supplementFormEl = document.getElementById("supplement-form");
const supplementFieldsEl = document.getElementById("supplement-fields");
const supplementNameEl = document.getElementById("supplement-name");
const supplementAddBtn = document.getElementById("supplement-add-btn");
const supplementCancelBtn = document.getElementById("supplement-cancel-btn");

const estimateInputEl = document.getElementById("estimate-input");
const estimateBtn = document.getElementById("estimate-btn");
const estimateResultsEl = document.getElementById("estimate-results");

const createMealBtn = document.getElementById("create-meal-btn");
const mealBuilderEl = document.getElementById("meal-builder");
const mealNameInput = document.getElementById("meal-name-input");
const mealIngredientSearchInput = document.getElementById("meal-ingredient-search");
const mealIngredientResultsEl = document.getElementById("meal-ingredient-results");
const mealDraftListEl = document.getElementById("meal-draft-list");
const mealBuilderCancelBtn = document.getElementById("meal-builder-cancel-btn");
const mealBuilderSaveBtn = document.getElementById("meal-builder-save-btn");
const savedMealsListEl = document.getElementById("saved-meals-list");

const scanVideoEl = document.getElementById("scan-video");
const scanStartBtn = document.getElementById("scan-start-btn");
const scanStopBtn = document.getElementById("scan-stop-btn");
const scanStatusEl = document.getElementById("scan-status");
const scanResultEl = document.getElementById("scan-result");

const toggleSettingsBtn = document.getElementById("toggle-settings-btn");
const settingsPanelEl = document.getElementById("settings-panel");
const unitSystemSelect = document.getElementById("unit-system-select");
const energyUnitSelect = document.getElementById("energy-unit-select");
const regionSelect = document.getElementById("region-select");
const biometricSexEl = document.getElementById("biometric-sex");
const biometricAgeEl = document.getElementById("biometric-age");
const biometricWeightEl = document.getElementById("biometric-weight");
const biometricHeightEl = document.getElementById("biometric-height");
const biometricWeightLabelEl = document.getElementById("biometric-weight-label");
const biometricHeightLabelEl = document.getElementById("biometric-height-label");
const biometricActivityEl = document.getElementById("biometric-activity");
const calculateTargetsBtn = document.getElementById("calculate-targets-btn");
const calculatedSummaryEl = document.getElementById("calculated-summary");
const targetsHintEl = document.getElementById("targets-hint");

const MACRO_KEYS = ["calories", "protein", "carbs", "fat", "fiber", "sugar"];
const EDITABLE_TARGET_KEYS = ["calories", "protein", "carbs", "fat"];

function getFoodById(id) {
  return foodCache.get(id);
}

// ============================================================
// Units: calories/kJ display + metric/imperial helpers
// ============================================================

// Formats a kcal value for display, converting to kJ if that's the
// selected energy unit. Internal state always stores kcal — this is a
// display-only conversion so the underlying nutrition math never changes.
function formatEnergy(kcalValue, { withUnit = true } = {}) {
  if (energyUnit === "kJ") {
    const kj = Math.round(kcalValue * KCAL_PER_KJ);
    return withUnit ? `${kj} kJ` : `${kj}`;
  }
  const kcal = Math.round(kcalValue);
  return withUnit ? `${kcal} kcal` : `${kcal}`;
}

function kcalToDisplayUnit(kcalValue) {
  return energyUnit === "kJ" ? Math.round(kcalValue * KCAL_PER_KJ) : Math.round(kcalValue);
}

function displayUnitToKcal(displayValue) {
  return energyUnit === "kJ" ? displayValue / KCAL_PER_KJ : displayValue;
}

function kgToDisplayWeight(kg) {
  return unitSystem === "imperial" ? Math.round((kg / KG_PER_LB) * 10) / 10 : Math.round(kg * 10) / 10;
}

function displayWeightToKg(value) {
  return unitSystem === "imperial" ? value * KG_PER_LB : value;
}

function cmToDisplayHeight(cm) {
  return unitSystem === "imperial" ? Math.round(cm / CM_PER_INCH) : Math.round(cm);
}

function displayHeightToCm(value) {
  return unitSystem === "imperial" ? value * CM_PER_INCH : value;
}

// ============================================================
// Tabs
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll(".tab-panel").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`tab-${tabName}`).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
  // Leaving the Scan tab should always release the camera, not just
  // clicking "Stop Scanning" — otherwise the camera light stays on and
  // the stream keeps running in the background after navigating away.
  if (tabName !== "scan") stopScanning();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ============================================================
// Reusable food search widget (used by main search + meal builder)
// ============================================================

function createSearchWidget({ inputEl, listEl, onSelect, placeholder }) {
  let debounceTimer = null;
  let abortController = null;

  function renderResults(results) {
    if (results.length === 0) {
      listEl.innerHTML = `<p class="empty-state">No foods found. Try a different search term.</p>`;
      return;
    }
    listEl.innerHTML = "";
    results.forEach((fdcFood) => {
      const food = normalizeFdcFood(fdcFood);
      foodCache.set(food.fdcId, food);

      const row = document.createElement("div");
      row.className = "food-item";
      row.innerHTML = `
        <div>
          <div class="food-name">${food.name}</div>
          <div class="food-category">${food.category}${food.dataType ? " · " + food.dataType : ""}</div>
        </div>
        <span class="add-icon">+</span>
      `;
      row.addEventListener("click", () => onSelect(food.fdcId));
      listEl.appendChild(row);
    });
  }

  async function search(query) {
    const trimmed = query.trim();
    if (abortController) abortController.abort();

    if (!trimmed) {
      listEl.innerHTML = `<p class="empty-state">${placeholder}</p>`;
      return;
    }

    abortController = new AbortController();
    listEl.innerHTML = `<p class="empty-state">Searching…</p>`;

    try {
      const results = await searchFoodsAPI(trimmed, abortController.signal);
      renderResults(results);
    } catch (err) {
      if (err.name === "AbortError") return;
      listEl.innerHTML = `<p class="empty-state">${err.message}</p>`;
    }
  }

  inputEl.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(e.target.value), 300);
  });

  search("");
}

// ============================================================
// Barcode scanning (camera -> UPC -> USDA Branded lookup)
// ============================================================
//
// Prefers the browser-native BarcodeDetector API (Chrome/Edge/Android —
// fast, no download needed). Falls back to the @zxing/library UMD build,
// lazy-loaded from a CDN only when needed, for browsers that lack
// BarcodeDetector (notably Safari/iOS, Firefox). Either path ends the same
// way: a decoded UPC string handed to searchByUPCAPI.

let scannerStream = null;
let scannerRafId = null;
let scanning = false;
let nativeBarcodeDetector = null;
let zxingReader = null;
let zxingLibPromise = null;

const SCAN_BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

function loadZXingLibrary() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLibPromise) return zxingLibPromise;
  zxingLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js";
    script.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("Barcode scanner library failed to load.")));
    script.onerror = () => reject(new Error("Couldn't load the barcode scanner library — check your internet connection and try again."));
    document.head.appendChild(script);
  });
  return zxingLibPromise;
}

async function startScanning() {
  scanResultEl.innerHTML = "";
  scanStatusEl.textContent = "Requesting camera access…";

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch (err) {
    scanStatusEl.textContent = "Camera access denied or unavailable — you can still search or add foods manually.";
    return;
  }

  scanVideoEl.srcObject = scannerStream;
  try {
    await scanVideoEl.play();
  } catch (err) {
    // Some browsers reject play() if the tab isn't focused yet; the video
    // will still start once autoplay is allowed, so this isn't fatal.
  }

  scanning = true;
  scanStartBtn.classList.add("hidden");
  scanStopBtn.classList.remove("hidden");

  if ("BarcodeDetector" in window) {
    scanStatusEl.textContent = "Point your camera at a barcode…";
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = SCAN_BARCODE_FORMATS.filter((f) => supported.includes(f));
      nativeBarcodeDetector = new window.BarcodeDetector({ formats: formats.length ? formats : supported });
    } catch (err) {
      nativeBarcodeDetector = new window.BarcodeDetector();
    }
    runNativeDetectionLoop();
    return;
  }

  scanStatusEl.textContent = "Loading barcode scanner…";
  try {
    const ZXing = await loadZXingLibrary();
    if (!scanning) return; // user hit Stop while the library was loading
    zxingReader = new ZXing.BrowserMultiFormatReader();
    scanStatusEl.textContent = "Point your camera at a barcode…";
    // decodeFromVideoElement (no "Continuously" suffix) only decodes a single
    // frame at video-load time and ignores any callback passed to it — the
    // result is a Promise nothing ever reads, so the scanner appeared to hang
    // forever on any browser without native BarcodeDetector support (all of
    // Safari/iOS, including this app's iOS build, which uses WKWebView).
    // decodeFromVideoElementContinuously re-decodes on a timer until stopped
    // and actually invokes the callback on every attempt.
    zxingReader.decodeFromVideoElementContinuously(scanVideoEl, (result) => {
      if (result && scanning) handleBarcodeDetected(result.getText());
    });
  } catch (err) {
    scanStatusEl.textContent = err.message;
    stopScanning();
  }
}

function runNativeDetectionLoop() {
  if (!scanning || !nativeBarcodeDetector) return;
  nativeBarcodeDetector
    .detect(scanVideoEl)
    .then((barcodes) => {
      if (barcodes.length > 0) {
        handleBarcodeDetected(barcodes[0].rawValue);
      } else {
        scannerRafId = requestAnimationFrame(runNativeDetectionLoop);
      }
    })
    .catch(() => {
      scannerRafId = requestAnimationFrame(runNativeDetectionLoop);
    });
}

function stopScanning() {
  const wasScanning = scanning;
  scanning = false;

  if (scannerRafId) {
    cancelAnimationFrame(scannerRafId);
    scannerRafId = null;
  }
  if (zxingReader) {
    zxingReader.reset();
    zxingReader = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  nativeBarcodeDetector = null;
  scanVideoEl.srcObject = null;

  scanStartBtn.classList.remove("hidden");
  scanStopBtn.classList.add("hidden");
  if (wasScanning) scanStatusEl.textContent = "";
}

async function handleBarcodeDetected(code) {
  stopScanning();
  scanStatusEl.textContent = `Scanned ${code} — looking it up…`;
  scanResultEl.innerHTML = "";

  try {
    const results = await searchByUPCAPI(code);
    renderScanResults(results, code);
  } catch (err) {
    scanStatusEl.textContent = "";
    scanResultEl.innerHTML = `<p class="empty-state">${err.message}</p>`;
  }
}

function renderScanResults(results, code) {
  scanStatusEl.textContent = "";

  if (results.length === 0) {
    scanResultEl.innerHTML = `<p class="empty-state">No product found for barcode ${code} in USDA's Branded Foods database. Try searching manually, or add it as a custom food.</p>`;
    return;
  }

  scanResultEl.innerHTML = "";
  results.forEach((fdcFood) => {
    const food = normalizeFdcFood(fdcFood);
    foodCache.set(food.fdcId, food);
    const health = calculateHealthScore(fdcFood, food);

    const brand = fdcFood.brandOwner || fdcFood.brandName;
    const row = document.createElement("div");
    row.className = "food-item scan-result-item";
    row.innerHTML = `
      <div class="scan-result-main">
        <div>
          <div class="food-name">${food.name}</div>
          <div class="food-category">${brand ? brand + " · " : ""}${food.dataType}</div>
        </div>
        <span class="add-icon">+</span>
      </div>
      ${renderHealthScoreHTML(health)}
    `;
    row.querySelector(".scan-result-main").addEventListener("click", () => addFoodEntry(food.fdcId));
    scanResultEl.appendChild(row);
  });
}

// Renders the health-score badge + "why" breakdown under a scanned product.
// See calculateHealthScore in api.js for what the score/grade/lights mean
// and its "rough guide, not a verdict" caveat.
function renderHealthScoreHTML(health) {
  const concerns = [...health.highConcernAdditives, ...health.moderateConcernAdditives];
  const concernsHTML = concerns.length
    ? `<div class="health-score-concerns">Contains: ${concerns.join(", ")}</div>`
    : "";

  return `
    <div class="health-score-row">
      <span class="health-score-badge" style="background:${health.grade.color}">
        ${health.score}/100 · ${health.grade.label}
      </span>
      <span class="health-score-lights">
        <span class="light-dot light-${health.sugarLight}" title="Sugar"></span>
        <span class="light-dot light-${health.satFatLight}" title="Saturated fat"></span>
        <span class="light-dot light-${health.saltLight}" title="Salt"></span>
      </span>
    </div>
    ${concernsHTML}
  `;
}

scanStartBtn.addEventListener("click", startScanning);
scanStopBtn.addEventListener("click", stopScanning);

// ============================================================
// Log entries (selected foods / supplements / meal ingredients)
// ============================================================

function addFoodEntry(foodId, unitGrams = 1, unitLabel = "g", quantity = 100) {
  entryCounter += 1;
  selectedEntries.push({ entryId: entryCounter, foodId, quantity, unitGrams, unitLabel });
  renderSelectedList();
  renderAll();

  const food = getFoodById(foodId);
  if (food && !food.isCustom && food.portions === undefined) {
    loadPortionsForFood(foodId);
  }
}

async function loadPortionsForFood(foodId) {
  const food = getFoodById(foodId);
  if (!food) return;
  food.portions = null; // loading marker
  try {
    food.portions = await fetchFoodPortions(food.fdcId);
  } catch (err) {
    food.portions = [];
  }
  renderSelectedList();
}

function removeEntry(entryId) {
  selectedEntries = selectedEntries.filter((e) => e.entryId !== entryId);
  renderSelectedList();
  renderAll();
}

function updateEntryQuantity(entryId, quantity) {
  const entry = selectedEntries.find((e) => e.entryId === entryId);
  if (!entry) return;
  entry.quantity = Math.max(0, quantity);
  renderAll();
}

function updateEntryUnit(entryId, grams, label) {
  const entry = selectedEntries.find((e) => e.entryId === entryId);
  if (!entry) return;
  const currentGrams = entry.quantity * entry.unitGrams;
  entry.unitGrams = grams;
  entry.unitLabel = label;
  entry.quantity = Math.round((currentGrams / grams) * 10) / 10;
  renderSelectedList();
  renderAll();
}

function getEntryScaleFactor(entry, food) {
  if (food.isCustom) return entry.quantity; // per100 represents "per serving"
  return (entry.quantity * entry.unitGrams) / 100;
}

function renderSelectedList() {
  if (selectedEntries.length === 0) {
    selectedListEl.innerHTML = `<p class="empty-state">Nothing logged yet. Search on the left and click a food to add it.</p>`;
    return;
  }

  selectedListEl.innerHTML = "";
  selectedEntries.forEach((entry) => {
    const food = getFoodById(entry.foodId);
    if (!food) return;
    const scaleFactor = getEntryScaleFactor(entry, food);
    const cals = food.per100.calories != null ? food.per100.calories * scaleFactor : null;

    const row = document.createElement("div");
    row.className = "selected-item";

    const badge = food.isCustom ? `<span class="custom-badge">Custom</span>` : "";

    let unitControl;
    if (food.isCustom) {
      unitControl = `<span class="qty-unit">serving(s)</span>`;
    } else {
      const options = [
        { label: "g", grams: 1 },
        ...(unitSystem === "imperial" ? [{ label: "oz", grams: 28.3495 }] : []),
        ...(food.portions || []),
      ];
      const optionsHtml = options
        .map((opt) => `<option value="${opt.grams}" data-label="${opt.label}" ${opt.grams === entry.unitGrams && opt.label === entry.unitLabel ? "selected" : ""}>${opt.label}</option>`)
        .join("");
      const loadingNote = food.portions === null ? `<span class="portion-loading">loading portions…</span>` : "";
      unitControl = `<select class="unit-select" data-entry-id="${entry.entryId}">${optionsHtml}</select>${loadingNote}`;
    }

    row.innerHTML = `
      <div class="item-info">
        <div class="item-name">${food.name} ${badge}</div>
        <div class="item-calories">${cals != null ? formatEnergy(cals) : "no data"}</div>
      </div>
      <input
        type="number"
        class="qty-input"
        min="0"
        step="${food.isCustom ? "0.5" : "10"}"
        value="${entry.quantity}"
        data-entry-id="${entry.entryId}"
      />
      ${unitControl}
      <button class="remove-btn" data-entry-id="${entry.entryId}" title="Remove">✕</button>
    `;
    selectedListEl.appendChild(row);
  });

  selectedListEl.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const entryId = Number(e.target.dataset.entryId);
      const val = parseFloat(e.target.value) || 0;
      updateEntryQuantity(entryId, val);
    });
  });

  selectedListEl.querySelectorAll(".unit-select").forEach((select) => {
    select.addEventListener("change", (e) => {
      const entryId = Number(e.target.dataset.entryId);
      const opt = e.target.selectedOptions[0];
      updateEntryUnit(entryId, Number(opt.value), opt.dataset.label);
    });
  });

  selectedListEl.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      removeEntry(Number(e.target.dataset.entryId));
    });
  });
}

// ============================================================
// Totals
// ============================================================

function computeTotals() {
  const values = {};
  const hasData = {};
  NUTRIENT_FIELDS.forEach((field) => {
    values[field.key] = 0;
    hasData[field.key] = false;
  });

  const fattyAcidValues = { omega3: 0, omega6: 0, omega9: 0 };
  const fattyAcidHasData = { omega3: false, omega6: false, omega9: false };

  selectedEntries.forEach((entry) => {
    const food = getFoodById(entry.foodId);
    if (!food) return;
    const factor = getEntryScaleFactor(entry, food);

    NUTRIENT_FIELDS.forEach((field) => {
      const v = food.per100[field.key];
      if (v != null) {
        values[field.key] += v * factor;
        hasData[field.key] = true;
      }
    });

    if (food.fattyAcids) {
      Object.keys(fattyAcidValues).forEach((key) => {
        const v = food.fattyAcids[key];
        if (v != null) {
          fattyAcidValues[key] += v * factor;
          fattyAcidHasData[key] = true;
        }
      });
    }
  });

  return { values, hasData, fattyAcidValues, fattyAcidHasData };
}

function classifyProgress(key, pct) {
  const isCaution = CAUTION_KEYS.includes(key);
  if (isCaution) {
    if (pct <= 100) return "good";
    if (pct <= 130) return "warn";
    return "bad";
  }
  if (pct >= 90) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

function formatValue(field, value, hasData) {
  if (!hasData) return "no data";
  if (field.key === "calories") return formatEnergy(value);
  const rounded = value.toFixed(1);
  return `${rounded} ${field.unit}`;
}

function nutrientCardHtml(field, value, hasValue, target) {
  const display = formatValue(field, value, hasValue);
  const targetDisplay = field.key === "calories" ? kcalToDisplayUnit(target) : Math.round(target * 10) / 10;
  const targetUnit = field.key === "calories" ? (energyUnit === "kJ" ? "kJ" : "kcal") : field.unit;
  if (target == null) {
    return `
      <div class="micro-row">
        <span class="micro-label">${field.label}</span>
        <span class="micro-value ${!hasValue ? "no-data" : ""}">${display}</span>
      </div>
    `;
  }
  const pct = hasValue ? (value / target) * 100 : 0;
  const cls = classifyProgress(field.key, pct);
  const barWidth = Math.min(pct, 100);
  const pctLabel = hasValue ? `${Math.round(pct)}%` : "—";
  const titleAttr = field.note ? ` title="${field.note}"` : "";
  return `
    <div class="micro-row micro-row--bar"${titleAttr}>
      <div class="micro-row-top">
        <span class="micro-label">${field.label}</span>
        <span class="micro-value ${!hasValue ? "no-data" : ""}">${display}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${cls}" style="width:${barWidth}%"></div>
      </div>
      <div class="progress-pct ${cls}">${pctLabel} of ${targetDisplay}${targetUnit === "kcal" || targetUnit === "kJ" ? " " + targetUnit : targetUnit}</div>
    </div>
  `;
}

function renderTotals() {
  const { values, hasData } = computeTotals();

  macroTotalsEl.innerHTML = MACRO_KEYS.map((key) => {
    const field = NUTRIENT_FIELDS.find((f) => f.key === key);
    const target = targets[key] != null ? targets[key] : DAILY_VALUES[key];
    return nutrientCardHtml(field, values[key], hasData[key], target);
  }).join("");

  renderNutrientGroup(mineralTotalsEl, "mineral", values, hasData);
  renderNutrientGroup(vitaminTotalsEl, "vitamin", values, hasData);
}

function renderNutrientGroup(container, group, values, hasData) {
  const fields = NUTRIENT_FIELDS.filter((f) => f.group === group);
  container.innerHTML = fields
    .map((field) => nutrientCardHtml(field, values[field.key], hasData[field.key], targets[field.key]))
    .join("");
}

// ============================================================
// Targets form
// ============================================================

function renderTargetsForm() {
  targetsFormEl.innerHTML = EDITABLE_TARGET_KEYS.map((key) => {
    const field = NUTRIENT_FIELDS.find((f) => f.key === key);
    const isCalories = key === "calories";
    const unitLabel = isCalories ? (energyUnit === "kJ" ? "kJ" : "kcal") : field.unit;
    const displayValue = isCalories ? kcalToDisplayUnit(targets[key]) : Math.round(targets[key] * 10) / 10;
    return `
      <label class="target-field">
        <span>${field.label} (${unitLabel})</span>
        <input type="number" min="0" class="target-input" data-key="${key}" value="${displayValue}" />
      </label>
    `;
  }).join("");

  targetsFormEl.querySelectorAll(".target-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const key = e.target.dataset.key;
      const raw = Math.max(0, parseFloat(e.target.value) || 0);
      targets[key] = key === "calories" ? displayUnitToKcal(raw) : raw;
      renderAll();
    });
  });
}

// ============================================================
// Ratios
// ============================================================

function computeRatios() {
  const { values, hasData, fattyAcidValues, fattyAcidHasData } = computeTotals();

  return RATIO_DEFINITIONS.map((def) => {
    const numHasData = def.isFattyAcid ? fattyAcidHasData[def.numeratorKey] : hasData[def.numeratorKey];
    const denHasData = def.isFattyAcid ? fattyAcidHasData[def.denominatorKey] : hasData[def.denominatorKey];
    const numValue = def.isFattyAcid ? fattyAcidValues[def.numeratorKey] : values[def.numeratorKey];
    const denValue = def.isFattyAcid ? fattyAcidValues[def.denominatorKey] : values[def.denominatorKey];

    const available = numHasData && denHasData && denValue > 0;
    const ratio = available ? numValue / denValue : null;

    return { ...def, numValue, denValue, ratio, available };
  });
}

function renderRatios() {
  const ratios = computeRatios();
  ratioListEl.innerHTML = ratios
    .map((r) => {
      if (!r.available) {
        return `
          <div class="ratio-card">
            <div class="ratio-label">${r.label}</div>
            <div class="ratio-value no-data">not enough data logged today</div>
          </div>
        `;
      }
      return `
        <div class="ratio-card">
          <div class="ratio-label">${r.label}</div>
          <div class="ratio-value">${r.ratio.toFixed(1)} : 1</div>
          <div class="ratio-guidance">${r.guidance}</div>
        </div>
      `;
    })
    .join("");
}

// ============================================================
// Nutrient interaction flags
// ============================================================

function computeFlags() {
  const { values, hasData, fattyAcidValues, fattyAcidHasData } = computeTotals();
  const flags = [];

  if (hasData.sodium && hasData.potassium && values.potassium > 0) {
    const ratio = values.sodium / values.potassium;
    if (ratio > 1) {
      flags.push({
        level: "warn",
        text: `Sodium:Potassium ratio is ${ratio.toFixed(1)}:1 — above the ~1:1 guidance. More potassium-rich foods (leafy greens, beans, potatoes) or less sodium would help balance this.`,
      });
    }
  }

  if (fattyAcidHasData.omega6 && fattyAcidHasData.omega3 && fattyAcidValues.omega3 > 0) {
    const ratio = fattyAcidValues.omega6 / fattyAcidValues.omega3;
    if (ratio > 10) {
      flags.push({
        level: "warn",
        text: `Omega-6:Omega-3 ratio is ${ratio.toFixed(1)}:1, well above the commonly cited ~4:1 target — likely driven by vegetable oil intake relative to oily fish or flax.`,
      });
    }
  }

  if (hasData.iron && values.iron > 0 && (!hasData.vitaminC || values.vitaminC < 30)) {
    flags.push({
      level: "info",
      text: `Vitamin C intake today is low or unlogged, which can reduce absorption of the non-heme iron you've eaten. Pairing iron-rich foods with vitamin C (citrus, peppers, tomatoes) improves uptake.`,
    });
  }

  if (hasData.zinc && hasData.copper && values.copper > 0) {
    const ratio = values.zinc / values.copper;
    if (ratio > 15) {
      flags.push({
        level: "warn",
        text: `Zinc:Copper ratio is ${ratio.toFixed(1)}:1 — ratios above ~15:1 may impair copper absorption over time.`,
      });
    }
  }

  if (hasData.calcium && values.calcium > 1000 && hasData.iron && values.iron > 0) {
    flags.push({
      level: "info",
      text: `High calcium intake today alongside iron-rich foods — calcium can compete with iron for absorption. Spacing them apart during the day may help.`,
    });
  }

  if (hasData.vitaminD && values.vitaminD > 0 && hasData.magnesium && values.magnesium < DAILY_VALUES.magnesium * 0.5) {
    flags.push({
      level: "info",
      text: `Magnesium is required to metabolize vitamin D, and today's magnesium intake is under half the daily reference — low magnesium can blunt vitamin D's benefit.`,
    });
  }

  return flags;
}

function renderFlags() {
  const flags = computeFlags();
  if (flags.length === 0) {
    flagListEl.innerHTML = `<p class="empty-state">No notable nutrient interactions flagged for today's intake.</p>`;
    return;
  }
  flagListEl.innerHTML = flags
    .map((f) => `<div class="flag-card flag-${f.level}">${f.text}</div>`)
    .join("");
}

// ============================================================
// Best next food recommender
// ============================================================

async function findBestNextFood() {
  const { values, hasData } = computeTotals();

  const candidates = Object.keys(NUTRIENT_SOURCE_QUERIES)
    .map((key) => {
      const target = DAILY_VALUES[key];
      const current = hasData[key] ? values[key] : 0;
      const pct = target ? (current / target) * 100 : 100;
      return { key, pct, target, current };
    })
    .filter((c) => c.pct < 80)
    .sort((a, b) => a.pct - b.pct);

  if (candidates.length === 0) {
    recommenderResultEl.innerHTML = `<p class="empty-state">You're tracking well against your targets — no major gaps to close right now.</p>`;
    return;
  }

  const top = candidates[0];
  const field = NUTRIENT_FIELDS.find((f) => f.key === top.key);
  const query = NUTRIENT_SOURCE_QUERIES[top.key];

  recommenderResultEl.innerHTML = `<p class="empty-state">Searching for a food to help with ${field.label}…</p>`;
  findFoodBtn.disabled = true;

  try {
    const results = await searchFoodsAPI(query);
    if (!results.length) throw new Error("no results");
    const food = normalizeFdcFood(results[0]);
    const per100Value = food.per100[top.key];
    if (per100Value == null || per100Value <= 0) throw new Error("no usable data");

    const remaining = Math.max(top.target - top.current, 0);
    const gramsNeeded = Math.max(5, Math.round((remaining / per100Value) * 100 / 5) * 5);

    foodCache.set(food.fdcId, food);

    recommenderResultEl.innerHTML = `
      <p>Biggest gap today: <strong>${field.label}</strong> (${Math.round(top.pct)}% of target).</p>
      <p>About <strong>${gramsNeeded}g of ${food.name}</strong> would close the rest of today's gap
        (~${remaining.toFixed(1)}${field.unit} needed, ${per100Value.toFixed(1)}${field.unit} per 100g).</p>
      <button id="add-suggested-food" class="secondary-btn">Add ${gramsNeeded}g to today's log</button>
    `;

    document.getElementById("add-suggested-food").addEventListener("click", () => {
      addFoodEntry(food.fdcId, 1, "g", gramsNeeded);
      loadPortionsForFood(food.fdcId);
    });
  } catch (err) {
    recommenderResultEl.innerHTML = `<p class="empty-state">Couldn't find reliable source data automatically for ${field.label} — try searching manually.</p>`;
  } finally {
    findFoodBtn.disabled = false;
  }
}

// ============================================================
// Supplement / custom / restaurant food form
// ============================================================

function renderSupplementFields() {
  supplementFieldsEl.innerHTML = NUTRIENT_FIELDS.map((field) => `
    <label class="supplement-field">
      <span>${field.label} (${field.unit})</span>
      <input type="number" min="0" step="any" class="supplement-input" data-key="${field.key}" placeholder="0" />
    </label>
  `).join("");
}

function toggleSupplementForm(show, prefillName) {
  supplementFormEl.classList.toggle("hidden", !show);
  if (show) {
    supplementNameEl.value = prefillName || "";
    supplementFieldsEl.querySelectorAll(".supplement-input").forEach((i) => (i.value = ""));
    supplementNameEl.focus();
  }
}

function addSupplementEntry() {
  const name = supplementNameEl.value.trim();
  if (!name) {
    supplementNameEl.focus();
    return;
  }

  const per100 = {};
  supplementFieldsEl.querySelectorAll(".supplement-input").forEach((input) => {
    const key = input.dataset.key;
    const val = parseFloat(input.value);
    per100[key] = isNaN(val) ? null : val;
  });

  const fdcId = `custom-${Date.now()}`;
  const food = {
    fdcId,
    name,
    category: "Custom / Supplement",
    dataType: "Custom",
    isCustom: true,
    portions: [],
    per100,
    fattyAcids: {},
  };

  foodCache.set(fdcId, food);
  addFoodEntry(fdcId, 1, "serving", 1);
  toggleSupplementForm(false);
}

// ============================================================
// Estimate a meal from a plain-language description
// ============================================================
//
// Supports multiple items in one sentence, e.g. "4 meatballs and half a
// small plate of spaghetti". None of this is real NLP — it's pattern
// matching against common phrasing (counts, fractions, size words,
// container words) applied per food item, backed by a real USDA search
// for the actual nutrition. It's explicitly a rough estimate, not exact.

// Pulls out "from X" / "at X" as a restaurant name (applied to the whole
// sentence, once) so we can search USDA for the dish itself and be
// upfront that the result isn't specific to that restaurant.
function parseDishDescription(text) {
  const match = text.match(/\b(?:from|at)\s+(.+)$/i);
  if (match) {
    const restaurant = match[1].trim().replace(/[.?!]+$/, "");
    const dish = text.slice(0, match.index).trim().replace(/[,]+$/, "");
    return { dish: dish || text, restaurant };
  }
  return { dish: text, restaurant: null };
}

function stripLeadingFiller(text) {
  return text.replace(/^i\s+(had|ate)\s+/i, "").replace(/^(had|ate)\s+/i, "").trim();
}

function cleanDishQuery(text) {
  let cleaned = text
    .replace(/^(a|an|one|some)\s+/i, "")
    .replace(/\b(average\s+size\s+)?(portion|serving)\s+of\s+/gi, "")
    .trim();

  Object.entries(DISH_QUERY_SYNONYMS).forEach(([word, replacement]) => {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, "gi"), replacement);
  });

  return cleaned;
}

// Splits "4 meatballs and half a small plate of spaghetti" into separate
// food segments on commas and " and ", while protecting known dish names
// that legitimately contain "and" (mac and cheese, etc.) from being split.
function splitFoodSegments(text) {
  let working = text;
  const placeholders = [];
  AND_EXCEPTIONS.forEach((phrase) => {
    const re = new RegExp(phrase.replace(/ /g, "\\s+"), "gi");
    working = working.replace(re, (match) => {
      const token = `__AND_EXC_${placeholders.length}__`;
      placeholders.push(match);
      return token;
    });
  });

  const parts = working
    .split(/\s*,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.map((p) => p.replace(/__AND_EXC_(\d+)__/, (_, idx) => placeholders[Number(idx)]));
}

// Pulls a leading quantity ("4", "half a", "a couple of") and size word
// ("small"/"large") off a single food segment, returning the multiplier(s)
// to apply and the remaining dish text to search for.
function parseQuantityPrefix(segment) {
  let text = segment.trim();
  let multiplier = 1;
  let sizeMultiplier = 1;

  const fractionMatch = text.match(/^(half|quarter|third)\s+(?:of\s+)?(?:a|an)?\s*/i);
  if (fractionMatch) {
    multiplier *= FRACTION_WORDS[fractionMatch[1].toLowerCase()];
    text = text.slice(fractionMatch[0].length).trim();
  }

  const countMatch = text.match(
    /^(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple|several)\s+/i
  );
  if (countMatch) {
    const word = countMatch[1].toLowerCase();
    const n = /^\d/.test(word) ? parseFloat(word) : NUMBER_WORDS[word] ?? 1;
    multiplier *= n;
    text = text.slice(countMatch[0].length).trim();
  }

  const sizeMatch = text.match(/^(small|medium|regular|large|big|huge)\s+/i);
  if (sizeMatch) {
    sizeMultiplier = SIZE_MULTIPLIERS[sizeMatch[1].toLowerCase()];
    text = text.slice(sizeMatch[0].length).trim();
  }

  text = text.replace(/^(plates?|bowls?|cups?|slices?|servings?|portions?|pieces?|handfuls?)\s+of\s+/i, "").trim();

  return { multiplier, sizeMultiplier, dish: text || segment.trim() };
}

// Matches a cleaned dish phrase against the discrete-unit weight table
// (e.g. "meatballs" -> 25g each), trying exact, singularized, and
// last-word forms so "chicken wings" still matches "wing".
function lookupUnitWeight(dish) {
  const lower = dish.toLowerCase().trim();
  const words = lower.split(/\s+/);
  const lastWord = words[words.length - 1];
  const tries = [lower, lower.replace(/s$/, ""), lastWord, lastWord.replace(/s$/, "")];
  for (const key of tries) {
    if (UNIT_WEIGHTS_G[key] != null) return UNIT_WEIGHTS_G[key];
  }
  return null;
}

let currentEstimateItems = [];
let estimateItemCounter = 0;

async function performEstimate() {
  const raw = estimateInputEl.value.trim();
  if (!raw) return;

  const stripped = stripLeadingFiller(raw);
  const { dish: dishPortion, restaurant } = parseDishDescription(stripped);
  const segments = splitFoodSegments(dishPortion);

  estimateResultsEl.innerHTML = `<p class="empty-state">Searching for matches…</p>`;
  estimateBtn.disabled = true;

  try {
    const items = await Promise.all(segments.map((seg) => buildEstimateItem(seg)));
    renderMultiEstimate(items, restaurant, raw);
  } catch (err) {
    estimateResultsEl.innerHTML = `<p class="empty-state">${err.message}</p>`;
  } finally {
    estimateBtn.disabled = false;
  }
}

async function buildEstimateItem(rawSegment) {
  const { multiplier, sizeMultiplier, dish } = parseQuantityPrefix(rawSegment);
  const cleanedDish = cleanDishQuery(dish) || dish;
  const unitWeight = lookupUnitWeight(cleanedDish);

  estimateItemCounter += 1;
  const item = {
    id: estimateItemCounter,
    rawSegment,
    cleanedDish,
    multiplier,
    sizeMultiplier,
    unitWeight,
    candidates: [],
    selectedIndex: 0,
    grams: 0,
  };

  try {
    const results = await searchDishEstimateAPI(cleanedDish);
    item.candidates = results.slice(0, 5).map((fdcFood) => {
      const food = normalizeFdcFood(fdcFood);
      foodCache.set(food.fdcId, food);
      return { food, defaultGrams: estimateDefaultGrams(fdcFood) };
    });
  } catch (err) {
    item.candidates = [];
  }

  if (item.candidates.length > 0) item.grams = computeEstimateItemGrams(item);
  return item;
}

// A discrete-unit food (e.g. "meatball") scales off its per-unit weight;
// anything else scales off the matched dish's typical serving weight.
// Either way, the count/fraction/size multipliers parsed from the
// sentence are applied on top.
function computeEstimateItemGrams(item) {
  const candidate = item.candidates[item.selectedIndex];
  if (!candidate) return 0;
  const base = item.unitWeight != null ? item.unitWeight : candidate.defaultGrams;
  return Math.max(1, Math.round(base * item.multiplier * item.sizeMultiplier));
}

function sumEstimateItems(items) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  items.forEach((item) => {
    const candidate = item.candidates[item.selectedIndex];
    if (!candidate) return;
    const factor = item.grams / 100;
    ["calories", "protein", "carbs", "fat"].forEach((key) => {
      const v = candidate.food.per100[key];
      if (v != null) totals[key] += v * factor;
    });
  });
  return totals;
}

function renderCombinedEstimateSummary(items) {
  const matched = items.filter((i) => i.candidates.length > 0);
  if (matched.length === 0) return "";
  const totals = sumEstimateItems(items);
  return `
    <div class="estimate-combined">
      <div class="estimate-combined-title">Combined estimate (${items.length} item${items.length > 1 ? "s" : ""})</div>
      <div class="estimate-combined-macros">
        <span>${formatEnergy(totals.calories)}</span>
        <span>${totals.protein.toFixed(1)}g protein</span>
        <span>${totals.carbs.toFixed(1)}g carbs</span>
        <span>${totals.fat.toFixed(1)}g fat</span>
      </div>
    </div>
  `;
}

function renderEstimateItemCard(item) {
  if (item.candidates.length === 0) {
    return `
      <div class="estimate-card estimate-no-match">
        <div class="estimate-name">"${item.rawSegment}"</div>
        <div class="estimate-meta">No USDA match found for this item — add it manually.</div>
      </div>
    `;
  }

  const candidate = item.candidates[item.selectedIndex];
  const cals = candidate.food.per100.calories != null ? (candidate.food.per100.calories * item.grams) / 100 : null;
  const optionsHtml = item.candidates
    .map((c, i) => `<option value="${i}" ${i === item.selectedIndex ? "selected" : ""}>${c.food.name}</option>`)
    .join("");
  const unitNote = item.unitWeight != null ? ` (~${item.unitWeight}g each)` : "";

  return `
    <div class="estimate-card" data-item-id="${item.id}">
      <div class="estimate-name">"${item.rawSegment}"</div>
      <div class="estimate-item-source">Matched to${unitNote}:</div>
      <div class="estimate-item-controls">
        <select class="estimate-match-select" data-item-id="${item.id}">${optionsHtml}</select>
        <input type="number" min="1" class="estimate-grams-input" data-item-id="${item.id}" value="${item.grams}" />
        <span class="qty-unit">g</span>
      </div>
      <div class="estimate-meta">${cals != null ? formatEnergy(cals) : "no calorie data"}</div>
    </div>
  `;
}

function refreshCombinedWrap() {
  const wrap = document.getElementById("estimate-combined-wrap");
  if (wrap) wrap.innerHTML = renderCombinedEstimateSummary(currentEstimateItems);
}

function refreshItemsWrap() {
  const wrap = document.getElementById("estimate-items-wrap");
  if (!wrap) return;
  wrap.innerHTML = currentEstimateItems.map((item) => renderEstimateItemCard(item)).join("");
  wireEstimateItemControls();
}

function wireEstimateItemControls() {
  estimateResultsEl.querySelectorAll(".estimate-match-select").forEach((select) => {
    select.addEventListener("change", (e) => {
      const item = currentEstimateItems.find((i) => i.id === Number(e.target.dataset.itemId));
      if (!item) return;
      item.selectedIndex = Number(e.target.value);
      item.grams = computeEstimateItemGrams(item);
      refreshItemsWrap();
      refreshCombinedWrap();
    });
  });

  estimateResultsEl.querySelectorAll(".estimate-grams-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const item = currentEstimateItems.find((i) => i.id === Number(e.target.dataset.itemId));
      if (!item) return;
      item.grams = Math.max(0, parseFloat(e.target.value) || 0);
      refreshCombinedWrap();
    });
  });
}

function addAllEstimatesToLog() {
  let addedCount = 0;
  currentEstimateItems.forEach((item) => {
    const candidate = item.candidates[item.selectedIndex];
    if (!candidate || item.grams <= 0) return;
    addFoodEntry(candidate.food.fdcId, 1, "g", item.grams);
    addedCount += 1;
  });
  estimateInputEl.value = "";
  estimateResultsEl.innerHTML = `<p class="empty-state">Added ${addedCount} item${addedCount === 1 ? "" : "s"} to today's log — adjust quantities there if needed.</p>`;
  currentEstimateItems = [];
}

function renderMultiEstimate(items, restaurant, originalText) {
  currentEstimateItems = items;

  const noteHtml = restaurant
    ? `<p class="form-hint">No public database has specific nutrition for "${restaurant}". These are generic USDA-based estimates for each item — a reasonable starting point, not exact to that restaurant.</p>`
    : `<p class="form-hint">Rough USDA-based estimates for each item you described — a reasonable starting point, not exact.</p>`;

  const anyMatches = items.some((i) => i.candidates.length > 0);
  const manualBtnHtml = `<button id="estimate-manual-btn" class="secondary-btn full-width">${anyMatches ? "Something's wrong — enter it manually instead" : "No match found — enter it manually"}</button>`;

  if (!anyMatches) {
    estimateResultsEl.innerHTML = noteHtml + `<div id="estimate-items-wrap">${items.map(renderEstimateItemCard).join("")}</div>` + manualBtnHtml;
    wireManualFallback(originalText);
    return;
  }

  const addAllBtnHtml = `<button id="add-all-estimates-btn" class="primary-btn full-width">Add all to today's log</button>`;

  estimateResultsEl.innerHTML =
    noteHtml +
    `<div id="estimate-combined-wrap">${renderCombinedEstimateSummary(items)}</div>` +
    `<div id="estimate-items-wrap">${items.map(renderEstimateItemCard).join("")}</div>` +
    addAllBtnHtml +
    manualBtnHtml;

  wireEstimateItemControls();
  document.getElementById("add-all-estimates-btn").addEventListener("click", addAllEstimatesToLog);
  wireManualFallback(originalText);
}

function wireManualFallback(originalText) {
  const btn = document.getElementById("estimate-manual-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    switchTab("search");
    toggleSupplementForm(true, originalText);
  });
}

// ============================================================
// Meals: create, save, reuse
// ============================================================

function loadSavedMeals() {
  try {
    const raw = localStorage.getItem(MEALS_STORAGE_KEY);
    savedMeals = raw ? JSON.parse(raw) : [];
  } catch (err) {
    savedMeals = [];
  }
  savedMeals.forEach((meal) => {
    meal.ingredients.forEach((ing) => {
      if (!foodCache.has(ing.foodId)) {
        foodCache.set(ing.foodId, ing.foodSnapshot);
      }
    });
  });
}

function persistSavedMeals() {
  localStorage.setItem(MEALS_STORAGE_KEY, JSON.stringify(savedMeals));
}

function openMealBuilder(existingMeal) {
  mealBuilderIngredients = [];
  mealBuilderEntryCounter = 0;
  editingMealId = null;
  mealNameInput.value = "";

  if (existingMeal) {
    editingMealId = existingMeal.id;
    mealNameInput.value = existingMeal.name;
    existingMeal.ingredients.forEach((ing) => {
      foodCache.set(ing.foodId, ing.foodSnapshot);
      mealBuilderEntryCounter += 1;
      mealBuilderIngredients.push({ entryId: mealBuilderEntryCounter, foodId: ing.foodId, quantity: ing.quantity });
    });
  }

  mealBuilderEl.classList.remove("hidden");
  renderMealDraftList();
}

function closeMealBuilder() {
  mealBuilderEl.classList.add("hidden");
}

function addMealBuilderIngredient(foodId) {
  mealBuilderEntryCounter += 1;
  mealBuilderIngredients.push({ entryId: mealBuilderEntryCounter, foodId, quantity: 100 });
  renderMealDraftList();
}

function removeMealBuilderIngredient(entryId) {
  mealBuilderIngredients = mealBuilderIngredients.filter((i) => i.entryId !== entryId);
  renderMealDraftList();
}

function updateMealBuilderQuantity(entryId, qty) {
  const item = mealBuilderIngredients.find((i) => i.entryId === entryId);
  if (item) item.quantity = Math.max(0, qty);
}

function renderMealDraftList() {
  if (mealBuilderIngredients.length === 0) {
    mealDraftListEl.innerHTML = `<p class="empty-state">No ingredients added yet.</p>`;
    return;
  }

  mealDraftListEl.innerHTML = mealBuilderIngredients
    .map((item) => {
      const food = getFoodById(item.foodId);
      if (!food) return "";
      return `
        <div class="selected-item">
          <div class="item-info"><div class="item-name">${food.name}</div></div>
          <input type="number" class="qty-input meal-qty-input" min="0" step="10" value="${item.quantity}" data-entry-id="${item.entryId}" />
          <span class="qty-unit">g</span>
          <button class="remove-btn meal-remove-btn" data-entry-id="${item.entryId}" title="Remove">✕</button>
        </div>
      `;
    })
    .join("");

  mealDraftListEl.querySelectorAll(".meal-qty-input").forEach((input) => {
    input.addEventListener("input", (e) => updateMealBuilderQuantity(Number(e.target.dataset.entryId), parseFloat(e.target.value) || 0));
  });
  mealDraftListEl.querySelectorAll(".meal-remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => removeMealBuilderIngredient(Number(e.target.dataset.entryId)));
  });
}

function saveMealBuilder() {
  const name = mealNameInput.value.trim();
  if (!name || mealBuilderIngredients.length === 0) {
    mealNameInput.focus();
    return;
  }

  const ingredients = mealBuilderIngredients.map((item) => ({
    foodId: item.foodId,
    quantity: item.quantity,
    foodSnapshot: getFoodById(item.foodId),
  }));

  if (editingMealId) {
    const meal = savedMeals.find((m) => m.id === editingMealId);
    meal.name = name;
    meal.ingredients = ingredients;
  } else {
    savedMeals.push({ id: `meal-${Date.now()}`, name, ingredients });
  }

  persistSavedMeals();
  closeMealBuilder();
  renderSavedMealsList();
}

function deleteMeal(mealId) {
  savedMeals = savedMeals.filter((m) => m.id !== mealId);
  persistSavedMeals();
  renderSavedMealsList();
}

function addMealToLog(mealId) {
  const meal = savedMeals.find((m) => m.id === mealId);
  if (!meal) return;
  meal.ingredients.forEach((ing) => {
    foodCache.set(ing.foodId, ing.foodSnapshot);
    addFoodEntry(ing.foodId, 1, "g", ing.quantity);
  });
}

function mealTotalCalories(meal) {
  let total = 0;
  let has = false;
  meal.ingredients.forEach((ing) => {
    const cals = ing.foodSnapshot.per100.calories;
    if (cals != null) {
      total += (cals * ing.quantity) / 100;
      has = true;
    }
  });
  return has ? Math.round(total) : null;
}

function renderSavedMealsList() {
  if (savedMeals.length === 0) {
    savedMealsListEl.innerHTML = `<p class="empty-state">No saved meals yet. Create one above.</p>`;
    return;
  }

  savedMealsListEl.innerHTML = savedMeals
    .map((meal) => {
      const cals = mealTotalCalories(meal);
      const ingredientNames = meal.ingredients.map((i) => i.foodSnapshot.name).join(", ");
      return `
        <div class="meal-card">
          <div class="meal-card-header">
            <div class="meal-card-name">${meal.name}</div>
            <div class="meal-card-cals">${cals != null ? formatEnergy(cals) : ""}</div>
          </div>
          <div class="meal-card-ingredients">${ingredientNames}</div>
          <div class="meal-card-actions">
            <button class="secondary-btn add-meal-btn" data-meal-id="${meal.id}">Add to Log</button>
            <button class="secondary-btn edit-meal-btn" data-meal-id="${meal.id}">Edit</button>
            <button class="remove-btn delete-meal-btn" data-meal-id="${meal.id}" title="Delete">✕</button>
          </div>
        </div>
      `;
    })
    .join("");

  savedMealsListEl.querySelectorAll(".add-meal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => addMealToLog(e.target.dataset.mealId));
  });
  savedMealsListEl.querySelectorAll(".delete-meal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => deleteMeal(e.target.dataset.mealId));
  });
  savedMealsListEl.querySelectorAll(".edit-meal-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const meal = savedMeals.find((m) => m.id === e.target.dataset.mealId);
      if (meal) {
        switchTab("meals");
        openMealBuilder(meal);
      }
    });
  });
}

// ============================================================
// Settings: units + personalized targets
// ============================================================

function populateActivitySelect() {
  biometricActivityEl.innerHTML = Object.entries(ACTIVITY_MULTIPLIERS)
    .map(([key, info]) => `<option value="${key}" ${key === "moderate" ? "selected" : ""}>${info.label}</option>`)
    .join("");
}

function toggleSettingsPanel(show) {
  settingsPanelEl.classList.toggle("hidden", !show);
}

// Relabels the biometric inputs for the selected unit system AND converts
// whatever value is currently in each field so it keeps representing the
// same real-world weight/height — otherwise switching units silently
// reinterprets the same number in a different unit (e.g. "175" flips from
// meaning 175cm to 175in) and produces a nonsense BMR.
function updateBiometricLabels(previousSystem) {
  if (previousSystem && previousSystem !== unitSystem) {
    const rawWeight = parseFloat(biometricWeightEl.value);
    const rawHeight = parseFloat(biometricHeightEl.value);
    if (!isNaN(rawWeight)) {
      const kg = previousSystem === "imperial" ? rawWeight * KG_PER_LB : rawWeight;
      biometricWeightEl.value = kgToDisplayWeight(kg);
    }
    if (!isNaN(rawHeight)) {
      const cm = previousSystem === "imperial" ? rawHeight * CM_PER_INCH : rawHeight;
      biometricHeightEl.value = cmToDisplayHeight(cm);
    }
  }

  if (unitSystem === "imperial") {
    biometricWeightLabelEl.textContent = "Weight (lb)";
    biometricHeightLabelEl.textContent = "Height (in)";
  } else {
    biometricWeightLabelEl.textContent = "Weight (kg)";
    biometricHeightLabelEl.textContent = "Height (cm)";
  }
}

function updateTargetsHint() {
  const regionLabel = region === "australia" ? "Australian NHMRC Nutrient Reference Values" : "FDA Daily Values";
  targetsHintEl.textContent = `Macro targets are editable above. Micronutrient targets use ${regionLabel} unless you've calculated personalized targets below.`;
}

// Mifflin-St Jeor BMR -> TDEE -> a full target set: macros/fiber/sugar are
// formula-based from biometrics, micronutrients come from the selected
// region's reference table (by sex). Overwrites current targets entirely.
// General population guidance, not personalized medical/dietitian advice —
// every value stays editable afterward via the Targets form above.
function calculateAndApplyTargets() {
  const sex = biometricSexEl.value;
  const age = parseFloat(biometricAgeEl.value) || 30;
  const weightKg = displayWeightToKg(parseFloat(biometricWeightEl.value) || 0);
  const heightCm = displayHeightToCm(parseFloat(biometricHeightEl.value) || 0);
  const activityKey = biometricActivityEl.value;
  const activityMultiplier = ACTIVITY_MULTIPLIERS[activityKey].value;

  if (weightKg <= 0 || heightCm <= 0) {
    calculatedSummaryEl.textContent = "Enter a valid weight and height first.";
    return;
  }

  const bmr =
    sex === "male"
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  const calories = bmr * activityMultiplier;

  const proteinG = weightKg * 0.8; // general adult RDA/NRV, not an athletic target
  const fatG = (calories * 0.3) / 9;
  const carbsG = Math.max(0, (calories - proteinG * 4 - fatG * 9) / 4);
  const fiberG = (calories / 1000) * 14;
  const sugarG = (calories * 0.1) / 4;

  targets.calories = calories;
  targets.protein = proteinG;
  targets.fat = fatG;
  targets.carbs = carbsG;
  targets.fiber = fiberG;
  targets.sugar = sugarG;

  const microTable = REGIONAL_MICRONUTRIENTS[region][sex];
  Object.keys(microTable).forEach((key) => {
    targets[key] = microTable[key];
  });

  renderTargetsForm();
  renderAll();

  const regionLabel = region === "australia" ? "Australian NHMRC" : "USA FDA";
  calculatedSummaryEl.textContent = `Applied: ~${formatEnergy(calories)}/day (BMR ${Math.round(bmr)} kcal × ${activityMultiplier} activity), ${Math.round(proteinG)}g protein, using ${regionLabel} reference values for everything else.`;
}

// ============================================================
// Wiring
// ============================================================

function renderAll() {
  renderTotals();
  renderRatios();
  renderFlags();
}

toggleSupplementBtn.addEventListener("click", () => toggleSupplementForm(supplementFormEl.classList.contains("hidden")));
supplementCancelBtn.addEventListener("click", () => toggleSupplementForm(false));
supplementAddBtn.addEventListener("click", addSupplementEntry);
findFoodBtn.addEventListener("click", findBestNextFood);

estimateBtn.addEventListener("click", performEstimate);
estimateInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") performEstimate();
});

createMealBtn.addEventListener("click", () => openMealBuilder(null));
mealBuilderCancelBtn.addEventListener("click", closeMealBuilder);
mealBuilderSaveBtn.addEventListener("click", saveMealBuilder);

toggleSettingsBtn.addEventListener("click", () => toggleSettingsPanel(settingsPanelEl.classList.contains("hidden")));

unitSystemSelect.addEventListener("change", (e) => {
  const previousSystem = unitSystem;
  unitSystem = e.target.value;
  updateBiometricLabels(previousSystem);
  renderSelectedList();
});

energyUnitSelect.addEventListener("change", (e) => {
  energyUnit = e.target.value;
  renderTargetsForm();
  renderSelectedList();
  renderAll();
  renderSavedMealsList();
});

regionSelect.addEventListener("change", (e) => {
  region = e.target.value;
  updateTargetsHint();
});

calculateTargetsBtn.addEventListener("click", calculateAndApplyTargets);

// Search widgets
createSearchWidget({
  inputEl: searchInput,
  listEl: foodListEl,
  onSelect: (foodId) => addFoodEntry(foodId),
  placeholder: 'Start typing to search USDA FoodData Central (e.g. "chicken breast", "spinach", "salmon").',
});

createSearchWidget({
  inputEl: mealIngredientSearchInput,
  listEl: mealIngredientResultsEl,
  onSelect: (foodId) => addMealBuilderIngredient(foodId),
  placeholder: "Search for an ingredient to add to this meal.",
});

// Initial render
populateActivitySelect();
updateBiometricLabels();
updateTargetsHint();
renderSupplementFields();
renderTargetsForm();
loadSavedMeals();
renderSavedMealsList();
renderSelectedList();
renderAll();
