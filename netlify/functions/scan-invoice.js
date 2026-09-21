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

  let imageBase64, mimeType;
  try {
    const body = JSON.parse(event.body || '{}');
    imageBase64 = body.imageBase64;
    mimeType = body.mimeType || 'image/jpeg';
    if (!imageBase64) throw new Error('imageBase64 is required');
  } catch (e) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ success: false, error: 'Bad request: ' + e.message }) };
  }

  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        {
          type: 'text',
          text: 'Analyze this shipping invoice / packing list for paper roll products. Extract ALL product line items as a JSON array. CRITICAL RULES: 1) width_mm MUST be parsed from the product NAME text only (the number right before a "mm" marker in the name) — NEVER take width from a table column, table columns are usually roll/place counts, not width. 2) layers comes from a "ply" marker in the product name. 3) gsm comes from a "gsm"/"г/м2" marker in the product name. 4) net_weight_t is the net weight in TONNES from the weight column; a realistic max per line is 25 tonnes — if the sheet shows kg, divide by 1000. 5) qty_places is the integer count of rolls/pallets/places. Each object: {"name_original":"","name_en":"","width_mm":0,"layers":0,"gsm":0,"qty_places":0,"net_weight_t":0,"gross_weight_t":0,"hs_code":"","code":""}. Return ONLY the JSON array, no markdown, no commentary.'
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
