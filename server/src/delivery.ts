/* ---------- spoken answers: fair grading of transcripts + delivery stats ---------- */

export const SPOKEN_NOTE =
  "<note>The student answered OUT LOUD; this is an automatic speech-to-text transcript. Ignore punctuation, casing and obvious " +
  "mis-transcriptions (homophones, split words). Grade the substance as if it were spoken in an interview.</note>\n";

export type Spoken = { seconds: number; words: number };

export function readSpoken(x: unknown): Spoken | null {
  const o = x as { seconds?: unknown; words?: unknown } | null;
  const seconds = Number(o?.seconds), words = Number(o?.words);
  return seconds > 2 && words > 3 && seconds < 3600 ? { seconds, words } : null;
}

const FILLERS = /\b(um+|uh+|erm+|hmm+|like|you know|basically|actually|literally|sort of|kind of|i mean)(?=\W|$)/gi;

export function delivery(text: string, s: Spoken) {
  const wpm = Math.round(s.words / (s.seconds / 60));
  const found = (text.match(FILLERS) ?? []).map((f) => f.toLowerCase());
  const tally = found.reduce<Record<string, number>>((m, f) => ({ ...m, [f]: (m[f] ?? 0) + 1 }), {});
  const counts = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const per100 = s.words ? (found.length / s.words) * 100 : 0;
  const notes: string[] = [];
  if (wpm > 175) notes.push("You were talking fast. Slow down a little, especially on the key point.");
  else if (wpm < 105) notes.push("Quite slow. Aim for a steady 120-160 words a minute.");
  else notes.push("Good pace.");
  if (per100 >= 4) notes.push(`Lots of filler words (${counts.slice(0, 3).map(([w, n]) => `"${w}" x${n}`).join(", ")}). A short pause sounds more confident.`);
  else if (found.length) notes.push("Only a few filler words. Nice.");
  if (s.seconds > 180) notes.push("Over 3 minutes. Lead with the answer, then add detail if they ask.");
  else if (s.seconds < 25 && s.words < 60) notes.push("Very short. Add one concrete example or trade-off.");
  return { seconds: s.seconds, words: s.words, wpm, fillers: found.length, topFillers: counts.slice(0, 3).map(([word, n]) => ({ word, n })), notes };
}
