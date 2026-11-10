/**
 * Best-value ranking for Worth It?
 *
 * Method (simple and explainable):
 *   For each model in the dataset that matches the user's body type and fuel
 *   filters, build a typical example car inside their max age and max mileage:
 *     typicalAge  = the lesser of the model's reference age (3 years) and maxAge
 *     typicalMiles = the lesser of the model's reference mileage (30,000),
 *                    the user's max mileage, and 8,000 miles × typicalAge
 *     year        = now.year − typicalAge
 *     fuel        = the requested fuel if the model offers it, else skipped
 *   We then estimate a fair price for that example (same expectedPrice curve
 *   as the checker, including any index the caller passes).
 *
 *   Models whose typical fair price is above the budget are dropped
 *   (you couldn't buy a typical one for that money).
 *   The rest are ranked by how much car the budget buys: highest typical
 *   fair price first (the most substantial typical example you can afford).
 *   Ties break on the tighter leftover (budget − expected).
 *
 *   These are estimates. Every placeholder model is flagged on the result.
 *   An empty set is a valid outcome when nothing in the seed fits.
 */

import { expectedPrice, fairPriceRange, formatGbp, formatMiles, ageYears } from './score.js';

export const TYPICAL_MILES_PER_YEAR = 8000;

export function typicalExample(model, { maxAge, maxMileage, fuel, now = new Date() } = {}) {
  const refAge = Number(model.refAge) || 3;
  const refMiles = Number(model.refMiles) || 30000;
  const capAge = Number.isFinite(Number(maxAge)) ? Number(maxAge) : refAge;
  if (capAge < 0) return null;
  const age = Math.min(refAge, capAge);
  const capMiles = Number.isFinite(Number(maxMileage)) ? Number(maxMileage) : refMiles;
  if (capMiles < 0) return null;
  const miles = Math.min(refMiles, capMiles, Math.max(0, Math.round(age * TYPICAL_MILES_PER_YEAR)));
  const year = now.getFullYear() - age;
  const pickedFuel = pickFuel(model, fuel);
  if (fuel && !pickedFuel) return null;
  return {
    age,
    year,
    mileage: miles,
    fuel: pickedFuel || (model.fuels && model.fuels[0]) || null,
  };
}

function pickFuel(model, fuel) {
  if (!fuel) return (model.fuels && model.fuels[0]) || null;
  const want = String(fuel).toLowerCase();
  if (Array.isArray(model.fuels) && model.fuels.some((f) => f === want)) return want;
  return null;
}

function bodyMatches(model, bodyType) {
  if (!bodyType) return true;
  const want = String(bodyType).toLowerCase().trim();
  const have = String(model.bodyType || '').toLowerCase();
  const segment = String(model.segment || '').toLowerCase();
  if (have === want || segment === want) return true;
  if (want === 'hatch' && (have === 'hatchback' || segment === 'hatch' || segment === 'supermini' || segment === 'family')) return true;
  if (want === 'hatchback' && (have === 'hatchback' || segment === 'hatch' || segment === 'supermini')) return true;
  return false;
}

/**
 * @param {object} filters  { budget, bodyType, maxMileage, maxAge, fuel }
 * @param {object} ctx      { models, segmentsById|segments, now, index, limit }
 */
export function rankBestValue(filters, ctx = {}) {
  const budget = Number(filters.budget);
  const models = ctx.models || [];
  const now = ctx.now || new Date();
  const index = ctx.index ?? null;
  const limit = ctx.limit ?? 5;
  const segmentsById = ctx.segmentsById
    || new Map((ctx.segments || []).map((s) => [s.id, s]));

  const errors = [];
  if (!Number.isFinite(budget) || budget <= 0) errors.push('Need a budget to rank against.');
  if (errors.length) return { ok: false, errors, items: [], method: methodText() };

  const items = [];
  for (const model of models) {
    if (!bodyMatches(model, filters.bodyType)) continue;
    const example = typicalExample(model, {
      maxAge: filters.maxAge,
      maxMileage: filters.maxMileage,
      fuel: filters.fuel,
      now,
    });
    if (!example) continue;
    const curve = segmentsById.get(model.curveId);
    if (!curve) continue;
    const expected = expectedPrice(model, example.year, example.mileage, example.fuel, now, curve, index);
    if (!Number.isFinite(expected) || expected <= 0) continue;
    if (expected > budget) continue;
    const leftover = budget - expected;
    items.push({
      model,
      example,
      expected,
      leftover,
      range: fairPriceRange(expected),
      placeholder: model.placeholder === true,
      // "How much car the budget buys" — higher expected (still affordable) ranks first.
      carForBudget: expected,
    });
  }

  items.sort((a, b) => b.carForBudget - a.carForBudget || a.leftover - b.leftover || a.model.id.localeCompare(b.model.id));
  const top = items.slice(0, limit);
  return {
    ok: true,
    errors: [],
    items: top,
    droppedOverBudget: items.length === 0 && models.length > 0,
    totalAffordable: items.length,
    method: methodText(),
  };
}

export function methodText() {
  return 'Typical example of each model (usually 3 years / 30,000 miles, or your tighter limits, at about 8,000 miles a year). Dearer-than-budget models are dropped; the rest are ranked by the most car your budget still buys. Estimates only; placeholder models are flagged.';
}

export function formatBestValueLine(item) {
  const car = `${item.model.make} ${item.model.model}`;
  const bits = [
    `${item.example.year}`,
    formatMiles(item.example.mileage),
    item.example.fuel,
  ].filter(Boolean);
  return `${car} — typical ${bits.join(', ')}. Fair price about ${formatGbp(item.expected)}.`;
}
