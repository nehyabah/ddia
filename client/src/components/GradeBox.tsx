import { useEffect, useState } from "react";
import { api, type Badge } from "../api";
import { useProfile } from "../state";
import { Icon, Ring } from "./ui";

export type Grade = {
  score: number; verdict: string; covered: string[]; missed: string[]; mistakes: string[];
  tip: string; modelAnswer: string; passed?: boolean; passScore?: number; xp?: number; newBadges?: Badge[]; used?: number; limit?: number;
};

type Status = { enabled: boolean; used: number; limit: number };
let statusCache: Status | null = null;

/**
 * Free-text answer box graded by Claude on the server against the item's reference material.
 * Controlled (answer/onAnswer) or self-contained.
 */
export function GradeBox({ kind, id, placeholder, answer: extAnswer, onAnswer, hideInput, title, onGraded }: {
  kind: "card" | "drill" | "java" | "puzzle" | "design" | "coding" | "story"; id: string | number; placeholder?: string;
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

  useEffect(() => {
    if (!statusCache) api.get<Status>("/ai/status").then((s) => { statusCache = s; setStatus(s); }).catch(() => {});
  }, []);
  useEffect(() => { setGrade(null); setErr(null); if (!onAnswer) setOwn(""); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const g = await api.post<Grade>("/ai/grade", { kind, id: String(id), answer });
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
        <span className="coach-ic"><Icon name="check" size={16} /></span>
        <span className="coach-t"><b>{title ?? "Answer review"}</b><small>Checked against the reference notes{status ? ` · ${status.limit - status.used} left today` : ""}</small></span>
      </div>
      {!hideInput && (
        <textarea className="field coach-in" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder={placeholder ?? "Explain it in your own words, as you would in an interview…"} disabled={busy} />
      )}
      <div className="coach-bar">
        <span className="small muted">{words ? `${words} words` : "Write your answer"}{words > 0 && answer.trim().length < 15 ? " · a little more" : ""}</span>
        <button className="primary coach-go" onClick={submit} disabled={busy || answer.trim().length < 15}>
          {busy ? <span className="spin" /> : <Icon name="check" />}{busy ? "Reviewing" : grade ? "Review again" : "Review answer"}
        </button>
      </div>
      {busy && <div className="coach-steps"><span>Reading</span><span className="d1">Comparing</span><span className="d2">Scoring</span></div>}
      {err && <p className="err">{err}</p>}
      {grade && (
        <div className="coach-res">
          <div className="coach-score">
            <Ring value={grade.score * 10} size={72} stroke={7} color={tone(grade.score)}>{grade.score}<small>/10</small></Ring>
            <div className="cs-t">
              <b>{grade.verdict}</b>
              <div className="cs-seg">
                <span className="ok">{grade.covered.length} covered</span>
                <span className="warn">{grade.missed.length} missed</span>
                <span className="bad">{grade.mistakes.length} to fix</span>
              </div>
              {grade.xp ? <small className="muted">+{grade.xp} XP</small> : null}
            </div>
          </div>
          <ul className="rubric">
            {grade.covered.map((t, i) => <li key={"c" + i} className="ok"><Icon name="check" size={14} /><span>{t}</span></li>)}
            {grade.missed.map((t, i) => <li key={"m" + i} className="warn"><Icon name="bulb" size={14} /><span>{t}</span></li>)}
            {grade.mistakes.map((t, i) => <li key={"x" + i} className="bad"><Icon name="x" size={14} /><span>{t}</span></li>)}
          </ul>
          <div className="coach-tip"><b>Next time</b><span>{grade.tip}</span></div>
          <details className="coach-model"><summary>Show a model answer</summary><p>{grade.modelAnswer}</p></details>
        </div>
      )}
    </div>
  );
}
