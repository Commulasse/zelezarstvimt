import { DAYS, pragueNow, onSale, priceFmt, dateCz, esc } from './defaults.js';
import { parseFile, matchRows, exportXLSX, previewTable } from './admin-import.js';

const app = document.getElementById('app');
const state = { products: [], settings: null, view: 'list', filter: '', q: '', flash: null, sel: new Set(), imp: null, photos: null };

/* ---------- komunikace se serverem ---------- */

async function api(path, body) {
  const r = await fetch('/api' + path, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await r.json(); } catch { /* prázdná odpověď */ }
  if (r.status === 404 && !data.error) throw new Error('Serverová část webu neběží. Web je potřeba nasadit přes Netlify CLI nebo GitHub (viz NAVOD.txt), ne přetažením ZIPu.');
  if (!r.ok) { const e = new Error(data.error || 'Chyba ' + r.status); e.status = r.status; throw e; }
  return data;
}

async function reload() {
  const d = await api('/admin/data');
  state.products = d.products;
  state.settings = d.settings;
}

function flash(msg, type = 'ok') { state.flash = [msg, type]; }
function flashHtml() {
  if (!state.flash) return '';
  const [m, t] = state.flash; state.flash = null;
  return `<div class="msg ${t}">${esc(m)}</div>`;
}

async function run(fn, btn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) {
    if (e.status === 401) return showLogin('Přihlášení vypršelo, přihlaste se znovu.');
    flash(e.message, 'err'); render();
  } finally { if (btn) btn.disabled = false; }
}

/* ---------- přihlášení ---------- */

function showLogin(msg = '') {
  app.innerHTML = `
  <main class="wrap login"><div class="box">
    <h1 style="font-size:32px">Administrace</h1>
    ${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
    <form id="lf">
      <label class="f"><span>Heslo</span><input type="password" name="password" autofocus required autocomplete="current-password"></label>
      <button class="btn btn-accent" style="width:100%;justify-content:center">Přihlásit</button>
    </form>
    <p class="muted" style="margin:16px 0 0"><a href="/">← Zpět na web</a></p>
  </div></main>`;
  const f = document.getElementById('lf');
  f.onsubmit = async e => {
    e.preventDefault();
    const b = f.querySelector('button'); b.disabled = true;
    try {
      await api('/login', { password: f.password.value });
      await reload(); state.view = 'list'; render();
    } catch (err) { showLogin(err.message); }
  };
}

/* ---------- rámec ---------- */

function shell(inner) {
  const v = state.view;
  app.innerHTML = `
  <header class="bar"><div class="wrap">
    <a class="brand" data-go="list" style="text-decoration:none;cursor:pointer">Železářství <b>MT</b></a>
    <a class="t ${v === 'list' ? 'on' : ''}" data-go="list">Zboží</a>
    <a class="t ${v === 'import' ? 'on' : ''}" data-go="import">Excel</a>
    <a class="t ${v === 'settings' ? 'on' : ''}" data-go="settings">Nastavení</a>
    <a class="t" href="/" target="_blank">Web ↗</a>
    <a class="t" id="logout">Odhlásit</a>
  </div></header>
  <main class="wrap">${flashHtml()}${inner}</main>`;
  app.querySelectorAll('[data-go]').forEach(a => a.onclick = () => { state.view = a.dataset.go; state.edit = null; render(); });
  document.getElementById('logout').onclick = async () => { await api('/logout', {}).catch(() => {}); showLogin(); };
}

function render() {
  if (state.view === 'edit') return renderEdit();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'import') return renderImport();
  return renderList();
}

/* ---------- seznam ---------- */

function saleState(p, today) {
  if (p.sale_price === null || p.sale_price === undefined) return ['', ''];
  if (p.sale_to && p.sale_to < today) return ['Akce skončila', 'gray'];
  if (p.sale_from && p.sale_from > today) return ['Akce od ' + dateCz(p.sale_from), 'blue'];
  return ['V akci' + (p.sale_to ? ' do ' + dateCz(p.sale_to) : ''), 'orange'];
}

function renderList() {
  const today = pragueNow().date;
  const all = [...state.products].sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  const cnt = {
    all: all.length,
    sale: all.filter(p => onSale(p, today)).length,
    hidden: all.filter(p => !p.visible).length,
    expired: all.filter(p => p.sale_price !== null && p.sale_to && p.sale_to < today).length,
  };
  const q = state.q.toLowerCase();
  const list = all.filter(p => {
    if (state.filter === 'sale' && !onSale(p, today)) return false;
    if (state.filter === 'hidden' && p.visible) return false;
    if (q && !`${p.name} ${p.category}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // vybrané jen z existujícího zboží
  for (const id of state.sel) if (!state.products.some(p => p.id === id)) state.sel.delete(id);
  const nSel = state.sel.size;
  const allSel = list.length > 0 && list.every(p => state.sel.has(p.id));

  const rows = list.map(p => {
    const [st, cls] = saleState(p, today);
    return `<div class="item ${p.visible ? '' : 'hid'} ${state.sel.has(p.id) ? 'sel' : ''}">
      <label class="pick"><input type="checkbox" data-sel="${esc(p.id)}" ${state.sel.has(p.id) ? 'checked' : ''} aria-label="Vybrat"></label>
      <div class="th">${p.image ? `<img src="/api/img/${esc(p.image)}" alt="">` : 'bez foto'}</div>
      <div>
        <b>${esc(p.name)}${st ? ` <span class="pill ${cls}">${esc(st)}</span>` : ''}${p.visible ? '' : ' <span class="pill hidden">Skryto</span>'}</b>
        <small>${p.code ? esc(p.code) + ' · ' : ''}${esc(p.category || '')}
          ${p.sale_price !== null && p.sale_price !== undefined ? ` · <strong style="color:var(--accent-ink)">${priceFmt(p.sale_price)}</strong>` : ''}
          ${p.price ? ' · ' + (p.sale_price !== null && p.sale_price !== undefined ? `<s>${priceFmt(p.price)}</s>` : priceFmt(p.price)) : ''}
        </small>
      </div>
      <div class="acts">
        <button class="btn btn-line btn-sm" data-a="edit" data-id="${esc(p.id)}">Upravit</button>
        ${p.sale_price !== null && p.sale_price !== undefined ? `<button class="btn btn-line btn-sm" data-a="endsale" data-id="${esc(p.id)}">Ukončit akci</button>` : ''}
        <button class="btn btn-line btn-sm" data-a="toggle" data-id="${esc(p.id)}">${p.visible ? 'Skrýt' : 'Zobrazit'}</button>
        <button class="btn btn-line btn-sm" style="color:var(--accent-ink)" data-a="delete" data-id="${esc(p.id)}">Smazat</button>
      </div>
    </div>`;
  }).join('');

  shell(`
    <div class="tools">
      <h1 style="margin:0">Zboží</h1><span class="sp"></span>
      <button class="btn btn-accent" data-new="sale">+ Akční zboží</button>
      <button class="btn btn-dark" data-new="">+ Zboží do katalogu</button>
    </div>
    <div class="tools">
      <nav class="tabs">
        <button class="${state.filter === '' ? 'on' : ''}" data-f="">Vše (${cnt.all})</button>
        <button class="${state.filter === 'sale' ? 'on' : ''}" data-f="sale">V akci (${cnt.sale})</button>
        <button class="${state.filter === 'hidden' ? 'on' : ''}" data-f="hidden">Skryté (${cnt.hidden})</button>
      </nav>
      <span class="sp"></span>
      <input type="search" id="q" value="${esc(state.q)}" placeholder="Hledat…" style="width:200px">
      ${cnt.expired ? `<button class="btn btn-line btn-sm" id="cleanup" title="U zboží s prošlým datem akce zruší akční cenu">Ukončit prošlé akce (${cnt.expired})</button>` : ''}
    </div>
    ${list.length ? `
      <div class="bulk ${nSel ? 'on' : ''}">
        <label class="check" style="margin:0"><input type="checkbox" id="selAll" ${allSel ? 'checked' : ''}> ${nSel ? `Vybráno: <b>${nSel}</b>` : 'Vybrat vše'}</label>
        ${nSel ? `
        <span class="grp">
          <input type="text" id="bPct" inputmode="decimal" placeholder="%" style="width:64px">
          <input type="date" id="bFrom" value="${today}" title="Akce od">
          <input type="date" id="bTo" title="Akce do (prázdné = do odvolání)">
          <button class="btn btn-accent btn-sm" data-bulk="discount">Dát slevu</button>
        </span>
        <span class="grp">
          <button class="btn btn-line btn-sm" data-bulk="endsale">Ukončit akci</button>
          <button class="btn btn-line btn-sm" data-bulk="hide">Skrýt</button>
          <button class="btn btn-line btn-sm" data-bulk="show">Zobrazit</button>
          <select id="bCat" style="width:auto;padding:6px 8px;font-size:14px"><option value="">Přesunout do kategorie…</option>${state.settings.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select>
          <button class="btn btn-line btn-sm" style="color:var(--accent-ink)" data-bulk="delete">Smazat</button>
        </span>` : '<span class="muted">Zaškrtněte zboží a můžete mu najednou dát slevu, ukončit akci, skrýt ho nebo smazat.</span>'}
      </div>
      <div class="items">${rows}</div>`
      : `<div class="box" style="text-align:center;color:var(--ink-2)">${cnt.all ? 'Nic neodpovídá filtru.'
        : 'Zatím tu není žádné zboží. Přidejte ho tlačítkem „+ Akční zboží“, nebo nahrajte celý katalog z Excelu.<br><br><button class="btn btn-dark" data-go="import">Nahrát z Excelu</button>'}</div>`}
  `);
  app.querySelectorAll('main [data-go]').forEach(a => a.onclick = () => { state.view = a.dataset.go; render(); });

  // výběr
  app.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
    c.checked ? state.sel.add(c.dataset.sel) : state.sel.delete(c.dataset.sel); renderList();
  });
  const sa = document.getElementById('selAll');
  if (sa) sa.onchange = () => { list.forEach(p => (sa.checked ? state.sel.add(p.id) : state.sel.delete(p.id))); renderList(); };
  const bc = document.getElementById('bCat');
  if (bc) bc.onchange = () => bc.value && bulk('category', { category: bc.value }, bc);
  app.querySelectorAll('[data-bulk]').forEach(b => b.onclick = () => {
    const op = b.dataset.bulk;
    if (op === 'discount') {
      return bulk(op, { percent: document.getElementById('bPct').value, sale_from: document.getElementById('bFrom').value, sale_to: document.getElementById('bTo').value }, b);
    }
    if (op === 'delete' && !confirm(`Opravdu smazat ${nSel} položek?`)) return;
    bulk(op, {}, b);
  });

  app.querySelectorAll('[data-new]').forEach(b => b.onclick = () => { state.view = 'edit'; state.edit = { isNew: true, sale: !!b.dataset.new }; render(); });
  app.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.filter = b.dataset.f; render(); });
  const qi = document.getElementById('q');
  qi.oninput = () => { state.q = qi.value; const pos = qi.selectionStart; renderList(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
  const cl = document.getElementById('cleanup');
  if (cl) cl.onclick = () => run(async () => {
    const r = await api('/admin/cleanup', { today: pragueNow().date });
    await reload(); flash(r.count ? `Ukončeno prošlých akcí: ${r.count}.` : 'Žádné prošlé akce.'); render();
  }, cl);

  app.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const id = b.dataset.id, a = b.dataset.a;
    const p = state.products.find(x => x.id === id);
    if (a === 'edit') { state.view = 'edit'; state.edit = { id }; return render(); }
    if (a === 'delete' && !confirm(`Opravdu smazat „${p.name}“?`)) return;
    run(async () => {
      await api('/admin/' + a, { id });
      await reload();
      if (a === 'delete') flash('Zboží smazáno.');
      if (a === 'endsale') flash('Akce u zboží ukončena, zboží zůstává v katalogu.');
      render();
    }, b);
  });
}

function bulk(op, extra, btn) {
  const n = state.sel.size;
  return run(async () => {
    const r = await api('/admin/bulk', { ids: [...state.sel], op, ...extra });
    await reload();
    const msg = {
      discount: `Sleva nastavena u ${r.count} položek.` + (r.skipped ? ` ${r.skipped} položek nemá běžnou cenu, slevu jsem jim nedal.` : ''),
      endsale: `Akce ukončena u ${r.count} položek.`,
      hide: `Skryto ${r.count} položek.`, show: `Zobrazeno ${r.count} položek.`,
      category: `Přesunuto ${r.count} položek.`, delete: `Smazáno ${n} položek.`,
    }[op];
    if (op === 'delete') state.sel.clear();
    flash(msg); render();
  }, btn);
}

/* ---------- import / export ---------- */

function renderImport() {
  const imp = state.imp;
  const ph = state.photos;
  let inner;

  if (imp?.rows) {
    const bad = imp.rows.filter(r => r.errors.length).length;
    const nNew = imp.rows.filter(r => !r.errors.length && !r.existing).length;
    const nUpd = imp.rows.filter(r => !r.errors.length && r.existing).length;
    const nSale = imp.rows.filter(r => r.is_sale).length;
    inner = `
      <div class="box">
        <div class="tools" style="margin-bottom:10px">
          <div><b style="font-size:18px">${esc(imp.fileName)}</b><br>
          <span class="muted">${imp.rows.length} řádků · nové ${nNew} · úpravy ${nUpd} · v akci ${nSale}${bad ? ` · <b style="color:var(--accent-ink)">chyby ${bad}</b>` : ''}</span></div>
          <span class="sp"></span>
          <button class="btn btn-line" id="impCancel">Zrušit</button>
          <button class="btn btn-accent" id="impGo" ${bad ? 'disabled title="Nejdřív opravte chyby v souboru"' : ''}>Nahrát ${nNew + nUpd} položek</button>
        </div>
        ${bad ? '<div class="msg err" style="margin:0 0 12px">Některé řádky mají chybu (červeně). Opravte je v Excelu a soubor nahrajte znovu – nic se zatím neuložilo.</div>'
          : `<p class="muted" style="margin:0 0 12px">Zkontrolujte náhled. Zboží se stejným kódem (nebo bez kódu se stejným názvem) se přepíše, ostatní se přidá. Fotky zůstávají.</p>`}
        ${previewTable(imp.rows)}
      </div>`;
  } else {
    inner = `
      <div class="imp-grid">
        <div class="box">
          <legend>Nahrát z Excelu</legend>
          <label class="drop" id="drop">
            <input type="file" id="xf" accept=".xlsx,.xls,.csv,.ods" hidden>
            <b>Vyberte soubor</b> nebo ho sem přetáhněte<br><span class="muted">XLSX, XLS, CSV</span>
          </label>
          <p class="muted">Sloupce: <b>Kód</b>, <b>Název</b>, Kategorie, Jednotka, Běžná cena, Akční cena, Akce od, Akce do, Popis, Zobrazit.
          Povinný je jen Název. Když vyplníte Akční cenu, zboží půjde do akcí.</p>
          <p style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0">
            <a class="btn btn-line btn-sm" href="/admin/vzor-import.xlsx" download>Stáhnout vzor (prázdný)</a>
            <button class="btn btn-line btn-sm" id="demo">Načíst ukázkový sortiment</button>
          </p>
        </div>
        <div class="box">
          <legend>Stáhnout do Excelu</legend>
          <p class="muted" style="margin-top:0">Celý katalog jako XLSX. Upravte ceny nebo akce v Excelu a nahrajte ho zpátky – zboží se spáruje podle kódu.</p>
          <button class="btn btn-dark" id="exp" ${state.products.length ? '' : 'disabled'}>Stáhnout katalog (${state.products.length})</button>
        </div>
        <div class="box" style="grid-column:1/-1">
          <legend>Hromadně nahrát fotky</legend>
          <p class="muted" style="margin-top:0">Pojmenujte fotky podle <b>kódu</b> zboží (např. <code>V-440.jpg</code>) nebo přesně podle názvu a vyberte jich víc najednou. Přiřadí se samy.</p>
          <input type="file" id="pf" accept="image/*" multiple>
          ${ph ? `<div class="photos">${ph.map(x => `
            <div class="ph ${x.p ? '' : 'miss'}"><span>${esc(x.file.name)}</span>
            <span>${x.p ? '→ ' + esc(x.p.name) : 'nenalezeno'}</span>
            <span class="st">${x.status || ''}</span></div>`).join('')}</div>
            <p style="margin:12px 0 0"><button class="btn btn-accent" id="phGo" ${ph.some(x => x.p && !x.status) ? '' : 'disabled'}>Nahrát ${ph.filter(x => x.p && !x.status).length} fotek</button></p>` : ''}
        </div>
      </div>`;
  }

  shell(`<h1>Excel a hromadné nahrávání</h1>${inner}`);

  const load = async (file, name) => {
    try {
      const rows = matchRows(await parseFile(file, state.settings.categories), state.products);
      state.imp = { rows, fileName: name || file.name }; render();
    } catch (e) { flash(e.message, 'err'); state.imp = null; render(); }
  };
  const xf = document.getElementById('xf');
  if (xf) {
    xf.onchange = () => xf.files[0] && load(xf.files[0]);
    const drop = document.getElementById('drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };
    document.getElementById('demo').onclick = async () => {
      const r = await fetch('/admin/vzor-sortiment.xlsx');
      load(new File([await r.blob()], 'vzor-sortiment.xlsx'), 'Ukázkový sortiment (vzor-sortiment.xlsx)');
    };
    document.getElementById('exp').onclick = () => exportXLSX(state.products).catch(e => { flash(e.message, 'err'); render(); });
  }
  const go = document.getElementById('impGo');
  if (go) {
    document.getElementById('impCancel').onclick = () => { state.imp = null; render(); };
    go.onclick = () => run(async () => {
      const rows = imp.rows.map(({ errors, existing, newCategory, ...r }) => r);
      const r = await api('/admin/import', { rows });
      await reload(); state.imp = null;
      flash(`Hotovo: přidáno ${r.added}, upraveno ${r.updated} položek.` + (r.newCategories?.length ? ` Nové kategorie: ${r.newCategories.join(', ')}.` : ''));
      state.view = 'list'; state.filter = ''; render();
    }, go);
  }

  // hromadné fotky
  const pf = document.getElementById('pf');
  if (pf) pf.onchange = () => {
    const byCode = new Map(state.products.filter(p => p.code).map(p => [p.code.toLowerCase(), p]));
    const byName = new Map(state.products.map(p => [p.name.toLowerCase(), p]));
    state.photos = [...pf.files].map(file => {
      const base = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
      return { file, p: byCode.get(base) || byName.get(base) || null };
    });
    render();
  };
  const phGo = document.getElementById('phGo');
  if (phGo) phGo.onclick = async () => {
    phGo.disabled = true;
    let ok = 0;
    for (const x of state.photos.filter(x => x.p && !x.status)) {
      x.status = 'nahrávám…'; render();
      try { await api('/admin/image', { id: x.p.id, image: await resizeImage(x.file) }); x.status = '✓'; ok++; }
      catch (e) { if (e.status === 401) return showLogin('Přihlášení vypršelo.'); x.status = '✗ ' + e.message; }
    }
    await reload();
    flash(`Nahráno ${ok} fotek.`); render();
  };
}

/* ---------- úprava zboží ---------- */

// zmenšení fotky v prohlížeči (max 1200 px, JPEG) – rychlé nahrávání i z mobilu
async function resizeImage(file, max = 1200) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i);
      i.onerror = () => rej(new Error('Tento formát obrázku prohlížeč neumí otevřít. Zkuste JPG nebo PNG.'));
      i.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.84);
}

function renderEdit() {
  const ed = state.edit || { isNew: true };
  const s = state.settings;
  const found = ed.id && state.products.find(p => p.id === ed.id);
  const isNew = !found;
  const p = ed.form || found || {
    name: '', category: s.categories[0], description: '', unit: 'ks', price: null,
    sale_price: null, sale_from: pragueNow().date, sale_to: '', visible: true, image: '',
  };
  const isSale = ed.form ? !!ed.form.is_sale : (p.sale_price !== null && p.sale_price !== undefined) || (isNew && ed.sale);
  const cats = [...s.categories];
  if (p.category && !cats.includes(p.category)) cats.push(p.category);
  const val = v => (v === null || v === undefined ? '' : String(v).replace('.', ','));

  shell(`
    <h1>${isNew ? (isSale ? 'Nové akční zboží' : 'Nové zboží') : 'Upravit zboží'}</h1>
    <form class="box" id="ef">
      <div class="edit-grid">
        <div>
          <label class="f"><span>Název zboží *</span><input type="text" name="name" value="${esc(p.name)}" required maxlength="140" placeholder="např. Aku vrtačka Narex 18 V"></label>
          <div class="cols3">
            <label class="f"><span>Kód (nepovinné)</span><input type="text" name="code" value="${esc(p.code || '')}" maxlength="40" placeholder="např. V-440"></label>
            <label class="f"><span>Kategorie</span><select name="category">${cats.map(c => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label class="f"><span>Jednotka (ks, m, bal…)</span><input type="text" name="unit" value="${esc(p.unit)}" maxlength="20"></label>
          </div>
          <label class="f"><span>Popis (nepovinné)</span><textarea name="description" maxlength="2000" placeholder="Parametry, balení, co je v sadě…">${esc(p.description)}</textarea></label>
          <label class="f"><span>Běžná cena v Kč (prázdné = „Cena na prodejně“)</span><input type="text" name="price" inputmode="decimal" value="${esc(val(p.price))}" placeholder="např. 1 290"></label>
          <label class="check"><input type="checkbox" name="is_sale" ${isSale ? 'checked' : ''}> Zboží je v akci</label>
          <div class="salebox" id="saleBox" ${isSale ? '' : 'hidden'}>
            <div class="cols3">
              <label class="f"><span>Akční cena v Kč *</span><input type="text" name="sale_price" inputmode="decimal" value="${esc(val(p.sale_price))}" placeholder="např. 990"></label>
              <label class="f"><span>Platí od</span><input type="date" name="sale_from" value="${esc(p.sale_from || '')}"></label>
              <label class="f"><span>Platí do (prázdné = do odvolání)</span><input type="date" name="sale_to" value="${esc(p.sale_to || '')}"></label>
            </div>
            <p class="muted" style="margin:-4px 0 14px">Po datu „platí do“ zmizí zboží z akcí samo a zůstane jen v katalogu.</p>
          </div>
          <label class="check"><input type="checkbox" name="visible" ${p.visible ? 'checked' : ''}> Zobrazit na webu</label>
        </div>
        <div>
          <span class="muted" style="display:block;margin-bottom:5px;font-weight:600">Fotka</span>
          <div class="preview" id="prev">${p.image ? `<img src="/api/img/${esc(p.image)}" alt="">` : 'bez fotky'}</div>
          <input type="file" id="img" accept="image/*">
          <p class="muted">Z mobilu můžete rovnou vyfotit. Fotka se sama zmenší.</p>
          ${p.image ? '<label class="check" style="font-weight:500"><input type="checkbox" name="remove_image"> Odstranit fotku</label>' : ''}
        </div>
      </div>
      <div class="tools" style="margin:8px 0 0">
        <button class="btn btn-accent" type="submit">Uložit</button>
        ${isNew ? '<button class="btn btn-line" type="submit" data-again="1">Uložit a přidat další</button>' : ''}
        <button class="btn btn-line" type="button" id="cancel">Zrušit</button>
      </div>
    </form>`);

  const f = document.getElementById('ef');
  let image = null;
  f.is_sale.onchange = () => { document.getElementById('saleBox').hidden = !f.is_sale.checked; };
  document.getElementById('cancel').onclick = () => { state.view = 'list'; state.edit = null; render(); };
  document.getElementById('img').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const prev = document.getElementById('prev');
    prev.textContent = 'Zpracovávám…';
    try { image = await resizeImage(file); prev.innerHTML = `<img src="${image}" alt="">`; }
    catch (err) { image = null; prev.textContent = err.message; }
  };
  f.onsubmit = e => {
    e.preventDefault();
    const again = e.submitter?.dataset.again;
    const body = {
      id: found ? found.id : '',
      code: f.code.value, name: f.name.value, category: f.category.value, unit: f.unit.value, description: f.description.value,
      price: f.price.value, is_sale: f.is_sale.checked, sale_price: f.sale_price.value,
      sale_from: f.sale_from.value, sale_to: f.sale_to.value, visible: f.visible.checked,
      remove_image: !!f.remove_image?.checked, image,
    };
    run(async () => {
      try {
        await api('/admin/save', body);
      } catch (err) {
        if (err.status === 401) throw err;
        state.edit = { ...ed, form: { ...body, image: found?.image || '' } };
        throw err;
      }
      await reload();
      flash(isNew ? 'Zboží přidáno.' : 'Změny uloženy.');
      if (again) { state.edit = { isNew: true, sale: body.is_sale }; state.view = 'edit'; }
      else { state.view = 'list'; state.edit = null; }
      render();
      scrollTo(0, 0);
    }, e.submitter);
  };
}

/* ---------- nastavení ---------- */

function renderSettings() {
  const s = state.settings;
  const field = (k, label, type = 'text') => `<label class="f"><span>${label}</span><input type="${type}" name="${k}" value="${esc(s[k])}"></label>`;
  shell(`
    <h1>Nastavení webu</h1>
    <form class="box" id="sf" style="margin-bottom:20px">
      <fieldset><legend>Oznámení na webu</legend>
        <label class="check"><input type="checkbox" name="notice_on" ${s.notice_on ? 'checked' : ''}> Zobrazit žlutý pruh nahoře na webu</label>
        <label class="f"><span>Text oznámení</span><input type="text" name="notice" value="${esc(s.notice)}" maxlength="200" placeholder="např. 17. 11. zavřeno – státní svátek"></label>
      </fieldset>
      <fieldset><legend>Otevírací doba</legend>
        ${DAYS.map((d, i) => `<div class="hrow"><span>${d}</span><input type="text" name="h${i}" value="${esc(s.hours[d] || '')}"></div>`).join('')}
        <p class="muted">Formát např. „8:00–12:00, 13:00–16:00“ nebo „Zavřeno“. Podle toho web ukazuje „Právě otevřeno“.</p>
      </fieldset>
      <fieldset><legend>Kategorie zboží</legend>
        <label class="f"><span>Jedna kategorie na řádek</span><textarea name="categories" style="min-height:220px">${esc(s.categories.join('\n'))}</textarea></label>
      </fieldset>
      <fieldset><legend>Kontaktní údaje</legend>
        <div class="cols">
          ${field('firm_name', 'Název')}${field('owner', 'Provozovatel')}
          ${field('ico', 'IČO')}${field('since', 'Na trhu od roku')}
          ${field('street', 'Ulice')}${field('city', 'PSČ a město')}
          ${field('phone', 'Telefon')}${field('phone2', 'Druhý telefon')}
          ${field('email', 'E-mail', 'email')}
        </div>
        <label class="f"><span>Text v úvodu webu</span><textarea name="tagline" style="min-height:70px">${esc(s.tagline)}</textarea></label>
      </fieldset>
      <button class="btn btn-accent">Uložit nastavení</button>
    </form>
    <div class="box">
      <legend style="display:block">Heslo</legend>
      <p class="muted" style="margin:0">Heslo se mění v Netlify: Site configuration → Environment variables → <b>ADMIN_PASSWORD</b>. Po změně stačí v Netlify kliknout na Deploys → Trigger deploy.</p>
    </div>`);

  const f = document.getElementById('sf');
  f.onsubmit = e => {
    e.preventDefault();
    const body = Object.fromEntries(['firm_name', 'owner', 'ico', 'since', 'street', 'city', 'phone', 'phone2', 'email', 'tagline', 'notice', 'categories'].map(k => [k, f[k].value]));
    body.notice_on = f.notice_on.checked;
    body.hours = DAYS.map((_, i) => f['h' + i].value);
    run(async () => {
      const r = await api('/admin/settings', body);
      state.settings = r.settings; flash('Nastavení uloženo.'); render(); scrollTo(0, 0);
    }, e.submitter);
  };
}

/* ---------- start ---------- */

reload().then(render).catch(e => (e.status === 401 ? showLogin() : showLogin(e.message)));
