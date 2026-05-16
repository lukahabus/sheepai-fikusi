import { readDb, writeDb, uid } from '../_lib/db.js';
import { hashPassword, createSession, sessionCookie, sanitizeUser } from '../_lib/auth.js';
import { json, readBody } from '../_lib/http.js';

const START_POINTS = 8;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  try {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim() || email.split('@')[0];

    if (!email || !password || password.length < 6) {
      return json(res, 400, { error: 'Email i lozinka (min. 6 znakova) su obavezni.' });
    }

    const db = readDb();
    if (db.users.some((u) => u.email === email)) {
      return json(res, 409, { error: 'Korisnik s tim emailom već postoji.' });
    }

    const user = {
      id: uid('u'),
      email,
      passwordHash: await hashPassword(password),
      name,
      points: START_POINTS,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);

    const token = createSession(user.id);
    return json(res, 201, { user: sanitizeUser(user) }, {
      'Set-Cookie': sessionCookie(token)
    });
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' });
  }
}
