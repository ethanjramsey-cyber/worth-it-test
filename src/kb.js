/**
 * Knowledge-base loader for garage questions.
 *
 * Field-name variants are documented and normalised HERE only.
 * After load, every entry has the canonical shape:
 *
 *   {
 *     make: string|null,
 *     model: string,
 *     yearFrom: number,
 *     yearTo: number,
 *     engine: { raw: string, litres: number|null, cc: number|null, tokens: string[] },
 *     timingType: 'belt' | 'chain' | 'belt-in-oil' | 'none' | 'unknown',
 *     interval: { years: number|null, miles: number|null, text: string|null },
 *     knownIssues: string[],
 *     confidence: 'verified' | 'needs-Ethan-check',
 *     source: string|null,
 *     placeholder: boolean,
 *     raw: object
 *   }
 *
 * Accepted input variants (researcher files may use any of these):
 *
 *   make            — make, manufacturer, brand
 *   model           — model, modelName, name; or a combined "Ford Fiesta" in model/name
 *   years           — years: [from, to] | {from,to} | {start,end} | "2017-2020"
 *                     yearFrom/yearTo, yearStart/yearEnd, fromYear/toYear,
 *                     startYear/endYear, year_from/year_to, yearRange
 *   engine          — engine, engineSize, engine_size, engines (string or first of array),
 *                     displacement, capacity, or { size, litres, cc, name, code, label }
 *   timing type     — timingType, timing, timingDrive, belt, beltType, beltOrChain,
 *                     "belt/chain type", belt_chain, cambelt, chainType
 *   official interval — officialInterval, official_interval, interval, beltInterval,
 *                     serviceInterval, replacementInterval, "official interval"
 *                     as text, or { years, miles, kilometres, km, text, note }
 *   known issues    — knownIssues, known_issues, issues, "known issues"
 *                     string, string[], or [{note,text,issue}]
 *   confidence      — confidence, status, verification, verified
 *                     verified | needs-Ethan-check | needs_ethan_check | unverified |
 *                     pending | needs-check | true/false
 *   source          — source, sources, citation, citations, url
 *
 * Document wrappers accepted: an array, or { entries|items|records|knowledge|kb: [] }.
 *
 * Missing confidence is treated as 'needs-Ethan-check' (never shown as verified).
 */

import { normaliseMake, normaliseFuel } from './parse.js';

const CONFIDENCE_VERIFIED = new Set(['verified', 'verify', 'yes', 'true', 'ok', 'confirmed']);
const CONFIDENCE_PENDING = new Set([
  'needs-ethan-check',
  'needs_ethan_check',
  'needsethancheck',
  'needs-check',
  'needs_check',
  'unverified',
  'pending',
  'review',
  'draft',
  'placeholder',
  'false',
  'no',
]);

function pick(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
  }
  return undefined;
}

function asString(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function parseYearRange(value, obj) {
  if (Array.isArray(value) && value.length >= 2) {
    const from = Number(value[0]);
    const to = Number(value[1]);
    if (Number.isFinite(from) && Number.isFinite(to)) return { yearFrom: Math.min(from, to), yearTo: Math.max(from, to) };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const from = Number(pick(value, ['from', 'start', 'min', 'yearFrom', 'fromYear']));
    const to = Number(pick(value, ['to', 'end', 'max', 'yearTo', 'toYear']));
    if (Number.isFinite(from) && Number.isFinite(to)) return { yearFrom: Math.min(from, to), yearTo: Math.max(from, to) };
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{4})\s*[-–—/to]+\s*(\d{4})/i);
    if (m) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      return { yearFrom: Math.min(from, to), yearTo: Math.max(from, to) };
    }
    const one = value.match(/^\s*(\d{4})\s*$/);
    if (one) return { yearFrom: Number(one[1]), yearTo: Number(one[1]) };
  }
  if (obj) {
    const from = Number(pick(obj, ['yearFrom', 'year_from', 'yearStart', 'year_start', 'fromYear', 'startYear', 'start_year']));
    const to = Number(pick(obj, ['yearTo', 'year_to', 'yearEnd', 'year_end', 'toYear', 'endYear', 'end_year']));
    if (Number.isFinite(from) && Number.isFinite(to)) return { yearFrom: Math.min(from, to), yearTo: Math.max(from, to) };
    if (Number.isFinite(from) && !Number.isFinite(to)) return { yearFrom: from, yearTo: from };
  }
  return null;
}

/**
 * Pull litres / cc from a free-text engine string like "1.0 EcoBoost" or "999cc".
 */
export function parseEngineSize(raw) {
  if (raw == null || raw === '') return { raw: '', litres: null, cc: null, tokens: [] };
  const text = String(raw).trim();
  const tokens = tokeniseEngine(text);
  const ccMatch = text.match(/(\d{3,4})\s*cc\b/i);
  let cc = ccMatch ? Number(ccMatch[1]) : null;
  let litres = null;
  const litreMatch = text.match(/\b(\d(?:\.\d{1,2})?)\s*(?:l\b|litre|liter)?\b/i);
  // Prefer an explicit "1.0" / "1.0L" near the start or before a name, not a stray "4x4" etc.
  const dotted = text.match(/\b(\d\.\d{1,2})\b/);
  if (dotted) litres = Number(dotted[1]);
  else if (litreMatch && Number(litreMatch[1]) >= 0.5 && Number(litreMatch[1]) <= 8) litres = Number(litreMatch[1]);
  if (cc == null && litres != null) cc = Math.round(litres * 1000);
  if (litres == null && cc != null) litres = Math.round((cc / 1000) * 10) / 10;
  return { raw: text, litres, cc, tokens };
}

const GENERIC_ENGINE_TOKENS = new Set([
  'l', 'litre', 'litres', 'liter', 'cc', 'engine', 'petrol', 'diesel', 'hybrid',
  'phev', 'electric', 'tdi', 'tsi', 'tfsi', 'tdci', 'cdti', 'hdi', 'dci', 'gdi',
  'mpi', 'i', 'v6', 'v8', 'v4', 'turbo', 'twin', 'eco',
]);

export function tokeniseEngine(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[+/_,]/g, ' ')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.trim())
    .filter((t) => t && !GENERIC_ENGINE_TOKENS.has(t) && !/^\d+(?:\.\d+)?$/.test(t));
}

export function normaliseEngine(value) {
  if (value == null || value === '') return { raw: '', litres: null, cc: null, tokens: [] };
  if (Array.isArray(value)) return normaliseEngine(value[0]);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const litres = value > 20 ? Math.round((value / 1000) * 10) / 10 : value;
    const cc = value > 20 ? Math.round(value) : Math.round(value * 1000);
    return { raw: String(value), litres, cc, tokens: [] };
  }
  if (typeof value === 'object') {
    const raw = asString(pick(value, ['raw', 'name', 'label', 'text', 'code', 'description', 'engine']))
      || [value.size, value.litres, value.litre, value.cc, value.name, value.code].filter((x) => x != null).join(' ');
    const parsed = parseEngineSize(raw || '');
    const litres = Number(pick(value, ['litres', 'litre', 'size', 'l'])) || parsed.litres;
    const cc = Number(pick(value, ['cc', 'cm3', 'capacity'])) || parsed.cc;
    const tokens = [
      ...parsed.tokens,
      ...tokeniseEngine(asString(pick(value, ['name', 'code', 'family', 'variant'])) || ''),
    ];
    return {
      raw: raw || parsed.raw,
      litres: Number.isFinite(litres) && litres < 20 ? Number(litres) : parsed.litres,
      cc: Number.isFinite(cc) && cc >= 100 ? Number(cc) : parsed.cc,
      tokens: [...new Set(tokens)],
    };
  }
  return parseEngineSize(String(value));
}

export function normaliseTimingType(value) {
  const s = asString(value)?.toLowerCase() ?? '';
  if (!s) return 'unknown';
  if (/(wet\s*belt|belt[-\s]?in[-\s]?oil|bio|oil[-\s]?belt)/.test(s)) return 'belt-in-oil';
  if (/(timing\s*)?chain/.test(s)) return 'chain';
  if (/(cambelt|cam\s*belt|timing\s*belt|dry\s*belt|\bbelt\b)/.test(s)) return 'belt';
  if (/(none|n\/a|not\s*applicable|electric)/.test(s)) return 'none';
  return 'unknown';
}

export function normaliseInterval(value) {
  const empty = { years: null, miles: null, text: null };
  if (value == null || value === '') return empty;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const years = Number(pick(value, ['years', 'year', 'y']));
    let miles = Number(pick(value, ['miles', 'mile', 'mi']));
    const km = Number(pick(value, ['kilometres', 'kilometers', 'km']));
    if (!Number.isFinite(miles) && Number.isFinite(km)) miles = Math.round(km * 0.621371);
    const text = asString(pick(value, ['text', 'note', 'label', 'display', 'official']))
      || formatIntervalText({
        years: Number.isFinite(years) ? years : null,
        miles: Number.isFinite(miles) ? miles : null,
      });
    return {
      years: Number.isFinite(years) ? years : null,
      miles: Number.isFinite(miles) ? miles : null,
      text: text || null,
    };
  }
  const text = String(value).trim();
  const years = text.match(/(\d+(?:\.\d+)?)\s*(?:years|year|yrs|yr)\b/i);
  const miles = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:miles|mile|mls|mi)\b/i);
  const km = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*km\b/i);
  const y = years ? Number(years[1]) : null;
  let m = miles ? Number(String(miles[1]).replace(/,/g, '')) : null;
  if (m == null && km) m = Math.round(Number(String(km[1]).replace(/,/g, '')) * 0.621371);
  return { years: y, miles: m, text };
}

export function formatIntervalText(interval) {
  if (!interval) return '';
  if (interval.text && (interval.years != null || interval.miles != null) === false) return interval.text;
  const bits = [];
  if (interval.years != null) bits.push(`${interval.years} year${interval.years === 1 ? '' : 's'}`);
  if (interval.miles != null) bits.push(`${Math.round(interval.miles).toLocaleString('en-GB')} miles`);
  if (bits.length) return bits.join(' or ');
  return interval.text || '';
}

export function normaliseConfidence(value) {
  if (typeof value === 'boolean') return value ? 'verified' : 'needs-Ethan-check';
  const s = asString(value)?.toLowerCase().replace(/\s+/g, '-') ?? '';
  if (!s) return 'needs-Ethan-check';
  if (CONFIDENCE_VERIFIED.has(s)) return 'verified';
  if (CONFIDENCE_PENDING.has(s) || s.includes('ethan') || s.includes('unverified')) return 'needs-Ethan-check';
  return 'needs-Ethan-check';
}

export function normaliseIssues(value) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return asString(pick(item, ['note', 'text', 'issue', 'title', 'summary'])) || '';
      return '';
    })
    .filter(Boolean);
}

function splitMakeModel(name, makeHint) {
  const text = asString(name) || '';
  if (makeHint) return { make: asString(makeHint), model: text };
  const parts = text.split(/\s+/);
  if (parts.length >= 2) return { make: parts[0], model: parts.slice(1).join(' ') };
  return { make: null, model: text };
}

export function normaliseKbEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const makeRaw = pick(raw, ['make', 'manufacturer', 'brand']);
  const modelRaw = pick(raw, ['model', 'modelName', 'model_name', 'name']);
  const { make, model } = splitMakeModel(modelRaw, makeRaw);
  const years = parseYearRange(pick(raw, ['years', 'yearRange', 'year_range', 'year']), raw);
  const engine = normaliseEngine(
    pick(raw, ['engine', 'engineSize', 'engine_size', 'engines', 'displacement', 'capacity']),
  );
  const timingType = normaliseTimingType(
    pick(raw, [
      'timingType', 'timing_type', 'timing', 'timingDrive', 'timing_drive',
      'belt', 'beltType', 'belt_type', 'beltOrChain', 'belt_or_chain',
      'belt/chain type', 'belt_chain', 'cambelt', 'chainType', 'chain_type',
    ]),
  );
  const interval = normaliseInterval(
    pick(raw, [
      'officialInterval', 'official_interval', 'official interval',
      'interval', 'beltInterval', 'belt_interval', 'serviceInterval',
      'service_interval', 'replacementInterval', 'replacement_interval',
    ]),
  );
  const knownIssues = normaliseIssues(
    pick(raw, ['knownIssues', 'known_issues', 'known issues', 'issues']),
  );
  const confidence = normaliseConfidence(pick(raw, ['confidence', 'status', 'verification', 'verified']));
  const sourceVal = pick(raw, ['source', 'sources', 'citation', 'citations', 'url']);
  const source = Array.isArray(sourceVal)
    ? sourceVal.map(asString).filter(Boolean).join('; ')
    : asString(sourceVal);
  if (!model || !years) return null;
  return {
    make: make ? (make.charAt(0).toUpperCase() + make.slice(1)) : null,
    makeKey: make ? normaliseMake(make) : null,
    model,
    yearFrom: years.yearFrom,
    yearTo: years.yearTo,
    engine,
    timingType,
    interval,
    knownIssues,
    confidence,
    source,
    placeholder: raw.placeholder === true,
    raw,
  };
}

export function loadKb(doc) {
  if (!doc) return { placeholder: true, entries: [], note: null };
  const list = Array.isArray(doc)
    ? doc
    : pick(doc, ['entries', 'items', 'records', 'knowledge', 'kb', 'models']) || [];
  const entries = (Array.isArray(list) ? list : []).map(normaliseKbEntry).filter(Boolean);
  const placeholder = Array.isArray(doc) ? entries.every((e) => e.placeholder) : doc.placeholder === true;
  const note = !Array.isArray(doc) ? asString(doc.note) : null;
  return { placeholder, note, entries };
}

export function sizesClose(a, b) {
  if (a == null || b == null) return false;
  // 999cc vs 1.0L, 1498cc vs 1.5L, etc.
  return Math.abs(a - b) <= 80;
}

/**
 * Never-guess engine match.
 * - Listing with no engine → no match.
 * - Size must match (litres to 1 decimal, or cc within 80cc).
 * - If the KB engine has distinctive name tokens (e.g. EcoBoost), the listing
 *   string must include them. A bare "1.0" does not match "1.0 EcoBoost".
 * - If the KB engine is size-only, a listing with the same size matches.
 */
export function enginesMatch(listingEngine, kbEngine) {
  const listing = normaliseEngine(listingEngine);
  const kb = kbEngine?.raw != null || kbEngine?.litres != null ? kbEngine : normaliseEngine(kbEngine);
  if (!listing.raw && listing.litres == null && listing.cc == null) return false;
  const sizeOk = (() => {
    if (listing.litres != null && kb.litres != null) {
      if (Math.abs(listing.litres - kb.litres) < 0.05) return true;
    }
    if (listing.cc != null && kb.cc != null && sizesClose(listing.cc, kb.cc)) return true;
    return false;
  })();
  if (!sizeOk) return false;
  if (kb.tokens.length === 0) return true;
  if (listing.tokens.length === 0) return false;
  return kb.tokens.every((t) => listing.tokens.includes(t) || listing.raw.toLowerCase().includes(t));
}

export function yearsMatch(year, entry) {
  const y = Number(year);
  if (!Number.isFinite(y) || !entry) return false;
  return y >= entry.yearFrom && y <= entry.yearTo;
}

export function makeModelMatch(listing, entry) {
  const listingMake = listing.make ? normaliseMake(listing.make) : (listing.modelObj ? normaliseMake(listing.modelObj.make) : null);
  const listingModel = String(listing.model ?? listing.modelObj?.model ?? '')
    .toLowerCase()
    .replace(/[^\w-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const entryMake = entry.makeKey;
  const entryModel = String(entry.model)
    .toLowerCase()
    .replace(/[^\w-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!listingModel || !entryModel) return false;
  if (entryMake && listingMake && entryMake !== listingMake) return false;
  return listingModel === entryModel || listingModel.startsWith(`${entryModel} `) || entryModel.startsWith(`${listingModel} `);
}

/**
 * Find KB entries that match make+model+year-range+engine.
 * Unverified entries are excluded unless includeUnverified is true (review flag).
 */
export function findKbMatches(listing, kb, { includeUnverified = false } = {}) {
  const entries = Array.isArray(kb) ? kb : (kb?.entries ?? []);
  const matches = [];
  for (const entry of entries) {
    if (!makeModelMatch(listing, entry)) continue;
    if (!yearsMatch(listing.year, entry)) continue;
    if (!enginesMatch(listing.engine, entry.engine)) continue;
    if (entry.confidence !== 'verified' && !includeUnverified) continue;
    matches.push(entry);
  }
  return matches;
}

export { normaliseFuel };
