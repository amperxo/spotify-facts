import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  fetchCurrentlyPlaying,
  fetchAudioFeatures,
  refreshAccessToken,
  type AudioFeatures,
} from '@/lib/spotify';

// Audio features don't change — cache them permanently by track ID.
// Cap at 500 entries to prevent unbounded memory growth.
const featuresCache = new Map<string, AudioFeatures>();
const FEATURES_CACHE_MAX = 500;

async function getTrack(accessToken: string) {
  const track = await fetchCurrentlyPlaying(accessToken);
  if (!track) return null;

  // Fetch audio features once per track; fall back to defaults on failure.
  if (!featuresCache.has(track.id)) {
    const features = await fetchAudioFeatures(track.id, accessToken).catch(() => null);
    if (featuresCache.size >= FEATURES_CACHE_MAX) featuresCache.delete(featuresCache.keys().next().value!);
    featuresCache.set(track.id, features ?? { tempo: 120, energy: 0.7 });
  }
  const { tempo, energy } = featuresCache.get(track.id)!;
  return { ...track, tempo, energy };
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
