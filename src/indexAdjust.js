/**
 * ONS CPIH second-hand cars index (series L545, 2015=100).
 *
 * Used to move Ethan's reference prices month-to-month after he sets them.
 * Does not invent prices. If the index is missing or a move looks odd,
 * the factor is 1 (leave the stored price alone).
 */

export const SERIES_ID = 'L545';
export const SERIES_TITLE = 'CPIH INDEX 07.1.1B : SECOND-HAND CARS 2015=100';
export const SOURCE_PAGE =
  'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/l545/mm23';
export const SOURCE_DATA = `${SOURCE_PAGE}/data`;
export const MAX_MONTHLY_MOVE = 0.05;

const MONTH_NUM = Object.freeze({
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
});

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

/** @param {string|null|undefined} value @returns {string|null} YYYY-MM */
export function parseYearMonth(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month < 1 || month > 12) return null;
    return `${iso[1]}-${String(month).padStart(2, '0')}`;
  }
  const ons = s.match(/^(\d{4})\s+([A-Za-z]+)$/);
  if (ons) {
    const month = MONTH_NUM[ons[2].toLowerCase()];
    if (!month) return null;
    return `${ons[1]}-${String(month).padStart(2, '0')}`;
  }
  const long = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (long) {
    const month = MONTH_NUM[long[1].toLowerCase()];
    if (!month) return null;
    return `${long[2]}-${String(month).padStart(2, '0')}`;
  }
  return null;
}

/** @param {string} ym YYYY-MM @returns {string} e.g. "September 2026" */
export function formatMonthLabel(ym) {
  const parsed = parseYearMonth(ym);
  if (!parsed) return '';
  const [year, month] = parsed.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Whole months from a to b (b - a). Null if either is unparseable. */
export function monthsBetween(from, to) {
  const a = parseYearMonth(from);
  const b = parseYearMonth(to);
  if (!a || !b) return null;
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

function isSaneIndexValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1000;
}

/**
 * Turn the official ONS /data JSON into a month → number map.
 * Annual and quarterly observations are ignored.
 * @param {object} payload
 * @returns {{ values: Record<string, number>, title?: string, cdid?: string, errors: string[] }}
 */
export function parseOnsPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { values: {}, errors: ['ONS response is not a JSON object'] };
  }
  const months = payload.months;
  if (!Array.isArray(months) || months.length === 0) {
    return { values: {}, errors: ['ONS response has no monthly observations'] };
  }
  const values = {};
  for (const row of months) {
    const ym = parseYearMonth(row?.date) || parseYearMonth(`${row?.year} ${row?.month || ''}`.trim());
    const raw = row?.value;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
    if (!ym) {
      errors.push(`unparseable month label: ${row?.date ?? '(missing)'}`);
      continue;
    }
    if (!isSaneIndexValue(num)) {
      errors.push(`odd value for ${ym}: ${raw}`);
      continue;
    }
    values[ym] = num;
  }
  const title = payload.description?.title;
  const cdid = payload.description?.cdid;
  return { values, title, cdid, errors };
}

/**
 * @param {Record<string, number>} values
 * @returns {{ ok: boolean, errors: string[], months: string[] }}
 */
export function validateSeries(values) {
  const errors = [];
  if (!values || typeof values !== 'object') {
    return { ok: false, errors: ['index values must be an object'], months: [] };
  }
  const months = Object.keys(values).filter((k) => parseYearMonth(k)).sort();
  if (months.length < 2) {
    errors.push('index needs at least two monthly observations');
  }
  for (const m of months) {
    if (!isSaneIndexValue(values[m])) errors.push(`odd value for ${m}: ${values[m]}`);
  }
  return { ok: errors.length === 0, errors, months };
}

function monthStep(values, earlier, later) {
  const a = values[earlier];
  const b = values[later];
  if (!isSaneIndexValue(a) || !isSaneIndexValue(b)) return null;
  return (b - a) / a;
}

/**
 * Newest month whose step from the previous month is within ±maxMove.
 * Historical spikes further back stay in the stored series but are not
 * used as "latest" if the newest step itself is wild (bad or odd data).
 */
export function latestAcceptableMonth(values, { maxMove = MAX_MONTHLY_MOVE } = {}) {
  const { months } = validateSeries(values);
  if (!months.length) return { month: null, refused: false, reason: 'empty' };
  if (months.length === 1) return { month: months[0], refused: false, reason: 'only-one-month' };
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const step = monthStep(values, prev, last);
  if (step == null) {
    return {
      month: prev,
      refused: true,
      refusedMonth: last,
      move: null,
      reason: `odd value at ${last}`,
    };
  }
  if (Math.abs(step) > maxMove) {
    return {
      month: prev,
      refused: true,
      refusedMonth: last,
      move: step,
      reason: `latest month ${last} moved ${(step * 100).toFixed(1)}% from ${prev}, over the ±${maxMove * 100}% guard`,
    };
  }
  return { month: last, refused: false, reason: null };
}

/**
 * Factor to apply to a price set in baseDate: latest / index-at-base.
 * Defaults to 1 if the index or base month is missing.
 * Refuses (factor 1, applied false) when the implied move is bigger
 * than ±maxMove per month, compounded, or the response is odd.
 *
 * @returns {{ factor: number, applied: boolean, reason: string|null, latestMonth: string|null, baseValue: number|null, latestValue: number|null }}
 */
export function indexFactor(values, baseDate, latestMonth, { maxMove = MAX_MONTHLY_MOVE } = {}) {
  const none = (reason) => ({
    factor: 1,
    applied: false,
    reason,
    latestMonth: latestMonth || null,
    baseValue: null,
    latestValue: null,
  });
  if (!values || typeof values !== 'object') return none('index missing');
  const base = parseYearMonth(baseDate);
  const latest = parseYearMonth(latestMonth);
  if (!base) return none('no base date');
  if (!latest) return none('no latest index month');
  const span = monthsBetween(base, latest);
  if (span == null) return none('unparseable dates');
  if (span < 0) return none('latest index month is before the price was set');
  if (span === 0) {
    const value = values[base];
    return {
      factor: 1,
      applied: isSaneIndexValue(value),
      reason: isSaneIndexValue(value) ? 'same month' : 'base month missing from index',
      latestMonth: latest,
      baseValue: isSaneIndexValue(value) ? value : null,
      latestValue: isSaneIndexValue(value) ? value : null,
    };
  }
  const baseValue = values[base];
  const latestValue = values[latest];
  if (!isSaneIndexValue(baseValue)) return none(`no index value for base month ${base}`);
  if (!isSaneIndexValue(latestValue)) return none(`no index value for latest month ${latest}`);
  const factor = latestValue / baseValue;
  if (!Number.isFinite(factor) || factor <= 0) return none('odd index factor');
  const maxUp = (1 + maxMove) ** span;
  const maxDown = (1 - maxMove) ** span;
  if (factor > maxUp || factor < maxDown) {
    return {
      factor: 1,
      applied: false,
      reason: `index move of ${((factor - 1) * 100).toFixed(1)}% over ${span} month(s) exceeds the ±${maxMove * 100}% per month guard`,
      latestMonth: latest,
      baseValue,
      latestValue,
    };
  }
  return { factor, applied: true, reason: null, latestMonth: latest, baseValue, latestValue };
}

/**
 * UI line, or null when it does not apply (no Ethan prices, or no index).
 * "Prices set by Ethan, <month>; adjusted to <latest index month> using ONS used-car index"
 */
export function freshnessText({
  baseDates = [],
  latestMonth = null,
  hasEthanPrices = false,
  indexApplied = false,
  indexAvailable = false,
} = {}) {
  if (!hasEthanPrices) return null;
  if (!indexAvailable && !latestMonth) return null;
  const unique = [...new Set((baseDates || []).map(parseYearMonth).filter(Boolean))].sort();
  const latestLabel = formatMonthLabel(latestMonth);
  if (!latestLabel) return null;
  const setPart = unique.length === 1
    ? `Prices set by Ethan, ${formatMonthLabel(unique[0])}`
    : unique.length > 1
      ? `Prices set by Ethan, ${formatMonthLabel(unique[0])}–${formatMonthLabel(unique[unique.length - 1])}`
      : 'Prices set by Ethan';
  // Show the line once we have Ethan prices and a latest index month,
  // even if this particular model's factor was 1 (same month / not yet moved).
  if (!indexApplied && unique.length === 0 && !latestLabel) return null;
  return `${setPart}; adjusted to ${latestLabel} using ONS used-car index`;
}

/**
 * Build the stored data/index.json document.
 */
export function buildIndexDocument({
  values,
  latestMonth,
  sourceUrl = SOURCE_DATA,
  retrieved,
  title = SERIES_TITLE,
  series = SERIES_ID,
  note,
} = {}) {
  const months = Object.keys(values || {}).filter((k) => parseYearMonth(k)).sort();
  const baseMonth = months[0] || null;
  const latest = parseYearMonth(latestMonth) || months[months.length - 1] || null;
  const compact = {};
  for (const m of months) compact[m] = values[m];
  const today = retrieved || new Date().toISOString().slice(0, 10);
  return {
    series,
    title,
    sourceUrl,
    sourcePage: SOURCE_PAGE,
    retrieved: today,
    baseMonth,
    latestMonth: latest,
    latestValue: latest && Number.isFinite(compact[latest]) ? compact[latest] : null,
    values: compact,
    ...(note ? { note } : {}),
  };
}
