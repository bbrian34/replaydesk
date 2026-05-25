import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, context) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin =
    origin.endsWith('.netlify.app') ||
    origin === 'https://replaydesk.com' ||
    origin === 'https://www.replaydesk.com'
      ? origin
      : '*';

  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
  }

  const { image1, image2, type1, type2, question } = body;

  if (!image1 || !image2) {
    return new Response(JSON.stringify({ error: 'Two images required' }), { status: 400, headers });
  }

  const systemPrompt = `You are an expert basketball game analyst. The user has uploaded two box score screenshots — one per team. Read the stats carefully and produce a detailed game analysis.

${question ? `The user specifically wants to know: ${question}. Address this directly in your narrative and insights.` : ''}

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
    {"label":"Turnovers","team1_name":"Team A","team1_value":"12","team2_name":"Team B","team2_value":"18","winner":1}
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: type1 || 'image/jpeg', data: image1 } },
          { type: 'image', source: { type: 'base64', media_type: type2 || 'image/jpeg', data: image2 } },
          { type: 'text', text: 'Here are the two box scores. Analyze this game and return your breakdown as JSON.' }
        ]
      }]
    });

    const raw = response.content.find(b => b.type === 'text')?.text || '';
    const fenceMatch  = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : objectMatch ? objectMatch[0].trim() : raw.trim();
    result = JSON.parse(jsonStr);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Could not analyze. Try clearer screenshots.' }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify(result), { status: 200, headers });
}

export const config = {
  maxDuration: 30,
};
