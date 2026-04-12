'use client';

import { useEffect, useRef } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

const BAR_COUNT   = 128;
const TILT        = 0.30;   // vertical compression of the ring (3D tilt illusion)
const DEPTH_SCALE = 0.35;   // back bars are this much smaller than front bars
const BASE_W      = 2.6;    // bar stroke width at front

// Particle field
const PARTICLE_COUNT = 70;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  opacity: number;
  colorIndex: number;
}

// ── Frequency simulation ──────────────────────────────────────────────────────

function simulateFreq(time: number, i: number, isPlaying: boolean, bpm: number, energy: number): number {
  if (!isPlaying) {
    return 0.025 + Math.sin(time * 0.8 + i * 0.22) * 0.012 + 0.012;
  }
  const t = i / BAR_COUNT;

  // Beat pulse: exponential decay envelope locked to real BPM.
  // beatPhase 0→1 each beat; exp(-phase*7) = sharp hit at 0, near-zero by 0.5.
  const beatPhase = (time * (bpm / 60)) % 1;
  const beat      = Math.exp(-beatPhase * 7) * (0.5 + energy * 0.4);

  const bass    = Math.pow(Math.max(0, Math.sin(time * 1.55 + i * 0.06)), 2.5);
  const lowMid  = Math.max(0, Math.sin(time * 2.60 + i * 0.22 + 0.90)) * 0.65;
  const highMid = Math.max(0, Math.sin(time * 4.10 + i * 0.41 + 2.30)) * 0.50;
  const treble  = Math.max(0, Math.sin(time * 7.30 + i * 0.78 + 4.10)) * 0.38;
  const bassW   = Math.pow(1 - t, 1.8);
  const trebleW = Math.pow(t, 1.8);
  const midW    = 1 - bassW - trebleW;
  const spectral = bass * bassW + lowMid * midW * 0.6 + highMid * midW * 0.4 + treble * trebleW;

  // Scale overall amplitude by track energy (quiet ballads sit lower)
  const energyScale = 0.55 + energy * 0.45;
  return Math.min(1, spectral * energyScale + beat * (1 - t * 0.4));
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function parseColor(color: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgba(c: [number, number, number], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AudioVisualizer({ colors, isPlaying, tempo = 120, energy = 0.7 }: { colors: string[]; isPlaying: boolean; tempo?: number; energy?: number }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const stateRef   = useRef({ colors, isPlaying, tempo, energy });
  const heightsRef = useRef(new Float32Array(BAR_COUNT).fill(0.03));
  const timeRef    = useRef(0);
  const rafRef     = useRef<number>(0);
  const rgbRef     = useRef<[number, number, number][]>([
    [29, 185, 84], [78, 154, 241], [247, 147, 30],
  ]);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => { stateRef.current = { colors, isPlaying, tempo, energy }; }, [colors, isPlaying, tempo, energy]);

  useEffect(() => {
    rgbRef.current = stateRef.current.colors.map(parseColor);
  }, [colors]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const el  = canvas as HTMLCanvasElement;
    const ctx = el.getContext('2d')!;
    let lastTs = 0;

    // Initial colour parse
    rgbRef.current = stateRef.current.colors.map(parseColor);

    // Resize
    function resize() {
      el.width  = window.innerWidth;
      el.height = window.innerHeight;
      // Re-scatter particles on resize
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * el.width,
        y: Math.random() * el.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.8 + 0.4,
        opacity: Math.random() * 0.35 + 0.08,
        colorIndex: Math.floor(Math.random() * 3),
      }));
    }
    resize();
    window.addEventListener('resize', resize);

    function draw(ts: number) {
      rafRef.current = requestAnimationFrame(draw);
      const delta = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;
      timeRef.current += delta;
      const T = timeRef.current;

      const { isPlaying, tempo, energy } = stateRef.current;
      const [c1, c2, c3] = rgbRef.current as [[number,number,number],[number,number,number],[number,number,number]];

      const W  = el.width;
      const H  = el.height;
      const cx = W / 2;
      const cy = H / 2 + H * 0.05;
      const radius   = Math.min(W, H) * 0.28;
      const maxBarOut = Math.min(W, H) * 0.26;  // outward bar max
      const maxBarIn  = Math.min(W, H) * 0.16;  // inward bar max

      // ── Background fill ───────────────────────────────────────────────────
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, W, H);

      // ── Aurora: 3 large soft glows using album colours ────────────────────
      const auroraPositions = [
        { x: W * 0.15, y: H * 0.20, c: c1 },
        { x: W * 0.85, y: H * 0.75, c: c2 },
        { x: W * 0.70, y: H * 0.15, c: c3 },
      ];
      const auroraR = Math.max(W, H) * 0.55;

      for (const { x, y, c } of auroraPositions) {
        // Slow drift
        const dx = Math.sin(T * 0.15 + x) * W * 0.04;
        const dy = Math.cos(T * 0.12 + y) * H * 0.04;
        const grad = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, auroraR);
        grad.addColorStop(0,   rgba(c, 0.13));
        grad.addColorStop(0.4, rgba(c, 0.06));
        grad.addColorStop(1,   rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }

      // ── Particles ─────────────────────────────────────────────────────────
      // Beat pulse synced to real BPM — same envelope as simulateFreq
      const beatPhase = (T * (tempo / 60)) % 1;
      const beatPulse = Math.exp(-beatPhase * 7) * (0.5 + energy * 0.4);
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        // Wrap around
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        const pc = [c1, c2, c3][p.colorIndex] ?? c1;
        const pulseOpacity = p.opacity + beatPulse * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + beatPulse * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = rgba(pc, pulseOpacity);
        ctx.fill();
      }

      // ── Build & sort bars ─────────────────────────────────────────────────
      const bars: { angle: number; depth: number; h: number }[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const angle  = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        const target = simulateFreq(T, i, isPlaying, tempo, energy);
        const speed  = isPlaying ? 0.14 : 0.04;
        heightsRef.current[i] += (target - heightsRef.current[i]) * speed;
        const depth = Math.sin(angle); // -1 front, +1 back
        bars.push({ angle, depth, h: heightsRef.current[i] });
      }
      bars.sort((a, b) => b.depth - a.depth); // painter's order

      for (const { angle, depth, h } of bars) {
        const df  = 1 - (depth + 1) * 0.5 * DEPTH_SCALE; // 1.0 front → 0.65 back
        const dim = 0.5 + df * 0.5;

        // Bar base on the ring
        const bx = cx + radius * Math.cos(angle);
        const by = cy + radius * Math.sin(angle) * TILT;

        // Outward tip (grows away from centre)
        const outH = h * maxBarOut * df;
        // Direction unit vector pointing away from centre (in tilted space)
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle) * TILT;
        const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
        const tipOutX = bx + (dirX / dirLen) * outH;
        const tipOutY = by + (dirY / dirLen) * outH - outH * (1 - TILT) * 0.5;

        // Inward tip (grows toward centre, shorter)
        const inH = h * maxBarIn * df;
        const tipInX = bx - (dirX / dirLen) * inH;
        const tipInY = by - (dirY / dirLen) * inH + inH * (1 - TILT) * 0.5;

        // Colour by height
        const tf   = Math.min(h, 1);
        const cTip = tf < 0.5 ? lerp3(c1, c2, tf * 2) : lerp3(c2, c3, (tf - 0.5) * 2);
        const cBase: [number, number, number] = lerp3(c1, [20, 20, 20], 0.4);

        const w = BASE_W * df;

        function drawBar(x1: number, y1: number, x2: number, y2: number, glow: boolean) {
          if (glow && h > 0.3 && isPlaying) {
            ctx.save();
            ctx.shadowColor = rgba(cTip, 0.9);
            ctx.shadowBlur  = 12 * h * df;
            ctx.strokeStyle = rgba(cTip, 0.4 * dim);
            ctx.lineWidth   = w + 4;
            ctx.lineCap     = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.restore();
          }

          if (Math.abs(y2 - y1) < 0.5 && Math.abs(x2 - x1) < 0.5) return;

          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, rgba(cBase, 0.7 * dim));
          grad.addColorStop(1, rgba(cTip,  0.95 * dim));

          ctx.save();
          ctx.strokeStyle = grad;
          ctx.lineWidth   = w;
          ctx.lineCap     = 'round';
          ctx.globalAlpha = dim;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.restore();
        }

        drawBar(bx, by, tipOutX, tipOutY, true);
        drawBar(bx, by, tipInX,  tipInY,  false);
      }

      // ── Centre glow ───────────────────────────────────────────────────────
      const pulseR  = radius * (0.04 + beatPulse * 0.025);
      const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR * 3);
      dotGrad.addColorStop(0,   rgba(c1, 0.85));
      dotGrad.addColorStop(0.4, rgba(c1, 0.25));
      dotGrad.addColorStop(1,   rgba(c1, 0));
      ctx.beginPath();
      ctx.arc(cx, cy, pulseR * 3, 0, Math.PI * 2);
      ctx.fillStyle = dotGrad;
      ctx.fill();
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 -z-10" />
  );
}
