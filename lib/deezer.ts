const DEEZER_API = 'https://api.deezer.com';

// Real BPM (and loudness) for a track, used to drive a genuine beat pulse in the
// visualizer. Deezer is free, needs no key, and exposes a `bpm` field — a viable
// replacement for Spotify's deprecated /audio-features. Returns null when Deezer
// has no BPM for the track (bpm = 0, common for niche/instrumental music), so the
// caller can fall back to the per-song pseudo-tempo.

export interface DeezerInfo {
  bpm: number;
  gain: number; // track loudness in dB (negative); rough proxy for energy
}

interface DeezerTrackResponse {
  bpm?: number;
  gain?: number;
}

interface DeezerSearchResponse {
  data?: { id: number }[];
}

// Deezer returns HTTP 200 with an { error } body for not-found, so check both.
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as (T & { error?: unknown }) | null;
    if (!data || (data as { error?: unknown }).error) return null;
    return data as T;
  } catch {
    return null;
  }
}

// Strip Spotify's reissue/edition suffixes so the title search matches Deezer.
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–]\s*[^-–]*\b(remaster(ed)?|deluxe|edition|version|anniversary|mono|stereo|remix|live)\b.*$/i, '')
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|deluxe|edition|version|anniversary|mono|stereo|remix)\b[^)\]]*[)\]]/gi, '')
    .trim();
}

export async function fetchTempo(
  isrc: string | null,
  track: string,
  artist: string,
): Promise<DeezerInfo | null> {
  let t: DeezerTrackResponse | null = null;

  // Exact match by ISRC first — avoids fuzzy-search mismatches entirely.
  if (isrc) {
    t = await getJson<DeezerTrackResponse>(`${DEEZER_API}/track/isrc:${encodeURIComponent(isrc)}`);
  }

  // Fall back to a title + artist search if no ISRC or no BPM on the ISRC match.
  if (!t?.bpm) {
    const q = encodeURIComponent(`track:"${cleanTitle(track)}" artist:"${artist}"`);
    const search = await getJson<DeezerSearchResponse>(`${DEEZER_API}/search?q=${q}&limit=1`);
    const id = search?.data?.[0]?.id;
    if (id) t = await getJson<DeezerTrackResponse>(`${DEEZER_API}/track/${id}`);
  }

  if (!t?.bpm || t.bpm <= 0) return null;
  return { bpm: t.bpm, gain: typeof t.gain === 'number' ? t.gain : -12 };
}
