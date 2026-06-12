'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

// ── Per-song motion seed ──────────────────────────────────────────────────────

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface CoverLayer {
  key: string;
  url: string;
}

// Inverse of a 3×3 matrix (rows). Used to solve the image→triangle affine.
function inv3(m: number[][]): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const id = 1 / (a * A + b * B + c * C);
  return [
    [A * id, (c * h - b * i) * id, (b * f - c * e) * id],
    [B * id, (a * i - c * g) * id, (c * d - a * f) * id],
    [C * id, (b * g - a * h) * id, (a * e - b * d) * id],
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AudioVisualizer({
  albumArt,
  coverSrc,
  coverReady,
  colors,
  isPlaying,
  seed,
}: {
  albumArt: string | null;
  coverSrc?: string | null;
  coverReady?: boolean; // hi-res lookup finished — build the kaleidoscope once, no mid-song swap
  colors: string[];
  isPlaying: boolean;
  seed: string;
}) {
  const [layers, setLayers] = useState<CoverLayer[]>([]);
  useEffect(() => {
    if (!albumArt) return;
    setLayers((prev) => {
      if (prev[prev.length - 1]?.url === albumArt) return prev;
      return [...prev, { key: `${seed}:${albumArt}`, url: albumArt }].slice(-2);
    });
  }, [albumArt, seed]);

  const h = hashSeed(seed || 'default');
  const panX = ((h & 0xff) / 255 - 0.5) * 7;
  const panY = (((h >> 8) & 0xff) / 255 - 0.5) * 7;
  const duration = 30 + ((h >> 16) & 0x0f);
  const rotDir = h & 1 ? 1 : -1;

  const [c1 = '#1DB954', c2 = '#4e9af1'] = colors;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fadeRef = useRef(0);
  const animRef = useRef({ isPlaying, rotDir });
  useEffect(() => {
    animRef.current = { isPlaying, rotDir };
  }, [isPlaying, rotDir]);

  useEffect(() => {
    // Blank the kaleidoscope (backdrop shows) until the FINAL source is decided,
    // so we never render the Spotify cover and then swap to a different Apple one.
    imgRef.current = null;
    if (coverReady === false) return;
    const src = coverSrc ?? albumArt;
    if (!src) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return; // a newer track/source superseded this load
      imgRef.current = img;
      fadeRef.current = 0;
    };
    img.src = `/_next/image?url=${encodeURIComponent(src)}&w=1920&q=75`;
    return () => { cancelled = true; };
  }, [coverReady, coverSrc, albumArt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let lastTs = 0;
    let t = 0;
    let W = 0;
    let H = 0;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      ctx!.imageSmoothingQuality = 'high';
    }

    function frame(ts: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      const { isPlaying, rotDir } = animRef.current;
      if (isPlaying) t += dt;

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);

      const img = imgRef.current;
      if (!img) return;
      const fade = Math.min(1, fadeRef.current + dt / 0.8);
      fadeRef.current = fade;

      // Fundamental triangle in IMAGE space (equilateral), rotating + drifting so
      // the reflected pattern slowly evolves like a turning kaleidoscope.
      const iw = img.width;
      const ih = img.height;
      const cx = iw / 2 + Math.sin(t * 0.11) * iw * 0.08;
      const cy = ih / 2 + Math.cos(t * 0.09) * ih * 0.08;
      const rho = Math.min(iw, ih) * 0.3;
      const th = t * 0.08 * rotDir;
      const V = [0, 1, 2].map((k) => {
        const a = th + (k * 2 * Math.PI) / 3;
        return [cx + rho * Math.cos(a), cy + rho * Math.sin(a)];
      });
      const Sinv = inv3([
        [V[0][0], V[1][0], V[2][0]],
        [V[0][1], V[1][1], V[2][1]],
        [1, 1, 1],
      ]);

      // Screen triangular lattice. Basis e1=(L,0), e2=(L/2, L·√3/2).
      const L = Math.min(W, H) * 0.15;
      const hy = (L * Math.sqrt(3)) / 2;
      const vpos = (a: number, b: number): [number, number] => [a * L + b * (L / 2), b * hy];
      const colorOf = (a: number, b: number) => (((a - b) % 3) + 3) % 3;

      // Affine mapping the image (fundamental triangle V) onto screen pts P,
      // ordered by vertex colour so shared edges map to identical image points.
      const drawTri = (cells: [number, number][]) => {
        const pts = cells.map(([a, b]) => vpos(a, b));
        const minx = Math.min(pts[0][0], pts[1][0], pts[2][0]);
        const maxx = Math.max(pts[0][0], pts[1][0], pts[2][0]);
        const miny = Math.min(pts[0][1], pts[1][1], pts[2][1]);
        const maxy = Math.max(pts[0][1], pts[1][1], pts[2][1]);
        if (maxx < 0 || minx > W || maxy < 0 || miny > H) return;

        const P: ([number, number] | null)[] = [null, null, null];
        cells.forEach(([a, b], k) => { P[colorOf(a, b)] = pts[k]; });
        const P0 = P[0]!, P1 = P[1]!, P2 = P[2]!;
        const Px = [P0[0], P1[0], P2[0]];
        const Py = [P0[1], P1[1], P2[1]];
        const m = (row: number[], col: number) =>
          row[0] * Sinv[0][col] + row[1] * Sinv[1][col] + row[2] * Sinv[2][col];

        ctx!.save();
        ctx!.beginPath();
        ctx!.moveTo(pts[0][0], pts[0][1]);
        ctx!.lineTo(pts[1][0], pts[1][1]);
        ctx!.lineTo(pts[2][0], pts[2][1]);
        ctx!.closePath();
        ctx!.clip();
        // image→screen affine, pre-multiplied by dpr for the device buffer
        ctx!.setTransform(
          m(Px, 0) * dpr, m(Py, 0) * dpr,
          m(Px, 1) * dpr, m(Py, 1) * dpr,
          m(Px, 2) * dpr, m(Py, 2) * dpr,
        );
        ctx!.globalAlpha = fade;
        ctx!.drawImage(img, 0, 0);
        ctx!.restore();
      };

      const rows = Math.ceil(H / hy) + 2;
      const cols = Math.ceil(W / L) + 2;
      for (let b = -1; b < rows; b++) {
        for (let a = -Math.ceil(rows / 2) - 1; a < cols; a++) {
          drawTri([[a, b], [a + 1, b], [a, b + 1]]);        // up triangle
          drawTri([[a + 1, b], [a + 1, b + 1], [a, b + 1]]); // down triangle
        }
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.globalAlpha = 1;
    }

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#080808]">
      {layers.map((layer) => (
        <div
          key={layer.key}
          className="absolute inset-0"
          style={{ animation: 'ambient-fade 1.2s ease-out forwards' }}
        >
          <div
            className="absolute inset-0"
            style={{
              animation: `ambient-pan ${duration}s ease-in-out infinite alternate`,
              animationPlayState: isPlaying ? 'running' : 'paused',
              ['--pan-x' as string]: `${panX}%`,
              ['--pan-y' as string]: `${panY}%`,
            }}
          >
            <Image src={layer.url} alt="" fill sizes="100vw" className="object-cover blur-3xl scale-110" />
          </div>
        </div>
      ))}

      {/* Seamless triangular (p6m) kaleidoscope */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ filter: 'saturate(1.2) contrast(1.06)' }}
      />

      <div
        className="absolute inset-0 mix-blend-soft-light opacity-40"
        style={{ background: `radial-gradient(70% 60% at 50% 50%, ${c1}, ${c2} 60%, transparent 80%)` }}
      />
      <div className="absolute inset-0 bg-black/45" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 100% at 50% 45%, transparent 0%, rgba(0,0,0,0.62) 100%)' }}
      />
      <div
        className="absolute inset-0 bg-black transition-opacity duration-700"
        style={{ opacity: isPlaying ? 0 : 0.25 }}
      />
    </div>
  );
}
