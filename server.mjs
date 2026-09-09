// Dev/online server: static files + one authoritative engine per room, pushed
// over SSE. Zero dependencies. `node server.mjs [port]`
// Empty seats are filled by the same bots the local game uses.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, applyAction, viewFor, controllerOf } from './src/engine.js';
import { botAction } from './src/bots.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8080);   // PORT is set by the host
const BOT_DELAY = 700;
const HOLD_MS = 60_000;        // a seat waits this long for a player who dropped out
const IDLE_MS = 3 * 3600_000;  // a room with nobody in it is forgotten after this
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const rooms = new Map();

// A code people can read out loud: no letters that look like digits.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let code;
  do { code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); }
  while (rooms.has(code));
  return code;
};

// Every game is created by somebody, with their settings. Nothing is played
// until they say so: the table waits while friends read the code and sit down,
// and whatever seats are still free when they start are played by bots.
const deal = (opts) => newGame({
  players: ['player.p1', 'player.p2', 'player.p3'],
  poolTarget: opts.poolTarget, stalingrad: opts.stalingrad, whistBlame: opts.whistBlame,
});

function create(opts) {
  const code = newCode();
  rooms.set(code, {
    game: deal(opts), opts,
    started: false,                 // the host holds the table until they start it
    host: null,                     // the token that opened it
    human: [false, false, false],   // seats a person holds; the rest are bots
    seats: new Map(),               // token -> seat, so a reload comes back to the same hand
    hold: [null, null, null],       // timers releasing a seat whose player dropped out
    clients: [], timer: null, touched: Date.now(),
  });
  return code;
}

// The view a seat is allowed to see, plus what belongs to the table rather than
// to the deal: who here is a person, whether play has started, and whose call
// starting it is.
const viewOf = (r, seat) => ({
  ...viewFor(r.game, seat), humans: r.human.slice(),
  started: r.started, hostSeat: r.seats.get(r.host) ?? 0,
});

function push(r) {
  for (const c of r.clients) {
    try { c.res.write(`data: ${JSON.stringify(viewOf(r, c.seat))}\n\n`); } catch { /* client gone */ }
  }
}

// Rooms live in memory, so let go of the ones nobody is sitting at.
setInterval(() => {
  for (const [code, r] of rooms)
    if (!r.clients.length && Date.now() - r.touched > IDLE_MS) { clearTimeout(r.timer); rooms.delete(code); }
}, 600_000).unref?.();

// Advance the deal while the seat to move is a bot.
function runBots(r) {
  clearTimeout(r.timer);
  const g = r.game;
  if (!r.started || g.phase === 'game_over') return;
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

// A seat is held by whoever knows its token — that is what a player's client
// keeps, and the only thing that says which hand it may read.
function take(r, seat) {
  const token = randomUUID();
  r.seats.set(token, seat);
  r.human[seat] = true;
  clearTimeout(r.hold[seat]); r.hold[seat] = null;
  r.touched = Date.now();
  push(r);            // the others should see the seat fill at once
  runBots(r);
  return token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // create a table: the settings are the ones the host picked
  if (url.pathname === '/api/room' && req.method === 'POST') {
    const o = await readBody(req).catch(() => ({}));
    const code = create({
      poolTarget: [10, 20, 50].includes(o.poolTarget) ? o.poolTarget : 10,
      stalingrad: !!o.stalingrad,
      whistBlame: o.whistBlame === 'short' ? 'short' : 'both',
    });
    const r = rooms.get(code);
    const token = take(r, 0);
    r.host = token;                 // the table is theirs to start and to restart
    return json(res, 200, { room: code, seat: 0, token });
  }

  const m = url.pathname.match(/^\/api\/room\/([\w-]{1,40})\/(join|stream|action)$/);

  if (m) {
    const r = rooms.get(m[1].toUpperCase());
    if (!r) return json(res, 404, { error: 'noRoom' });
    r.touched = Date.now();

    if (m[2] === 'join') {
      // coming back with a token you already hold returns your own seat
      const { token } = await readBody(req).catch(() => ({}));
      if (token && r.seats.has(token)) {
        const seat = r.seats.get(token);
        r.human[seat] = true;
        clearTimeout(r.hold[seat]); r.hold[seat] = null;
        push(r);
        runBots(r);
        return json(res, 200, { seat, token });
      }
      const seat = r.human.indexOf(false);
      if (seat < 0) return json(res, 409, { error: 'roomFull' });
      return json(res, 200, { seat, token: take(r, seat) });
    }

    if (m[2] === 'stream') {
      const seat = r.seats.get(url.searchParams.get('token'));
      if (seat === undefined) return json(res, 403, { error: 'badToken' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const client = { seat, res };
      r.clients.push(client);
      res.write(`data: ${JSON.stringify(viewOf(r, seat))}\n\n`);
      req.on('close', () => {
        r.clients = r.clients.filter((c) => c !== client);
        // hold the seat briefly — a reload should not cost you your hand — then
        // let a bot play it so the others are not stuck waiting
        if (r.clients.some((c) => c.seat === seat)) return;
        clearTimeout(r.hold[seat]);
        r.hold[seat] = setTimeout(() => { r.human[seat] = false; push(r); runBots(r); }, HOLD_MS);
      });
      return;
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'postOnly' });
    const { token, action } = await readBody(req).catch(() => ({}));
    const seat = r.seats.get(token);
    if (seat === undefined) return json(res, 403, { error: 'badToken' });
    r.human[seat] = true;                       // acting proves you are still there
    clearTimeout(r.hold[seat]); r.hold[seat] = null;

    // starting the table, and starting it over, belong to the host, not to the
    // deal — the engine knows nothing about either
    if (action?.type === 'start' || action?.type === 'newgame') {
      if (token !== r.host) return json(res, 403, { error: 'notHost' });
      if (action.type === 'newgame') r.game = deal(r.opts);
      r.started = true;
      push(r);
      runBots(r);
      return json(res, 200, { ok: true });
    }
    if (!r.started) return json(res, 403, { error: 'notStarted' });

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

server.listen(PORT, () => console.log(`Preferans: http://localhost:${PORT}`));
