import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Preseason top 20 player rankings — update once per season
const PRESEASON_PLAYER_RANKINGS = [
  { rank: 1,  name: "A'ja Wilson",        team: "Las Vegas Aces" },
  { rank: 2,  name: "Breanna Stewart",     team: "New York Liberty" },
  { rank: 3,  name: "Sabrina Ionescu",     team: "New York Liberty" },
  { rank: 4,  name: "Arike Ogunbowale",    team: "Dallas Wings" },
  { rank: 5,  name: "Kelsey Plum",         team: "Las Vegas Aces" },
  { rank: 6,  name: "Napheesa Collier",    team: "Minnesota Lynx" },
  { rank: 7,  name: "Jonquel Jones",       team: "New York Liberty" },
  { rank: 8,  name: "Jewell Loyd",         team: "Seattle Storm" },
  { rank: 9,  name: "DeWanna Bonner",      team: "Connecticut Sun" },
  { rank: 10, name: "Caitlin Clark",       team: "Indiana Fever" },
  { rank: 11, name: "Dearica Hamby",       team: "Los Angeles Sparks" },
  { rank: 12, name: "Brittney Griner",     team: "Phoenix Mercury" },
  { rank: 13, name: "Skylar Diggins-Smith",team: "Seattle Storm" },
  { rank: 14, name: "Nneka Ogwumike",      team: "Seattle Storm" },
  { rank: 15, name: "Rhyne Howard",        team: "Atlanta Dream" },
  { rank: 16, name: "Aliyah Boston",       team: "Indiana Fever" },
  { rank: 17, name: "Aerial Powers",       team: "Minnesota Lynx" },
  { rank: 18, name: "Courtney Williams",   team: "Chicago Sky" },
  { rank: 19, name: "Tiffany Hayes",       team: "Connecticut Sun" },
  { rank: 20, name: "Lexie Brown",         team: "Los Angeles Sparks" },
];

const PRESEASON_TEAM_RANKINGS = [
  { rank: 1, name: "Las Vegas Aces" },
  { rank: 2, name: "New York Liberty" },
  { rank: 3, name: "Connecticut Sun" },
  { rank: 4, name: "Seattle Storm" },
  { rank: 5, name: "Minnesota Lynx" },
  { rank: 6, name: "Chicago Sky" },
  { rank: 7, name: "Atlanta Dream" },
  { rank: 8, name: "Dallas Wings" },
  { rank: 9, name: "Indiana Fever" },
  { rank: 10, name: "Phoenix Mercury" },
  { rank: 11, name: "Los Angeles Sparks" },
  { rank: 12, name: "Washington Mystics" },
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
