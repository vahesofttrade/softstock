// Netlify Function — scans an invoice/packing-list photo with Claude's vision
// API and returns structured line items. The Anthropic API key lives only in
// the Netlify environment (Site settings → Environment variables →
// ANTHROPIC_API_KEY) — it is never sent to or stored in the browser.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY is not configured on this Netlify site (Site settings → Environment variables).' }) };
  }

  let imageBase64, mimeType, kind;
  try {
    const body = JSON.parse(event.body || '{}');
    imageBase64 = body.imageBase64;
    mimeType = body.mimeType || 'image/jpeg';
    kind = body.kind || 'invoice';
    if (!imageBase64) throw new Error('imageBase64 is required');
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ success: false, error: 'Bad request: ' + e.message }) };
  }

  // Остаток склада поставщика: быстрая модель и короткий ответ (массив массивов),
  // чтобы уложиться в лимит времени Netlify (~26 сек) даже на длинных списках.
  const STOCK_PROMPT = 'This is a paper supplier\'s stock list (ready goods). Extract EVERY product line. '
    + 'Return ONLY a JSON array of arrays, one per line, no markdown: [name, width_mm, ply, gsm, kg]. '
    + 'name = product text exactly as written (keep colour words like Белая/Красная/Крафт). '
    + 'width_mm = format/width in millimetres (e.g. "формат: 460" or "1350 мм" → 460 / 1350). ply = layers (слой/слойность/сл). '
    + 'gsm = grammage (гр, г/м2, плотность). kg = quantity in KILOGRAMS (if the list is in tonnes, multiply by 1000; "1,885" in a tonnes column = 1885). '
    + 'Use null for anything missing. Skip group headers, totals and empty rows.';
  const payload = {
    model: kind === 'stock' ? (process.env.SCANNER_FAST_MODEL || 'claude-haiku-4-5') : 'claude-sonnet-4-6',
    max_tokens: kind === 'stock' ? 3000 : 4000,
    messages: [{
      role: 'user',
      content: [
        mimeType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
          : { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        kind === 'stock' ? { type: 'text', text: STOCK_PROMPT } : {
          type: 'text',
          text: 'Analyze this shipping invoice / packing list / supplier stock list for paper roll products. Extract ALL product line items as a JSON array. CRITICAL RULES: 1) width_mm MUST be parsed from the product NAME text only (the number right before a "mm" marker in the name) — NEVER take width from a table column, table columns are usually roll/place counts, not width. 2) layers comes from a "ply" marker in the product name. 3) gsm comes from a "gsm"/"г/м2" marker in the product name. 4) net_weight_t is the net weight in TONNES from the weight column; a realistic max per line is 25 tonnes — if the sheet shows kg, divide by 1000. 5) qty_places is the integer count of rolls/pallets/places. Each object: {"name_original":"","name_en":"","width_mm":0,"layers":0,"gsm":0,"qty_places":0,"net_weight_t":0,"gross_weight_t":0,"hs_code":"","code":""}. Return ONLY the JSON array, no markdown, no commentary.'
        }
      ]
    }]
  };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (data.error) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ success: false, error: 'Anthropic API error: ' + (data.error.message || JSON.stringify(data.error)) }) };
    }
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ success: false, error: 'No JSON array found in model response.' }) };
    }
    let items;
    try {
      items = JSON.parse(match[0]);
    } catch (parseErr) {
      return { statusCode: 502, headers: cors, body: JSON.stringify({ success: false, error: 'Could not parse extracted JSON: ' + parseErr.message }) };
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, items }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: e.toString() }) };
  }
};
