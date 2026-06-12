import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchCurrentlyPlaying, refreshAccessToken } from '@/lib/spotify';
import { fetchTempo } from '@/lib/deezer';

// Real BPM rarely changes for a track — cache per track id (0 = looked up, none
// found). Capped to bound memory like the other in-process caches.
const tempoCache = new Map<string, number>();
const TEMPO_CACHE_MAX = 500;

async function getTrack(accessToken: string) {
  const track = await fetchCurrentlyPlaying(accessToken);
  if (!track) return null;

  if (!tempoCache.has(track.id)) {
    const info = await fetchTempo(track.isrc, track.name, track.artist).catch(() => null);
    if (tempoCache.size >= TEMPO_CACHE_MAX) tempoCache.delete(tempoCache.keys().next().value!);
    tempoCache.set(track.id, info?.bpm ?? 0);
  }

  // Attach a real tempo when we have one; otherwise omit it so the visualizer
  // falls back to its per-song pseudo-tempo.
  const bpm = tempoCache.get(track.id)!;
  return bpm > 0 ? { ...track, tempo: bpm } : track;
}

export async function GET() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  let accessToken = cookieStore.get('access_token')?.value;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!accessToken) {
    try {
      const tokens = await refreshAccessToken(refreshToken);
      accessToken = tokens.access_token;
      cookieStore.set('access_token', tokens.access_token, {
        httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: tokens.expires_in,
      });
    } catch {
      return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }
  }

  try {
    const track = await getTrack(accessToken!);
    return NextResponse.json({ playing: track !== null, track });
  } catch (err) {
    if (err instanceof Error && err.message === 'SPOTIFY_401') {
      try {
        const tokens = await refreshAccessToken(refreshToken);
        cookieStore.set('access_token', tokens.access_token, {
          httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: tokens.expires_in,
        });
        const track = await getTrack(tokens.access_token);
        return NextResponse.json({ playing: track !== null, track });
      } catch {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
      }
    }
    console.error('now-playing error:', err);
    return NextResponse.json({ error: 'spotify_error' }, { status: 502 });
  }
}
