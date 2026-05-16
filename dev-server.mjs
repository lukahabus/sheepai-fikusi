import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;

const handlers = {
  '/api/auth/register': () => import('./api/auth/register.js'),
  '/api/auth/login': () => import('./api/auth/login.js'),
  '/api/auth/logout': () => import('./api/auth/logout.js'),
  '/api/auth/me': () => import('./api/auth/me.js'),
  '/api/spots': () => import('./api/spots/index.js'),
  '/api/redeem': () => import('./api/redeem.js'),
  '/api/admin/users': () => import('./api/admin/users.js')
};

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

function mockRes(res) {
  const headers = {};
  return {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    end(body) {
      res.writeHead(this.statusCode, headers);
      res.end(body);
    }
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/spots/') && url.pathname !== '/api/spots') {
    const id = url.pathname.split('/').pop();
    req.query = { id };
    const mod = await import('./api/spots/[id].js');
    return mod.default(req, mockRes(res));
  }

  const loader = handlers[url.pathname];
  if (loader) {
    const mod = await loader();
    return mod.default(req, mockRes(res));
  }

  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, filePath.replace(/^\//, ''));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log('Slobodno Misto dev: http://localhost:' + PORT);
});
