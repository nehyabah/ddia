import type { ReactNode } from "react";

/* ---------- icons (inline SVG, 24×24, stroke = currentColor) ---------- */
const P: Record<string, ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  review: <><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 21v-5h5" /></>,
  code: <><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /><path d="m14 4-4 16" /></>,
  chart: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  notes: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  flame: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 .8-3.3 2-4.5.3 1.6 1 2.5 2 2.5-1-3 0-6 1-8Z" fill="currentColor" stroke="none" />,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4" /><path d="M12 13v4M8 21h8M9 21v-1a3 3 0 0 1 6 0v1" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /><path d="M8 7h7" /></>,
  cards: <><rect x="3" y="6" width="13" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12" /></>,
  puzzle: <><path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  skull: <><path d="M12 3a8 8 0 0 0-5 14.3V20h10v-2.7A8 8 0 0 0 12 3Z" /><circle cx="9" cy="11" r="1.5" fill="currentColor" /><circle cx="15" cy="11" r="1.5" fill="currentColor" /><path d="M10 20v-2M14 20v-2" /></>,
  bug: <><rect x="7" y="8" width="10" height="12" rx="5" /><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 3M20 7l-3 3M4 20l3-3M20 20l-3-3" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  medal: <><circle cx="12" cy="15" r="5" /><path d="m8 3 4 7 4-7" /><path d="M12 13v4" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  sparkle: <path d="M12 3c.6 4 2 5.4 6 6-4 .6-5.4 2-6 6-.6-4-2-5.4-6-6 4-.6 5.4-2 6-6Zm7 11c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8Z" fill="currentColor" stroke="none" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  logo: <><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" /><path d="M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7" /><path d="M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {P[name]}
    </svg>
  );
}

/* ---------- progress ring ---------- */
export function Ring({ value, size = 48, stroke = 5, color = "var(--accent)", children, title }: {
  value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; title?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="ringwrap" style={{ width: size, height: size }} title={title}>
      <svg className="ringsvg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="trk" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="val" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: color }}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      {children != null && <span className="lab">{children}</span>}
    </span>
  );
}

/** Shared gradient used by rings; render once near the app root. */
export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6A4CFF" /><stop offset="60%" stopColor="#3D6BFF" /><stop offset="100%" stopColor="#22A6F2" />
        </linearGradient>
        <linearGradient id="ringWarm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFB547" /><stop offset="100%" stopColor="#FF7A59" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ---------- confetti ---------- */
const COLORS = ["#6A4CFF", "#F2762E", "#0FA97A", "#E5484D", "#2E7BFF", "#E89A0C"];

export function confetti(count = 80) {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const w = window.innerWidth;
    p.style.left = `${Math.random() * w}px`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 240}px`);
    p.style.setProperty("--r", `${(Math.random() * 2 - 1) * 900}deg`);
    p.style.setProperty("--d", `${1.3 + Math.random() * 1.3}s`);
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    if (i % 3 === 0) { p.style.width = "7px"; p.style.height = "7px"; p.style.borderRadius = "50%"; }
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3000);
}
