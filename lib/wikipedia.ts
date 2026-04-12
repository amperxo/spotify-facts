// Artist gets more budget (biography is rich); song gets more too so Background/
// Writing/Recording sections — where personal stories live — aren't cut off.
const ARTIST_CHAR_LIMIT = 3000;
const SONG_CHAR_LIMIT   = 4000;

interface WikiExtract {
  title: string;
  extract: string;
}

// Search Wikipedia and return the full article text of the top result.
// We intentionally skip exintro so we include Background, Writing, Recording,
// and Personnel sections — that's where personal stories and origin details live.
async function fetchExtract(query: string, charLimit: number): Promise<WikiExtract | null> {
  // Step 1: search for the best matching article title
  const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srsearch', query);
  searchUrl.searchParams.set('srlimit', '1');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('origin', '*');

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const title: string | undefined = searchData.query?.search?.[0]?.title;
  if (!title) return null;

  // Step 2: fetch the full plain-text extract (all sections, not just intro)
  const extractUrl = new URL('https://en.wikipedia.org/w/api.php');
  extractUrl.searchParams.set('action', 'query');
  extractUrl.searchParams.set('titles', title);
  extractUrl.searchParams.set('prop', 'extracts');
  // No exintro — we want Background / Writing / Recording sections too
  extractUrl.searchParams.set('explaintext', 'true');
  extractUrl.searchParams.set('exsectionformat', 'plain');
  extractUrl.searchParams.set('redirects', '1');
  extractUrl.searchParams.set('format', 'json');
  extractUrl.searchParams.set('origin', '*');

  const extractRes = await fetch(extractUrl.toString());
  if (!extractRes.ok) return null;
  const extractData = await extractRes.json();

  const pages = extractData.query?.pages ?? {};
  const page = Object.values(pages)[0] as { title?: string; extract?: string };
  const extract = page?.extract?.trim();
  if (!extract || extract.length < 50) return null;

  return {
    title: page.title ?? title,
    extract: extract.slice(0, charLimit),
  };
}

export interface WikiSources {
  artist: WikiExtract | null;
  song: WikiExtract | null;
}

// Fetch Wikipedia context for a track. Runs both lookups in parallel.
export async function fetchWikiSources(
  trackName: string,
  artistName: string
): Promise<WikiSources> {
  const [artist, song] = await Promise.all([
    fetchExtract(artistName, ARTIST_CHAR_LIMIT),
    fetchExtract(`${trackName} ${artistName} song`, SONG_CHAR_LIMIT).then(
      (result) => result ?? fetchExtract(`${trackName} song`, SONG_CHAR_LIMIT)
    ),
  ]);

  return { artist, song };
}
