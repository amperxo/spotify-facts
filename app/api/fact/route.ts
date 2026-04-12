import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchWikiSources } from '@/lib/wikipedia';
import { fetchMBCredits } from '@/lib/musicbrainz';
import { generateFact, type FactResult } from '@/lib/gemini';

// In-memory cache: trackId → result. Fine for dev and warm Vercel instances.
// Cap at 1000 entries to prevent unbounded memory growth.
const cache = new Map<string, FactResult>();
const CACHE_MAX = 1000;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  if (!cookieStore.get('refresh_token')?.value) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const trackId   = searchParams.get('trackId');
  const trackName = searchParams.get('track');
  const artistName = searchParams.get('artist');

  if (!trackId || !trackName || !artistName) {
    return NextResponse.json(
      { error: 'Missing required params: trackId, track, artist' },
      { status: 400 },
    );
  }

  // Guard against prompt injection via oversized or malformed inputs
  if (trackId.length > 64 || trackName.length > 200 || artistName.length > 200) {
    return NextResponse.json({ error: 'Params too long' }, { status: 400 });
  }

  if (cache.has(trackId)) {
    return NextResponse.json(cache.get(trackId));
  }

  // Wikipedia + MusicBrainz in parallel — neither blocks the other
  const [sources, mb] = await Promise.all([
    fetchWikiSources(trackName, artistName),
    fetchMBCredits(trackName, artistName).catch(() => ({ credits: [] })),
  ]);

  let result: FactResult;
  try {
    result = await generateFact(trackName, artistName, sources, mb);
  } catch (err) {
    const msg = String(err);
    const isOverloaded = msg.includes('503') || msg.includes('UNAVAILABLE');
    console.error('generateFact failed:', msg);
    return NextResponse.json(
      { fact: '', source: 'none', confidence: 'low', _error: isOverloaded ? 'overloaded' : 'error' },
      { status: 200 },
    );
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(trackId, result);
  return NextResponse.json(result);
}
