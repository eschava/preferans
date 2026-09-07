// Fits the defensive trick estimate: how many tricks a whister actually takes
// against a declared contract. Run from the repo root: node scripts/calibrate-defence.mjs
import { setRandom, newGame, applyAction, viewFor, controllerOf, sortHand, SUITS, WHIST_DUTY } from '../src/engine.js';
import { setPlayBudget } from '../src/solver.js';
import { botAction, estimateTricks } from '../src/bots.js';
const seeded=(s)=>()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
setPlayBudget(12);   // calibration runs thousands of decisions
setRandom(seeded(77));
const pts = [], made = { duty: 0, short: 0 };
for (let n = 0; n < 200; n++) {
  const g = newGame();
  const d = 0;
  const best = SUITS.map((s) => [s, estimateTricks(g.hands[d], s)]).sort((a, b) => b[1] - a[1])[0];
  g.declarer = d; g.hands[d] = sortHand(g.hands[d].concat(g.talon)); g.talonOpen = true;
  g.phase = 'talon'; g.turn = d; g.highBid = { level: 6, suit: 's' };
  const a = botAction(viewFor(g, d));
  applyAction(g, d, a);
  if (!a.contract || a.contract.misere) continue;
  const trump = a.contract.suit === 'nt' ? null : a.contract.suit;
  const est = [1, 2].map((k) => estimateTricks(g.hands[(d + k) % 3], trump));
  while (g.phase === 'whist') applyAction(g, g.turn, { type: 'whist', whist: true });
  while (g.phase === 'play') {
    const seat = controllerOf(g, g.turn);
    applyAction(g, seat, botAction(viewFor(g, seat)));
  }
  [1, 2].forEach((k, i) => pts.push([est[i], g.tricks[(d + k) % 3]]));
  const got = g.tricks[(d + 1) % 3] + g.tricks[(d + 2) % 3];
  if (got >= WHIST_DUTY[a.contract.level]) made.duty++; else made.short++;
}
const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0) / n, sy = pts.reduce((a, p) => a + p[1], 0) / n;
const a1 = pts.reduce((a, p) => a + (p[0] - sx) * (p[1] - sy), 0) / pts.reduce((a, p) => a + (p[0] - sx) ** 2, 0);
console.log(`n=${n}  raw≈${sx.toFixed(2)}  actual≈${sy.toFixed(2)}   actual ≈ ${a1.toFixed(3)}*raw + ${(sy - a1 * sx).toFixed(2)}`);
console.log(`whist duty met ${made.duty}, short ${made.short} (${(100*made.short/(made.duty+made.short)).toFixed(0)}%)`);
