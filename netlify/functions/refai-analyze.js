/**
 * replaydesk — refai-analyze
 */

import Anthropic from '@anthropic-ai/sdk';
import { getStore } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VIDEO_TTL_MS = 15 * 60 * 1000;

export default async function handler(req, context) {
  const url  = new URL(req.url);
  const path = url.pathname.replace(/.*\/refai-analyze/, '');

  // Allow any netlify.app subdomain plus custom domains
  const origin = req.headers.get('origin') || '';
  const allowedOrigin =
    origin.endsWith('.netlify.app') ||
    origin === 'https://replaydesk.com' ||
    origin === 'https://www.replaydesk.com'
      ? origin
      : '*';

  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, DELETE, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // DELETE /video/:id
  if (req.method === 'DELETE' && path.startsWith('/video/')) {
    const videoId = path.replace('/video/', '').trim();
    if (!videoId) {
      return new Response(JSON.stringify({ error: 'Missing video ID' }), { status: 400, headers });
    }
    try {
      const store = getStore({ name: 'temp-videos', consistency: 'strong' });
      await store.delete(videoId);
    } catch (e) {}
    return new Response(JSON.stringify({ deleted: true }), { status: 200, headers });
  }

  // GET /video/:id
  if (req.method === 'GET' && path.startsWith('/video/')) {
    const videoId = path.replace('/video/', '').trim();
    try {
      const store = getStore({ name: 'temp-videos', consistency: 'strong' });
      const entry = await store.getWithMetadata(videoId, { type: 'arrayBuffer' });
      if (!entry) {
        return new Response(JSON.stringify({ error: 'Video not found or expired' }), { status: 404, headers });
      }
      const { data, metadata } = entry;
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': metadata.contentType || 'video/mp4',
          'Cache-Control': 'no-store',
          'X-Expires-At': metadata.expiresAt || '',
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Could not retrieve video' }), { status: 500, headers });
    }
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

  const { frames, sport, debate, videoBase64, videoType } = body;

  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    return new Response(JSON.stringify({ error: 'No frames provided' }), { status: 400, headers });
  }

  // Store video temporarily
  let videoId = null;
  if (videoBase64 && videoType) {
    try {
      const store = getStore({ name: 'temp-videos', consistency: 'strong' });
      videoId = randomUUID();
      const videoBuffer = Buffer.from(videoBase64, 'base64');
      const expiresAt = new Date(Date.now() + VIDEO_TTL_MS).toISOString();
      await store.set(videoId, videoBuffer, {
        metadata: { contentType: videoType, expiresAt, createdAt: new Date().toISOString() },
      });
    } catch (e) {
      console.error('Video store failed:', e.message);
      videoId = null;
    }
  }

  const leagueMap = { nba: 'NBA', ncaa: 'NCAA basketball', other: 'basketball' };
  const league = leagueMap[sport] || 'basketball';

  const debateInstructions = {
    foul:     'Focus specifically on whether a foul was committed. Be direct.',
    flagrant: 'Focus specifically on whether this rises to a flagrant foul (1 or 2). Analyze intent and excess force.',
    oob:      'Focus specifically on out of bounds — who touched it last and which team gets possession.',
    all:      'Provide a complete breakdown covering foul, flagrant possibility, and out of bounds if visible.',
  };
  const focus = debateInstructions[debate] || debateInstructions.all;

  const systemPrompt = `You are an expert ${league} officiating analyst reviewing a play from a single camera angle. 
${focus}

CRITICAL RULES:
- Every text field must begin with "From this angle, it appears"
- Never make definitive claims — you only have one angle
- Be direct and confident within that constraint
- Keep all text fields concise (1-2 sentences max)

You MUST respond with valid JSON only. No markdown, no backticks, no explanation outside the JSON.

Return exactly this structure:
{
  "angle":        "From this angle, it appears [overall read of the play]",
  "call":         "FOUL" | "NO FOUL" | "N/A",
  "on":           "description of who the foul is on, or n/a",
  "edge":         "clean" | "borderline" | "clear foul" | "n/a",
  "why":          "From this angle, it appears [foul reasoning]",
  "flop":         "yes" | "no" | "possible",
  "flagrant":     "none" | "not flagrant" | "flagrant 1" | "flagrant 2" | "borderline",
  "flagrant_why": "From this angle, it appears [flagrant reasoning, or n/a]",
  "oob":          "yes" | "no" | "unclear" | "not in clip",
  "last_touch":   "description of last touch, or n/a",
  "possession":   "which team, or n/a",
  "oob_edge":     "clean" | "borderline" | "clear" | "n/a",
  "oob_why":      "From this angle, it appears [oob reasoning, or n/a]"
}`;

  const imageBlocks = frames.map(frame => ({
    type:   'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: frame },
  }));

  const userMessage = [
    ...imageBlocks,
    { type: 'text', text: `These ${frames.length} frames are from a ${league} play. Review them and return your ruling as JSON.` },
  ];

  let ruling;
  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    });

    const raw = response.content.find(b => b.type === 'text')?.text || '';
    const fenceMatch  = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch  ? fenceMatch[1].trim()
                  : objectMatch ? objectMatch[0].trim()
                  : raw.trim();
    ruling = JSON.parse(jsonStr);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'AI could not produce a valid ruling. Try a clearer clip.' }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ ...ruling, videoId }), { status: 200, headers });
}

export const config = {
  path: '/api/refai-analyze',
  maxDuration: 30,
};
