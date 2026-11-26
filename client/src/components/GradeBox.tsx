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
  kind: "card" | "drill" | "java" | "puzzle"; id: string | number; placeholder?: string;
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
    return <p className="small muted" style={{ marginTop: 12 }}>AI grading is off: add <code className="ic">ANTHROPIC_API_KEY</code> to the server to enable it.</p>;
  }

  const tone = (s: number) => (s >= 8 ? "var(--teal)" : s >= 5 ? "var(--amber)" : "var(--red)");
  return (
    <div className="gradebox">
      {title && <div className="steplabel"><span>{title}</span>{status && <span className="n">{status.limit - status.used} grades left today</span>}</div>}
      {!hideInput && (
        <textarea className="field" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder={placeholder ?? "Explain it in your own words, as you would in an interview…"} disabled={busy} />
      )}
      <button className="primary ai" onClick={submit} disabled={busy || answer.trim().length < 15}>
        <Icon name="sparkle" />{busy ? "Claude is grading…" : grade ? "Grade again" : "Grade with Claude"}
      </button>
      {answer.trim().length > 0 && answer.trim().length < 15 && <span className="small muted" style={{ marginLeft: 10 }}>Write a little more first.</span>}
      {err && <p className="err">{err}</p>}
      {grade && (
        <div className="graded">
          <div className="gh">
            <Ring value={grade.score * 10} size={58} stroke={6} color={tone(grade.score)}>{grade.score}<small>/10</small></Ring>
            <div><b>{grade.verdict}</b>{grade.xp ? <div className="small muted">+{grade.xp} XP</div> : null}</div>
          </div>
          {grade.covered.length > 0 && <List cls="ok" icon="check" title="You covered" items={grade.covered} />}
          {grade.missed.length > 0 && <List cls="warn" icon="bulb" title="You missed" items={grade.missed} />}
          {grade.mistakes.length > 0 && <List cls="bad" icon="x" title="Not quite right" items={grade.mistakes} />}
          <div className="box-tip"><b><Icon name="bolt" />Next time</b><span>{grade.tip}</span></div>
          <details className="reveal" style={{ marginTop: 10 }}><summary>Model answer</summary><p style={{ margin: "8px 0 0" }}>{grade.modelAnswer}</p></details>
        </div>
      )}
    </div>
  );
}

function List({ cls, icon, title, items }: { cls: string; icon: "check" | "bulb" | "x"; title: string; items: string[] }) {
  return (
    <div className={`glist ${cls}`}>
      <div className="gt"><Icon name={icon} size={15} />{title}</div>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}
