import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db.js";

const COOKIE = "ddia_session";
const SESSION_DAYS = 30;

export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function startSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : !!process.env.RAILWAY_ENVIRONMENT,
    maxAge: SESSION_DAYS * 86_400_000,
    path: "/",
  });
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.clearCookie(COOKIE, { path: "/" });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId: number }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE);
  const row = token
    ? (db.prepare("SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?").get(token, Date.now()) as
        { user_id: number } | undefined)
    : undefined;
  if (!row) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  req.userId = row.user_id;
  next();
}
