import { suitOf, contractRank, allContracts, trumpOf, mustWhist, WHIST_DUTY } from './engine.js';
import { contractName, playerName, suitSym, entryText } from './format.js';
import { t, setLang, getLang, LANGS, LANG_NAMES, LANG_FLAGS } from './i18n.js';
import { LocalTable, RemoteTable } from './transport.js';
import { cardSVG, backSVG } from './cards.js';
import { scoresheetSVG, pointsHTML, historyHTML } from './scoresheet.js';

const $ = (id) => document.getElementById(id);
const biddlg = $('biddlg'), pulkadlg = $('pulkadlg'), askdlg = $('askdlg'), setupdlg = $('setupdlg');

let table, view, discardSel = [], logLines = [], logSeen = -1, logDeal = 0;
let bidMode = null;          // 'bid' | 'declare' — what the bid popup is currently asking for
let bidDismissed = null;     // state key the user closed the popup on, so it stays closed
let pulkaShownFor = 0;       // deal whose result has already been popped up
let pulkaOpenedOn = 0;       // deal the score-sheet popup was opened on
let askMode = null;          // what the small popup is currently asking

function cardEl(c, cls = '', onClick) {
  const el = document.createElement('div');
  el.className = 'card ' + cls;
  el.innerHTML = cardSVG(c);
  if (onClick) el.onclick = () => onClick(c);
  return el;
}
function backEl(cls = '') {
  const el = document.createElement('div');
  el.className = 'card ' + cls;
  el.innerHTML = backSVG();
  return el;
}
const suitGap = () => Object.assign(document.createElement('div'), { className: 'suitgap' });

// Card sizes come from CSS so they can scale with the window; read them back
// rather than hard-coding, or the overlap of a long suit goes wrong.
const cssPx = (name, fallback) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

function bySuitRows(cards) {
  const rows = [];
  for (const c of cards) {
    if (!rows.length || suitOf(rows[rows.length - 1][0]) !== suitOf(c)) rows.push([]);
    rows[rows.length - 1].push(c);
  }
  return rows;
}

const lastBidOf = (seat) => {
  const b = [...view.bidHistory].reverse().find((x) => x.seat === seat);
  return b ? (b.contract ? contractName(b.contract) : t('seat.passed')) : '';
};

function roleTag(v, seat) {
  if (v.declarer === seat) return t('seat.declares', { contract: v.contract ? contractName(v.contract) : '' });
  if (v.declarer !== null && v.whistDecl[seat] === true) return t('seat.whisted');
  if (v.declarer !== null && v.whistDecl[seat] === false) return t('seat.passed');
  return '';
}

// the viewer always sits at the bottom; opponents go to the left and right edges
const slotOf = (seat) => 'seat' + ((seat - view.you + 3) % 3);

function renderSeat(seat) {
  const el = $(slotOf(seat));
  const mine = seat === view.you;
  el.className = 'seat ' + (mine ? 'me' : 'opp') +
    (view.turn === seat && view.phase !== 'deal_end' ? ' turn' : '');
  el.innerHTML = '';

  const bidding = view.phase === 'bidding';
  const showTricks = ['play', 'deal_end', 'game_over'].includes(view.phase);
  const bid = lastBidOf(seat);
  // the blank tag reserves the line so the panel does not jump when a bid lands;
  // it is marked so a narrow screen can drop it when every pixel counts
  const role = roleTag(view, seat);
  const stake = bidding
    ? (bid ? `<div class="bid">${bid}</div>` : '<div class="tag empty">&nbsp;</div>')
    : `<div class="tag${role ? '' : ' empty'}">${role || '&nbsp;'}</div>`;

  if (!mine) {
    el.innerHTML = `<div class="name">${playerName(view, seat)}</div>${stake}` +
      (showTricks ? `<div class="tag">${t('seat.tricks', { n: view.tricks[seat] })}</div>` : '');
    const shown = view.dealt ? view.dealt[seat] : view.hands[seat];
    if (shown) {                                   // cards face up on the table
      const mine = view.playFor === seat;
      el.insertAdjacentHTML('beforeend',
        `<div class="open-label">${t(view.dealt ? 'seat.dealt'
          : mine ? 'seat.youPlayIt' : 'seat.open')}</div>`);
      const open = document.createElement('div');
      open.className = 'opencards';
      for (const row of bySuitRows(shown)) {
        const line = document.createElement('div');
        line.className = 'suitrow';
        // a long suit is squeezed into an overlap so it stays a single row
        const cw = cssPx('--card-open-w', 40);
        const step = Math.min(cw + 3, Math.max(80, el.clientWidth - 18) / row.length);
        row.forEach((c, i) => {
          const card = mine
            ? cardEl(c, view.legal.includes(c) ? 'playable' : 'dim',
                view.legal.includes(c) ? (x) => table.send({ type: 'play', card: x }) : null)
            : cardEl(c);
          if (i) card.style.marginLeft = `${step - cw}px`;
          line.append(card);
        });
        open.append(line);
      }
      el.append(open);
      return;
    }
    const count = document.createElement('div');
    count.className = 'count';
    count.append(backEl());
    count.insertAdjacentHTML('beforeend', `<span>${view.handCounts[seat]}</span>`);
    el.append(count);
    return;
  }

  el.insertAdjacentHTML('beforeend', `<div class="name"><span>${playerName(view, seat)}</span>` +
    (bidding ? (lastBidOf(seat) ? `<span class="bid">${lastBidOf(seat)}</span>` : '')
             : `<span class="tag">${roleTag(view, seat)}</span>`) +
    (showTricks ? `<span class="tag">${t('seat.tricks', { n: view.tricks[seat] })}</span>` : '') + `</div>`);
  const box = document.createElement('div');
  box.className = 'cards';
  const canPlay = view.playFor === seat;
  let prevSuit = null;
  for (const c of (view.dealt ? view.dealt[seat] : view.hands[seat])) {
    if (prevSuit && suitOf(c) !== prevSuit) box.append(suitGap());
    prevSuit = suitOf(c);
    if (view.phase === 'talon' && view.turn === seat) {
      box.append(cardEl(c, discardSel.includes(c) ? 'sel' : 'playable', toggleDiscard));
    } else if (canPlay) {
      box.append(cardEl(c, view.legal.includes(c) ? 'playable' : 'dim',
        view.legal.includes(c) ? (card) => table.send({ type: 'play', card }) : null));
    } else {
      box.append(cardEl(c));
    }
  }
  el.append(box);
}

function renderCenter() {
  const raspas = !!(view.contract && view.contract.raspas);
  const talonRow = $('talon');
  talonRow.innerHTML = '';
  const backs = !view.talon && view.phase !== 'play';       // not turned up yet
  if (view.talon || backs) {
    talonRow.insertAdjacentHTML('beforeend', `<span>${t('table.talon')}</span>`);
    if (view.talon) view.talon.forEach((c) => talonRow.append(c ? cardEl(c) : backEl()));
    else { talonRow.append(backEl()); talonRow.append(backEl()); }
  }
  if (view.dealt && view.discard.length) {
    talonRow.insertAdjacentHTML('beforeend', `<span>&nbsp;${t('table.discard')}</span>`);
    view.discard.forEach((c) => talonRow.append(cardEl(c)));
  }
  if (raspas) {
    talonRow.insertAdjacentHTML('beforeend', `<span class="raspas">${t('table.raspas')}</span>`);
    if (view.forcedSuit) talonRow.insertAdjacentHTML('beforeend',
      `<span class="forced ${'dh'.includes(view.forcedSuit) ? 'red' : ''}">` +
      `${t('table.forced', { suit: suitSym(view.forcedSuit) })}</span>`);
  } else if (view.contract) {
    talonRow.insertAdjacentHTML('beforeend',
      `&nbsp;<span>${t('table.game', { contract: contractName(view.contract) })}</span>`);
  }
  talonRow.hidden = view.phase === 'play' && !raspas;   // in an all-pass deal the talon is shown instead

  const tr = $('trick');
  tr.innerHTML = '';
  const shown = view.trick.length ? view.trick : (view.lastTrick ? view.lastTrick.cards : []);
  const dim = !view.trick.length;
  for (const p of shown) {
    const slot = document.createElement('div');
    const where = p.player === view.you ? 'me' : (p.player === (view.you + 1) % 3 ? 'left' : 'right');
    slot.className = 'slot ' + where;
    slot.append(cardEl(p.card, dim ? 'dim' : ''));
    slot.insertAdjacentHTML('beforeend', `<div>${playerName(view, p.player)}</div>`);
    tr.append(slot);
  }
  $('lasttrick').textContent = view.lastTrick && !view.trick.length
    ? t('table.tookTrick', { player: playerName(view, view.lastTrick.winner) }) : '';
}

function renderLog() {
  // the log keeps the deal being played and nothing older: what happened two
  // deals ago is what the score sheet is for
  if (view.deal !== logDeal) { logDeal = view.deal; logSeen = 0; logLines = [{ deal: view.deal }]; }
  if (view.log.length > logSeen) { logLines.push(...view.log.slice(logSeen)); logSeen = view.log.length; }
  $('log').innerHTML = logLines.slice(-40)
    .map((l) => `<div>${l.deal ? t('log.dealHeader', { deal: l.deal }) : entryText(view, l)}</div>`)
    .join('');
  $('log').scrollTop = $('log').scrollHeight;
}

// --- score-sheet popup -------------------------------------------------------------

function openPulka() {
  pulkaOpenedOn = view.deal;
  $('points').innerHTML = pointsHTML(view);
  $('score').innerHTML = scoresheetSVG(view);
  $('history').innerHTML = historyHTML(view);
  const acts = $('pulkaactions');
  acts.innerHTML = '';
  if (view.phase === 'deal_end') acts.append(btn(t('btn.nextDeal'), () => {
    pulkadlg.close(); table.send({ type: 'next' });
  }, 'primary'));
  else if (view.phase === 'game_over') acts.append(btn(t('app.newGame'), () => { pulkadlg.close(); newGame(); }, 'primary'));
  acts.append(btn(t('btn.close'), () => pulkadlg.close()));
  if (!pulkadlg.open) pulkadlg.showModal();
}

// --- bidding popup ----------------------------------------------------------

function btn(text, fn, cls = '') {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = fn; b.className = cls; return b;
}

function ask({ mode, title, text, buttons }) {
  askMode = mode;
  $('asktitle').textContent = title;
  $('asktext').innerHTML = text || '';
  const acts = $('askactions');
  acts.innerHTML = '';
  for (const b of buttons) acts.append(btn(b.label, () => { askdlg.close(); b.fn && b.fn(); }, b.cls || ''));
  if (!askdlg.open) askdlg.show();
}
askdlg.addEventListener('close', () => {
  askMode = null;
  if (bidMode === 'declare') bidMode = null;
  render(view);
});

const confirmAsk = (title, text, onYes, yes) =>
  ask({ mode: 'confirm', title, text, buttons: [
    { label: yes, cls: 'primary', fn: onYes }, { label: t('btn.cancel') }] });

function openBidDialog(mode, { title, minRank, onPick, extra, repeat }) {
  bidMode = mode;
  $('bidtitle').innerHTML = title;
  const strip = $('bidstrip');
  strip.innerHTML = '';
  const list = allContracts().filter((c) =>
    contractRank(c) >= minRank && (!c.misere || mode !== 'bid' || view.canBidMisere));
  let firstGame = null;
  for (const c of [...list.filter((x) => x.misere), ...list.filter((x) => !x.misere)]) {
    const isRepeat = repeat && contractRank(c) === contractRank(repeat);
    const pick = () => { bidMode = null; biddlg.close(); onPick(c); };
    const b = btn(contractName(c) + (isRepeat ? ' ↺' : ''),
      c.misere ? () => confirmAsk(t('dlg.misereAsk'), t('dlg.misereWarn'), pick, t('dlg.misereYes'))
               : pick,
      'chip' + (c.misere || isRepeat ? ' wide' : '') + (isRepeat ? ' repeat' : ''));
    if (isRepeat) b.title = t('dlg.repeatTitle');
    strip.append(b);
    if (!c.misere && !firstGame) firstGame = b;
  }
  firstGame?.classList.add('first');
  const acts = $('bidactions');
  acts.innerHTML = '';
  if (extra) acts.append(extra);
  acts.append(btn(t('btn.close'), dismissBid));
  if (!biddlg.open) biddlg.show();     // non-modal, so the table stays visible
  // focus on six of spades; misère stays off the left edge, reachable with ‹
  if (firstGame) requestAnimationFrame(() =>
    strip.scrollTo({ left: firstGame.offsetLeft - strip.offsetLeft, behavior: 'instant' }));
}

// smooth scrolling is swallowed by scroll-snap here, so step instantly
const scrollStrip = (dir) => {
  const strip = $('bidstrip');
  strip.scrollTo({ left: strip.scrollLeft + dir * 200, behavior: 'instant' });
};
$('bidprev').onclick = () => scrollStrip(-1);
$('bidnext').onclick = () => scrollStrip(1);
// Auto-open once per decision point; reopening is on the bid button.
// Dismissal is recorded on the explicit close/Esc, never in the 'close' event —
// that one fires asynchronously, by which time the state may have moved on.
const bidKey = () => `${view.deal}:${view.phase}:${view.bidHistory.length}`;
const dismissBid = () => { bidDismissed = bidKey(); bidMode = null; biddlg.close(); };
biddlg.addEventListener('cancel', () => { bidDismissed = bidKey(); });
biddlg.addEventListener('close', () => { bidMode = null; render(view); });

function openWhist() {
  const forced = mustWhist(view);
  ask({
    mode: 'whist',
    title: t('dlg.whistTitle', {
      player: playerName(view, view.declarer), contract: contractName(view.contract),
    }),
    text: t('dlg.whistText', { duty: WHIST_DUTY[view.contract.level] }) +
      (forced ? `<div class="warn">${t('dlg.whistForced')}</div>` : ''),
    buttons: [
      { label: t('dlg.whistYes'), cls: 'primary', fn: () => table.send({ type: 'whist', whist: true }) },
      ...(forced ? [] : [{ label: t('btn.pass'), fn: () => table.send({ type: 'whist', whist: false }) }]),
    ],
  });
}

const canBid = () => view.phase === 'bidding' && view.turn === view.you;
const canWhist = () => view.phase === 'whist' && view.turn === view.you;
const canDeclare = () => view.phase === 'talon' && view.turn === view.you && discardSel.length === 2;

function openBid() {
  bidDismissed = null;
  const repeat = view.canRepeat ? view.highBid : null;
  openBidDialog('bid', {
    title: t('dlg.bidding', { bid: contractName(view.highBid) }) + (repeat ? t('dlg.repeatHint') : ''),
    minRank: contractRank(view.highBid) + (repeat ? 0 : 0.01),
    repeat,
    onPick: (c) => table.send({ type: 'bid', contract: c }),
    extra: btn(t('btn.pass'), () => { bidMode = null; biddlg.close(); table.send({ type: 'bid', contract: null }); }, 'primary'),
  });
}

function openDeclare() {
  const send = (contract) => table.send({ type: 'declare', discard: discardSel.slice(), contract });
  if (view.highBid.misere) {                 // misère cannot be abandoned, only discarded for
    bidMode = 'declare';
    return ask({
      mode: 'declare', title: t('dlg.misereLocked'), text: t('dlg.misereLockedText'),
      buttons: [{ label: t('dlg.miserePlay'), cls: 'primary', fn: () => send({ misere: true }) },
                { label: t('dlg.misereRedo'), fn: () => { bidMode = null; } }],
    });
  }
  openBidDialog('declare', {
    title: t('dlg.declare'),
    minRank: contractRank(view.highBid),
    onPick: send,
  });
}

// --- action bar -------------------------------------------------------------

function renderActions() {
  const box = $('actions');
  box.innerHTML = '';
  const hint = (t) => box.insertAdjacentHTML('beforeend', `<div class="hint">${t}</div>`);
  const row = () => { const r = document.createElement('div'); r.className = 'row'; box.append(r); return r; };

  if (view.phase === 'game_over') {
    hint(t('hint.gameOver'));
    row().append(btn(t('app.pool'), openPulka));
    return;
  }
  if (view.phase === 'deal_end') {
    hint(t('hint.dealOver', {
      tricks: view.players.map((_, i) => `${playerName(view, i)} ${view.tricks[i]}`).join(' · '),
    }));
    row().append(btn(t('btn.nextDeal'), () => table.send({ type: 'next' }), 'primary'));
    return;
  }
  // in a light whist you may move for another seat, and your own may be moved for you
  const waiting = view.phase === 'play' ? view.playFor === null : view.turn !== view.you;
  if (waiting) {
    hint(view.turn === view.you && view.actor !== view.you
      ? t('hint.playsForYou', { player: playerName(view, view.actor) })   // partner plays your hand
      : t('hint.waiting', { player: playerName(view, view.turn) }));
    return;
  }

  if (view.phase === 'bidding') {
    hint(t('hint.bidding', { bid: contractName(view.highBid) }) +
      (view.canRepeat ? t('hint.canRepeat') : ''));
    row().append(btn(t('btn.bid'), openBid, 'primary'));
    return;
  }
  if (view.phase === 'talon') {
    hint(t('hint.talon', { n: discardSel.length }));
    const b = btn(t('btn.declare'), openDeclare, 'primary');
    b.disabled = discardSel.length !== 2;
    row().append(b);
    return;
  }

  if (view.phase === 'whist') {
    hint(t('hint.whist', {
      player: playerName(view, view.declarer), contract: contractName(view.contract),
    }));
    row().append(btn(t('btn.whist'), openWhist, 'primary'));
    return;
  }
  if (view.phase === 'play') {
    const tr = trumpOf(view.contract);
    const forOther = view.playFor !== null && view.playFor !== view.you;
    const game = view.contract.raspas
      ? t('hint.raspas') + (view.forcedSuit ? t('hint.raspasSuit', { suit: suitSym(view.forcedSuit) }) : '')
      : (tr ? t('hint.trump', { suit: suitSym(tr) }) : t('hint.noTrump'));
    hint((forOther ? t('hint.playFor', { player: playerName(view, view.playFor) }) : t('hint.yourMove')) +
      ` ${game}. ${t('hint.tricksTaken', { n: view.tricks[view.you] })}`);
  }
}

function toggleDiscard(c) {
  discardSel = discardSel.includes(c) ? discardSel.filter((x) => x !== c)
    : [...discardSel, c].slice(-2);
  render(view);
}

function render(v) {
  view = v;
  if (v.phase !== 'talon') discardSel = [];
  $('status').textContent = t('app.status', { deal: v.deal, target: v.poolTarget });
  $('table').classList.toggle('wide-seats', [0, 1, 2].some((i) => i !== v.you && (v.dealt || v.hands[i])));
  // a finished deal puts every hand on the table at once: a narrow screen sizes for it
  $('table').classList.toggle('reveal', !!v.dealt);
  [0, 1, 2].forEach(renderSeat);
  renderCenter();
  renderLog();
  renderActions();

  // popups follow the state: close when they no longer apply, open on a new result
  // the <dialog> 'close' event is async, so the mode is cleared right here
  if (bidMode === 'bid' && !canBid()) { bidMode = null; biddlg.close(); }
  if (bidMode === 'declare' && !canDeclare()) { bidMode = null; biddlg.close(); askdlg.close(); }
  if (!bidMode && canBid() && bidDismissed !== bidKey()) openBid();
  if (!bidMode && canDeclare()) openDeclare();
  if (askMode === 'whist' && !canWhist()) { askMode = null; askdlg.close(); }
  if (!askMode && canWhist()) openWhist();

  if (pulkadlg.open && v.deal !== pulkaOpenedOn) pulkadlg.close();   // new deal, drop the sheet
  else if (pulkadlg.open) openPulka();
  else if ((v.phase === 'deal_end' || v.phase === 'game_over') && pulkaShownFor !== v.deal) {
    pulkaShownFor = v.deal;                                          // let the last trick be seen first
    setTimeout(() => {
      if (view.phase === 'deal_end' || view.phase === 'game_over') openPulka();
    }, 1500);
  }
}

// Static chrome is filled from the dictionary so the switcher can redraw it.
function renderStatic() {
  document.documentElement.lang = getLang();
  document.title = t('app.title');
  $('apptitle').textContent = t('app.title');
  $('menubtn').setAttribute('aria-label', t('app.menu'));
  $('showpulka').textContent = t('app.pool');
  $('newgame').textContent = t('app.newGame');
  $('langs').innerHTML = LANGS.map((l) =>
    `<button class="lang${l === getLang() ? ' on' : ''}" data-lang="${l}" title="${LANG_NAMES[l]}">` +
    `${LANG_FLAGS[l]}</button>`).join('');
  $('bidprev').setAttribute('aria-label', t('nav.prev'));
  $('bidnext').setAttribute('aria-label', t('nav.next'));
}

// One dropdown holds everything that is not part of the table itself.
const menu = $('menu');
const closeMenu = () => { menu.hidden = true; $('menubtn').setAttribute('aria-expanded', 'false'); };
$('menubtn').onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $('menubtn').setAttribute('aria-expanded', String(!menu.hidden));
};
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

setLang(localStorage.getItem('pf.lang') || getLang());
$('langs').onclick = (e) => {
  const l = e.target.closest('.lang')?.dataset.lang;
  if (!l) return;
  setLang(l);
  try { localStorage.setItem('pf.lang', l); } catch { /* private mode */ }
  closeMenu();
  renderStatic();
  // popups keep their markup between renders, so rebuild whatever is open
  bidMode = null; bidDismissed = null; biddlg.close();
  askMode = null; askdlg.close();
  if (setupdlg.open) drawSetup(startGame);
  if (view) render(view);
};

const ROOM = new URLSearchParams(location.search).get('room');

// Settings for the next game. Remembered, so the dialog opens on what was last
// played rather than on the defaults.
const stored = (k, dflt) => {
  try { const v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); } catch { return dflt; }
};
const setup = { poolTarget: stored('pf.pool', 10), stalingrad: stored('pf.stalingrad', false) };

function drawSetup(onStart) {
  $('setuptitle').textContent = t('dlg.setupTitle');
  const body = $('setupbody');
  body.innerHTML = '';

  const pool = document.createElement('div');
  pool.className = 'setrow';
  pool.append(Object.assign(document.createElement('span'), { textContent: t('dlg.setupPool') }));
  for (const n of [10, 20, 50])
    pool.append(btn(String(n), () => { setup.poolTarget = n; drawSetup(onStart); },
      setup.poolTarget === n ? 'primary' : ''));
  body.append(pool);

  const box = document.createElement('input');
  box.type = 'checkbox'; box.checked = setup.stalingrad;
  box.onchange = () => { setup.stalingrad = box.checked; };
  const line = document.createElement('label');
  line.className = 'setrow';
  line.append(box, Object.assign(document.createElement('span'), { textContent: t('dlg.setupStalingrad') }),
    Object.assign(document.createElement('small'), { textContent: t('dlg.setupStalingradHint') }));
  body.append(line);

  const acts = $('setupactions');
  acts.innerHTML = '';
  acts.append(btn(t('btn.start'), () => {
    try {
      localStorage.setItem('pf.pool', String(setup.poolTarget));
      localStorage.setItem('pf.stalingrad', String(setup.stalingrad));
    } catch { /* private mode */ }
    setupdlg.close();
    onStart();
  }, 'primary'));
}

function openSetup(onStart) {
  drawSetup(onStart);
  if (!setupdlg.open) setupdlg.showModal();
}
// with no game behind it there is nothing to go back to, so Esc does not close it
setupdlg.addEventListener('cancel', (e) => { if (!table) e.preventDefault(); });

function startGame() {
  logLines = []; logSeen = -1; logDeal = 0; discardSel = []; pulkaShownFor = 0;
  table = ROOM ? new RemoteTable({ room: ROOM })
    : new LocalTable({ seat: 0, poolTarget: setup.poolTarget, stalingrad: setup.stalingrad });
  if (table.onError) table.onError = (code) => {
    const text = t('err.joinFailed', { msg: t('err.' + code) });
    $('status').textContent = text;
    $('actions').innerHTML = `<div class="hint">${text}</div>`;
  };
  table.onState(render);
  table.run();
}

// online: the room owns the settings, so there is nothing to ask
const newGame = () => (ROOM ? startGame() : openSetup(startGame));

renderStatic();
$('newgame').onclick = () => {
  closeMenu();
  if (!view || view.phase === 'game_over') return newGame();
  confirmAsk(t('dlg.newGameAsk'), t('dlg.newGameText'), newGame, t('app.newGame'));
};
$('showpulka').onclick = () => { closeMenu(); openPulka(); };
$('newgame').disabled = !!ROOM;                 // online: the room owns the game
newGame();
