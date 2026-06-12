import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchAlbumListings, type AlbumListings } from '@/lib/discogs';

// In-memory cache keyed by album+artist. Listings change slowly; per-process
// caching keeps us well under Discogs' 60 req/min limit. Capped to bound memory.
const cache = new Map<string, AlbumListings | null>();
const CACHE_MAX = 500;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  if (!cookieStore.get('refresh_token')?.value) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const album = searchParams.get('album');
  const artist = searchParams.get('artist');

  if (!album || !artist) {
    return NextResponse.json(
      { error: 'Missing required params: album, artist' },
      { status: 400 },
    );
  }
  if (album.length > 200 || artist.length > 200) {
    return NextResponse.json({ error: 'Params too long' }, { status: 400 });
  }

  const key = `${artist}::${album}`.toLowerCase();
  if (cache.has(key)) {
    return NextResponse.json({ listings: cache.get(key) });
  }

  let listings: AlbumListings | null;
  try {
    listings = await fetchAlbumListings(album, artist);
  } catch (err) {
    console.error('album listings failed:', String(err));
    // Don't cache transient failures; let the next request retry.
    return NextResponse.json({ listings: null }, { status: 200 });
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, listings);
  return NextResponse.json({ listings });
}
