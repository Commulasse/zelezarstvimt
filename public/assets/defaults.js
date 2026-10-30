// Výchozí údaje – používá web i serverová funkce.
export const DAYS = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'];

export const DEFAULTS = {
  firm_name: 'Železářství MT',
  owner: 'Norbert Budig',
  ico: '18882528',
  street: 'Lanškrounská 260/47',
  city: '571 01 Moravská Třebová',
  phone: '+420 461 311 790',
  phone2: '+420 461 312 944',
  email: 'zelezarstvi.mt@tiscali.cz',
  since: '1991',
  lat: '49.761389',
  lng: '16.664604',
  tagline: 'Nářadí, spojovací materiál, kování, zahrada i domácnost. Co nemáme skladem, rádi objednáme.',
  notice_on: false,
  notice: '',
  hours: {
    'Pondělí': '8:00–12:00, 13:00–16:00',
    'Úterý': '8:00–12:00, 13:00–16:00',
    'Středa': '8:00–12:00, 13:00–16:00',
    'Čtvrtek': '8:00–12:00, 13:00–16:00',
    'Pátek': '8:00–12:00, 13:00–16:00',
    'Sobota': '8:00–11:30',
    'Neděle': 'Zavřeno',
  },
  categories: [
    'Ruční nářadí', 'Elektrické nářadí', 'Spojovací materiál', 'Kování a zámky', 'Stavební chemie',
    'Zahrada', 'Domácí potřeby', 'Kamna, kotle a kouřovody', 'Elektromateriál', 'Instalatérský materiál',
  ],
};

/* ---------- společné pomocné funkce ---------- */

// dnešní datum a čas v Praze (nezávisle na časovém pásmu zařízení)
export function pragueNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, dayIndex: wd };
}

export function onSale(p, today = pragueNow().date) {
  if (p.sale_price === null || p.sale_price === undefined || p.sale_price === '') return false;
  if (p.sale_from && p.sale_from > today) return false;
  if (p.sale_to && p.sale_to < today) return false;
  return true;
}

export function priceFmt(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return n.toLocaleString('cs-CZ', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }) + ' Kč';
}

export function dateCz(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd}. ${m}. ${y}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
