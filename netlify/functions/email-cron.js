// Netlify Scheduled Function — раз в час запускает проверку остатков.
// Расписание задано в netlify.toml ([functions."email-cron"]).
// Сама работа делается в email-alerts.js (режим "auto"):
//   • каждый час — новые предупреждения по High/Medium;
//   • в SUMMARY_HOUR по Еревану (по умолчанию 9:00) — утренняя сводка.
// По адресу такую функцию вызвать нельзя — только по расписанию.

const crypto = require('crypto');

exports.handler = async () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key || !process.env.RESEND_API_KEY) {
    console.log('email-cron: уведомления не настроены (нет SUPABASE_SERVICE_ROLE_KEY или RESEND_API_KEY)');
    return { statusCode: 200 };
  }
  const site = process.env.URL || 'https://sensational-gingersnap-05c5cd.netlify.app';
  const secret = crypto.createHash('sha256').update('softstock-cron:' + key).digest('hex');
  try {
    const res = await fetch(site + '/.netlify/functions/email-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
      body: JSON.stringify({ mode: 'auto' })
    });
    console.log('email-cron:', res.status, (await res.text()).slice(0, 300));
  } catch (e) {
    console.log('email-cron error:', e.message);
  }
  return { statusCode: 200 };
};
