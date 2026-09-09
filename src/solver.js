// Perfect-Information Monte Carlo card play.
//
// The bot cannot see the other hands, so it samples them: deal the unseen cards
// into the hidden hands at random but consistent with what is known, solve that
// complete deal exactly (double dummy) with alpha-beta, and average the result
// of every candidate card over the samples. This is what strong bridge and skat
// engines do; it replaces hand-written play heuristics entirely.
import { SUITS, RANKS, makeDeck, suitOf, rankIdx, trumpOf } from './engine.js';

const idx = (c) => SUITS.indexOf(suitOf(c)) * 8 + RANKS.indexOf(c.slice(1));
const cardOf = (i) => SUITS[i >> 3] + RANKS[i & 7];
const SUIT_MASK = SUITS.map((_, s) => 0xff << (s * 8));

let rnd = Math.random;
export const setSolverRandom = (fn) => { rnd = fn; };

// ---- exact solver for a fully known deal ------------------------------------

// State is kept flat and mutated in place: three hand bitmasks, up to two cards
// pending in the current trick, whose turn it is, and the goal (which seats'
// tricks are counted, which seats want that count high).
const EXACT = 0, LOWER = 1, UPPER = 2;
const scratch = [];                              // one move buffer per depth

// Node cap. Off in play — the search is exact there. Tests switch it on so the
// suite stays quick: the values go approximate, the moves stay legal.
let nodeLimit = Infinity, nodes = 0;
export const setNodeLimit = (n) => { nodeLimit = n ?? Infinity; };

function legalMask(st, seat) {
  const hand = st.hands[seat];
  const led = st.ledSuit;
  if (led < 0) return hand;
  const inLed = hand & SUIT_MASK[led];
  if (inLed) return inLed;
  const trumps = st.trumpS >= 0 ? hand & SUIT_MASK[st.trumpS] : 0;
  return trumps || hand;
}

// Cards are interchangeable when only already-played cards separate them, so a
// run of own cards collapses to its lowest. This is what keeps the tree small.
function moves(st, seat, maximizing, depth) {
  const legal = legalMask(st, seat);
  // Cards lying in the current trick still separate ranks: a king on the table
  // is exactly what makes an ace and a queen different cards.
  const onTable = (st.n > 0 ? 1 << st.p0card : 0) | (st.n > 1 ? 1 << st.p1card : 0);
  const alive = st.hands[0] | st.hands[1] | st.hands[2] | onTable;
  const mine = st.hands[seat];
  const out = scratch[depth] || (scratch[depth] = []);
  out.length = 0;
  for (let su = 0; su < 4; su++) {
    if (!(legal & SUIT_MASK[su])) continue;
    let prevAlive = false, prevMine = false;
    for (let r = 0; r < 8; r++) {
      const bit = 1 << (su * 8 + r);
      if (!(alive & bit)) continue;              // gone: does not break a run
      const isMine = (mine & bit) !== 0;
      if ((legal & bit) && !(isMine && prevAlive && prevMine)) out.push(su * 8 + r);
      prevAlive = true; prevMine = isMine;
    }
  }
  if (maximizing) out.reverse();                 // want tricks: try the big cards first
  return out;
}

function winnerOf(st, c2seat, c2card) {
  const suit = st.ledSuit, tr = st.trumpS;
  const w = (card) => ((card >> 3) === tr ? 200 : (card >> 3) === suit ? 100 : 0) + (card & 7);
  let bs = st.p0seat, bc = st.p0card;
  if (w(st.p1card) > w(bc)) { bs = st.p1seat; bc = st.p1card; }
  if (w(c2card) > w(bc)) { bs = c2seat; bc = c2card; }
  return bs;
}

function search(st, alpha, beta, depth) {
  if (!(st.hands[0] | st.hands[1] | st.hands[2])) return 0;
  if (++nodes > nodeLimit) return 0;             // throttled: see setNodeLimit
  const key = `${st.hands[0]},${st.hands[1]},${st.hands[2]},${st.turn},${st.n},${st.p0card},${st.p1card}`;
  const a0 = alpha, b0 = beta;
  const hit = st.tt.get(key);
  if (hit !== undefined) {
    if (hit.f === EXACT) return hit.v;
    if (hit.f === LOWER) { if (hit.v > alpha) alpha = hit.v; }
    else if (hit.v < beta) beta = hit.v;
    if (alpha >= beta) return hit.v;
  }

  const seat = st.turn;
  const maximizing = st.max[seat];
  const list = moves(st, seat, maximizing, depth).slice();
  if (hit !== undefined && hit.m >= 0) {         // the move that was best here before
    const at = list.indexOf(hit.m);
    if (at > 0) { list.splice(at, 1); list.unshift(hit.m); }
  }
  const savedLed = st.ledSuit;
  let best = maximizing ? -1 : 99, bestMove = -1;

  for (const card of list) {
    st.hands[seat] &= ~(1 << card);
    let value;
    if (st.n === 0) {
      st.p0seat = seat; st.p0card = card; st.n = 1;
      if (savedLed < 0) st.ledSuit = card >> 3;
      st.turn = (seat + 1) % 3;
      value = search(st, alpha, beta, depth + 1);
      st.n = 0; st.ledSuit = savedLed;
    } else if (st.n === 1) {
      st.p1seat = seat; st.p1card = card; st.n = 2;
      st.turn = (seat + 1) % 3;
      value = search(st, alpha, beta, depth + 1);
      st.n = 1;
    } else {
      const w = winnerOf(st, seat, card);
      const add = st.count[w] ? 1 : 0;
      const sN = st.n, s0c = st.p0card, s1c = st.p1card, s0s = st.p0seat, s1s = st.p1seat;
      st.n = 0; st.trickNo++;
      st.turn = st.lead(st.trickNo, w);
      st.ledSuit = st.forced(st.trickNo);
      value = add + search(st, alpha - add, beta - add, depth + 1);
      st.trickNo--; st.n = sN; st.p0card = s0c; st.p1card = s1c; st.p0seat = s0s; st.p1seat = s1s;
      st.ledSuit = savedLed;
    }
    st.turn = seat;
    st.hands[seat] |= 1 << card;

    if (maximizing) { if (value > best) { best = value; bestMove = card; } if (best > alpha) alpha = best; }
    else { if (value < best) { best = value; bestMove = card; } if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  if (st.tt.size >= st.ttLimit) st.tt.clear();     // a wiped table costs speed, not correctness
  st.tt.set(key, { v: best, f: best <= a0 ? UPPER : best >= b0 ? LOWER : EXACT, m: bestMove });
  return best;
}

// Zero-window probing (MTD(f)): "can they take at least k?" prunes far harder
// than one wide window, and the value is an integer 0..10, so a couple of
// probes converge. Seeded with the previous move's value.
function exactValue(st, guess) {
  let g = guess, lower = -1, upper = 99;
  while (lower < upper) {
    const beta = g === lower ? g + 1 : g;
    g = search(st, beta - 1, beta, 0);
    if (g < beta) upper = g; else lower = g;
  }
  return g;
}

// ---- sampling the hidden hands ---------------------------------------------

function unseenCards(v) {
  const seen = new Set(v.playedCards || []);
  v.hands.forEach((h) => h && h.forEach((c) => seen.add(c)));
  v.trick.forEach((p) => seen.add(p.card));
  if (Array.isArray(v.talon)) v.talon.forEach((c) => c && seen.add(c));
  if (Array.isArray(v.discard)) v.discard.forEach((c) => c && c.length > 1 && seen.add(c));
  return makeDeck().filter((c) => !seen.has(c));
}

function dealHidden(v, pool) {
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let at = 0;
  return [0, 1, 2].map((s) => {
    if (v.hands[s]) return v.hands[s].slice();
    return pool.slice(at, (at += v.handCounts[s]));   // leftovers stay dead (talon/discard)
  });
}

// ---- entry point ------------------------------------------------------------

function goalOf(v, me) {
  const defenders = [1, 2].map((k) => (v.declarer + k) % 3);
  if (v.contract.raspas) {                       // paranoid: everyone feeds tricks to me
    return { count: [me], max: [0, 1, 2].filter((s) => s !== me) };
  }
  if (v.contract.misere) return { count: [v.declarer], max: defenders };
  if (me === v.declarer) return { count: [v.declarer], max: [v.declarer] };
  return { count: defenders, max: defenders };
}

// Exposed for the cross-check against a brute-force minimax in the tests.
export function ddValue({ hands, turn, trump, countSeats, maxSeats }) {
  const masks = hands.map((h) => h.reduce((m, c) => m | (1 << idx(c)), 0));
  const st = {
    hands: masks, turn, trumpS: trump === null ? -1 : SUITS.indexOf(trump),
    trickNo: 0, ledSuit: -1, n: 0, p0seat: 0, p0card: 0, p1seat: 0, p1card: 0,
    count: [0, 1, 2].map((s) => countSeats.includes(s)),
    max: [0, 1, 2].map((s) => maxSeats.includes(s)),
    forced: () => -1, lead: (n, w) => w, tt: new Map(), ttLimit: Infinity,
  };
  return exactValue(st, 0);
}

// Sampling is self-tuning: run one determinization, see how long it took, then
// fit as many more as the time budget allows. Early tricks are expensive and get
// few samples; from the middle of the deal the search is nearly free.
let budgetMs = 250;
export const setPlayBudget = (ms) => { budgetMs = ms; };

export function bestCard(v, { samples = 0, ttLimit = 400000 } = {}) {
  const legal = v.legal;
  if (legal.length < 2) return legal[0];
  const me = v.playFor;
  const { count, max } = goalOf(v, me);
  const countArr = [0, 1, 2].map((s) => count.includes(s));
  const maxArr = [0, 1, 2].map((s) => max.includes(s));
  const maximizing = maxArr[me];
  const trumpS = trumpOf(v.contract) === null ? -1 : SUITS.indexOf(trumpOf(v.contract));

  // the forced-suit rule of an all-pass deal, as far as it is known
  const talon = Array.isArray(v.talon) ? v.talon : [];
  const base = v.trickNo;
  const forcedIdx = (n) => {
    const su = n === base ? (v.forcedSuit ?? null)
      : (v.contract.raspas && n < 2 && talon[n] ? suitOf(talon[n]) : null);
    return su === null ? -1 : SUITS.indexOf(su);
  };

  // an all-pass deal keeps the lead with the hand left of the dealer for three
  // tricks, whoever takes them (engine.leadOf)
  const eldest = v.contract.raspas ? (v.dealer + 1) % 3 : -1;
  const leadFor = (n, w) => (eldest >= 0 && n < 3 ? eldest : w);

  const totals = new Map(legal.map((c) => [c, 0]));
  const pool = unseenCards(v);
  nodes = 0;
  let planned = samples || 64;
  const started = Date.now();
  for (let s = 0; s < planned; s++) {
    if (!samples && s === 1) {
      const spent = Math.max(1, Date.now() - started);
      planned = Math.max(1, Math.min(24, Math.floor(budgetMs / spent)));
    }
    const hands = dealHidden(v, pool.slice());
    const tt = new Map();                        // shared by every root move of this sample
    const baseMasks = hands.map((h) => h.reduce((m, c) => m | (1 << idx(c)), 0));
    let guess = 5;
    for (const card of legal) {
      const masks = baseMasks.slice();
      masks[me] &= ~(1 << idx(card));
      const played = v.trick.map((p) => ({ seat: p.player, card: idx(p.card) }))
        .concat([{ seat: me, card: idx(card) }]);
      const ledIdx = forcedIdx(v.trickNo) >= 0 ? forcedIdx(v.trickNo) : (played[0].card >> 3);
      // every card of the trick so far, our own included, stays pending
      const st = {
        hands: masks, turn: (me + 1) % 3, trumpS, trickNo: v.trickNo, ledSuit: ledIdx,
        n: played.length, p0seat: 0, p0card: 0, p1seat: 0, p1card: 0,
        count: countArr, max: maxArr, forced: forcedIdx, lead: leadFor, tt, ttLimit,
      };
      st.p0seat = played[0].seat; st.p0card = played[0].card;
      if (played.length >= 2) { st.p1seat = played[1].seat; st.p1card = played[1].card; }
      let value;
      if (played.length === 3) {
        const w = winnerOf(st, played[2].seat, played[2].card);
        const add = countArr[w] ? 1 : 0;
        st.n = 0; st.trickNo++; st.turn = leadFor(st.trickNo, w); st.ledSuit = forcedIdx(st.trickNo);
        value = add + exactValue(st, Math.max(0, guess - add));
      } else {
        value = exactValue(st, guess);
      }
      guess = value;
      totals.set(card, totals.get(card) + value);
    }
  }
  let bestCard = legal[0], bestVal = maximizing ? -Infinity : Infinity;
  for (const c of legal) {
    const val = totals.get(c);
    if (maximizing ? val > bestVal : val < bestVal) { bestVal = val; bestCard = c; }
  }
  return bestCard;
}
