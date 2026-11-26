import type { ReactNode } from "react";

const KEYWORDS = new Set((
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final " +
  "finally float for goto if implements import instanceof int interface long native new package private protected public " +
  "record return short static strictfp super switch synchronized this throw throws transient try var void volatile while " +
  "true false null yield sealed permits"
).split(" "));

const TOKEN = /(\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@\w+|\b\d[\d_]*(?:\.\d+)?[LlFfDd]?\b|\b[A-Za-z_$][\w$]*\b)/g;

/** Tiny single-line Java highlighter: enough for keywords, strings, numbers, comments and types. */
export function highlight(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of line.matchAll(TOKEN)) {
    const t = m[0], i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    let cls = "";
    if (t.startsWith("//") || t.startsWith("/*")) cls = "tc";
    else if (t.startsWith("\"") || t.startsWith("'")) cls = "ts";
    else if (t.startsWith("@")) cls = "ta";
    else if (/^\d/.test(t)) cls = "tn";
    else if (KEYWORDS.has(t)) cls = "tk";
    else if (/^[A-Z]/.test(t)) cls = "tt";
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : t);
    last = i + t.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Renders `backtick` spans in prose as inline code. */
export function Md({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return <>{parts.map((p, i) => (p.length > 2 && p.startsWith("`") && p.endsWith("`") ? <code key={i} className="ic">{p.slice(1, -1)}</code> : p))}</>;
}

export type LineMark = "sel" | "bug" | "miss" | "hit";

export function CodeView({ code, marks, onLine, label }: {
  code: string;
  marks?: Map<number, LineMark>;
  onLine?: (n: number) => void;
  label?: string;
}) {
  const lines = code.replace(/\s+$/, "").split("\n");
  return (
    <div className={`code ${onLine ? "pick" : ""}`} role={onLine ? "group" : undefined} aria-label={label}>
      {lines.map((l, i) => {
        const n = i + 1, m = marks?.get(n);
        const inner = (<><span className="ln">{n}</span><span className="src">{l.length ? highlight(l) : " "}</span></>);
        return onLine ? (
          <div key={n} className={`row ${m ?? ""}`} role="button" tabIndex={0} aria-pressed={m === "sel"}
            onClick={() => onLine(n)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLine(n); } }}>
            {inner}
          </div>
        ) : <div key={n} className={`row ${m ?? ""}`}>{inner}</div>;
      })}
    </div>
  );
}

/** Line diff via LCS, rendered as a unified diff of buggy → fixed. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const a = before.replace(/\s+$/, "").split("\n"), b = after.replace(/\s+$/, "").split("\n");
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const rows: { t: " " | "-" | "+"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { rows.push({ t: " ", s: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) rows.push({ t: "-", s: a[i++] });
    else rows.push({ t: "+", s: b[j++] });
  }
  while (i < a.length) rows.push({ t: "-", s: a[i++] });
  while (j < b.length) rows.push({ t: "+", s: b[j++] });
  return (
    <div className="code diff">
      {rows.map((r, k) => (
        <div key={k} className={`row ${r.t === "-" ? "del" : r.t === "+" ? "add" : ""}`}>
          <span className="ln">{r.t === " " ? "" : r.t}</span><span className="src">{r.s.length ? highlight(r.s) : " "}</span>
        </div>
      ))}
    </div>
  );
}

/** Minimal markdown: ``` code blocks, paragraphs, "- " lists, **bold** and `code`. */
export function Prose({ text }: { text: string }) {
  const blocks = text.split(/```[a-z]*\n?/);
  const inline = (s: string, k: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={k + i}>{p.slice(2, -2)}</b> : <Md key={k + i} text={p} />);
  return (
    <div className="prose">
      {blocks.map((b, i) => i % 2 === 1
        ? <pre key={i} className="code prosecode">{b.replace(/\n$/, "")}</pre>
        : b.split(/\n{2,}/).filter((p) => p.trim()).map((p, j) => {
            const lines = p.split("\n");
            if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={`${i}-${j}`} className="tidy">{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*[-*] /, ""), `${i}-${j}-${k}`)}</li>)}</ul>;
            return <p key={`${i}-${j}`}>{lines.map((l, k) => <span key={k}>{k > 0 && <br />}{inline(l, `${i}-${j}-${k}`)}</span>)}</p>;
          }))}
    </div>
  );
}
