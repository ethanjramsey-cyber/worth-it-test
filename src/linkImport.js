/**
 * User-facing copy when a pasted listing link cannot look up a plate / MOT.
 * Pure strings — no I/O.
 */

export const REG_FALLBACK =
  'Enter the reg, add a screenshot or photo of the plate, or paste the listing text.';

/**
 * @param {{
 *   fieldsFound?: boolean,
 *   plateCount?: number,
 *   plateStatus?: string|null,
 *   error?: string|null,
 *   imageMessage?: string|null,
 * }} [opts]
 * @returns {string|null} null when the plate path can continue (exact one plate).
 */
export function linkExtractUserMessage({
  fieldsFound = false,
  plateCount = 0,
  plateStatus = null,
  error = null,
  imageMessage = null,
} = {}) {
  const status = String(plateStatus || '').toLowerCase();
  if (status === 'blurred') {
    return `The plate looks blurred in the photo, so we haven't looked up the MOT or official record. ${REG_FALLBACK}`;
  }
  if (status === 'hidden') {
    return `The plate looks hidden in the photo, so we haven't looked up the MOT or official record. ${REG_FALLBACK}`;
  }
  if (error === 'blocked') {
    return `This site didn't let us open the listing from the link. ${REG_FALLBACK}`;
  }
  if (error === 'timeout' || error === 'network' || error === 'http-error' || error === 'too-large') {
    return `We couldn't read this listing from the link. ${REG_FALLBACK}`;
  }
  if (!fieldsFound) {
    return `We couldn't read the details from this link (some sites only send a blank page to us). ${REG_FALLBACK}`;
  }
  if (!plateCount) {
    return `Have a look below — the listing details are filled in, but this page didn't include a readable number plate, so we haven't looked up the MOT or official record. ${REG_FALLBACK}`;
  }
  if (plateCount > 1) {
    return "Have a look below — we found more than one plate, so we haven't looked up the MOT yet. Choose the right reg.";
  }
  return imageMessage || null;
}
