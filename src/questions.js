/**
 * "Questions to ask the garage" — rule-based, no paid AI.
 *
 * Accuracy rules (enforced here and in tests):
 * 1. Model-specific facts (belt/chain, official interval, known issues) are
 *    shown only when a KB entry matches make + model + year-range + engine
 *    AND confidence is 'verified'.
 * 2. Entries marked 'needs-Ethan-check' are never shown to users, except
 *    behind a ?review=1 dev flag, where they are clearly badged.
 * 3. No match (including missing engine, year-range miss, engine mismatch)
 *    → only generic questions, labelled:
 *    "Generic questions (we don't have specific data for this engine yet)"
 * 4. Never guess. A bare "1.0" does not match a named "1.0 EcoBoost" entry.
 * 5. Phrase model-specific items as things to ASK, never as claims about
 *    that particular car.
 * 6. Return 8–10 questions, most relevant first.
 */

import { ageYears } from './score.js';
import { formatIntervalText, findKbMatches, loadKb } from './kb.js';
import { normaliseFuel, normaliseGearbox } from './parse.js';

export const GENERIC_LABEL = "Generic questions (we don't have specific data for this engine yet)";
export const SPECIFIC_LABEL = 'Questions to ask the garage';
export const REVIEW_BADGE = 'Needs Ethan check';
export const MIN_QUESTIONS = 8;
export const MAX_QUESTIONS = 10;

const GENERIC_FALLBACK = Object.freeze([
  { id: 'hpi', text: "Has it been HPI checked? I want to know it's not on finance and has a clean title." },
  { id: 'service', text: "Can I see a full service history? When was it last serviced, and is anything due?" },
  { id: 'mot', text: "What's the MOT history like — any advisories or recent failures I should know about?" },
  { id: 'owners', text: 'How many owners has it had, and have you had it long?' },
  { id: 'v5c', text: "Is the V5C in your name, and can I see it before I pay?" },
  { id: 'spare-key', text: 'Are both keys available, including a spare?' },
  { id: 'warranty', text: 'Is there any warranty left, or a dealer warranty with the sale? What’s covered?' },
  { id: 'tyres-brakes', text: 'What are the tyres and brakes like — any imminent replacements?' },
  { id: 'negotiate', text: 'Is there any room on the price if I move quickly?' },
  { id: 'service-stamps', text: 'Is the service history stamped or digital, and are there any gaps?' },
]);

function fuelOf(listing) {
  return normaliseFuel(listing.fuel) || normaliseFuel(listing.modelObj?.fuel) || null;
}

function gearboxOf(listing) {
  return normaliseGearbox(listing.gearbox || listing.transmission) || null;
}

function annualMiles(mileage, age) {
  if (!Number.isFinite(mileage) || !Number.isFinite(age) || age <= 0) return null;
  return mileage / age;
}

function maybeUlez(year, fuel) {
  if (!Number.isFinite(year)) return 'unknown';
  // London ULEZ rule of thumb: petrol typically Euro 4 from ~2006; diesel Euro 6 from ~2015.
  if (fuel === 'diesel') return year <= 2014 ? 'unlikely' : 'likely';
  if (fuel === 'petrol' || fuel === 'hybrid' || fuel === 'phev') return year <= 2005 ? 'unlikely' : 'likely';
  if (fuel === 'electric') return 'exempt';
  return 'unknown';
}

function timingQuestion(entry) {
  const interval = formatIntervalText(entry.interval);
  if (entry.timingType === 'belt-in-oil') {
    const due = interval ? ` The manufacturer interval is ${interval}.` : '';
    return `Has the wet belt (belt-in-oil) been changed?${due} Any record of oil-dilution checks?`;
  }
  if (entry.timingType === 'belt') {
    const due = interval ? ` The manufacturer interval is ${interval}.` : '';
    return `Has the cambelt been changed?${due}`;
  }
  if (entry.timingType === 'chain') {
    return 'Is this a timing-chain engine, and has any chain or tensioner work been done?';
  }
  if (interval) {
    return `When was the timing belt or chain last done? The manufacturer interval on file is ${interval}.`;
  }
  return null;
}

function issueQuestion(note) {
  const cleaned = String(note).trim().replace(/\.$/, '');
  return `I've read this engine can have ${cleaned}. Has that been checked or addressed on this car?`;
}

/**
 * Build scored candidate questions from attributes + optional verified KB facts.
 * Higher score = more relevant, listed first.
 */
export function candidateQuestions(listing, { now = new Date(), kbMatches = [], reviewMatches = [] } = {}) {
  const year = Number(listing.year);
  const mileage = Number(listing.mileage);
  const age = Number.isFinite(year) ? ageYears(year, now) : null;
  const fuel = fuelOf(listing);
  const gearbox = gearboxOf(listing);
  const score = Number(listing.score);
  const verdictId = listing.verdict?.id || listing.verdictId || null;
  const annual = annualMiles(mileage, age);
  const out = [];
  const add = (id, priority, text, extra = {}) => {
    if (!text) return;
    out.push({ id, priority, text, kind: extra.kind || 'generic', review: Boolean(extra.review), source: extra.source || null });
  };

  // --- Model-specific (verified) ---
  for (const [i, entry] of kbMatches.entries()) {
    const q = timingQuestion(entry);
    add(`kb-timing-${i}`, 100, q, { kind: 'specific', source: entry.source });
    entry.knownIssues.forEach((note, j) => {
      add(`kb-issue-${i}-${j}`, 98 - j, issueQuestion(note), { kind: 'specific', source: entry.source });
    });
  }

  // --- Review-only unverified (dev flag) ---
  for (const [i, entry] of reviewMatches.entries()) {
    const q = timingQuestion(entry);
    if (q) {
      add(`review-timing-${i}`, 97, `${q} [${REVIEW_BADGE}]`, { kind: 'review', review: true, source: entry.source });
    }
    entry.knownIssues.forEach((note, j) => {
      add(`review-issue-${i}-${j}`, 96 - j, `${issueQuestion(note)} [${REVIEW_BADGE}]`, { kind: 'review', review: true, source: entry.source });
    });
  }

  // --- Fuel / emissions ---
  if (fuel === 'diesel') {
    const lightDuty = annual != null && annual < 6000 && age != null && age >= 3;
    add(
      'dpf',
      lightDuty ? 96 : 88,
      lightDuty
        ? "It's done fairly light mileage for a diesel — has it had regular longer runs so the DPF can regenerate properly? Any warning lights, or has the DPF been cleaned or replaced?"
        : 'Has the DPF been a problem? Any regeneration issues, warning lights, or has it been cleaned or replaced?',
    );
  }

  const ulez = maybeUlez(year, fuel);
  if (ulez === 'unlikely') {
    add(
      'ulez',
      90,
      fuel === 'diesel'
        ? "Is this diesel ULEZ-compliant (Euro 6)? A lot of pre-2015 diesels aren't. I'll need that confirmed if I drive in London."
        : "Is this petrol car ULEZ-compliant? I'll need that confirmed if I'm driving in London.",
    );
  } else if (ulez === 'likely' || ulez === 'unknown') {
    add('ulez-confirm', 48, 'Can you confirm the emissions standard and whether it is ULEZ-compliant?');
  }

  if (fuel === 'hybrid' || fuel === 'phev' || fuel === 'electric') {
    add(
      'battery',
      93,
      fuel === 'electric'
        ? "What's the battery health like, and is there any remaining battery warranty? Any record of charging or range issues?"
        : "What's the hybrid battery health like, and is there any remaining battery warranty?",
    );
  }

  // --- Mileage / age ---
  if (Number.isFinite(mileage) && mileage >= 100000) {
    add('high-miles', 80, 'At this mileage, has the clutch, turbo or gearbox had any work? Any signs of oil use or smoke?');
  } else if (Number.isFinite(mileage) && mileage >= 80000) {
    add('mid-miles', 62, 'Has anything major been done at this mileage — clutch, turbo, suspension or a recent service?');
  }
  if (age != null && age >= 7 && annual != null && annual < 5000) {
    add('low-miles-old', 85, "It's done low miles for its age. Has it stood unused for long stretches? Any rust, perished tyres or seized brakes?");
  }

  // Generic cambelt prompt only when we do NOT already have a specific timing fact.
  if (!kbMatches.length) {
    add('cambelt-generic', 58, "Is the engine a cambelt or a chain? If it's a belt, when was it last changed and at what mileage?");
  }

  // --- Gearbox ---
  if (gearbox === 'auto') {
    add('gearbox-auto', 66, 'Has the automatic gearbox been serviced, and have there been any jerks, slips or warning lights?');
  } else if (gearbox === 'manual') {
    add('clutch', 64, "How's the clutch — biting point, slip, or has it been replaced?");
  }

  // --- Always-useful UK used-car checks ---
  const bargain = verdictId === 'bargain' || (Number.isFinite(score) && score >= 80);
  const overpriced = verdictId === 'overpriced' || (Number.isFinite(score) && score < 30);
  const good = verdictId === 'good';

  add(
    'hpi',
    bargain ? 97 : 86,
    bargain
      ? "It's priced keenly — has it been HPI checked? I want to know it's not on finance, not a write-off, and has a clean title."
      : "Has it been HPI checked? I want to know it's not on finance and has a clean title.",
  );

  add(
    'service',
    (age != null && age >= 6) || (Number.isFinite(mileage) && mileage >= 80000) ? 91 : 84,
    'Can I see a full service history? When was it last serviced, and is anything due?',
  );

  if (age == null || age >= 3) {
    add('mot', 87, "What's the MOT history like — any advisories or recent failures I should know about?");
  } else {
    add('first-mot', 60, "When is the first MOT due, and has it had a pre-MOT or inspection?");
  }

  add('v5c', 82, "Is the V5C in your name, and can I see it before I pay?");
  add('owners', 70, 'How many owners has it had, and have you had it long?');
  add('spare-key', 61, 'Are both keys available, including a spare?');

  add(
    'warranty',
    age != null && age <= 3 ? 78 : age != null && age <= 6 ? 68 : 52,
    'Is there any warranty left, or a dealer warranty with the sale? What’s covered?',
  );

  if (overpriced) {
    add('negotiate', 95, 'The asking price looks high against similar cars. What flexibility is there on the price?');
  } else if (bargain) {
    add('negotiate', 89, "It's priced keenly — is there a reason it's at this money? Any issues I should know about?");
  } else if (good) {
    add('negotiate', 72, "What's the best price you can do today?");
  } else {
    add('negotiate', 65, 'Is there any room on the price if I move quickly?');
  }

  add('tyres-brakes', Number.isFinite(mileage) && mileage >= 80000 ? 63 : 50, 'What are the tyres and brakes like — any imminent replacements?');

  return out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function takeQuestions(candidates, min = MIN_QUESTIONS, max = MAX_QUESTIONS) {
  const seen = new Set();
  const picked = [];
  for (const q of candidates) {
    if (seen.has(q.id) || seen.has(q.text)) continue;
    seen.add(q.id);
    seen.add(q.text);
    picked.push(q);
    if (picked.length >= max) break;
  }
  if (picked.length < min) {
    for (const g of GENERIC_FALLBACK) {
      if (seen.has(g.id) || seen.has(g.text)) continue;
      picked.push({ ...g, priority: 0, kind: 'generic', review: false, source: null });
      seen.add(g.id);
      seen.add(g.text);
      if (picked.length >= min) break;
    }
  }
  return picked.slice(0, max);
}

/**
 * @param {object} listing — { make, model, modelObj, year, mileage, fuel, engine, gearbox, asking, score, verdict }
 * @param {{ kb?: object|array, now?: Date, review?: boolean }} [options]
 * @returns {{ mode: 'specific'|'generic', label: string, questions: object[], reviewOnly: object[] }}
 */
export function garageQuestions(listing = {}, { kb, now = new Date(), review = false } = {}) {
  const loaded = loadKb(kb);
  const verified = findKbMatches(listing, loaded, { includeUnverified: false });
  const unverified = review
    ? findKbMatches(listing, loaded, { includeUnverified: true }).filter((e) => e.confidence !== 'verified')
    : [];

  const candidates = candidateQuestions(listing, {
    now,
    kbMatches: verified,
    reviewMatches: unverified,
  });
  const questions = takeQuestions(candidates);
  const mode = verified.length ? 'specific' : 'generic';
  return {
    mode,
    label: mode === 'generic' ? GENERIC_LABEL : SPECIFIC_LABEL,
    questions,
    reviewOnly: unverified,
  };
}

/**
 * Load generic question text overrides from garage-generic-questions.json if present.
 * Tolerant of an array of strings, { questions: [] }, or { id, text } objects.
 * Rule selection still lives in this module — the file only supplies wording.
 */
export function mergeGenericWording(questionsFile) {
  if (!questionsFile) return { byId: new Map(), extras: [] };
  const list = Array.isArray(questionsFile)
    ? questionsFile
    : questionsFile.questions || questionsFile.items || questionsFile.generics || [];
  const byId = new Map();
  const extras = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) extras.push(item.trim());
    else if (item && typeof item === 'object') {
      const id = item.id || item.key;
      const text = item.text || item.question || item.body;
      if (id && text) byId.set(id, text);
      else if (text) extras.push(text);
    }
  }
  return { byId, extras };
}

export function formatQuestionsText(result, heading = 'Questions to ask the garage') {
  const lines = [heading, result.label && result.mode === 'generic' ? result.label : null, '']
    .filter((x) => x !== null);
  result.questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text}`);
  });
  return lines.join('\n').trim();
}

// Re-export interval helper so tests can use one module surface if needed.
export { formatIntervalText, loadKb, findKbMatches };
