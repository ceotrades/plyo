import { createClient } from 'jsr:@supabase/supabase-js@2';

const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY') ?? '';

const SYSTEM_PROMPT = `You are a fitness coach assistant. Extract all exercises from this workout transcript into structured JSON.

Return ONLY a valid JSON object in this exact shape:
{
  "exercises": [
    {
      "name": "string",
      "sets": number | null,
      "reps": number | null,
      "duration_seconds": number | null,
      "rest_seconds": number | null,
      "notes": "string | null"
    }
  ],
  "total_duration_minutes": number | null,
  "notes": "string | null"
}

Use null for any field not mentioned. Output nothing but the JSON object.`;

// ── Types ─────────────────────────────────────────────────────────────────────

type ResolvedMedia = {
  mediaUrl: string;
  // Passed to Whisper's Content-Type. Audio-only files from Instagram are
  // smaller (usually <2 MB for a 60s Reel) and sent as audio/mp4 (AAC/M4A).
  // TikTok returns full video which we send as video/mp4 — identical to before.
  mimeType: 'audio/mp4' | 'video/mp4';
};

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Every call spends Apify and OpenAI credit, so only signed-in users get one.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Missing Authorization header', 401);
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonError('Unauthorized', 401);

    const { url } = await req.json();
    if (!url || typeof url !== 'string') return jsonError('url is required', 400);

    const { mediaUrl, mimeType } = await resolveMediaUrl(url.trim());

    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.status}`);

    const mediaBytes = await mediaRes.arrayBuffer();
    if (mediaBytes.byteLength > 25 * 1024 * 1024) {
      throw new Error('Media exceeds Whisper 25 MB limit. Try a shorter clip (under ~3 min).');
    }

    const transcript = await transcribe(mediaBytes, mimeType);
    const workout = await extractWorkout(transcript);
    return json({ workout, transcript });
  } catch (err) {
    return jsonError((err as Error).message, 500);
  }
});

// ── URL resolution ─────────────────────────────────────────────────────────────

// Match on the parsed hostname. A substring check would accept
// https://anything.example/?x=tiktok.com and pass it to the paid scrapers.
function hostIs(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function resolveMediaUrl(url: string): Promise<ResolvedMedia> {
  if (hostIs(url, ['tiktok.com'])) {
    const mediaUrl = await resolveTikTok(url);
    return { mediaUrl, mimeType: 'video/mp4' };
  }

  if (hostIs(url, ['instagram.com', 'instagr.am'])) {
    return resolveInstagram(url);
  }

  throw new Error('Unsupported URL. Paste a TikTok or Instagram Reel link.');
}

// TikTok — unchanged, uses tikwm.com as before.
async function resolveTikTok(url: string): Promise<string> {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`tikwm API error: ${res.status}`);

  const body = await res.json();
  if (body.code !== 0) throw new Error(`TikTok resolve failed: ${body.msg}`);

  const play: string | undefined = body.data?.play;
  if (!play) throw new Error('No video URL returned from TikTok resolver');
  return play;
}

// Instagram — uses the Apify Instagram Reel Scraper.
// Cost: ~$0.0036/reel at base tier (reel result + actor start).
// The audioUrl field is the audio-only track (AAC/M4A, typically 1–3 MB for
// a 60-second Reel), which is well within Whisper's 25 MB limit and faster
// to download than the full video. Falls back to videoUrl if audioUrl is absent.
async function resolveInstagram(url: string): Promise<ResolvedMedia> {
  if (!APIFY_API_KEY) {
    throw new Error('Instagram support is not configured (missing APIFY_API_KEY).');
  }

  // run-sync-get-dataset-items starts the actor, waits up to 60 s, and
  // returns the dataset rows directly — no polling needed.
  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items` +
      `?token=${APIFY_API_KEY}&timeout=60&format=json`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: [url], resultsLimit: 1 }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify error (${res.status}): ${text}`);
  }

  type ReelItem = {
    audioUrl?: string;
    videoUrl?: string;
    error?: string;
    errorDescription?: string;
  };

  const items: ReelItem[] = await res.json();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      'Could not resolve Instagram Reel. Make sure the URL is correct and the account is public.',
    );
  }

  const reel = items[0];

  if (reel.error) {
    throw new Error(`Instagram: ${reel.errorDescription ?? reel.error}`);
  }

  // Prefer the audio-only URL — it's much smaller and still contains
  // everything Whisper needs. Fall back to the full video if absent.
  const mediaUrl = reel.audioUrl ?? reel.videoUrl;
  if (!mediaUrl) {
    throw new Error(
      'Instagram Reel has no downloadable media. The account may be private or the Reel may have been removed.',
    );
  }

  const mimeType: ResolvedMedia['mimeType'] = reel.audioUrl ? 'audio/mp4' : 'video/mp4';
  return { mediaUrl, mimeType };
}

// ── Transcription & extraction ─────────────────────────────────────────────────

async function transcribe(mediaBytes: ArrayBuffer, mimeType: 'audio/mp4' | 'video/mp4'): Promise<string> {
  const form = new FormData();
  // Whisper identifies format from the blob's Content-Type, not the filename.
  // Using the right type ensures correct codec detection for both audio and video.
  const filename = mimeType === 'audio/mp4' ? 'audio.mp4' : 'video.mp4';
  form.append('file', new Blob([mediaBytes], { type: mimeType }), filename);
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Whisper error: ${msg}`);
  }
  const data = await res.json();
  return data.text as string;
}

async function extractWorkout(transcript: string): Promise<unknown> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GPT-4o error: ${msg}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}
