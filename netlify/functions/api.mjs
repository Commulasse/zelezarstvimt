import { getStore } from '@netlify/blobs';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { DEFAULTS, DAYS } from '../../public/assets/defaults.js';

export const config = { path: '/api/*' };

const store = () => getStore({ name: 'zelezarstvi', consistency: 'strong' });
const images = () => getStore({ name: 'zelezarstvi-img', consistency: 'strong' });

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (msg, status = 400) => json({ error: msg }, status);

async function loadProducts() {
  return (await store().get('products', { type: 'json' })) ?? [];
}
async function loadSettings() {
  const s = (await store().get('settings', { type: 'json' })) ?? {};
  return { ...DEFAULTS, ...s };
}

/* ---------- přihlášení: podepsaná cookie ---------- */

const SESSION_DAYS = 30;

function secret() {
  const pw = process.env.ADMIN_PASSWORD;
  return pw ? 'zmt:' + pw : null; // změna hesla = odhlášení všech
}
function sign(exp) {
  return createHmac('sha256', secret()).update(String(exp)).digest('hex');
}
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}
function isAdmin(req) {
  if (!secret()) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)zmt=(\d+)\.([a-f0-9]{64})/);
  if (!m) return false;
  return Number(m[1]) > Date.now() && safeEq(m[2], sign(m[1]));
}
function cookie(value, maxAge) {
  return `zmt=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

/* ---------- validace ---------- */

function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s ]|Kč/gi, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error('Cena musí být číslo.');
  return Math.round(n * 100) / 100;
}
const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const str = (v, max) => String(v ?? '').trim().slice(0, max);

async function saveImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Neplatný obrázek.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw new Error('Obrázek je příliš velký.');
  const key = Date.now().toString(36) + randomBytes(5).toString('hex');
  await images().set(key, buf, { metadata: { type: 'image/' + m[1] } });
  return key;
}
async function deleteImage(key) {
  if (key) await images().delete(key).catch(() => {});
}

/* ---------- router ---------- */

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = req.method;

  try {
    // veřejná data pro web
    if (path === '/data' && method === 'GET') {
      const [settings, products] = await Promise.all([loadSettings(), loadProducts()]);
      return json({ settings, products: products.filter(p => p.visible) });
    }

    // obrázky zboží
    if (path.startsWith('/img/') && method === 'GET') {
      const key = path.slice(5);
      if (!/^[a-z0-9]+$/.test(key)) return new Response('Not found', { status: 404 });
      const r = await images().getWithMetadata(key, { type: 'arrayBuffer' });
      if (!r) return new Response('Not found', { status: 404 });
      return new Response(r.data, {
        headers: { 'content-type': r.metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
      });
    }

    if (path === '/login' && method === 'POST') {
      if (!secret()) return fail('Heslo není nastavené. V Netlify nastavte proměnnou ADMIN_PASSWORD.', 500);
      await new Promise(r => setTimeout(r, 400));
      const { password } = await req.json().catch(() => ({}));
      if (!safeEq(password || '', process.env.ADMIN_PASSWORD)) return fail('Špatné heslo.', 401);
      const exp = Date.now() + SESSION_DAYS * 864e5;
      return json({ ok: true }, 200, { 'set-cookie': cookie(`${exp}.${sign(exp)}`, SESSION_DAYS * 86400) });
    }

    if (path === '/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    }

    /* ---- vše níže jen pro přihlášené ---- */
    if (!path.startsWith('/admin')) return fail('Nenalezeno.', 404);
    if (!isAdmin(req)) return fail('Nejste přihlášen.', 401);

    if (path === '/admin/data' && method === 'GET') {
      const [settings, products] = await Promise.all([loadSettings(), loadProducts()]);
      return json({ settings, products });
    }

    if (method !== 'POST') return fail('Nepodporovaná metoda.', 405);
    if (!(req.headers.get('content-type') || '').includes('application/json')) return fail('Neplatný požadavek.');
    const body = await req.json();
    let products = await loadProducts();
    const idx = products.findIndex(p => p.id === body.id);

    switch (path) {
      case '/admin/save': {
        const now = new Date().toISOString();
        const isNew = idx < 0;
        const p = isNew ? { id: randomBytes(5).toString('hex'), created: now, image: '' } : { ...products[idx] };
        p.name = str(body.name, 140);
        p.category = str(body.category, 80);
        p.description = str(body.description, 2000);
        p.unit = str(body.unit, 20);
        p.price = num(body.price);
        p.visible = !!body.visible;
        p.updated = now;
        if (!p.name) return fail('Vyplňte název zboží.');
        if (body.is_sale) {
          p.sale_price = num(body.sale_price);
          p.sale_from = date(body.sale_from);
          p.sale_to = date(body.sale_to);
          if (p.sale_price === null) return fail('U akčního zboží vyplňte akční cenu.');
        } else {
          p.sale_price = null; p.sale_from = ''; p.sale_to = '';
        }
        if (body.remove_image && p.image) { await deleteImage(p.image); p.image = ''; }
        if (body.image) {
          const key = await saveImage(body.image);
          await deleteImage(p.image);
          p.image = key;
        }
        if (isNew) products.push(p); else products[idx] = p;
        await store().setJSON('products', products);
        return json({ ok: true, product: p });
      }

      case '/admin/toggle':
        if (idx < 0) return fail('Zboží nenalezeno.', 404);
        products[idx].visible = !products[idx].visible;
        await store().setJSON('products', products);
        return json({ ok: true });

      case '/admin/endsale':
        if (idx < 0) return fail('Zboží nenalezeno.', 404);
        Object.assign(products[idx], { sale_price: null, sale_from: '', sale_to: '' });
        await store().setJSON('products', products);
        return json({ ok: true });

      case '/admin/delete':
        if (idx < 0) return fail('Zboží nenalezeno.', 404);
        await deleteImage(products[idx].image);
        products.splice(idx, 1);
        await store().setJSON('products', products);
        return json({ ok: true });

      case '/admin/cleanup': {
        const today = String(body.today || '');
        let n = 0;
        products = products.map(p => {
          if (p.sale_price !== null && p.sale_to && p.sale_to < today) { n++; return { ...p, sale_price: null, sale_from: '', sale_to: '' }; }
          return p;
        });
        await store().setJSON('products', products);
        return json({ ok: true, count: n });
      }

      case '/admin/settings': {
        const s = await loadSettings();
        for (const k of ['firm_name', 'owner', 'ico', 'street', 'city', 'phone', 'phone2', 'email', 'since', 'tagline', 'notice', 'lat', 'lng']) {
          if (k in body) s[k] = str(body[k], 400);
        }
        s.notice_on = !!body.notice_on;
        s.hours = {};
        DAYS.forEach((d, i) => { s.hours[d] = str(body.hours?.[i], 80); });
        const cats = [...new Set(String(body.categories || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean))];
        if (!cats.length) return fail('Musí zůstat aspoň jedna kategorie.');
        s.categories = cats;
        await store().setJSON('settings', s);
        return json({ ok: true, settings: s });
      }
    }
    return fail('Nenalezeno.', 404);
  } catch (e) {
    console.error(e);
    return fail(e.message || 'Chyba serveru.', 500);
  }
};
