import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type Badge } from "../api";
import { useProfile } from "../state";
import { useChapter } from "./Chapter";
import { GradeBox } from "../components/GradeBox";
import { Icon } from "../components/ui";

export function Learn() {
  const nav = useNavigate();
  const { reward, toast } = useProfile();
  const { data: c, error, setData } = useChapter();
  const [params, setParams] = useSearchParams();
  const [flipped, setFlipped] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const fcRef = useRef<HTMLDivElement>(null);

  const count = c?.cards.length ?? 0;
  const i = Math.min(Math.max(Number(params.get("i") ?? 0) || 0, 0), Math.max(count - 1, 0));
  const card = c?.cards[i];

  useEffect(() => {
    setFlipped(false);
    setNote(card?.note ?? "");
    setNoteOpen(!!card?.note);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the flip area to whichever face is taller.
  useLayoutEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    fc.style.minHeight = "";
    const back = fc.querySelector<HTMLElement>(".back");
    fc.style.minHeight = `${Math.max(280, back?.scrollHeight ?? 0)}px`;
  }, [card?.id]);

  const goTo = (n: number) => setParams({ i: String(n) }, { replace: true });

  async function markSeenAndAdvance() {
    if (!c || !card) return;
    if (!card.seen) {
      const r = await api.post<{ xp: number; newBadges: Badge[] }>(`/cards/${card.id}/seen`);
      setData({ ...c, cards: c.cards.map((k) => (k.id === card.id ? { ...k, seen: true } : k)) });
      reward(r.xp, r.newBadges);
    }
    if (i === count - 1) nav(`/chapter/${c.id}`);
    else goTo(i + 1);
  }

  async function toggleStar() {
    if (!c || !card) return;
    const r = await api.put<{ starred: boolean }>(`/cards/${card.id}/star`, { starred: !card.starred });
    setData({ ...c, cards: c.cards.map((k) => (k.id === card.id ? { ...k, starred: r.starred } : k)) });
  }

  async function saveNote() {
    if (!c || !card || note === card.note) return;
    setSaving(true);
    try {
      await api.put(`/cards/${card.id}/note`, { note });
      setData({ ...c, cards: c.cards.map((k) => (k.id === card.id ? { ...k, note } : k)) });
      toast("Note saved");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === "ArrowRight") { e.preventDefault(); markSeenAndAdvance(); }
      else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); goTo(i - 1); }
      else if (e.key === "s") toggleStar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <p className="err">{error}</p>;
  if (!c || !card) return <div className="center">Loading…</div>;

  return (
    <>
      <Link className="back" to={`/chapter/${c.id}`}><Icon name="back" size={16} />{c.label}</Link>
      <div className="qhead">
        <span>Card {i + 1} of {count}{card.seen ? " · read" : ""}</span>
        <span className="small kbdhint"><kbd>Space</kbd> flip · <kbd>←</kbd><kbd>→</kbd> move · <kbd>S</kbd> star</span>
      </div>
      <div className="dots" aria-label="Jump to card">
        {c.cards.map((k, j) => (
          <button key={k.id} title={k.title} className={`${k.seen ? "seen" : ""} ${j === i ? "cur" : ""}`} onClick={() => goTo(j)} />
        ))}
      </div>
      <div className="flip">
        <div ref={fcRef} className={`fc ${flipped ? "on" : ""}`} role="button" tabIndex={0} aria-label="Flip card" onClick={() => setFlipped((f) => !f)}>
          <div className="face front">
            <h3>{card.title}</h3>
            <p className="muted">What do you remember about this? Try to recall before flipping.</p>
            <span className="hint">Tap or press Space to flip</span>
          </div>
          <div className="face back">
            <h3>{card.title}</h3>
            <ul>{card.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        </div>
      </div>

      <div className="cardtools">
        <button className={`iconbtn ${card.starred ? "on" : ""}`} onClick={toggleStar}>{card.starred ? "★ Starred" : "☆ Star"}</button>
        <button className={`iconbtn ${noteOpen ? "on" : ""}`} onClick={() => setNoteOpen((o) => !o)}>✎ {card.note ? "Edit note" : "Add note"}</button>
        <button className={`iconbtn ${explainOpen ? "on" : ""}`} onClick={() => setExplainOpen((o) => !o)}>Explain it in your words</button>
      </div>
      {explainOpen && <GradeBox kind="card" id={card.id} title="Explain this concept" placeholder={`Explain “${card.title}” in your own words — try before flipping the card…`} />}
      {noteOpen && (
        <div className="notebox">
          <textarea className="field" value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
            placeholder="Your own words, an example from work, a mnemonic…" />
          <span className="small muted">{saving ? "Saving…" : note !== card.note ? "Unsaved — click outside to save" : card.note ? "Saved" : ""}</span>
        </div>
      )}

      <div className="row">
        <button className="ghost" disabled={i === 0} onClick={() => goTo(i - 1)}>Previous</button>
        <button className="primary" onClick={markSeenAndAdvance}>{i === count - 1 ? "Finish" : "Next card"}</button>
      </div>
    </>
  );
}
