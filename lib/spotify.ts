const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;
const SCOPES = 'user-read-currently-playing user-read-playback-state';

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64url(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

// ── Auth URLs ─────────────────────────────────────────────────────────────────

export function buildAuthUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    scope: SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ── Spotify API calls ─────────────────────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  duration: number;
  progress: number;
  isPlaying: boolean;
  tempo: number;    // BPM from audio features, default 120 if unavailable
  energy: number;   // 0–1 from audio features, default 0.7
}

export interface AudioFeatures {
  tempo: number;
  energy: number;
}

export async function fetchAudioFeatures(
  trackId: string,
  accessToken: string
): Promise<AudioFeatures | null> {
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.tempo) return null;
  return { tempo: data.tempo, energy: data.energy ?? 0.7 };
}

// Returns null when nothing is playing (204 from Spotify).
export async function fetchCurrentlyPlaying(
  accessToken: string
): Promise<SpotifyTrack | null> {
  const res = await fetch(
    'https://api.spotify.com/v1/me/player/currently-playing',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 204) return null; // nothing playing
  if (res.status === 401) throw new Error('SPOTIFY_401');
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);

  const data = await res.json();

  // Spotify returns 200 but no item when a podcast ad is playing, etc.
  if (!data?.item) return null;

  return {
    id: data.item.id,
    name: data.item.name,
    artist: data.item.artists?.map((a: { name: string }) => a.name).join(', ') ?? '',
    album: data.item.album?.name ?? '',
    albumArt: data.item.album?.images?.[0]?.url ?? null,
    duration: data.item.duration_ms,
    progress: data.progress_ms ?? 0,
    isPlaying: data.is_playing,
    tempo: 120,   // filled in by now-playing route after audio-features fetch
    energy: 0.7,
  };
}
