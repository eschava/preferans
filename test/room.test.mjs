// The online table: codes, seats, tokens, and what a seat's stream may show.
// Starts a real server on a spare port and talks to it over HTTP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 8123 + (process.pid % 300);
const B = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), String(PORT)],
  { stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => server.kill();
process.on('exit', stop);

const post = (p, b) => fetch(B + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}),
}).then((r) => r.json());

// one SSE frame, then hang up
const first = async (url) => {
  const c = new AbortController();
  const r = await fetch(url, { signal: c.signal });
  if (r.headers.get('content-type')?.includes('json')) { const b = await r.json(); c.abort(); return b; }
  const chunk = (await r.body.getReader().read()).value;
  c.abort();
  return JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /, ''));
};

for (let i = 0; i < 50; i++) {                       // wait for the port to answer
  try { await fetch(B + '/api/room/AAAAA/join', { method: 'POST' }); break; }
  catch { await new Promise((r) => setTimeout(r, 100)); }
}

try {
  const made = await post('/api/room', { poolTarget: 50, stalingrad: true, whistBlame: 'short' });
  assert.match(made.room, /^[A-Z0-9]{5}$/, 'a code you can read out loud');
  assert.equal(made.seat, 0, 'whoever opens the table sits down first');

  const v0 = await first(`${B}/api/room/${made.room}/stream?token=${made.token}`);
  assert.equal(v0.poolTarget, 50, "the host's settings made it into the game");
  assert.equal(v0.stalingrad, true);
  assert.equal(v0.whistBlame, 'short');
  assert.deepEqual(v0.humans, [true, false, false], 'bots hold the seats nobody took');
  assert.equal(v0.you, 0);
  assert.equal(v0.hands.filter(Boolean).length, 1, 'a stream carries one hand: its own');

  const p2 = await post(`/api/room/${made.room}/join`, {});
  const p3 = await post(`/api/room/${made.room}/join`, {});
  assert.deepEqual([p2.seat, p3.seat], [1, 2], 'the next people take the free seats');
  assert.equal((await post(`/api/room/${made.room}/join`, {})).error, 'roomFull');
  assert.equal((await post(`/api/room/${made.room}/join`, { token: made.token })).seat, 0,
    'coming back with your token returns your own seat, not a new one');

  const v2 = await first(`${B}/api/room/${made.room}/stream?token=${p2.token}`);
  assert.equal(v2.you, 1);
  assert.deepEqual(v2.humans, [true, true, true]);
  assert.equal(v2.hands[0], null, 'and neither player can read the other');
  assert.equal(v2.hands[2], null);

  // nothing is played until the host says so
  assert.equal(v0.started, false, 'a fresh table waits for its host');
  assert.equal(v0.hostSeat, 0);
  const early = await post(`/api/room/${made.room}/action`, { token: p2.token, action: { type: 'bid', contract: null } });
  assert.equal(early.error, 'notStarted', 'and nobody can act meanwhile');
  assert.equal((await post(`/api/room/${made.room}/action`, { token: p2.token, action: { type: 'start' } })).error,
    'notHost', 'starting is the host\'s call');
  assert.deepEqual(await post(`/api/room/${made.room}/action`, { token: made.token, action: { type: 'start' } }), { ok: true });
  const running = await first(`${B}/api/room/${made.room}/stream?token=${made.token}`);
  assert.equal(running.started, true);
  assert.equal(running.deal, 1);

  // the host can deal the table over; a guest cannot
  assert.equal((await post(`/api/room/${made.room}/action`, { token: p3.token, action: { type: 'newgame' } })).error, 'notHost');
  assert.deepEqual(await post(`/api/room/${made.room}/action`, { token: made.token, action: { type: 'newgame' } }), { ok: true });

  // the token is the seat: the code alone gets you nothing
  assert.equal((await first(`${B}/api/room/${made.room}/stream?token=made-up`)).error, 'badToken');
  assert.equal((await post('/api/room/ZZZZZ/join', {})).error, 'noRoom');
  const acted = await fetch(`${B}/api/room/${made.room}/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'made-up', action: { type: 'bid', contract: null } }),
  });
  assert.equal(acted.status, 403, 'no token, no move');

  console.log('ok — online table: codes, seats, tokens, one hand per stream');
} finally {
  stop();
}
