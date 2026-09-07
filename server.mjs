// Dev/online server: static files + one authoritative engine per room, pushed
// over SSE. Zero dependencies. `node server.mjs [port]`
// Empty seats are filled by the same bots the local game uses.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, applyAction, viewFor, controllerOf } from './src/engine.js';
import { botAction } from './src/bots.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8080);   // PORT is set by the host
const BOT_DELAY = 700;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
};

const rooms = new Map();

function room(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      game: newGame({ players: ['player.p1', 'player.p2', 'player.p3'] }),
      human: [false, false, false], clients: [], timer: null,
    });
  }
  return rooms.get(id);
}

function push(r) {
  for (const c of r.clients) {
    try { c.res.write(`data: ${JSON.stringify(viewFor(r.game, c.seat))}\n\n`); } catch { /* client gone */ }
  }
}

// Advance the deal while the seat to move is a bot.
function runBots(r) {
  clearTimeout(r.timer);
  const g = r.game;
  if (g.phase === 'game_over') return;
  if (g.phase === 'deal_end' && r.human.some(Boolean)) return;   // a human presses "next"
  if (r.human[controllerOf(g, g.turn)]) return;
  r.timer = setTimeout(() => {
    const seat = controllerOf(g, g.turn);
    try { applyAction(g, seat, botAction(viewFor(g, seat))); } catch (e) { console.error('bot:', e.message); return; }
    push(r);
    runBots(r);
  }, BOT_DELAY);
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((ok, err) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { err(e); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/api\/room\/([\w-]{1,40})\/(join|stream|action)$/);

  if (m) {
    const r = room(m[1]);
    if (m[2] === 'join') {
      const seat = r.human.indexOf(false);
      if (seat < 0) return json(res, 409, { error: 'roomFull' });
      r.human[seat] = true;
      runBots(r);
      return json(res, 200, { seat });
    }
    if (m[2] === 'stream') {
      const seat = Number(url.searchParams.get('seat'));
      if (!(seat >= 0 && seat <= 2)) return json(res, 400, { error: 'badSeat' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const client = { seat, res };
      r.clients.push(client);
      res.write(`data: ${JSON.stringify(viewFor(r.game, seat))}\n\n`);
      req.on('close', () => { r.clients = r.clients.filter((c) => c !== client); });
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'postOnly' });
    const { seat, action } = await readBody(req).catch(() => ({}));
    if (!r.human[seat]) return json(res, 403, { error: 'seatFree' });
    try { applyAction(r.game, seat, action); } catch (e) { return json(res, 400, { error: e.message }); }
    push(r);
    runBots(r);
    return json(res, 200, { ok: true });
  }

  // static files
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    const buf = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => console.log(`Preferans: http://localhost:${PORT}  (online table: /?room=test)`));
