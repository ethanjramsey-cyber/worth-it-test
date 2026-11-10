/**
 * Confirm-screen helpers: which fields were filled, from where, and which
 * still need the user. Unknowns stay blank — never guessed.
 */

export const CONFIRM_FIELDS = [
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'year', label: 'Year' },
  { key: 'mileage', label: 'Mileage' },
  { key: 'engine', label: 'Engine' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'gearbox', label: 'Gearbox' },
  { key: 'price', label: 'Asking price' },
];

export const LOW_CONFIDENCE = 0.7;

const SOURCE_LABELS = {
  'json-ld': 'JSON-LD on the page',
  'page-state': 'the page’s embedded data',
  opengraph: 'the page’s preview tags',
  meta: 'the page’s description',
  title: 'the page title',
  microdata: 'page markup',
  'data-attr': 'page attributes',
  'pasted-text': 'the pasted listing text',
  bookmarklet: 'the bookmarklet on the listing page',
  'url-params': 'the link you opened',
  import: 'the imported listing',
  ai: 'an AI reading',
  'ai-pasted-text': 'AI read of your pasted text',
  'ai-screenshot': 'AI read of your screenshot',
  'page-text': 'the page’s visible text',
  'dvla-ves': 'the official DVLA record',
  'dvsa-mot': 'the official MOT history',
  'mot-odometer': 'the last MOT mileage',
  plate: 'the official vehicle record',
};

export function sourceLabel(source) {
  if (!source) return null;
  return SOURCE_LABELS[source] || source;
}

export function isFilled(value) {
  return value != null && value !== '';
}

/**
 * Normalise either an extractListing-style `fields` map or a flat extracted
 * object into per-field status records.
 *
 * @param {object} input
 * @param {{ defaultSource?: string, defaultConfidence?: number }} [opts]
 */
export function fieldStatuses(input = {}, opts = {}) {
  const defaultSource = opts.defaultSource || input.source || null;
  const defaultConfidence = opts.defaultConfidence ?? (input.confidence ?? 0.8);
  const rawFields = input.fields && typeof input.fields === 'object' ? input.fields : null;
  return CONFIRM_FIELDS.map(({ key, label }) => {
    const fromMap = rawFields?.[key];
    const fromFlat = input[key];
    const raw = (fromMap && typeof fromMap === 'object' && 'value' in fromMap)
      ? fromMap
      : (fromFlat && typeof fromFlat === 'object' && 'value' in fromFlat && !Array.isArray(fromFlat)
        ? fromFlat
        : null);
    const value = raw
      ? raw.value
      : (input[key] ?? null);
    const source = raw && typeof raw === 'object' && raw.source
      ? raw.source
      : (isFilled(value) ? defaultSource : null);
    const confidence = raw && typeof raw === 'object' && raw.confidence != null
      ? raw.confidence
      : (isFilled(value) ? defaultConfidence : 0);
    const missing = !isFilled(value);
    const low = !missing && confidence < LOW_CONFIDENCE;
    const customLabel = raw && typeof raw === 'object' ? raw.sourceLabel : null;
    const display = raw && typeof raw === 'object' && raw.display ? raw.display : null;
    return {
      key,
      label,
      value: missing ? null : value,
      source,
      sourceLabel: customLabel || sourceLabel(source),
      confidence,
      missing,
      low,
      display: missing ? null : display,
    };
  });
}

export function missingKeys(statuses) {
  return statuses.filter((s) => s.missing).map((s) => s.key);
}

export function confirmSummary(statuses) {
  const filled = statuses.filter((s) => !s.missing);
  const missing = statuses.filter((s) => s.missing);
  const low = statuses.filter((s) => s.low);
  const bySource = new Map();
  for (const s of filled) {
    const label = s.sourceLabel || 'the import';
    if (!bySource.has(label)) bySource.set(label, []);
    bySource.get(label).push(s.label.toLowerCase());
  }
  const parts = [];
  for (const [label, names] of bySource) {
    parts.push(`${listEnglish(names)} ${names.length === 1 ? 'was' : 'were'} read from ${label}`);
  }
  if (low.length) {
    parts.push(`${listEnglish(low.map((s) => s.label.toLowerCase()))} look uncertain — have a quick check`);
  }
  if (missing.length) {
    parts.push(`${listEnglish(missing.map((s) => s.label.toLowerCase()))} ${missing.length === 1 ? 'is' : 'are'} missing — please fill ${missing.length === 1 ? 'it' : 'them'} in`);
  }
  if (!parts.length) return 'Have a quick look and fix anything we’ve got wrong before we score it.';
  const text = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ');
  return `${text}.`;
}

function listEnglish(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Flat extracted object used to prefill the form, plus status metadata.
 */
export function buildConfirmState(input, opts) {
  const statuses = fieldStatuses(input, opts);
  return {
    statuses,
    summary: confirmSummary(statuses),
    missing: missingKeys(statuses),
    hasAny: statuses.some((s) => !s.missing),
  };
}
