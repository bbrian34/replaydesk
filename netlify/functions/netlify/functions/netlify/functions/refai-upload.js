/**
 * replaydesk — refai-upload
 *
 * Receives the video as multipart/form-data — completely sidesteps
 * the 6MB JSON payload limit. Netlify supports up to 50MB for
 * multipart uploads on the pro tier; free tier is ~6MB total still,
 * so we compress on the client side before sending.
 *
 * For files over 6MB, direct-to-storage upload via presigned URL
 * is the right approach (see comments below).
 */

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'crypto';

const VIDEO_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB hard cap

// Lock CORS same as main function
const allowedOrigins = [
  'https://replaydesk.netlify.app',
  'https://replaydesk.com',
  'https://www.replaydesk.com',
];

export default async function handler(req, context) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), { status: 400, headers });
    }

    const formData = await req.formData();
    const videoFile = formData.get('video');
    const rulingId  = formData.get('rulingId') || 'unknown';

    if (!videoFile || typeof videoFile === 'string') {
      return new Response(JSON.stringify({ error: 'No video file in request' }), { status: 400, headers });
    }

    // Size check
    const videoBuffer = await videoFile.arrayBuffer();
    if (videoBuffer.byteLength > MAX_SIZE_BYTES) {
      return new Response(
        JSON.stringify({ error: `Video too large (${(videoBuffer.byteLength / 1048576).toFixed(1)}MB). Max 50MB.` }),
        { status: 413, headers }
      );
    }

    // Store in Netlify Blobs
    const store    = getStore({ name: 'temp-videos', consistency: 'strong' });
    const videoId  = randomUUID();
    const expiresAt = new Date(Date.now() + VIDEO_TTL_MS).toISOString();

    await store.set(videoId, videoBuffer, {
      metadata: {
        contentType: videoFile.type || 'video/mp4',
        originalName: videoFile.name || 'clip.mp4',
        expiresAt,
        rulingId,
        createdAt: new Date().toISOString(),
      },
    });

    return new Response(JSON.stringify({ videoId, expiresAt }), { status: 200, headers });

  } catch (e) {
    console.error('Upload error:', e.message);
    return new Response(JSON.stringify({ error: 'Upload failed' }), { status: 500, headers });
  }
}

export const config = {
  path: '/api/refai-upload',
  maxDuration: 30,
};

/*
  NOTE — For free Netlify tier users:
  The free tier still has a ~6MB request body limit even for multipart.
  Two options for larger videos:

  Option A (easiest): Compress/resize the video in the browser before uploading
  using the MediaRecorder API to re-encode at lower bitrate.

  Option B (scalable): Use Netlify Blobs presigned upload URLs so the video
  goes directly from the browser to blob storage, bypassing the function entirely.
  Ask for the "presigned upload" version of this function if you need it.
*/
