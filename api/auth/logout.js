import { clearSessionCookie } from '../_lib/auth.js';
import { json } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}
