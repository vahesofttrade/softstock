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

async function isAdminToken(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const res = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
  if (!res.ok) return false;
  const user = await res.json();
  if (!user || !user.id) return false;
  const rows = await sb('profiles?select=role&id=eq.' + encodeURIComponent(user.id));
  return !!(rows && rows[0] && rows[0].role === 'admin');
}

// ── почта ──
function recipients(settings) {
  return String(settings.alert_email || process.env.ALERT_EMAIL_TO || '')
    .split(/[,;\s]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}
async function sendMail(to, subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY не задан в Netlify');
  if (!to.length) throw new Error('не указан адрес получателя (страница «Сервис»)');
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
    + tile('Поставки в пути', String((pend || []).length), kg(pendKg) + ' кг' + (overdue ? ' · <b style="color:#B42318">просрочено ' + overdue + '</b>' : ''))
    + tile('Резервы', String((res || []).length), kg(resKg) + ' кг')
    + '</tr></table>';
  if (out.length) body += h3('Закончились (' + out.length + ')') + tableOut(out);
  if (low.length) body += h3('Заканчиваются (' + low.length + ')') + '<div style="font-size:12px;color:#5B6660">High — запаса ≤ ' + thr.high + ' дн., Medium — ≤ ' + thr.medium + ' дн.</div>' + tableLow(low);
  if (!out.length && !low.length) body += '<p style="font-size:14px;color:#0F6E56;font-weight:700">✓ По позициям High и Medium всё в порядке.</p>';

  const subject = '📦 SoftStock — сводка на ' + ruDate(today) + (out.length || low.length ? ' · внимание: ' + (out.length + low.length) : '');
  return { subject, html: wrap('Сводка на ' + ruDate(today), body), to: recipients(settings) };
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
    if (mode === 'auto') {
      const { settings } = await loadState();
      const done = [];
      if (settings.alerts_enabled !== 'false') { const r = await runAlerts(true); if (r.html) done.push('alerts'); }
      if (settings.summary_enabled !== 'false' && localHour() === SUMMARY_HOUR) {
        const s = await buildSummary(); await sendMail(s.to, s.subject, s.html); done.push('summary');
      }
      return reply(200, { success: true, sent: done });
    }
    return reply(400, { success: false, error: 'Неизвестный режим: ' + mode });
  } catch (e) {
    return reply(500, { success: false, error: String(e.message || e) });
  }
};
