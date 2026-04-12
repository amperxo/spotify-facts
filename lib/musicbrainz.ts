const MB = 'https://musicbrainz.org/ws/2';

// MusicBrainz requires a descriptive User-Agent or they throttle you
const HEADERS = {
  'User-Agent': 'SpotifyFacts/1.0 (music-facts-personal-app)',
  Accept: 'application/json',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Credit {
  name: string;
  role: string; // e.g. "Songwriter", "Producer", "Electric guitar", "Vocals"
}

export interface MBCredits {
  credits: Credit[];
}

// ── Role mapping ──────────────────────────────────────────────────────────────

// Relationship types we actually care about surfacing in facts
const ALLOWED_TYPES = new Set([
  'composer', 'lyricist', 'writer', 'producer', 'co-producer',
  'instrument', 'vocal', 'performer', 'arranger', 'orchestrator',
]);

function buildRole(type: string, attributes: string[]): string {
  const labelMap: Record<string, string> = {
    composer:      'Songwriter',
    lyricist:      'Lyricist',
    writer:        'Songwriter',
    producer:      'Producer',
    'co-producer': 'Producer',
    arranger:      'Arranger',
    orchestrator:  'Orchestrator',
    vocal:         attributes.length ? capitalise(attributes[0]) : 'Vocals',
    performer:     'Performer',
  };

  if (type === 'instrument') {
    return attributes.length ? capitalise(attributes[0]) : 'Musician';
  }
  return labelMap[type] ?? capitalise(type);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function mbFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}: ${url}`);
  return res.json();
}

// ── Step 1: find the recording MBID ──────────────────────────────────────────

async function searchRecordingMbid(
  trackName: string,
  artistName: string,
): Promise<string | null> {
  const q = encodeURIComponent(`recording:"${trackName}" AND artist:"${artistName}"`);
  const data = await mbFetch(`${MB}/recording/?query=${q}&fmt=json&limit=3`) as {
    recordings?: { id: string; score: number }[];
  };

  const recordings = data.recordings ?? [];
  // Take the highest-scoring result (MusicBrainz returns 0–100 relevance score)
  recordings.sort((a, b) => b.score - a.score);
  return recordings[0]?.id ?? null;
}

// ── Step 2: fetch recording relationships + linked work ───────────────────────

interface MBRelation {
  type: string;
  attributes: string[];
  artist?: { name: string; id: string };
  work?: { id: string };
}

async function fetchRecordingCredits(mbid: string): Promise<{ credits: Credit[]; workId: string | null }> {
  const data = await mbFetch(
    `${MB}/recording/${mbid}?inc=artist-rels+work-rels&fmt=json`,
  ) as { relations?: MBRelation[] };

  const credits: Credit[] = [];
  let workId: string | null = null;

  for (const rel of data.relations ?? []) {
    if (rel.type === 'performance' && rel.work?.id) {
      workId = rel.work.id;
      continue;
    }
    if (!ALLOWED_TYPES.has(rel.type) || !rel.artist) continue;
    credits.push({ name: rel.artist.name, role: buildRole(rel.type, rel.attributes) });
  }

  return { credits, workId };
}

// ── Step 3: fetch work relationships (composer, lyricist) ─────────────────────

async function fetchWorkCredits(workId: string): Promise<Credit[]> {
  const data = await mbFetch(
    `${MB}/work/${workId}?inc=artist-rels&fmt=json`,
  ) as { relations?: MBRelation[] };

  const credits: Credit[] = [];
  for (const rel of data.relations ?? []) {
    if (!ALLOWED_TYPES.has(rel.type) || !rel.artist) continue;
    credits.push({ name: rel.artist.name, role: buildRole(rel.type, rel.attributes) });
  }
  return credits;
}

// ── Dedup helper ──────────────────────────────────────────────────────────────

function dedup(credits: Credit[]): Credit[] {
  const seen = new Set<string>();
  return credits.filter(c => {
    const key = `${c.name}::${c.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchMBCredits(
  trackName: string,
  artistName: string,
): Promise<MBCredits> {
  const mbid = await searchRecordingMbid(trackName, artistName);
  if (!mbid) return { credits: [] };

  const { credits: recCredits, workId } = await fetchRecordingCredits(mbid);

  const workCredits = workId ? await fetchWorkCredits(workId) : [];

  // Work credits first (songwriter/lyricist), then recording credits
  const all = dedup([...workCredits, ...recCredits]);

  return { credits: all };
}

// ── Format for prompt ─────────────────────────────────────────────────────────

// Groups credits by role and formats them as readable text for the Gemini prompt.
export function formatCreditsForPrompt(mb: MBCredits): string {
  if (mb.credits.length === 0) return '';

  // Group by role
  const byRole = new Map<string, string[]>();
  for (const { name, role } of mb.credits) {
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(name);
  }

  const lines: string[] = [];
  for (const [role, names] of byRole) {
    lines.push(`${role}: ${names.join(', ')}`);
  }

  return lines.join('\n');
}
