/**
 * Bookmarklet that runs in the user's own browser on a listing they already
 * have open. It reads structured data / title / visible specs and opens
 * Worth It? on the confirm screen. No server fetch, no stored pages.
 */

const FIELD_KEYS = ['make', 'model', 'year', 'mileage', 'fuel', 'engine', 'gearbox', 'price'];

/**
 * Compact, self-contained extractor. Safe to stringify into a bookmarklet.
 * `ctx` is a plain object so it can run in the page or against a fixture:
 *   { title, html, bodyText, states }
 */
export function extractFromClientContext(ctx) {
  ctx = ctx || {};
  const html = String(ctx.html || '');
  const title = ctx.title || (function () {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? m[1].replace(/\s+/g, ' ').trim() : '';
  })();
  const bodyText = ctx.bodyText || '';
  const fields = {
    make: null, model: null, year: null, mileage: null,
    fuel: null, engine: null, gearbox: null, price: null,
  };

  function meta(name) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + name + '["\']', 'i');
    const m = html.match(re) || html.match(re2);
    return m ? m[1].trim() : null;
  }

  function extractJsonObject(text, start) {
    if (start < 0 || text[start] !== '{') return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  function collectBlobs() {
    const blobs = [];
    if (ctx.states && ctx.states.length) {
      for (let i = 0; i < ctx.states.length; i += 1) blobs.push(ctx.states[i]);
    }
    const ld = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = ld.exec(html))) {
      try { blobs.push(JSON.parse(m[1].trim())); } catch (e) { /* ignore */ }
    }
    const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (next) {
      try { blobs.push(JSON.parse(next[1])); } catch (e) { /* ignore */ }
    }
    const idents = ['__PRELOADED_STATE__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__NUXT__'];
    for (let i = 0; i < idents.length; i += 1) {
      const re = new RegExp('(?:window\\.)?' + idents[i] + '\\s*=\\s*{', 'i');
      const hit = html.match(re);
      if (!hit) continue;
      const obj = extractJsonObject(html, hit.index + hit[0].length - 1);
      if (obj) blobs.push(obj);
    }
    return blobs;
  }

  function walk(node, out, depth) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 6); i += 1) walk(node[i], out, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const keys = Object.keys(node).map(function (k) { return k.toLowerCase(); });
    function has(re) { return keys.some(function (k) { return re.test(k); }); }
    if ((has(/^make$|^brand$|^manufacturer$/) && has(/^model$|^modelname$|^vehiclemodel$/))
      || node.mileageFromOdometer || node.vehicleModelDate || node.vehicleEngine) {
      out.push(node);
    }
    const vals = Object.keys(node);
    for (let i = 0; i < vals.length; i += 1) {
      const v = node[vals[i]];
      if (v && typeof v === 'object') walk(v, out, depth + 1);
    }
  }

  function pick(obj, names) {
    for (let i = 0; i < names.length; i += 1) {
      const v = obj[names[i]];
      if (v == null || v === '') continue;
      if (typeof v === 'object') return v.name || v.value || v.amount || null;
      return v;
    }
    return null;
  }

  function applyVehicleLike(root) {
    const found = [];
    walk(root, found, 0);
    for (let i = 0; i < found.length; i += 1) {
      const obj = found[i];
      const make = pick(obj, ['make', 'brand', 'manufacturer', 'makeName']);
      const model = pick(obj, ['model', 'modelName', 'vehicleModel']);
      if (make && !fields.make) {
        const s = String(typeof make === 'object' ? (make.name || '') : make);
        fields.make = /^vw$/i.test(s) ? 'Volkswagen' : s;
      }
      if (model && !fields.model) fields.model = String(model).replace(/\bfor sale\b/ig, '').trim();
      const year = pick(obj, ['year', 'modelYear', 'vehicleModelDate', 'productionDate']);
      if (year != null && fields.year == null) {
        const ym = String(year).match(/\d{4}/);
        const y = ym ? Number(ym[0]) : NaN;
        if (y >= 1990 && y <= 2030) fields.year = y;
      }
      const miles = pick(obj, ['mileage', 'odometer', 'miles', 'mileageFromOdometer']);
      if (miles != null && fields.mileage == null) {
        const n = typeof miles === 'number' ? miles : Number(String(miles).replace(/,/g, ''));
        if (isFinite(n) && n >= 0 && n <= 500000) fields.mileage = Math.round(n);
      }
      const price = pick(obj, ['price', 'askingPrice', 'salePrice', 'currentPrice']);
      if (price != null && fields.price == null) {
        const n = typeof price === 'number' ? price : Number(String(price).replace(/[£, ]/g, ''));
        if (isFinite(n) && n >= 100) fields.price = Math.round(n);
      }
      if (!fields.fuel) {
        const f = String(pick(obj, ['fuel', 'fuelType', 'vehicleFuelType']) || '').toLowerCase();
        if (/plug[-\s]?in/.test(f) && /hybrid/.test(f)) fields.fuel = 'phev';
        else if (/hybrid/.test(f)) fields.fuel = 'hybrid';
        else if (/diesel/.test(f)) fields.fuel = 'diesel';
        else if (/petrol|gasoline/.test(f)) fields.fuel = 'petrol';
        else if (/electric|bev|\bev\b/.test(f)) fields.fuel = 'electric';
      }
      if (!fields.gearbox) {
        const g = String(pick(obj, ['gearbox', 'transmission', 'vehicleTransmission']) || '').toLowerCase();
        if (/manual/.test(g)) fields.gearbox = 'manual';
        else if (/auto|dsg|cvt|dct|powershift/.test(g)) fields.gearbox = 'auto';
      }
      if (!fields.engine) {
        const e = pick(obj, ['engine', 'engineSize', 'derivative', 'vehicleEngine']);
        if (e) {
          const s = typeof e === 'object' ? (e.name || '') : String(e);
          const mm = s.match(/\b\d\.\d{1,2}(?:\s*(?:L|EcoBoost|TSI|TDI|TDCi))?/i);
          fields.engine = mm ? mm[0].trim() : (s.length < 40 ? s : null);
        }
      }
    }
  }

  function applyText(text) {
    if (!text) return;
    const t = String(text);
    if (fields.year == null) {
      const y = t.match(/\b((?:19|20)\d{2})\b(?:\s*\(\s*\d{2}\s*reg\))?/i);
      const mot = y && /\b(mot|until|warranty|tax)\b/i.test(t.slice(Math.max(0, y.index - 16), y.index));
      if (y && !mot) {
        const n = Number(y[1]);
        if (n >= 1990 && n <= 2030) fields.year = n;
      } else {
        const plate = t.match(/\b(\d{2})\s*reg\b/i);
        if (plate) {
          const yy = Number(plate[1]);
          const n = yy >= 50 ? 2000 + (yy - 50) : 2000 + yy;
          if (n >= 1990 && n <= 2030) fields.year = n;
        }
      }
    }
    if (fields.mileage == null) {
      const k = t.match(/(\d{1,3}(?:\.\d)?)\s*k\s*(?:miles|mile|mls|mi)\b/i);
      if (k) fields.mileage = Math.round(Number(k[1]) * 1000);
      else {
        const mm = t.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,6})\s*(?:miles|mile|mls|mi)\b/i);
        if (mm) fields.mileage = Number(mm[1].replace(/,/g, ''));
      }
    }
    if (fields.price == null) {
      const p = t.match(/£\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})/);
      if (p) {
        const n = Number(p[1].replace(/,/g, ''));
        if (n >= 100) fields.price = n;
      }
    }
    if (!fields.fuel) {
      if (/\bplug[-\s]?in\s+hybrid\b/i.test(t)) fields.fuel = 'phev';
      else if (/\bhybrid\b/i.test(t)) fields.fuel = 'hybrid';
      else if (/\bdiesel\b/i.test(t)) fields.fuel = 'diesel';
      else if (/\bpetrol\b/i.test(t)) fields.fuel = 'petrol';
      else if (/\belectric\b/i.test(t)) fields.fuel = 'electric';
    }
    if (!fields.gearbox) {
      if (/\bmanual\b/i.test(t)) fields.gearbox = 'manual';
      else if (/\b(automatic|auto|dsg|cvt|powershift)\b/i.test(t)) fields.gearbox = 'auto';
    }
    if (!fields.engine) {
      const e = t.match(/\b(\d\.\d{1,2})\s*(EcoBoost|TSI|TFSI|TDI|TDCi|PureTech|GDi|VTEC)?/i)
        || t.match(/\b(\d{3,4})\s*(?:cc|\(\s*cc\s*\))/i);
      if (e) fields.engine = e[0].trim();
    }
    if (!fields.make) {
      const m = t.match(/\b(Volkswagen|Vauxhall|Mercedes-Benz|Land Rover|Alfa Romeo|Peugeot|Renault|Hyundai|Toyota|Nissan|Honda|Suzuki|Mazda|Volvo|Skoda|Škoda|Citroën|Citroen|Seat|SEAT|Audi|BMW|Kia|Ford|Mini|MINI|Fiat|Jeep|Lexus|Tesla|Porsche|Jaguar|Dacia|Cupra|VW)\b/i);
      if (m) fields.make = /^(vw)$/i.test(m[1]) ? 'Volkswagen' : m[1];
    }
    if (fields.make && !fields.model) {
      const name = fields.make === 'Volkswagen' ? '(?:Volkswagen|VW)' : fields.make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(?:' + name + ')\\s+([A-Za-z0-9][A-Za-z0-9-]*)', 'i');
      const m = t.match(re);
      if (m) {
        const model = m[1].replace(/\bfor sale\b/ig, '').trim();
        if (model && !/^(for|used|petrol|diesel|manual|auto)$/i.test(model)) fields.model = model;
      }
    }
  }

  const blobs = collectBlobs();
  for (let i = 0; i < blobs.length; i += 1) applyVehicleLike(blobs[i]);
  applyText([title, meta('og:title'), meta('og:description'), meta('description')].filter(Boolean).join('\n'));
  applyText(bodyText.slice(0, 4000));
  const priceMeta = meta('product:price:amount') || meta('og:price:amount');
  if (priceMeta && fields.price == null) {
    const n = Number(String(priceMeta).replace(/[, ]/g, ''));
    if (isFinite(n) && n >= 100) fields.price = Math.round(n);
  }
  return fields;
}

export function buildImportQuery(fields, extra) {
  extra = extra || {};
  const params = new URLSearchParams();
  for (let i = 0; i < FIELD_KEYS.length; i += 1) {
    const key = FIELD_KEYS[i];
    const value = fields[key];
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  params.set('src', extra.src || 'bookmarklet');
  return params.toString();
}

export function importUrlFromFields(appBase, fields, extra) {
  const q = buildImportQuery(fields, extra);
  const base = String(appBase || '').replace(/\/+$/, '');
  if (!base) return '?' + q;
  return base + '/?' + q;
}

export function bookmarkletBody(appBase) {
  const baseLit = JSON.stringify(String(appBase || '').replace(/\/+$/, '') || '');
  return '(()=>{try{const APP=' + baseLit + ';'
    + 'const html=document.documentElement?document.documentElement.outerHTML:"";'
    + 'const title=document.title||"";'
    + 'const bodyText=(document.body&&document.body.innerText||"").slice(0,4000);'
    + 'const states=[];'
    + 'try{const n=document.getElementById("__NEXT_DATA__");if(n&&n.textContent)states.push(JSON.parse(n.textContent));}catch(e){}'
    + 'for(const k of ["__PRELOADED_STATE__","__INITIAL_STATE__","__NUXT__","__NEXT_DATA__"]){try{if(window[k])states.push(window[k]);}catch(e){}}'
    + 'const extract=' + extractFromClientContext.toString() + ';'
    + 'const fields=extract({title:title,html:html,bodyText:bodyText,states:states});'
    + 'const q=new URLSearchParams();'
    + 'for(const k of ["make","model","year","mileage","fuel","engine","gearbox","price"]){if(fields[k]!=null&&fields[k]!=="")q.set(k,String(fields[k]));}'
    + 'q.set("src","bookmarklet");'
    + 'const base=APP||(location.origin+"/");'
    + 'const url=(base.endsWith("/")?base:base+"/")+"?"+q.toString();'
    + 'location.href=url;'
    + '}catch(e){alert("Couldn\'t read this page. Copy the listing text and paste it into Worth It? instead.");}})()';
}

export function bookmarkletHref(appBase) {
  return 'javascript:' + encodeURIComponent(bookmarkletBody(appBase));
}
