/**
 * UK number-plate helpers used by the app and the lookup worker.
 * Pure functions: extract, validate, format. No I/O, no secrets.
 */

export const PLATE_STATUSES = Object.freeze(['found', 'blurred', 'hidden', 'not_visible']);

const MEMORY_TAG = /^[A-HJ-PR-Y]{2}$/; // current-format area code; no I, Q, Z
const RANDOM_LETTERS = /^[A-HJ-PR-TV-Z]{3}$/; // no I, Q; Z allowed
const YEAR_LETTER = /^[A-HJ-NPR-TV-Y]$/; // prefix/suffix age letter; no I, O, Q, U, Z
const RANDOM_PREFIX_SUFFIX = /^[A-HJ-PR-TV-Z]{3}$/;

const NEAR_LABEL = /\b(?:reg(?:istration)?(?:\s*(?:number|no\.?|num))?|vrm|vrn|number\s*plates?|numberplates?)\b/i;

export function normalisePlate(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidAgeIdentifier(yy, now = new Date()) {
  const n = Number(yy);
  if (!Number.isFinite(n) || n < 0 || n > 99) return false;
  const year = now.getFullYear();
  const maxYear = year + 1;
  const springMax = maxYear - 2000;
  const autumnMax = (maxYear - 2000) + 50;
  if (n >= 2 && n <= springMax) return true;
  if (n >= 51 && n <= autumnMax) return true;
  return false;
}

function classifyCompact(compact, now) {
  if (!compact || compact.length < 5 || compact.length > 8) return null;
  const current = compact.match(/^([A-Z]{2})([0-9]{2})([A-Z]{3})$/);
  if (current) {
    if (!MEMORY_TAG.test(current[1])) return null;
    if (!isValidAgeIdentifier(current[2], now)) return null;
    if (!RANDOM_LETTERS.test(current[3])) return null;
    return 'current';
  }
  const prefix = compact.match(/^([A-Z])([0-9]{1,3})([A-Z]{3})$/);
  if (prefix) {
    if (!YEAR_LETTER.test(prefix[1])) return null;
    if (!RANDOM_PREFIX_SUFFIX.test(prefix[3])) return null;
    return 'prefix';
  }
  const suffix = compact.match(/^([A-Z]{3})([0-9]{1,3})([A-Z])$/);
  if (suffix) {
    if (!RANDOM_PREFIX_SUFFIX.test(suffix[1])) return null;
    if (!YEAR_LETTER.test(suffix[3])) return null;
    return 'suffix';
  }
  // Dateless / NI-style, accepted only when explicitly allowed (typed lookup).
  if (/^[A-Z]{1,3}[0-9]{1,4}$/.test(compact) || /^[0-9]{1,4}[A-Z]{1,3}$/.test(compact)) {
    return 'dateless';
  }
  return null;
}

/**
 * @param {string} raw
 * @param {{ allowDateless?: boolean, now?: Date }} [opts]
 */
export function isValidUkPlate(raw, opts = {}) {
  const compact = normalisePlate(raw);
  if (compact.length < 2 || compact.length > 8) return false;
  const kind = classifyCompact(compact, opts.now);
  if (!kind) return false;
  if (kind === 'dateless' && opts.allowDateless !== true) return false;
  return true;
}

export function formatPlate(raw, opts = {}) {
  const compact = normalisePlate(raw);
  const kind = classifyCompact(compact, opts.now);
  if (kind === 'current') return `${compact.slice(0, 4)} ${compact.slice(4)}`;
  if (kind === 'prefix') {
    const m = compact.match(/^([A-Z])([0-9]{1,3})([A-Z]{3})$/);
    return `${m[1]}${m[2]} ${m[3]}`;
  }
  if (kind === 'suffix') {
    const m = compact.match(/^([A-Z]{3})([0-9]{1,3})([A-Z])$/);
    return `${m[1]} ${m[2]}${m[3]}`;
  }
  return compact || '';
}

function uniquePlates(list, now) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const compact = normalisePlate(raw);
    if (!compact || seen.has(compact)) continue;
    if (!isValidUkPlate(compact, { now })) continue;
    seen.add(compact);
    out.push(formatPlate(compact, { now }));
  }
  return out;
}

const TRIM_FALSE_POSITIVES = new Set([
  'AMG', 'CSL', 'GTI', 'GTE', 'GTD', 'TDI', 'TSI', 'DSG', 'CDI', 'HDI',
  'CUP', 'ECO', 'RSM', 'MHE', 'PHE', 'TFN', 'VIP', 'USA', 'GBP',
]);

function isFalsePositive(text, index, length, compact, kind) {
  const before = text.slice(Math.max(0, index - 28), index);
  const after = text.slice(index + length, index + length + 20);
  const letters = (compact.match(/[A-Z]{3}$/) || compact.match(/^[A-Z]{3}/) || [])[0];

  if (/£\s*$/.test(before)) return true;
  if (/(?:price|priced|cost|asking|was|now|ono|ovno)\s*[:£-]?\s*$/i.test(before)) return true;
  if (/(?:tel|phone|mobile|whatsapp|call)\s*[:.]?\s*$/i.test(before)) return true;
  if (/(?:\+44|0044)\s*[\d\s]*$/.test(before)) return true;
  if (/[0-9]{3,}$/.test(before.replace(/[\s-]/g, '')) && /^\s*\d/.test(after)) return true;
  if (/@\s*$/.test(before) || /^[a-z0-9._%+-]*@/i.test(after)) return true;
  if (/https?:\/\/\S*$/i.test(before) || /\.(?:html?|php|com|co|uk|jpg|png)\b/i.test(after)) return true;
  if (letters && TRIM_FALSE_POSITIVES.has(letters)) return true;

  // Older formats collide with model codes such as "M3 CSL" or "A45 AMG".
  // Only keep them when they sit next to a reg / VRM label.
  if (kind === 'prefix' || kind === 'suffix') {
    const window = text.slice(Math.max(0, index - 40), index + length);
    if (!NEAR_LABEL.test(window)) return true;
  }
  return false;
}

function labelledWindow(text, index, length) {
  // Labels usually sit just before the plate. A short window after
  // catches "AB12 CDE (reg)" without stealing the next plate's label.
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 8);
  return text.slice(start, end);
}

const CURRENT_RE = /\b([A-Z]{2}\s*[0-9]{2}\s*[A-Z]{3})\b/g;
const PREFIX_RE = /\b([A-Z]\s*[0-9]{1,3}\s*[A-Z]{3})\b/g;
const SUFFIX_RE = /\b([A-Z]{3}\s*[0-9]{1,3}\s*[A-Z])\b/g;

/**
 * Find UK registrations in free text. Current (AB12 CDE) plus older
 * prefix (A123 BCD) and suffix (ABC 123D) formats. Ignores obvious
 * false positives and prefers plates near "reg" / "registration" / "VRM".
 *
 * @param {string} text
 * @param {{ now?: Date }} [opts]
 * @returns {{ plates: string[], preferred: string|null }}
 */
export function extractPlates(text, opts = {}) {
  const now = opts.now || new Date();
  const raw = String(text || '');
  if (!raw.trim()) return { plates: [], preferred: null };

  const upper = raw.toUpperCase();
  const found = [];
  const pushFrom = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(upper))) {
      const compact = normalisePlate(m[1]);
      const kind = classifyCompact(compact, now);
      if (!kind || kind === 'dateless') continue;
      if (!isValidUkPlate(compact, { now })) continue;
      if (isFalsePositive(upper, m.index, m[0].length, compact, kind)) continue;
      const near = NEAR_LABEL.test(labelledWindow(upper, m.index, m[0].length));
      found.push({ compact, near, index: m.index });
    }
  };
  pushFrom(CURRENT_RE);
  pushFrom(PREFIX_RE);
  pushFrom(SUFFIX_RE);

  found.sort((a, b) => {
    if (a.near !== b.near) return a.near ? -1 : 1;
    return a.index - b.index;
  });

  const plates = uniquePlates(found.map((f) => f.compact), now);
  const preferred = found.find((f) => f.near)
    ? formatPlate(found.find((f) => f.near).compact, { now })
    : (plates[0] || null);
  return { plates, preferred: plates.length ? preferred : null };
}

export function coercePlateStatus(value) {
  const s = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'notvisible') return 'not_visible';
  if (PLATE_STATUSES.includes(s)) return s;
  return null;
}

/**
 * Validate plates from an AI response. Never invents a plate.
 * For text-only input, AI plates must also appear in the text.
 */
export function coercePlates(raw, { text, image, now } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const listed = [];
  if (Array.isArray(src.plates)) listed.push(...src.plates);
  if (src.plate) listed.push(src.plate);
  if (src.registration) listed.push(src.registration);
  if (src.vrm) listed.push(src.vrm);

  const fromText = text ? extractPlates(text, { now }).plates : [];
  const textSet = new Set(fromText.map(normalisePlate));
  const fromAi = uniquePlates(listed, now);
  let keptAi = fromAi;
  if (text && !image) {
    keptAi = fromAi.filter((p) => textSet.has(normalisePlate(p)));
  }

  let plates = uniquePlates([...keptAi, ...fromText], now);
  let plateStatus = coercePlateStatus(src.plateStatus);

  if (plateStatus === 'blurred' || plateStatus === 'hidden') {
    plates = [];
  } else if (plates.length) {
    if (!plateStatus || plateStatus === 'not_visible') plateStatus = 'found';
  } else {
    plateStatus = 'not_visible';
  }
  return { plates, plateStatus };
}

export function mergePlateLists(existing, extra, now) {
  const a = existing && typeof existing === 'object' ? existing : { plates: existing };
  const b = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : { plates: extra };
  const plates = uniquePlates([...(a.plates || []), ...(b.plates || [])], now);
  let plateStatus = coercePlateStatus(b.plateStatus) || coercePlateStatus(a.plateStatus);
  if (plateStatus === 'blurred' || plateStatus === 'hidden') {
    return { plates: [], plateStatus };
  }
  if (plates.length && (!plateStatus || plateStatus === 'not_visible')) plateStatus = 'found';
  if (!plateStatus) plateStatus = plates.length ? 'found' : 'not_visible';
  return { plates, plateStatus };
}

/**
 * UI state after a listing import. Pure, so the app and tests share it.
 *
 * @param {{ plates?: string[], plateStatus?: string|null }} input
 * @returns {{ mode: string, plates: string[], message: string, autoLookup: boolean }}
 */
export function plateImportState(input = {}) {
  const status = coercePlateStatus(input.plateStatus);
  const plates = uniquePlates(input.plates || []);
  if (status === 'blurred') {
    return {
      mode: 'blurred',
      plates: [],
      message: 'The plate looks blurred in the photo, add it for a more accurate check',
      autoLookup: false,
    };
  }
  if (status === 'hidden') {
    return {
      mode: 'hidden',
      plates: [],
      message: 'The plate looks hidden in the photo, add it for a more accurate check',
      autoLookup: false,
    };
  }
  if (plates.length === 1) {
    return {
      mode: 'one',
      plates,
      message: `Plate found: ${plates[0]}`,
      autoLookup: true,
    };
  }
  if (plates.length > 1) {
    return {
      mode: 'many',
      plates,
      message: 'Which plate should we look up?',
      autoLookup: false,
    };
  }
  return {
    mode: 'none',
    plates: [],
    message: 'Add the reg for more accurate checks',
    autoLookup: false,
  };
}
