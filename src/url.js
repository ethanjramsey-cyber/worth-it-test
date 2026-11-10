/**
 * Challenge-a-mate URL helpers and query-param prefill.
 * Relative base is configurable; no real domain is assumed.
 * Asking price is intentionally omitted so a friend types their own.
 */

import { APP_URL } from './config.js';

export { APP_URL };

const KEYS = ['make', 'model', 'year', 'mileage', 'fuel', 'engine', 'gearbox'];
const IMPORT_KEYS = [...KEYS, 'price'];

function asSearchParams(input) {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === 'string') {
    const str = input.trim();
    if (!str) return new URLSearchParams();
    try {
      if (/^[a-z]+:\/\//i.test(str) || str.startsWith('//')) {
        return new URL(str, 'http://example.invalid').searchParams;
      }
    } catch {
      // fall through and treat as a query string
    }
    const cut = str.includes('?') ? str.slice(str.indexOf('?') + 1) : str;
    const hashless = cut.includes('#') ? cut.slice(0, cut.indexOf('#')) : cut;
    return new URLSearchParams(hashless.startsWith('?') ? hashless.slice(1) : hashless);
  }
  if (input && typeof input === 'object') {
    if (typeof input.search === 'string') return new URLSearchParams(input.search);
    if (typeof input.searchParams !== 'undefined') return new URLSearchParams(input.searchParams);
  }
  return new URLSearchParams();
}

function optionalNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string|URLSearchParams|Location|{search?: string}} input
 * @returns {{ make: string|null, model: string|null, year: number|null, mileage: number|null, fuel: string|null, ref: string|null }}
 */
export function parseChallengeParams(input) {
  const params = asSearchParams(input);
  const make = params.get('make')?.trim() || null;
  const model = params.get('model')?.trim() || null;
  const fuel = params.get('fuel')?.trim() || null;
  const engine = params.get('engine')?.trim() || null;
  const gearbox = params.get('gearbox')?.trim() || null;
  const ref = params.get('ref')?.trim() || null;
  const src = params.get('src')?.trim() || null;
  return {
    make,
    model,
    year: optionalNumber(params.get('year')),
    mileage: optionalNumber(params.get('mileage')),
    fuel,
    engine,
    gearbox,
    price: optionalNumber(params.get('price')),
    ref,
    src,
  };
}

/**
 * Build an import / bookmarklet URL that prefills the confirm screen,
 * including asking price when known. Unknowns are omitted, never guessed.
 */
export function buildImportUrl(listing = {}, options = {}) {
  const params = new URLSearchParams();
  for (const key of IMPORT_KEYS) {
    const value = listing[key];
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  params.set('src', String(options.src || 'import'));
  if (options.ref) params.set('ref', String(options.ref));
  const query = params.toString();
  const base = options.base !== undefined ? options.base : APP_URL;
  if (!base) return query ? `?${query}` : '?';
  const trimmed = String(base).replace(/\/+$/, '');
  return query ? `${trimmed}/?${query}` : `${trimmed}/`;
}

export function readRefParam(input) {
  return parseChallengeParams(input).ref;
}

/**
 * Build a "challenge a mate" link that prefills make, model, year
 * (and optionally mileage and fuel). Does not include asking price.
 *
 * @param {{ make?: string, model?: string, year?: number|string, mileage?: number|string, fuel?: string }} listing
 * @param {{ base?: string, ref?: string }} [options]
 *   base — origin/path prefix. Defaults to APP_URL. Empty/undefined → a
 *   relative `?query` string, safe with no domain chosen yet.
 * @returns {string}
 */
export function buildChallengeUrl(listing = {}, options = {}) {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = listing[key];
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  if (options.ref) params.set('ref', String(options.ref));
  const query = params.toString();
  const base = options.base !== undefined ? options.base : APP_URL;
  if (!base) return query ? `?${query}` : '?';
  const trimmed = String(base).replace(/\/+$/, '');
  return query ? `${trimmed}/?${query}` : `${trimmed}/`;
}

/**
 * Resolve a shareable challenge URL for the current page, falling back to
 * APP_URL or a relative query string.
 */
export function challengeUrlForDisplay(listing, options = {}) {
  const base =
    options.base !== undefined
      ? options.base
      : APP_URL || (typeof window !== 'undefined' && window.location
        ? `${window.location.origin}${window.location.pathname}`
        : '');
  return buildChallengeUrl(listing, { ...options, base });
}
