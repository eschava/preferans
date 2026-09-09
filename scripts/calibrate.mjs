// Fits estimateTricks() against tricks actually won in bot-vs-bot playouts.
// Run from the repo root: node scripts/calibrate.mjs [deals] [seed] [budgetMs],
// then update expectedTricks() in src/bots.js. The fit goes stale whenever the
// card play changes — stronger play takes more tricks off the same estimate.
import { setRandom, newGame, applyAction, viewFor, makeDeck, sortHand, controllerOf } from '../src/engine.js';
import { setPlayBudget } from '../src/solver.js';
import { botAction, estimateTricks } from '../src/bots.js';
import { SUITS } from '../src/engine.js';
const seeded=(s)=>()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
const DEALS = Number(process.argv[2] || 200), SEED = Number(process.argv[3] || 99);
setPlayBudget(Number(process.argv[4] || 12));   // calibration runs thousands of decisions
setRandom(seeded(SEED));
const pts=[];
for(let n=0;n<DEALS;n++){
  const g=newGame();
  // force seat 0 declarer with its best trump, take talon, discard, both whist
  const d=0;
  const best=SUITS.map(s=>[s,estimateTricks(g.hands[d],s)]).sort((a,b)=>b[1]-a[1])[0];
  g.declarer=d; g.hands[d]=sortHand(g.hands[d].concat(g.talon)); g.talonOpen=true; g.phase='talon'; g.turn=d; g.highBid={level:6,suit:'s'};
  const v=viewFor(g,d); const a=botAction(v);
  const est=estimateTricks(g.hands[d].filter(c=>!a.discard.includes(c)), a.contract.misere?null:a.contract.suit);
  applyAction(g,d,a);
  if(g.phase==='whist'){ while(g.phase==='whist'){ applyAction(g,g.turn,{type:'whist',whist:true}); } }
  while(g.phase==='play'){ const s2=controllerOf(g,g.turn); applyAction(g,s2,botAction(viewFor(g,s2))); }
  pts.push([est,g.tricks[d]]);
}
const n=pts.length, sx=pts.reduce((a,p)=>a+p[0],0)/n, sy=pts.reduce((a,p)=>a+p[1],0)/n;
const cov=pts.reduce((a,p)=>a+(p[0]-sx)*(p[1]-sy),0), varx=pts.reduce((a,p)=>a+(p[0]-sx)**2,0);
const a1=cov/varx, b1=sy-a1*sx;
console.log(`est mean ${sx.toFixed(2)}  actual mean ${sy.toFixed(2)}   actual ≈ ${a1.toFixed(3)}*est + ${b1.toFixed(2)}`);
const buckets={};
for(const [e,t] of pts){const k=Math.round(e);(buckets[k]??=[]).push(t);}
for(const k of Object.keys(buckets).sort((x,y)=>x-y)) console.log(' est',k,'→ actual avg', (buckets[k].reduce((a,b)=>a+b,0)/buckets[k].length).toFixed(2), `(n=${buckets[k].length})`);
