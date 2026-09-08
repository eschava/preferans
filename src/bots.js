// Bot policies. They only ever see viewFor(seat) — no peeking at other hands.
import { SUITS, rankIdx, suitOf, trumpOf, contractRank, allContracts, WHIST_DUTY } from './engine.js';
import { bestCard } from './solver.js';

const bySuit = (hand, s) => hand.filter((c) => suitOf(c) === s);

// Rough trick count for a 10-card hand with the given trump (null = no trump).
export function estimateTricks(hand, trump) {
  let total = 0;
  for (const s of SUITS) {
    const idx = bySuit(hand, s).map(rankIdx);
    const n = idx.length;
    let t = 0;
    if (idx.includes(7)) t += 1;                        // A
    if (idx.includes(6)) t += n >= 2 ? 1 : 0.5;         // K
    if (idx.includes(5)) t += n >= 3 ? 0.9 : 0.3;       // Q
    if (idx.includes(4)) t += n >= 4 ? 0.6 : 0.1;       // J
    t += s === trump ? Math.max(0, n - 3) * 0.8 : Math.max(0, n - 4) * 0.5;
    total += Math.min(t, n);
  }
  if (trump) {
    const tl = bySuit(hand, trump).length;
    for (const s of SUITS) {
      if (s === trump) continue;
      const n = bySuit(hand, s).length;
      if (n === 0) total += Math.min(1.5, tl * 0.5);
      else if (n === 1) total += Math.min(1, tl * 0.35);
    }
  }
  return total;
}

// estimateTricks is optimistic; this maps it onto tricks actually won in
// bot-vs-bot playouts (linear fit: actual = 0.66*est + 0.7). Re-run
// scripts/calibrate.mjs after changing the estimator or the card-play policy —
// a stale fit makes the bots over- or underbid.
export const expectedTricks = (hand, trump) => 0.66 * estimateTricks(hand, trump) + 0.7;

const bestTrump = (hand) =>
  SUITS.map((s) => [s, estimateTricks(hand, s)]).sort((a, b) => b[1] - a[1])[0];

// Very conservative: bots bid misere only on an obviously safe hand.
const misereLooksSafe = (hand) =>
  hand.every((c) => rankIdx(c) < 5) && SUITS.filter((s) => hand.includes(s + '7')).length >= 3;

export function chooseBid(v) {
  const hand = v.hands[v.you];
  if (misereLooksSafe(hand) && v.canBidMisere && contractRank({ misere: true }) > contractRank(v.highBid))
    return { type: 'bid', contract: { misere: true } };

  const [suit, est] = bestTrump(hand);
  const ntEst = estimateTricks(hand, null);
  const useNt = ntEst >= est - 0.2;
  const target = Math.round(expectedTricks(hand, useNt ? null : suit) + 0.75);  // +0.75 from the talon
  if (target < 6) return { type: 'bid', contract: null };
  const want = { level: Math.min(10, target), suit: useNt ? 'nt' : suit };

  // repeating the standing bid is cheaper than raising, so prefer it when allowed
  if (v.canRepeat && contractRank(v.highBid) <= contractRank(want))
    return { type: 'bid', contract: v.highBid };
  const options = allContracts().filter((c) =>
    contractRank(c) > contractRank(v.highBid) && contractRank(c) <= contractRank(want) &&
    (!c.misere || v.canBidMisere));          // misère sits in the ladder but is not always allowed
  return options.length ? { type: 'bid', contract: options[0] } : { type: 'bid', contract: null };
}

export function chooseDeclare(v) {
  const hand = v.hands[v.you];                              // 12 cards incl. talon
  if (v.highBid && v.highBid.misere)                  // won the auction on misère, so misère it is
    return { type: 'declare', discard: pickDiscard(hand, null), contract: { misere: true } };

  // What this trump is worth: the discard it wants, the level it can carry, and
  // what the auction makes it cost — a bid may stand above the suit, and the
  // contract may never go below the bid.
  const plan = (suit) => {
    const trump = suit === 'nt' ? null : suit;
    const discard = pickDiscard(hand, trump);
    const kept = hand.filter((c) => !discard.includes(c));
    const est = expectedTricks(kept, trump);
    const want = Math.min(10, Math.max(6, Math.round(est)));
    let level = want;
    while (level < 10 && contractRank({ level, suit }) < contractRank(v.highBid)) level++;
    return { discard, est, level, paid: level - want, contract: { level, suit } };
  };

  let best = plan(bestTrump(hand)[0]);
  // A raise in the auction is often just a step up the ladder, so the bid can
  // end up above the suit the hand actually wants. Paying for that in levels is
  // rarely right, and naming the bid itself is worse — that is how a declarer
  // comes to play a suit he does not hold. So weigh every trump at the cheapest
  // level that honours the bid and keep the one closest to being made; the
  // discard is the one made for THAT trump, not for a suit that lost.
  if (best.paid) {
    const slack = (p) => p.est - p.level;
    best = [...SUITS, 'nt'].map(plan)
      .filter((p) => contractRank(p.contract) >= contractRank(v.highBid))
      .sort((a, b) => slack(b) - slack(a))[0];
  }
  return { type: 'declare', discard: best.discard, contract: best.contract };
}

// Drop the two least useful cards: never trump, prefer emptying a short side suit.
function pickDiscard(hand, trump) {
  const scored = hand.map((c) => {
    const s = suitOf(c), len = bySuit(hand, s).length;
    let keep = rankIdx(c);
    if (s === trump) keep += 20;
    if (rankIdx(c) === 7) keep += 10;                       // aces stay
    if (trump && len <= 2 && rankIdx(c) < 6) keep -= 6;     // void a short suit for ruffs
    return [c, keep];
  }).sort((a, b) => a[1] - b[1]);
  return [scored[0][0], scored[1][0]];
}

// Defence takes far less than estimateTricks promises: a separate fit over
// played deals (scripts/calibrate-defence.mjs) gives actual ≈ 0.47*raw.
export const expectedDefence = (hand, trump) => 0.47 * estimateTricks(hand, trump) + 0.1;

// Whist when the pair can carry its duty: a shortfall goes into the whisters'
// mountain, and if the partner passes you carry the whole of it alone.
export function chooseWhist(v) {
  const est = expectedDefence(v.hands[v.you], trumpOf(v.contract));
  const duty = WHIST_DUTY[v.contract.level] ?? 0;
  const partner = defenderPartner(v);
  const alone = partner !== null && v.whistDecl[partner] === false;
  // The duty is measured on what the DEFENCE takes, not on what the whister
  // takes alone: a partner who passed still plays, and on a half whist their
  // hand goes face up for the whister to play. So their tricks count either
  // way. Being alone does not remove them — it only doubles the share of a
  // shortfall, which is worth a little caution, not two whole tricks.
  const pair = est + 2.0;                        // the partner takes two on average
  return { type: 'whist', whist: pair >= duty - (alone ? 0 : 0.3) };
}

const defenderPartner = (v) => {
  const others = [0, 1, 2].filter((s) => s !== v.you && s !== v.declarer);
  return others.length ? others[0] : null;
};

export function chooseCard(v) {
  return { type: 'play', card: bestCard(v) };
}

// Everything nobody can be holding any more: played, in my hand, or face up on
// the table. The talon stays unknown, which only makes the bot cautious.



// Single entry point: give it a seat view, get the action for that seat.
export function botAction(v) {
  switch (v.phase) {
    case 'bidding': return chooseBid(v);
    case 'talon': return chooseDeclare(v);
    case 'whist': return chooseWhist(v);
    case 'play': return v.playFor === null ? null : chooseCard(v);
    case 'deal_end': return { type: 'next' };
    default: return null;
  }
}
