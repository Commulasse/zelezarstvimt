import { DEFAULTS, DAYS, pragueNow, onSale, priceFmt, dateCz, esc } from './defaults.js';

const $ = id => document.getElementById(id);
const PH = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3"><path d="M40 8a14 14 0 0 0-13 19L9 45a5 5 0 0 0 7 7l18-18a14 14 0 0 0 19-13l-8 8-8-2-2-8 8-8a14 14 0 0 0-3-3z"/></svg>';
const imgUrl = k => '/api/img/' + encodeURIComponent(k);
let PRODUCTS = {};

/* ---------- kontaktní údaje a otevírací doba ---------- */

function renderSettings(s) {
  document.querySelectorAll('[data-s]').forEach(el => { el.textContent = s[el.dataset.s] ?? ''; });
  const tel = 'tel:' + String(s.phone).replace(/[^\d+]/g, '');
  document.querySelectorAll('[data-tel]').forEach(a => { a.href = tel; });
  $('phone2').innerHTML = s.phone2 ? `<br><a href="tel:${esc(s.phone2.replace(/[^\d+]/g, ''))}">${esc(s.phone2)}</a>` : '';
  $('mail').href = 'mailto:' + s.email;

  const n = $('notice');
  n.hidden = !(s.notice_on && s.notice.trim());
  n.textContent = s.notice;

  const now = pragueNow();
  const day = DAYS[now.dayIndex];
  const text = s.hours[day] || '';
  let open = false;
  for (const m of text.matchAll(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/g)) {
    const from = m[1].padStart(2, '0') + ':' + m[2], to = m[3].padStart(2, '0') + ':' + m[4];
    if (now.time >= from && now.time < to) open = true;
  }
  $('status').className = 'status' + (open ? ' open' : '');
  $('status').querySelector('span').textContent = open ? 'Právě otevřeno' : 'Teď zavřeno';
  $('todayLabel').textContent = `Dnes (${day.toLowerCase()})`;
  $('todayHours').textContent = text || '—';
  $('hours').innerHTML = DAYS.map(d =>
    `<tr class="${d === day ? 'now' : ''}"><td>${esc(d)}</td><td>${esc(s.hours[d] || '')}</td></tr>`).join('');

  $('navi').href = `https://mapy.com/fnc/v1/route?end=${s.lng},${s.lat}`;
  const lat = +s.lat, lng = +s.lng;
  const map = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - .006}%2C${lat - .0025}%2C${lng + .006}%2C${lat + .0025}&layer=mapnik&marker=${lat}%2C${lng}`;
  if ($('map').src !== map) $('map').src = map;

  $('foot1').textContent = `© ${new Date().getFullYear()} ${s.firm_name} · ${s.owner} · IČO ${s.ico}`;
  $('foot2').textContent = `${s.street}, ${s.city}`;
}

/* ---------- zboží ---------- */

function card(p, today) {
  const sale = onSale(p, today);
  const pct = sale && p.price > 0 ? '−' + Math.round(100 - (p.sale_price / p.price) * 100) + ' %' : '';
  const img = p.image ? `<img src="${imgUrl(p.image)}" alt="${esc(p.name)}" loading="lazy">` : PH;
  const unit = p.unit ? `<span class="unit">/ ${esc(p.unit)}</span>` : '';
  let prices;
  if (sale) {
    prices = `<span class="price">${priceFmt(p.sale_price)}</span>${unit}`
      + (p.price ? `<span class="old">${priceFmt(p.price)}</span>` : '')
      + (p.sale_to ? `<span class="valid">platí do ${dateCz(p.sale_to)}</span>` : '');
  } else if (p.price) {
    prices = `<span class="price">${priceFmt(p.price)}</span>${unit}`;
  } else {
    prices = '<span class="ask">Cena na prodejně</span>';
  }
  const search = `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase();
  return `<button class="card" type="button" data-id="${esc(p.id)}" data-cat="${esc(p.category || '')}" data-search="${esc(search)}">`
    + (pct ? `<span class="badge">${pct}</span>` : '')
    + `<div class="img">${img}</div><div class="body"><span class="cat">${esc(p.category || '')}</span>`
    + `<h3>${esc(p.name)}</h3><div class="prices">${prices}</div></div></button>`;
}

let cat = '', q = '';
function applyFilter() {
  let n = 0;
  document.querySelectorAll('#catalog .card').forEach(c => {
    const ok = (!cat || c.dataset.cat === cat) && (!q || c.dataset.search.includes(q));
    c.hidden = !ok; if (ok) n++;
  });
  $('nores').hidden = n > 0;
}

function renderProducts(list, settings) {
  const today = pragueNow().date;
  list = [...list].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  PRODUCTS = Object.fromEntries(list.map(p => [p.id, p]));

  const sale = list.filter(p => onSale(p, today));
  $('saleGrid').innerHTML = sale.map(p => card(p, today)).join('');
  $('saleEmpty').hidden = sale.length > 0;

  $('katalog').hidden = list.length === 0;
  $('navKat').hidden = list.length === 0;
  $('catalog').innerHTML = list.map(p => card(p, today)).join('');

  const cats = settings.categories.filter(c => list.some(p => p.category === c));
  document.querySelectorAll('#filters .chip').forEach(x => x.remove());
  const chips = [['', 'Vše'], ...cats.map(c => [c, c])].map(([v, l]) =>
    `<button class="chip" type="button" data-f="${esc(v)}" aria-pressed="${v === cat}">${esc(l)}</button>`).join('');
  $('filters').insertAdjacentHTML('afterbegin', chips);
  applyFilter();
}

/* ---------- detail ---------- */

const dlg = $('dlg');
document.addEventListener('click', ev => {
  const chip = ev.target.closest('.chip');
  if (chip) {
    document.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', x === chip));
    cat = chip.dataset.f; applyFilter(); return;
  }
  const c = ev.target.closest('.card');
  if (!c) return;
  const p = PRODUCTS[c.dataset.id]; if (!p) return;
  const sale = onSale(p);
  $('dImg').innerHTML = p.image ? `<img src="${imgUrl(p.image)}" alt="">` : PH;
  $('dCat').textContent = p.category || '';
  $('dName').textContent = p.name;
  $('dDesc').textContent = p.description || '';
  const u = p.unit ? ` <span class="unit">/ ${esc(p.unit)}</span>` : '';
  $('dPrice').innerHTML = sale
    ? `<span class="price" style="color:var(--accent-ink)">${priceFmt(p.sale_price)}</span>${u}${p.price ? `<span class="old">${priceFmt(p.price)}</span>` : ''}${p.sale_to ? `<span class="valid">akce do ${dateCz(p.sale_to)}</span>` : ''}`
    : (p.price ? `<span class="price">${priceFmt(p.price)}</span>${u}` : '<span class="ask">Cena na prodejně</span>');
  dlg.showModal();
});
dlg.querySelector('.close').onclick = () => dlg.close();
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
$('q').oninput = e => { q = e.target.value.trim().toLowerCase(); applyFilter(); };

/* ---------- start ---------- */

renderSettings(DEFAULTS);
renderProducts([], DEFAULTS);
fetch('/api/data')
  .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
  .then(({ settings, products }) => { renderSettings(settings); renderProducts(products, settings); })
  .catch(() => { /* bez serverové části: zobrazí se web s výchozími údaji */ });
