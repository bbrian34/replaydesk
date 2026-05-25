import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, context) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin =
    origin.endsWith('.netlify.app') ||
    origin === 'https://replaydesk.com' ||
    origin === 'https://www.replaydesk.com'
      ? origin : '*';

  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { gameData } = body;
  if (!gameData) return new Response(JSON.stringify({ error: 'No game data provided' }), { status: 400, headers });

  // Extract key info from ESPN data
  const comp = gameData.header?.competitions?.[0];
  const home = comp?.competitors?.find(t => t.homeAway === 'home');
  const away = comp?.competitors?.find(t => t.homeAway === 'away');
  const homeName = home?.team?.displayName || 'Home';
  const awayName = away?.team?.displayName || 'Away';
  const homeScore = home?.score || '?';
  const awayScore = away?.score || '?';

  // Build stat summary from box score
  const boxscores = gameData.boxscore?.players || [];
  let statSummary = `${awayName} ${awayScore}, ${homeName} ${homeScore} - Final\n\n`;

  boxscores.forEach(teamData => {
    const tName = teamData.team?.displayName || 'Team';
    statSummary += `${tName}:\n`;
    const stats = teamData.statistics?.[0];
    if (stats) {
      const labels = stats.labels || [];
      stats.athletes?.slice(0, 8).forEach(athlete => {
        const name = athlete.athlete?.displayName || 'Player';
        const vals = athlete.stats || [];
        const line = labels.map((l, i) => `${l}: ${vals[i] || '0'}`).join(', ');
        statSummary += `  ${name} — ${line}\n`;
      });
      // Team totals
      const totals = stats.totals || [];
      if (totals.length) {
        statSummary += `  TEAM TOTALS — ${labels.map((l,i) => `${l}: ${totals[i]||'0'}`).join(', ')}\n`;
      }
    }
    statSummary += '\n';
  });

  const systemPrompt = `You are an expert WNBA game analyst. You have been given the full box score of a completed game. Analyze it and produce a detailed breakdown.

You MUST respond with valid JSON only. No markdown, no backticks, no text outside the JSON.

Return exactly this structure:
{
  "narrative": "2-3 sentence story of how the game played out, who dominated, key moments",
  "mvp_name": "player name",
  "mvp_line": "e.g. 34 pts, 8 reb, 6 ast on 14/22 shooting",
  "team_stats": [
    {"label":"Points","team1_name":"Team A","team1_value":"112","team2_name":"Team B","team2_value":"98","winner":1},
    {"label":"Rebounds","team1_name":"Team A","team1_value":"44","team2_name":"Team B","team2_value":"38","winner":1},
    {"label":"Assists","team1_name":"Team A","team1_value":"28","team2_name":"Team B","team2_value":"21","winner":1},
    {"label":"Turnovers","team1_name":"Team A","team1_value":"12","team2_name":"Team B","team2_value":"18","winner":1},
    {"label":"FG%","team1_name":"Team A","team1_value":"48.2%","team2_name":"Team B","team2_value":"41.5%","winner":1}
  ],
  "insights": [
    "<strong>Shooting efficiency:</strong> explanation of who shot better and why it mattered",
    "<strong>Matchup winner:</strong> which individual matchup decided the game",
    "<strong>Turning point:</strong> what stat or run decided the outcome"
  ]
}`;

  let result;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Here is the full box score:\n\n${statSummary}\n\nAnalyze this game and return your breakdown as JSON.` }]
    });

    const raw = response.content.find(b => b.type === 'text')?.text || '';
    const fenceMatch  = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : objectMatch ? objectMatch[0].trim() : raw.trim();
    result = JSON.parse(jsonStr);
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Could not analyze game. Try again.' }), { status: 502, headers });
  }

  return new Response(JSON.stringify(result), { status: 200, headers });
}

export const config = { maxDuration: 30 };
