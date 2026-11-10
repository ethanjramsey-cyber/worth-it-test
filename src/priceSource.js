/**
 * Price source seam for Worth It?
 *
 * Default source: 'static' — Ethan's reference prices in data/models.json,
 * optionally moved month-to-month with the free ONS CPIH second-hand cars
 * index (series L545). See src/indexAdjust.js and data/index.json.
 *
 * A live lookup such as Vehicle Data Global (VDG) may be plugged in later
 * behind the PRICE_SOURCE flag. Do not implement VDG here. A future source
 * should satisfy the same getReference() contract below and be selected
 * only when PRICE_SOURCE is set to that id (e.g. 'vdg'). The default must
 * remain 'static' so the app never depends on a paid feed.
 *
 * Interface a source must satisfy:
 *
 *   getReference(model, context) → ReferencePrice
 *
 *   ReferencePrice = {
 *     refPrice: number | null,   // figure to use in expectedPrice (index-adjusted when applied)
 *     basePrice: number | null,  // Ethan's figure at baseDate, before the index
 *     placeholder: boolean,      // true until Ethan has set a price for this model
 *     confident: boolean,        // false for placeholder, missing, or refused data
 *     source: string,            // 'static' today; a live source would use its own id
 *     baseDate: string | null,   // YYYY-MM, when the stored price was set
 *     indexFactor: number,       // 1 when the index is not applied
 *     indexApplied: boolean,
 *     freshness: string | null,  // UI line, or null when not applicable
 *     caution: string | null,    // loud warning when the score must not look confident
 *   }
 *
 * listModels / the dataset itself stay in data/models.json for the static
 * source. A live source could later wrap or replace that catalogue.
 */

import {
  freshnessText,
  indexFactor,
  parseYearMonth,
} from './indexAdjust.js';

/** Flip this to a live source id only when that source is actually wired in. */
export const PRICE_SOURCE = 'static';

export const PLACEHOLDER_CAUTION =
  'Indicative only — this reference price is a placeholder, not a figure Ethan has checked. Do not treat the score as a confident verdict.';

export const MISSING_PRICE_CAUTION =
  'No checked reference price for this model yet, so it cannot be scored.';

/**
 * @param {object|null} model  a row from models.json
 * @param {object} [context]
 * @param {object} [context.index]  parsed data/index.json (or equivalent)
 * @param {string} [context.source]  override, defaults to PRICE_SOURCE
 * @returns {object} ReferencePrice
 */
export function getReference(model, { index = null, source = PRICE_SOURCE } = {}) {
  // Future: if (source === 'vdg') return getVdgReference(model, { index });
  if (source !== 'static') {
    // Unknown flag — never invent a price, never quietly fall through as confident.
    return {
      refPrice: null,
      basePrice: null,
      placeholder: true,
      confident: false,
      source,
      baseDate: null,
      indexFactor: 1,
      indexApplied: false,
      freshness: null,
      caution: `Price source "${source}" is not available. Using no price rather than guessing.`,
    };
  }
  return getStaticReference(model, { index });
}

export function isPlaceholderModel(model) {
  if (!model) return true;
  if (model.placeholder === true) return true;
  if (model.ethanChecked === true && model.placeholder === false) return false;
  // Unchecked rows, or missing flags, are not confident.
  return model.placeholder !== false;
}

export function getStaticReference(model, { index = null } = {}) {
  const placeholder = isPlaceholderModel(model);
  const basePriceRaw = model ? Number(model.refPrice) : NaN;
  const hasBase = Number.isFinite(basePriceRaw) && basePriceRaw > 0;
  const basePrice = hasBase ? basePriceRaw : null;
  const baseDate = parseYearMonth(model?.baseDate) || null;

  const indexValues = index?.values || null;
  const latestMonth = index?.latestMonth || null;
  const indexAvailable = !!(indexValues && latestMonth);

  if (placeholder) {
    return {
      refPrice: basePrice,
      basePrice,
      placeholder: true,
      confident: false,
      source: 'static',
      baseDate,
      indexFactor: 1,
      indexApplied: false,
      freshness: null,
      caution: hasBase ? PLACEHOLDER_CAUTION : MISSING_PRICE_CAUTION,
    };
  }

  if (!hasBase) {
    return {
      refPrice: null,
      basePrice: null,
      placeholder: false,
      confident: false,
      source: 'static',
      baseDate,
      indexFactor: 1,
      indexApplied: false,
      freshness: indexAvailable
        ? freshnessText({
          baseDates: baseDate ? [baseDate] : [],
          latestMonth,
          hasEthanPrices: true,
          indexApplied: false,
          indexAvailable: true,
        })
        : null,
      caution: MISSING_PRICE_CAUTION,
    };
  }

  const adj = indexAvailable
    ? indexFactor(indexValues, baseDate, latestMonth)
    : { factor: 1, applied: false, reason: indexAvailable ? null : 'index missing', latestMonth };

  const factor = adj.applied ? adj.factor : 1;
  const refPrice = basePrice * factor;
  const freshness = freshnessText({
    baseDates: baseDate ? [baseDate] : [],
    latestMonth,
    hasEthanPrices: true,
    indexApplied: adj.applied,
    indexAvailable,
  });

  return {
    refPrice,
    basePrice,
    placeholder: false,
    confident: true,
    source: 'static',
    baseDate,
    indexFactor: factor,
    indexApplied: adj.applied,
    freshness,
    caution: null,
  };
}

/**
 * Dataset-level freshness line for the header, or null when it does not apply.
 * Shown when at least one model has been set by Ethan and an index is loaded.
 */
export function datasetFreshness(models, index) {
  const list = Array.isArray(models) ? models : [];
  const checked = list.filter((m) => m && m.placeholder === false && m.ethanChecked === true);
  if (!checked.length) return null;
  const latestMonth = index?.latestMonth || null;
  if (!latestMonth || !index?.values) return null;
  return freshnessText({
    baseDates: checked.map((m) => m.baseDate).filter(Boolean),
    latestMonth,
    hasEthanPrices: true,
    indexApplied: true,
    indexAvailable: true,
  });
}

export function datasetHasPlaceholders(models) {
  const list = Array.isArray(models) ? models : [];
  if (!list.length) return true;
  return list.some((m) => isPlaceholderModel(m));
}
