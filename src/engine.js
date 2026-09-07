// Preferans rules engine: pure state machine, no DOM and no I/O.
// The same module runs in the browser (local game vs bots) and in Node (online server).

export const SUITS = ['s', 'c', 'd', 'h'];            // bidding order: low -> high
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_SYM = { s: '♠', c: '♣', d: '♦', h: '♥' };   // no-trump is a word, see format.js

export const RASPAS_TRICK = 2;   // mountain points per trick in an all-pass deal

// The whisters owe, between them: 4 tricks on a six, 2 on a seven, 1 on an
// eight or nine. A shortfall is written into their mountain.
export const WHIST_DUTY = { 6: 4, 7: 2, 8: 1, 9: 1, 10: 0 };

export const suitOf = (c) => c[0];
export const rankOf = (c) => c.slice(1);
export const rankIdx = (c) => RANKS.indexOf(c.slice(1));

// Injectable randomness so tests can be deterministic.
let rnd = Math.random;
export function setRandom(fn) { rnd = fn; }

export function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(s + r);
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sortHand(h) {
  return h.sort((a, b) =>
    SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankIdx(b) - rankIdx(a));
}

// ---- contracts -------------------------------------------------------------
// {level:6..10, suit:'s'|'c'|'d'|'h'|'nt'} | {misere:true} | {raspas:true}

const SUIT_ORDER = ['s', 'c', 'd', 'h', 'nt'];

export function contractRank(c) {
  if (!c) return -1;
  if (c.misere) return 14.5;                      // between 8NT and 9♠: only a bid of nine beats misère
  return (c.level - 6) * 5 + SUIT_ORDER.indexOf(c.suit);
}

export function contractValue(c) {
  if (c.misere) return 10;
  return (c.level - 5) * 2;                       // 6->2, 7->4, 8->6, 9->8, 10->10
}

export function allContracts() {
  const out = [];
  for (let lvl = 6; lvl <= 10; lvl++) for (const s of SUIT_ORDER) out.push({ level: lvl, suit: s });
  out.push({ misere: true });
  return out.sort((a, b) => contractRank(a) - contractRank(b));
}

export const trumpOf = (c) => (c && !c.misere && !c.raspas && c.suit !== 'nt') ? c.suit : null;

// ---- game / deal lifecycle -------------------------------------------------

export function newGame(opts = {}) {
  const g = {
    players: opts.players || ['player.you', 'player.west', 'player.east'],
    poolTarget: opts.poolTarget ?? 10,
    openOnHalfWhist: opts.openOnHalfWhist ?? true,
    deal: 0,
    dealer: 2,
    score: { pool: [0, 0, 0], mountain: [0, 0, 0], whists: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
    history: [],          // one entry per scored deal — survives startDeal
    log: [],
  };
  startDeal(g);
  return g;
}

export function startDeal(g) {
  const d = shuffle(makeDeck());
  g.deal++;
  g.dealer = (g.dealer + 1) % 3;
  g.hands = [d.slice(0, 10), d.slice(10, 20), d.slice(20, 30)].map(sortHand);
  g.dealt = g.hands.map((h) => h.slice());
  g.talon = d.slice(30, 32);
  g.talonOpen = false;
  g.bidHistory = [];
  g.passed = [false, false, false];
  g.highBid = null;
  g.highBidder = null;
  g.declarer = null;
  g.contract = null;
  g.whistDecl = [null, null, null];
  g.discard = [];
  g.trick = [];
  g.trickLead = null;
  g.lastTrick = null;
  g.playedCards = [];
  g.openHands = [false, false, false];
  g.tricks = [0, 0, 0];
  g.trickNo = 0;
  g.result = null;
  g.conceded = false;
  g.turn = (g.dealer + 1) % 3;
  g.phase = 'bidding';
  g.log = [];
  return g;
}

export const defendersOf = (g) => [1, 2].map((k) => (g.declarer + k) % 3);

// Whist in the light: when one defender whists and the other passes, the
// whister plays both defence hands.
export function controllerOf(g, seat) {
  if (g.phase !== 'play' || !g.contract || g.contract.raspas || g.contract.misere) return seat;
  if (seat === g.declarer || !g.openOnHalfWhist) return seat;
  const [d1, d2] = defendersOf(g);
  if (g.whistDecl[d1] === g.whistDecl[d2]) return seat;
  const whister = g.whistDecl[d1] ? d1 : d2;
  return seat === whister ? seat : whister;
}

// Misère is a binding bid: it may only be a player's own first call. Anyone
// who has already bid a game on tricks, or passed, can no longer name it.
export const canBidMisere = (g, seat) => !g.bidHistory.some((b) => b.seat === seat);

// Seniority in a deal: the hand left of the dealer is senior, the dealer junior.
const handRank = (g, seat) => (seat - (g.dealer + 1) + 3) % 3;

// "Repeat across the passer": instead of raising, you may name the standing bid
// itself — but only if everyone between its owner and you has passed, and you
// are senior to them (at an equal contract the senior hand takes it). The
// seniority test is what makes the bidding terminate: the junior always has to
// raise, so nobody can repeat back and forth at the same level.
export function canRepeat(g, seat) {
  if (!g.highBid || g.highBidder === seat || g.passed[seat]) return false;
  // nobody can repeat a misère: earning the right to repeat means having
  // already spoken, and after that misère is no longer available
  if (g.highBid.misere && !canBidMisere(g, seat)) return false;
  let between = 0;
  for (let s = (g.highBidder + 1) % 3; s !== seat; s = (s + 1) % 3) {
    if (!g.passed[s]) return false;
    between++;
  }
  return between > 0 && handRank(g, seat) < handRank(g, g.highBidder);
}

// ---- card play legality ----------------------------------------------------

// `led` is passed separately: in an all-pass deal the trick's suit is dictated
// by the face-up talon card, not by the first card played.
export function trickWinner(trick, trump, led) {
  const suit = led || suitOf(trick[0].card);
  const weight = (c) => (suitOf(c) === trump ? 200 : suitOf(c) === suit ? 100 : 0) + rankIdx(c);
  return trick.reduce((a, b) => (weight(b.card) > weight(a.card) ? b : a)).player;
}

// All-pass: the first two tricks must be led in the suit of the face-up talon
// card — first card for the first trick, second for the second. Its rank is
// irrelevant; the trick goes to the highest card of that suit.
export const forcedSuit = (g) =>
  g.contract && g.contract.raspas && g.trickNo < 2 && g.talon[g.trickNo]
    ? suitOf(g.talon[g.trickNo]) : null;

// Preferans: follow suit; if void, you must play a trump. Nobody is ever
// obliged to beat the cards already on the table.
export function legalCards(g, seat) {
  const hand = g.hands[seat];
  const led = forcedSuit(g) || (g.trick.length ? suitOf(g.trick[0].card) : null);
  if (!led) return hand.slice();
  const inLed = hand.filter((c) => suitOf(c) === led);
  if (inLed.length) return inLed;
  const trump = trumpOf(g.contract);
  const trumps = trump ? hand.filter((c) => suitOf(c) === trump) : [];
  return trumps.length ? trumps : hand.slice();
}

// ---- actions ---------------------------------------------------------------
// {type:'bid', contract|null} | {type:'declare', discard, contract}
// {type:'whist', whist:bool} | {type:'play', card} | {type:'next'}

export function legalActions(g, seat) {
  if (g.turn !== seat) return [];
  switch (g.phase) {
    case 'bidding': {
      const min = contractRank(g.highBid) + (canRepeat(g, seat) ? 0 : 0.5);
      const up = allContracts().filter((c) =>
        contractRank(c) >= min && (!c.misere || canBidMisere(g, seat)));
      return [{ type: 'bid', contract: null }, ...up.map((c) => ({ type: 'bid', contract: c }))];
    }
    case 'talon': return [{ type: 'declare' }];
    case 'whist': return [{ type: 'whist', whist: true }, { type: 'whist', whist: false }];
    case 'play': return legalCards(g, seat).map((card) => ({ type: 'play', card }));   // see controllerOf
    case 'deal_end': return [{ type: 'next' }];
    default: return [];
  }
}

export function applyAction(g, seat, a) {
  if (a.type === 'play') {
    if (g.phase !== 'play') throw new Error('notPlay');
    if (controllerOf(g, g.turn) !== seat) throw new Error('notYourTurn');
    return doPlay(g, g.turn, a.card);
  }
  if (g.phase !== 'deal_end' && g.turn !== seat) throw new Error('notYourTurn');
  switch (a.type) {
    case 'bid': return doBid(g, seat, a.contract);
    case 'declare': return doDeclare(g, seat, a.discard, a.contract);
    case 'whist': return doWhist(g, seat, a.whist);
    case 'next':
      if (g.phase !== 'deal_end') throw new Error('dealInProgress');
      startDeal(g);
      return g;
    default: throw new Error('unknownAction');
  }
}

function doBid(g, seat, contract) {
  if (g.phase !== 'bidding') throw new Error('notBidding');
  if (contract && contract.misere && !canBidMisere(g, seat))
    throw new Error('misereFirstBidOnly');
  g.bidHistory.push({ seat, contract });
  if (contract) {
    const r = contractRank(contract), hr = contractRank(g.highBid);
    const repeat = r === hr && canRepeat(g, seat);
    if (r < hr || (r === hr && !repeat)) throw new Error('bidTooLow');
    g.highBid = contract;
    g.highBidder = seat;
    g.log.push({ k: repeat ? 'log.bidRepeat' : 'log.bid', p: { player: seat, contract } });
  } else {
    g.passed[seat] = true;
    g.log.push({ k: 'log.pass', p: { player: seat } });
  }

  const active = [0, 1, 2].filter((s) => !g.passed[s]);
  if (!active.length) {                      // everybody passed -> all-pass deal
    g.contract = { raspas: true };
    g.log.push({ k: 'log.raspas', p: {} });
    startPlay(g, (g.dealer + 1) % 3);
    return g;
  }
  if (active.length === 1 && g.highBid) {
    g.declarer = g.highBidder;
    g.hands[g.declarer] = sortHand(g.hands[g.declarer].concat(g.talon));
    g.talonOpen = true;
    g.phase = 'talon';
    g.turn = g.declarer;
    return g;
  }
  let n = seat;
  do { n = (n + 1) % 3; } while (g.passed[n]);
  g.turn = n;
  return g;
}

function doDeclare(g, seat, discard, contract) {
  if (g.phase !== 'talon') throw new Error('notTalon');
  if (!Array.isArray(discard) || discard.length !== 2 || discard[0] === discard[1])
    throw new Error('discardTwo');
  for (const c of discard) if (!g.hands[seat].includes(c)) throw new Error('noSuchCard');
  if (g.highBid.misere && !contract.misere)
    throw new Error('misereMandatory');
  if (contractRank(contract) < contractRank(g.highBid))
    throw new Error('contractBelowBid');

  g.hands[seat] = g.hands[seat].filter((c) => !discard.includes(c));
  g.discard = discard;
  g.contract = contract;
  g.log.push({ k: 'log.declares', p: { player: seat, contract } });

  if (contract.misere) { startPlay(g, (seat + 1) % 3); return g; }   // no whisting on misere
  g.phase = 'whist';
  g.turn = (seat + 1) % 3;
  return g;
}

function doWhist(g, seat, whist) {
  if (g.phase !== 'whist') throw new Error('notWhist');
  g.whistDecl[seat] = whist;
  g.log.push({ k: whist ? 'log.whist' : 'log.whistPass', p: { player: seat } });
  const [d1, d2] = defendersOf(g);
  if (g.whistDecl[d1] === null) { g.turn = d1; return g; }
  if (g.whistDecl[d2] === null) { g.turn = d2; return g; }
  if (!g.whistDecl[d1] && !g.whistDecl[d2]) {          // nobody whists -> contract stands
    g.log.push({ k: 'log.bothPassed', p: {} });
    g.conceded = true;
    scoreDeal(g);
    return g;
  }
  startPlay(g, (g.declarer + 1) % 3);
  return g;
}

function startPlay(g, leader) {
  // Open play: on misère both whisters lay their cards on the table. On a normal
  // contract, when one whists and the other passes, it is "whist in the light":
  // both defence hands go face up and the whister plays them both.
  if (g.contract.misere || (!g.contract.raspas && g.openOnHalfWhist &&
      g.whistDecl[defendersOf(g)[0]] !== g.whistDecl[defendersOf(g)[1]]))
    for (const d of defendersOf(g)) g.openHands[d] = true;
  g.phase = 'play';
  g.trickLead = leader;
  g.turn = leader;
  g.trick = [];
  return g;
}

function doPlay(g, seat, card) {
  if (g.phase !== 'play') throw new Error('notPlay');
  if (!legalCards(g, seat).includes(card)) throw new Error('illegalCard');
  g.hands[seat] = g.hands[seat].filter((c) => c !== card);
  g.playedCards.push(card);
  g.trick.push({ player: seat, card });
  if (g.trick.length < 3) { g.turn = (seat + 1) % 3; return g; }

  const forced = forcedSuit(g);
  const w = trickWinner(g.trick, trumpOf(g.contract), forced);
  g.tricks[w]++;
  g.trickNo++;
  g.lastTrick = { cards: g.trick, winner: w };
  g.log.push({ k: forced ? 'log.trickForced' : 'log.trick',
    p: { n: g.trickNo, suit: forced, cards: g.trick.map((x) => x.card), player: w } });
  g.trick = [];
  g.trickLead = w;
  g.turn = w;
  if (g.trickNo === 10) scoreDeal(g);
  return g;
}

// ---- scoring ---------------------------------------------------------------

// A pool win fills the winner's own pool up to the target. Whatever is over the
// top is not lost: it first writes off the winner's own mountain, and the rest
// becomes "help" — it closes the other players' pools, and every point of help
// is written as 10 whists against the player it helped.
function writePool(g, seat, amount, lines) {
  const S = g.score;
  let left = amount;
  const own = Math.min(Math.max(0, g.poolTarget - S.pool[seat]), left);
  if (own) { S.pool[seat] += own; left -= own; lines.push({ k: 'score.toPool', p: { player: seat, n: own } }); }
  const off = Math.min(S.mountain[seat], left);
  if (off) { S.mountain[seat] -= off; left -= off; lines.push({ k: 'score.offMountain', p: { player: seat, n: off } }); }
  for (let k = 1; k < 3 && left > 0; k++) {
    const other = (seat + k) % 3;
    const give = Math.min(Math.max(0, g.poolTarget - S.pool[other]), left);
    if (!give) continue;
    S.pool[other] += give;
    S.whists[seat][other] += give * 10;
    left -= give;
    lines.push({ k: 'score.help', p: { player: seat, to: other, n: give, whists: give * 10 } });
  }
}

function scoreDeal(g) {
  const c = g.contract, S = g.score, lines = [];
  const before = JSON.parse(JSON.stringify(S));
  if (c.raspas) {
    for (let i = 0; i < 3; i++) if (g.tricks[i]) {
      S.mountain[i] += g.tricks[i] * RASPAS_TRICK;
      lines.push({ k: 'score.raspas', p: { player: i, n: g.tricks[i] * RASPAS_TRICK, tricks: g.tricks[i] } });
    }
  } else if (c.misere) {
    const t = g.tricks[g.declarer];
    if (t === 0) {
      lines.push({ k: 'score.misereMade', p: { player: g.declarer } });
      writePool(g, g.declarer, 10, lines);
    }
    else {
      S.mountain[g.declarer] += t * 10;
      lines.push({ k: 'score.misereFail', p: { player: g.declarer, tricks: t, n: t * 10 } });
    }
  } else {
    const V = contractValue(c), need = c.level;
    const got = g.conceded ? need : g.tricks[g.declarer];
    if (got >= need) {
      lines.push({ k: 'score.made', p: { player: g.declarer, tricks: got } });
      writePool(g, g.declarer, V, lines);
    } else {
      S.mountain[g.declarer] += (need - got) * V;
      lines.push({ k: 'score.under', p: { player: g.declarer, under: need - got, n: (need - got) * V } });
    }
    const defs = defendersOf(g);
    for (const d of defs) {
      if (g.whistDecl[d] && g.tricks[d]) {
        S.whists[d][g.declarer] += g.tricks[d] * V;
        lines.push({ k: 'score.whists', p: { player: d, n: g.tricks[d] * V } });
      }
    }
    const whisters = defs.filter((d) => g.whistDecl[d]);
    const duty = WHIST_DUTY[c.level];
    const defTricks = defs.reduce((a, d) => a + g.tricks[d], 0);
    if (whisters.length && !g.conceded && defTricks < duty) {
      const pen = (duty - defTricks) * V / whisters.length;   // V is even, so this divides evenly
      for (const w of whisters) {
        S.mountain[w] += pen;
        lines.push({ k: 'score.whistShort', p: { player: w, got: defTricks, duty, n: pen } });
      }
    }
  }
  const d = (a, b) => a.map((v, i) => v - b[i]);
  g.history.push({
    deal: g.deal,
    contract: c,
    declarer: g.declarer,
    tricks: g.tricks.slice(),
    pool: d(S.pool, before.pool),
    mountain: d(S.mountain, before.mountain),
    whists: S.whists.map((row, i) => d(row, before.whists[i])),
  });
  g.result = { tricks: g.tricks.slice(), lines, before };
  g.log.push(...lines);
  g.phase = Math.min(...S.pool) >= g.poolTarget ? 'game_over' : 'deal_end';
}

// The result is zero-sum: raw scores are normalised by their mean, so the three
// always add up to 0. Fractions are kept exact; the UI does the rounding.
export function finalScores(S) {
  const raw = [0, 1, 2].map((i) => {
    const won = S.whists[i].reduce((a, b) => a + b, 0);
    const lost = [0, 1, 2].reduce((a, j) => a + S.whists[j][i], 0);
    return 10 * S.pool[i] - 10 * S.mountain[i] + won - lost;
  });
  const mean = (raw[0] + raw[1] + raw[2]) / 3;
  return raw.map((v) => v - mean);
}

// ---- per-seat view (hides other players' cards; used by UI, bots and network)

export function viewFor(g, seat) {
  const v = JSON.parse(JSON.stringify(g));
  v.you = seat;
  v.hands = g.hands.map((h, i) => (i === seat || g.openHands[i] ? sortHand(h.slice()) : null));
  v.handCounts = g.hands.map((h) => h.length);
  // The talon is hidden during play. In an all-pass deal it is the opposite: the
  // card of the current trick lies face up, and a spent one is cleared away.
  if (g.contract && g.contract.raspas) {
    v.talon = g.phase === 'play' ? (g.trickNo < 2 ? [g.talon[g.trickNo]] : null)
      : (g.phase === 'deal_end' || g.phase === 'game_over' ? g.talon : null);
  } else if (!g.talonOpen || g.phase === 'play') v.talon = null;
  v.forcedSuit = forcedSuit(g);
  if (g.phase !== 'deal_end' && g.phase !== 'game_over') {
    v.discard = g.declarer === seat ? g.discard : g.discard.length ? ['?', '?'] : [];
  }
  v.actor = g.phase === 'play' ? controllerOf(g, g.turn) : g.turn;   // whose move it is right now
  v.playFor = g.phase === 'play' && v.actor === seat ? g.turn : null;
  v.legal = v.playFor === null ? [] : legalCards(g, v.playFor);
  // viewFor clones the whole state, so every new field must be redacted by hand
  v.dealt = g.phase === 'deal_end' || g.phase === 'game_over' ? g.dealt : null;
  v.canRepeat = g.phase === 'bidding' && g.turn === seat && canRepeat(g, seat);
  v.canBidMisere = canBidMisere(g, seat);
  v.finals = finalScores(g.score);
  return v;
}
