import { getUserFromRequest } from '../_lib/auth.js';
import { json } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  const user = getUserFromRequest(req);
  if (!user) return json(res, 401, { error: 'Niste prijavljeni.' });
  return json(res, 200, { user });
}
