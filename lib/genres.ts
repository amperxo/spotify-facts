const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'SpotifyFacts/1.0 (music-facts-app)' };

const MAX_PARENTS = 5;
const MAX_GRANDPARENTS = 5;

export interface GenreNode {
  name: string;
  year: string | null; // e.g. "Late 1980s"
}

export interface GenreTree {
  current: GenreNode;
  parents: GenreNode[];
  grandparents: GenreNode[];
}

interface GenreInfo {
  title: string;       // redirect-resolved Wikipedia title
  year: string | null; // decade from cultural_origins
  parents: string[];   // stylistic_origins genre names
}

// Pull a single infobox field's raw value (handles single- or multi-line).
function field(wikitext: string, name: string): string | null {
  const m = wikitext.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*[|}])`, 'i'));
  return m ? m[1].trim() : null;
}

function links(value: string): string[] {
  const out = [...value.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(out)];
}

function decade(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(?:(?:early|mid|late)[\s-]*)?(?:\d{4}s|\d{4})/i);
  return m ? m[0].trim() : null;
}

// Fetch a genre's Wikipedia lead-section infobox and extract its stylistic
// origins (parent genres) and a decade. Returns null if there's no usable page.
async function fetchGenreInfo(title: string): Promise<GenreInfo | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    rvsection: '0',
    titles: title,
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  let wikitext: string | undefined;
  let resolved = title;
  try {
    const res = await fetch(`${WIKI_API}?${params}`, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const page = data?.query?.pages?.[0];
    resolved = page?.title ?? title;
    wikitext = page?.revisions?.[0]?.slots?.main?.content;
  } catch {
    return null;
  }
  if (!wikitext) return null;

  // Drop citations so their links don't leak into the genre lists.
  wikitext = wikitext.replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/gi, '');

  const origins = field(wikitext, 'stylistic_origins');
  return {
    title: resolved,
    year: decade(field(wikitext, 'cultural_origins')),
    parents: origins ? links(origins) : [],
  };
}

// Build a 3-tier lineage (current → parents → grandparents) from a starting
// subgenre. Returns null if the genre has no Wikipedia infobox at all.
export async function buildGenreTree(style: string): Promise<GenreTree | null> {
  const current = await fetchGenreInfo(style);
  if (!current) return null;

  const parentInfos = await Promise.all(
    current.parents.slice(0, MAX_PARENTS).map((p) => fetchGenreInfo(p)),
  );
  const parents: GenreNode[] = parentInfos
    .filter((p): p is GenreInfo => p !== null)
    .map((p) => ({ name: p.title, year: p.year }));

  // Grandparents = the parents' stylistic origins, deduped and minus anything
  // already shown lower in the tree.
  const seen = new Set([current.title.toLowerCase(), ...parents.map((p) => p.name.toLowerCase())]);
  const gpNames: string[] = [];
  for (const p of parentInfos) {
    if (!p) continue;
    for (const gp of p.parents) {
      const key = gp.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        gpNames.push(gp);
      }
    }
  }
  const gpInfos = await Promise.all(gpNames.slice(0, MAX_GRANDPARENTS).map((g) => fetchGenreInfo(g)));
  const grandparents: GenreNode[] = gpInfos
    .filter((g): g is GenreInfo => g !== null)
    .map((g) => ({ name: g.title, year: g.year }));

  return {
    current: { name: current.title, year: current.year },
    parents,
    grandparents,
  };
}
