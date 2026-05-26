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

  // ESPN proxy for game data
  const ESPN_URLS = {
    scoreboard: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
    summary:    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${url.searchParams.get('eventId')}`,
  };

  if (type === 'scoreboard' || type === 'summary') {
    const espnUrl = ESPN_URLS[type];
    try {
      const res = await fetch(espnUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Could not fetch ESPN data' }), { status: 502, headers });
    }
  }

  // Opinion/feature articles — pull from multiple RSS feeds
  if (type === 'opinions') {
    const RSS_FEEDS = [
      { source: 'ESPN', url: 'https://www.espn.com/espn/rss/wnba/news' },
      { source: 'Bleacher Report', url: 'https://bleacherreport.com/wnba.rss' },
      { source: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/wnba/' },
    ];

    // Keywords that indicate opinion/feature content vs game recaps
    const OPINION_KEYWORDS = [
      'should', 'why', 'how', 'best', 'worst', 'overrated', 'underrated',
      'ranking', 'ranked', 'power', 'mvp', 'case for', 'case against',
      'problem', 'issue', 'concern', 'question', 'future', 'legacy',
      'snubbed', 'deserves', 'wrong', 'right', 'fair', 'unfair',
      'analysis', 'breakdown', 'take', 'opinion', 'think', 'believe',
      'season', 'career', 'history', 'impact', 'role', 'fit'
    ];

    const RECAP_KEYWORDS = [
      'recap', 'game highlights', 'box score', 'final score',
      'beats', 'defeats', 'wins over', 'loses to', 'falls to',
      'highlights from', 'watch:', 'game highlights'
    ];

    const articles = [];

    for (const feed of RSS_FEEDS) {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml' }
        });
        const xml = await res.text();

        // Parse RSS items
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const item of items.slice(0, 20)) {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                        item.match(/<description>(.*?)<\/description>/))?.[1]
                        ?.replace(/<[^>]+>/g, '')?.trim() || '';
          const link = (item.match(/<link>(.*?)<\/link>/) ||
                        item.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim() || '';
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || '';

          const titleLower = title.toLowerCase();
          const descLower = desc.toLowerCase();
          const combined = titleLower + ' ' + descLower;

          // Skip game recaps
          const isRecap = RECAP_KEYWORDS.some(k => combined.includes(k));
          if (isRecap) continue;

          // Check for WNBA relevance
          const isWNBA = combined.includes('wnba') || combined.includes('fever') ||
                         combined.includes('liberty') || combined.includes('aces') ||
                         combined.includes('dream') || combined.includes('lynx') ||
                         combined.includes('mercury') || combined.includes('storm') ||
                         combined.includes('sky') || combined.includes('sparks') ||
                         combined.includes('wings') || combined.includes('sun') ||
                         combined.includes('mystics') || combined.includes('valkyries') ||
                         combined.includes('tempo') || combined.includes('clark') ||
                         combined.includes('wilson') || combined.includes('stewart') ||
                         combined.includes('ionescu') || combined.includes('collier');

          if (!isWNBA) continue;

          // Prefer opinion/feature content
          const hasOpinion = OPINION_KEYWORDS.some(k => combined.includes(k));

          articles.push({
            source: feed.source,
            headline: title,
            description: desc.slice(0, 120),
            url: link,
            pubDate,
            isOpinion: hasOpinion,
            score: hasOpinion ? 2 : 1,
          });
        }
      } catch(e) {
        console.error(`Failed to fetch ${feed.source}:`, e.message);
      }
    }

    // Sort — opinion pieces first, then by date
    articles.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({ articles: articles.slice(0, 8) }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers });
}

export const config = { maxDuration: 20 };
