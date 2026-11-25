export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function str(v: unknown, name: string, min = 0, max = 10_000): string {
  if (typeof v !== "string") throw new HttpError(400, `${name} is required`);
  if (v.length < min) throw new HttpError(400, `${name} must be at least ${min} characters`);
  if (v.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return v;
}

export function int(v: unknown, name: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export const chapterLabel = (c: { id: number; tag: string | null }) => c.tag ?? `Ch ${c.id}`;
