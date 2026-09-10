// Self-check: node test/engine.test.mjs
import assert from 'node:assert/strict';
import {
  makeDeck, setRandom, newGame, applyAction, viewFor, legalCards, trickWinner,
  contractRank, contractValue, finalScores, canRepeat, sortHand, controllerOf, legalActions,
  forcedSuit, suitOf, replayGame, RASPAS_TRICK,
} from '../src/engine.js';
import { botAction } from '../src/bots.js';
import { setNodeLimit } from '../src/solver.js';

setNodeLimit(20000);   // throttled: this suite checks legality and scoring, not strength

const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// These tests exercise the rules, not the bots: card play picks a random legal
// card so the engine can be hammered cheaply. Bot strength has its own tests.
const pick = seeded(99);
const policy = (g, seat) => {
  const v = viewFor(g, seat);
  if (v.phase !== 'play') return botAction(v);
  return { type: 'play', card: v.legal[Math.floor(pick() * v.legal.length)] };
};

// deck
assert.equal(makeDeck().length, 32);
assert.equal(new Set(makeDeck()).size, 32);

// misère sits between 8NT and 9♠ — only a nine beats it
assert.ok(contractRank({ level: 8, suit: 'nt' }) < contractRank({ misere: true }));
assert.ok(contractRank({ misere: true }) < contractRank({ level: 9, suit: 's' }));
assert.equal(contractValue({ level: 6, suit: 's' }), 2);
assert.equal(contractValue({ level: 10, suit: 'nt' }), 10);

// trick winner: trump beats a higher card of the led suit
assert.equal(trickWinner([{ player: 0, card: 'hA' }, { player: 1, card: 'h7' }, { player: 2, card: 's7' }], 's'), 2);
assert.equal(trickWinner([{ player: 0, card: 'hA' }, { player: 1, card: 'h7' }, { player: 2, card: 's7' }], null), 0);

// following suit is the only obligation: you may duck under the winning card
{
  const g = { contract: { level: 6, suit: 's' }, trick: [{ player: 0, card: 'hQ' }], hands: [[], ['h7', 'hK', 'hA', 's7'], []] };
  assert.deepEqual(legalCards(g, 1).sort(), ['h7', 'hA', 'hK']); // ducking with h7 is allowed
  g.hands[1] = ['s7', 's8', 'dA'];
  assert.deepEqual(legalCards(g, 1).sort(), ['s7', 's8']);       // void of the led suit -> must trump
  g.trick = [{ player: 0, card: 'hQ' }, { player: 2, card: 'sK' }];
  assert.deepEqual(legalCards(g, 1).sort(), ['s7', 's8']);       // already trumped -> no need to overtrump
  g.hands[1] = ['dA', 'c9'];
  assert.deepEqual(legalCards(g, 1).sort(), ['c9', 'dA']);       // no led suit, no trump -> anything
}

// misère is binding: only as your own first bid, and it cannot be dropped
{
  setRandom(seeded(21));
  const g = newGame();
  g.dealer = 2; g.phase = 'bidding'; g.passed = [false, false, false];
  g.bidHistory = []; g.highBid = null; g.highBidder = null; g.turn = 0;
  applyAction(g, 0, { type: 'bid', contract: { level: 6, suit: 's' } });
  applyAction(g, 1, { type: 'bid', contract: { level: 7, suit: 's' } });
  applyAction(g, 2, { type: 'bid', contract: { misere: true } });   // own first call, allowed
  assert.equal(g.highBidder, 2);
  // but not for someone who already bid a game (a passer never speaks again)
  assert.throws(() => applyAction(g, 0, { type: 'bid', contract: { misere: true } }), /misereFirstBidOnly/);
  // an eight does not beat misère, a nine does
  assert.throws(() => applyAction(g, 0, { type: 'bid', contract: { level: 8, suit: 'nt' } }), /bidTooLow/);
  applyAction(g, 0, { type: 'bid', contract: { level: 9, suit: 's' } });
  assert.equal(g.highBidder, 0);
}
{
  setRandom(seeded(22));
  const g = newGame();
  g.declarer = 1; g.highBid = { misere: true }; g.phase = 'talon'; g.turn = 1;
  g.hands[1] = sortHand(g.hands[1].concat(g.talon));
  const drop = g.hands[1].slice(0, 2);
  assert.throws(() => applyAction(g, 1, { type: 'declare', discard: drop, contract: { level: 9, suit: 'h' } }),
    /misereMandatory/);
  applyAction(g, 1, { type: 'declare', discard: drop, contract: { misere: true } });
  assert.ok(g.contract.misere);
}

// "repeat across the passer": only the senior hand, only across a passer
{
  setRandom(seeded(11));
  const g = newGame();
  g.dealer = 2;                                  // first hand = 0, second = 1, third = 2
  g.phase = 'bidding'; g.passed = [false, false, false];
  g.highBid = { level: 6, suit: 's' }; g.highBidder = 0; g.turn = 2;
  assert.equal(canRepeat(g, 2), false);          // third hand is junior to first, must raise
  g.passed[1] = true;
  assert.equal(canRepeat(g, 2), false);          // there is a passer, but the seniority is wrong
  assert.throws(() => applyAction(g, 2, { type: 'bid', contract: { level: 6, suit: 's' } }), /bidTooLow/);

  // third hand holds the bid, first passed — second, sitting before it, repeats
  g.highBidder = 2; g.turn = 1; g.passed = [true, false, false];
  assert.equal(canRepeat(g, 1), true);
  applyAction(g, 1, { type: 'bid', contract: { level: 6, suit: 's' } });
  assert.equal(g.highBidder, 1);                 // the repeat hands the bid to the senior
  assert.equal(g.turn, 2);                       // the junior speaks again
  assert.equal(canRepeat(g, 2), false);          // no repeating back: raise or pass
  assert.ok(g.log.some((l) => l.k === 'log.bidRepeat'));

}

// full self-play: every deal must reach a scored end with legal moves only
setRandom(seeded(42));
let deals = 0, raspas = 0, misere = 0, played = 0;
for (let game = 0; game < 40; game++) {
  const g = newGame({ poolTarget: 10 });
  for (let guard = 0; guard < 4000 && g.phase !== 'game_over'; guard++) {
    const seat = controllerOf(g, g.turn);       // in a light whist the whister moves for both
    const a = policy(g, seat);
    assert.ok(a, 'bot must produce an action in phase ' + g.phase);
    if (g.phase === 'play') assert.ok(legalCards(g, g.turn).includes(a.card), 'bot played an illegal card');
    if (g.phase === 'deal_end') {
      deals++;
      if (g.contract.raspas) raspas++;
      if (g.contract.misere) misere++;
      assert.ok(g.bidHistory.length < 40, 'bidding looped on repeats');
      const total = g.tricks.reduce((x, y) => x + y, 0);
      assert.ok(total === 10 || total === 0, 'tricks must sum to 10 (or 0 when nobody whisted)');
      if (total === 10) { played++; assert.ok(g.hands.every((h) => h.length === 0)); }
    }
    applyAction(g, seat, a);
  }
  assert.equal(g.phase, 'game_over');
  assert.ok(Math.min(...g.score.pool) >= 10, 'the game runs until everyone closes the pool');
}
assert.ok(deals > 100 && played > 50, `too few deals played: ${deals}/${played}`);

// hidden information never leaks through the per-seat view.
// viewFor is the only way state reaches a client, so this is the whole guarantee.
const CARD = /^[schd](7|8|9|10|J|Q|K|A)$/;
function cardsIn(x, out = new Set()) {
  if (typeof x === 'string') { if (CARD.test(x)) out.add(x); }
  else if (Array.isArray(x)) x.forEach((y) => cardsIn(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => cardsIn(y, out));
  return out;
}
{
  setRandom(seeded(7));
  let checks = 0;
  for (let game = 0; game < 12; game++) {
    const g = newGame({ poolTarget: 6 });
    for (let guard = 0; guard < 4000 && g.phase !== 'game_over'; guard++) {
      // the table is revealed on purpose once the deal ends; secrecy holds until then
      const live = g.phase !== 'deal_end' && g.phase !== 'game_over';
      for (let seat = 0; live && seat < 3; seat++) {
        const seen = cardsIn(viewFor(g, seat));
        // the talon is public once turned up, and it sits in the declarer's hand
        const publicTalon = g.talonOpen ? g.talon : [];
        for (const other of [0, 1, 2]) {
          if (other === seat || g.openHands[other]) continue;   // anything face up is seen by everyone
          for (const c of g.hands[other])
            if (!publicTalon.includes(c))
              assert.ok(!seen.has(c), `seat ${seat} sees ${c} from seat ${other} in phase ${g.phase}`);
        }
        // separately: the declarer sees nothing beyond what is face up
        if (g.declarer !== null && seat === g.declarer)
          for (const d of [0, 1, 2])
            if (d !== seat && !g.openHands[d])
              for (const c of g.hands[d]) if (!publicTalon.includes(c))
                assert.ok(!seen.has(c), `declarer sees ${c} in seat ${d}`);
        // the talon stays secret until turned up: by the auction, or one card per
        // trick for the first two tricks of an all-pass deal
        const shownTalon = g.contract && g.contract.raspas && g.phase === 'play'
          ? Math.min(g.trickNo + 1, 2) : 0;
        if (!g.talonOpen)
          g.talon.forEach((c, i) => { if (i >= shownTalon)
            assert.ok(!seen.has(c), `seat ${seat} sees closed talon card ${c}`); });
        if (g.declarer !== null && seat !== g.declarer && g.phase === 'play')
          for (const c of g.discard) assert.ok(!seen.has(c), `seat ${seat} sees the discard ${c}`);
        checks++;
      }
      const actor = controllerOf(g, g.turn);
      applyAction(g, actor, policy(g, actor));
    }
  }
  assert.ok(checks > 2000, 'leak check barely ran');
  console.log(`ok — ${checks} view checks for hidden-card leaks`);
}

// scoring arithmetic — the pool is not in it: every player closes it before the
// game can end, so it cannot separate them
{
  const S = { pool: [4, 0, 0], mountain: [0, 2, 0], whists: [[0, 0, 0], [6, 0, 0], [0, 0, 0]] };
  const f = finalScores(S);
  assert.ok(Math.abs(f[0] + f[1] + f[2]) < 1e-9, 'the result is zero-sum');
  assert.ok(Math.abs((f[0] - f[1]) - (-6 - -14)) < 1e-9, 'differences between players are preserved');
  assert.ok(Math.abs((f[0] - f[2]) - -6) < 1e-9);
  assert.deepEqual(finalScores({ ...S, pool: [10, 10, 10] }), f, 'filling pools does not move the result');

  // the sheet that prompted this: a closed pool must not hide the biggest mountain
  const g = finalScores({ pool: [10, 0, 0], mountain: [20, 8, 12], whists: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
  assert.ok(g[0] < g[2] && g[2] < g[1], 'the biggest mountain is last, closed pool or not');
}

// all-pass: the first two tricks are led in the face-up talon suit
{
  setRandom(seeded(41));
  const g = newGame();
  g.contract = { raspas: true }; g.phase = 'play'; g.trickNo = 0;
  g.trick = []; g.turn = 0; g.trickLead = 0;
  g.talon = ['d9', 'sK'];
  g.hands[0] = sortHand(['dA', 'd7', 'hA', 'hK', 'c9', 'c8', 's7', 's8', 's9', 's10']);
  assert.equal(forcedSuit(g), 'd');
  assert.deepEqual(legalCards(g, 0).sort(), ['d7', 'dA']);      // must lead diamonds
  g.hands[1] = ['cA', 'cK', 'cQ', 'cJ', 'c10', 'h7', 'h8', 'h9', 'h10', 'hJ'];
  applyAction(g, 0, { type: 'play', card: 'd7' });
  assert.deepEqual(legalCards(g, 1).sort(), g.hands[1].slice().sort());  // void in diamonds, anything goes
  applyAction(g, 1, { type: 'play', card: 'cA' });              // an ace off-suit does not take the trick
  g.hands[2] = ['dK', 'd8'];
  applyAction(g, 2, { type: 'play', card: 'd8' });
  assert.equal(g.tricks[2], 1, 'the highest card of the talon suit takes the trick');
  assert.equal(forcedSuit(g), 's');                             // second trick follows the second talon card
  const forcedLine = g.log.find((l) => l.k === 'log.trickForced');
  assert.equal(forcedLine.p.card, g.talon[0], 'the log names the talon card that was turned, not just its suit');
}

// a closed pool spills over: first as help to the others, then onto the own mountain
{
  setRandom(seeded(61));
  const g = newGame({ poolTarget: 10 });
  g.score.pool = [8, 10, 3]; g.score.mountain = [4, 0, 0];
  g.declarer = 0; g.contract = { level: 9, suit: 'h' };   // value 8
  g.whistDecl = [null, null, null];
  g.phase = 'whist'; g.turn = 1;
  applyAction(g, 1, { type: 'whist', whist: false });
  applyAction(g, 2, { type: 'whist', whist: false });   // nobody whists: the game of 8 is written
  assert.equal(g.score.pool[0], 10, 'own pool fills to the target first');
  assert.equal(g.score.pool[2], 9, 'the surplus 6 goes to the seat that is short');
  assert.equal(g.score.whists[0][2], 60, 'help is written as 10 whists a point');
  assert.equal(g.score.pool[1], 10, 'a closed pool takes no help');
  assert.equal(g.score.mountain[0], 4, 'the own mountain is written off last, out of what is left');

  // nobody left to help: what remains does write off the own mountain
  g.score.pool = [10, 10, 10]; g.score.mountain = [4, 0, 0];
  g.phase = 'whist'; g.turn = 1; g.whistDecl = [null, null, null]; g.conceded = false;
  applyAction(g, 1, { type: 'whist', whist: false });
  applyAction(g, 2, { type: 'whist', whist: false });
  assert.equal(g.score.mountain[0], 0, 'with every pool closed the win writes off the own mountain');
}

// whist shortfall: the whisters owe their tricks or write into the mountain
{
  setRandom(seeded(51));
  const g = newGame();
  g.declarer = 0; g.contract = { level: 7, suit: 'h' };      // duty 2, contract value 4
  g.whistDecl = [null, true, true];
  g.tricks = [8, 1, 0]; g.trickNo = 9; g.hands = [['h7'], [], []];
  g.phase = 'play'; g.trick = [{ player: 1, card: 'h8' }, { player: 2, card: 'h9' }]; g.turn = 0;
  applyAction(g, 0, { type: 'play', card: 'h7' });            // seat 2 takes the trick
  assert.equal(g.tricks[2], 1);
  assert.equal(g.score.pool[0], 4);                           // contract made
  assert.equal(g.score.mountain[1], 0);                       // 2 tricks between them, duty met
  assert.equal(g.score.mountain[2], 0);
}
{
  setRandom(seeded(52));
  const g = newGame();
  g.declarer = 0; g.contract = { level: 7, suit: 'h' };
  g.whistDecl = [null, true, true];
  g.tricks = [9, 0, 0]; g.trickNo = 9; g.hands = [[], ['h7'], []];
  g.phase = 'play'; g.trick = [{ player: 2, card: 'h9' }, { player: 0, card: 'hA' }]; g.turn = 1;
  applyAction(g, 1, { type: 'play', card: 'h7' });            // defence took 0 of the 2 owed
  // both took nothing, so both are short of their half whichever way it is set
  assert.equal(g.score.mountain[1], 8, 'shortfall 2 x the game\'s full value 4');
  assert.equal(g.score.mountain[2], 8);
  assert.ok(g.log.some((l) => l.k === 'score.whistShort'));
}

// light whist: the whister plays the passing partner's hand too
{
  setRandom(seeded(31));
  const g = newGame();
  g.declarer = 0; g.highBid = { level: 6, suit: 's' }; g.contract = { level: 6, suit: 's' };
  g.phase = 'whist'; g.turn = 1;
  applyAction(g, 1, { type: 'whist', whist: true });     // west whists
  applyAction(g, 2, { type: 'whist', whist: false });    // east passes
  assert.equal(g.phase, 'play');
  assert.deepEqual(g.openHands, [false, true, true]);    // in a light whist both go face up
  assert.equal(controllerOf(g, 2), 1);                   // and the whister moves for both
  assert.equal(viewFor(g, 0).hands.filter(Boolean).length, 3);   // the declarer sees the whole defence
  assert.equal(controllerOf(g, 1), 1);
  assert.equal(controllerOf(g, 0), 0);
  assert.equal(viewFor(g, 1).hands[2].length, 10);       // the whister sees them
  assert.equal(viewFor(g, 1).playFor, g.turn === 1 ? 1 : null);

  while (g.turn !== 2) applyAction(g, controllerOf(g, g.turn), botAction(viewFor(g, controllerOf(g, g.turn))));
  const card = legalCards(g, 2)[0];
  assert.throws(() => applyAction(g, 2, { type: 'play', card }), /notYourTurn/);
  assert.equal(viewFor(g, 1).playFor, 2);                // the whister is told whose card to play
  applyAction(g, 1, { type: 'play', card });
  assert.ok(!g.hands[2].includes(card));
}

// branches the self-play loop rarely reaches
{
  setRandom(seeded(3));
  const g = newGame();
  g.declarer = 0; g.highBid = { level: 6, suit: 's' }; g.contract = { level: 6, suit: 's' };
  g.phase = 'whist'; g.turn = 1;
  applyAction(g, 1, { type: 'whist', whist: false });
  applyAction(g, 2, { type: 'whist', whist: false });
  assert.equal(g.phase, 'deal_end');                 // nobody whists -> no play
  assert.equal(g.score.pool[0], 2);
  assert.equal(g.tricks.reduce((a, b) => a + b, 0), 0);
}
{
  setRandom(seeded(4));
  const g = newGame();
  g.declarer = 1; g.contract = { misere: true }; g.tricks = [0, 3, 0]; g.trickNo = 10;
  g.phase = 'play'; g.trick = []; g.hands = [[], [], []];
  g.hands[1] = ['sA']; g.trickNo = 9; g.trick = [{ player: 0, card: 's8' }, { player: 2, card: 's9' }];
  assert.deepEqual(legalCards(g, 1), ['sA']);        // last card, forced to take a 4th trick
  applyAction(g, 1, { type: 'play', card: 'sA' });
  assert.equal(g.score.mountain[1], 40);             // 4 tricks x 10 into the mountain
}
{
  setRandom(seeded(5));
  const g = newGame();
  g.declarer = 0; g.contract = { level: 7, suit: 'h' }; g.whistDecl = [null, true, false];
  g.tricks = [4, 3, 2]; g.trickNo = 9; g.hands = [['h7'], [], []];
  g.phase = 'play'; g.trick = [{ player: 1, card: 'h8' }, { player: 2, card: 'h9' }]; g.turn = 0;
  applyAction(g, 0, { type: 'play', card: 'h7' });
  assert.equal(g.score.mountain[0], 12);             // 3 short x value 4
  assert.equal(g.score.whists[1][0], 12);            // whister: 3 tricks x 4
  assert.equal(g.score.whists[2][0], 0);             // passer records nothing
}

// A missing trick costs the game's full value; who carries it is a setting.
{
  const play = (blame, whistDecl) => {
    const g = newGame({ whistBlame: blame });
    g.declarer = 0; g.contract = { level: 7, suit: 'h' }; g.whistDecl = whistDecl;
    g.tricks = [7, 1, 0]; g.trickNo = 9; g.hands = [['hA'], [], []];
    g.phase = 'play'; g.trick = [{ player: 1, card: 'h7' }, { player: 2, card: 'h8' }]; g.turn = 0;
    applyAction(g, 0, { type: 'play', card: 'hA' });     // declarer takes the last: 8 / 1 / 0
    return g.score;
  };
  // a seven owes 2, the defence took 1: one trick short, worth the game's 4
  assert.deepEqual(play('both', [null, true, true]).mountain, [0, 4, 4],
    'both whisters carry the full value of the trick, never half of it each');
  const short = play('short', [null, true, true]);
  assert.deepEqual(short.mountain, [0, 0, 4],
    'only the whister who did not take his half of the duty');
  assert.equal(short.whists[1][0], 4, 'the trick he did take is still written to him');
  for (const blame of ['both', 'short'])
    assert.deepEqual(play(blame, [null, true, false]).mountain, [0, 4, 0],
      'a lone whister carries it whichever way the setting is set');
}

// "Stalingrad": on a six of spades the defence may not wave the deal through.
{
  setRandom(seeded(88));
  const g = newGame({ poolTarget: 20, stalingrad: true });
  assert.equal(g.poolTarget, 20, 'the pool target is settable');
  g.declarer = 0; g.contract = { level: 6, suit: 's' }; g.whistDecl = [null, null, null];
  g.phase = 'whist'; g.turn = 1;

  assert.deepEqual(legalActions(g, 1), [{ type: 'whist', whist: true }], 'pass is not on offer');
  assert.throws(() => applyAction(g, 1, { type: 'whist', whist: false }), /whistMandatory/);
  assert.ok(viewFor(g, 1).stalingrad, 'the seat view carries the rule, so the UI can say why');
  assert.deepEqual(botAction(viewFor(g, 1)), { type: 'whist', whist: true }, 'a bot has no choice either');
  applyAction(g, 1, { type: 'whist', whist: true });

  // any other contract is a free choice, and so is a six of spades without the rule
  g.contract = { level: 6, suit: 'c' }; g.whistDecl = [null, null, null]; g.phase = 'whist'; g.turn = 1;
  assert.equal(legalActions(g, 1).length, 2);
  const off = newGame();
  assert.equal(off.stalingrad, false, 'off unless asked for');
  off.declarer = 0; off.contract = { level: 6, suit: 's' }; off.whistDecl = [null, null, null];
  off.phase = 'whist'; off.turn = 1;
  assert.equal(legalActions(off, 1).length, 2);
}

// Not following a suit is public knowledge, and the only thing a bot has to
// reason with about a hand it cannot see.
{
  setRandom(seeded(23));
  const g = newGame();
  g.declarer = 0; g.contract = { level: 6, suit: 'h' }; g.whistDecl = [null, true, true];
  g.phase = 'play'; g.trick = []; g.trickLead = 0; g.turn = 0; g.trickNo = 0; g.tricks = [0, 0, 0];
  g.hands = [['sA', 'h7'], ['s8', 'h8'], ['c7', 'd9']];   // seat 2: no spade, no trump
  g.voids = [[], [], []];
  applyAction(g, 0, { type: 'play', card: 'sA' });
  applyAction(g, 1, { type: 'play', card: 's8' });          // followed: says nothing
  applyAction(g, 2, { type: 'play', card: 'c7' });          // no spade and no trump either
  assert.deepEqual(g.voids[1], [], 'following a suit shows nothing');
  assert.deepEqual(g.voids[2], ['s', 'h'], 'a discard shows the led suit AND the trump are gone');
  assert.deepEqual(viewFor(g, 1).voids[2], ['s', 'h'], 'and the table can see it');
}

// All-pass: the hand left of the dealer leads the first three tricks, whoever
// takes them; from the fourth the taker leads as usual.
{
  setRandom(seeded(77));
  const g = newGame();
  const eldest = (g.dealer + 1) % 3;
  while (g.phase === 'bidding') applyAction(g, g.turn, { type: 'bid', contract: null });
  assert.ok(g.contract.raspas, 'nobody bid, so it is an all-pass deal');

  const rows = [];
  while (g.phase === 'play') {
    const lead = g.trickLead;
    for (let k = 0; k < 3; k++) applyAction(g, g.turn, { type: 'play', card: legalCards(g, g.turn)[0] });
    rows.push({ lead, winner: g.lastTrick.winner });
  }
  assert.deepEqual(rows.slice(0, 3).map((r) => r.lead), [eldest, eldest, eldest]);
  assert.ok(rows.slice(0, 3).some((r) => r.winner !== eldest),
    'and the rule bites: somebody else took one of those tricks');
  for (let i = 3; i < rows.length; i++)
    assert.equal(rows[i].lead, rows[i - 1].winner, `trick ${i + 1} is led by the taker of the one before`);
}

// The bid may stand above the suit the hand wants, and the contract may not go
// below the bid. Naming the bid itself made a declarer play a suit he did not
// hold — and discard the two cards of it he had.
{
  const hand = ['sA', 's10', 'cA', 'cK', 'cJ', 'c8', 'c7', 'dQ', 'd7', 'hK', 'hJ', 'h8'];
  const declare = (highBid) => botAction({
    phase: 'talon', you: 2, hands: [null, null, hand], highBid,
  });
  const free = declare({ level: 6, suit: 's' });
  assert.equal(free.contract.suit, 'c', 'unforced, it names its own five-card suit');

  const forced = declare({ level: 6, suit: 'd' });                 // clubs are below the bid now
  const trump = forced.contract.suit;
  assert.ok(contractRank(forced.contract) >= contractRank({ level: 6, suit: 'd' }), 'the bid is honoured');
  assert.ok(hand.filter((c) => suitOf(c) === trump).length >= 3, 'it declares a suit it actually holds');
  assert.equal(forced.discard.filter((c) => suitOf(c) === trump).length, 0, 'and keeps every trump');
}

// A replay is the same deal over again, on a sheet nobody keeps.
{
  setRandom(seeded(5));
  const g = newGame({ poolTarget: 10, stalingrad: true, whistBlame: 'short' });
  while (g.phase !== 'deal_end') applyAction(g, controllerOf(g, g.turn), policy(g, controllerOf(g, g.turn)));
  const r = replayGame(viewFor(g, 0));
  assert.deepEqual(r.dealt, g.dealt, 'the same cards go to the same seats');
  assert.deepEqual(r.talon, g.talon, 'and the same talon');
  assert.equal(r.dealer, g.dealer, 'dealt by the same hand, so the bidding runs the same way round');
  assert.equal(r.deal, g.deal);
  assert.equal(r.phase, 'bidding');
  assert.ok(r.replay, 'and it says so');
  assert.equal(r.stalingrad, true, 'the house rules come along');
  assert.equal(r.whistBlame, 'short');
  assert.deepEqual(r.score.mountain, [0, 0, 0], 'nothing of the real score comes with it');
  const before = JSON.stringify(g.score);
  while (r.phase !== 'deal_end') applyAction(r, controllerOf(r, r.turn), policy(r, controllerOf(r, r.turn)));
  assert.equal(JSON.stringify(g.score), before, 'and playing it out leaves the real game alone');
}

console.log(`ok — ${deals} deals (${played} played out, ${raspas} all-pass, ${misere} misère), ${RASPAS_TRICK} per trick in an all-pass deal`);
