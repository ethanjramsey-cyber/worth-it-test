/**
 * Conservative UK used-car listing-text parser.
 * Returns null for a field if unsure — never guesses a value silently.
 */

const YEAR_MIN = 1990;

function currentMaxYear(now = new Date()) {
  return now.getFullYear() + 1;
}

function toNumber(raw) {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pound amounts like £8,495, £8495, £8,495.00, sometimes "asking 8495".
 * If several £ figures appear, prefer a labelled asking/price (not "was" / monthly).
 * Returns null when two unlabelled amounts disagree.
 */
export function parsePrice(text) {
  if (!text) return null;
  const labelled = text.match(
    /(?:asking(?:\s*price)?|sale\s*price|priced\s*at|price|now|ono|ovno)[:\s=]*£?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})(?:\.\d{1,2})?/i,
  );
  if (labelled) {
    const around = text.slice(Math.max(0, labelled.index - 8), labelled.index);
    if (!/\bwas\b/i.test(around) && !/\b(pcm|pm|\/mo|per\s*month)\b/i.test(labelled[0])) {
      const n = toNumber(labelled[1]);
      if (n != null && n >= 100 && n <= 10_000_000) return Math.round(n);
    }
  }
  const amounts = [];
  const re = /£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})(?:\.\d{1,2})?/g;
  let m;
  while ((m = re.exec(text))) {
    const n = toNumber(m[1]);
    if (n == null || n < 100 || n > 10_000_000) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const after = text.slice(m.index, m.index + m[0].length + 10);
    if (/\b(pcm|pm|\/mo|per\s*month)\b/i.test(after)) continue;
    const was = /\b(was|wasprice|list\s*price|from)\b/i.test(before);
    amounts.push({ n: Math.round(n), was });
  }
  const current = amounts.filter((a) => !a.was);
  const unique = [...new Set((current.length ? current : amounts).map((a) => a.n))];
  if (unique.length === 1) return unique[0];
  return null;
}

/**
 * Mileage: "42,000 miles", "42000 miles", "42k miles", "mileage: 42,000".
 */
export function parseMileage(text) {
  if (!text) return null;
  const k = text.match(/(\d{1,3}(?:\.\d)?)\s*k\s*(?:miles|mile|mls|mi)\b/i);
  if (k) {
    const n = Number(k[1]) * 1000;
    if (Number.isFinite(n) && n >= 0 && n <= 500_000) return Math.round(n);
  }
  const miles = text.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,6})\s*(?:miles|mile|mls|mi)\b/i);
  if (miles) {
    const n = toNumber(miles[1]);
    if (n != null && n >= 0 && n <= 500_000) return n;
  }
  const labelled = text.match(/mileage[:\s]+([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,6})/i);
  if (labelled) {
    const n = toNumber(labelled[1]);
    if (n != null && n >= 0 && n <= 500_000) return n;
  }
  return null;
}

function yearFromUkReg(yy, now) {
  const max = currentMaxYear(now);
  const n = Number(yy);
  if (!Number.isFinite(n)) return null;
  // UK age-identifier: 19 = 2019, 69 = late 2019. Approximate only.
  let y = null;
  if (n >= 50 && n <= 99) y = 2000 + (n - 50);
  else if (n >= 0 && n <= 30) y = 2000 + n;
  if (y != null && y >= YEAR_MIN && y <= max) return y;
  return null;
}

/**
 * A 4-digit year that is not part of a £ amount.
 * Ignores years next to MOT / warranty / tax / "until".
 * "2018 (68 reg)" is a clear car year. If several candidates remain, return
 * null unless one is clearly a registration year.
 */
export function parseYear(text, now = new Date()) {
  if (!text) return null;
  const max = currentMaxYear(now);
  const masked = text.replace(/£\s*[0-9,]+\.?\d*/g, ' ');
  const years = [];
  const re = /\b((?:19(?:9\d)|20(?:[0-2]\d)))\b/g;
  let m;
  while ((m = re.exec(masked))) {
    const y = Number(m[1]);
    if (y < YEAR_MIN || y > max) continue;
    const before = masked.slice(Math.max(0, m.index - 18), m.index);
    const after = masked.slice(m.index + 4, m.index + 18);
    if (/\b(mot|until|till|warranty|expires?|valid(?:ity)?|tax(?:ed)?|insured?)\b/i.test(before)) continue;
    if (/\b(mot|warranty)\b/i.test(after) && !/\breg\b/i.test(after)) continue;
    const regish = /\(\s*\d{2}\s*(?:reg|plate)?\s*\)|\b(?:reg|plate|year)\b/i.test(after)
      || /\b(?:reg|plate|year)\b/i.test(before)
      || m.index < 4
      || /^\s*$/.test(before.slice(-1));
    years.push({ y, index: m.index, regish });
  }
  if (!years.length) {
    const plate = masked.match(/\b([0-9]{2})\s*(?:reg|plate)\b/i)
      || masked.match(/\(\s*([0-9]{2})\s*(?:reg|plate)?\s*\)/i);
    if (plate) return yearFromUkReg(plate[1], now);
    return null;
  }
  const unique = [...new Set(years.map((x) => x.y))];
  if (unique.length === 1) return unique[0];
  const preferred = years.filter((item) => {
    const around = masked.slice(Math.max(0, item.index - 8), item.index + 16);
    return item.regish || /\b(?:reg|plate|year)\b/i.test(around) || item.index < 4;
  });
  const prefUnique = [...new Set(preferred.map((x) => x.y))];
  if (prefUnique.length === 1) return prefUnique[0];
  return null;
}

/**
 * @returns {{ year: number|null, mileage: number|null, price: number|null }}
 */
export function parseListingText(text, now = new Date()) {
  const raw = String(text ?? '').trim();
  if (!raw) return { year: null, mileage: null, price: null };
  return {
    year: parseYear(raw, now),
    mileage: parseMileage(raw),
    price: parsePrice(raw),
  };
}

const FUEL_ALIASES = {
  petrol: 'petrol',
  gasoline: 'petrol',
  unleaded: 'petrol',
  diesel: 'diesel',
  hybrid: 'hybrid',
  'self-charging hybrid': 'hybrid',
  mhev: 'hybrid',
  phev: 'phev',
  'plug-in hybrid': 'phev',
  'plug in hybrid': 'phev',
  'petrol plug-in hybrid': 'phev',
  electric: 'electric',
  ev: 'electric',
  bev: 'electric',
  lpg: 'lpg',
};

export function normaliseFuel(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  if (FUEL_ALIASES[key]) return FUEL_ALIASES[key];
  if (/\bplug[-\s]?in\b/.test(key) && /hybrid/.test(key)) return 'phev';
  if (/\bhybrid\b/.test(key) || /\bmhev\b/.test(key)) return 'hybrid';
  if (/\b(electric|bev|\bev\b)\b/.test(key)) return 'electric';
  if (/\bdiesel\b/.test(key) || /\btdi\b/.test(key) || /\btdci\b/.test(key)) return 'diesel';
  if (/\b(petrol|gasoline)\b/.test(key)) return 'petrol';
  if (/\blpg\b/.test(key)) return 'lpg';
  return null;
}

const EV_EQUIPMENT = /\belectric(?:ally)?[\s-]+(?:\w+[\s-]+)?(?:windows?|mirrors?|seats?|handbrake|hand brake|parking brake|park brake|tailgate|boot|sunroof|roof|heated|power|steering|folding|adjust\w*|front|rear|door|locking|locks?|operated|assist\w*|memory|fold|screen)\b/gi;

/**
 * Fuel from free text (a whole listing page or pasted text). Stricter than normaliseFuel:
 * "electric windows" must not make a petrol car electric. Prefers an explicit "Fuel type: X".
 */
export function parseFuel(text) {
  if (!text) return null;
  const raw = String(text);
  if (raw.length < 40 && !/\s{2,}/.test(raw)) return normaliseFuel(raw);
  const labelled = raw.match(/\bfuel(?:\s*type)?\s*[:\-]?\s*(petrol|diesel|plug[-\s]?in hybrid|hybrid|electric|lpg)\b/i);
  if (labelled) return normaliseFuel(labelled[1]);
  const cleaned = raw.replace(EV_EQUIPMENT, ' ');
  const low = cleaned.toLowerCase();
  if (/\bplug[-\s]?in\b/.test(low) && /hybrid/.test(low)) return 'phev';
  if (/\bphev\b/.test(low)) return 'phev';
  if (/\bhybrid\b|\bmhev\b/.test(low)) return 'hybrid';
  const hasDiesel = /\bdiesel\b|\btdi\b|\btdci\b|\bcdti\b/.test(low);
  const hasPetrol = /\b(petrol|gasoline|unleaded)\b|\becoboost\b|\btsi\b|\btfsi\b/.test(low);
  if (hasDiesel && !hasPetrol) return 'diesel';
  if (hasPetrol && !hasDiesel) return 'petrol';
  if (hasDiesel && hasPetrol) return null;
  if (/(^|[,;|\n])\s*(electric|bev)\s*([,;|\n]|$)/.test(low)) return 'electric';
  if (cleaned.length < 300 && /\b(electric|bev)\b/.test(low)) return 'electric';
  if (/\b(electric|bev)\b/.test(low) && /\b(kwh|zero emission|charging|range|ev)\b/.test(low)) return 'electric';
  if (/\bfully electric\b|\b100% electric\b/.test(low)) return 'electric';
  return null;
}

function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[–—-]/g, '-')
    .replace(/[^\w-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAKE_ALIASES = {
  vw: 'volkswagen',
  'mercedes benz': 'mercedes-benz',
  mercedes: 'mercedes-benz',
  merc: 'mercedes-benz',
  landrover: 'land rover',
  'range rover': 'land rover',
  citroen: 'citroën',
  skoda: 'škoda',
  bmw: 'bmw',
};

export const KNOWN_MAKES = [
  'Mercedes-Benz', 'Land Rover', 'Alfa Romeo', 'Aston Martin', 'Range Rover',
  'Volkswagen', 'Vauxhall', 'Peugeot', 'Citroën', 'Citroen', 'Renault',
  'Hyundai', 'Mercedes', 'Porsche', 'Ferrari', 'Bentley', 'Jaguar', 'Toyota',
  'Nissan', 'Honda', 'Suzuki', 'Subaru', 'Mazda', 'Volvo', 'Skoda', 'Škoda',
  'Seat', 'SEAT', 'Cupra', 'Mini', 'MINI', 'Audi', 'BMW', 'Kia', 'MG',
  'Dacia', 'Fiat', 'Jeep', 'Lexus', 'Tesla', 'Ford', 'Polestar', 'Smart',
  'Mitsubishi', 'Chrysler', 'Chevrolet', 'SsangYong', 'Ssangyong', 'VW',
];

export function normaliseMake(make) {
  const n = normName(make);
  return MAKE_ALIASES[n] ?? n;
}

/**
 * Match extracted/typed make + model against the curated dataset.
 * Conservative: exact make (with aliases) and model that equals or starts the
 * listed model name (so "Golf 1.5 TSI" still matches "Golf").
 */
export function matchModel(make, modelName, models) {
  if (!models?.length) return null;
  const wantMake = normaliseMake(make);
  const wantModel = normName(modelName);
  if (!wantModel) return null;
  const sameMake = models.filter((m) => {
    if (wantMake && normaliseMake(m.make) !== wantMake) return false;
    return true;
  });
  const pool = wantMake ? sameMake : models;
  const exact = pool.filter((m) => normName(m.model) === wantModel);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 && wantMake) return exact[0];
  const starts = pool.filter((m) => {
    const nm = normName(m.model);
    return wantModel === nm || wantModel.startsWith(`${nm} `) || `${normName(m.make)} ${wantModel}`.includes(nm);
  });
  // Prefer the longest model name that is a prefix of the query.
  const prefixed = pool
    .filter((m) => wantModel === normName(m.model) || wantModel.startsWith(`${normName(m.model)} `))
    .sort((a, b) => normName(b.model).length - normName(a.model).length);
  if (prefixed.length) return prefixed[0];
  if (starts.length === 1) return starts[0];
  if (!wantMake && modelName) {
    const byModel = models.filter((m) => normName(m.model) === wantModel);
    if (byModel.length === 1) return byModel[0];
  }
  return null;
}

/**
 * Status copy when a listing was parsed but the model is not in the curated
 * price dataset. Returns null if make/model are incomplete or a row matched.
 * Never invents a substitute model or a price.
 */
export function unmatchedModelMessage(parsed, matched) {
  if (matched) return null;
  const make = parsed?.make != null ? String(parsed.make).trim() : '';
  const model = parsed?.model != null ? String(parsed.model).trim() : '';
  if (!make || !model) return null;
  const year = parsed?.year != null && parsed.year !== '' ? `${parsed.year} ` : '';
  return `We've read this as a ${year}${make} ${model}, but we don't have price data for that model yet. Try another car, or tell us it's one we should add.`;
}

/**
 * Try to pull a known make from free text (title etc.).
 */
export function findMakeInText(text, models) {
  const n = normName(text);
  if (!n) return null;
  const fromData = models?.length
    ? [...new Set(models.map((m) => m.make))]
    : [];
  const makes = [...new Set([...fromData, ...KNOWN_MAKES])]
    .sort((a, b) => b.length - a.length);
  for (const make of makes) {
    const nm = normaliseMake(make);
    const aliased = Object.entries(MAKE_ALIASES).find(([, v]) => v === nm);
    const patterns = [nm, make.toLowerCase(), aliased?.[0]].filter(Boolean);
    for (const p of patterns) {
      const re = new RegExp(`(?:^|\\s)${escapeRe(p)}(?:\\s|$)`, 'i');
      if (re.test(n) || n.startsWith(`${p} `) || n === p) {
        if (normName(make) !== p && normaliseMake(make) === p && !n.includes(normName(make))) continue;
        if (make === 'Range Rover') return 'Land Rover';
        return make === 'VW' ? 'Volkswagen' : make;
      }
    }
  }
  return null;
}

const ENGINE_FAMILY = 'ecoboost|tsi|tfsi|etsi|tdi|tdci|cdti|hdi|dci|gdi|skyactiv[-\s]?\\w*|multiair|multijet|ecotec|puretech|tce|thp|vtec|d4|t4|t5|mhev|phev';

/**
 * Engine size from listing text: "1.0 EcoBoost", "1.5 TSI", "999cc", "1.0L", "998 (cc)", "1.6 TDi".
 * Returns { litres, cc, text } or null if unsure.
 */
export function parseEngine(text) {
  if (!text) return null;
  const cc = text.match(/\b(\d{3,4})\s*(?:cc\b|\(\s*cc\s*\))/i);
  const dotted = text.match(new RegExp(`\\b(\\d\\.\\d{1,2})\\s*(?:l\\b|litre|liter|${ENGINE_FAMILY})?`, 'i'));
  if (!cc && !dotted) return null;
  let litres = dotted ? Number(dotted[1]) : null;
  let ccVal = cc ? Number(cc[1]) : null;
  if (ccVal != null && litres == null) litres = Math.round((ccVal / 1000) * 10) / 10;
  if (litres != null && ccVal == null) ccVal = Math.round(litres * 1000);
  if (litres != null && (litres < 0.5 || litres > 8)) return null;
  let label = dotted ? dotted[0].trim() : `${ccVal}cc`;
  const family = text.match(new RegExp(`\\b(${ENGINE_FAMILY})\\b`, 'i'));
  if (family && litres != null && !new RegExp(family[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(label)) {
    label = `${litres.toFixed(1).replace(/\.0$/, '.0')} ${family[1]}`.replace(/\s+/g, ' ');
  } else if (litres != null && !dotted) {
    label = `${litres.toFixed(1)}L`;
  }
  return { litres, cc: ccVal, text: label.trim() };
}

const GEARBOX_ALIASES = {
  manual: 'manual',
  man: 'manual',
  mt: 'manual',
  '5-speed': 'manual',
  '6-speed': 'manual',
  auto: 'auto',
  automatic: 'auto',
  at: 'auto',
  dsg: 'auto',
  dct: 'auto',
  cvt: 'auto',
  pdk: 'auto',
  tiptronic: 'auto',
  's-tronic': 'auto',
  stronic: 'auto',
  's tronic': 'auto',
  steptronic: 'auto',
  powershift: 'auto',
  'power-shift': 'auto',
  ecvt: 'auto',
  amt: 'auto',
};

export function normaliseGearbox(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  if (GEARBOX_ALIASES[key]) return GEARBOX_ALIASES[key];
  if (/\b(manual|man\b)\b/.test(key)) return 'manual';
  if (/\b(automatic|auto|dsg|dct|cvt|pdk|tiptronic|tronic|powershift)\b/.test(key)) return 'auto';
  return null;
}

export function parseGearbox(text) {
  if (!text) return null;
  return normaliseGearbox(text);
}

const MODEL_STOP = new Set([
  'for', 'sale', 'used', 'nearly', 'new', 'with', 'and', 'the', 'a', 'an',
  'dr', 'door', 'doors', 'hatchback', 'saloon', 'estate', 'suv', 'coupe',
  'convertible', 'mpv', 'van', 'petrol', 'diesel', 'hybrid', 'electric',
  'manual', 'auto', 'automatic', 'miles', 'mile', 'mileage', 'reg', 'plate',
  'ulez', 'fsh', 'px', 'ono', 'ovno', 'dsg', 'dct', 'cvt', 'phev', 'mhev',
]);

/**
 * Strip marketing tails ("for sale", site names) from a model string.
 * Does not invent a model — empty after cleaning becomes null.
 */
export function cleanModelName(model, make) {
  if (model == null || model === '') return null;
  let s = String(model).replace(/\s+/g, ' ').trim();
  s = s.replace(/\bfor sale\b/gi, ' ');
  s = s.replace(/\s*[|–—-]\s*(cinch|autotrader|gumtree|ebay(?:\s*motors)?|cargurus|facebook(?:\s*marketplace)?|motors\.co\.uk).*$/i, '');
  s = s.replace(/^\s*(used|nearly new|approved used|certified)\s+/i, '');
  if (make) {
    s = s.replace(new RegExp(`^${escapeRe(make)}\\s+`, 'i'), '');
    const norm = normaliseMake(make);
    if (norm && norm !== String(make).toLowerCase()) {
      s = s.replace(new RegExp(`^${escapeRe(norm)}\\s+`, 'i'), '');
    }
  }
  s = s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
  return s || null;
}

/**
 * Make and model from typical UK listing titles and pasted blurbs.
 * Stops the model at an engine size, year, fuel, gearbox, body style or price.
 * Returns nulls rather than guessing.
 */
export function parseMakeModel(text, models) {
  if (!text) return { make: null, model: null };
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  // Gumtree-style: "Ford, FIESTA, Hatchback, 2018, Manual, 998 (cc)"
  const comma = cleaned.match(
    /^\s*([A-Za-z][A-Za-z-]+(?:\s+[A-Za-z][A-Za-z-]+)?)\s*,\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*,/i,
  );
  if (comma) {
    const maybeMake = findMakeInText(comma[1], models) || (KNOWN_MAKES.find((m) => normaliseMake(m) === normaliseMake(comma[1])) ? comma[1] : null);
    const second = comma[2];
    if (maybeMake && second && !MODEL_STOP.has(second.toLowerCase()) && !normaliseFuel(second) && !normaliseGearbox(second)) {
      return { make: maybeMake === 'VW' ? 'Volkswagen' : maybeMake, model: cleanModelName(second) };
    }
  }
  const make = findMakeInText(cleaned, models);
  if (!make) return { make: null, model: null };
  const makeRe = new RegExp(`(?:^|\\b)${escapeRe(make)}\\b`, 'i');
  const also = make === 'Volkswagen' ? /\bVW\b/i : make === 'Mercedes-Benz' ? /\b(?:Mercedes(?:-Benz)?|Merc)\b/i : make === 'Land Rover' ? /\b(?:Land\s*Rover|Range\s*Rover)\b/i : null;
  const m = cleaned.match(also) || cleaned.match(makeRe);
  if (!m) return { make, model: null };
  let after = cleaned.slice(m.index + m[0].length).replace(/^[\s,]+/, '');
  after = after.replace(/^\(?((?:19|20)\d{2}|\d{2}\s*(?:reg|plate))\)?[\s,]*/i, '');
  after = after.split(/[,|–—•·]/)[0];
  const tokens = after.split(/[\s,]+/).filter(Boolean);
  const modelTokens = [];
  const continuations = new Set(['series', 'class', 'sport', 'cross', 'space', 'type', 'ray']);
  const trims = new Set(['amg', 'line', 'titanium', 'zetec', 'active', 'style', 'edge', 'trend', 'vignale', 'gti', 'gte', 'edition', 'match', 'se', 'st', 'fr', 's-line', 'sline', 'play']);
  for (const tok of tokens) {
    const bare = tok.replace(/[()]/g, '');
    if (!bare) break;
    if (/^£/.test(bare)) break;
    if (/^\(?((?:19|20)\d{2})\)?$/.test(bare)) break;
    if (/^\d\.\d/.test(bare)) break;
    if (/^\d{3,4}(?:cc)?$/i.test(bare) && /cc/i.test(after)) break;
    if (MODEL_STOP.has(bare.toLowerCase())) break;
    if (/^\d+dr$/i.test(bare) || /^\(\d{2}\)$/.test(bare)) break;
    if (modelTokens.length && (trims.has(bare.toLowerCase()) || /^[A-Za-z]{1,3}\d{2,4}[A-Za-z]?$/.test(bare))) break;
    if (modelTokens.length && !continuations.has(bare.toLowerCase()) && !/^\d+$/.test(bare) && !/-/.test(bare)) break;
    modelTokens.push(bare);
    if (modelTokens.length >= 3) break;
  }
  const model = cleanModelName(modelTokens.join(' '), make);
  return { make: make === 'VW' ? 'Volkswagen' : make, model };
}

/**
 * Richer parse used by the confirm screen and paste-listing-text box.
 * Unknown fields stay null — never filled in by guesswork.
 */
export function parseListingDetails(text, now = new Date()) {
  const raw = String(text ?? '').trim();
  const base = parseListingText(raw, now);
  const { make, model } = parseMakeModel(raw);
  return {
    ...base,
    make,
    model,
    engine: parseEngine(raw),
    fuel: parseFuel(raw),
    gearbox: parseGearbox(raw),
  };
}
