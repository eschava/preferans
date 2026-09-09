// The seam between UI and rules. The UI only ever calls send(action) and reads
// the per-seat views pushed to onState. Swapping LocalTable for RemoteTable
// turns the same UI into an online client — no UI changes needed.
import { newGame, applyAction, viewFor, controllerOf } from './engine.js';
import { botAction } from './bots.js';

// The search is heavy enough to freeze a page, so it runs in a worker where the
// platform has one. Everywhere else (an old browser, a file:// page, Node) the
// same call is made on this thread — the bots are the same either way.
const hire = () => {
  try { return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
  catch { return null; }
};

export class LocalTable {
  constructor({ seat = 0, players, poolTarget, stalingrad, whistBlame, botDelay = 700 } = {}) {
    this.seat = seat;
    this.botDelay = botDelay;
    this.listeners = [];
    this.game = newGame({ players, poolTarget, stalingrad, whistBlame });
    this.timer = null;
    this.worker = hire();
    this.asked = 0;
  }

  // What a bot would play, worked out off the page where that is possible.
  think(view) {
    if (!this.worker) return Promise.resolve(botAction(view));
    const id = ++this.asked;
    return new Promise((done) => {
      const hear = (e) => {
        if (e.data.id !== id) return;
        this.worker.removeEventListener('message', hear);
        done(e.data.action ?? botAction(view));      // a worker that failed is not a stuck table
      };
      this.worker.addEventListener('message', hear);
      this.worker.postMessage({ id, view });
    });
  }
  onState(cb) { this.listeners.push(cb); this.emit(); }
  emit() { const v = viewFor(this.game, this.seat); this.listeners.forEach((f) => f(v)); }

  send(action) {
    applyAction(this.game, this.seat, action);
    this.emit();
    this.run();
  }

  // Let bots act until it is the human's turn again. The thinking starts at once
  // and the pause runs alongside it, so a bot that answers quickly still waits
  // its moment and a slow one does not add to it.
  run() {
    clearTimeout(this.timer);
    const g = this.game;
    if (g.phase === 'game_over' || g.phase === 'deal_end') return;
    const seat = controllerOf(g, g.turn);           // in a light whist the whister moves for both
    if (seat === this.seat) return;
    const started = Date.now();
    this.think(viewFor(g, seat)).then((action) => {
      if (this.game !== g) return;                  // a new game was started meanwhile
      this.timer = setTimeout(() => {
        applyAction(g, seat, action);
        this.emit();
        this.run();
      }, Math.max(0, this.botDelay - (Date.now() - started)));
    });
  }
}

const post = (path, body) => fetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}).then((r) => r.json());

// Open a table on the server with these settings; the answer is the code to
// share and the token for the host's own seat.
export const createRoom = (opts, base = '') => post(`${base}/api/room`, opts);

// Online drop-in: same interface, state comes from the server over SSE. The
// token is the seat: it says which hand this client may read and act for, and
// coming back with it returns the same seat after a reload.
export class RemoteTable {
  constructor({ room, token, name, base = '' }) {
    this.base = `${base}/api/room/${encodeURIComponent(room)}`;
    this.listeners = [];
    this.seat = null;
    this.token = null;
    this.onError = () => {};
    this.onSeat = () => {};
    this.ready = post(`${this.base}/join`, { token, name })
      .then(({ seat, token: mine, error }) => {
        if (error) throw new Error(error);
        this.seat = seat;
        this.token = mine;
        this.onSeat({ room, seat, token: mine });
        this.es = new EventSource(`${this.base}/stream?token=${encodeURIComponent(mine)}`);
        this.es.onmessage = (e) => this.listeners.forEach((f) => f(JSON.parse(e.data)));
      })
      .catch((e) => this.onError(e.message || String(e)));   // otherwise the page just stays blank
  }
  onState(cb) { this.listeners.push(cb); }
  run() { /* the server drives the bots */ }
  send(action) {
    return fetch(`${this.base}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.token, action }),
    }).then((r) => r.ok || r.json().then((b) => { throw new Error(b.error || 'unknownAction'); }));
  }
}
