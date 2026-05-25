export default async function handler(req, context) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin =
    origin.endsWith('.netlify.app') ||
    origin === 'https://replaydesk.com' ||
    origin === 'https://www.replaydesk.com'
      ? origin : '*';

  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'scoreboard';

  const ESPN_URLS = {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
    standings:  'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/standings',
    news:       'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/news?limit=8',
    summary:    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${url.searchParams.get('eventId')}`,
  };

  const espnUrl = ESPN_URLS[type];
  if (!espnUrl) return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers });

  try {
    const res = await fetch(espnUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Could not fetch ESPN data' }), { status: 502, headers });
  }
}

export const config = { maxDuration: 15 };
