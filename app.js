import { APP_URL, WORKER_URL, EXTRACT_PATH } from './src/config.js';
import { checkListing, formatGbp, formatMiles, CONFIG } from './src/score.js';
import { datasetFreshness, datasetHasPlaceholders, isPlaceholderModel } from './src/priceSource.js';
import { buildCardModel, shareText, challengeLinkFor, renderShareCardPng, renderBothCards, shareOrDownload, downloadBlob, CARD_SIZES } from './src/shareCard.js';
import { rankBestValue, formatBestValueLine, methodText } from './src/bestValue.js';
import { parseListingDetails, matchModel, unmatchedModelMessage, normaliseFuel, normaliseGearbox } from './src/parse.js';
import { parseChallengeParams, buildChallengeUrl, challengeUrlForDisplay } from './src/url.js';
import { buildConfirmState } from './src/confirm.js';
import { initAnalytics, getRef, track } from './src/analytics.js';
import { garageQuestions, formatQuestionsText, REVIEW_BADGE, loadGenericQuestions } from './src/questions.js';
import { loadKb } from './src/kb.js';

const NOW = new Date();
const $ = (id) => document.getElementById(id);

const els = {
  form: $('checker-form'),
  listingText: $('listing-text'),
  modelSearch: $('model-search'),
  modelResults: $('model-results'),
  modelChosen: $('model-chosen'),
  modelId: $('model-id'),
  year: $('year'),
  mileage: $('mileage'),
  engine: $('engine'),
  engineList: $('engine-list'),
  fuel: $('fuel'),
  gearbox: $('gearbox'),
  asking: $('asking'),
  formError: $('form-error'),
  result: $('result'),
  tagline: $('result-tagline'),
  verdict: $('result-verdict'),
  score: $('result-score'),
  range: $('result-range'),
  delta: $('result-delta'),
  resultCar: $('result-car'),
  shareBtn: $('share-btn'),
  downloadCardBtn: $('download-card-btn'),
  challengeBtn: $('challenge-btn'),
  challengeStatus: $('challenge-status'),
  bestForm: $('best-form'),
  bestBudget: $('best-budget'),
  bestBody: $('best-body'),
  bestFuel: $('best-fuel'),
  bestAge: $('best-age'),
  bestMiles: $('best-miles'),
  bestResults: $('best-results'),
  bestEmpty: $('best-empty'),
  bestMethod: $('best-method'),
  installBanner: $('install-banner'),
  installText: $('install-text'),
  installBtn: $('install-btn'),
  installDismiss: $('install-dismiss'),
  questionsLabel: $('questions-label'),
  questionsList: $('questions-list'),
  copyQuestions: $('copy-questions'),
  shareQuestions: $('share-questions'),
  dataBanner: $('data-banner'),
  dataFreshness: $('data-freshness'),
  disclaimer: $('disclaimer'),
  resultCaution: $('result-caution'),
  resultScoreCaption: $('result-score-caption'),
  urlImport: $('url-import'),
  listingUrl: $('listing-url'),
  fetchUrlBtn: $('fetch-url-btn'),
  urlStatus: $('url-status'),
  confirm: $('confirm'),
  confirmSource: $('confirm-source'),
  confirmFields: $('confirm-fields'),
  confirmBtn: $('confirm-btn'),
  confirmCancel: $('confirm-cancel'),
};

let models = [];
let segmentsById = new Map();
let priceIndex = null;
let kb = { entries: [] };
let genericQuestions = [];
let selectedModel = null;
let lastQuestions = null;
let lastListing = null;
let lastResult = null;
let deferredInstall = null;
const CHECKS_KEY = 'worthit-check-count';
const INSTALL_DISMISS_KEY = 'worthit-install-dismissed';
const params = parseChallengeParams(window.location);
const reviewMode = new URLSearchParams(window.location.search).get('review') === '1';

initAnalytics({ ref: params.ref });
track('visit', { ref: getRef() });

function showStatus(el, message, kind) {
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.dataset.kind = kind || '';
}

function fuelOptionsFor(model) {
  const fuels = model?.fuels?.length ? model.fuels : ['petrol', 'diesel', 'hybrid', 'phev', 'electric', 'lpg'];
  const labels = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Hybrid', phev: 'Plug-in hybrid', electric: 'Electric', lpg: 'LPG' };
  els.fuel.innerHTML = `<option value="">Select</option>` + fuels.map((f) => `<option value="${f}">${labels[f] || f}</option>`).join('');
}

function engineOptionsFor(model) {
  els.engineList.innerHTML = '';
  for (const e of model?.engines || []) {
    const opt = document.createElement('option');
    opt.value = e;
    els.engineList.append(opt);
  }
}

function selectModel(model, { keepSearch = false } = {}) {
  selectedModel = model || null;
  els.modelId.value = model ? model.id : '';
  if (model) {
    if (!keepSearch) els.modelSearch.value = `${model.make} ${model.model}`;
    els.modelChosen.hidden = false;
    els.modelChosen.textContent = `${model.make} ${model.model}`;
    els.modelChosen.classList.toggle('is-placeholder', isPlaceholderModel(model));
    fuelOptionsFor(model);
    engineOptionsFor(model);
  } else {
    els.modelChosen.hidden = true;
    els.modelChosen.textContent = '';
    els.modelChosen.classList.remove('is-placeholder');
    fuelOptionsFor(null);
    engineOptionsFor(null);
  }
  els.modelResults.hidden = true;
  els.modelResults.innerHTML = '';
}

function filterModels(query) {
  const q = query.trim().toLowerCase();
  if (!q) return models.slice(0, 8);
  return models.filter((m) => `${m.make} ${m.model}`.toLowerCase().includes(q)).slice(0, 8);
}

function renderTypeahead(query) {
  const hits = filterModels(query);
  els.modelResults.innerHTML = '';
  if (!hits.length) {
    els.modelResults.hidden = true;
    return;
  }
  for (const m of hits) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'option';
    btn.textContent = isPlaceholderModel(m)
      ? `${m.make} ${m.model} (placeholder price)`
      : `${m.make} ${m.model}`;
    btn.addEventListener('click', () => selectModel(m));
    li.append(btn);
    els.modelResults.append(li);
  }
  els.modelResults.hidden = false;
}

els.modelSearch.addEventListener('input', () => {
  const q = els.modelSearch.value;
  const exact = models.find((m) => `${m.make} ${m.model}`.toLowerCase() === q.trim().toLowerCase());
  if (exact) selectModel(exact, { keepSearch: true });
  else {
    selectedModel = null;
    els.modelId.value = '';
    els.modelChosen.hidden = true;
    renderTypeahead(q);
  }
});

els.modelSearch.addEventListener('focus', () => {
  if (els.modelSearch.value || !selectedModel) renderTypeahead(els.modelSearch.value);
});

document.addEventListener('click', (ev) => {
  if (!els.modelResults.contains(ev.target) && ev.target !== els.modelSearch) {
    els.modelResults.hidden = true;
  }
});

els.listingText.addEventListener('paste', () => {
  setTimeout(() => applyParsedText(els.listingText.value), 0);
});
els.listingText.addEventListener('blur', () => {
  if (els.listingText.value.trim()) applyParsedText(els.listingText.value);
});


function formatFieldValue(key, value) {
  if (value == null || value === '') return 'missing';
  if (key === 'price') return `£${Number(value).toLocaleString('en-GB')}`;
  if (key === 'mileage') return `${Number(value).toLocaleString('en-GB')} miles`;
  if (key === 'gearbox') return value === 'auto' ? 'Automatic' : 'Manual';
  return String(value);
}

function highlightFields(statuses) {
  document.querySelectorAll('.field[data-field]').forEach((el) => {
    const keys = (el.dataset.field || '').split(',').map((k) => k.trim());
    const hits = statuses.filter((s) => keys.includes(s.key));
    el.classList.remove('is-missing', 'is-low');
    if (!hits.length) return;
    if (hits.every((s) => s.missing)) el.classList.add('is-missing');
    else if (hits.some((s) => s.low)) el.classList.add('is-low');
  });
}

function clearHighlights() {
  document.querySelectorAll('.field[data-field]').forEach((el) => {
    el.classList.remove('is-missing', 'is-low');
  });
}

function renderConfirm(input, opts = {}) {
  const state = buildConfirmState(input, opts);
  if (els.confirmSource) els.confirmSource.textContent = state.summary;
  if (els.confirmFields) {
    els.confirmFields.innerHTML = '';
    for (const s of state.statuses) {
      const li = document.createElement('li');
      if (s.missing) li.className = 'is-missing';
      else if (s.low) li.className = 'is-low';
      const lab = document.createElement('span');
      lab.className = 'cf-label';
      lab.textContent = s.label;
      const val = document.createElement('span');
      val.className = 'cf-value';
      val.textContent = formatFieldValue(s.key, s.value);
      li.append(lab, val);
      const src = document.createElement('span');
      src.className = 'cf-source';
      if (s.missing) src.textContent = 'Please fill this in — we left it blank rather than guess.';
      else if (s.sourceLabel) src.textContent = `${s.low ? 'Have a check — ' : ''}from ${s.sourceLabel}${s.confidence ? ` (${Math.round(s.confidence * 100)}%)` : ''}`;
      else src.textContent = s.low ? 'Have a check.' : '';
      li.append(src);
      els.confirmFields.append(li);
    }
  }
  highlightFields(state.statuses);
  els.confirm.hidden = false;
  els.confirm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return state;
}

function hideConfirm() {
  els.confirm.hidden = true;
  clearHighlights();
}

function applyParsedText(text) {
  const pasteStatus = $('paste-status');
  const trimmed = String(text || '').trim();
  const isLink = /^https?:\/\/\S+$/i.test(trimmed);
  if (isLink && !WORKER_URL) {
    // Link-only paste: we can't open the page from the browser, so read what the link itself says.
    let slug = '';
    try { slug = decodeURIComponent(new URL(trimmed).pathname).replace(/[-_/+]+/g, ' '); } catch { /* ignore */ }
    const fromSlug = slug ? parseListingDetails(slug, NOW) : {};
    const found = fromSlug.make || fromSlug.model || fromSlug.year;
    showStatus(pasteStatus, found
      ? "We can't open listing links yet, so we only read the link's own words. Check the boxes, or paste the listing text for better results."
      : "We can't open listing links yet, and this link doesn't say what the car is. Copy the listing's title, price and mileage and paste that text here instead.", found ? 'ok' : 'err');
    if (!found) return;
    text = slug;
  } else {
    showStatus(pasteStatus, '', '');
  }
  const parsed = parseListingDetails(text, NOW);
  if (parsed.year && !els.year.value) els.year.value = parsed.year;
  if (parsed.mileage != null && !els.mileage.value) els.mileage.value = parsed.mileage;
  if (parsed.price != null && !els.asking.value) els.asking.value = parsed.price;
  if (parsed.fuel && !els.fuel.value) {
    const n = normaliseFuel(parsed.fuel);
    if (n) els.fuel.value = n;
  }
  if (parsed.gearbox && !els.gearbox.value) els.gearbox.value = parsed.gearbox;
  if (parsed.engine && !els.engine.value) els.engine.value = parsed.engine.text;
  let maybe = selectedModel;
  if (!selectedModel) {
    maybe = matchModelFromText(text, { ...parsed, make: parsed.make, model: parsed.model });
    if (maybe) selectModel(maybe);
    else if (parsed.make || parsed.model) {
      els.modelSearch.value = [parsed.make, parsed.model].filter(Boolean).join(' ');
    }
  }
  const unmatched = unmatchedModelMessage(parsed, maybe);
  if (unmatched) {
    const prefix = (isLink && !WORKER_URL)
      ? "We can't open listing links yet, so we only read the link's own words. "
      : '';
    showStatus(pasteStatus, prefix + unmatched, 'err');
  }
  // Prefill whatever was found even when mileage or price is missing.
  const any = parsed.year || parsed.mileage != null || parsed.price != null || parsed.fuel || parsed.gearbox || parsed.engine || parsed.make || parsed.model;
  if (any) {
    renderConfirm({
      make: selectedModel?.make || parsed.make || null,
      model: selectedModel?.model || parsed.model || null,
      year: parsed.year,
      mileage: parsed.mileage,
      fuel: parsed.fuel,
      engine: parsed.engine?.text || parsed.engine || null,
      gearbox: parsed.gearbox,
      price: parsed.price,
    }, { defaultSource: 'pasted-text', defaultConfidence: 0.8 });
  }
}

function matchModelFromText(text, parsed) {
  const cleaned = String(text).replace(/^\s*\d{4}\s*/, '');
  for (const m of models) {
    const name = `${m.make} ${m.model}`;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'i').test(cleaned)) return m;
  }
  return matchModel(parsed?.make, parsed?.model, models);
}


function prefillFromParams(p) {
  if (p.make || p.model) {
    const found = matchModel(p.make, p.model, models);
    if (found) selectModel(found);
    else if (p.make && p.model) els.modelSearch.value = `${p.make} ${p.model}`;
    else els.modelSearch.value = p.make || p.model || '';
  }
  if (p.year) els.year.value = p.year;
  if (p.mileage != null) els.mileage.value = p.mileage;
  if (p.fuel) {
    const n = normaliseFuel(p.fuel);
    if (n) els.fuel.value = n;
  }
  if (p.engine) els.engine.value = p.engine;
  if (p.gearbox) {
    const g = normaliseGearbox(p.gearbox);
    if (g) els.gearbox.value = g;
  }
  if (p.price != null) els.asking.value = p.price;
  const imported = p.src === 'bookmarklet' || p.src === 'import' || p.src === 'pasted-text' || p.price != null;
  const any = p.make || p.model || p.year || p.mileage != null || p.fuel || p.engine || p.gearbox || p.price != null;
  if (imported && any) {
    renderConfirm({
      make: selectedModel?.make || p.make || null,
      model: selectedModel?.model || p.model || null,
      year: p.year,
      mileage: p.mileage,
      fuel: p.fuel,
      engine: p.engine,
      gearbox: p.gearbox,
      price: p.price,
    }, { defaultSource: p.src === 'bookmarklet' ? 'bookmarklet' : (p.src || 'url-params'), defaultConfidence: 0.85 });
  }
}

function readForm() {
  return {
    model: selectedModel,
    year: Number(els.year.value),
    mileage: Number(els.mileage.value),
    fuel: els.fuel.value,
    engine: els.engine.value.trim(),
    gearbox: els.gearbox.value,
    asking: Number(els.asking.value),
  };
}

function validateForm(input) {
  if (!input.model) return 'Pick a make and model first.';
  if (!Number.isFinite(input.year) || input.year < 1990 || input.year > NOW.getFullYear() + 1) {
    return 'Need a sensible year on that.';
  }
  if (!Number.isFinite(input.mileage) || input.mileage < 0) return 'Mileage looks off.';
  if (!Number.isFinite(input.asking) || input.asking < 0) return 'Need an asking price.';
  return null;
}

function setFormError(msg) {
  els.formError.hidden = !msg;
  els.formError.textContent = msg || '';
}

function runCheck(input) {
  const error = validateForm(input);
  if (error) {
    setFormError(error);
    els.result.hidden = true;
    return;
  }
  setFormError('');
  const curve = segmentsById.get(input.model.curveId);
  const result = checkListing({ ...input, now: NOW, curve, index: priceIndex });
  if (!result) {
    setFormError("Couldn't score that one. Check the details.");
    els.result.hidden = true;
    return;
  }
  if (result.expected == null || result.score == null) {
    setFormError(result.caution || "Couldn't score that one. No checked reference price for this model yet.");
    els.result.hidden = true;
    return;
  }
  renderResult(input, result);
  track('check', { model: input.model.id, score: result.score, verdict: result.verdict.id });
}

function renderResult(input, result) {
  const tone = result.confident ? (result.verdict.tone || 'neutral') : 'neutral';
  els.result.hidden = false;
  els.result.className = `result tone-${tone}${result.confident ? '' : ' is-placeholder'}`;
  els.tagline.textContent = result.confident ? result.tagline : 'Indicative only';
  els.verdict.textContent = result.verdict.label;
  els.score.textContent = String(Math.round(result.score));
  if (els.resultScoreCaption) {
    els.resultScoreCaption.textContent = result.confident ? 'Value Score' : 'Indicative score — not a confident verdict';
  }
  if (els.resultCaution) {
    if (result.caution) {
      els.resultCaution.hidden = false;
      els.resultCaution.textContent = result.caution;
    } else {
      els.resultCaution.hidden = true;
      els.resultCaution.textContent = '';
    }
  }
  els.range.textContent = `Fair price ${result.rangeText}`;
  els.delta.textContent = `This one is ${result.deltaText}.`;
  const bits = [
    `${input.model.make} ${input.model.model}`,
    input.year,
    input.engine,
    input.fuel,
    input.gearbox,
    formatMiles(input.mileage),
    `asking ${formatGbp(input.asking)}`,
  ].filter(Boolean);
  els.resultCar.textContent = bits.join(' · ');

  const q = garageQuestions(
    {
      make: input.model.make,
      model: input.model.model,
      modelObj: input.model,
      year: input.year,
      mileage: input.mileage,
      fuel: input.fuel,
      engine: input.engine,
      gearbox: input.gearbox,
      asking: input.asking,
      score: result.score,
      verdict: result.verdict,
    },
    { kb, generic: genericQuestions, now: NOW, review: reviewMode },
  );
  lastQuestions = q;
  lastListing = input;
  lastResult = result;
  if (els.shareBtn) {
    els.shareBtn.disabled = false;
    els.shareBtn.hidden = false;
  }
  if (els.downloadCardBtn) els.downloadCardBtn.hidden = false;
  recordCompletedCheck();
  els.questionsLabel.textContent = q.mode === 'generic' ? q.label : '';
  els.questionsList.innerHTML = '';
  for (const item of q.questions) {
    const li = document.createElement('li');
    li.textContent = item.text.replace(` [${REVIEW_BADGE}]`, '');
    if (item.review) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = REVIEW_BADGE;
      li.append(badge);
    }
    els.questionsList.append(li);
  }
  els.shareQuestions.hidden = typeof navigator.share !== 'function';
  els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

els.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  runCheck(readForm());
});

els.challengeBtn.addEventListener('click', async () => {
  if (!selectedModel) return;
  const listing = {
    make: selectedModel.make,
    model: selectedModel.model,
    year: els.year.value,
    mileage: els.mileage.value,
    fuel: els.fuel.value,
    engine: els.engine.value,
    gearbox: els.gearbox.value,
  };
  const url = challengeUrlForDisplay(listing, { ref: 'card' });
  try {
    await navigator.clipboard.writeText(url);
    showStatus(els.challengeStatus, 'Link copied — they enter their own price.', 'ok');
  } catch {
    showStatus(els.challengeStatus, `Copy this link: ${url}`, 'ok');
  }
});

function questionsShareText() {
  if (!lastQuestions) return '';
  const car = lastListing ? `${lastListing.model.make} ${lastListing.model.model}` : 'this car';
  return formatQuestionsText(lastQuestions, `Questions to ask the garage — ${car}`);
}

els.copyQuestions.addEventListener('click', async () => {
  const text = questionsShareText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    els.copyQuestions.textContent = 'Copied';
    setTimeout(() => { els.copyQuestions.textContent = 'Copy'; }, 1600);
  } catch {
    els.copyQuestions.textContent = "Couldn't copy";
  }
});

els.shareQuestions.addEventListener('click', async () => {
  const text = questionsShareText();
  if (!text || typeof navigator.share !== 'function') return;
  try {
    await navigator.share({ title: 'Questions to ask the garage', text });
  } catch {
    // user cancelled
  }
});

function showTab(name) {
  $('tab-check').hidden = name !== 'check';
  $('tab-best').hidden = name !== 'best';
  document.querySelectorAll('.tabbar .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
}

document.querySelectorAll('.tabbar .tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

/* --- URL import (hidden unless WORKER_URL is set) --- */
function extractEndpoint() {
  if (!WORKER_URL) return null;
  const base = WORKER_URL.replace(/\/+$/, '');
  return `${base}${EXTRACT_PATH}`;
}

if (extractEndpoint()) {
  els.urlImport.hidden = false;
}

els.fetchUrlBtn?.addEventListener('click', () => fetchListingUrl());

async function fetchListingUrl() {
  const endpoint = extractEndpoint();
  const url = els.listingUrl.value.trim();
  if (!endpoint) return;
  if (!url || !/^https?:\/\//i.test(url)) {
    showStatus(els.urlStatus, "That doesn't look like a web link. Paste a full http(s) URL, or enter the details yourself.", 'err');
    return;
  }
  els.fetchUrlBtn.disabled = true;
  showStatus(els.urlStatus, 'Looking that up…', '');
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      showStatus(els.urlStatus, "Couldn't read that page. Paste the listing text or enter the details yourself.", 'err');
      return;
    }
    if (data.error === 'blocked' || data.error === 'timeout' || data.error === 'network' || data.error === 'http-error' || data.error === 'too-large') {
      showStatus(els.urlStatus, data.message || 'The site refused the request. Paste the listing text or enter the details yourself.', 'err');
      return;
    }
    const keys = ['make', 'model', 'year', 'mileage', 'fuel', 'price', 'engine', 'gearbox'];
    const got = keys.filter((k) => data[k] != null && data[k] !== '');
    if (!got.length) {
      showStatus(els.urlStatus, data.message || "Couldn't read the details from this page. Try the bookmarklet or paste the listing text.", 'err');
      return;
    }
    applyExtracted(data);
    showStatus(els.urlStatus, 'Have a look below — is this right?', 'ok');
    renderConfirm(data, { defaultSource: data.source || 'import', defaultConfidence: data.confidence ?? 0.8 });
  } catch {
    showStatus(els.urlStatus, "Couldn't reach the lookup service. Paste the listing text or enter the details yourself.", 'err');
  } finally {
    els.fetchUrlBtn.disabled = false;
  }
}

function applyExtracted(data) {
  if (data.make || data.model) {
    const found = matchModel(data.make, data.model, models);
    if (found) selectModel(found);
    else els.modelSearch.value = [data.make, data.model].filter(Boolean).join(' ');
  }
  if (data.year) els.year.value = data.year;
  if (data.mileage != null) els.mileage.value = data.mileage;
  if (data.price != null) els.asking.value = data.price;
  if (data.fuel) {
    const n = normaliseFuel(data.fuel);
    if (n) {
      if (![...els.fuel.options].some((o) => o.value === n)) {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        els.fuel.append(opt);
      }
      els.fuel.value = n;
    }
  }
  if (data.engine) els.engine.value = typeof data.engine === 'string' ? data.engine : (data.engine.text || '');
  if (data.gearbox) {
    const g = normaliseGearbox(data.gearbox);
    if (g) els.gearbox.value = g;
  }
}

els.confirmBtn.addEventListener('click', () => {
  hideConfirm();
  runCheck(readForm());
});
els.confirmCancel.addEventListener('click', () => {
  hideConfirm();
  showStatus(els.urlStatus, 'No problem — edit the boxes or paste the listing text instead.', '');
});

function applyDataLabels(modelList, index) {
  const hasPlaceholders = datasetHasPlaceholders(modelList);
  const freshness = datasetFreshness(modelList, index);
  if (els.dataBanner) {
    if (hasPlaceholders) {
      const all = modelList.length && modelList.every((m) => isPlaceholderModel(m));
      els.dataBanner.hidden = false;
      els.dataBanner.textContent = all
        ? 'Placeholder prices — invented round numbers, not real market data. Ethan still needs to sanity-check these.'
        : 'Some models still have placeholder prices. A placeholder score is indicative only, not a confident verdict.';
    } else {
      els.dataBanner.hidden = true;
    }
  }
  if (els.dataFreshness) {
    if (freshness) {
      els.dataFreshness.hidden = false;
      els.dataFreshness.textContent = freshness;
    } else {
      els.dataFreshness.hidden = true;
      els.dataFreshness.textContent = '';
    }
  }
  if (els.disclaimer) {
    els.disclaimer.textContent = hasPlaceholders
      ? 'Estimates, not a valuation. Figures come from a placeholder dataset until Ethan reviews them.'
      : 'Estimates, not a valuation. Prices were set by Ethan and moved with the official ONS used-car index.';
  }
}

async function boot() {
  try {
    const [modelsDoc, segmentsDoc, kbDoc, indexDoc, genericDoc] = await Promise.all([
      fetch('./data/models.json').then((r) => r.json()),
      fetch('./data/segments.json').then((r) => r.json()),
      fetch('./data/garage-kb.json').then((r) => r.json()).catch(() => ({ entries: [] })),
      fetch('./data/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('./data/garage-generic-questions.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    models = modelsDoc.models || [];
    segmentsById = new Map((segmentsDoc.segments || []).map((s) => [s.id, s]));
    priceIndex = indexDoc;
    kb = loadKb(kbDoc);
    genericQuestions = loadGenericQuestions(genericDoc);
    applyDataLabels(models, priceIndex);
    if (els.bestMethod) els.bestMethod.textContent = methodText();
    fuelOptionsFor(null);
    prefillFromParams(params);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
    setupInstallPrompt();
  } catch (err) {
    setFormError("Couldn't load the car data. Try a refresh.");
    console.error(err);
  }
}

boot();

async function currentCardAndPng(size = CARD_SIZES.portrait) {
  if (!lastListing || !lastResult) return null;
  const card = buildCardModel({ listing: lastListing, result: lastResult, appUrl: APP_URL });
  const rendered = await renderShareCardPng(card, size);
  return { card, ...rendered };
}

function currentShareCopy() {
  if (!lastListing || !lastResult) return { text: '', url: '', card: null };
  const card = buildCardModel({ listing: lastListing, result: lastResult, appUrl: APP_URL });
  const url = challengeLinkFor(lastListing, { appUrl: APP_URL });
  return { text: shareText(card, { challengeUrl: url }), url, card };
}

async function onShareCard() {
  const pack = currentShareCopy();
  if (!pack.card) return;
  showStatus(els.challengeStatus, 'Preparing your card…', '');
  try {
    const rendered = await renderShareCardPng(pack.card, CARD_SIZES.portrait);
    const filename = `worth-it-${pack.card.verdictId || 'score'}.png`;
    const mode = await shareOrDownload({
      blob: rendered.blob,
      filename,
      title: `${pack.card.appName} — ${pack.card.verdict}`,
      text: pack.text,
      url: pack.url.startsWith('http') ? pack.url : undefined,
    });
    showStatus(els.challengeStatus, mode === 'downloaded' ? 'Card saved as a PNG.' : 'Shared — they can enter their own price.', 'ok');
  } catch (err) {
    if (err && err.name === 'AbortError') {
      showStatus(els.challengeStatus, '', '');
      return;
    }
    try {
      const rendered = await renderShareCardPng(pack.card, CARD_SIZES.portrait);
      downloadBlob(rendered.blob, `worth-it-${pack.card.verdictId || 'score'}.png`);
      showStatus(els.challengeStatus, 'Card saved as a PNG.', 'ok');
    } catch {
      showStatus(els.challengeStatus, "Couldn't share that card.", 'err');
    }
  }
}

async function onDownloadCard() {
  const pack = currentShareCopy();
  if (!pack.card) return;
  try {
    const both = await renderBothCards(pack.card);
    downloadBlob(both.portrait.blob, `worth-it-${pack.card.verdictId || 'score'}-1080x1350.png`);
    downloadBlob(both.story.blob, `worth-it-${pack.card.verdictId || 'score'}-1080x1920.png`);
    showStatus(els.challengeStatus, 'Saved both card sizes (1080×1350 and 1080×1920).', 'ok');
  } catch {
    showStatus(els.challengeStatus, "Couldn't download the card.", 'err');
  }
}

els.shareBtn?.addEventListener('click', () => onShareCard());
els.downloadCardBtn?.addEventListener('click', () => onDownloadCard());

function runBestValue(ev) {
  ev?.preventDefault();
  const result = rankBestValue(
    {
      budget: els.bestBudget.value,
      bodyType: els.bestBody.value,
      fuel: els.bestFuel.value,
      maxAge: els.bestAge.value === '' ? undefined : Number(els.bestAge.value),
      maxMileage: els.bestMiles.value === '' ? undefined : Number(els.bestMiles.value),
    },
    { models, segmentsById, now: NOW, index: priceIndex, limit: 5 },
  );
  els.bestResults.innerHTML = '';
  if (!result.ok) {
    els.bestResults.hidden = true;
    els.bestEmpty.hidden = false;
    els.bestEmpty.textContent = result.errors[0] || 'Need a budget to rank against.';
    return;
  }
  if (!result.items.length) {
    els.bestResults.hidden = true;
    els.bestEmpty.hidden = false;
    els.bestEmpty.textContent = "Nothing in the dataset fits that. Try a higher budget or looser filters.";
    return;
  }
  els.bestEmpty.hidden = true;
  els.bestResults.hidden = false;
  result.items.forEach((item, i) => {
    const li = document.createElement('li');
    const title = document.createElement('h3');
    title.textContent = `${i + 1}. ${item.model.make} ${item.model.model}`;
    if (item.placeholder) {
      const ph = document.createElement('span');
      ph.className = 'ph';
      ph.textContent = 'Placeholder';
      title.append(ph);
    }
    const price = document.createElement('p');
    price.className = 'price';
    price.textContent = `Typical fair price ${formatGbp(item.expected)} · ${formatGbp(item.leftover)} under your budget`;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = formatBestValueLine(item);
    li.append(title, price, meta);
    els.bestResults.append(li);
  });
}

els.bestForm?.addEventListener('submit', runBestValue);

function isIos() {
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function recordCompletedCheck() {
  try {
    const n = Number(localStorage.getItem(CHECKS_KEY) || 0) + 1;
    localStorage.setItem(CHECKS_KEY, String(n));
  } catch { /* private mode */ }
  maybeShowInstall();
}
function maybeShowInstall() {
  if (!els.installBanner) return;
  if (isStandalone()) {
    els.installBanner.hidden = true;
    return;
  }
  let n = 0;
  let dismissed = false;
  try {
    n = Number(localStorage.getItem(CHECKS_KEY) || 0);
    dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch { /* ignore */ }
  if (n < 2 || dismissed) {
    els.installBanner.hidden = true;
    return;
  }
  if (isIos()) {
    els.installText.textContent = "Add Worth It? to your Home Screen: tap Share, then 'Add to Home Screen'.";
    els.installBtn.hidden = true;
    els.installBanner.hidden = false;
    return;
  }
  if (deferredInstall) {
    els.installText.textContent = 'Add Worth It? to your home screen for a quicker check next time.';
    els.installBtn.hidden = false;
    els.installBanner.hidden = false;
  }
}
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredInstall = ev;
    maybeShowInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    if (els.installBanner) els.installBanner.hidden = true;
  });
  els.installBtn?.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    els.installBanner.hidden = true;
  });
  els.installDismiss?.addEventListener('click', () => {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* ignore */ }
    els.installBanner.hidden = true;
  });
}

// Expose a tiny hook used by the screenshot script.
window.__worthIt = { CONFIG, APP_URL, WORKER_URL, runDemo, showConfirmDemo, runDemoOverpriced, runBestValueDemo, exportCardPngs, showTab };
function runDemo() {
  const fiesta = models.find((m) => m.id === 'ford-fiesta');
  if (!fiesta) return;
  selectModel(fiesta);
  els.year.value = '2019';
  els.mileage.value = '42000';
  els.engine.value = '1.0 EcoBoost';
  els.fuel.value = 'petrol';
  els.gearbox.value = 'manual';
  els.asking.value = '3495';
  runCheck(readForm());
}

function showConfirmDemo() {
  const fiesta = models.find((m) => m.id === 'ford-fiesta');
  if (fiesta) selectModel(fiesta);
  else els.modelSearch.value = 'Ford Fiesta';
  els.year.value = '2018';
  els.mileage.value = '42000';
  els.engine.value = '1.0 EcoBoost';
  els.fuel.value = 'petrol';
  els.gearbox.value = 'manual';
  els.asking.value = '';
  renderConfirm({
    make: { value: 'Ford', source: 'bookmarklet', confidence: 0.85 },
    model: { value: 'Fiesta', source: 'bookmarklet', confidence: 0.85 },
    year: { value: 2018, source: 'bookmarklet', confidence: 0.85 },
    mileage: { value: 42000, source: 'title', confidence: 0.6 },
    engine: { value: '1.0 EcoBoost', source: 'bookmarklet', confidence: 0.85 },
    fuel: { value: 'petrol', source: 'bookmarklet', confidence: 0.85 },
    gearbox: { value: 'manual', source: 'bookmarklet', confidence: 0.85 },
    price: { value: null, source: null, confidence: 0 },
  }, { defaultSource: 'bookmarklet' });
}

function runDemoOverpriced() {
  const fiesta = models.find((m) => m.id === 'ford-fiesta');
  if (!fiesta) return;
  selectModel(fiesta);
  els.year.value = '2019';
  els.mileage.value = '42000';
  els.engine.value = '1.0 EcoBoost';
  els.fuel.value = 'petrol';
  els.gearbox.value = 'manual';
  els.asking.value = '7995';
  runCheck(readForm());
}

function runBestValueDemo() {
  showTab('best');
  els.bestBudget.value = '15000';
  els.bestBody.value = '';
  els.bestFuel.value = '';
  els.bestAge.value = '8';
  els.bestMiles.value = '80000';
  runBestValue();
}

async function exportCardPngs() {
  if (!lastListing || !lastResult) return null;
  const card = buildCardModel({ listing: lastListing, result: lastResult, appUrl: APP_URL });
  const both = await renderBothCards(card);
  return {
    verdict: card.verdictId,
    portrait: both.portrait.dataUrl,
    story: both.story.dataUrl,
  };
}
