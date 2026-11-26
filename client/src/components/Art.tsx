/**
 * Cover art: flat, layered geometric illustrations (no gradients), one motif per subject.
 * Deterministic per `seed` so a chapter always gets the same picture.
 */
type Motif = "orbits" | "stacks" | "grid" | "waves" | "nodes" | "blocks" | "threads" | "gauge" | "ring";

const PALETTES = [
  { bg: "#1F3E8F", a: "#3D63C9", b: "#DCE4F7", c: "#162C66" },
  { bg: "#DCE2EE", a: "#8EA2CC", b: "#F7F8FB", c: "#2B3F73" },
  { bg: "#2A2D35", a: "#4B5263", b: "#C9D3EA", c: "#1D2027" },
  { bg: "#E7E5E0", a: "#B8B3A8", b: "#F7F6F3", c: "#3B4A6B" },
  { bg: "#2E4A7A", a: "#5F7DB3", b: "#E8ECF4", c: "#22385E" },
  { bg: "#3A3F4A", a: "#6B7385", b: "#E3E6EC", c: "#2A2E36" },
];

const CHAPTER_MOTIF: Motif[] = ["orbits", "blocks", "grid", "stacks", "nodes", "grid", "threads", "waves", "ring", "stacks", "waves", "nodes"];

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export function Art({ seed, motif, palette, className, label }: { seed: number; motif?: Motif; palette?: number; className?: string; label?: string }) {
  const m: Motif = motif ?? CHAPTER_MOTIF[(seed - 1 + CHAPTER_MOTIF.length) % CHAPTER_MOTIF.length];
  const p = PALETTES[(palette ?? seed) % PALETTES.length];
  const r = rng(seed + 7);
  const W = 320, H = 200;
  let body: JSX.Element;
  switch (m) {
    case "orbits":
      body = <>
        <circle cx={230} cy={60} r={120} fill={p.c} />
        <circle cx={230} cy={60} r={78} fill={p.a} />
        <circle cx={230} cy={60} r={34} fill={p.b} />
        <circle cx={70} cy={160} r={22} fill={p.b} />
      </>; break;
    case "stacks":
      body = <>{[0, 1, 2, 3].map((i) => <rect key={i} x={60 + i * 28} y={40 + i * 30} width={170} height={44} rx={12} fill={[p.c, p.a, p.b, p.a][i]} />)}</>; break;
    case "grid":
      body = <>{Array.from({ length: 24 }, (_, i) => {
        const x = 26 + (i % 6) * 48, y = 24 + Math.floor(i / 6) * 42, on = r() > 0.55;
        return <rect key={i} x={x} y={y} width={36} height={30} rx={8} fill={on ? p.b : p.c} opacity={on ? 1 : 0.55} />;
      })}</>; break;
    case "waves":
      body = <>{[0, 1, 2].map((i) => (
        <path key={i} d={`M0 ${90 + i * 38} C 80 ${50 + i * 38}, 160 ${130 + i * 38}, 320 ${80 + i * 38} L320 200 L0 200 Z`} fill={[p.a, p.c, p.b][i]} />
      ))}</>; break;
    case "nodes": {
      const pts = Array.from({ length: 7 }, () => [30 + r() * 260, 25 + r() * 150] as const);
      body = <>
        {pts.map(([x, y], i) => pts.slice(i + 1, i + 3).map(([x2, y2], j) => <line key={`${i}-${j}`} x1={x} y1={y} x2={x2} y2={y2} stroke={p.a} strokeWidth={3} />))}
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 0 ? 20 : 11} fill={i === 0 ? p.b : p.c} stroke={p.a} strokeWidth={3} />)}
      </>; break;
    }
    case "blocks":
      body = <>
        <rect x={40} y={30} width={110} height={140} rx={18} fill={p.c} />
        <rect x={165} y={30} width={115} height={64} rx={18} fill={p.a} />
        <rect x={165} y={106} width={54} height={64} rx={18} fill={p.b} />
        <circle cx={252} cy={138} r={30} fill={p.b} opacity={0.7} />
      </>; break;
    case "threads":
      body = <>{[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={20} y={28 + i * 32} width={280} height={8} rx={4} fill={p.c} />
          <rect x={20 + r() * 150} y={24 + i * 32} width={50 + r() * 80} height={16} rx={8} fill={i % 2 ? p.a : p.b} />
        </g>
      ))}</>; break;
    case "gauge":
      body = <>
        <circle cx={160} cy={190} r={150} fill={p.c} />
        <circle cx={160} cy={190} r={110} fill={p.bg} />
        <path d="M160 190 L 250 95" stroke={p.b} strokeWidth={12} strokeLinecap="round" />
        <circle cx={160} cy={190} r={22} fill={p.b} />
        <rect x={40} y={30} width={60} height={14} rx={7} fill={p.a} />
      </>; break;
    case "ring":
    default:
      body = <>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const a = (i / 8) * Math.PI * 2;
          return <circle key={i} cx={160 + Math.cos(a) * 70} cy={100 + Math.sin(a) * 70} r={14} fill={i % 3 === 0 ? p.b : p.a} />;
        })}
        <circle cx={160} cy={100} r={70} fill="none" stroke={p.c} strokeWidth={4} />
      </>;
  }
  return (
    <svg className={`art ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect width={W} height={H} fill={p.bg} />
      {body}
    </svg>
  );
}

/* 3D icon artwork (3dicons.co, CC0) on a soft tinted tile. */
const CHAPTER_ICON: Record<number, string> = {
  1: "shield", 2: "file-text", 3: "folder", 4: "lock", 5: "copy", 6: "chart", 7: "wallet", 8: "fire", 9: "link",
  10: "calender", 11: "flash", 12: "trophy", 13: "boy", 14: "battery", 15: "chart", 16: "computer", 17: "wallet", 18: "bulb",
};
const TINTS = ["blue", "slate", "sand", "sky"] as const;

export function Pic({ name, chapter, tint, className, plain }: { name?: string; chapter?: number; tint?: (typeof TINTS)[number]; className?: string; plain?: boolean }) {
  const icon = name ?? (chapter != null ? CHAPTER_ICON[chapter] : undefined);
  if (!icon) return <Art seed={chapter ?? 1} className={className} />;
  const t = tint ?? TINTS[(chapter ?? 0) % TINTS.length];
  return (
    <span className={`pic ${plain ? "plain" : `tint-${t}`} ${className ?? ""}`}>
      <img src={`/art/${icon}.webp`} alt="" loading="lazy" decoding="async" draggable={false} />
    </span>
  );
}
