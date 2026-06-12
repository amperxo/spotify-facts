const ITUNES_SEARCH = 'https://itunes.apple.com/search';

// Spotify album art maxes out at 640px, which looks blurry stretched across a
// full-screen kaleidoscope. Apple's artwork CDN serves arbitrary sizes for the
// same albums (free, no key), so we look up a high-resolution cover from there.

interface ITunesResult {
  artworkUrl100?: string;
}

interface ITunesResponse {
  results?: ITunesResult[];
}

// Strip reissue/edition noise so the album search matches.
function cleanAlbum(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|mono|stereo|version)\b[^)\]]*[)\]]/gi, '')
    .trim();
}

export async function fetchHiResCover(album: string, artist: string): Promise<string | null> {
  const term = `${artist} ${cleanAlbum(album)}`.trim();
  const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(term)}&entity=album&limit=1`;

  let data: ITunesResponse | null = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SpotifyFacts/1.0' } });
    if (!res.ok) return null;
    data = (await res.json()) as ITunesResponse;
  } catch {
    return null;
  }

  const art = data?.results?.[0]?.artworkUrl100;
  if (!art) return null;

  // Apple resizes on the fly: swap the 100x100 segment for a large one.
  return art.replace(/\/100x100bb\.(jpg|png)/i, '/2000x2000bb.$1');
}
