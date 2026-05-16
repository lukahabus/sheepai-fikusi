import { readDb } from '../_lib/db.js';
import { checkPassword, createSession, sessionCookie, sanitizeUser } from '../_lib/auth.js';
import { json, readBody } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  try {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const db = readDb();
    const user = db.users.find((u) => u.email === email);
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      return json(res, 401, { error: 'Pogrešan email ili lozinka.' });
    }

    const token = createSession(user.id);
    return json(res, 200, { user: sanitizeUser(user) }, {
      'Set-Cookie': sessionCookie(token)
    });
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' });
  }
}
