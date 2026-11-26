import { useEffect, useState } from "react";
import { api, type Badge } from "../api";
import { useProfile } from "../state";
import { Icon } from "./ui";
import { Thinking } from "./Thinking";
import { MicButton, SpeakButton, speak, stopSpeaking, type Spoken } from "./Voice";

export type Grade = {
  score: number; verdict: string; covered: string[]; missed: string[]; mistakes: string[];
  tip: string; modelAnswer: string; delivery?: Delivery | null; passed?: boolean; passScore?: number; xp?: number; newBadges?: Badge[]; used?: number; limit?: number;
};

type Delivery = { seconds: number; words: number; wpm: number; fillers: number; topFillers: { word: string; n: number }[]; notes: string[] };
type Status = { enabled: boolean; used: number; limit: number };
let statusCache: Status | null = null;

/**
 * Free-text answer box graded by Claude on the server against the item's reference material.
 * Controlled (answer/onAnswer) or self-contained.
 */
export function GradeBox({ kind, id, placeholder, answer: extAnswer, onAnswer, hideInput, title, onGraded }: {
  kind: "card" | "drill" | "java" | "puzzle" | "design" | "coding" | "story" | "project" | "probe" | "why"; id: string | number; placeholder?: string;
  answer?: string; onAnswer?: (s: string) => void; hideInput?: boolean; title?: string; onGraded?: (g: Grade) => void;
}) {
  const { reward } = useProfile();
  const [own, setOwn] = useState("");
  const answer = extAnswer ?? own;
  const setAnswer = onAnswer ?? setOwn;
  const [status, setStatus] = useState<Status | null>(statusCache);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [spoken, setSpoken] = useState<Spoken | null>(null);
  // Voice is offered wherever the answer is editable from here (not for code or a saved story).
  const micOk = kind !== "coding" && kind !== "story" && (!hideInput || !!onAnswer);

  useEffect(() => {
    if (!statusCache) api.get<Status>("/ai/status").then((s) => { statusCache = s; setStatus(s); }).catch(() => {});
  }, []);
  useEffect(() => { setGrade(null); setErr(null); setSpoken(null); if (!onAnswer) setOwn(""); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const g = await api.post<Grade>("/ai/grade", { kind, id: String(id), answer, spoken });
      setGrade(g);
      onGraded?.(g);
      if (g.used != null && g.limit != null) { statusCache = { enabled: true, used: g.used, limit: g.limit }; setStatus(statusCache); }
      reward(g.xp ?? 0, g.newBadges);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status && !status.enabled) {
    return <p className="small muted" style={{ marginTop: 12 }}>Answer review is off: add <code className="ic">ANTHROPIC_API_KEY</code> to the server to enable it.</p>;
  }

  const tone = (s: number) => (s >= 8 ? "var(--teal)" : s >= 5 ? "var(--amber)" : "var(--red)");
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  return (
    <div className="coach">
      <div className="coach-h">
        <img className="coach-orb" src="/art/orb.webp" alt="" />
        <span className="coach-t"><b>{title ?? "Answer review"}</b><small>Checked against the reference notes{status ? ` · ${status.limit - status.used} left today` : ""}</small></span>
      </div>
      {!hideInput && (
        <textarea className="field coach-in" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder={placeholder ?? "Explain it in your own words, as you would in an interview…"} disabled={busy} />
      )}
      {micOk && <MicButton value={answer} onChange={setAnswer} onSpoken={setSpoken} disabled={busy} />}
      <div className="coach-bar">
        <span className="small muted">{words ? `${words} words` : "No answer yet"}{words > 0 && answer.trim().length < 15 ? " · a little more" : ""}</span>
        <button className="primary coach-go" onClick={submit} disabled={busy || answer.trim().length < 15}>
          {grade ? "Review again" : "Review answer"}<Icon name="arrow" />
        </button>
      </div>
      {busy && <Thinking phases={["Reading your answer", "Checking it against the reference", "Weighing what you missed", "Scoring"]} />}
      {err && <p className="err">{err}</p>}
      {grade && (
        <div className="coach-res">
          <div className="score2">
            <div className="s2-top">
              <span className="s2-num" style={{ color: tone(grade.score) }}>{grade.score}<small>/10</small></span>
              <span className="s2-verdict">{grade.verdict}</span>
            </div>
            <div className="s2-line" aria-label={`Score ${grade.score} out of 10`}>
              <i style={{ width: `${grade.score * 10}%`, background: tone(grade.score) }} />
              <b style={{ left: `${(grade.passScore ?? 7) * 10}%` }} title={`Pass mark ${grade.passScore ?? 7}/10`} />
            </div>
            <div className="s2-meta">
              <span><i className="ok" />{grade.covered.length} covered</span>
              <span><i className="warn" />{grade.missed.length} missed</span>
              <span><i className="bad" />{grade.mistakes.length} to fix</span>
              {grade.xp ? <em>+{grade.xp} XP</em> : null}
            </div>
          </div>
          <ul className="rubric">
            {grade.covered.map((t, i) => <li key={"c" + i} className="ok"><Icon name="check" size={14} /><span>{t}</span></li>)}
            {grade.missed.map((t, i) => <li key={"m" + i} className="warn"><Icon name="bulb" size={14} /><span>{t}</span></li>)}
            {grade.mistakes.map((t, i) => <li key={"x" + i} className="bad"><Icon name="x" size={14} /><span>{t}</span></li>)}
          </ul>
          {grade.delivery && (
            <div className="delivery">
              <b>Delivery</b>
              <div className="dl-stats">
                <span><em>{grade.delivery.wpm}</em> words/min</span>
                <span><em>{grade.delivery.fillers}</em> filler{grade.delivery.fillers === 1 ? "" : "s"}</span>
                <span><em>{Math.floor(grade.delivery.seconds / 60)}:{String(grade.delivery.seconds % 60).padStart(2, "0")}</em> spoken</span>
              </div>
              <ul className="tidy small">{grade.delivery.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          <div className="coach-tip"><b>Next time</b><span>{grade.tip}</span></div>
          <details className="coach-model"><summary>Show a model answer</summary><p>{grade.modelAnswer}</p></details>
          <FollowUps kind={kind} id={String(id)} answer={answer} />
        </div>
      )}
    </div>
  );
}

type Turn = { q: string; why: string; a?: string; score?: number; feedback?: string; betterAnswer?: string };

/** After a review: the interviewer pushes back with up to three follow-up questions. */
function FollowUps({ kind, id, answer }: { kind: string; id: string; answer: string }) {
  const { reward } = useProfile();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const history = turns.filter((t) => t.a != null).map((t) => ({ q: t.q, a: t.a! }));
  const open = turns.length > 0 && turns[turns.length - 1].a == null ? turns[turns.length - 1] : null;

  async function ask() {
    setBusy(true); setErr(null);
    try { const f = await api.post<{ question: string; why: string }>("/ai/followup", { kind, id, answer, history }); setTurns([...turns, { q: f.question, why: f.why }]); setReply(""); speak(f.question); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function send() {
    if (!open) return;
    stopSpeaking();
    setBusy(true); setErr(null);
    try {
      const g = await api.post<{ score: number; feedback: string; betterAnswer: string; xp: number; newBadges: Badge[] }>("/ai/followup/grade", { kind, id, answer, history, question: open.q, reply });
      setTurns(turns.map((t) => (t === open ? { ...t, a: reply, score: g.score, feedback: g.feedback, betterAnswer: g.betterAnswer } : t)));
      reward(g.xp, g.newBadges);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const tone = (s: number) => (s >= 8 ? "var(--teal)" : s >= 5 ? "var(--amber)" : "var(--red)");
  return (
    <div className="followups">
      {turns.map((t, i) => (
        <div key={i} className="fu">
          <div className="fu-q"><span className="fu-who">Interviewer <SpeakButton text={t.q} /></span>{t.q}</div>
          {t.a != null && (<>
            <div className="fu-a"><span className="fu-who">You</span>{t.a}</div>
            <div className="fu-g"><b style={{ color: tone(t.score ?? 0) }}>{t.score}/10</b> {t.feedback} <span className="muted">Probing: {t.why}</span>
              <details><summary>Stronger reply</summary><p>{t.betterAnswer}</p></details></div>
          </>)}
        </div>
      ))}
      {open ? (
        <div className="fu-reply">
          <textarea className="field" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply as you would out loud…" disabled={busy} />
          <MicButton value={reply} onChange={setReply} disabled={busy} />
          <button className="primary coach-go" onClick={send} disabled={busy || reply.trim().length < 10}>Reply</button>
        </div>
      ) : turns.length < 3 ? (
        <button className="ghost fu-ask" onClick={ask} disabled={busy}><Icon name="mic" />{turns.length ? "Another follow-up" : "Interviewer follow-up"}</button>
      ) : <p className="small muted">Three follow-ups done. That’s a realistic grilling.</p>}
      {busy && <Thinking compact phases={open ? ["Listening", "Weighing your reply", "Scoring"] : ["The interviewer is thinking", "Finding the weak spot"]} />}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
