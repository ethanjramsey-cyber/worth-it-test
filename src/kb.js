/**
 * Knowledge-base loader for garage questions.
 *
 * Field-name variants are documented and normalised HERE only.
 * After load, every entry has the canonical shape:
 *
 *   {
 *     make, makeKey, model, generation,
 *     yearFrom, yearTo,
 *     engine: { raw, litres, cc, tokens, matcher, label },
 *     fuel: 'petrol'|'diesel'|... | null,
 *     fuels: Set-like string[]  (supports 'petrol/diesel', 'any'),
 *     timingType: 'belt' | 'chain' | 'belt-in-oil' | 'none' | 'unknown',
 *     timingConfidence: 'verified' | 'needs-Ethan-check',
 *     interval: { years, miles, text, confidence, note },
 *     knownIssues: [{ note, detail, confidence, source }],
 *     questions: [{ text, why, confidence, source }],
 *     confidence: entry-level (usually 'needs-Ethan-check' until Ethan signs off),
 *     reviewStatus: string|null,
 *     source, placeholder, raw
 *   }
 *
 * Showing facts to users:
 *   Do NOT use entry-level `confidence` / `reviewStatus` as the show/hide switch.
 *   Those stay 'needs-Ethan-check' until Ethan signs the whole row off.
 *   In normal mode, show only per-fact `verified` items:
 *     - timingType when timingConfidence === 'verified'
 *     - official interval when interval.confidence === 'verified'
 *     - knownIssues[i] when that issue's confidence === 'verified'
 *     - questions[i] when that question's confidence === 'verified'
 *   Everything else is hidden unless ?review=1, and then clearly badged.
 *
 * Accepted input variants (see also earlier loader notes):
 *   make, manufacturer, brand
 *   model, modelName, name
 *   years / yearFrom+yearTo / yearRange
 *   engine (short matcher, e.g. "1.0 ecoboost"), engineLabel (display),
 *     engineSize, engines, displacement, or { size, litres, cc, name, code }
 *   fuel, fuels, fuelType
 *   timingType, timingConfidence, timing, belt, cambelt, …
 *   interval / officialInterval, with optional interval.confidence
 *   knownIssues / issues: string or { issue, note, text, detail, confidence, source }
 *   questions: { text, why, confidence, source }
 *   confidence, reviewStatus
 *
 * Document wrappers accepted: a top-level array, or { entries|items|records|knowledge|kb: [] }.
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

const DIESEL_TOKENS = /\b(tdci|tdi|tdi2|hdi|bluehdi|cdti|dci|crdi|ecoblue|duratorq|skyactiv-?d|multijet|jtd|tdci)\b/i;
const PETROL_TOKENS = /\b(ecoboost|tsi|tfsi|vti|thp|tce|puretech|ti-?vct|duratec|gdi|mpi|skyactiv-?g|ecotec|multiair)\b/i;
const HYBRID_TOKENS = /\b(hybrid|mhev|ihev)\b/i;
const PHEV_TOKENS = /\b(phev|plug[-\s]?in)\b/i;

/** Tokens that signal fuel, not an engine family, for matching. */
const FUEL_ENGINE_TOKENS = new Set([
  'tdci', 'tdi', 'hdi', 'bluehdi', 'cdti', 'dci', 'crdi', 'ecoblue', 'duratorq',
  'petrol', 'diesel', 'hybrid', 'phev', 'electric', 'mhev', 'multijet',
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
  const dotted = text.match(/\b(\d\.\d{1,2})\b/);
  if (dotted) litres = Number(dotted[1]);
  else if (litreMatch && Number(litreMatch[1]) >= 0.5 && Number(litreMatch[1]) <= 8) litres = Number(litreMatch[1]);
  if (cc == null && litres != null) cc = Math.round(litres * 1000);
  if (litres == null && cc != null) litres = Math.round((cc / 1000) * 10) / 10;
  return { raw: text, litres, cc, tokens };
}

const GENERIC_ENGINE_TOKENS = new Set([
  'l', 'litre', 'litres', 'liter', 'cc', 'engine',
  'petrol', 'diesel', 'hybrid', 'phev', 'electric',
  'turbo', 'twin', 'eco', 'cyl', 'cylinder',
  'i', 'v6', 'v8', 'v4',
]);

export function tokeniseEngine(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[+/_,]/g, ' ')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.trim())
    .filter((t) => t && !GENERIC_ENGINE_TOKENS.has(t) && !/^\d+(?:\.\d+)?$/.test(t) && !FUEL_ENGINE_TOKENS.has(t));
}

export function normaliseEngine(value) {
  if (value == null || value === '') return { raw: '', litres: null, cc: null, tokens: [], matcher: '', label: '' };
  if (Array.isArray(value)) return normaliseEngine(value[0]);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const litres = value > 20 ? Math.round((value / 1000) * 10) / 10 : value;
    const cc = value > 20 ? Math.round(value) : Math.round(value * 1000);
    const raw = String(value);
    return { raw, litres, cc, tokens: [], matcher: raw.toLowerCase(), label: raw };
  }
  if (typeof value === 'object') {
    const raw = asString(pick(value, ['raw', 'matcher', 'name', 'label', 'text', 'code', 'description', 'engine']))
      || [value.size, value.litres, value.litre, value.cc, value.name, value.code].filter((x) => x != null).join(' ');
    const parsed = parseEngineSize(raw || '');
    const litres = Number(pick(value, ['litres', 'litre', 'size', 'l'])) || parsed.litres;
    const cc = Number(pick(value, ['cc', 'cm3', 'capacity'])) || parsed.cc;
    const tokens = [
      ...parsed.tokens,
      ...tokeniseEngine(asString(pick(value, ['name', 'code', 'family', 'variant', 'matcher'])) || ''),
    ];
    const matcher = (asString(pick(value, ['matcher', 'raw', 'engine'])) || parsed.raw || '').toLowerCase();
    return {
      raw: raw || parsed.raw,
      litres: Number.isFinite(litres) && litres < 20 ? Number(litres) : parsed.litres,
      cc: Number.isFinite(cc) && cc >= 100 ? Number(cc) : parsed.cc,
      tokens: [...new Set(tokens)],
      matcher,
      label: asString(pick(value, ['label', 'engineLabel'])) || raw || parsed.raw,
    };
  }
  const parsed = parseEngineSize(String(value));
  return { ...parsed, matcher: String(value).trim().toLowerCase(), label: String(value).trim() };
}

export function normaliseTimingType(value) {
  const s = asString(value)?.toLowerCase() ?? '';
  if (!s) return 'unknown';
  if (/(wet[-\s]*belt|belt[-\s]?in[-\s]?oil|bio|oil[-\s]?belt)/.test(s)) return 'belt-in-oil';
  if (/(timing\s*)?chain/.test(s)) return 'chain';
  if (/(cambelt|cam\s*belt|timing\s*belt|dry[-\s]*belt|\bbelt\b)/.test(s)) return 'belt';
  if (/(none|n\/a|not\s*applicable|electric)/.test(s)) return 'none';
  if (s === 'unknown' || s === 'unsure') return 'unknown';
  return 'unknown';
}

export function normaliseInterval(value) {
  const empty = { years: null, miles: null, text: null, confidence: 'needs-Ethan-check', note: null };
  if (value == null || value === '') return empty;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const years = Number(pick(value, ['years', 'year', 'y']));
    let miles = Number(pick(value, ['miles', 'mile', 'mi']));
    const km = Number(pick(value, ['kilometres', 'kilometers', 'km']));
    if (!Number.isFinite(miles) && Number.isFinite(km)) miles = Math.round(km * 0.621371);
    const confidence = normaliseConfidence(pick(value, ['confidence', 'status', 'verified']));
    const note = asString(pick(value, ['note', 'warning']));
    const text = asString(pick(value, ['text', 'label', 'display', 'official']))
      || formatIntervalText({
        years: Number.isFinite(years) ? years : null,
        miles: Number.isFinite(miles) ? miles : null,
      });
    return {
      years: Number.isFinite(years) ? years : null,
      miles: Number.isFinite(miles) ? miles : null,
      text: text || null,
      confidence,
      note,
    };
  }
  const text = String(value).trim();
  const years = text.match(/(\d+(?:\.\d+)?)\s*(?:years|year|yrs|yr)\b/i);
  const miles = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:miles|mile|mls|mi)\b/i);
  const km = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*km\b/i);
  const y = years ? Number(years[1]) : null;
  let m = miles ? Number(String(miles[1]).replace(/,/g, '')) : null;
  if (m == null && km) m = Math.round(Number(String(km[1]).replace(/,/g, '')) * 0.621371);
  return { years: y, miles: m, text, confidence: 'needs-Ethan-check', note: null };
}

export function formatIntervalText(interval) {
  if (!interval) return '';
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

export function isVerified(confidence) {
  return normaliseConfidence(confidence) === 'verified';
}

/**
 * TDCi / HDi / TDI (and similar) resolve to diesel so a 1.6 VTi petrol
 * listing is not matched to a 1.6 diesel row.
 */
export function inferFuelFromText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  if (PHEV_TOKENS.test(s)) return 'phev';
  if (DIESEL_TOKENS.test(s)) return 'diesel';
  if (HYBRID_TOKENS.test(s) && !/petrol/.test(s.toLowerCase())) return 'hybrid';
  const named = normaliseFuel(s);
  if (named) return named;
  if (PETROL_TOKENS.test(s)) return 'petrol';
  return null;
}

export function fuelList(fuel, engineText) {
  if (fuel == null || fuel === '') {
    const inf = inferFuelFromText(engineText);
    return inf ? [inf] : [];
  }
  const raw = String(fuel).trim().toLowerCase();
  if (raw === 'any' || raw === 'all' || raw === '*') return [];
  if (raw.includes('/')) {
    return raw.split('/').map((p) => normaliseFuel(p.trim()) || inferFuelFromText(p) || null).filter(Boolean);
  }
  const n = normaliseFuel(raw) || inferFuelFromText(raw);
  return n ? [n] : [];
}

export function fuelsMatch(listing, entry) {
  const listingFuels = fuelList(
    listing.fuel,
    typeof listing.engine === 'string' ? listing.engine : (listing.engine?.raw || listing.engine?.matcher || ''),
  );
  const entryFuels = entry.fuels || fuelList(entry.fuel, entry.engine?.matcher || entry.engine?.raw || '');
  if (!listingFuels.length || !entryFuels.length) return true;
  return listingFuels.some((f) => entryFuels.includes(f));
}

export function normaliseIssues(value) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (typeof item === 'string') {
        const note = item.trim();
        return note ? { note, detail: null, confidence: 'needs-Ethan-check', source: null } : null;
      }
      if (item && typeof item === 'object') {
        const note = asString(pick(item, ['note', 'issue', 'text', 'title', 'summary'])) || '';
        if (!note) return null;
        return {
          note,
          detail: asString(pick(item, ['detail', 'why', 'description', 'body'])) || null,
          confidence: normaliseConfidence(pick(item, ['confidence', 'status', 'verified'])),
          source: asString(Array.isArray(item.sources) ? item.sources[0] : pick(item, ['source', 'url'])) || null,
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function normaliseQuestions(value) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { text, why: null, confidence: 'needs-Ethan-check', source: null } : null;
      }
      if (item && typeof item === 'object') {
        const text = asString(pick(item, ['text', 'question', 'body'])) || '';
        if (!text) return null;
        return {
          text,
          why: asString(pick(item, ['why', 'reason', 'detail'])) || null,
          confidence: normaliseConfidence(pick(item, ['confidence', 'status', 'verified'])),
          source: asString(Array.isArray(item.sources) ? item.sources[0] : pick(item, ['source', 'url'])) || null,
        };
      }
      return null;
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
  const engineLabel = asString(pick(raw, ['engineLabel', 'engine_label', 'engineDescription'])) || engine.label;
  engine.label = engineLabel || engine.label;
  const fuelRaw = pick(raw, ['fuel', 'fuels', 'fuelType', 'fuel_type']);
  const fuels = fuelList(fuelRaw, engine.matcher || engine.raw);
  const fuel = fuels.length === 1 ? fuels[0] : (normaliseFuel(fuelRaw) || null);
  const timingType = normaliseTimingType(
    pick(raw, [
      'timingType', 'timing_type', 'timing', 'timingDrive', 'timing_drive',
      'belt', 'beltType', 'belt_type', 'beltOrChain', 'belt_or_chain',
      'belt/chain type', 'belt_chain', 'cambelt', 'chainType', 'chain_type',
    ]),
  );
  const timingConfidence = normaliseConfidence(
    pick(raw, ['timingConfidence', 'timing_confidence', 'timingVerified']),
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
  const questions = normaliseQuestions(pick(raw, ['questions', 'modelQuestions']));
  const confidence = normaliseConfidence(pick(raw, ['confidence', 'status', 'verification', 'verified']));
  const reviewStatus = asString(pick(raw, ['reviewStatus', 'review_status']));
  const sourceVal = pick(raw, ['source', 'sources', 'citation', 'citations', 'url', 'timingSource']);
  const source = Array.isArray(sourceVal)
    ? sourceVal.map(asString).filter(Boolean).join('; ')
    : asString(sourceVal);
  if (!model || !years) return null;
  return {
    make: make ? (make.charAt(0).toUpperCase() + make.slice(1)) : null,
    makeKey: make ? normaliseMake(make) : null,
    model,
    generation: asString(pick(raw, ['generation', 'gen'])) || null,
    yearFrom: years.yearFrom,
    yearTo: years.yearTo,
    engine,
    fuel,
    fuels,
    timingType,
    timingConfidence,
    interval,
    knownIssues,
    questions,
    confidence,
    reviewStatus,
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
  return Math.abs(a - b) <= 80;
}

/**
 * Engine match against the short matcher string (e.g. "1.0 ecoboost").
 * Size must match. Conflicting family tokens (EcoBoost vs Duratec) do not match.
 * A bare size like "1.0" is allowed to match all same-size rows of the same fuel;
 * callers then apply the timing-disagreement fallback. Fuel is matched separately.
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
    const lm = (listing.matcher || listing.raw || '').toLowerCase();
    const km = (kb.matcher || kb.raw || '').toLowerCase();
    if (lm && km && (lm === km || lm.includes(km) || km.includes(lm))) return true;
    return false;
  })();
  if (!sizeOk) return false;
  if (listing.tokens.length && kb.tokens.length) {
    const overlap = listing.tokens.some((t) => kb.tokens.includes(t) || (kb.matcher || '').includes(t));
    if (!overlap) return false;
  }
  return true;
}

export function yearsMatch(year, entry) {
  const y = Number(year);
  if (!Number.isFinite(y) || !entry) return false;
  return y >= entry.yearFrom && y <= entry.yearTo;
}

function normModelName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\w-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Entry model may be a platform alias ("Focus / Kuga", "MINI Hatch (Cooper)").
 */
export function makeModelMatch(listing, entry) {
  const listingMake = listing.make ? normaliseMake(listing.make) : (listing.modelObj ? normaliseMake(listing.modelObj.make) : null);
  const listingModel = normModelName(listing.model ?? listing.modelObj?.model ?? '');
  const entryMake = entry.makeKey;
  if (!listingModel) return false;
  if (entryMake && listingMake && entryMake !== listingMake) {
    // Platform rows can list two makes, e.g. "Skoda / VW / Audi"
    const entryMakes = String(entry.make || '')
      .split('/')
      .map((p) => normaliseMake(p.trim()))
      .filter(Boolean);
    if (!entryMakes.includes(listingMake) && entryMakes.length) return false;
    if (!entryMakes.length) return false;
  }
  const rawModel = String(entry.model || '');
  const candidates = rawModel
    .split('/')
    .map((part) => normModelName(part.replace(/\(.*$/, '')))
    .filter(Boolean);
  const full = normModelName(rawModel.replace(/\(.*$/, ''));
  if (full) candidates.push(full);
  return candidates.some((entryModel) => {
    if (!entryModel) return false;
    return listingModel === entryModel
      || listingModel.startsWith(`${entryModel} `)
      || entryModel.startsWith(`${listingModel} `)
      || entryModel.includes(listingModel)
      || listingModel.includes(entryModel);
  });
}

/**
 * Prefer rows whose family tokens appear in the listing (e.g. "1.0 EcoBoost"
 * keeps the EcoBoost row and drops a bare "1.0" petrol row if both matched).
 */
export function refineEngineMatches(listing, matches) {
  const tokens = normaliseEngine(listing.engine).tokens;
  if (!tokens.length || matches.length < 2) return matches;
  const specific = matches.filter((m) => {
    const kt = m.engine?.tokens || [];
    return kt.length && tokens.some((t) => kt.includes(t) || (m.engine?.matcher || '').includes(t));
  });
  return specific.length ? specific : matches;
}

/**
 * True when matched rows disagree on a known timing type
 * (e.g. 2014 Polo 1.2 chain vs belt). Unknowns are ignored.
 */
export function timingTypesConflict(matches) {
  const types = new Set(
    (matches || []).map((m) => m.timingType).filter((t) => t && t !== 'unknown'),
  );
  return types.size > 1;
}

/**
 * Find KB rows that match make + model + year-range + engine + fuel.
 * Entry-level confidence is ignored (it stays 'needs-Ethan-check' until Ethan
 * signs the row off). Callers filter individual facts by per-fact confidence.
 */
export function findKbMatches(listing, kb, { includeUnverified = true } = {}) {
  const entries = Array.isArray(kb) ? kb : (kb?.entries ?? []);
  const matches = [];
  for (const entry of entries) {
    if (!makeModelMatch(listing, entry)) continue;
    if (!yearsMatch(listing.year, entry)) continue;
    if (!enginesMatch(listing.engine, entry.engine)) continue;
    if (!fuelsMatch(listing, entry)) continue;
    // includeUnverified kept for backward compat; entry-level confidence is
    // not used as a gate. Review mode still exists for per-fact filtering.
    if (!includeUnverified && entry.confidence === 'verified' && !entry.questions?.length && !entry.knownIssues?.length) {
      // no-op; we always include identity matches
    }
    matches.push(entry);
  }
  return refineEngineMatches(listing, matches);
}

export { normaliseFuel };
