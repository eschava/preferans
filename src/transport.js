// The seam between UI and rules. The UI only ever calls send(action) and reads
// the per-seat views pushed to onState. Swapping LocalTable for RemoteTable
// turns the same UI into an online client — no UI changes needed.
import { newGame, applyAction, viewFor, controllerOf } from './engine.js';
import { botAction } from './bots.js';

export class LocalTable {
  constructor({ seat = 0, players, poolTarget, stalingrad, whistBlame, botDelay = 700 } = {}) {
    this.seat = seat;
    this.botDelay = botDelay;
    this.listeners = [];
    this.game = newGame({ players, poolTarget, stalingrad, whistBlame });
    this.timer = null;
  }
  onState(cb) { this.listeners.push(cb); this.emit(); }
  emit() { const v = viewFor(this.game, this.seat); this.listeners.forEach((f) => f(v)); }

  send(action) {
    applyAction(this.game, this.seat, action);
    this.emit();
    this.run();
  }

  // Let bots act until it is the human's turn again.
  run() {
    clearTimeout(this.timer);
    const g = this.game;
    if (g.phase === 'game_over' || g.phase === 'deal_end') return;
    const actor = controllerOf(g, g.turn);          // in a light whist the whister moves for both
    if (actor === this.seat) return;
    this.timer = setTimeout(() => {
      const seat = controllerOf(g, g.turn);
      applyAction(g, seat, botAction(viewFor(g, seat)));
      this.emit();
      this.run();
    }, this.botDelay);
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
