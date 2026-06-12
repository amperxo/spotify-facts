const DISCOGS_API = 'https://api.discogs.com';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;

// Discogs requires a descriptive User-Agent or it throttles/blocks you.
// The token is only needed for /database/search; marketplace stats are public.
const HEADERS: Record<string, string> = {
  'User-Agent': 'SpotifyFacts/1.0 (+music-facts-personal-app)',
  Accept: 'application/json',
  ...(DISCOGS_TOKEN ? { Authorization: `Discogs token=${DISCOGS_TOKEN}` } : {}),
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlbumListings {
  releaseId: number;
  title: string;          // Discogs release title, e.g. "Artist - Album"
  year: number | null;    // pressing year of this specific release
  coverImage: string | null;
  format: string | null;  // e.g. "Vinyl · LP"
  country: string | null;
  numForSale: number;
  lowestPrice: number | null;
  currency: string;       // ISO code, e.g. "USD"
  have: number;           // how many collectors own this release
  want: number;           // how many collectors want it (demand)
  url: string;            // public marketplace page for this release
}

// ── API helper ────────────────────────────────────────────────────────────────

async function discogsFetch(path: string): Promise<unknown> {
  const res = await fetch(`${DISCOGS_API}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Discogs ${res.status}: ${path}`);
  return res.json();
}

// ── Step 1: resolve the best-matching release id ──────────────────────────────

interface SearchResult {
  id: number;
  title?: string;
  year?: string | number;
  country?: string;
  format?: string[];
  thumb?: string;
  cover_image?: string;
  community?: { have?: number; want?: number };
}

// Discogs lists every format facet ("Vinyl, LP, Album, Stereo"); keep the medium
// and its size/speed descriptor, drop generic filler, and show at most two.
const FORMAT_FILLER = new Set(['album', 'stereo', 'mono', 'reissue', 'remastered', 'repress']);

function formatLabel(format: string[] | undefined): string | null {
  if (!format?.length) return null;
  const parts = format.filter((f) => !FORMAT_FILLER.has(f.toLowerCase())).slice(0, 2);
  return (parts.length ? parts : format.slice(0, 1)).join(' · ');
}

// Spotify appends reissue/edition tags ("Help! (Remastered)", "Album - Deluxe
// Edition") that Discogs titles don't carry, which makes the search miss. Strip
// them so the album actually matches a Discogs release.
const EDITION_KEYWORDS =
  'remaster|remastered|deluxe|expanded|edition|version|anniversary|mono|stereo|bonus|reissue|remix';

function cleanAlbumTitle(title: string): string {
  return title
    // drop "(... remaster/edition/version ...)" or "[...]" parentheticals
    .replace(new RegExp(`\\s*[([][^)\\]]*\\b(?:${EDITION_KEYWORDS})\\b[^)\\]]*[)\\]]`, 'gi'), '')
    // drop a trailing "- ... remaster/edition/version ..." dash segment
    .replace(new RegExp(`\\s*-\\s*[^-]*\\b(?:${EDITION_KEYWORDS})\\b.*$`, 'i'), '')
    .trim();
}

// Search requires a token. Returns the most-collected matching release, which is
// the most likely the canonical pressing people actually buy/sell.
async function searchRelease(
  album: string,
  artist: string,
): Promise<SearchResult | null> {
  if (!DISCOGS_TOKEN) return null; // search is unavailable without auth

  const params = new URLSearchParams({
    type: 'release',
    release_title: cleanAlbumTitle(album) || album,
    artist,
    per_page: '10',
  });
  const data = (await discogsFetch(`/database/search?${params}`)) as {
    results?: SearchResult[];
  };

  const results = data.results ?? [];
  if (results.length === 0) return null;

  // Prefer the release the most Discogs users own — the canonical pressing.
  results.sort((a, b) => (b.community?.have ?? 0) - (a.community?.have ?? 0));
  return results[0];
}

// ── Step 2: fetch public marketplace stats for a release ──────────────────────

interface MarketStats {
  num_for_sale?: number;
  lowest_price?: { value: number; currency: string } | null;
}

async function fetchStats(releaseId: number): Promise<MarketStats | null> {
  try {
    return (await discogsFetch(
      `/marketplace/stats/${releaseId}?curr_abbr=USD`,
    )) as MarketStats;
  } catch {
    return null; // stats can 404 for releases blocked from sale
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function parseYear(year: string | number | undefined): number | null {
  const n = typeof year === 'string' ? parseInt(year, 10) : year;
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

// Returns null when no release matches or the token is missing — callers should
// degrade gracefully and simply hide the album card.
export async function fetchAlbumListings(
  album: string,
  artist: string,
): Promise<AlbumListings | null> {
  const match = await searchRelease(album, artist);
  if (!match) return null;

  const stats = await fetchStats(match.id);
  const numForSale = stats?.num_for_sale ?? 0;

  // Nothing for sale and no listing data — not worth showing a card.
  if (numForSale === 0) return null;

  return {
    releaseId: match.id,
    title: match.title ?? album,
    year: parseYear(match.year),
    coverImage: match.cover_image ?? match.thumb ?? null,
    format: formatLabel(match.format),
    country: match.country ?? null,
    numForSale,
    lowestPrice: stats?.lowest_price?.value ?? null,
    currency: stats?.lowest_price?.currency ?? 'USD',
    have: match.community?.have ?? 0,
    want: match.community?.want ?? 0,
    url: `https://www.discogs.com/sell/release/${match.id}`,
  };
}
