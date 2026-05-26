/**
 * fetch-wnba-stats — Scheduled function
 * Runs daily at midnight ET to fetch and cache WNBA stats from ESPN
 */

import { getStore } from '@netlify/blobs';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';
const STATS_BASE = 'https://stats.espn.com/wnba/stats/playerstats';

async function fetchESPN(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return res.json();
}

export default async function handler(req, context) {
  try {
    const store = getStore({ name: 'wnba-stats', consistency: 'strong' });

    // 1. Fetch team standings
    const standingsData = await fetchESPN(`${ESPN_BASE}/standings`);
    const teams = [];
    const entries = standingsData.children?.[0]?.standings?.entries || [];
    entries.forEach(entry => {
      const name = entry.team?.displayName || '';
      const abbr = entry.team?.abbreviation || '';
      const wins = entry.stats?.find(s => s.name === 'wins')?.value || 0;
      const losses = entry.stats?.find(s => s.name === 'losses')?.value || 0;
      const pct = entry.stats?.find(s => s.name === 'winPercent')?.value || 0;
      const gb = entry.stats?.find(s => s.name === 'gamesBehind')?.displayValue || '—';
      const streak = entry.stats?.find(s => s.name === 'streak')?.displayValue || '';
      const home = entry.stats?.find(s => s.name === 'Home')?.displayValue || '';
      const away = entry.stats?.find(s => s.name === 'Away')?.displayValue || '';
      teams.push({ name, abbr, wins, losses, pct, gb, streak, home, away });
    });

    // 2. Fetch player stats — scoring
    const scoringData = await fetchESPN(`${ESPN_BASE}/leaders?limit=15`);
    const leaders = {
      points: [],
      rebounds: [],
      assists: [],
      steals: [],
      blocks: [],
      fg: [],
      threePoint: [],
      ft: [],
    };

    const cats = scoringData.categories || [];
    cats.forEach(cat => {
      const name = cat.name;
      const athletes = cat.leaders || [];
      const mapped = athletes.slice(0, 10).map(a => ({
        name: a.athlete?.displayName || '',
        team: a.athlete?.team?.abbreviation || '',
        value: a.displayValue || '',
      }));
      if (name === 'points') leaders.points = mapped;
      else if (name === 'rebounds') leaders.rebounds = mapped;
      else if (name === 'assists') leaders.assists = mapped;
      else if (name === 'steals') leaders.steals = mapped;
      else if (name === 'blocks') leaders.blocks = mapped;
      else if (name === 'fieldGoalPct') leaders.fg = mapped;
      else if (name === 'threePointFieldGoalPct') leaders.threePoint = mapped;
      else if (name === 'freeThrowPct') leaders.ft = mapped;
    });

    // 3. Fetch scoreboard for today's games
    const scoreboard = await fetchESPN(`${ESPN_BASE}/scoreboard`);

    // 4. Cache everything
    const payload = {
      updatedAt: new Date().toISOString(),
      teams,
      leaders,
      scoreboard: scoreboard.events || [],
    };

    await store.set('daily-stats', JSON.stringify(payload));

    console.log('WNBA stats cached successfully:', new Date().toISOString());
    return new Response(JSON.stringify({ success: true, updatedAt: payload.updatedAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch(e) {
    console.error('Failed to cache WNBA stats:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export const config = {
  schedule: '0 5 * * *', // midnight ET = 5am UTC
};
