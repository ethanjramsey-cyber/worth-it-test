/**
 * Import Ethan's reference prices from the CSV template into models.json.
 * Never invents a price. Rows without a number stay placeholder.
 */

import { ALLOWED_FUELS, ALLOWED_SEGMENTS } from './validate.js';
import { parseYearMonth } from './indexAdjust.js';

export const PRICE_MIN = 500;
export const PRICE_MAX = 250000;
export const PRICE_WARN_MIN = 1500;
export const PRICE_WARN_MAX = 150000;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(make, model) {
  const raw = `${make || ''} ${model || ''}`
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return raw;
}

function splitList(value) {
  if (value == null) return [];
  const s = String(value).trim();
  if (!s) return [];
  return s.split(/[;|,/]+/).map((part) => part.trim()).filter(Boolean);
}

function parseFuels(value) {
  return splitList(value).map((f) => f.toLowerCase());
}

function parseBool(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  return ['y', 'yes', 'true', '1', 'checked', 'x'].includes(s);
}

function parsePrice(value) {
  if (value == null) return { empty: true, value: null };
  const s = String(value).trim();
  if (!s) return { empty: true, value: null };
  const cleaned = s.replace(/[£,\s]/g, '');
  if (!cleaned) return { empty: true, value: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { empty: false, value: null, error: `not a number: ${value}` };
  return { empty: false, value: n };
}

/**
 * Minimal CSV parser: RFC-style quotes, commas, newlines.
 * First non-empty row is the header.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (inQuotes) throw new Error('CSV has an unclosed quote');
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const records = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] == null ? '' : String(cells[idx]).trim();
    });
    return obj;
  });
  return { headers, records };
}

export function normaliseHeaderMap(headers) {
  const aliases = {
    make: ['make'],
    model: ['model'],
    generations: ['generations', 'generation', 'typical generations', 'typical_generations', 'generations_engines'],
    engines: ['engines', 'engine', 'typical engines', 'typical_engines'],
    segment: ['segment'],
    bodyType: ['bodytype', 'body_type', 'body type', 'body'],
    fuels: ['fuels', 'fuel'],
    refPrice: ['refprice', 'ref_price', 'ref price', 'price', 'reference price'],
    ethanChecked: ['ethan_checked', 'ethanchecked', 'ethan checked', 'checked'],
    notes: ['notes', 'note'],
    id: ['id', 'model_id', 'modelid'],
    baseDate: ['basedate', 'base_date', 'base date'],
  };
  const map = {};
  const lower = headers.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  for (const [canon, names] of Object.entries(aliases)) {
    const idx = lower.findIndex((h) => names.includes(h) || names.includes(h.replace(/_/g, ' ')));
    if (idx >= 0) map[canon] = headers[idx];
  }
  return map;
}

/**
 * Validate and interpret CSV records. Does not touch models.json.
 */
export function validateCsvRecords(records, { headers } = {}) {
  const errors = [];
  const warnings = [];
  const rows = [];
  const seenIds = new Map();
  const seenNames = new Map();
  const cols = normaliseHeaderMap(headers || (records[0] ? Object.keys(records[0]) : []));

  const required = ['make', 'model', 'segment', 'bodyType', 'fuels'];
  for (const key of required) {
    if (!cols[key]) errors.push(`CSV is missing a "${key}" column`);
  }
  if (!cols.refPrice) errors.push('CSV is missing a "refPrice" column');

  records.forEach((rec, i) => {
    const line = i + 2; // header is line 1
    const get = (key) => {
      const col = cols[key];
      return col ? rec[col] : rec[key] || '';
    };
    const make = String(get('make') || '').trim();
    const model = String(get('model') || '').trim();
    if (!make && !model) {
      errors.push(`row ${line}: empty make and model`);
      return;
    }
    if (!make) errors.push(`row ${line}: missing make`);
    if (!model) errors.push(`row ${line}: missing model`);
    const id = (String(get('id') || '').trim() || slugify(make, model));
    if (!ID_RE.test(id)) errors.push(`row ${line}: id "${id}" is not kebab-case`);
    const nameKey = `${make.toLowerCase()}|${model.toLowerCase()}`;
    if (seenIds.has(id)) errors.push(`row ${line}: duplicate id "${id}" (also row ${seenIds.get(id)})`);
    else seenIds.set(id, line);
    if (make && model && seenNames.has(nameKey)) {
      errors.push(`row ${line}: duplicate make/model "${make} ${model}" (also row ${seenNames.get(nameKey)})`);
    } else if (make && model) seenNames.set(nameKey, line);

    const segment = String(get('segment') || '').trim().toLowerCase();
    if (!segment) errors.push(`row ${line}: missing segment`);
    else if (!ALLOWED_SEGMENTS.includes(segment)) {
      errors.push(`row ${line}: unknown segment "${segment}"`);
    }
    const bodyType = String(get('bodyType') || '').trim();
    if (!bodyType) errors.push(`row ${line}: missing bodyType`);

    const fuels = parseFuels(get('fuels'));
    if (!fuels.length) errors.push(`row ${line}: missing fuels`);
    fuels.forEach((f) => {
      if (!ALLOWED_FUELS.includes(f)) errors.push(`row ${line}: unknown fuel "${f}"`);
    });

    const engines = splitList(get('engines'));
    const generations = String(get('generations') || '').trim();
    const notes = String(get('notes') || '').trim();
    const price = parsePrice(get('refPrice'));
    if (!price.empty && price.error) errors.push(`row ${line}: ${price.error}`);
    if (!price.empty && price.value != null) {
      if (price.value < PRICE_MIN || price.value > PRICE_MAX) {
        errors.push(`row ${line}: refPrice ${price.value} is outside £${PRICE_MIN}–£${PRICE_MAX}`);
      } else if (price.value < PRICE_WARN_MIN || price.value > PRICE_WARN_MAX) {
        warnings.push(`row ${line}: refPrice ${price.value} is unusually low or high for a 3-year, 30k-mile example — have a check`);
      }
    }
    const checked = parseBool(get('ethanChecked'));
    if (checked && (price.empty || price.value == null)) {
      errors.push(`row ${line}: marked ethan_checked but refPrice is empty`);
    }
    const baseDate = parseYearMonth(get('baseDate'));

    rows.push({
      line,
      id,
      make,
      model,
      segment,
      bodyType,
      fuels,
      engines,
      generations,
      notes,
      refPrice: price.empty ? null : price.value,
      ethanChecked: checked,
      baseDate,
      hasPrice: !price.empty && Number.isFinite(price.value),
    });
  });

  return { ok: errors.length === 0, errors, warnings, rows };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Merge validated CSV rows into a models.json document.
 *
 * - Priced rows with ethan_checked ticked (yes/y/true/1/x): upsert, set refPrice,
 *   placeholder:false, ethanChecked:true, draft:false, baseDate.
 * - Priced rows that are not ticked: upsert the figure but keep it as unchecked
 *   draft data (ethanChecked:false, placeholder:true, draft:true) so the app
 *   shows a draft note rather than a verified price.
 * - Rows without a price: existing models stay placeholder (structural fields may update;
 *   any existing invented seed price is left as-is and still flagged placeholder).
 *   New unpriced models are not added (no invented prices).
 *
 * @param {object} modelsDoc
 * @param {object[]} rows  from validateCsvRecords
 * @param {{ baseDate?: string, now?: Date }} [opts]
 */
export function mergeRefPrices(modelsDoc, rows, { baseDate, now = new Date() } = {}) {
  const doc = clone(modelsDoc || { placeholder: true, models: [] });
  if (!Array.isArray(doc.models)) doc.models = [];
  const defaultBase = parseYearMonth(baseDate) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const originalIds = new Set((modelsDoc?.models || []).map((m) => m.id));
  const byId = new Map(doc.models.map((m) => [m.id, m]));
  const summary = { priced: 0, checked: 0, draft: 0, added: 0, updated: 0, unchangedPlaceholder: 0, skippedNewUnpriced: 0 };

  for (const row of rows) {
    const existing = byId.get(row.id);
    if (row.hasPrice) {
      const nextBase = row.baseDate || defaultBase;
      const checked = row.ethanChecked === true;
      const next = existing ? { ...existing } : {
        id: row.id,
        refAge: 3,
        refMiles: 30000,
        curveId: row.segment,
      };
      next.make = row.make;
      next.model = row.model;
      next.segment = row.segment;
      next.bodyType = row.bodyType;
      next.fuels = row.fuels;
      if (row.engines.length) next.engines = row.engines;
      next.curveId = (existing?.curveId && existing.segment === row.segment) ? existing.curveId : row.segment;
      next.refPrice = row.refPrice;
      next.refAge = 3;
      next.refMiles = 30000;
      next.placeholder = !checked;
      next.ethanChecked = checked;
      next.draft = !checked;
      next.baseDate = nextBase;
      if (checked) delete next.draft;
      if (!existing) doc.models.push(next);
      else {
        const idx = doc.models.findIndex((m) => m.id === row.id);
        doc.models[idx] = next;
      }
      byId.set(row.id, next);
      summary.priced += 1;
      if (checked) summary.checked += 1;
      else summary.draft += 1;
      if (originalIds.has(row.id)) summary.updated += 1;
      else summary.added += 1;
    } else if (existing) {
      existing.make = row.make || existing.make;
      existing.model = row.model || existing.model;
      if (row.segment) {
        if (!existing.curveId || existing.curveId === existing.segment) existing.curveId = row.segment;
        existing.segment = row.segment;
      }
      if (row.bodyType) existing.bodyType = row.bodyType;
      if (row.fuels.length) existing.fuels = row.fuels;
      if (row.engines.length) existing.engines = row.engines;
      existing.placeholder = true;
      existing.ethanChecked = false;
      delete existing.draft;
      delete existing.baseDate;
      summary.unchangedPlaceholder += 1;
    } else {
      summary.skippedNewUnpriced += 1;
    }
  }

  const anyPlaceholder = doc.models.some((m) => m.placeholder !== false);
  const anyChecked = doc.models.some((m) => m.placeholder === false && m.ethanChecked === true);
  const anyDraft = doc.models.some((m) => m.draft === true);
  const anyInvented = doc.models.some((m) => m.placeholder !== false && m.draft !== true);
  doc.placeholder = anyPlaceholder;
  if (anyChecked && !anyPlaceholder) {
    doc.note = 'Reference prices set by Ethan from his trade knowledge (typical retail, 3 years / 30,000 miles). Moved month-to-month with the ONS CPIH second-hand cars index. Not a live valuation.';
  } else if (anyDraft && anyChecked) {
    doc.note = anyInvented
      ? 'Mixed seed — some refPrice values were set by Ethan from his trade knowledge; others are unchecked draft estimates or leftover placeholder invented figures, not signed-off market prices. Do not treat draft or placeholder rows as a buying guide.'
      : 'Mixed seed — some refPrice values were set by Ethan from his trade knowledge; others are unchecked draft estimates, not yet signed off. Do not treat draft rows as a buying guide.';
  } else if (anyDraft && !anyChecked) {
    doc.note = anyInvented
      ? "DRAFT seed — some refPrice values are sourced estimates awaiting Ethan's check; others are still placeholder invented figures. Neither is a signed-off valuation. Do not treat them as a buying guide."
      : "DRAFT seed — refPrice values are sourced estimates awaiting Ethan's check. They are not Ethan-checked trade prices and must not be presented as a confident valuation.";
  } else if (anyChecked && anyPlaceholder) {
    doc.note = 'Mixed seed — some refPrice values were set by Ethan from his trade knowledge; others are still placeholder invented figures, not real market prices. Do not treat placeholder rows as a buying guide.';
  } else {
    doc.note = 'PLACEHOLDER seed — all refPrice values are invented round numbers in GBP, not real UK market prices. Do not use for a real buying decision. Ethan still needs to sanity-check every row. engines/gearboxes are suggestion lists only, also placeholder.';
  }
  if (doc.refAge == null) doc.refAge = 3;
  if (doc.refMiles == null) doc.refMiles = 30000;

  return { doc, summary };
}
