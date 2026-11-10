/**
 * Mobile-first markup for official vehicle data: summary card, MOT
 * timeline, mileage chart, and flags. All user/API text is escaped.
 */
import { formatMiles } from './score.js';
import { formatIsoDate, mileageHistory, motSummaryLine, vehicleFlags } from './vehicleInsights.js';

export const OGL_ATTRIBUTION = 'Contains public sector information licensed under the Open Government Licence v3.0.';
export const NO_ENDORSEMENT = 'Worth It? is not affiliated with or endorsed by DVLA or DVSA.';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badgeClass(kind, ok) {
  if (ok === true) return `badge badge-${kind} is-ok`;
  if (ok === false) return `badge badge-${kind} is-bad`;
  return `badge badge-${kind}`;
}

export function taxBadge(vehicle) {
  const status = vehicle?.taxStatus || vehicle?.vehicleStatus;
  if (!status) return '';
  const lower = String(status).toLowerCase();
  const ok = lower === 'taxed';
  const bad = /sorn|untaxed|not taxed/.test(lower);
  const due = vehicle.taxDueDate ? ` · due ${formatIsoDate(vehicle.taxDueDate)}` : '';
  return `<span class="${badgeClass('tax', ok ? true : (bad ? false : null))}">Tax: ${escapeHtml(status)}${escapeHtml(due)}</span>`;
}

export function motBadge(vehicle) {
  const status = vehicle?.motStatus;
  const expiry = vehicle?.motExpiryDate;
  if (!status && !expiry) return '';
  const lower = String(status || '').toLowerCase();
  const ok = lower === 'valid';
  const bad = /not valid/.test(lower);
  const extra = expiry ? ` · ${ok || !bad ? 'until' : 'expired'} ${formatIsoDate(expiry)}` : '';
  const label = status ? `MOT: ${status}` : 'MOT';
  return `<span class="${badgeClass('mot', ok ? true : (bad ? false : null))}">${escapeHtml(label)}${escapeHtml(extra)}</span>`;
}

export function mileageChartSvg(points, { width = 320, height = 140 } = {}) {
  const data = Array.isArray(points) ? points.filter((p) => p && p.miles != null && p.date) : [];
  if (!data.length) {
    return `<p class="chart-empty">No MOT mileage readings to chart.</p>`;
  }
  const padL = 36;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const miles = data.map((p) => p.miles);
  let min = Math.min(...miles);
  let max = Math.max(...miles);
  if (min === max) {
    min = Math.max(0, min - 1000);
    max = max + 1000;
  }
  const span = max - min || 1;
  const xOf = (i) => (data.length === 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW);
  const yOf = (m) => padT + innerH - ((m - min) / span) * innerH;
  const line = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(p.miles).toFixed(1)}`).join(' ');
  const dots = data.map((p, i) => {
    const cls = p.result === 'FAILED' ? 'is-fail' : 'is-pass';
    return `<circle class="chart-dot ${cls}" cx="${xOf(i).toFixed(1)}" cy="${yOf(p.miles).toFixed(1)}" r="4"><title>${escapeHtml(formatIsoDate(p.date))} · ${escapeHtml(formatMiles(p.miles))}${p.result ? ` · ${escapeHtml(p.result)}` : ''}</title></circle>`;
  }).join('');
  const first = data[0];
  const last = data[data.length - 1];
  const yTicks = [min, max].map((m) => {
    const y = yOf(m);
    return `<text class="chart-label" x="${padL - 4}" y="${y + 3}" text-anchor="end">${escapeHtml(Math.round(m).toLocaleString('en-GB'))}</text>`;
  }).join('');
  return `<svg class="mileage-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="MOT mileage history">
    <line class="chart-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" />
    <line class="chart-axis" x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" />
    ${yTicks}
    <path class="chart-line" d="${line}" fill="none" />
    ${dots}
    <text class="chart-label" x="${padL}" y="${height - 6}">${escapeHtml(formatIsoDate(first.date))}</text>
    <text class="chart-label" x="${padL + innerW}" y="${height - 6}" text-anchor="end">${escapeHtml(formatIsoDate(last.date))}</text>
  </svg>`;
}

function defectList(defects) {
  if (!defects || !defects.length) return '<p class="mot-none">No advisories or failures recorded for this test.</p>';
  const items = defects.map((d) => {
    const typ = d.type ? `<span class="defect-type defect-${escapeHtml(String(d.type).toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(d.type)}</span>` : '';
    const danger = d.dangerous ? ' <span class="defect-type defect-dangerous">DANGEROUS</span>' : '';
    return `<li>${typ}${danger} <span class="defect-text">${escapeHtml(d.text || '')}</span></li>`;
  }).join('');
  return `<ul class="defect-list">${items}</ul>`;
}

export function motTimelineHtml(tests = []) {
  if (!tests.length) {
    return '<p class="mot-none">No MOT tests are on record yet.</p>';
  }
  const items = tests.map((t, i) => {
    const result = t.result || 'UNKNOWN';
    const cls = result === 'PASSED' ? 'is-pass' : (result === 'FAILED' ? 'is-fail' : '');
    const miles = t.odometerMiles != null ? formatMiles(t.odometerMiles) : (t.odometerResultType && t.odometerResultType !== 'READ' ? 'Mileage not read' : '');
    const expiry = t.expiryDate ? ` · expires ${formatIsoDate(t.expiryDate)}` : '';
    const summary = `${formatIsoDate(t.date) || 'Unknown date'} · ${result}${miles ? ` · ${miles}` : ''}`;
    const hasDefects = (t.defects || []).length > 0;
    const openable = hasDefects || result === 'FAILED';
    if (!openable) {
      return `<li class="mot-test ${cls}"><div class="mot-summary">${escapeHtml(summary)}${escapeHtml(expiry)}</div></li>`;
    }
    const open = i === 0 && result === 'FAILED' ? ' open' : '';
    return `<li class="mot-test ${cls}"><details${open}><summary>${escapeHtml(summary)}${escapeHtml(expiry)}</summary>${defectList(t.defects)}</details></li>`;
  }).join('');
  return `<ol class="mot-timeline">${items}</ol>`;
}

export function flagsHtml(flags = []) {
  if (!flags.length) return '';
  const items = flags.map((f) => `<li class="vehicle-flag is-${escapeHtml(f.severity || 'info')}">${escapeHtml(f.text)}</li>`).join('');
  return `<ul class="vehicle-flags">${items}</ul>`;
}

function detailRow(label, value) {
  if (value == null || value === '') return '';
  return `<div class="v-detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function vehicleFacts(vehicle) {
  const rows = [];
  if (vehicle.year || vehicle.yearOfManufacture) rows.push(['Year', vehicle.year || vehicle.yearOfManufacture]);
  if (vehicle.colour) rows.push(['Colour', vehicle.colour]);
  if (vehicle.fuelType) rows.push(['Fuel', vehicle.fuelType]);
  if (vehicle.engineCapacity) rows.push(['Engine', `${Number(vehicle.engineCapacity).toLocaleString('en-GB')} cc`]);
  if (vehicle.co2Emissions != null) rows.push(['CO₂', `${vehicle.co2Emissions} g/km`]);
  if (vehicle.euroStatus) rows.push(['Euro status', vehicle.euroStatus]);
  if (vehicle.typeApproval) rows.push(['Type approval', vehicle.typeApproval]);
  if (vehicle.wheelplan) rows.push(['Wheelplan', titleOrAsIs(vehicle.wheelplan)]);
  if (vehicle.revenueWeight) rows.push(['Revenue weight', `${Number(vehicle.revenueWeight).toLocaleString('en-GB')} kg`]);
  if (vehicle.firstUsedDate) rows.push(['First used', formatIsoDate(vehicle.firstUsedDate)]);
  if (vehicle.registrationDate) rows.push(['Registered', formatIsoDate(vehicle.registrationDate)]);
  if (vehicle.monthOfFirstRegistration) rows.push(['First registered', vehicle.monthOfFirstRegistration]);
  if (vehicle.dateOfLastV5CIssued) rows.push(['Last V5C', formatIsoDate(vehicle.dateOfLastV5CIssued)]);
  if (vehicle.hasOutstandingRecall && vehicle.hasOutstandingRecall !== 'Unknown' && vehicle.hasOutstandingRecall !== 'Unavailable') {
    rows.push(['Outstanding recall', vehicle.hasOutstandingRecall]);
  }
  if (vehicle.latestOdometerMiles != null) {
    const when = vehicle.latestOdometerDate ? ` (MOT on ${formatIsoDate(vehicle.latestOdometerDate)})` : '';
    rows.push(['Latest MOT mileage', `${formatMiles(vehicle.latestOdometerMiles)}${when}`]);
  }
  if (vehicle.testCount) {
    rows.push(['MOT tests', `${vehicle.testCount}${vehicle.failCount ? ` · ${vehicle.failCount} fail${vehicle.failCount === 1 ? '' : 's'}` : ''}`]);
  }
  return rows.map(([k, v]) => detailRow(k, v)).join('');
}

function titleOrAsIs(value) {
  return value;
}

export function sourceNotes(sources) {
  const bits = [];
  if (sources?.ves?.ok) bits.push('DVLA');
  else if (sources?.ves?.status && sources.ves.status !== 'unavailable') bits.push(`DVLA ${statusLabel(sources.ves.status)}`);
  if (sources?.mot?.ok) bits.push('DVSA MOT history');
  else if (sources?.mot?.status && sources.mot.status !== 'unavailable') bits.push(`MOT history ${statusLabel(sources.mot.status)}`);
  return bits.join(' · ');
}

function statusLabel(status) {
  if (status === 'not-found') return 'had no record';
  if (status === 'down') return 'was unavailable';
  if (status === 'rate-limited') return 'was busy';
  return status;
}

export function vehicleCardHtml(vehicle, { sources, now } = {}) {
  if (!vehicle) return '';
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Official vehicle record';
  const year = vehicle.year || vehicle.yearOfManufacture || '';
  const flags = vehicleFlags(vehicle, { now });
  const points = mileageHistory(vehicle.motTests || []);
  const summary = motSummaryLine(vehicle);
  const src = sourceNotes(sources);
  return `
    <h2 class="vehicle-title">${escapeHtml(year ? `${year} ${name}` : name)}</h2>
    <div class="vehicle-badges">${taxBadge(vehicle)}${motBadge(vehicle)}</div>
    ${summary ? `<p class="vehicle-summary">${escapeHtml(summary)}</p>` : ''}
    <dl class="vehicle-facts">${vehicleFacts(vehicle)}</dl>
    ${flagsHtml(flags)}
    <h3 class="vehicle-sub">Mileage history</h3>
    ${mileageChartSvg(points)}
    <h3 class="vehicle-sub">MOT history</h3>
    ${motTimelineHtml(vehicle.motTests || [])}
    ${src ? `<p class="hint">${escapeHtml(`Source: ${src}`)}</p>` : ''}
    <p class="hint ogl-line">${escapeHtml(OGL_ATTRIBUTION)}</p>
    <p class="hint ogl-line">${escapeHtml(NO_ENDORSEMENT)}</p>
  `;
}
