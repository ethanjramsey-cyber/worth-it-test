/**
 * "Questions to ask the garage" — rule-based, no paid AI.
 *
 * Accuracy rules (enforced here and in tests):
 * 1. Model-specific facts (belt/chain, official interval, known issues,
 *    and KB-authored questions) are shown in normal mode only when a KB
 *    row matches make + model + year-range + engine + fuel AND the
 *    individual fact is marked 'verified' (timingConfidence, interval.confidence,
 *    knownIssues[].confidence, questions[].confidence).
 * 2. Entry-level confidence / reviewStatus stays 'needs-Ethan-check' until
 *    Ethan signs the row off — that is not the show/hide switch.
 * 3. Unverified facts are never shown to users, except behind ?review=1,
 *    where they are clearly badged.
 * 4. If matched rows disagree on timing type, fall back to generic questions
 *    (labelled generic). Never guess.
 * 5. No engine / no match → only generic questions, labelled:
 *    "Generic questions (we don't have specific data for this engine yet)"
 * 6. Phrase model-specific items as things to ASK, never as claims about
 *    that particular car. Prefer the KB's own question wording when present.
 * 7. Return 8–10 questions, most relevant first.
 */

import { ageYears } from './score.js';
import {
  formatIntervalText,
  findKbMatches,
  loadKb,
  timingTypesConflict,
  isVerified,
} from './kb.js';
import { normaliseFuel, normaliseGearbox } from './parse.js';

export const GENERIC_LABEL = "Generic questions (we don't have specific data for this engine yet)";
export const SPECIFIC_LABEL = 'Questions to ask the garage';
export const REVIEW_BADGE = 'Needs Ethan check';
export const MIN_QUESTIONS = 8;
export const MAX_QUESTIONS = 10;

const GENERIC_FALLBACK = Object.freeze([
  { id: 'G01', text: "Can I see the V5C log book? Does the name and address match yours, and do the VIN and engine number match the car?" },
  { id: 'G02', text: 'Has it had a history check for outstanding finance, theft or a write-off (insurance category)? Can I run one?' },
  { id: 'G03', text: "Can I look up the MOT history? Have the advisories been fixed, and does the mileage go up steadily?" },
  { id: 'G04', text: 'Is there a full service history with stamps or invoices? When and at what mileage was it last serviced?' },
  { id: 'G05', text: 'How many previous owners has it had, and how long have you owned it?' },
  { id: 'G08', text: 'Does it come with two keys and the locking wheel nut key?' },
  { id: 'G09', text: 'Is any manufacturer or dealer warranty left, and does it transfer to me?' },
  { id: 'G12', text: 'How much tread is left on the tyres, and do they all match?' },
  { id: 'G16', text: "Does this engine have a timing belt or a chain? If it's a belt, when was it last changed and can I see the invoice?" },
  { id: 'G07', text: 'Has it ever had accident damage, paint or bodywork repairs, or any modifications?' },
]);

function fuelOf(listing) {
  return normaliseFuel(listing.fuel) || null;
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
  if (fuel === 'diesel') return year <= 2014 ? 'unlikely' : 'likely';
  if (fuel === 'petrol' || fuel === 'hybrid' || fuel === 'phev') return year <= 2005 ? 'unlikely' : 'likely';
  if (fuel === 'electric') return 'exempt';
  return 'unknown';
}

function allowFact(confidence, review) {
  return isVerified(confidence) || review;
}

function badge(text, review, confidence) {
  if (review && !isVerified(confidence)) {
    return { text: `${text} [${REVIEW_BADGE}]`, review: true, confidence };
  }
  return { text, review: false, confidence };
}

function timingQuestionFromType(entry, { review = false } = {}) {
  if (!allowFact(entry.timingConfidence, review)) return null;
  if (!entry.timingType || entry.timingType === 'unknown' || entry.timingType === 'none') return null;
  const intervalOk = entry.interval && allowFact(entry.interval.confidence, review) && formatIntervalText(entry.interval);
  const intervalBit = intervalOk ? ` The manufacturer interval is ${formatIntervalText(entry.interval)}.` : '';
  const intervalConf = intervalOk ? entry.interval.confidence : 'verified';
  // Interval is only appended when it's allowed; the question's badge follows
  // the weaker of timing vs shown interval.
  const conf = intervalOk && !isVerified(entry.interval.confidence) ? entry.interval.confidence : entry.timingConfidence;
  let text;
  if (entry.timingType === 'belt-in-oil') {
    text = `Has the wet belt (belt-in-oil) been changed?${intervalBit} Any record of oil-dilution checks?`;
  } else if (entry.timingType === 'belt') {
    text = `Has the cambelt been changed?${intervalBit}`;
  } else if (entry.timingType === 'chain') {
    text = 'Is this a timing-chain engine, and has any chain or tensioner work been done?';
  } else {
    text = intervalBit ? `When was the timing belt or chain last done? The manufacturer interval on file is ${formatIntervalText(entry.interval)}.` : null;
  }
  if (!text) return null;
  return { ...badge(text, review, conf), kind: isVerified(entry.timingConfidence) && isVerified(intervalConf) || isVerified(entry.timingConfidence) ? (isVerified(conf) ? 'specific' : 'review') : 'review' };
}

function issueQuestion(issue) {
  const cleaned = String(issue.note).trim().replace(/\.$/, '');
  return `I've read this engine can have ${cleaned}. Has that been checked or addressed on this car?`;
}

/**
 * Load generic question wording from garage-generic-questions.json.
 * Accepts an array, or { questions|items|generics: [] }.
 */
export function loadGenericQuestions(doc) {
  if (!doc) return [];
  const list = Array.isArray(doc)
    ? doc
    : doc.questions || doc.items || doc.generics || [];
  return (Array.isArray(list) ? list : [])
    .map((item, i) => {
      if (typeof item === 'string') return { id: `G-extra-${i}`, text: item.trim(), why: null, confidence: 'verified' };
      const text = item?.text || item?.question || item?.body;
      if (!text) return null;
      return {
        id: item.id || item.key || `G-extra-${i}`,
        text,
        why: item.why || null,
        confidence: item.confidence || 'verified',
      };
    })
    .filter(Boolean);
}

export function mergeGenericWording(questionsFile) {
  const list = loadGenericQuestions(questionsFile);
  const byId = new Map(list.filter((q) => q.id).map((q) => [q.id, q.text]));
  const extras = list.filter((q) => !q.id).map((q) => q.text);
  return { byId, extras };
}

function genericText(id, generics, fallback) {
  const hit = generics.find((g) => g.id === id);
  return hit?.text || fallback;
}

function candidateQuestions(listing, {
  now = new Date(),
  kbMatches = [],
  timingConflict = false,
  review = false,
  generics = [],
} = {}) {
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
    out.push({
      id,
      priority,
      text,
      kind: extra.kind || 'generic',
      review: Boolean(extra.review),
      source: extra.source || null,
      why: extra.why || null,
    });
  };

  const hasSpecific = !timingConflict && kbMatches.length > 0;

  if (hasSpecific) {
    const seenText = new Set();
    kbMatches.forEach((entry, i) => {
      for (const [j, q] of (entry.questions || []).entries()) {
        if (!allowFact(q.confidence, review)) continue;
        if (seenText.has(q.text)) continue;
        seenText.add(q.text);
        const b = badge(q.text, review, q.confidence);
        add(`kb-q-${i}-${j}`, isVerified(q.confidence) ? 100 : 94, b.text, {
          kind: isVerified(q.confidence) ? 'specific' : 'review',
          review: b.review,
          source: q.source,
          why: q.why,
        });
      }
      for (const [j, issue] of (entry.knownIssues || []).entries()) {
        if (!allowFact(issue.confidence, review)) continue;
        const text = issueQuestion(issue);
        if (seenText.has(text)) continue;
        seenText.add(text);
        const b = badge(text, review, issue.confidence);
        add(`kb-issue-${i}-${j}`, isVerified(issue.confidence) ? 98 : 93, b.text, {
          kind: isVerified(issue.confidence) ? 'specific' : 'review',
          review: b.review,
          source: issue.source,
        });
      }
      // Generated timing prompt only if no KB question already covers it
      // and timingConfidence allows it.
      const alreadyTiming = [...seenText].some((t) => /timing belt|cambelt|wet belt|timing-chain|timing chain/i.test(t));
      if (!alreadyTiming) {
        const tq = timingQuestionFromType(entry, { review });
        if (tq && !seenText.has(tq.text)) {
          seenText.add(tq.text);
          add(`kb-timing-${i}`, tq.review ? 92 : 99, tq.text, {
            kind: tq.review ? 'review' : 'specific',
            review: tq.review,
            source: entry.source,
          });
        }
      }
    });
  } else if (review && timingConflict) {
    add(
      'timing-conflict',
      95,
      `Our notes disagree on whether this engine is a belt or a chain for this year — treat belt/chain questions as unconfirmed. [${REVIEW_BADGE}]`,
      { kind: 'review', review: true },
    );
  }

  if (fuel === 'diesel') {
    const lightDuty = annual != null && annual < 6000 && age != null && age >= 3;
    add(
      'dpf',
      lightDuty ? 91 : 80,
      lightDuty
        ? "It's done fairly light mileage for a diesel — has it had regular longer runs so the DPF can regenerate properly? Any warning lights, or has the DPF been cleaned or replaced?"
        : 'Has the DPF been a problem? Any regeneration issues, warning lights, or has it been cleaned or replaced?',
    );
  }

  const ulez = maybeUlez(year, fuel);
  if (ulez === 'unlikely') {
    add('G11', 88, genericText('G11', generics, "Is it ULEZ / Clean Air Zone compliant? Can I check the reg on TfL's checker?"));
  } else if (ulez === 'likely' || ulez === 'unknown') {
    add('G11', 48, genericText('G11', generics, "Is it ULEZ / Clean Air Zone compliant? Can I check the reg on TfL's checker?"));
  }

  if (fuel === 'hybrid' || fuel === 'phev' || fuel === 'electric') {
    add(
      'battery',
      90,
      fuel === 'electric'
        ? "What's the battery health like, and is there any remaining battery warranty? Any record of charging or range issues?"
        : "What's the hybrid battery health like, and is there any remaining battery warranty?",
    );
  }

  if (Number.isFinite(mileage) && mileage >= 100000) {
    add('high-miles', 74, 'At this mileage, has the clutch, turbo or gearbox had any work? Any signs of oil use or smoke?');
  }
  if (age != null && age >= 7 && annual != null && annual < 5000) {
    add('low-miles-old', 78, "It's done low miles for its age. Has it stood unused for long stretches? Any rust, perished tyres or seized brakes?");
  }

  const hasTimingSpecific = out.some((q) => q.kind === 'specific' && /timing belt|cambelt|wet belt|timing-chain|timing chain/i.test(q.text));
  if (!hasTimingSpecific) {
    add('G16', 58, genericText('G16', generics, "Does this engine have a timing belt or a chain? If it's a belt, when was it last changed and can I see the invoice?"));
  }

  if (gearbox === 'auto') {
    add('gearbox-auto', 66, 'Has the automatic gearbox been serviced, and have there been any jerks, slips or warning lights?');
  } else if (gearbox === 'manual') {
    add('clutch', 64, "How's the clutch — biting point, slip, or has it been replaced?");
  }

  const bargain = verdictId === 'bargain' || (Number.isFinite(score) && score >= 80);
  const overpriced = verdictId === 'overpriced' || (Number.isFinite(score) && score < 30);
  const good = verdictId === 'good';

  add(
    'G02',
    bargain ? 96 : 86,
    genericText('G02', generics, 'Has it had a history check for outstanding finance, theft or a write-off (insurance category)? Can I run one?'),
  );
  add(
    'G04',
    (age != null && age >= 6) || (Number.isFinite(mileage) && mileage >= 80000) ? 89 : 84,
    genericText('G04', generics, 'Is there a full service history with stamps or invoices? When and at what mileage was it last serviced?'),
  );
  if (age == null || age >= 3) {
    add('G03', 87, genericText('G03', generics, "Can I look up the MOT history? Have the advisories been fixed, and does the mileage go up steadily?"));
    add('G10', 55, genericText('G10', generics, 'When does the MOT run out?'));
  }
  add('G01', 82, genericText('G01', generics, "Can I see the V5C log book? Does the name and address match yours, and do the VIN and engine number match the car?"));
  add('G05', 70, genericText('G05', generics, 'How many previous owners has it had, and how long have you owned it?'));
  add('G08', 61, genericText('G08', generics, 'Does it come with two keys and the locking wheel nut key?'));
  add(
    'G09',
    age != null && age <= 3 ? 76 : age != null && age <= 6 ? 68 : 52,
    genericText('G09', generics, 'Is any manufacturer or dealer warranty left, and does it transfer to me?'),
  );
  add('G06', 57, genericText('G06', generics, 'Are there any outstanding safety recalls on this car? Can I check the registration on GOV.UK?'));
  add('G07', 54, genericText('G07', generics, 'Has it ever had accident damage, paint or bodywork repairs, or any modifications?'));
  add('G12', Number.isFinite(mileage) && mileage >= 80000 ? 63 : 50, genericText('G12', generics, 'How much tread is left on the tyres, and do they all match?'));
  add('G13', 49, genericText('G13', generics, 'When were the brake discs and pads last replaced? Any noises or pulling under braking?'));
  add('G14', 47, genericText('G14', generics, 'Are any warning lights on the dashboard, and do all the electrics (windows, air con, lights) work?'));
  add('G17', 45, genericText('G17', generics, 'Can I start it from cold and take it for a test drive (on insurance that covers me)?'));
  add('G15', 40, genericText('G15', generics, 'Is it currently taxed?'));

  if (overpriced) {
    add('negotiate', 85, 'The asking price looks high against similar cars. What flexibility is there on the price?');
  } else if (bargain) {
    add('negotiate', 83, "It's priced keenly — is there a reason it's at this money? Any issues I should know about?");
  } else if (good) {
    add('negotiate', 72, "What's the best price you can do today?");
  } else {
    add('negotiate', 65, 'Is there any room on the price if I move quickly?');
  }

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

function hasVisibleSpecific(matches, review) {
  for (const e of matches) {
    if (allowFact(e.timingConfidence, review) && e.timingType && e.timingType !== 'unknown') return true;
    if ((e.knownIssues || []).some((i) => allowFact(i.confidence, review))) return true;
    if ((e.questions || []).some((q) => allowFact(q.confidence, review))) return true;
  }
  return false;
}

/**
 * @param {object} listing
 * @param {{ kb?: object|array, generic?: object|array, now?: Date, review?: boolean }} [options]
 */
export function garageQuestions(listing = {}, { kb, generic, now = new Date(), review = false } = {}) {
  const loaded = loadKb(kb);
  const generics = loadGenericQuestions(generic);
  const matches = findKbMatches(listing, loaded);
  const conflict = timingTypesConflict(matches);
  const usable = conflict ? [] : matches;
  const specificVisible = hasVisibleSpecific(usable, review);

  const candidates = candidateQuestions(listing, {
    now,
    kbMatches: usable,
    timingConflict: conflict,
    review,
    generics,
  });
  const questions = takeQuestions(candidates);
  const mode = specificVisible && !conflict ? 'specific' : 'generic';
  return {
    mode,
    label: mode === 'generic' ? GENERIC_LABEL : SPECIFIC_LABEL,
    questions,
    reviewOnly: review ? matches : [],
    matches,
    timingConflict: conflict,
  };
}

export function formatQuestionsText(result, heading = 'Questions to ask the garage') {
  const lines = [heading, result.label && result.mode === 'generic' ? result.label : null, '']
    .filter((x) => x !== null);
  result.questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text}`);
  });
  return lines.join('\n').trim();
}

export { formatIntervalText, loadKb, findKbMatches, timingTypesConflict };
