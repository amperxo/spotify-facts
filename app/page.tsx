'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';

// Three.js must not run on the server
const AudioVisualizer = dynamic(() => import('@/components/AudioVisualizer'), { ssr: false });

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  duration: number;
  progress: number;
  isPlaying: boolean;
  tempo: number;
  energy: number;
}

interface FactResult {
  fact: string;
  source: 'Wikipedia' | 'none';
  confidence: 'high' | 'medium' | 'low';
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ── Color extraction from album art ──────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [h * 360, s, l];
}

function extractDominantColors(img: HTMLImageElement, count = 3): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = 24; canvas.height = 24;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 24, 24);
  const { data } = ctx.getImageData(0, 0, 24, 24);

  const pixels: { h: number; s: number; l: number; score: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l < 0.1 || l > 0.9 || s < 0.15) continue;
    const score = s * (1 - Math.abs(l - 0.45) * 2);
    pixels.push({ h, s, l, score });
  }
  pixels.sort((a, b) => b.score - a.score);

  const selected: typeof pixels = [];
  for (const px of pixels) {
    const distinct = selected.every(c => Math.min(Math.abs(c.h - px.h), 360 - Math.abs(c.h - px.h)) > 35);
    if (distinct) { selected.push(px); if (selected.length >= count) break; }
  }

  const fallbacks = ['#1DB954', '#4e9af1', '#f7931e'];
  while (selected.length < count) selected.push({ h: 0, s: 0, l: 0, score: -1 });

  return selected.map((px, i) => {
    if (px.score < 0) return fallbacks[i];
    const s = Math.min(px.s * 100, 85);
    const l = Math.min(Math.max(px.l * 100, 30), 65);
    return `hsl(${px.h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
  });
}

// ── Static dark background for non-player screens ─────────────────────────────

function DarkBg() {
  return <div className="fixed inset-0 -z-10 bg-[#080808]" />;
}

// ── Sub-components ──────────────────────────────────��─────────────────────────

function LoginScreen({ error }: { error: string | null }) {
  return (
    <>
      <DarkBg />
      <main className="flex flex-col items-center justify-center min-h-screen gap-6">
        <div className="flex flex-col items-center gap-2">
          <SpotifyIcon className="w-12 h-12 text-[#1DB954]" />
          <h1 className="text-2xl font-semibold tracking-tight">Spotify Facts</h1>
          <p className="text-sm text-white/50">Sign in to see what&apos;s playing</p>
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">
            {errorMessage(error)}
          </p>
        )}
        <a
          href="/api/auth/login"
          className="flex items-center gap-3 bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold px-6 py-3 rounded-full transition-colors"
        >
          <SpotifyIcon className="w-5 h-5" />
          Sign in with Spotify
        </a>
      </main>
    </>
  );
}

function LoadingScreen() {
  return (
    <>
      <DarkBg />
      <main className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
      </main>
    </>
  );
}

function NothingPlaying() {
  return (
    <>
      <DarkBg />
      <main className="flex flex-col items-center justify-center min-h-screen gap-3">
        <SpotifyIcon className="w-10 h-10 text-white/20" />
        <p className="text-white/40 text-sm">Nothing playing right now</p>
        <a href="/api/auth/logout" className="text-xs text-white/20 hover:text-white/40 transition-colors mt-4">
          Sign out
        </a>
      </main>
    </>
  );
}

function FactCard({ fact, status }: { fact: FactResult | null; status: 'loading' | 'ready' | 'error' }) {
  if (status === 'loading') {
    return (
      <div className="rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 px-5 py-4">
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <div className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white/70 animate-spin shrink-0" />
          Looking up something interesting…
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 px-5 py-4">
        <p className="text-white/30 text-sm">Couldn&apos;t load a fact this time.</p>
      </div>
    );
  }
  if (!fact || fact.confidence === 'low' || !fact.fact) {
    return (
      <div className="rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 px-5 py-4">
        <p className="text-white/30 text-sm italic">No fun fact for this one.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 px-5 py-4 space-y-3">
      <p className="text-sm text-white/90 leading-relaxed">{fact.fact}</p>
      <p className="text-xs text-white/30">via {fact.source}</p>
    </div>
  );
}

function PlayerCard({ track }: { track: Track }) {
  const [localProgress, setLocalProgress] = useState(track.progress);
  const [fact, setFact]         = useState<FactResult | null>(null);
  const [factStatus, setFactStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bgColors, setBgColors] = useState(['#1DB954', '#4e9af1', '#f7931e']);
  const lastFetchedId = useRef<string | null>(null);

  // Sync progress on poll
  useEffect(() => { setLocalProgress(track.progress); }, [track.id, track.progress]);

  // Local progress tick
  useEffect(() => {
    if (!track.isPlaying) return;
    const t = setInterval(() => setLocalProgress(p => Math.min(p + 1000, track.duration)), 1000);
    return () => clearInterval(t);
  }, [track.isPlaying, track.duration]);

  // Extract album art colors for visualizer
  useEffect(() => {
    if (!track.albumArt) return;
    const proxyUrl = `/_next/image?url=${encodeURIComponent(track.albumArt)}&w=64&q=75`;
    const img = new window.Image();
    img.onload = () => {
      try { setBgColors(extractDominantColors(img)); } catch { /* keep defaults */ }
    };
    img.src = proxyUrl;
  }, [track.albumArt]);

  // Fetch fact once per track
  useEffect(() => {
    if (lastFetchedId.current === track.id) return;
    lastFetchedId.current = track.id;
    setFact(null);
    setFactStatus('loading');
    const params = new URLSearchParams({ trackId: track.id, track: track.name, artist: track.artist });
    fetch(`/api/fact?${params}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: FactResult) => { setFact(d); setFactStatus('ready'); })
      .catch(() => setFactStatus('error'));
  }, [track.id, track.name, track.artist]);

  const progressPct = Math.min((localProgress / track.duration) * 100, 100);

  return (
    <>
      <AudioVisualizer colors={bgColors} isPlaying={track.isPlaying} tempo={track.tempo} energy={track.energy} />

      <main className="flex items-center justify-center min-h-screen px-6 py-12">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 w-full max-w-3xl">

          {/* Left: player card */}
          <div className="w-full max-w-sm shrink-0">
            <div className="w-full aspect-square rounded-2xl overflow-hidden bg-white/5 mb-6 shadow-2xl ring-1 ring-white/10">
              {track.albumArt ? (
                <Image src={track.albumArt} alt={`${track.album} cover`} width={500} height={500}
                  className="w-full h-full object-cover" priority />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <SpotifyIcon className="w-16 h-16 text-white/10" />
                </div>
              )}
            </div>

            <div className="flex items-start justify-between mb-5">
              <div className="min-w-0 flex-1 pr-3">
                <h2 className="text-xl font-bold truncate">{track.name}</h2>
                <p className="text-white/60 text-sm truncate mt-0.5">{track.artist}</p>
              </div>
              <PlayingIndicator isPlaying={track.isPlaying} />
            </div>

            <div className="space-y-2">
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-white/40 tabular-nums">
                <span>{formatMs(localProgress)}</span>
                <span>{formatMs(track.duration)}</span>
              </div>
            </div>

            <div className="mt-8 text-center">
              <a href="/api/auth/logout" className="text-xs text-white/20 hover:text-white/40 transition-colors">
                Sign out
              </a>
            </div>
          </div>

          {/* Right: fact */}
          <div className="w-full md:flex-1 md:pt-2">
            <FactCard fact={fact} status={factStatus} />
          </div>

        </div>
      </main>
    </>
  );
}

function PlayingIndicator({ isPlaying }: { isPlaying: boolean }) {
  if (!isPlaying) return <span className="text-xs text-white/30 mt-1 shrink-0">Paused</span>;
  return (
    <div className="flex items-end gap-[3px] h-5 mt-1 shrink-0" aria-label="Now playing">
      {[0, 150, 300].map(delay => (
        <span key={delay} className="w-[3px] bg-[#1DB954] rounded-full animate-pulse"
          style={{ height: '100%', animationDelay: `${delay}ms`, animationDuration: '900ms' }} />
      ))}
    </div>
  );
}

function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function errorMessage(code: string): string {
  const msgs: Record<string, string> = {
    access_denied: 'Spotify access was denied.',
    invalid_callback: 'Something went wrong during sign-in. Please try again.',
    token_exchange_failed: 'Could not complete sign-in. Please try again.',
  };
  return msgs[code] ?? 'An unexpected error occurred.';
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [track, setTrack]       = useState<Track | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'authenticated'>('loading');
  const [errorParam, setErrorParam] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNowPlaying = useCallback(async () => {
    try {
      const res = await fetch('/api/now-playing');
      if (res.status === 401) {
        setAuthState('unauthenticated');
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      const data = await res.json();
      setAuthState('authenticated');
      setTrack(data.playing ? data.track : null);
    } catch { /* keep current state, retry next poll */ }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) {
      setErrorParam(err);
      setAuthState('unauthenticated');
      window.history.replaceState({}, '', '/');
      return;
    }
    fetchNowPlaying();
    intervalRef.current = setInterval(fetchNowPlaying, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNowPlaying]);

  if (authState === 'loading')         return <LoadingScreen />;
  if (authState === 'unauthenticated') return <LoginScreen error={errorParam} />;
  if (!track)                          return <NothingPlaying />;
  return <PlayerCard track={track} />;
}
