import bcrypt from 'bcryptjs';
import { readDb } from './db.js';

const COOKIE_NAME = 'sm_session';
const SESSION_DAYS = 14;

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function fromB64url(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}

function sign(payload, secret) {
  const data = b64url(payload);
  const sig = Buffer.from(data + secret).toString('base64url').slice(0, 32);
  return data + '.' + sig;
}

function verify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = Buffer.from(parts[0] + secret).toString('base64url').slice(0, 32);
  if (parts[1] !== expected) return null;
  try {
    const payload = fromB64url(parts[0]);
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function secret() {
  return process.env.SESSION_SECRET || 'slobodno-misto-dev-secret-change-in-prod';
}

export function createSession(userId) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return sign({ sub: userId, exp }, secret());
}

export function parseSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(COOKIE_NAME + '=([^;]+)'));
  if (!match) return null;
  return verify(decodeURIComponent(match[1]), secret());
}

export function sessionCookie(token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getUserFromRequest(req) {
  const session = parseSession(req);
  if (!session) return null;
  const db = readDb();
  const user = db.users.find((u) => u.id === session.sub);
  if (!user) return null;
  return sanitizeUser(user);
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    points: user.points,
    role: user.role,
    createdAt: user.createdAt
  };
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export { COOKIE_NAME };
