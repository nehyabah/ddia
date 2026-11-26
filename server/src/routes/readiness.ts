import { Router } from "express";
import { db } from "../db.js";
import { content } from "./prep.js";
import { chapterLocks } from "./study.js";

/**
 * Interview readiness, computed from everything the user has done.
 *
 * Each competency area pulls items from the DDIA chapters, Java challenges and systems puzzles
 * that belong to it, then scores five signals (all 0..1):
 *   knowledge   – spaced-repetition strength of the area's questions (box 3+ = solid; a miss drops it)
 *   accuracy    – recent quiz/bug accuracy (last 30 days, smoothed so 2/2 is not "100%")
 *   practice    – puzzles solved (first-try or retry; revealed counts little) and Java bug boxes
 *   explanation – best written-answer review score per item, averaged
 *   coverage    – share of the area's items you have touched at all
 * Untouched work counts as 0, so the score only rises with real evidence.
 * Areas not practised for 14+ days decay gently (memory fades; up to -30%).
 */

type Area = { id: string; label: string; weight: number; chapters: number[]; puzzleTopics?: string[]; puzzleTracks?: string[]; javaTopics?: string[] | "rest" };

const AREAS: Area[] = [
  { id: "concurrency", label: "Concurrency & multithreading", weight: 1.2, chapters: [], puzzleTracks: ["concurrency"], javaTopics: ["Concurrency", "Immutability"] },
  { id: "consistency", label: "Transactions & consistency", weight: 1.2, chapters: [7, 9, 17],
    puzzleTopics: ["distributed:Consistency", "distributed:Causal consistency", "distributed:Transactions", "distributed:CAP", "distributed:Conflict resolution", "distributed:Logical clocks", "distributed:Anti-entropy", "resilience:MongoDB transactions"] },
  { id: "replication", label: "Replication & failover", weight: 1.1, chapters: [5, 14],
    puzzleTopics: ["distributed:Replication", "distributed:Leader election", "distributed:Split brain", "distributed:Failure detection", "distributed:Quorums"] },
  { id: "sharding", label: "Partitioning & sharding", weight: 1.1, chapters: [6, 15], puzzleTopics: ["distributed:Sharding", "distributed:Consistent hashing"] },
  { id: "resilience", label: "Rate limits, retries & resilience", weight: 1.0, chapters: [],
    puzzleTopics: ["resilience:Rate limiting", "resilience:Retries", "resilience:MongoDB retryable writes", "resilience:Circuit breaker", "resilience:Bulkheads", "resilience:Idempotency", "resilience:Delivery semantics", "resilience:Timeouts & deadlines", "resilience:Load shedding"] },
  { id: "distributed", label: "Distributed systems & streaming", weight: 1.0, chapters: [8, 10, 11, 12], puzzleTopics: ["distributed:Messaging", "distributed:Outbox & change streams"] },
  { id: "storage", label: "Storage, indexes & query planning", weight: 1.0, chapters: [3, 16] },
  { id: "modeling", label: "Data modelling & encoding", weight: 0.9, chapters: [1, 2, 4, 18] },
  { id: "mongodb", label: "MongoDB core", weight: 0.9, chapters: [13] },
  { id: "fundamentals", label: "Networking & operating systems", weight: 0.9, chapters: [19, 20, 21, 22] },
  { id: "java", label: "Java fundamentals & debugging", weight: 0.8, chapters: [], javaTopics: "rest" },
];

const W = { knowledge: 0.3, accuracy: 0.2, practice: 0.25, explanation: 0.15, coverage: 0.1 };
const DAY = 86400000;

export const readiness = Router();

readiness.get("/readiness", (req, res) => res.json(computeReadiness(req.userId!, req.query.company ? String(req.query.company) : undefined)));

export function computeReadiness(u: number, company?: string) {
  const now = Date.now();
  const since = now - 30 * DAY;

  // ---- load everything once ----
  const qs = db.prepare(`SELECT q.id, q.chapter_id ch, s.box, s.updated_at upd FROM questions q
    LEFT JOIN question_srs s ON s.question_id = q.id AND s.user_id = ?`).all(u) as { id: number; ch: number; box: number | null; upd: number | null }[];
  const att = db.prepare(`SELECT q.chapter_id ch, a.correct, a.created_at t FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = ?`).all(u) as { ch: number; correct: number; t: number }[];
  const cards = db.prepare(`SELECT id, chapter_id ch FROM cards`).all() as { id: number; ch: number }[];
  const drills = db.prepare(`SELECT id, chapter_id ch FROM drills`).all() as { id: number; ch: number }[];
  const jc = db.prepare(`SELECT c.id, c.topic, s.box, s.updated_at upd FROM java_challenges c
    LEFT JOIN java_srs s ON s.challenge_id = c.id AND s.user_id = ?`).all(u) as { id: string; topic: string; box: number | null; upd: number | null }[];
  const ja = db.prepare(`SELECT j.challenge_id id, j.correct, j.created_at t FROM java_attempts j WHERE j.user_id = ?`).all(u) as { id: string; correct: number; t: number }[];
  const pz = db.prepare(`SELECT p.id, p.track, p.topic, pp.attempts, pp.solved, pp.revealed, pp.best_score, pp.solved_day FROM puzzles p
    LEFT JOIN puzzle_progress pp ON pp.puzzle_id = p.id AND pp.user_id = ?`).all(u) as {
      id: string; track: string; topic: string; attempts: number | null; solved: number | null; revealed: number | null; best_score: number | null; solved_day: string | null }[];
  const grades = db.prepare(`SELECT kind, ref_id ref, MAX(score) best, MAX(created_at) t FROM ai_grades WHERE user_id = ? GROUP BY kind, ref_id`).all(u) as { kind: string; ref: string; best: number; t: number }[];

  const cardCh = new Map(cards.map((c) => [String(c.id), c.ch]));
  const drillCh = new Map(drills.map((d) => [String(d.id), d.ch]));
  const pzKey = new Map(pz.map((p) => [p.id, `${p.track}:${p.topic}`]));
  const claimedJava = new Set(AREAS.flatMap((a) => (Array.isArray(a.javaTopics) ? a.javaTopics : [])));

  const inArea = (a: Area) => {
    const chs = new Set(a.chapters);
    const javaOk = (topic: string) => a.javaTopics === "rest" ? !claimedJava.has(topic) : !!a.javaTopics?.includes(topic);
    const pzOk = (track: string, topic: string) => !!a.puzzleTracks?.includes(track) || !!a.puzzleTopics?.includes(`${track}:${topic}`);
    return { chs, javaOk, pzOk };
  };

  const locks = chapterLocks(u);
  const areas = AREAS.map((a) => {
    const { chs, javaOk, pzOk } = inArea(a);
    const aq = qs.filter((q) => chs.has(q.ch));
    const aj = jc.filter((c) => javaOk(c.topic));
    const ap = pz.filter((p) => pzOk(p.track, p.topic));
    const ajIds = new Set(aj.map((c) => c.id));

    // knowledge: SRS strength of questions + Java bugs
    const kItems: (number | null)[] = [...aq.map((q) => q.box), ...aj.map((c) => c.box)];
    const knowledge = kItems.length ? kItems.reduce<number>((s, b) => s + Math.min(b ?? 0, 3) / 3, 0) / kItems.length : null;

    // accuracy: last 30 days, smoothed toward 50% with 4 pseudo-attempts
    const recent = [...att.filter((x) => chs.has(x.ch) && x.t >= since), ...ja.filter((x) => ajIds.has(x.id) && x.t >= since)];
    const n = recent.length, c = recent.reduce((s, x) => s + x.correct, 0);
    const hasAcc = aq.length + aj.length > 0;
    const accuracy = !hasAcc ? null : n === 0 ? 0 : ((c + 2) / (n + 4)) * Math.min(1, n / 10 + 0.5);

    // practice: puzzles (solved=1, solved after reveal=.3) + Java bugs at box>=2
    const pItems: number[] = [
      ...ap.map((p) => (p.solved ? (p.revealed ? 0.3 : 1) : 0)),
      ...aj.map((c) => ((c.box ?? 0) >= 2 ? 1 : (c.box ?? 0) >= 1 ? 0.5 : 0)),
    ];
    const practice = pItems.length && (ap.length || aj.length) ? pItems.reduce((s, x) => s + x, 0) / pItems.length : null;

    // explanation: best review score per item; untried gradable items count against you, softly (cap expectation at 8 items)
    const g = grades.filter((x) =>
      (x.kind === "card" && chs.has(cardCh.get(x.ref) ?? -1)) || (x.kind === "drill" && chs.has(drillCh.get(x.ref) ?? -1)) ||
      (x.kind === "java" && ajIds.has(x.ref)) || (x.kind === "puzzle" && pzOk(...(pzKey.get(x.ref) ?? ":").split(":") as [string, string])));
    const expect = Math.max(3, Math.min(8, Math.ceil((aq.length + ap.length + aj.length) / 12)));
    const explanation = g.length ? g.reduce((s, x) => s + x.best / 10, 0) / Math.max(g.length, Math.min(expect, g.length + 2)) : 0;

    // coverage: touched items / all items
    const total = aq.length + aj.length + ap.length;
    const touched = aq.filter((q) => q.box != null).length + aj.filter((c) => c.box != null).length + ap.filter((p) => (p.attempts ?? 0) > 0 || p.solved).length;
    const coverage = total ? touched / total : 0;

    const signals = { knowledge, accuracy, practice, explanation, coverage };
    let ws = 0, sum = 0;
    for (const [k, v] of Object.entries(signals)) { if (v == null) continue; const w = W[k as keyof typeof W]; ws += w; sum += w * v; }
    let raw = ws ? sum / ws : 0;

    // recency decay
    const lastTs = Math.max(0, ...recent.map((x) => x.t), ...att.filter((x) => chs.has(x.ch)).map((x) => x.t), ...ja.filter((x) => ajIds.has(x.id)).map((x) => x.t), ...g.map((x) => x.t));
    const idleDays = lastTs ? (now - lastTs) / DAY : null;
    const decay = idleDays == null || idleDays <= 14 ? 1 : Math.max(0.7, 1 - (idleDays - 14) / 60);
    raw *= decay;

    const evidence = att.filter((x) => chs.has(x.ch)).length + ja.filter((x) => ajIds.has(x.id)).length + g.length + ap.reduce((s, p) => s + (p.attempts ?? 0), 0);
    const confidence = evidence >= 60 ? "high" : evidence >= 15 ? "medium" : "low";
    const score = Math.round(raw * 100);

    // weakest signal → one concrete next action
    const weakest = (Object.entries(signals).filter(([, v]) => v != null) as [keyof typeof W, number][]).sort((x, y) => x[1] - y[1])[0]?.[0];
    const firstCh = a.chapters.find((c) => !locks.get(c)?.locked); // never point at a locked chapter
    const action = nextAction(a, weakest, firstCh);

    const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));
    return {
      id: a.id, label: a.label, weight: a.weight, score, band: band(score), confidence, evidence,
      idleDays: idleDays == null ? null : Math.floor(idleDays), decayed: decay < 1,
      signals: { knowledge: pct(knowledge), accuracy: pct(accuracy), practice: pct(practice), explanation: pct(explanation), coverage: pct(coverage) },
      items: { questions: aq.length, java: aj.length, puzzles: ap.length },
      weakest, action,
    };
  });

  // ---- interview rounds outside the book: system design, coding, behavioural; plus hands-on MongoDB ----
  type Sig = { knowledge: number | null; accuracy: number | null; practice: number | null; explanation: number | null; coverage: number | null };
  const pctS = (v: number | null) => (v == null ? null : Math.round(v * 100));
  const scoreOf = (sig: Sig, lastTs: number) => {
    let ws = 0, sum = 0;
    for (const [k, v] of Object.entries(sig)) { if (v == null) continue; const w = W[k as keyof typeof W]; ws += w; sum += w * v; }
    const idle = lastTs ? (now - lastTs) / DAY : null;
    const decay = idle == null || idle <= 14 ? 1 : Math.max(0.7, 1 - (idle - 14) / 60);
    return { score: Math.round((ws ? sum / ws : 0) * decay * 100), idleDays: idle == null ? null : Math.floor(idle), decayed: decay < 1 };
  };
  const extra = (id: string, label: string, weight: number, sig: Sig, lastTs: number, evidence: number, action: { label: string; to: string }, items: Record<string, number>) => {
    const s = scoreOf(sig, lastTs);
    const weakest = (Object.entries(sig).filter(([, v]) => v != null) as [keyof typeof W, number][]).sort((x, y) => x[1] - y[1])[0]?.[0];
    return { id, label, weight, score: s.score, band: band(s.score), confidence: (evidence >= 30 ? "high" : evidence >= 8 ? "medium" : "low") as "high" | "medium" | "low", evidence,
      idleDays: s.idleDays, decayed: s.decayed, items: items as { questions: number; java: number; puzzles: number },
      signals: { knowledge: pctS(sig.knowledge), accuracy: pctS(sig.accuracy), practice: pctS(sig.practice), explanation: pctS(sig.explanation), coverage: pctS(sig.coverage) },
      weakest, action };
  };
  const nDesign = content.design.length, nCoding = content.coding.length, nBeh = content.behavioral.questions.length;
  if (nDesign) {
    const rows = db.prepare("SELECT prompt_id, section, best_score, updated_at FROM design_progress WHERE user_id = ?").all(u) as { prompt_id: string; section: string; best_score: number | null; updated_at: number }[];
    const graded = rows.filter((r) => r.best_score != null);
    const prompts = new Set(rows.map((r) => r.prompt_id));
    const totalSections = content.design.reduce((s, p) => s + p.sections.length, 0);
    const sig: Sig = {
      knowledge: null, accuracy: null,
      practice: graded.filter((r) => (r.best_score ?? 0) >= 7).length / Math.min(totalSections, 35),
      explanation: graded.length ? graded.reduce((s, r) => s + (r.best_score ?? 0) / 10, 0) / Math.max(graded.length, 5) : 0,
      coverage: prompts.size / nDesign,
    };
    sig.practice = Math.min(1, sig.practice!);
    areas.push(extra("design", "System design", 1.2, sig, Math.max(0, ...rows.map((r) => r.updated_at)), graded.length * 3, { label: "Practise a design", to: "/design" }, { questions: nDesign, java: 0, puzzles: 0 }));
  }
  if (nCoding) {
    const rows = db.prepare("SELECT solved, first_try, attempts, best_passed, total, java_score, updated_at FROM coding_progress WHERE user_id = ?").all(u) as { solved: number; first_try: number; attempts: number; best_passed: number; total: number; java_score: number | null; updated_at: number }[];
    const tried = rows.filter((r) => r.attempts > 0 || r.java_score != null);
    const solved = rows.filter((r) => r.solved);
    const js = rows.filter((r) => r.java_score != null);
    const sig: Sig = {
      knowledge: null,
      accuracy: tried.length ? tried.reduce((s, r) => s + (r.total ? r.best_passed / r.total : (r.java_score ?? 0) / 10), 0) / Math.max(tried.length, 3) : 0,
      practice: Math.min(1, solved.reduce((s, r) => s + (r.first_try ? 1 : 0.7), 0) / Math.min(nCoding, 15)),
      explanation: js.length ? js.reduce((s, r) => s + (r.java_score ?? 0) / 10, 0) / Math.max(js.length, 3) : null,
      coverage: tried.length / nCoding,
    };
    areas.push(extra("coding", "Coding (data structures & algorithms)", 1.0, sig, Math.max(0, ...rows.map((r) => r.updated_at)), rows.reduce((s, r) => s + r.attempts, 0) + js.length, { label: "Solve a problem", to: "/coding" }, { questions: nCoding, java: 0, puzzles: 0 }));
  }
  if (nBeh) {
    const stories = db.prepare("SELECT themes, best_score, updated_at FROM stories WHERE user_id = ?").all(u) as { themes: string; best_score: number | null; updated_at: number }[];
    const links = db.prepare("SELECT best_score FROM story_links WHERE user_id = ?").all(u) as { best_score: number | null }[];
    const sg = db.prepare("SELECT ref_id, MAX(score) s, MAX(created_at) t FROM ai_grades WHERE user_id = ? AND kind = 'story' GROUP BY ref_id").all(u) as { ref_id: string; s: number; t: number }[];
    const themesOk = new Set(stories.filter((s) => (s.best_score ?? 0) >= 7).flatMap((s) => JSON.parse(s.themes) as string[]));
    const nThemes = Math.max(1, content.behavioral.themes.length);
    const sig: Sig = {
      knowledge: null, accuracy: null,
      practice: Math.min(1, stories.length / 8),
      explanation: sg.length ? sg.reduce((s, x) => s + x.s / 10, 0) / Math.max(sg.length, 4) : 0,
      coverage: Math.min(1, (themesOk.size / nThemes) * 0.6 + (links.length / nBeh) * 0.4),
    };
    areas.push(extra("behavioral", "Behavioural & leadership", 0.9, sig, Math.max(0, ...stories.map((s) => s.updated_at), ...sg.map((x) => x.t)), stories.length * 2 + sg.length * 3, { label: "Work on your stories", to: "/behavioral" }, { questions: nBeh, java: 0, puzzles: 0 }));
  }
  if (content.mongo.length) {
    const m = areas.find((a) => a.id === "mongodb");
    const rows = db.prepare("SELECT solved, attempts, updated_at FROM mongo_progress WHERE user_id = ?").all(u) as { solved: number; attempts: number; updated_at: number }[];
    if (m) {
      const solvedShare = rows.filter((r) => r.solved).length / content.mongo.length;
      const touchedShare = rows.length / content.mongo.length;
      const s = m.signals;
      const sig: Sig = {
        knowledge: s.knowledge == null ? null : s.knowledge / 100, accuracy: s.accuracy == null ? null : s.accuracy / 100,
        practice: solvedShare, explanation: s.explanation == null ? null : s.explanation / 100,
        coverage: ((s.coverage ?? 0) / 100) * 0.5 + touchedShare * 0.5,
      };
      const re = extra("mongodb", m.label, m.weight, sig, Math.max(0, ...rows.map((r) => r.updated_at), now - (m.idleDays ?? 9999) * DAY), m.evidence + rows.reduce((a, r) => a + r.attempts, 0),
        sig.practice! < (sig.knowledge ?? 1) ? { label: "Hands-on queries", to: "/mongo" } : m.action, { ...m.items });
      Object.assign(m, re);
    }
  }

  // Company focus: weights come from your target companies (averaged), or a specific company when asked.
  const targets = targetCompanies(u);
  const avgWeights = (ids: string[]) => {
    const ps = ids.map((id) => content.companies.find((c) => c.id === id)).filter(Boolean) as { weights: Record<string, number> }[];
    if (!ps.length) return null;
    const keys = new Set(ps.flatMap((p) => Object.keys(p.weights)));
    return Object.fromEntries([...keys].map((k) => [k, ps.reduce((s, p) => s + (p.weights[k] ?? 1), 0) / ps.length]));
  };
  const cw = (company ? avgWeights([company]) : avgWeights(targets));
  for (const a of areas) if (cw?.[a.id] != null) a.weight = Math.round(cw[a.id] * 100) / 100;
  const ov = overallFrom(areas);
  const totalEvidence = areas.reduce((s, a) => s + a.evidence, 0);
  const perCompany = company ? [] : targets.map((id) => {
    const w = avgWeights([id]) ?? {};
    const o = overallFrom(areas.map((a) => ({ ...a, weight: w[a.id] ?? a.weight })));
    return { id, name: content.companies.find((c) => c.id === id)?.name ?? id, overall: o.overall, band: band(o.overall) };
  });

  return {
    overall: ov.overall, uncapped: ov.uncapped, band: band(ov.overall), capped: ov.overall < ov.uncapped,
    confidence: totalEvidence >= 400 ? "high" : totalEvidence >= 100 ? "medium" : "low",
    strongest: [...areas].sort((x, y) => y.score - x.score).slice(0, 2).map((a) => a.label),
    focus: [...areas].sort((x, y) => x.score * (2 - x.weight) - y.score * (2 - y.weight)).slice(0, 3).map((a) => ({ id: a.id, label: a.label, score: a.score, action: a.action })),
    weights: W, company: company ?? null, targets, perCompany,
    areas,
  };
}

function overallFrom(areas: { score: number; weight: number }[]) {
  const wsum = areas.reduce((s, a) => s + a.weight, 0) || 1;
  const uncapped = Math.round(areas.reduce((s, a) => s + a.score * a.weight, 0) / wsum);
  // An interview exposes your weakest areas: cap the overall at 20 points above your weakest high-weight area.
  const core = areas.filter((a) => a.weight >= 1);
  const floorArea = core.length ? Math.min(...core.map((a) => a.score)) : 100;
  return { uncapped, overall: Math.min(uncapped, floorArea + 20) };
}

export function targetCompanies(u: number): string[] {
  const r = db.prepare("SELECT target_companies t FROM users WHERE id = ?").get(u) as { t: string | null } | undefined;
  try { return r?.t ? (JSON.parse(r.t) as string[]) : []; } catch { return []; }
}

function band(s: number) {
  return s >= 80 ? "Interview ready" : s >= 65 ? "Nearly there" : s >= 45 ? "Developing" : s > 0 ? "Early" : "Not started";
}

function nextAction(a: Area, weakest: string | undefined, ch: number | undefined): { label: string; to: string } {
  const puzzleTrack = a.puzzleTracks?.[0] ?? a.puzzleTopics?.[0]?.split(":")[0];
  const java = a.javaTopics ? "/java/play" : null;
  switch (weakest) {
    case "knowledge": case "coverage":
      if (ch) return { label: "Study the chapter", to: `/chapter/${ch}` };
      if (puzzleTrack) return { label: "Start the puzzles", to: `/puzzles/play?track=${puzzleTrack}` };
      return { label: "Fix Java bugs", to: java ?? "/java" };
    case "accuracy":
      if (ch) return { label: "Take a quiz", to: `/chapter/${ch}/quiz` };
      return { label: "Fix Java bugs", to: java ?? "/java" };
    case "practice":
      if (puzzleTrack) return { label: "Solve puzzles", to: `/puzzles/play?track=${puzzleTrack}` };
      return { label: "Fix Java bugs", to: java ?? "/java" };
    case "explanation":
      if (ch) return { label: "Practise explaining", to: `/chapter/${ch}/drill` };
      if (puzzleTrack) return { label: "Explain-it puzzles", to: `/puzzles/play?track=${puzzleTrack}` };
      return { label: "Explain a bug", to: "/java/play" };
    default:
      return { label: "Review due items", to: "/review" };
  }
}
