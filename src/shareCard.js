/**
 * Client-side share cards for Worth It?
 * Renders 1080×1350 and 1080×1920 PNGs on a canvas. No libraries, no
 * network fonts — system font stack only. No photos.
 */
import { APP_NAME, APP_URL } from './config.js';
import { formatGbp, formatMiles, formatFairRange } from './score.js';
import { buildChallengeUrl, challengeUrlForDisplay } from './url.js';

export const CARD_SIZES = Object.freeze({
  portrait: { width: 1080, height: 1350, name: '1080x1350' },
  story: { width: 1080, height: 1920, name: '1080x1920' },
});

export const FONT_STACK = 'system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

const COLOURS = {
  bg: '#0b0c0f',
  text: '#f4f1ea',
  muted: '#9a958a',
  amber: '#f5a623',
  amberBright: '#ffc14d',
  green: '#3dd68c',
  red: '#ff6b4a',
};

export function footerUrl(base = APP_URL) {
  const trimmed = String(base || '').replace(/\/+$/, '');
  return trimmed || 'link coming soon';
}

export function buildCardModel({ listing, result, appUrl = APP_URL } = {}) {
  const model = listing?.model || {};
  const name = [model.make, model.model].filter(Boolean).join(' ');
  const fairLine = result?.expected
    ? `Fair price ${formatGbp(result.expected)}`
    : (result?.range ? `Fair price ${formatFairRange(result.range)}` : (result?.rangeText ? `Fair price ${result.rangeText}` : ''));
  const placeholder = listing?.model?.placeholder === true || result?.placeholder === true;
  const rotating = result?.verdict?.taglines?.[0] || '';
  const tagline = result?.tagline || rotating || (result?.confident === false ? 'Indicative only' : '');
  return {
    appName: APP_NAME,
    name,
    year: listing?.year ?? null,
    mileage: listing?.mileage ?? null,
    asking: listing?.asking ?? result?.asking ?? null,
    engine: listing?.engine || '',
    fuel: listing?.fuel || '',
    score: result?.score == null ? null : Math.round(result.score),
    verdict: result?.verdict?.label || '',
    verdictId: result?.verdict?.id || '',
    tone: result?.verdict?.tone || 'neutral',
    tagline,
    fairLine,
    footerUrl: footerUrl(appUrl),
    placeholder,
    confident: result?.confident !== false,
  };
}

export function shareText(card, { challengeUrl } = {}) {
  const lines = [
    `${card.appName} — ${card.verdict}${card.tagline ? ` (${card.tagline})` : ''}`,
    [card.year, card.name, card.mileage != null ? formatMiles(card.mileage) : '', card.asking != null ? `asking ${formatGbp(card.asking)}` : '']
      .filter(Boolean)
      .join(', '),
    card.score != null ? `Value Score ${card.score}` : '',
    card.fairLine,
    challengeUrl ? `Challenge a mate: ${challengeUrl}` : '',
    'Estimates, not a valuation.',
    card.placeholder ? 'Placeholder data — not a real market valuation.' : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function challengeLinkFor(listing, { appUrl = APP_URL, base } = {}) {
  const payload = {
    make: listing?.model?.make || listing?.make,
    model: listing?.model?.model || listing?.modelName,
    year: listing?.year,
    mileage: listing?.mileage,
    fuel: listing?.fuel,
    engine: listing?.engine,
    gearbox: listing?.gearbox,
  };
  if (typeof window !== 'undefined' && !base && !appUrl) {
    return challengeUrlForDisplay(payload, { ref: 'card' });
  }
  return buildChallengeUrl(payload, { base: base ?? appUrl, ref: 'card' });
}

function accent(tone) {
  if (tone === 'positive' || tone === 'positive-soft') return COLOURS.green;
  if (tone === 'warning') return COLOURS.red;
  return COLOURS.amberBright;
}

function glow(tone) {
  if (tone === 'positive') return 'rgba(61, 214, 140, 0.55)';
  if (tone === 'warning') return 'rgba(255, 107, 74, 0.5)';
  if (tone === 'positive-soft') return 'rgba(61, 214, 140, 0.28)';
  return 'rgba(245, 166, 35, 0.28)';
}

/**
 * Draw the card into any CanvasRenderingContext2D (browser or test mock).
 */
export function drawShareCard(ctx, card, { width, height } = CARD_SIZES.portrait) {
  const cx = width / 2;
  const tall = height > 1500;
  const pad = 72;

  ctx.fillStyle = COLOURS.bg;
  ctx.fillRect(0, 0, width, height);

  // Subtle top wash and verdict glow
  const g = ctx.createRadialGradient(cx, tall ? 620 : 480, 40, cx, tall ? 620 : 480, tall ? 700 : 520);
  g.addColorStop(0, glow(card.tone));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = accent(card.tone);
  ctx.lineWidth = 8;
  roundRect(ctx, 36, 36, width - 72, height - 72, 48);
  ctx.stroke();

  ctx.fillStyle = COLOURS.amber;
  ctx.font = `700 42px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(card.appName || 'Worth It?', cx, tall ? 180 : 140);

  ctx.fillStyle = COLOURS.text;
  ctx.font = `800 64px ${FONT_STACK}`;
  fitText(ctx, card.name || 'Used car', cx, tall ? 280 : 230, width - pad * 2, 64);

  const meta = [
    card.year,
    card.mileage != null ? formatMiles(card.mileage) : null,
    card.asking != null ? formatGbp(card.asking) : null,
  ].filter(Boolean).join('  ·  ');
  ctx.fillStyle = COLOURS.muted;
  ctx.font = `500 36px ${FONT_STACK}`;
  ctx.fillText(meta, cx, tall ? 350 : 290);

  const scoreY = tall ? 820 : 640;
  ctx.save();
  ctx.shadowColor = glow(card.tone);
  ctx.shadowBlur = 80;
  ctx.fillStyle = accent(card.tone);
  ctx.font = `800 280px ${FONT_STACK}`;
  ctx.fillText(card.score == null ? '—' : String(card.score), cx, scoreY);
  ctx.restore();

  ctx.fillStyle = COLOURS.muted;
  ctx.font = `600 32px ${FONT_STACK}`;
  ctx.fillText('Value Score', cx, scoreY + 56);

  ctx.fillStyle = accent(card.tone);
  const verdictLine = [card.verdict, card.tagline].filter(Boolean).join('  ·  ');
  fitText(ctx, verdictLine, cx, scoreY + 150, width - pad * 2, 56);

  ctx.fillStyle = COLOURS.text;
  ctx.font = `600 40px ${FONT_STACK}`;
  ctx.fillText(card.fairLine || '', cx, scoreY + 230);

  const footerY = height - (tall ? 280 : 220);
  ctx.fillStyle = COLOURS.amberBright;
  ctx.font = `700 36px ${FONT_STACK}`;
  ctx.fillText(`Check yours: ${card.footerUrl}`, cx, footerY);

  ctx.fillStyle = COLOURS.muted;
  ctx.font = `500 28px ${FONT_STACK}`;
  ctx.fillText('Estimate, not a valuation.', cx, footerY + 52);

  if (card.placeholder) {
    ctx.fillStyle = '#ffd789';
    ctx.font = `600 26px ${FONT_STACK}`;
    wrapText(ctx, 'Placeholder data — invented numbers, not a real market valuation.', cx, footerY + 108, width - pad * 2, 34);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, x, y, maxWidth, size) {
  let s = size;
  ctx.font = `800 ${s}px ${FONT_STACK}`;
  while (s > 32 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `800 ${s}px ${FONT_STACK}`;
  }
  ctx.fillText(text, x, y);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, yy);
}

/**
 * @returns {Promise<{ blob: Blob, dataUrl: string, width: number, height: number }>}
 */
export async function renderShareCardPng(card, size = CARD_SIZES.portrait) {
  if (typeof document === 'undefined') {
    throw new Error('renderShareCardPng needs a browser canvas');
  }
  const { width, height } = size;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawShareCard(ctx, card, { width, height });
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
  const dataUrl = canvas.toDataURL('image/png');
  return { blob, dataUrl, width, height, canvas };
}

export async function renderBothCards(card) {
  const portrait = await renderShareCardPng(card, CARD_SIZES.portrait);
  const story = await renderShareCardPng(card, CARD_SIZES.story);
  return { portrait, story };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function shareOrDownload({ blob, filename, title, text, url }) {
  const file = new File([blob], filename, { type: 'image/png' });
  const canFiles = typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] });
  if (canFiles) {
    await navigator.share({ files: [file], title, text, url: url || undefined });
    return 'shared';
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({ title, text, url: url || undefined });
    downloadBlob(blob, filename);
    return 'shared-text-and-downloaded';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
