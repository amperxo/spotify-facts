import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchAlbumStyle } from '@/lib/discogs';
import { buildGenreTree, type GenreTree } from '@/lib/genres';

// Cache the resolved lineage per album. Capped to bound memory.
const cache = new Map<string, GenreTree | null>();
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
    return NextResponse.json({ tree: cache.get(key) });
  }

  let tree: GenreTree | null = null;
  try {
    const style = await fetchAlbumStyle(album, artist);
    tree = style ? await buildGenreTree(style) : null;
  } catch {
    return NextResponse.json({ tree: null }, { status: 200 }); // don't cache failures
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, tree);
  return NextResponse.json({ tree });
}
