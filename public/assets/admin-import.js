// Import / export zboží z a do Excelu (XLSX, XLS, CSV) + hromadné fotky
import { esc, priceFmt, dateCz } from './defaults.js';

// Sloupce souboru – pořadí odpovídá vzoru i exportu
export const COLUMNS = [
  ['code', 'Kód'],
  ['name', 'Název'],
  ['category', 'Kategorie'],
  ['unit', 'Jednotka'],
  ['price', 'Běžná cena'],
  ['sale_price', 'Akční cena'],
  ['sale_from', 'Akce od'],
  ['sale_to', 'Akce do'],
  ['description', 'Popis'],
  ['visible', 'Zobrazit'],
];

// tolerantní rozpoznání hlaviček (bez diakritiky, různé názvy)
const ALIASES = {
  code: ['kod', 'katalogove cislo', 'cislo', 'ean', 'sku', 'id'],
  name: ['nazev', 'nazev zbozi', 'zbozi', 'produkt', 'polozka'],
  category: ['kategorie', 'skupina'],
  unit: ['jednotka', 'mj', 'mern jednotka', 'merna jednotka'],
  price: ['bezna cena', 'cena', 'puvodni cena', 'cena s dph', 'cena kc'],
  sale_price: ['akcni cena', 'akce cena', 'cena v akci', 'zlevnena cena', 'sleva cena'],
  sale_from: ['akce od', 'od', 'platnost od', 'plati od'],
  sale_to: ['akce do', 'do', 'platnost do', 'plati do'],
  description: ['popis', 'poznamka'],
  visible: ['zobrazit', 'zobrazit na webu', 'viditelne', 'web'],
};
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

let xlsxReady;
export function loadXLSX() {
  xlsxReady ??= new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement('script');
    s.src = '/assets/vendor/xlsx.mini.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = () => rej(new Error('Nepodařilo se načíst knihovnu pro Excel.'));
    document.head.appendChild(s);
  });
  return xlsxReady;
}

/* ---------- převody hodnot ---------- */

function toDate(v, X) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    const d = X.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null; // neplatné
}
function toPrice(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v).replace(/[\s ]|kč|,-/gi, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
function toBool(v) {
  if (v === null || v === undefined || v === '') return true;
  return !['ne', 'no', '0', 'false', 'skryt', 'skryto', 'n'].includes(norm(v));
}

/* ---------- čtení souboru ---------- */

export async function parseFile(file, categories) {
  const X = await loadXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames.find(n => norm(n) === 'zbozi') || wb.SheetNames[0];
  const grid = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });

  // najdi řádek s hlavičkou (musí obsahovat „Název“)
  const hi = grid.findIndex(r => r.some(c => ALIASES.name.includes(norm(c))));
  if (hi < 0) throw new Error('V souboru chybí sloupec „Název“. Použijte vzorový soubor.');
  const map = {};
  grid[hi].forEach((h, i) => {
    const n = norm(h);
    for (const [k, al] of Object.entries(ALIASES)) if (map[k] === undefined && al.includes(n)) map[k] = i;
  });

  const catNorm = new Map(categories.map(c => [norm(c), c]));
  const rows = [];
  for (let r = hi + 1; r < grid.length; r++) {
    const g = grid[r];
    const get = k => (map[k] === undefined ? '' : g[map[k]]);
    const name = String(get('name')).trim();
    if (!name && g.every(c => String(c).trim() === '')) continue; // prázdný řádek
    const errs = [];
    const row = {
      row: r + 1,
      code: String(get('code')).trim().replace(/\.0$/, ''),
      name,
      category: String(get('category')).trim(),
      unit: String(get('unit')).trim() || 'ks',
      description: String(get('description')).trim(),
      visible: toBool(get('visible')),
    };
    if (!name) errs.push('chybí název');
    row.price = toPrice(get('price'));
    if (Number.isNaN(row.price)) { errs.push('běžná cena není číslo'); row.price = null; }
    row.sale_price = toPrice(get('sale_price'));
    if (Number.isNaN(row.sale_price)) { errs.push('akční cena není číslo'); row.sale_price = null; }
    row.sale_from = toDate(get('sale_from'), X);
    row.sale_to = toDate(get('sale_to'), X);
    if (row.sale_from === null) { errs.push('špatné datum „Akce od“'); row.sale_from = ''; }
    if (row.sale_to === null) { errs.push('špatné datum „Akce do“'); row.sale_to = ''; }
    if (row.sale_from && row.sale_to && row.sale_to < row.sale_from) errs.push('akce končí dřív, než začne');
    if (row.sale_price !== null && row.price !== null && row.sale_price >= row.price) errs.push('akční cena není nižší než běžná');
    row.is_sale = row.sale_price !== null;
    // kategorie: sjednotit psaní s existující, neznámou ponechat (přidá se)
    if (row.category) row.category = catNorm.get(norm(row.category)) || row.category;
    row.newCategory = row.category && !catNorm.has(norm(row.category));
    row.errors = errs;
    rows.push(row);
  }
  if (!rows.length) throw new Error('Pod hlavičkou nejsou žádné řádky se zbožím.');
  return rows;
}

// u každého řádku urči, jestli přepíše existující zboží (stejně jako server)
export function matchRows(rows, products) {
  const byCode = new Map(products.filter(p => p.code).map(p => [p.code.toLowerCase(), p]));
  const byName = new Map(products.map(p => [p.name.toLowerCase(), p]));
  const seen = new Set();
  for (const r of rows) {
    const c = r.code.toLowerCase();
    r.existing = (c && byCode.get(c)) || (!c && byName.get(r.name.toLowerCase())) || null;
    const key = c || 'n:' + r.name.toLowerCase();
    if (seen.has(key)) r.errors.push(c ? 'kód je v souboru dvakrát' : 'název je v souboru dvakrát');
    seen.add(key);
  }
  return rows;
}

/* ---------- export ---------- */

export async function exportXLSX(products) {
  const X = await loadXLSX();
  const data = [COLUMNS.map(c => c[1])];
  for (const p of products) {
    data.push([
      p.code || '', p.name, p.category || '', p.unit || '',
      p.price ?? '', p.sale_price ?? '',
      p.sale_from ? dateCz(p.sale_from) : '', p.sale_to ? dateCz(p.sale_to) : '',
      p.description || '', p.visible ? 'ano' : 'ne',
    ]);
  }
  const ws = X.utils.aoa_to_sheet(data);
  ws['!cols'] = [10, 38, 22, 9, 11, 11, 11, 11, 50, 9].map(w => ({ wch: w }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Zboží');
  const d = new Date();
  X.writeFile(wb, `zelezarstvi-katalog-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`);
}

/* ---------- náhled ---------- */

export function previewTable(rows) {
  const tr = rows.map(r => {
    const st = r.errors.length ? '<span class="pill err">Chyba</span>'
      : r.existing ? '<span class="pill blue">Úprava</span>' : '<span class="pill ok">Nové</span>';
    const sale = r.is_sale
      ? `<strong style="color:var(--accent-ink)">${priceFmt(r.sale_price)}</strong>${r.sale_to ? `<br><small>do ${dateCz(r.sale_to)}</small>` : ''}`
      : '<span class="muted">—</span>';
    return `<tr class="${r.errors.length ? 'bad' : ''}">
      <td class="muted">${r.row}</td><td>${st}</td>
      <td><b>${esc(r.name || '(bez názvu)')}</b>${r.code ? `<br><small class="muted">${esc(r.code)}</small>` : ''}
        ${r.errors.length ? `<div class="errtxt">${esc(r.errors.join(', '))}</div>` : ''}</td>
      <td>${esc(r.category)}${r.newCategory ? ' <small class="muted">(nová)</small>' : ''}</td>
      <td class="r">${r.price !== null ? priceFmt(r.price) : '<span class="muted">na prodejně</span>'}</td>
      <td class="r">${sale}</td>
      <td>${r.visible ? 'ano' : '<span class="muted">skryto</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="tablewrap"><table class="pv">
    <thead><tr><th>Ř.</th><th>Stav</th><th>Název</th><th>Kategorie</th><th class="r">Cena</th><th class="r">Akce</th><th>Web</th></tr></thead>
    <tbody>${tr}</tbody></table></div>`;
}
