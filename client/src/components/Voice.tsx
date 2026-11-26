import { useEffect, useRef, useState } from "react";

/* ============================================================
   Voice: speech-to-text (your answers) and text-to-speech
   (the interviewer), using the browser's built-in engines.
   ============================================================ */

type Rec = {
  continuous: boolean; interimResults: boolean; lang: string;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};
const SR = (typeof window !== "undefined" ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) : undefined) as (new () => Rec) | undefined;
export const canListen = !!SR;
export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

export type Spoken = { seconds: number; words: number };

/**
 * Mic button: tap to talk, tap again to stop. Final text is appended to the answer;
 * the words you are still saying show live underneath.
 */
export function MicButton({ value, onChange, onSpoken, disabled }: { value: string; onChange: (v: string) => void; onSpoken?: (s: Spoken) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => { if (!on) return; setSecs(0); const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t); }, [on]);
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const base = useRef(value);
  const started = useRef(0);
  const total = useRef<Spoken>({ seconds: 0, words: 0 });
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => () => rec.current?.abort(), []);
  if (!SR) return null;

  function start() {
    setErr(null);
    const r = new SR!();
    r.continuous = true; r.interimResults = true; r.lang = navigator.language || "en-GB";
    base.current = latest.current;
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript.trim() + " ";
        else live += res[0].transcript;
      }
      const sep = base.current && !/\s$/.test(base.current) ? " " : "";
      onChange(base.current + (finalText ? sep + finalText.trimEnd() : ""));
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setErr("Microphone blocked. Allow it in your browser or phone settings.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setErr(`Voice input stopped (${e.error}).`);
    };
    r.onend = () => {
      setOn(false); setInterim("");
      const secs = Math.round((Date.now() - started.current) / 1000);
      const words = finalText.trim() ? finalText.trim().split(/\s+/).length : 0;
      total.current = { seconds: total.current.seconds + secs, words: total.current.words + words };
      if (words) onSpoken?.(total.current);
    };
    rec.current = r;
    started.current = Date.now();
    try { r.start(); setOn(true); } catch { setErr("Couldn't start the microphone."); }
  }
  function stop() { rec.current?.stop(); }

  return (
    <div className="mic">
      <button type="button" className={`micbtn ${on ? "on" : ""}`} onClick={on ? stop : start} disabled={disabled} aria-pressed={on}
        aria-label={on ? "Stop recording" : "Answer by voice"}>
        {on ? (<>
          <span className="rec-dot" aria-hidden="true" />
          <span className="mic-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
          <span className="rec-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
          <span className="rec-stop">Done</span>
        </>) : (<>
          <span className="mic-ic" aria-hidden="true"><MicIcon /></span>Speak your answer
        </>)}
      </button>
      {interim && <p className="mic-live">{interim}</p>}
      {err && <p className="err small">{err}</p>}
    </div>
  );
}

function MicIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
}

/* ---------- the interviewer's voice ---------- */
const KEY = "ddia-voice";
export function voiceOn() { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } }
export function setVoiceOn(v: boolean) { try { localStorage.setItem(KEY, v ? "on" : "off"); } catch { /* ignore */ } if (!v) window.speechSynthesis?.cancel(); }

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const pref = ["Samantha", "Daniel", "Google UK English Female", "Google US English", "Microsoft Aria", "Microsoft Libby", "Serena", "Karen"];
  return pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) ?? vs.find((v) => v.localService) ?? vs[0];
}
/** Read text aloud (interviewer questions). Strips markdown/code marks so it sounds natural. */
export function speak(text: string, onEnd?: () => void) {
  if (!canSpeak || !voiceOn()) { onEnd?.(); return; }
  const clean = text.replace(/```[\s\S]*?```/g, " (see the code on screen) ").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = 1.02; u.pitch = 1;
  u.onend = () => onEnd?.();
  window.speechSynthesis.speak(u);
}
export function stopSpeaking() { if (canSpeak) window.speechSynthesis.cancel(); }

/** Small speaker toggle + "say it again" button. */
export function SpeakButton({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  if (!canSpeak) return null;
  return (
    <button type="button" className="speakbtn" aria-label={playing ? "Stop" : "Read aloud"}
      onClick={() => { if (playing) { stopSpeaking(); setPlaying(false); } else { setVoiceOn(true); setPlaying(true); speak(text, () => setPlaying(false)); } }}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4z" />{playing ? <path d="M16 9l5 6M21 9l-5 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
      </svg>
    </button>
  );
}
