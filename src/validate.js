/**
 * Dataset validation used by scripts/validate-data.mjs and unit tests.
 * No external schema library required.
 */

export const ALLOWED_SEGMENTS = Object.freeze([
  'supermini',
  'hatch',
  'family',
  'suv',
  'estate',
  'exec',
  'sports',
  'van',
]);

export const ALLOWED_FUELS = Object.freeze([
  'petrol',
  'diesel',
  'hybrid',
  'phev',
  'electric',
  'lpg',
]);

export const MODEL_REQUIRED = Object.freeze([
  'id',
  'make',
  'model',
  'segment',
  'bodyType',
  'fuels',
  'refPrice',
  'refAge',
  'refMiles',
  'curveId',
  'placeholder',
]);

export const CURVE_REQUIRED = Object.freeze([
  'id',
  'label',
  'annualDecay',
  'per10kMilesAdj',
  'ageFloor',
  'milesFloor',
  'ageCeiling',
  'milesCeiling',
]);

function err(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function checkKnownIssues(errors, prefix, issues) {
  if (issues == null) return;
  if (!Array.isArray(issues)) {
    err(errors, prefix, 'knownIssues must be an array when present');
    return;
  }
  issues.forEach((issue, i) => {
    const p = `${prefix}.knownIssues[${i}]`;
    if (!isPlainObject(issue)) {
      err(errors, p, 'must be an object');
      return;
    }
    if (typeof issue.note !== 'string' || !issue.note.trim()) {
      err(errors, p, 'note must be a non-empty string');
    }
    if (typeof issue.verified !== 'boolean') {
      err(errors, p, 'verified must be a boolean (default false; only shown when true)');
    }
  });
}

export function validateSegments(segmentsDoc) {
  const errors = [];
  if (!isPlainObject(segmentsDoc)) {
    return { ok: false, errors: ['segments: document must be an object'] };
  }
  if (typeof segmentsDoc.placeholder !== 'boolean') {
    err(errors, 'segments.placeholder', 'must be a boolean');
  }
  const list = segmentsDoc.segments;
  if (!Array.isArray(list) || !list.length) {
    err(errors, 'segments.segments', 'must be a non-empty array');
    return { ok: errors.length === 0, errors, ids: [] };
  }
  const ids = new Set();
  list.forEach((seg, i) => {
    const p = `segments[${i}]`;
    if (!isPlainObject(seg)) {
      err(errors, p, 'must be an object');
      return;
    }
    for (const key of CURVE_REQUIRED) {
      if (!(key in seg)) err(errors, p, `missing ${key}`);
    }
    if (typeof seg.id !== 'string' || !seg.id) err(errors, `${p}.id`, 'must be a non-empty string');
    else if (ids.has(seg.id)) err(errors, `${p}.id`, `duplicate id "${seg.id}"`);
    else ids.add(seg.id);
    if (seg.id && !ALLOWED_SEGMENTS.includes(seg.id)) {
      err(errors, `${p}.id`, `unknown segment "${seg.id}"`);
    }
    for (const numKey of ['annualDecay', 'per10kMilesAdj', 'ageFloor', 'milesFloor', 'ageCeiling', 'milesCeiling']) {
      if (typeof seg[numKey] !== 'number' || !Number.isFinite(seg[numKey])) {
        err(errors, `${p}.${numKey}`, 'must be a finite number');
      }
    }
    if (typeof seg.annualDecay === 'number' && (seg.annualDecay < 0 || seg.annualDecay >= 1)) {
      err(errors, `${p}.annualDecay`, 'should be a fraction in [0, 1)');
    }
    if (typeof seg.per10kMilesAdj === 'number' && seg.per10kMilesAdj > 0) {
      err(errors, `${p}.per10kMilesAdj`, 'should be zero or negative (higher miles → lower price)');
    }
    if (typeof seg.ageFloor === 'number' && typeof seg.ageCeiling === 'number' && seg.ageFloor > seg.ageCeiling) {
      err(errors, p, 'ageFloor must be <= ageCeiling');
    }
    if (typeof seg.milesFloor === 'number' && typeof seg.milesCeiling === 'number' && seg.milesFloor > seg.milesCeiling) {
      err(errors, p, 'milesFloor must be <= milesCeiling');
    }
  });
  return { ok: errors.length === 0, errors, ids: [...ids] };
}

export function validateModels(modelsDoc, segmentIds) {
  const errors = [];
  if (!isPlainObject(modelsDoc)) {
    return { ok: false, errors: ['models: document must be an object'] };
  }
  if (typeof modelsDoc.placeholder !== 'boolean') {
    err(errors, 'models.placeholder', 'must be a boolean');
  }
  const list = modelsDoc.models;
  if (!Array.isArray(list) || !list.length) {
    err(errors, 'models.models', 'must be a non-empty array');
    return { ok: false, errors };
  }
  const ids = new Set();
  const allowedCurves = segmentIds ? new Set(segmentIds) : null;
  list.forEach((model, i) => {
    const p = `models[${i}]`;
    if (!isPlainObject(model)) {
      err(errors, p, 'must be an object');
      return;
    }
    for (const key of MODEL_REQUIRED) {
      if (!(key in model)) err(errors, p, `missing ${key}`);
    }
    if (typeof model.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model.id)) {
      err(errors, `${p}.id`, 'must be a kebab-case id');
    } else if (ids.has(model.id)) {
      err(errors, `${p}.id`, `duplicate id "${model.id}"`);
    } else ids.add(model.id);
    for (const s of ['make', 'model', 'bodyType']) {
      if (typeof model[s] !== 'string' || !model[s].trim()) err(errors, `${p}.${s}`, 'must be a non-empty string');
    }
    if (model.segment && !ALLOWED_SEGMENTS.includes(model.segment)) {
      err(errors, `${p}.segment`, `unknown segment "${model.segment}"`);
    }
    if (!Array.isArray(model.fuels) || model.fuels.length === 0) {
      err(errors, `${p}.fuels`, 'must be a non-empty array');
    } else {
      model.fuels.forEach((f, j) => {
        if (!ALLOWED_FUELS.includes(f)) err(errors, `${p}.fuels[${j}]`, `unknown fuel "${f}"`);
      });
    }
    if (typeof model.refPrice !== 'number' || !Number.isFinite(model.refPrice) || model.refPrice <= 0) {
      err(errors, `${p}.refPrice`, 'must be a positive number (GBP)');
    }
    if (model.refAge !== 3) err(errors, `${p}.refAge`, 'v1 reference age must be 3');
    if (model.refMiles !== 30000) err(errors, `${p}.refMiles`, 'v1 reference mileage must be 30000');
    if (typeof model.placeholder !== 'boolean') {
      err(errors, `${p}.placeholder`, 'must be a boolean');
    } else if (model.placeholder !== true && modelsDoc.placeholder === true) {
      err(errors, `${p}.placeholder`, 'seed is still flagged as placeholder overall, but this row is not');
    }
    if (typeof model.curveId !== 'string') {
      err(errors, `${p}.curveId`, 'must be a string');
    } else if (allowedCurves && !allowedCurves.has(model.curveId)) {
      err(errors, `${p}.curveId`, `no segment curve named "${model.curveId}"`);
    }
    checkKnownIssues(errors, p, model.knownIssues);
  });
  return { ok: errors.length === 0, errors, ids: [...ids] };
}

export function validateDataset(modelsDoc, segmentsDoc) {
  const seg = validateSegments(segmentsDoc);
  const mod = validateModels(modelsDoc, seg.ids);
  const extra = validateModelExtras(modelsDoc);
  const errors = [...seg.errors, ...mod.errors, ...extra.errors];
  return { ok: errors.length === 0, errors };
}


export const ALLOWED_GEARBOXES = Object.freeze(['manual', 'auto']);

export function validateOptionalStringList(errors, prefix, value, allowed, label) {
  if (value == null) return;
  if (!Array.isArray(value) || value.length === 0) {
    err(errors, prefix, `${label} must be a non-empty array when present`);
    return;
  }
  value.forEach((item, j) => {
    if (typeof item !== 'string' || !item.trim()) {
      err(errors, `${prefix}[${j}]`, 'must be a non-empty string');
    } else if (allowed && !allowed.includes(item)) {
      err(errors, `${prefix}[${j}]`, `unknown ${label.slice(0, -1)} "${item}"`);
    }
  });
}

/** Extra model-field checks for optional engines / gearboxes suggestion lists. */
export function validateModelExtras(modelsDoc) {
  const errors = [];
  const list = modelsDoc?.models;
  if (!Array.isArray(list)) return { ok: true, errors };
  list.forEach((model, i) => {
    const p = `models[${i}]`;
    if (model.engines) validateOptionalStringList(errors, `${p}.engines`, model.engines, null, 'engines');
    if (model.gearboxes) validateOptionalStringList(errors, `${p}.gearboxes`, model.gearboxes, ALLOWED_GEARBOXES, 'gearboxes');
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Soft-validate a garage KB document. Unknown field names are allowed
 * (see src/kb.js). Placeholder / needs-Ethan-check entries are valid.
 */
export function validateKb(doc) {
  const errors = [];
  if (doc == null) return { ok: false, errors: ['kb: document is missing'] };
  const list = Array.isArray(doc) ? doc : (doc.entries || doc.items || doc.records || doc.knowledge || doc.kb);
  if (!Array.isArray(list) || !list.length) {
    errors.push('kb: expected a non-empty entries array (or a top-level array)');
    return { ok: false, errors };
  }
  list.forEach((entry, i) => {
    const p = `kb[${i}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${p}: must be an object`);
      return;
    }
    const model = entry.model || entry.modelName || entry.name;
    if (typeof model !== 'string' || !model.trim()) errors.push(`${p}: missing model`);
    const hasYears = entry.years != null || entry.yearRange != null || entry.yearFrom != null || entry.year_from != null;
    if (!hasYears) errors.push(`${p}: missing years / year range`);
    const engine = entry.engine || entry.engineSize || entry.engine_size || entry.engines;
    if (engine == null || engine === '') errors.push(`${p}: missing engine`);
    const conf = entry.confidence ?? entry.status ?? entry.verification ?? entry.verified;
    if (conf != null && typeof conf !== 'string' && typeof conf !== 'boolean') {
      errors.push(`${p}: confidence must be a string or boolean`);
    }
  });
  return { ok: errors.length === 0, errors };
}
