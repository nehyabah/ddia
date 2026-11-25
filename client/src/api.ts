export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("ddia:unauthorized"));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b: unknown = {}) => request<T>("POST", p, b),
  put: <T>(p: string, b: unknown = {}) => request<T>("PUT", p, b),
};

/* ---------- shared types (mirror the server responses) ---------- */

export type Badge = { id: string; label: string; earned?: boolean };

export type Profile = {
  user: { id: number; username: string };
  xp: number; level: number; into: number; need: number;
  streak: number; bestStreak: number; studiedToday: boolean;
  xpToday: number; dailyGoal: number; dueCount: number;
  badges: Badge[];
};

export type ChapterSummary = {
  id: number; tag: string | null; label: string; title: string; blurb: string;
  cardCount: number; cardsSeen: number; questionCount: number; due: number; bossWon: boolean; mastery: number;
};

export type Card = { id: number; idx: number; title: string; bullets: string[]; seen: boolean; starred: boolean; note: string };
export type Term = { id: number; term: string; meaning: string };
export type Drill = { id: number; prompt: string; points: string[]; level: number; lastRatio: number | null; lastAnswer: string };

export type ChapterDetail = {
  id: number; tag: string | null; label: string; title: string; blurb: string;
  mastery: number; bossWon: boolean; quizCount: number; bossCount: number; due: number;
  cards: Card[]; terms: Term[]; drills: Drill[];
};

export type RunMode = "quiz" | "boss" | "review";
export type RunQuestion = { id: number; chapterId: number; chapterLabel: string; prompt: string; options: string[] };
export type Run = { runId: number; mode: RunMode; chapterId: number | null; lives: number | null; questions: RunQuestion[] };
export type AnswerResult = {
  correct: boolean; answer: number; explanation: string; xp: number; combo: number; lives: number | null;
  finished: boolean; newBadges: Badge[];
  summary: null | { correct: number; total: number; answered: number; xp: number; bonus: number; message: string; mastery: number | null };
};

export type Stats = {
  totals: { answered: number; correct: number; accuracy: number | null; cardsSeen: number; cardsTotal: number; questionsTotal: number; learned: number };
  boxes: number[]; unseen: number;
  forecast: { label: string; n: number }[];
  days: { day: string; xp: number; answered: number; correct: number }[];
  chapters: { id: number; label: string; title: string; mastery: number; attempts: number; accuracy: number | null }[];
  weakest: { id: number; prompt: string; answer: string; explanation: string; chapterLabel: string; chapterId: number; lapses: number; reps: number; box: number }[];
};

export type NoteItem = {
  cardId: number; title: string; bullets: string[]; chapterId: number; chapterLabel: string; chapterTitle: string;
  note: string; starred: boolean; updatedAt: string | null;
};

export type SearchResult = {
  q: string;
  cards: { id: number; idx: number; title: string; bullets: string[]; chapterId: number; chapterLabel: string }[];
  terms: { id: number; term: string; meaning: string; chapterId: number; chapterLabel: string }[];
  questions: { id: number; prompt: string; answer: string; explanation: string; chapterId: number; chapterLabel: string }[];
};
