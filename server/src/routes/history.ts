import { Router } from "express";
import { db } from "../db.js";
import { content } from "./prep.js";
import { getPuzzle } from "./puzzles.js";

/** Everything you've written and had reviewed, newest first, with where it came from. */
export const history = Router();

type Row = { id: number; kind: string; ref_id: string; answer: string; score: number; result: string; created_at: number };
const KIND_LABEL: Record<string, string> = {
  card: "Concept", drill: "Drill", java: "Java bug", puzzle: "Systems puzzle", design: "Design", coding: "Code review", story: "Behavioural", followup: "Follow-up", mock: "Mock interview",
};

function describe(kind: string, ref: string): { title: string; to: string | null } {
  try {
    if (kind === "card") {
      const r = db.prepare("SELECT k.title, k.chapter_id ch FROM cards k WHERE k.id = ?").get(Number(ref)) as { title: string; ch: number } | undefined;
      return { title: r?.title ?? "Concept", to: r ? `/chapter/${r.ch}/learn` : null };
    }
    if (kind === "drill") {
      const r = db.prepare("SELECT prompt, chapter_id ch FROM drills WHERE id = ?").get(Number(ref)) as { prompt: string; ch: number } | undefined;
      return { title: r?.prompt ?? "Drill", to: r ? `/chapter/${r.ch}/drill` : null };
    }
    if (kind === "java") {
      const r = db.prepare("SELECT data FROM java_challenges WHERE id = ?").get(ref) as { data: string } | undefined;
      return { title: r ? (JSON.parse(r.data) as { title: string }).title : "Java bug", to: `/java/c/${ref}` };
    }
    if (kind === "puzzle") return { title: getPuzzle(ref).title, to: `/puzzles/p/${ref}` };
    if (kind === "design") {
      const [pid, key] = ref.split(":");
      const p = content.design.find((x) => x.id === pid);
      return { title: p ? `${p.title} · ${p.sections.find((s) => s.key === key)?.title ?? key}` : "Design", to: p ? `/design/${pid}` : null };
    }
    if (kind === "coding") return { title: content.coding.find((x) => x.id === ref)?.title ?? "Coding", to: `/coding/${ref}` };
    if (kind === "story") return { title: content.behavioral.questions.find((x) => x.id === ref)?.text ?? "Behavioural", to: "/behavioral" };
    if (kind === "followup") {
      const i = ref.indexOf(":");
      const inner = describe(ref.slice(0, i), ref.slice(i + 1));
      return { title: inner.title, to: inner.to };
    }
  } catch { /* content may have changed */ }
  return { title: KIND_LABEL[kind] ?? kind, to: null };
}

history.get("/history", (req, res) => {
  const u = req.userId!;
  const kind = String(req.query.kind ?? "");
  const before = Number(req.query.before) || Date.now() + 1;
  const LIMIT = 25;
  const rows = (kind && kind !== "mock"
    ? db.prepare("SELECT id, kind, ref_id, answer, score, result, created_at FROM ai_grades WHERE user_id = ? AND kind = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(u, kind, before, LIMIT)
    : kind === "mock" ? []
    : db.prepare("SELECT id, kind, ref_id, answer, score, result, created_at FROM ai_grades WHERE user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(u, before, LIMIT)) as Row[];
  const mocks = !kind || kind === "mock"
    ? (db.prepare("SELECT id, finished_at, total, items, scores FROM mock_sessions WHERE user_id = ? AND finished_at IS NOT NULL AND finished_at < ? ORDER BY finished_at DESC LIMIT ?").all(u, before, LIMIT) as
        { id: number; finished_at: number; total: number; items: string; scores: string }[])
    : [];

  const items = [
    ...rows.map((r) => {
      const g = JSON.parse(r.result) as { verdict?: string; feedback?: string; question?: string; covered?: string[]; missed?: string[]; mistakes?: string[]; tip?: string; modelAnswer?: string; betterAnswer?: string };
      const d = describe(r.kind, r.ref_id);
      return {
        key: `g${r.id}`, kind: r.kind, kindLabel: KIND_LABEL[r.kind] ?? r.kind, title: d.title, to: d.to, at: r.created_at, score: r.score, outOf: 10,
        answer: r.answer, verdict: g.verdict ?? g.feedback ?? "", question: g.question ?? null,
        covered: g.covered ?? [], missed: g.missed ?? [], mistakes: g.mistakes ?? [], tip: g.tip ?? null, model: g.modelAnswer ?? g.betterAnswer ?? null,
      };
    }),
    ...mocks.map((m) => {
      const its = JSON.parse(m.items) as { kind: string; title: string }[];
      const sc = JSON.parse(m.scores) as (number | null)[];
      return {
        key: `m${m.id}`, kind: "mock", kindLabel: "Mock interview", title: `${its.length} questions`, to: "/mock", at: m.finished_at, score: m.total, outOf: 100,
        answer: "", verdict: its.map((x, i) => `${KIND_LABEL[x.kind] ?? x.kind}: ${sc[i] ?? "–"}/10`).join(" · "), question: null,
        covered: [], missed: [], mistakes: [], tip: null, model: null,
      };
    }),
  ].sort((a, b) => b.at - a.at).slice(0, LIMIT);

  const counts = Object.fromEntries((db.prepare("SELECT kind, COUNT(*) n FROM ai_grades WHERE user_id = ? GROUP BY kind").all(u) as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
  counts.mock = (db.prepare("SELECT COUNT(*) n FROM mock_sessions WHERE user_id = ? AND finished_at IS NOT NULL").get(u) as { n: number }).n;
  res.json({ items, next: items.length === LIMIT ? items[items.length - 1].at : null, counts, labels: KIND_LABEL });
});
