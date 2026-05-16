import { readDb, writeDb } from '../_lib/db.js';
import { getUserFromRequest, sanitizeUser } from '../_lib/auth.js';
import { json, readBody } from '../_lib/http.js';

export default async function handler(req, res) {
  const admin = getUserFromRequest(req);
  if (!admin || admin.role !== 'admin') {
    return json(res, 403, { error: 'Samo admin.' });
  }

  const db = readDb();

  if (req.method === 'GET') {
    const users = db.users.map(sanitizeUser);
    const spots = db.spots.filter((s) => s.expiresAt > Date.now()).length;
    return json(res, 200, { users, activeSpots: spots, redemptions: db.redemptions.length });
  }

  if (req.method === 'PATCH') {
    try {
      const body = await readBody(req);
      const userId = String(body.userId || '');
      const points = Number(body.points);
      const u = db.users.find((x) => x.id === userId);
      if (!u) return json(res, 404, { error: 'Korisnik nije pronađen.' });
      if (Number.isFinite(points)) u.points = Math.max(0, Math.floor(points));
      writeDb(db);
      return json(res, 200, { user: sanitizeUser(u) });
    } catch (e) {
      return json(res, 500, { error: e.message || 'Server error' });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
