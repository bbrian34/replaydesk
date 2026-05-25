import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Preseason top 20 player rankings — update once per season
const PRESEASON_PLAYER_RANKINGS = [
  { rank: 1,  name: "A'ja Wilson",      team: "Las Vegas Aces",     stats: "23.4 PPG, 10.2 RPG, 2.3 BPG" },
  { rank: 2,  name: "Alyssa Thomas",    team: "Phoenix Mercury",    stats: "15.4 PPG, 9.2 APG, 8.8 RPG" },
  { rank: 3,  name: "Napheesa Collier", team: "Minnesota Lynx",     stats: "22.9 PPG, 7.8 RPG, 3.2 APG" },
  { rank: 4,  name: "Breanna Stewart",  team: "New York Liberty",   stats: "18.3 PPG, 6.5 RPG, 1.4 BPG" },
  { rank: 5,  name: "Jackie Young",     team: "Las Vegas Aces",     stats: "16.5 PPG, 4.5 RPG, 5.1 APG" },
  { rank: 6,  name: "Sabrina Ionescu",  team: "New York Liberty",   stats: "18.2 PPG, 4.9 RPG, 5.7 APG" },
  { rank: 7,  name: "Allisha Gray",     team: "Atlanta Dream",      stats: "18.4 PPG, 5.3 RPG, 3.5 APG" },
  { rank: 8,  name: "Paige Bueckers",   team: "Dallas Wings",       stats: "19.2 PPG, 5.4 APG, 1.6 SPG" },
  { rank: 9,  name: "Kelsey Plum",      team: "Los Angeles Sparks", stats: "19.5 PPG, 3.1 RPG, 5.7 APG" },
  { rank: 10, name: "Caitlin Clark",    team: "Indiana Fever",      stats: "16.5 PPG, 5.0 RPG, 8.8 APG" },
  { rank: 11, name: "Kelsey Mitchell",  team: "Indiana Fever",      stats: "20.2 PPG, 1.8 RPG, 3.4 APG" },
  { rank: 12, name: "Kahleah Copper",   team: "Phoenix Mercury",    stats: "15.6 PPG, 2.9 RPG, 1.5 APG" },
  { rank: 13, name: "Rhyne Howard",     team: "Atlanta Dream",      stats: "17.5 PPG, 4.5 RPG, 4.6 APG" },
  { rank: 14, name: "Aliyah Boston",    team: "Indiana Fever",      stats: "15.0 PPG, 8.2 RPG, 3.7 APG" },
  { rank: 15, name: "Satou Sabally",    team: "New York Liberty",   stats: "16.3 PPG, 5.9 RPG, 1.3 SPG" },
  { rank: 16, name: "Nneka Ogwumike",   team: "Los Angeles Sparks", stats: "18.3 PPG, 7.0 RPG, 2.3 APG" },
  { rank: 17, name: "Chelsea Gray",     team: "Las Vegas Aces",     stats: "11.2 PPG, 3.9 RPG, 5.4 APG" },
  { rank: 18, name: "Jonquel Jones",    team: "New York Liberty",   stats: "13.6 PPG, 8.1 RPG, 1.1 BPG" },
  { rank: 19, name: "Skylar Diggins",   team: "Chicago Sky",        stats: "15.5 PPG, 2.5 RPG, 6.0 APG" },
  { rank: 20, name: "Arike Ogunbowale", team: "Dallas Wings",       stats: "15.5 PPG, 4.1 APG, 1.3 SPG" },
];

const PRESEASON_TEAM_RANKINGS = [
  { rank: 1,  name: "Las Vegas Aces",        detail: "98.2% playoff odds, 28.6 proj wins" },
  { rank: 2,  name: "New York Liberty",       detail: "99.1% playoff odds, 29.4 proj wins" },
  { rank: 3,  name: "Atlanta Dream",          detail: "97.1% playoff odds, 27.9 proj wins" },
  { rank: 4,  name: "Indiana Fever",          detail: "96.7% playoff odds, 27.6 proj wins" },
  { rank: 5,  name: "Los Angeles Sparks",     detail: "79.2% playoff odds, 24.4 proj wins" },
  { rank: 6,  name: "Dallas Wings",           detail: "53.1% playoff odds, 22.1 proj wins" },
  { rank: 7,  name: "Phoenix Mercury",        detail: "70.8% playoff odds, 23.5 proj wins" },
  { rank: 8,  name: "Minnesota Lynx",         detail: "82.9% playoff odds, 24.8 proj wins" },
  { rank: 9,  name: "Chicago Sky",            detail: "18.4% playoff odds, 19.1 proj wins" },
  { rank: 10, name: "Golden State Valkyries", detail: "73.0% playoff odds, 23.7 proj wins" },
  { rank: 11, name: "Washington Mystics",     detail: "22.2% playoff odds, 19.5 proj wins" },
  { rank: 12, name: "Toronto Tempo",          detail: "Expansion team, 2026 debut" },
  { rank: 13, name: "Connecticut Sun",        detail: "Final season in CT" },
  { rank: 14, name: "Seattle Storm",          detail: "Rebuilding" },
];

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

  const { articleText, articleUrl, playerStats, teamStats, injuryData, scheduleData } = body;

  if (!articleText && !articleUrl) {
    return new Response(JSON.stringify({ error: 'No article provided' }), { status: 400, headers });
  }

  // Build context string from live ESPN data
  let dataContext = `PRESEASON PLAYER RANKINGS (Top 20):\n`;
  PRESEASON_PLAYER_RANKINGS.forEach(p => {
    const live = playerStats?.find(s => s.name === p.name);
    if (live) {
      dataContext += `#${p.rank} preseason: ${p.name} (${p.team}) — Current: ${live.stats}\n`;
    } else {
      dataContext += `#${p.rank} preseason: ${p.name} (${p.team})\n`;
    }
  });

  dataContext += `\nPREASESON TEAM RANKINGS:\n`;
  PRESEASON_TEAM_RANKINGS.forEach(t => {
    const live = teamStats?.find(s => s.name === t.name);
    if (live) {
      dataContext += `#${t.rank} preseason: ${t.name} — Current record: ${live.record}, Net rating: ${live.netRating}\n`;
    } else {
      dataContext += `#${t.rank} preseason: ${t.name}\n`;
    }
  });

  if (injuryData?.length) {
    dataContext += `\nCURRENT INJURIES:\n`;
    injuryData.forEach(i => { dataContext += `${i.player} (${i.team}): ${i.status}\n`; });
  }

  if (scheduleData) {
    dataContext += `\nSCHEDULE CONTEXT:\n${scheduleData}\n`;
  }

  const systemPrompt = `You are mediadesk — an AI fact-checker for WNBA media coverage. You analyze articles for fairness using real data.

VERDICTS:
- FAIR: Article is balanced, claims supported by data
- BIASED: Article slants against a player or team, contradicted by data  
- HYPE: Article is overly positive, not grounded in reality

CRITICAL RULES:
- Base every judgment on the actual data provided — never on opinion
- Factor in injuries, schedule difficulty, opponent quality, and roster depth
- If an article criticizes a team/player without accounting for injuries or schedule, flag it
- If rankings data contradicts the article's narrative, cite it specifically
- Be direct and specific — name the exact claim that is or isn't supported

You MUST respond with valid JSON only. No markdown, no backticks, no text outside JSON.

Return exactly this structure:
{
  "verdict": "FAIR" | "BIASED" | "HYPE",
  "verdict_sub": "one sentence explaining the verdict",
  "got_right": "what the article got factually correct, grounded in data",
  "got_wrong": "what the article got wrong or misrepresented, with specific data citations",
  "missing_context": "what important context the article ignored — injuries, schedule, opponent quality etc",
  "data_used": "which specific rankings or stats informed this verdict"
}`;

  const userMessage = `Here is the live WNBA data context:\n\n${dataContext}\n\nHere is the article to analyze:\n\n${articleText || articleUrl}\n\nAnalyze this article for fairness and return your verdict as JSON.`;

  let result;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const raw = response.content.find(b => b.type === 'text')?.text || '';
    const fenceMatch  = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : objectMatch ? objectMatch[0].trim() : raw.trim();
    result = JSON.parse(jsonStr);
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Could not analyze article. Try again.' }), { status: 502, headers });
  }

  return new Response(JSON.stringify(result), { status: 200, headers });
}

export const config = { maxDuration: 30 };
