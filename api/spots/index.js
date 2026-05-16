import { readDb, writeDb, uid } from '../_lib/db.js';
import { getUserFromRequest } from '../_lib/auth.js';
import { json, readBody } from '../_lib/http.js';

const LEAVE_REWARD = 10;
const REPORT_REWARD = 5;

function cleanSpot(s) {
  return {
    id: s.id,
    userId: s.userId,
    type: s.type,
    latlng: s.latlng,
    street: s.street,
    expiresAt: s.expiresAt,
    claimed: s.claimed,
    claimedBy: s.claimedBy || null
  };
}

export default async function handler(req, res) {
  const db = readDb();
  const now = Date.now();
  db.spots = db.spots.filter((s) => s.expiresAt > now);

  if (req.method === 'GET') {
    writeDb(db);
    const spots = db.spots.map(cleanSpot);
    return json(res, 200, { spots });
  }

  if (req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return json(res, 401, { error: 'Prijavite se za označavanje mjesta.' });

    try {
      const body = await readBody(req);
      const type = body.type === 'leaving' ? 'leaving' : 'open';
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(res, 400, { error: 'Neispravne koordinate.' });
      }

      const durationMs = type === 'leaving'
        ? (Number(body.durationSec) || 300) * 1000
        : (Number(body.durationSec) || 480) * 1000;

      const spot = {
        id: uid('s'),
        userId: user.id,
        type,
        latlng: [lat, lng],
        street: String(body.street || 'Split'),
        expiresAt: now + durationMs,
        claimed: false,
        claimedBy: null,
        createdAt: new Date().toISOString()
      };

      db.spots.push(spot);

      const u = db.users.find((x) => x.id === user.id);
      const reward = type === 'leaving' ? LEAVE_REWARD : REPORT_REWARD;
      if (u) u.points += reward;
      writeDb(db);

      return json(res, 201, {
        spot: cleanSpot(spot),
        points: u ? u.points : user.points,
        reward
      });
    } catch (e) {
      return json(res, 500, { error: e.message || 'Server error' });
    }
  }

  return json(res, 405, { error: 'Method not allowed' });
}
