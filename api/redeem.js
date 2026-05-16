import { readDb, writeDb, uid } from './_lib/db.js';
import { getUserFromRequest } from './_lib/auth.js';
import { json, readBody } from './_lib/http.js';

const REWARDS = {
  coffee: { cost: 30, label: 'Kava — Kafić Žnjan' },
  bus: { cost: 50, label: 'Promet karta' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const user = getUserFromRequest(req);
  if (!user) return json(res, 401, { error: 'Prijavite se.' });

  try {
    const body = await readBody(req);
    const rewardId = String(body.rewardId || '');
    const reward = REWARDS[rewardId];
    if (!reward) return json(res, 400, { error: 'Nepoznata nagrada.' });

    const db = readDb();
    const u = db.users.find((x) => x.id === user.id);
    if (!u || u.points < reward.cost) {
      return json(res, 402, {
        error: `Nedovoljno bodova. Potrebno ${reward.cost}, imaš ${u ? u.points : 0}.`,
        needed: reward.cost,
        have: u ? u.points : 0
      });
    }

    u.points -= reward.cost;
    db.redemptions.push({
      id: uid('r'),
      userId: user.id,
      rewardId,
      label: reward.label,
      pointsSpent: reward.cost,
      createdAt: new Date().toISOString()
    });
    writeDb(db);

    return json(res, 200, { ok: true, points: u.points, reward: reward.label });
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' });
  }
}
