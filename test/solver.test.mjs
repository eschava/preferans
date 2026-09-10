// Cross-check: the alpha-beta double-dummy search must agree, on every position,
// with a plain exhaustive minimax that shares nothing with it but the rules.
import assert from 'node:assert/strict';
import {
  makeDeck, setRandom, legalCards, trickWinner, newGame, applyAction, viewFor, controllerOf,
} from '../src/engine.js';
import { ddValue, bestCard, setPlayBudget, setNodeLimit } from '../src/solver.js';
import { botAction } from '../src/bots.js';

const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rnd = seeded(2024);
setRandom(rnd);

function brute(hands, turn, contract, countSeats, maxSeats, trick) {
  if (hands.every((h) => !h.length)) return 0;
  const g = { contract, trick, hands, trickNo: 0, talon: [] };
  const legal = legalCards(g, turn);
  const maximizing = maxSeats.includes(turn);
  let best = maximizing ? -Infinity : Infinity;
  for (const c of legal) {
    const h2 = hands.map((h, i) => (i === turn ? h.filter((x) => x !== c) : h.slice()));
    const t2 = [...trick, { player: turn, card: c }];
    let v;
    if (t2.length === 3) {
      const w = trickWinner(t2, contract.suit === 'nt' ? null : contract.suit);
      v = (countSeats.includes(w) ? 1 : 0) + brute(h2, w, contract, countSeats, maxSeats, []);
    } else {
      v = brute(h2, (turn + 1) % 3, contract, countSeats, maxSeats, t2);
    }
    best = maximizing ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

let checked = 0;
for (let n = 0; n < 240; n++) {
  const deck = makeDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const per = 3 + (n % 3);          // 3..5 cards each: brute force stays feasible                       // 3 or 4 cards each: brute force stays feasible
  const hands = [0, 1, 2].map((s) => deck.slice(s * per, (s + 1) * per));
  const suit = ['s', 'c', 'd', 'h', 'nt'][n % 5];
  const contract = { level: 6, suit };
  const trump = suit === 'nt' ? null : suit;
  const turn = n % 3;
  // rotate through the goals the game actually uses
  const goals = [
    { countSeats: [0], maxSeats: [0] },          // declarer maximising own tricks
    { countSeats: [1, 2], maxSeats: [1, 2] },    // defence maximising its own
    { countSeats: [0], maxSeats: [1, 2] },       // misère: declarer minimising
    { countSeats: [turn], maxSeats: [0, 1, 2].filter((s) => s !== turn) },   // all-pass, paranoid
  ][n % 4];
  const want = brute(hands, turn, contract, goals.countSeats, goals.maxSeats, []);
  const got = ddValue({ hands, turn, trump, ...goals });
  assert.equal(got, want, `deal ${n}: search ${got}, brute force ${want}`);
  checked++;
}
console.log(`ok — ${checked} positions agree with brute-force minimax`);

// The card actually chosen must be optimal, from every position in the trick —
// on lead, second and third hand. With all hands visible the sampling is exact,
// so bestCard has to agree with brute force on which cards are best.
let picks = 0;
for (let n = 0; n < 90; n++) {
  const deck = makeDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const per = 3 + (n % 2);
  const hands = [0, 1, 2].map((s) => deck.slice(s * per, (s + 1) * per));
  const suit = ['s', 'c', 'd', 'h', 'nt'][n % 5];
  const contract = { level: 6, suit };
  const trump = suit === 'nt' ? null : suit;
  const declarer = n % 3;
  const inTrick = n % 3;                       // 0 = on lead, 1 = second hand, 2 = third
  const me = (declarer + 1 + (n % 2)) % 3;     // a defender
  const trick = [];
  for (let k = inTrick; k > 0; k--) {
    const seat = (me - k + 3) % 3;
    const g0 = { contract, trick, hands, trickNo: 0, talon: [] };
    const c = legalCards(g0, seat)[0];
    hands[seat] = hands[seat].filter((x) => x !== c);
    trick.push({ player: seat, card: c });
  }
  const g = { contract, trick, hands, trickNo: 0, talon: [] };
  const legal = legalCards(g, me);
  if (legal.length < 2) continue;
  const countSeats = [1, 2].map((k) => (declarer + k) % 3);
  const view = {
    you: me, playFor: me, phase: 'play', hands, handCounts: hands.map((h) => h.length),
    legal, trick, trickNo: 0, playedCards: trick.map((p) => p.card), talon: null,
    discard: [], contract, declarer, forcedSuit: null,
  };
  // brute force: value of every legal card, from the defence's point of view
  let bestVal = -Infinity;
  const vals = new Map();
  for (const c of legal) {
    const h2 = hands.map((h, i) => (i === me ? h.filter((x) => x !== c) : h.slice()));
    const t2 = [...trick, { player: me, card: c }];
    let val;
    if (t2.length === 3) {
      const w = trickWinner(t2, trump);
      val = (countSeats.includes(w) ? 1 : 0) + brute(h2, w, contract, countSeats, countSeats, []);
    } else {
      val = brute(h2, (me + 1) % 3, contract, countSeats, countSeats, t2);
    }
    vals.set(c, val);
    if (val > bestVal) bestVal = val;
  }
  // a tiny table forces the mid-search wipe: it may cost speed, never the answer
  const chosen = bestCard(view, { samples: 1, ttLimit: n % 3 === 0 ? 64 : 400000 });
  assert.equal(vals.get(chosen), bestVal,
    `deal ${n}: solver played ${chosen} worth ${vals.get(chosen)}, best is ${bestVal}`);
  picks++;
}
console.log(`ok — ${picks} card choices match brute-force optimal play`);

// The solver drives the real bots: every card it picks must be legal, and a
// deal must always reach its end.
setPlayBudget(1);
setNodeLimit(20000);          // throttled: this checks legality, not strength
let cards = 0, deals = 0;
for (let n = 0; n < 3; n++) {
  const g = newGame({ poolTarget: 4 });
  for (let i = 0; i < 9000 && g.phase !== 'game_over'; i++) {
    if (g.phase === 'deal_end') { deals++; applyAction(g, 0, { type: 'next' }); continue; }
    const seat = controllerOf(g, g.turn);
    const a = botAction(viewFor(g, seat));
    if (g.phase === 'play' && a.type === 'play') {          // a settled ending is claimed, not played
      assert.ok(legalCards(g, g.turn).includes(a.card), `solver played an illegal card ${a.card}`);
      cards++;
    }
    applyAction(g, seat, a);
  }
  assert.equal(g.phase, 'game_over');
}
assert.ok(cards > 300, `too few cards played: ${cards}`);
console.log(`ok — ${cards} cards played by the solver across ${deals} deals, all legal`);
