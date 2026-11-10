/**
 * Derived insights from official DVLA / DVSA vehicle data.
 * Wording is neutral ("worth checking") — never an accusation.
 */
import { formatMiles } from './score.js';

const KM_TO_MILES = 0.621371;
export const LOW_MILES_PER_YEAR = 3000;
export const HIGH_MILES_PER_YEAR = 20000;
export const MOT_DUE_SOON_DAYS = 30;
export const V5C_RECENT_DAYS = 30;
export const MOT_GAP_DAYS = 425; // a little over 14 months
export const MIN_AGE_YEARS_FOR_MILEAGE_FLAG = 2;

export function odometerToMiles(value, unit) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  const u = String(unit || 'MI').toUpperCase();
  if (u === 'KM' || u.startsWith('KILOMET')) return Math.round(n * KM_TO_MILES);
  return Math.round(n);
}

export function formatIsoDate(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function daysBetween(a, b) {
  const da = Date.parse(String(a).slice(0, 10));
  const db = Date.parse(String(b).slice(0, 10));
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}

function yearsBetween(a, b) {
  const days = daysBetween(a, b);
  if (days == null) return null;
  return days / 365.25;
}

function startDateForAge(vehicle) {
  return vehicle?.firstUsedDate || vehicle?.registrationDate || vehicle?.manufactureDate
    || (vehicle?.yearOfManufacture ? `${vehicle.yearOfManufacture}-06-30` : null)
    || (vehicle?.year ? `${vehicle.year}-06-30` : null);
}

/**
 * Chronological mileage points for a simple chart (oldest first).
 */
export function mileageHistory(tests = []) {
  const points = [];
  for (const t of tests) {
    const miles = t.odometerMiles != null ? t.odometerMiles : odometerToMiles(t.odometerValue, t.odometerUnit);
    const date = t.date || (t.completedDate ? String(t.completedDate).slice(0, 10) : null);
    if (miles == null || !date) continue;
    points.push({
      date,
      miles,
      result: t.result || null,
    });
  }
  points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return points;
}

export function annualMileageRate(points, vehicle = {}, now = new Date()) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return null;
  const latest = list[list.length - 1];
  const start = list.length >= 2 ? list[0].date : startDateForAge(vehicle);
  const end = latest.date || isoDate(now);
  if (!start) return null;
  const years = yearsBetween(start, end);
  if (years == null || years < 0.25) return null;
  const spanMiles = list.length >= 2 ? (latest.miles - list[0].miles) : latest.miles;
  if (spanMiles == null || spanMiles < 0) return null;
  const perYear = spanMiles / years;
  return {
    milesPerYear: Math.round(perYear),
    years: Math.round(years * 10) / 10,
    fromDate: start,
    toDate: end,
    miles: spanMiles,
    latestMiles: latest.miles,
  };
}

function isoDate(now) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ADVISORY_CATEGORIES = [
  { id: 'tyres', label: 'tyres', pattern: /\b(tyre|tire|tread)\b/i },
  { id: 'brakes', label: 'brakes', pattern: /\b(brake|brakes|pads?|discs?|disks?|\babs\b)\b/i },
  { id: 'suspension', label: 'suspension', pattern: /\b(suspension|shock|spring|wishbone|bush(?:es)?|arm|damper|strut)\b/i },
  { id: 'corrosion', label: 'corrosion', pattern: /\b(corrosion|corroded|rust(?:y|ed)?|sills?)\b/i },
];

function flag(id, severity, text, facts) {
  return { id, severity, text, facts };
}

export function vehicleFlags(vehicle, { now = new Date() } = {}) {
  const flags = [];
  if (!vehicle) return flags;
  const today = isoDate(now);
  const tests = Array.isArray(vehicle.motTests) ? [...vehicle.motTests] : [];
  tests.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const points = mileageHistory(tests);

  for (let i = 1; i < points.length; i += 1) {
    if (points[i].miles < points[i - 1].miles) {
      flags.push(flag('odometer-down', 'warn',
        `The recorded mileage went down between MOT tests, from ${formatMiles(points[i - 1].miles)} on ${formatIsoDate(points[i - 1].date)} to ${formatMiles(points[i].miles)} on ${formatIsoDate(points[i].date)}. Worth checking with the seller.`,
        { fromMiles: points[i - 1].miles, fromDate: points[i - 1].date, toMiles: points[i].miles, toDate: points[i].date },
      ));
    }
  }

  const rate = annualMileageRate(points, vehicle, now);
  const ageYears = yearsBetween(startDateForAge(vehicle), today);
  if (rate && ageYears != null && ageYears >= MIN_AGE_YEARS_FOR_MILEAGE_FLAG) {
    if (rate.milesPerYear < LOW_MILES_PER_YEAR) {
      flags.push(flag('low-mileage', 'info',
        `The latest MOT mileage is ${formatMiles(rate.latestMiles)} over about ${rate.years} years, around ${formatMiles(rate.milesPerYear)} a year, which is unusually low. Worth checking it matches the service history.`,
        { latestMiles: rate.latestMiles, milesPerYear: rate.milesPerYear, years: rate.years },
      ));
    } else if (rate.milesPerYear > HIGH_MILES_PER_YEAR) {
      flags.push(flag('high-mileage', 'info',
        `The latest MOT mileage is ${formatMiles(rate.latestMiles)} over about ${rate.years} years, around ${formatMiles(rate.milesPerYear)} a year, which is unusually high. Worth checking the condition and service history.`,
        { latestMiles: rate.latestMiles, milesPerYear: rate.milesPerYear, years: rate.years },
      ));
    }
  }

  if (vehicle.failCount > 0) {
    const failed = tests.filter((t) => t.result === 'FAILED');
    const latestFail = failed[0];
    const n = vehicle.failCount;
    flags.push(flag('mot-fails', 'warn',
      `This car has ${n} failed MOT${n === 1 ? '' : 's'} on record${latestFail?.date ? `, most recently on ${formatIsoDate(latestFail.date)}` : ''}. Worth checking those items were fixed.`,
      { failCount: n, latestFailDate: latestFail?.date || null },
    ));
  }

  const byCategory = new Map();
  for (const t of tests) {
    const texts = (t.defects || []).map((d) => d.text || '').filter(Boolean);
    if (!texts.length) continue;
    for (const cat of ADVISORY_CATEGORIES) {
      if (texts.some((tx) => cat.pattern.test(tx))) {
        if (!byCategory.has(cat.id)) byCategory.set(cat.id, { ...cat, dates: [] });
        byCategory.get(cat.id).dates.push(t.date);
      }
    }
  }
  for (const cat of byCategory.values()) {
    const uniqueDates = [...new Set(cat.dates.filter(Boolean))];
    if (uniqueDates.length < 2) continue;
    flags.push(flag('recurring-advisories', 'info',
      `Notes about ${cat.label} have come up on ${uniqueDates.length} MOT tests (${uniqueDates.map(formatIsoDate).join(', ')}). Worth checking the current condition.`,
      { category: cat.id, dates: uniqueDates },
    ));
  }

  const chrono = [...tests].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  for (let i = 1; i < chrono.length; i += 1) {
    const gap = daysBetween(chrono[i - 1].date, chrono[i].date);
    if (gap != null && gap > MOT_GAP_DAYS) {
      const months = Math.round(gap / 30.44);
      flags.push(flag('mot-gap', 'info',
        `There was a gap of about ${months} months between MOTs (${formatIsoDate(chrono[i - 1].date)} to ${formatIsoDate(chrono[i].date)}). Worth checking why.`,
        { fromDate: chrono[i - 1].date, toDate: chrono[i].date, days: gap },
      ));
    }
  }

  const expiry = vehicle.motExpiryDate || tests.find((t) => t.result === 'PASSED' && t.expiryDate)?.expiryDate || null;
  if (expiry) {
    const remaining = daysBetween(today, expiry);
    if (remaining != null && remaining < 0) {
      flags.push(flag('mot-expired', 'warn',
        `The MOT expired on ${formatIsoDate(expiry)}. Worth checking there is a new certificate before you buy.`,
        { motExpiryDate: expiry, days: remaining },
      ));
    } else if (remaining != null && remaining <= MOT_DUE_SOON_DAYS) {
      flags.push(flag('mot-due-soon', 'info',
        `The MOT expires on ${formatIsoDate(expiry)} (${remaining === 0 ? 'today' : `in ${remaining} day${remaining === 1 ? '' : 's'}`}). Worth checking.`,
        { motExpiryDate: expiry, days: remaining },
      ));
    }
  } else if (vehicle.motStatus && /not valid/i.test(vehicle.motStatus)) {
    flags.push(flag('mot-expired', 'warn',
      'DVLA lists the MOT as not valid. Worth checking there is a current certificate.',
      { motStatus: vehicle.motStatus },
    ));
  } else if (vehicle.motTestDueDate) {
    const remaining = daysBetween(today, vehicle.motTestDueDate);
    if (remaining != null && remaining < 0) {
      flags.push(flag('mot-expired', 'warn',
        `The first MOT was due on ${formatIsoDate(vehicle.motTestDueDate)}. Worth checking there is a current certificate.`,
        { motTestDueDate: vehicle.motTestDueDate, days: remaining },
      ));
    } else if (remaining != null && remaining <= MOT_DUE_SOON_DAYS) {
      flags.push(flag('mot-due-soon', 'info',
        `The first MOT is due on ${formatIsoDate(vehicle.motTestDueDate)}. Worth checking.`,
        { motTestDueDate: vehicle.motTestDueDate, days: remaining },
      ));
    }
  }

  const tax = (vehicle.taxStatus || vehicle.vehicleStatus || '').toLowerCase();
  if (/\bsorn\b/.test(tax)) {
    flags.push(flag('tax-sorn', 'warn',
      'DVLA lists this vehicle as SORN. Worth checking it can legally be used on the road.',
      { taxStatus: vehicle.taxStatus || vehicle.vehicleStatus },
    ));
  } else if (/untaxed|not taxed/.test(tax)) {
    flags.push(flag('tax-untaxed', 'warn',
      'DVLA lists this vehicle as untaxed. Worth checking the tax status before you buy.',
      { taxStatus: vehicle.taxStatus || vehicle.vehicleStatus },
    ));
  }

  if (vehicle.markedForExport === true) {
    flags.push(flag('marked-export', 'warn',
      'DVLA has marked this vehicle for export. Worth checking before you buy.',
      { markedForExport: true },
    ));
  }
  if (vehicle.markedAsScrapped === true) {
    flags.push(flag('marked-scrapped', 'warn',
      'DVLA has marked this vehicle as scrapped. Worth checking before you buy.',
      { markedAsScrapped: true },
    ));
  }

  if (vehicle.dateOfLastV5CIssued) {
    const age = daysBetween(vehicle.dateOfLastV5CIssued, today);
    if (age != null && age >= 0 && age <= V5C_RECENT_DAYS) {
      flags.push(flag('v5c-recent', 'info',
        `The logbook (V5C) was last issued on ${formatIsoDate(vehicle.dateOfLastV5CIssued)}, which is recent. Worth checking the seller is the registered keeper.`,
        { dateOfLastV5CIssued: vehicle.dateOfLastV5CIssued, days: age },
      ));
    }
  }

  if (vehicle.hasOutstandingRecall === 'Yes') {
    flags.push(flag('outstanding-recall', 'warn',
      'DVSA records at least one outstanding recall on this vehicle. Worth checking it has been (or will be) fixed.',
      { hasOutstandingRecall: vehicle.hasOutstandingRecall },
    ));
  }

  return flags;
}

function normName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function modelsDisagree(plateModel, listingModel) {
  const a = normName(plateModel);
  const b = normName(listingModel);
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false;
  const tokens = (s) => s.split(' ').filter(Boolean);
  const at = tokens(a);
  const bt = tokens(b);
  // Same first token (often the core model, e.g. "408") plus overlap is a match.
  const overlap = at.filter((t) => bt.includes(t));
  if (overlap.length >= 1 && (at[0] === bt[0] || overlap.length >= 2)) return false;
  return true;
}

export function yearsDisagree(a, b) {
  if (a == null || a === '' || b == null || b === '') return false;
  const ya = Number(a);
  const yb = Number(b);
  if (!Number.isFinite(ya) || !Number.isFinite(yb)) return false;
  return ya !== yb;
}

export function engineFromCapacity(cc) {
  if (cc == null) return null;
  const n = Number(cc);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) {
    const litres = Math.round(n / 100) / 10;
    return `${litres} litre`;
  }
  return `${Math.round(n)} cc`;
}

/**
 * Confirm/form fields taken from official plate data.
 * Listing price and mileage, when present, should win at merge time.
 */
export function listingFieldsFromVehicle(vehicle) {
  if (!vehicle) return { fields: {} };
  const mileageDate = vehicle.latestOdometerDate;
  const fields = {};
  const set = (key, value, source, confidence, sourceLabel) => {
    if (value == null || value === '') return;
    fields[key] = { value, source, confidence, ...(sourceLabel ? { sourceLabel } : {}) };
  };
  set('make', vehicle.make, 'dvla-ves', 0.95);
  // Model comes from MOT history (VES has no model).
  set('model', vehicle.model, 'dvsa-mot', 0.95);
  if (!fields.make && vehicle.make) set('make', vehicle.make, 'dvsa-mot', 0.95);
  set('year', vehicle.year || vehicle.yearOfManufacture, 'dvla-ves', 0.95);
  set('fuel', vehicle.fuelType, vehicle.fuelType ? 'dvsa-mot' : 'dvla-ves', 0.9);
  set('engine', engineFromCapacity(vehicle.engineCapacity), 'dvla-ves', 0.85);
  if (vehicle.latestOdometerMiles != null) {
    const label = mileageDate
      ? `last MOT on ${formatIsoDate(mileageDate)} — enter current mileage if different`
      : 'last MOT — enter current mileage if different';
    set('mileage', vehicle.latestOdometerMiles, 'mot-odometer', 0.8, label);
  }
  return {
    make: fields.make?.value ?? null,
    model: fields.model?.value ?? null,
    year: fields.year?.value ?? null,
    fuel: fields.fuel?.value ?? null,
    engine: fields.engine?.value ?? null,
    mileage: fields.mileage?.value ?? null,
    price: null,
    gearbox: null,
    fields,
    mileageNote: fields.mileage?.sourceLabel || null,
  };
}

const LISTING_KEYS = ['make', 'model', 'year', 'mileage', 'fuel', 'price', 'engine', 'gearbox'];

function fieldValue(input, key) {
  const fromMap = input?.fields?.[key];
  if (fromMap && typeof fromMap === 'object' && 'value' in fromMap) return fromMap.value;
  const v = input?.[key];
  if (v && typeof v === 'object' && 'value' in v && !Array.isArray(v)) return v.value;
  return v ?? null;
}

function isBlank(value) {
  return value == null || value === '';
}

/**
 * Combine official plate data with a pasted/extracted listing.
 * Listing price and mileage win; plate data fills gaps. Warns if year or
 * model disagree with DVLA/DVSA.
 */
export function mergePlateAndListing(vehicle, listing) {
  const fromPlate = listingFieldsFromVehicle(vehicle);
  const listingObj = listing && typeof listing === 'object' ? listing : {};
  const fields = { ...fromPlate.fields };
  const out = {
    make: fromPlate.make,
    model: fromPlate.model,
    year: fromPlate.year,
    mileage: fromPlate.mileage,
    fuel: fromPlate.fuel,
    engine: fromPlate.engine,
    price: null,
    gearbox: null,
  };

  const listingYear = fieldValue(listingObj, 'year');
  const listingModel = fieldValue(listingObj, 'model');
  const listingMake = fieldValue(listingObj, 'make');

  for (const key of LISTING_KEYS) {
    const listingVal = fieldValue(listingObj, key);
    if (isBlank(listingVal)) continue;
    const fromListing = listingObj.fields?.[key];
    const source = (fromListing && fromListing.source) || listingObj.source || 'pasted-text';
    const confidence = (fromListing && fromListing.confidence) || 0.8;
    if (key === 'price' || key === 'mileage' || isBlank(out[key])) {
      out[key] = listingVal;
      fields[key] = { value: listingVal, source, confidence };
    }
  }

  const warnings = [];
  if (yearsDisagree(fromPlate.year, listingYear)) {
    warnings.push(`The listing year (${listingYear}) does not match the official record (${fromPlate.year}). Worth checking.`);
  }
  if (modelsDisagree(fromPlate.model, listingModel) || modelsDisagree(fromPlate.make, listingMake)) {
    const official = [fromPlate.make, fromPlate.model].filter(Boolean).join(' ');
    const listed = [listingMake, listingModel].filter(Boolean).join(' ');
    warnings.push(`The listing describes this as ${listed}, but the official record is ${official}. Worth checking.`);
  }

  return {
    ...out,
    fields,
    mileageNote: out.mileage === fromPlate.mileage ? fromPlate.mileageNote : null,
    warnings,
    fromPlate: true,
  };
}

export function motSummaryLine(vehicle) {
  if (!vehicle) return '';
  const parts = [];
  const expiry = vehicle.motExpiryDate;
  const status = vehicle.motStatus || '';
  if (/sorn/i.test(vehicle.taxStatus || '')) parts.push('SORN');
  else if (/untaxed|not taxed/i.test(vehicle.taxStatus || '')) parts.push('Untaxed');
  else if (/^taxed$/i.test(vehicle.taxStatus || '')) parts.push('Taxed');

  if (expiry) {
    const valid = /valid/i.test(status) || !/not valid/i.test(status);
    parts.push(valid ? `MOT until ${formatIsoDate(expiry)}` : `MOT expired ${formatIsoDate(expiry)}`);
  } else if (/valid/i.test(status) && !/not valid/i.test(status) && !/no details|no results/i.test(status)) {
    parts.push('MOT valid');
  } else if (/not valid/i.test(status)) {
    parts.push('MOT not valid');
  }

  if (vehicle.testCount > 0) {
    const fails = vehicle.failCount || 0;
    const passes = Math.max(0, vehicle.testCount - fails);
    if (fails) parts.push(`${fails} MOT fail${fails === 1 ? '' : 's'}`);
    else parts.push(`${passes} MOT pass${passes === 1 ? '' : 'es'}`);
  }
  return parts.join(' · ');
}
