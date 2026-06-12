import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchHiResCover } from '@/lib/itunes';

// Cache the resolved hi-res URL per album. Capped to bound memory.
const cache = new Map<string, string | null>();
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
    return NextResponse.json({ error: 'Missing album or artist' }, { status: 400 });
  }
  if (album.length > 200 || artist.length > 200) {
    return NextResponse.json({ error: 'Params too long' }, { status: 400 });
  }

  const key = `${artist}::${album}`.toLowerCase();
  if (cache.has(key)) {
    return NextResponse.json({ url: cache.get(key) });
  }

  let url: string | null;
  try {
    url = await fetchHiResCover(album, artist);
  } catch {
    return NextResponse.json({ url: null }, { status: 200 }); // don't cache failures
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return NextResponse.json({ url });
}
