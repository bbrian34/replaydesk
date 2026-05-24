/**
 * replaydesk — cleanup-videos
 *
 * Runs on a schedule every 10 minutes.
 * Deletes any stored videos whose expiresAt metadata has passed.
 * This is the safety net — videos are also deleted immediately after sharing.
 *
 * Schedule: set in netlify.toml (see below)
 */

import { getStore } from '@netlify/blobs';

export default async function handler(req, context) {
  const store = getStore({ name: 'temp-videos', consistency: 'strong' });
  const now   = Date.now();
  let deleted = 0;
  let checked = 0;

  try {
    const { blobs } = await store.list();
    checked = blobs.length;

    for (const blob of blobs) {
      try {
        // getWithMetadata to read the expiresAt we stored
        const entry = await store.getWithMetadata(blob.key, { type: 'arrayBuffer' });
        if (!entry) continue;

        const { metadata } = entry;
        const expiresAt = metadata?.expiresAt ? new Date(metadata.expiresAt).getTime() : 0;

        if (expiresAt && now > expiresAt) {
          await store.delete(blob.key);
          deleted++;
          console.log(`Deleted expired video: ${blob.key}`);
        }
      } catch (e) {
        // Skip blobs that error — they may already be gone
        console.warn(`Skipped ${blob.key}:`, e.message);
      }
    }

    console.log(`Cleanup complete: checked ${checked}, deleted ${deleted}`);
    return new Response(JSON.stringify({ checked, deleted }), { status: 200 });
  } catch (e) {
    console.error('Cleanup failed:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export const config = {
  schedule: '*/10 * * * *', // every 10 minutes
};

/*
  netlify.toml entry (add this to your project root):

  [[plugins]]
  package = "@netlify/plugin-scheduled-functions"

  [functions.cleanup-videos]
  schedule = "*/10 * * * *"
*/
