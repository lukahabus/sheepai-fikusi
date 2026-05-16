import { readDb, writeDb } from '../_lib/db.js';
import { getUserFromRequest } from '../_lib/auth.js';
import { json } from '../_lib/http.js';

const CLAIM_COST = 15;

export default async function handler(req, res) {
  const id = req.query?.id;
  if (!id) return json(res, 400, { error: 'Missing spot id' });

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const user = getUserFromRequest(req);
  if (!user) return json(res, 401, { error: 'Prijavite se.' });

  const db = readDb();
  const spot = db.spots.find((s) => s.id === id);
  if (!spot || spot.expiresAt <= Date.now()) {
    return json(res, 404, { error: 'Misto više nije dostupno.' });
  }

  if (spot.claimed) return json(res, 409, { error: 'Misto je već rezervirano.' });

  const u = db.users.find((x) => x.id === user.id);
  if (!u || u.points < CLAIM_COST) {
    return json(res, 402, { error: 'Nedovoljno Polza bodova (potrebno 15).' });
  }

  u.points -= CLAIM_COST;
  spot.claimed = true;
  spot.claimedBy = user.id;
  writeDb(db);

  return json(res, 200, {
    spot: {
      id: spot.id,
      claimed: true,
      claimedBy: user.id
    },
    points: u.points
  });
}
