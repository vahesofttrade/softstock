// Netlify Function — уведомления SoftStock на почту (через сервис Resend).
//
// Режимы (POST JSON {mode}):
//   alerts  — проверить High/Medium позиции и отправить НОВЫЕ предупреждения
//   summary — отправить утреннюю сводку сейчас
//   test    — короткое тестовое письмо
//   preview — ничего не отправлять, вернуть HTML сводки и предупреждений
//   auto    — то, что делает расписание: alerts каждый час + summary в SUMMARY_HOUR
//
// Кто может вызывать: администратор SoftStock (по его токену входа) или
// функция-расписание email-cron (по внутреннему секрету).
//
// Переменные окружения Netlify (Site configuration → Environment variables):
//   RESEND_API_KEY            — ключ из resend.com → API Keys (секрет!)
//   SUPABASE_SERVICE_ROLE_KEY — Supabase → Project Settings → API Keys: secret key (sb_secret_…) или legacy service_role (секрет!)
//   EMAIL_FROM                — необязательно; по умолчанию "SoftStock <onboarding@resend.dev>"
//   SUPABASE_URL              — необязательно, по умолчанию адрес проекта ниже
//   SUMMARY_HOUR              — необязательно, час сводки по Еревану, по умолчанию 9
//   SMTP_USER / SMTP_PASS     — необязательно: отправка через Gmail (адрес + пароль приложения) на любые адреса
// Адреса получателей задаются на странице «Сервис» (app_settings.alert_email).

const crypto = require('crypto');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://mgozbodeacbsgxxrlopi.supabase.co').replace(/\/$/, '');
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const EMAIL_FROM   = process.env.EMAIL_FROM || 'SoftStock <onboarding@resend.dev>';
const SUMMARY_HOUR = parseInt(process.env.SUMMARY_HOUR || '9', 10);
const TZ           = 'Asia/Yerevan';
const SITE_URL     = process.env.URL || 'https://sensational-gingersnap-05c5cd.netlify.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (code, obj) => ({ statusCode: code, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const cronSecret = () => crypto.createHash('sha256').update('softstock-cron:' + SERVICE_KEY).digest('hex');

// ── Supabase REST (service role — обходит RLS, поэтому только на сервере) ──
async function sb(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      ...(SERVICE_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SERVICE_KEY } : {}),
      'Content-Type': 'application/json', Prefer: 'return=minimal',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

// кто вызывает: { id, role, name } по токену входа SoftStock, иначе null
async function userFromToken(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  const rows = await sb('profiles?select=role,full_name&id=eq.' + encodeURIComponent(user.id));
  return rows && rows[0] ? { id: user.id, role: rows[0].role, name: rows[0].full_name || user.email || '' } : null;
}
async function isAdminToken(authHeader) {
  const u = await userFromToken(authHeader);
  return !!(u && u.role === 'admin');
}

// ── почта ──
function recipients(settings) {
  return String(settings.alert_email || process.env.ALERT_EMAIL_TO || '')
    .split(/[,;\s]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}
// Отправка: если заданы SMTP_USER и SMTP_PASS — через почтовый ящик (Gmail: пароль приложения),
// письма уходят на ЛЮБЫЕ адреса. Иначе — через Resend (без своего домена только на адрес владельца Resend).
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
async function sendMail(to, subject, html) {
  if (!to.length) throw new Error('не указан адрес получателя (страница «Сервис»)');
  if (SMTP_USER && SMTP_PASS) {
    let nodemailer;
    try { nodemailer = require('nodemailer'); } catch (e) { throw new Error('для отправки через Gmail нужен файл package.json в корне репозитория (с nodemailer) и передеплой'); }
    const tr = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    try {
      const info = await tr.sendMail({ from: '"SoftStock" <' + SMTP_USER + '>', to: to.join(', '), subject, html });
      return info.messageId;
    } catch (e) { throw new Error('Почта (SMTP): ' + (e.response || e.message)); }
  }
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY не задан в Netlify');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Resend: ' + (j.message || j.error || ('HTTP ' + res.status)));
  return j.id;
}

// ── форматирование ──
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kg = n => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
const label = p => esc(p.name) + ' · ' + (p.width_cm ?? '—') + 'cm·' + p.ply + 'ply·' + (p.gsm ?? '—') + 'gsm';
const prioBadge = p => p.priority === 'high'
  ? '<span style="color:#B42318;font-weight:700">● High</span>'
  : '<span style="color:#B26B00;font-weight:700">● Medium</span>';
const localDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);          // YYYY-MM-DD
const localHour = (d = new Date()) => parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d), 10) % 24;
const ruDate = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';

const TD = 'padding:7px 10px;border-bottom:1px solid #E4E7E3;font-size:13px;vertical-align:top';
const TH = 'padding:7px 10px;border-bottom:2px solid #D5DAD4;font-size:11px;color:#5B6660;text-align:left;text-transform:uppercase;letter-spacing:.03em';
const pendCell = p => Number(p.pending_kg) > 0
  ? kg(p.pending_kg) + ' кг' + (p.next_eta ? '<br><span style="color:#8A938E">≈ ' + ruDate(p.next_eta) + '</span>' : '')
  : '<span style="color:#B42318">нет</span>';

function tableOut(rows) {
  return '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:6px 0 18px">'
    + '<tr><th style="' + TH + '">Товар</th><th style="' + TH + '">Приоритет</th><th style="' + TH + '">В пути</th></tr>'
    + rows.map(p => '<tr><td style="' + TD + '">' + label(p) + '<br><span style="color:#8A938E">' + esc(p.type) + '</span></td><td style="' + TD + '">' + prioBadge(p) + '</td><td style="' + TD + '">' + pendCell(p) + '</td></tr>').join('')
    + '</table>';
}
function tableLow(rows) {
  return '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:6px 0 18px">'
    + '<tr><th style="' + TH + '">Товар</th><th style="' + TH + '">Остаток</th><th style="' + TH + '">Хватит на</th><th style="' + TH + '">Расход/день</th><th style="' + TH + '">В пути</th></tr>'
    + rows.map(p => '<tr><td style="' + TD + '">' + label(p) + '<br>' + prioBadge(p) + ' <span style="color:#8A938E">' + esc(p.type) + '</span></td>'
      + '<td style="' + TD + ';white-space:nowrap">' + kg(p.balance) + ' кг</td>'
      + '<td style="' + TD + ';white-space:nowrap;font-weight:700;color:' + (p.days <= 7 ? '#B42318' : '#B26B00') + '">~' + p.days + ' дн.</td>'
      + '<td style="' + TD + ';white-space:nowrap">' + kg(p.rate) + ' кг</td>'
      + '<td style="' + TD + ';white-space:nowrap">' + pendCell(p) + '</td></tr>').join('')
    + '</table>';
}
function wrap(title, body) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1C2321;max-width:680px;margin:0 auto">'
    + '<div style="font-size:20px;font-weight:700;margin:0 0 4px">Soft<span style="color:#0F6E56">Stock</span></div>'
    + '<div style="font-size:15px;font-weight:700;margin:0 0 16px">' + title + '</div>'
    + body
    + '<p style="margin:20px 0 0"><a href="' + SITE_URL + '" style="background:#0F6E56;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:700">Открыть SoftStock</a></p>'
    + '<p style="font-size:11px;color:#8A938E;margin:18px 0 0">Пороги и получателей можно изменить в SoftStock → Сервис.</p>'
    + '</div>';
}
const h3 = t => '<div style="font-size:14px;font-weight:700;margin:4px 0 2px">' + t + '</div>';

async function loadState() {
  const [status, settingsRows] = await Promise.all([
    sb('rpc/softstock_status', { method: 'POST', body: '{}', headers: { Prefer: '' } }),
    sb('app_settings?select=key,value')
  ]);
  const st = {};
  (settingsRows || []).forEach(r => { st[r.key] = r.value; });
  const thr = { high: Number(st.alert_days_high || 14), medium: Number(st.alert_days_medium || 7) };
  const rows = (status || []).map(p => {
    const balance = Number(p.balance) || 0;
    // как в Forecast: взвешенный расход; если расхода в этом году не было — ручная норма
    const rate = Number(p.daily_rate) > 0 ? Number(p.daily_rate) : (Number(p.manual_daily) || 0);
    const days = rate > 0 ? Math.floor(Math.max(balance, 0) / rate) : null;
    let level = null;
    if (p.priority === 'high' || p.priority === 'medium') {
      if (balance <= 0) level = 'out';
      else if (days != null && days <= thr[p.priority]) level = 'low';
    }
    return { ...p, balance, rate, days, level };
  });
  return { rows, thr, settings: st };
}
const byPrio = (a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1);

// ── предупреждения: только новое или ухудшение (мало → закончился) ──
async function runAlerts(send = true) {
  const { rows, thr, settings } = await loadState();
  const prevRows = await sb('alert_state?select=product_id,level');
  const prev = {}; (prevRows || []).forEach(r => { prev[r.product_id] = r.level; });

  const newOut = [], newLow = [], upserts = [], clears = [];
  rows.forEach(p => {
    const was = prev[p.id];
    if (!p.level) { if (was) clears.push(p.id); return; }
    if (p.level === 'out' && was !== 'out') newOut.push(p);
    else if (p.level === 'low' && !was) newLow.push(p);
    if (was !== p.level) upserts.push({ product_id: p.id, level: p.level, sent_at: new Date().toISOString() });
  });
  newOut.sort(byPrio); newLow.sort((a, b) => a.days - b.days);

  let html = '', subject = '';
  if (newOut.length || newLow.length) {
    const parts = [];
    if (newOut.length) parts.push('закончились ' + newOut.length);
    if (newLow.length) parts.push('заканчиваются ' + newLow.length);
    subject = '⚠️ SoftStock: ' + parts.join(', ');
    let body = '';
    if (newOut.length) body += h3('Закончились') + tableOut(newOut);
    if (newLow.length) body += h3('Заканчиваются') + '<div style="font-size:12px;color:#5B6660">High — запаса ≤ ' + thr.high + ' дн., Medium — ≤ ' + thr.medium + ' дн.</div>' + tableLow(newLow);
    html = wrap('Внимание: остатки', body);
  }

  if (send) {
    if (html) await sendMail(recipients(settings), subject, html);
    // запоминаем только после успешной отправки, чтобы не потерять предупреждение
    if (upserts.length) await sb('alert_state?on_conflict=product_id', { method: 'POST', body: JSON.stringify(upserts), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    if (clears.length) await sb('alert_state?product_id=in.(' + clears.join(',') + ')', { method: 'DELETE' });
  }
  return { html, subject, newOut: newOut.length, newLow: newLow.length };
}

// ── утренняя сводка ──
async function buildSummary() {
  const { rows, thr, settings } = await loadState();
  const today = localDate();
  const yesterday = localDate(new Date(Date.now() - 86400000));
  const [ylog, pend, res] = await Promise.all([
    sb('stock_log?select=operation,quantity&date=eq.' + yesterday),
    sb('deliveries?select=quantity,expected_date&status=eq.pending'),
    sb('reservations?select=quantity&status=eq.reserved')
  ]);
  const yin  = (ylog || []).filter(r => r.operation === 'add').reduce((s, r) => s + Number(r.quantity), 0);
  const yout = (ylog || []).filter(r => r.operation === 'deduct').reduce((s, r) => s + Number(r.quantity), 0);
  const total = rows.reduce((s, p) => s + Math.max(p.balance, 0), 0);
  const pendKg = (pend || []).reduce((s, d) => s + Number(d.quantity), 0);
  const overdue = (pend || []).filter(d => d.expected_date && d.expected_date < today).length;
  const resKg = (res || []).reduce((s, r) => s + Number(r.quantity), 0);
  const out = rows.filter(p => p.level === 'out').sort(byPrio);
  const low = rows.filter(p => p.level === 'low').sort((a, b) => a.days - b.days);

  const tile = (l, v, sub) => '<td style="padding:10px 12px;background:#F0F2EF;border-radius:6px;width:25%;vertical-align:top">'
    + '<div style="font-size:10px;color:#5B6660;text-transform:uppercase;letter-spacing:.04em">' + l + '</div>'
    + '<div style="font-size:16px;font-weight:700;margin-top:3px">' + v + '</div>'
    + (sub ? '<div style="font-size:11px;color:#8A938E;margin-top:2px">' + sub + '</div>' : '') + '</td>';
  let body = '<table cellspacing="6" cellpadding="0" style="width:100%;margin:0 -6px 14px"><tr>'
    + tile('На складе', kg(total) + ' кг', (total / 1000).toFixed(1).replace('.', ',') + ' т')
    + tile('Вчера', '+' + kg(yin) + ' / −' + kg(yout), 'приход / расход, кг')
    + tile('Позиций в пути', String((pend || []).length), kg(pendKg) + ' кг' + (overdue ? ' · <b style="color:#B42318">просрочено ' + overdue + '</b>' : ''))
    + tile('Резервы', String((res || []).length), kg(resKg) + ' кг')
    + '</tr></table>';
  if (out.length) body += h3('Закончились (' + out.length + ')') + tableOut(out);
  if (low.length) body += h3('Заканчиваются (' + low.length + ')') + '<div style="font-size:12px;color:#5B6660">High — запаса ≤ ' + thr.high + ' дн., Medium — ≤ ' + thr.medium + ' дн.</div>' + tableLow(low);
  if (!out.length && !low.length) body += '<p style="font-size:14px;color:#0F6E56;font-weight:700">✓ По позициям High и Medium всё в порядке.</p>';

  // поставки и контейнеры — в том же письме
  let lg = null;
  try { lg = await logisticsSections(); } catch (e) { lg = null; }
  if (lg) body += '<div style="border-top:2px solid #E4E7E3;margin:22px 0 14px"></div>'
    + '<div style="font-size:15px;font-weight:700;margin:0 0 10px">Поставки и контейнеры</div>' + lg.tiles + lg.body;
  const subject = '📦 SoftStock — сводка на ' + ruDate(today) + (out.length || low.length ? ' · остатки: внимание ' + (out.length + low.length) : '')
    + (lg ? ' · в пути ' + lg.trucks + ' маш.' + (lg.shipments != null ? ' · ' + lg.shipments + ' отпр.' : '') + (lg.late ? ' · просрочено ' + lg.late : '') : '');
  return { subject, html: wrap('Сводка на ' + ruDate(today), body), to: recipients(settings) };
}

// ── утреннее письмо «Поставки и контейнеры» ──
function logisticsRecipients(settings) {
  const raw = settings.logistics_email != null ? settings.logistics_email : 'ceo.softtrade@gmail.com';
  return String(raw).split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}
async function buildLogistics() {
  const { settings } = await loadState();
  const sec = await logisticsSections();
  return { subject: sec.subject, html: wrap('Поставки и контейнеры на ' + ruDate(localDate()), sec.tiles + sec.body), to: logisticsRecipients(settings) };
}
// блоки «машины в пути» и «контейнеры» — используются в общей утренней сводке
async function logisticsSections() {
  const today = localDate(), yesterday = localDate(new Date(Date.now() - 86400000));
  const daysTo = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  const whenCell = iso => { if (!iso) return '<span style="color:#8A938E">без даты</span>'; const d = daysTo(iso);
    return d < 0 ? '<b style="color:#B42318">' + ruDate(iso) + '</b><br><span style="color:#B42318;font-size:11px">просрочено ' + (-d) + ' дн.</span>'
      : d === 0 ? '<b style="color:#B26B00">' + ruDate(iso) + '</b><br><span style="color:#B26B00;font-size:11px">сегодня</span>'
      : ruDate(iso) + '<br><span style="color:#8A938E;font-size:11px">через ' + d + ' дн.</span>'; };
  const [pend, arrived] = await Promise.all([
    sb('deliveries?select=id,quantity,plate_no,expected_date,products(type),suppliers(name)&status=eq.pending'),
    sb('deliveries?select=id,quantity,plate_no,products(type),suppliers(name)&status=eq.arrived&arrived_at=gte.' + yesterday + 'T00:00:00')
  ]);
  // машины в пути
  const trucks = {};
  (pend || []).forEach(d => { const k = (d.plate_no || '— без номера —') + '|' + (d.expected_date || '');
    const t = (trucks[k] = trucks[k] || { plate: d.plate_no || '— без номера —', date: d.expected_date, sup: new Set(), kg: 0, n: 0, types: {} });
    t.sup.add(d.suppliers?.name || '—'); t.kg += Number(d.quantity || 0); t.n++; const ty = d.products?.type || '—'; t.types[ty] = (t.types[ty] || 0) + Number(d.quantity || 0); });
  const tl = Object.values(trucks).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const pendKg = tl.reduce((a, t) => a + t.kg, 0), lateT = tl.filter(t => t.date && t.date < today).length;
  const arrKg = (arrived || []).reduce((a, d) => a + Number(d.quantity || 0), 0);
  const arrTrucks = new Set((arrived || []).map(d => d.plate_no || '?')).size;
  // контейнеры
  let shipments = [], items = [], events = [], shipErr = '';
  try {
    [shipments, items, events] = await Promise.all([
      sb('shipments?select=*&status=in.(ordered,production,shipped,port,customs)'),
      sb('shipment_items?select=shipment_id,name,qty,unit&order=id'),
      sb('shipment_events?select=shipment_id,at,status,note,user_name,created_at&created_at=gte.' + yesterday + 'T00:00:00&order=created_at')
    ]);
  } catch (e) { shipErr = /shipments/.test(e.message) ? 'раздел «Контейнеры» ещё не включён' : e.message; }
  const tgt = r => r.eta_final || r.eta || null;
  const sl = (shipments || []).sort((a, b) => (tgt(a) || '9999').localeCompare(tgt(b) || '9999'));
  const lateS = sl.filter(r => tgt(r) && tgt(r) < today).length;
  const SHN = { ordered:'Заказано', production:'Производство', shipped:'В пути', port:'В порту', customs:'Таможня', delivered:'Доставлено', cancelled:'Отменено' };
  const KND = { container:'Контейнер', truck:'Фура', air:'Авиа', rail:'Ж/д', other:'Отправка' };

  const tile = (l, v, sub, col) => '<td style="padding:10px 12px;background:#F0F2EF;border-radius:6px;width:25%;vertical-align:top"><div style="font-size:10px;color:#5B6660;text-transform:uppercase;letter-spacing:.04em">' + l + '</div><div style="font-size:18px;font-weight:700;margin-top:3px;color:' + (col || '#1C2321') + '">' + v + '</div>' + (sub ? '<div style="font-size:11px;color:#8A938E;margin-top:2px">' + sub + '</div>' : '') + '</td>';
  const tiles = '<table cellspacing="6" cellpadding="0" style="width:100%;margin:0 -6px 14px"><tr>'
    + tile('Машин в пути', String(tl.length), kg(pendKg) + ' кг') + tile('Просрочено машин', String(lateT), 'плановая дата прошла', lateT ? '#B42318' : '')
    + tile('Получено вчера–сегодня', String(arrTrucks), kg(arrKg) + ' кг') + tile('Контейнеры активные', shipErr ? '—' : String(sl.length), lateS ? '<b style="color:#B42318">просрочено ' + lateS + '</b>' : '')
    + '</tr></table>';

  let body = h3('🚚 Машины в пути (' + tl.length + ')');
  body += tl.length ? '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:6px 0 18px"><tr><th style="' + TH + '">Машина</th><th style="' + TH + '">Поставщик</th><th style="' + TH + '">Ожидается</th><th style="' + TH + '">Что везёт</th><th style="' + TH + ';text-align:right">Кг</th></tr>'
    + tl.map(t => '<tr><td style="' + TD + ';font-weight:700">' + esc(t.plate) + '</td><td style="' + TD + '">' + esc([...t.sup].join(', ')) + '</td><td style="' + TD + ';white-space:nowrap">' + whenCell(t.date) + '</td><td style="' + TD + ';font-size:12px;color:#5B6660">'
      + Object.entries(t.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => esc(k) + ' ' + kg(v)).join('<br>') + '</td><td style="' + TD + ';text-align:right;font-weight:700;white-space:nowrap">' + kg(t.kg) + '</td></tr>').join('')
    + '</table>' : '<p style="font-size:13px;color:#5B6660">Машин в пути нет.</p>';

  body += h3('🚢 Контейнеры и отправки (' + (shipErr ? '—' : sl.length) + ')');
  if (shipErr) body += '<p style="font-size:13px;color:#5B6660">' + esc(shipErr) + '</p>';
  else if (!sl.length) body += '<p style="font-size:13px;color:#5B6660">Активных отправок нет.</p>';
  else body += '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:6px 0 18px"><tr><th style="' + TH + '">Номер</th><th style="' + TH + '">Что везём</th><th style="' + TH + '">Статус</th><th style="' + TH + '">Прибытие</th></tr>'
    + sl.map(r => { const its = (items || []).filter(i => i.shipment_id === r.id);
      return '<tr><td style="' + TD + '"><b>' + esc(r.ref_no || '—') + '</b><br><span style="font-size:11px;color:#8A938E">' + esc(KND[r.kind] || '') + ' ' + esc(r.container_type || '') + '</span></td>'
        + '<td style="' + TD + '">' + esc(r.title || '') + '<br><span style="font-size:11px;color:#5B6660">' + esc((r.sender || '') + (r.origin || r.destination ? ' · ' + (r.origin || '?') + ' → ' + (r.destination || '?') : '')) + '</span>'
        + (its.length ? '<br><span style="font-size:11px;color:#8A938E">' + its.slice(0, 4).map(i => esc(i.name) + (i.qty != null ? ' ' + kg(i.qty) + ' ' + esc(i.unit || '') : '')).join('; ') + (its.length > 4 ? ' …' : '') + '</span>' : '') + '</td>'
        + '<td style="' + TD + ';white-space:nowrap"><b>' + esc(SHN[r.status] || r.status) + '</b></td><td style="' + TD + ';white-space:nowrap">' + whenCell(tgt(r)) + (r.eta && r.eta_final && r.eta !== r.eta_final ? '<br><span style="font-size:11px;color:#8A938E">порт ' + ruDate(r.eta) + '</span>' : '') + '</td></tr>'; }).join('')
    + '</table>';

  const evs = (events || []).filter(e => e.status || e.note);
  if (evs.length) {
    const byId = {}; (shipments || []).forEach(r => { byId[r.id] = r; });
    body += h3('Изменения за сутки') + '<ul style="margin:4px 0 14px 18px;padding:0;font-size:13px">' + evs.map(e => '<li>' + esc(byId[e.shipment_id]?.ref_no || ('#' + e.shipment_id)) + ': '
      + (e.status ? '<b>' + esc(SHN[e.status] || e.status) + '</b> ' : '') + esc(e.note || '') + ' <span style="color:#8A938E">· ' + ruDate(e.at) + (e.user_name ? ' · ' + esc(e.user_name) : '') + '</span></li>').join('') + '</ul>';
  }
  const subject = '🚚 Поставки и контейнеры — ' + ruDate(today) + ' · в пути ' + tl.length + ' маш.' + (shipErr ? '' : ' · ' + sl.length + ' отпр.') + (lateT + lateS ? ' · просрочено ' + (lateT + lateS) : '');
  return { subject, tiles, body, trucks: tl.length, shipments: shipErr ? null : sl.length, late: lateT + lateS };
}

// ── уведомление о смене статуса: контейнер (shipments) или фура (deliveries) ──
const SH_ST = { ordered:'Заказано', production:'Производство', shipped:'В пути', port:'В порту', customs:'Таможня', delivered:'Доставлено', cancelled:'Отменено' };
const SH_CAT = { finished:'Готовая продукция', equipment:'Оборудование / станки', parts:'Запчасти', other:'Прочее' };
const SH_KIND = { container:'Контейнер', truck:'Фура', air:'Авиа', rail:'Ж/д', other:'Отправка' };
const row2 = (l, v) => v ? '<tr><td style="' + TD + ';color:#5B6660;width:38%">' + l + '</td><td style="' + TD + ';font-weight:600">' + v + '</td></tr>' : '';

async function buildShipmentStatus(eventId, actor) {
  const ev = (await sb('shipment_events?select=*&id=eq.' + Number(eventId)))[0];
  if (!ev) throw new Error('событие не найдено');
  const sh = (await sb('shipments?select=*&id=eq.' + Number(ev.shipment_id)))[0];
  if (!sh) throw new Error('отправка не найдена');
  const items = await sb('shipment_items?select=name,qty,unit&shipment_id=eq.' + sh.id + '&order=id');
  const st = SH_ST[ev.status] || SH_ST[sh.status] || ev.status;
  const name = (sh.ref_no || sh.title || ('#' + sh.id));
  const subject = (sh.kind === 'container' ? '🚢 ' : sh.kind === 'truck' ? '🚛 ' : '📦 ') + name + ': ' + st;
  let body = '<p style="font-size:15px;margin:0 0 12px">' + esc(SH_KIND[sh.kind] || 'Отправка') + ' <b>' + esc(name) + '</b> — новый статус: '
    + '<span style="background:#E7F3EE;color:#0F6E56;font-weight:700;padding:2px 10px;border-radius:99px">' + esc(st) + '</span></p>';
  if (ev.note) body += '<p style="font-size:14px;margin:0 0 12px;padding:8px 12px;background:#FFFBEB;border:1px solid #fcd34d;border-radius:6px">' + esc(ev.note) + '</p>';
  body += '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:0 0 14px">'
    + row2('Что везём', esc((SH_CAT[sh.category] || '') + (sh.title ? ' · ' + sh.title : '')))
    + row2('Отправитель', esc(sh.sender)) + row2('Маршрут', esc((sh.origin || '?') + ' → ' + (sh.destination || '?')))
    + row2('Перевозчик / судно', esc([sh.carrier, sh.vessel].filter(Boolean).join(' · ')))
    + row2('Прибытие в порт (ETA)', sh.eta ? ruDate(sh.eta) : '') + row2('Доставка на склад', sh.eta_final ? ruDate(sh.eta_final) : '')
    + row2('Дата события', ruDate(ev.at)) + row2('Изменил', esc(ev.user_name || actor || ''))
    + '</table>';
  if (items && items.length) body += h3('Состав') + '<ul style="margin:4px 0 0 18px;padding:0;font-size:13px">'
    + items.map(i => '<li>' + esc(i.name) + (i.qty != null ? ' — ' + kg(i.qty) + ' ' + esc(i.unit || '') : '') + '</li>').join('') + '</ul>';
  return { subject, html: wrap('Статус отправки изменён', body) };
}

async function buildDeliveryStatus(ids, actor) {
  ids = (ids || []).map(Number).filter(Boolean).slice(0, 200);
  if (!ids.length) throw new Error('нет поставок');
  const rows = await sb('deliveries?select=*,products(name,type,width_cm,ply,gsm),suppliers(name)&id=in.(' + ids.join(',') + ')');
  if (!rows || !rows.length) throw new Error('поставки не найдены');
  // по машинам
  const trucks = {};
  rows.forEach(d => { const k = (d.plate_no || '— без номера —') + '|' + (d.expected_date || ''); (trucks[k] = trucks[k] || []).push(d); });
  const keys = Object.keys(trucks);
  const total = rows.reduce((a, d) => a + Number(d.quantity || 0), 0);
  const subject = '🚛 Получено: ' + (keys.length === 1 ? (rows[0].plate_no || 'машина') : keys.length + ' машин(ы)') + ' · ' + kg(total) + ' кг';
  let body = '';
  for (const k of keys) {
    const list = trucks[k], d0 = list[0];
    // сколько ещё в пути в этой машине
    const same = await sb('deliveries?select=id,status&plate_no=eq.' + encodeURIComponent(d0.plate_no || '') + (d0.expected_date ? '&expected_date=eq.' + d0.expected_date : '&expected_date=is.null'));
    const left = (same || []).filter(x => x.status === 'pending').length;
    body += h3('Машина ' + esc(d0.plate_no || '—') + ' · ' + esc(d0.suppliers?.name || '—'))
      + '<div style="font-size:12px;color:#5B6660;margin-bottom:4px">ожидалась ' + (d0.expected_date ? ruDate(d0.expected_date) : '—') + (left ? ' · <b style="color:#B26B00">в пути ещё ' + left + ' поз.</b>' : ' · <b style="color:#0F6E56">машина получена полностью</b>') + '</div>'
      + '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;margin:4px 0 16px"><tr><th style="' + TH + '">Вид</th><th style="' + TH + '">Товар</th><th style="' + TH + '">Кг</th></tr>'
      + list.map(d => { const p = d.products || {}; return '<tr><td style="' + TD + '">' + esc(p.type || '') + '</td><td style="' + TD + '">' + esc((p.name || '') + ' · ' + (p.width_cm ?? '—') + 'cm·' + (p.ply ?? '—') + 'ply·' + (p.gsm ?? '—') + 'gsm') + '</td><td style="' + TD + ';font-weight:700;white-space:nowrap">' + kg(d.quantity) + '</td></tr>'; }).join('')
      + '</table>';
  }
  body += '<div style="font-size:12px;color:#5B6660">Отметил: ' + esc(actor || '') + ' · всего ' + kg(total) + ' кг добавлено на склад</div>';
  return { subject, html: wrap('Поставка получена', body) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { success: false, error: 'Method not allowed' });
  if (!SERVICE_KEY) return reply(500, { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY не задан в Netlify (Environment variables).' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const mode = body.mode || 'preview';

  const h = event.headers || {};
  const fromCron = (h['x-cron-secret'] || h['X-Cron-Secret']) === cronSecret();
  try {
    if (mode === 'status') {
      // уведомление о смене статуса может отправить любой, кто может менять данные (admin / user)
      const u = await userFromToken(h.authorization || h.Authorization);
      if (!u || !['admin', 'user'].includes(u.role)) return reply(403, { success: false, error: 'Нет прав.' });
      const { settings } = await loadState();
      if (settings.status_notify_enabled === 'false') return reply(200, { success: true, sent: 'disabled' });
      if (settings.status_notify_self === 'false' && u.role === 'admin') return reply(200, { success: true, sent: 'self-skipped' });
      const m = body.kind === 'shipment' ? await buildShipmentStatus(body.event_id, u.name) : await buildDeliveryStatus(body.ids, u.name);
      await sendMail(recipients(settings), m.subject, m.html);
      return reply(200, { success: true, sent: 'status' });
    }
    if (!fromCron && !(await isAdminToken(h.authorization || h.Authorization))) {
      return reply(403, { success: false, error: 'Только для администратора.' });
    }

    if (mode === 'test') {
      const { settings } = await loadState();
      const to = recipients(settings);
      await sendMail(to, '✅ SoftStock: уведомления подключены',
        wrap('Уведомления подключены', '<p style="font-size:14px">Сюда будут приходить предупреждения об остатках и утренняя сводка.</p>'));
      return reply(200, { success: true, sent: 'test', to });
    }
    if (mode === 'preview') {
      const [summary, alerts] = await Promise.all([buildSummary(), runAlerts(false)]);
      return reply(200, { success: true, summary: summary.html, summarySubject: summary.subject,
        alerts: alerts.html, alertsSubject: alerts.subject, newOut: alerts.newOut, newLow: alerts.newLow,
        configured: { resend: !!RESEND_KEY, to: summary.to } });
    }
    if (mode === 'summary') {
      const s = await buildSummary();
      await sendMail(s.to, s.subject, s.html);
      return reply(200, { success: true, sent: 'summary', to: s.to });
    }
    if (mode === 'alerts') {
      const r = await runAlerts(true);
      return reply(200, { success: true, sent: r.html ? 'alerts' : 'nothing-new', newOut: r.newOut, newLow: r.newLow });
    }
    if (mode === 'logistics') {
      const l = await buildLogistics();
      await sendMail(l.to, l.subject, l.html);
      return reply(200, { success: true, sent: 'logistics', to: l.to });
    }
    if (mode === 'logistics-preview') {
      const l = await buildLogistics();
      return reply(200, { success: true, html: l.html, subject: l.subject, to: l.to, smtp: !!(SMTP_USER && SMTP_PASS) });
    }
    if (mode === 'auto') {
      const { settings } = await loadState();
      const done = [], errors = [];
      // каждое письмо отдельно: ошибка одного не мешает остальным
      const run = async (name, fn) => { try { if (await fn()) done.push(name); } catch (e) { errors.push(name + ': ' + e.message); } };
      if (settings.alerts_enabled !== 'false') await run('alerts', async () => (await runAlerts(true)).html);
      if (localHour() === SUMMARY_HOUR) {
        if (settings.summary_enabled !== 'false') await run('summary', async () => { const s = await buildSummary(); await sendMail(s.to, s.subject, s.html); return true; });
        if (settings.logistics_enabled === 'true') await run('logistics', async () => { const l = await buildLogistics(); await sendMail(l.to, l.subject, l.html); return true; });
      }
      return reply(200, { success: errors.length === 0, sent: done, errors });
    }
    return reply(400, { success: false, error: 'Неизвестный режим: ' + mode });
  } catch (e) {
    return reply(500, { success: false, error: String(e.message || e) });
  }
};
