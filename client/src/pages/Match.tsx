import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Badge, type Term } from "../api";
import { shuffle, useProfile } from "../state";
import { useChapter } from "./Chapter";
import { Icon } from "../components/ui";

type Tile = { side: "L" | "R"; i: number; text: string };

export function Match() {
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data: c, error } = useChapter();
  const [round, setRound] = useState(0);
  const [sel, setSel] = useState<Tile | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [shake, setShake] = useState<string[]>([]);
  const [misses, setMisses] = useState(0);
  const [t0, setT0] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [finish, setFinish] = useState<{ secs: number; xp: number } | null>(null);

  const set: Term[] = useMemo(() => (c ? shuffle(c.terms).slice(0, 6) : []), [c, round]);
  const left = useMemo(() => shuffle(set.map((t, i): Tile => ({ side: "L", i, text: t.term }))), [set]);
  const right = useMemo(() => shuffle(set.map((t, i): Tile => ({ side: "R", i, text: t.meaning }))), [set]);

  useEffect(() => {
    setSel(null); setDone(new Set()); setMisses(0); setFinish(null); setT0(Date.now()); setElapsed(0);
  }, [round, c?.id]);

  useEffect(() => {
    if (finish) return;
    const h = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(h);
  }, [t0, finish]);

  async function complete(missCount: number) {
    if (!c) return;
    const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    const r = await api.post<{ xp: number; newBadges: Badge[] }>("/match", { chapterId: c.id, seconds: secs, misses: missCount });
    setFinish({ secs, xp: r.xp });
    reward(r.xp, r.newBadges);
  }

  function click(t: Tile) {
    if (done.has(t.i)) return;
    if (!sel || sel.side === t.side) { setSel(t); return; }
    if (sel.i === t.i) {
      const nd = new Set(done); nd.add(t.i); setDone(nd); setSel(null);
      if (nd.size === set.length) complete(misses);
    } else {
      setMisses((m) => m + 1);
      const keys = [`${sel.side}${sel.i}`, `${t.side}${t.i}`];
      setShake(keys); setSel(null);
      setTimeout(() => setShake([]), 400);
    }
  }

  if (error) return <p className="err">{error}</p>;
  if (!c) return <div className="center">Loading…</div>;

  if (finish) {
    return (
      <div className="qcard summary">
        <span className="bignum">{finish.secs} s</span>
        <p className="qtext" style={{ marginTop: 10 }}>All pairs matched with {misses} {misses === 1 ? "mistake" : "mistakes"}.</p>
        <p className="muted">+{finish.xp} XP{finish.secs < 60 && misses === 0 ? " · under a minute with no mistakes" : ""}</p>
        <div className="row">
          <button className="primary" onClick={() => setRound((r) => r + 1)}>Play again</button>
          <button className="ghost" onClick={() => nav(`/chapter/${c.id}`)}>Back to chapter</button>
        </div>
      </div>
    );
  }

  const tile = (t: Tile) => {
    const key = `${t.side}${t.i}`;
    const cls = [done.has(t.i) ? "done" : "", sel && sel.side === t.side && sel.i === t.i ? "sel" : "", shake.includes(key) ? "shake" : ""].join(" ");
    return <button key={key} className={`tile ${cls}`} onClick={() => click(t)}>{t.text}</button>;
  };

  return (
    <>
      <Link className="back" to={`/chapter/${c.id}`}><Icon name="back" size={16} />{c.label}</Link>
      <div className="qhead"><span>Pick a term, then its meaning</span><span>{elapsed} s · {misses} missed</span></div>
      <div className="match">
        <div className="col">{left.map(tile)}</div>
        <div className="col">{right.map(tile)}</div>
      </div>
    </>
  );
}
