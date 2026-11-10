/**
 * Value score logic for Worth It? (pure functions, no DOM).
 *
 * Expected price (v1, explainable):
 *   expected = refPrice × ageFactor × mileageFactor
 *   ageFactor     = clamp(ageFloor, ageCeiling, (1 - annualDecay) ** (age - refAge))
 *   mileageFactor = clamp(milesFloor, milesCeiling,
 *                         1 + per10kMilesAdj × (mileage - refMiles) / 10_000)
 *
 * Age is calendar-year difference: now.year - registration year.
 * Fuel is accepted for a stable API but does not change the price in v1.
 *
 * Value score (0–100, 50 = fair):
 *   score = clamp(0, 100, 50 + 250 × (expected - asking) / expected)
 *   Each 1% under expected adds 2.5 points; each 1% over subtracts 2.5.
 *   20% under → 100; 20% over → 0.
 *
 * Verdicts, tied to the ±8% fair-price range:
 *   Bargain     score >= 80   (≥12% under expected)
 *   Good        score >= 70   (≥8% under, i.e. below the fair range)
 *   Fair        score >= 30   (within ±8%)
 *   Overpriced  score <  30   (>8% over)
 *
 * Fair range is expected ±8%, rounded to the nearest £50 (or £100 if mid ≥ £8,000).
 */

export const CONFIG = Object.freeze({
  appName: 'Worth It?',
  fairRangePct: 0.08,
  score: Object.freeze({
    fair: 50,
    pointsPerRatio: 250,
    min: 0,
    max: 100,
  }),
  verdicts: Object.freeze([
    Object.freeze({
      id: 'bargain',
      minScore: 80,
      label: 'Bargain',
      tone: 'positive',
      taglines: Object.freeze([
        'Nice one.',
        'Get in.',
        "That'll fly.",
        "Don't hang about.",
      ]),
    }),
    Object.freeze({
      id: 'good',
      minScore: 70,
      label: 'Good',
      tone: 'positive-soft',
      taglines: Object.freeze([
        'Worth a look.',
        'Solid, that.',
        'Decent buy.',
        'You could do worse.',
      ]),
    }),
    Object.freeze({
      id: 'fair',
      minScore: 30,
      label: 'Fair',
      tone: 'neutral',
      taglines: Object.freeze([
        'About right.',
        'Fair enough.',
        'Nothing cheeky either way.',
        'Pays its way.',
      ]),
    }),
    Object.freeze({
      id: 'overpriced',
      minScore: 0,
      label: 'Overpriced',
      tone: 'warning',
      taglines: Object.freeze([
        'Walk away.',
        'Haggle hard.',
        "They're having a laugh.",
        'Not at that money.',
      ]),
    }),
  ]),
  money: Object.freeze({
    lowStep: 50,
    highStep: 100,
    highFrom: 8000,
  }),
  closeEnoughGbp: 50,
});

export function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

/** Calendar-year age; month of registration is not in the v1 form. */
export function ageYears(year, now = new Date()) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  return now.getFullYear() - y;
}

export function ageFactor(curve, age, refAge = 3) {
  const decay = Number(curve.annualDecay);
  const factor = (1 - decay) ** (age - refAge);
  return clamp(curve.ageFloor, curve.ageCeiling, factor);
}

export function mileageFactor(curve, mileage, refMiles = 30000) {
  const adj = Number(curve.per10kMilesAdj);
  const factor = 1 + adj * (Number(mileage) - refMiles) / 10000;
  return clamp(curve.milesFloor, curve.milesCeiling, factor);
}

/**
 * @param {object} model - row from models.json
 * @param {number} year
 * @param {number} mileage
 * @param {string} [_fuel] - unused in v1 price math
 * @param {Date} [now]
 * @param {object} curve - row from segments.json
 * @returns {number|null}
 */
export function expectedPrice(model, year, mileage, _fuel, now = new Date(), curve) {
  if (!model || !curve) return null;
  const age = ageYears(year, now);
  if (age === null || age < 0 || age > 80) return null;
  const miles = Number(mileage);
  if (!Number.isFinite(miles) || miles < 0) return null;
  const ref = Number(model.refPrice);
  if (!Number.isFinite(ref) || ref <= 0) return null;
  const refAge = model.refAge ?? 3;
  const refMiles = model.refMiles ?? 30000;
  const price = ref * ageFactor(curve, age, refAge) * mileageFactor(curve, miles, refMiles);
  return price > 0 && Number.isFinite(price) ? price : null;
}

export function moneyStep(value) {
  return value >= CONFIG.money.highFrom ? CONFIG.money.highStep : CONFIG.money.lowStep;
}

export function roundMoney(value) {
  const step = moneyStep(value);
  return Math.round(value / step) * step;
}

/**
 * Fair price range around expected, ± fairRangePct, rounded.
 * If rounding collapses the bounds, widen by one step.
 */
export function fairPriceRange(expected) {
  if (!Number.isFinite(expected) || expected <= 0) return null;
  const pct = CONFIG.fairRangePct;
  let low = roundMoney(expected * (1 - pct));
  let high = roundMoney(expected * (1 + pct));
  const step = moneyStep(expected);
  if (high <= low) {
    low = Math.max(0, low - step);
    high = high + step;
  }
  return { low, high, mid: roundMoney(expected) };
}

/**
 * 50 = asking equals expected. Higher asking → lower score. Capped 0–100.
 */
export function valueScore(asking, expected) {
  const a = Number(asking);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e) || e <= 0 || a < 0) return null;
  const raw = CONFIG.score.fair + CONFIG.score.pointsPerRatio * ((e - a) / e);
  return clamp(CONFIG.score.min, CONFIG.score.max, raw);
}

export function verdictFromScore(score) {
  if (!Number.isFinite(score)) return null;
  for (const v of CONFIG.verdicts) {
    if (score >= v.minScore) return v;
  }
  return CONFIG.verdicts[CONFIG.verdicts.length - 1];
}

export function getVerdictById(id) {
  return CONFIG.verdicts.find((v) => v.id === id) ?? null;
}

export function taglinesFor(verdictOrId) {
  const v = typeof verdictOrId === 'string' ? getVerdictById(verdictOrId) : verdictOrId;
  return v?.taglines ? [...v.taglines] : [];
}

export function daysSinceEpoch(date = new Date()) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/**
 * Rotate taglines. Pass an explicit index/seed for tests; the UI uses the
 * UTC day number so the same verdict shows the same line that day.
 */
export function pickTagline(verdictOrId, seed = daysSinceEpoch()) {
  const lines = taglinesFor(verdictOrId);
  if (!lines.length) return '';
  const n = Number(seed);
  const idx = ((Number.isFinite(n) ? n : 0) % lines.length + lines.length) % lines.length;
  return lines[idx];
}

export function formatGbp(value, { pence = false } = {}) {
  if (!Number.isFinite(value)) return '';
  const n = pence ? value : Math.round(value);
  return `£${n.toLocaleString('en-GB', {
    maximumFractionDigits: pence ? 2 : 0,
    minimumFractionDigits: 0,
  })}`;
}

export function formatMiles(value) {
  if (!Number.isFinite(value)) return '';
  return `${Math.round(value).toLocaleString('en-GB')} miles`;
}

export function deltaAmount(asking, expected) {
  if (!Number.isFinite(asking) || !Number.isFinite(expected)) return null;
  return asking - expected;
}

/**
 * "about £1,200 under" / "about £800 over" / "about on the money"
 */
export function deltaText(asking, expected) {
  const delta = deltaAmount(asking, expected);
  if (delta === null) return '';
  const rounded = roundMoney(Math.abs(delta));
  if (rounded <= CONFIG.closeEnoughGbp || Math.abs(delta) <= CONFIG.closeEnoughGbp) {
    return 'about on the money';
  }
  const amount = formatGbp(rounded);
  if (delta > 0) return `about ${amount} over`;
  return `about ${amount} under`;
}

export function formatFairRange(range) {
  if (!range) return '';
  return `typically ${formatGbp(range.low)}–${formatGbp(range.high)}`;
}

/**
 * Convenience bundle for the checker UI.
 */
export function checkListing({ model, year, mileage, fuel, asking, now = new Date(), curve }) {
  const expected = expectedPrice(model, year, mileage, fuel, now, curve);
  if (expected === null) return null;
  const askingN = Number(asking);
  if (!Number.isFinite(askingN) || askingN < 0) return null;
  const score = valueScore(askingN, expected);
  const verdict = verdictFromScore(score);
  const range = fairPriceRange(expected);
  return {
    expected,
    score,
    verdict,
    tagline: pickTagline(verdict, daysSinceEpoch(now)),
    range,
    rangeText: formatFairRange(range),
    delta: deltaAmount(askingN, expected),
    deltaText: deltaText(askingN, expected),
    asking: askingN,
  };
}
