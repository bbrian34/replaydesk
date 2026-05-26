/**
 * wnba-data — API proxy + cached stats server
 * Serves cached daily stats and live scoreboard data
 */

import { getStore } from '@netlify/blobs';

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
  const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

  // Live scoreboard — always fresh
  if (type === 'scoreboard') {
    try {
      const res = await fetch(`${ESPN_BASE}/scoreboard`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Could not fetch scoreboard' }), { status: 502, headers });
    }
  }

  // Game summary — always fresh
  if (type === 'summary') {
    try {
      const eventId = url.searchParams.get('eventId');
      const res = await fetch(`${ESPN_BASE}/summary?event=${eventId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Could not fetch summary' }), { status: 502, headers });
    }
  }

  // Cached daily stats — leaders and standings
  if (type === 'stats' || type === 'leaders' || type === 'standings') {
    try {
      const store = getStore({ name: 'wnba-stats', consistency: 'strong' });
      const cached = await store.get('daily-stats');
      if (cached) {
        const data = JSON.parse(cached);
        return new Response(JSON.stringify(data), { status: 200, headers });
      }
      // No cache yet — fetch live as fallback
      const res = await fetch(`${ESPN_BASE}/leaders?limit=15`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      return new Response(JSON.stringify({ leaders: data, updatedAt: new Date().toISOString() }), { status: 200, headers });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Could not fetch stats' }), { status: 502, headers });
    }
  }

  // Opinion articles from RSS feeds
  if (type === 'opinions') {
    const RSS_FEEDS = [
      { source: 'ESPN', url: 'https://www.espn.com/espn/rss/wnba/news' },
      { source: 'Bleacher Report', url: 'https://bleacherreport.com/wnba.rss' },
      { source: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/wnba/' },
    ];

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
      'highlights from', 'watch:'
    ];

    const WNBA_TERMS = [
      'wnba', 'fever', 'liberty', 'aces', 'dream', 'lynx', 'mercury',
      'storm', 'sky', 'sparks', 'wings', 'sun', 'mystics', 'valkyries',
      'tempo', 'clark', 'wilson', 'stewart', 'ionescu', 'collier',
      'bueckers', 'reese', 'thomas', 'plum', 'mitchell', 'gray'
    ];

    const articles = [];

    for (const feed of RSS_FEEDS) {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml' }
        });
        const xml = await res.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

        for (const item of items.slice(0, 20)) {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
          const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                        item.match(/<description>(.*?)<\/description>/))?.[1]
                        ?.replace(/<[^>]+>/g, '')?.trim() || '';
          const link = (item.match(/<link>(.*?)<\/link>/) ||
                        item.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim() || '';

          const combined = (title + ' ' + desc).toLowerCase();
          if (RECAP_KEYWORDS.some(k => combined.includes(k))) continue;
          if (!WNBA_TERMS.some(k => combined.includes(k))) continue;

          const isOpinion = OPINION_KEYWORDS.some(k => combined.includes(k));
          articles.push({ source: feed.source, headline: title, description: desc.slice(0, 120), url: link, isOpinion, score: isOpinion ? 2 : 1 });
        }
      } catch(e) {
        console.error(`Failed ${feed.source}:`, e.message);
      }
    }

    articles.sort((a, b) => b.score - a.score);
    return new Response(JSON.stringify({ articles: articles.slice(0, 8) }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers });
}

export const config = { maxDuration: 20 };
