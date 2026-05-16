import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');
const TMP_PATH = '/tmp/slobodno-misto-db.json';

function getDbPath() {
  if (process.env.VERCEL) return TMP_PATH;
  return path.join(__dirname, '..', '..', 'data', 'db.json');
}

function defaultDb() {
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch {
    return { users: [], spots: [], redemptions: [] };
  }
}

export function readDb() {
  const dbPath = getDbPath();
  try {
    if (!fs.existsSync(dbPath)) {
      const seed = defaultDb();
      writeDb(seed);
      return seed;
    }
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    const seed = defaultDb();
    writeDb(seed);
    return seed;
  }
}

export function writeDb(data) {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

export function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
