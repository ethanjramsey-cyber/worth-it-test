/**
 * App-wide constants. No real domain is assumed.
 * Set APP_URL before launch (used later on the share-card footer).
 * Set WORKER_URL to the extract function origin to enable "paste a listing link".
 * Leave WORKER_URL empty to hide URL import and keep manual entry only.
 */
export const APP_NAME = 'Worth It?';

/** Placeholder until a host is chosen. Example later: 'https://worthit.example'. */
export const APP_URL = '';

/**
 * Origin of the listing-extract worker, no trailing path required.
 * Empty = feature hidden. Local: 'http://127.0.0.1:8787'
 */
export const WORKER_URL = '';

export const EXTRACT_PATH = '/extract';
