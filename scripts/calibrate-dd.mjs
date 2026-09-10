// Fits declarerTricks() (double dummy, sampled opponents) against tricks
// actually won in bot-vs-bot playouts. Run from the repo root:
//   node scripts/calibrate-dd.mjs [deals] [seed] [budgetMs] [samples]
import { setRandom, newGame, applyAction, viewFor, sortHand, controllerOf, SUITS } from '../src/engine.js';
import { setPlayBudget, declarerTricks } from '../src/solver.js';
import { botAction, estimateTricks } from '../src/bots.js';
const seeded=(s)=>()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
const DEALS=Number(process.argv[2]||60), SEED=Number(process.argv[3]||99), SAMPLES=Number(process.argv[5]||6);
setPlayBudget(Number(process.argv[4]||12));
setRandom(seeded(SEED));
const pts=[];
for(let n=0;n<DEALS;n++){
  const g=newGame(); const d=0;
  g.declarer=d; g.hands[d]=sortHand(g.hands[d].concat(g.talon)); g.talonOpen=true; g.phase='talon'; g.turn=d; g.highBid={level:6,suit:'s'};
  const a=botAction(viewFor(g,d));
  const kept=g.hands[d].filter(c=>!a.discard.includes(c));
  const trump=a.contract.misere?null:(a.contract.suit==='nt'?null:a.contract.suit);
  const dd=declarerTricks(kept,trump,{samples:SAMPLES,declarer:d});
  const est=estimateTricks(kept,trump);
  applyAction(g,d,a);
  while(g.phase==='whist') applyAction(g,g.turn,{type:'whist',whist:true});
  while(g.phase==='play'){const s2=controllerOf(g,g.turn);applyAction(g,s2,botAction(viewFor(g,s2)));}
  pts.push([dd,g.tricks[d],est]);
}
const n=pts.length, sx=pts.reduce((a,p)=>a+p[0],0)/n, sy=pts.reduce((a,p)=>a+p[1],0)/n;
const cov=pts.reduce((a,p)=>a+(p[0]-sx)*(p[1]-sy),0), varx=pts.reduce((a,p)=>a+(p[0]-sx)**2,0);
console.log(`dd mean ${sx.toFixed(2)}  actual mean ${sy.toFixed(2)}   actual ≈ ${(cov/varx).toFixed(3)}*dd + ${(sy-(cov/varx)*sx).toFixed(2)}`);
const mae=(f)=>(pts.reduce((a,p)=>a+Math.abs(f(p)-p[1]),0)/n).toFixed(2);
console.log(`MAE  dd ${mae(p=>p[0])}   old fit ${mae(p=>0.66*p[2]+0.7)}`);
const b={}; for(const [e,t] of pts){const k=Math.round(e);(b[k]??=[]).push(t);}
for(const k of Object.keys(b).sort((x,y)=>x-y)) console.log(' dd',k,'→ actual avg',(b[k].reduce((a,c)=>a+c,0)/b[k].length).toFixed(2),`(n=${b[k].length})`);
