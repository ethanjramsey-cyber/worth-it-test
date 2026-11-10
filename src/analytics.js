/**
 * Tiny privacy-friendly analytics stub.
 * No third-party calls. No-op by default.
 * Keeps ?ref= (e.g. ref=card) so share-to-visit can be measured later.
 */

let currentRef = null;
let enabled = false;
const memory = [];

export function initAnalytics({ ref } = {}) {
  if (ref != null && ref !== '') currentRef = String(ref);
}

export function getRef() {
  return currentRef;
}

/** Test/helper hook. Production stays no-op unless explicitly enabled later. */
export function setAnalyticsEnabled(value) {
  enabled = Boolean(value);
}

export function track(event, props = {}) {
  const payload = {
    event: String(event),
    props: { ...props, ref: currentRef },
    t: Date.now(),
  };
  if (!enabled) return payload;
  memory.push(payload);
  return payload;
}

export function getBufferedEvents() {
  return [...memory];
}

export function resetAnalytics() {
  currentRef = null;
  enabled = false;
  memory.length = 0;
}
