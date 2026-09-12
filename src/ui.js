import { suitOf, contractRank, allContracts, trumpOf, mustWhist, WHIST_DUTY, replayGame } from './engine.js';
import { contractName, playerName, suitSym, entryText } from './format.js';
import { t, setLang, getLang, LANGS, LANG_NAMES, LANG_FLAGS } from './i18n.js';
import { LocalTable, RemoteTable, createRoom } from './transport.js';
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
// A finished deal is not thrown open at once: the last trick stays on the table
// for a moment, then the hands go face up, then the sheet comes over the top.
const REVEAL_DELAY = 2500, SHEET_DELAY = REVEAL_DELAY + 2000;
let revealedFor = 0;         // deal whose hands have been turned over
let revealTimer = null;
let mainTable = null;        // the real game, parked while a replay is on screen
let mainView = null;

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

  const bot = view.humans && !view.humans[seat] ? ` <small class="bot">${t('seat.bot')}</small>` : '';
  // Whose move it is, and why the table has gone quiet: a bot's first trick is a
  // full search and takes seconds, so it says so rather than looking stuck.
  const live = !['deal_end', 'game_over'].includes(view.phase);
  const waitingOn = live && view.actor === seat && seat !== view.you
    ? ` <small class="think">${t(view.humans && view.humans[seat] ? 'seat.toMove' : 'seat.thinking')}</small>`
    : '';
  if (!mine) {
    el.innerHTML = `<div class="name">${playerName(view, seat)}${bot}${waitingOn}</div>${stake}` +
      (showTricks ? `<div class="tag">${t('seat.tricks', { n: view.tricks[seat] })}</div>` : '');
    const shown = dealt() ? dealt()[seat] : view.hands[seat];
    if (shown) {                                   // cards face up on the table
      const mine = view.playFor === seat;
      el.insertAdjacentHTML('beforeend',
        `<div class="open-label">${t(dealt() ? 'seat.dealt'
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
  for (const c of (dealt() ? dealt()[seat] : view.hands[seat])) {
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
  if (dealt() && view.discard.length) {
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
  // A replay has a score sheet of its own that nobody keeps, so the sheet on
  // screen is always the real game's — that is the whole point of the warning.
  const sv = mainView || view;
  pulkaOpenedOn = view.deal;
  $('points').innerHTML = pointsHTML(sv);
  $('score').innerHTML = scoresheetSVG(sv);
  $('history').innerHTML = historyHTML(sv);
  const acts = $('pulkaactions');
  acts.innerHTML = '';
  if (view.phase === 'deal_end') acts.append(btn(t('btn.nextDeal'), () => {
    pulkadlg.close(); table.send({ type: 'next' });
  }, 'primary'));
  else if (view.phase === 'game_over') acts.append(btn(t('app.newGame'), () => { pulkadlg.close(); newGame(); }, 'primary'));
  // The deal is over and every hand is on the table: it can be played again from
  // the start, as a trial run that changes nothing on this sheet.
  if (sv.dealt && !view.replay) acts.append(btn(t('btn.replay'), askReplay));
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

// The bidding ladder the way it is written on paper: levels down the side,
// suits across, and misère on its own rung between 8NT and 9♠ — which is
// exactly where it outranks them. Everything stays on screen, greyed when it is
// too cheap to name, so the ladder never rearranges itself between rounds and
// the bid you want is always in the same place.
function openBidDialog(mode, { title, minRank, onPick, extra, repeat }) {
  bidMode = mode;
  $('bidtitle').innerHTML = title;
  const grid = $('bidstrip');
  grid.className = 'ladder';     // set here too, so a stale index.html still lays out
  grid.innerHTML = '';
  const suits = allContracts().filter((c) => c.level === 6).map((c) => c.suit);

  const chip = (c, label, cls) => {
    const isRepeat = repeat && contractRank(c) === contractRank(repeat);
    const pick = () => { bidMode = null; biddlg.close(); onPick(c); };
    const b = btn(label + (isRepeat ? ' ↺' : ''),
      c.misere ? () => confirmAsk(t('dlg.misereAsk'), t('dlg.misereWarn'), pick, t('dlg.misereYes'))
               : pick,
      `chip ${cls}${isRepeat ? ' repeat' : ''}`);
    b.disabled = contractRank(c) < minRank
      || (!!c.misere && mode === 'bid' && !view.canBidMisere);   // misère is a first call only
    if (isRepeat) b.title = t('dlg.repeatTitle');
    return b;
  };

  let cheapest = null;
  for (const level of [6, 7, 8, 9, 10]) {
    if (level === 9) grid.append(chip({ misere: true }, contractName({ misere: true }), 'misere'));
    const rung = document.createElement('span');
    rung.className = 'lvl';
    rung.textContent = level;
    grid.append(rung);
    for (const suit of suits) {
      const b = chip({ level, suit }, suitSym(suit), suit);
      grid.append(b);
      if (!b.disabled && !cheapest) cheapest = b;
    }
  }
  cheapest?.classList.add('first');

  const acts = $('bidactions');
  acts.innerHTML = '';
  if (extra) acts.append(extra);
  acts.append(btn(t('btn.close'), dismissBid));
  if (!biddlg.open) biddlg.show();     // non-modal, so the table stays visible
}

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

// Somebody at the table says the rest of the deal is settled: agree and it is
// written down as it stands, or refuse and play it out card by card.
const splitText = (tricks) =>
  tricks.map((n, i) => `${playerName(view, i)} ${n}`).join(' · ');

function openClaim() {
  const c = view.claim;
  ask({
    mode: 'claim',
    title: t('claim.title'),
    text: t('claim.text', { player: playerName(view, c.by), split: splitText(c.tricks) }),
    buttons: [
      { label: t('btn.claimAccept'), cls: 'primary', fn: () => table.send({ type: 'claimAccept' }) },
      { label: t('btn.claimDecline'), fn: () => table.send({ type: 'claimDecline' }) },
    ],
  });
}

const canClaim = () => view.phase === 'play' && !!view.claim && view.actor === view.you
  && !view.claim.agreed[view.you];
// The hands as dealt, but only once the pause after the last trick is over.
const dealt = () => (view.dealt && revealedFor === view.deal ? view.dealt : null);

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

  // an online table waits for its host to start; until then nobody acts
  if (view.started === false) {
    const host = view.hostSeat === view.you;
    hint(host ? t('lobby.host', { code: ROOM })
      : t('lobby.guest', { player: playerName(view, view.hostSeat) }));
    if (host) row().append(btn(t('btn.startGame'), () => table.send({ type: 'start' }), 'primary'));
    return;
  }
  if (view.phase === 'game_over') {
    hint(t('hint.gameOver'));
    row().append(btn(t('app.pool'), openPulka));
    return;
  }
  if (view.phase === 'deal_end') {
    const tricks = view.players.map((_, i) => `${playerName(view, i)} ${view.tricks[i]}`).join(' · ');
    if (view.replay) {
      hint(t('hint.replayOver', { tricks }));
      row().append(btn(t('btn.replayAgain'), startReplay, 'primary'));
      return;
    }
    hint(t('hint.dealOver', { tricks }));
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
  showCode();                    // whether the table is yours to restart is in the view
  $('status').textContent = v.replay ? t('app.replay')
    : t('app.status', { deal: v.deal, target: v.poolTarget });
  $('status').classList.toggle('replay', !!v.replay);
  // The way back sits with the word "trial run", not in the action bar: down
  // there it displaced the buttons the deal itself is asking for.
  const back = $('replayback');
  back.hidden = !v.replay;
  back.textContent = t('btn.backToGame');
  $('table').classList.toggle('wide-seats', [0, 1, 2].some((i) => i !== v.you && (dealt() || v.hands[i])));
  // a finished deal puts every hand on the table at once: a narrow screen sizes for it
  $('table').classList.toggle('reveal', !!dealt());
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
  if (askMode === 'claim' && !canClaim()) { askMode = null; askdlg.close(); }
  if (!askMode && canClaim()) openClaim();

  const over = v.phase === 'deal_end' || v.phase === 'game_over';
  if (over && v.dealt && revealedFor !== v.deal && !revealTimer) {
    const deal = v.deal;                       // whatever happens next, this is the deal it opens
    revealTimer = setTimeout(() => {           // the last trick has had its moment
      revealTimer = null;
      if (view.deal !== deal) return;          // moved on already: the next deal gets its own pause
      revealedFor = deal;
      render(view);
    }, REVEAL_DELAY);
  }

  if (pulkadlg.open && v.deal !== pulkaOpenedOn) pulkadlg.close();   // new deal, drop the sheet
  else if (pulkadlg.open) openPulka();
  else if (over && !v.replay && pulkaShownFor !== v.deal) {
    pulkaShownFor = v.deal;                    // after the hands, long enough to read them
    setTimeout(() => {
      if (view.phase === 'deal_end' || view.phase === 'game_over') openPulka();
    }, SHEET_DELAY);
  }
}

// Static chrome is filled from the dictionary so the switcher can redraw it.
// Online only: the code people join by. Clicking copies the link to this table.
function showCode() {
  const el = $('roomcode');
  el.hidden = !ROOM;
  if (!ROOM) return;
  const label = () => { el.textContent = `${t('app.code')}: ${ROOM}`; };
  label();
  el.title = t('app.codeHint');
  el.onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${ROOM}`)
      .then(() => { el.textContent = t('app.copied'); setTimeout(label, 1500); })
      .catch(() => { /* no clipboard: the code itself is on screen anyway */ });
  };
}

function renderStatic() {
  document.documentElement.lang = getLang();
  document.title = t('app.title');
  $('apptitle').textContent = t('app.title');
  $('menubtn').setAttribute('aria-label', t('app.menu'));
  $('showpulka').textContent = t('app.pool');
  $('newgame').textContent = t('app.newGame');
  $('langs').innerHTML = langButtons();
  showCode();
}

// The flags live in the menu and, because that dialog is modal and covers it,
// in the new-game dialog as well.
const langButtons = () => LANGS.map((l) =>
  `<button class="lang${l === getLang() ? ' on' : ''}" data-lang="${l}" title="${LANG_NAMES[l]}">` +
  `${LANG_FLAGS[l]}</button>`).join('');

function pickLang(e) {
  const l = e.target.closest('.lang')?.dataset.lang;
  if (!l) return;
  setLang(l);
  try { localStorage.setItem('pf.lang', l); } catch { /* private mode */ }
  closeMenu();
  renderStatic();
  // popups keep their markup between renders, so rebuild whatever is open
  bidMode = null; bidDismissed = null; biddlg.close();
  askMode = null; askdlg.close();
  if (setupdlg.open) drawSetup();
  if (view) render(view);
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
$('langs').onclick = pickLang;

let ROOM = new URLSearchParams(location.search).get('room');

// Settings for the next game. Remembered, so the dialog opens on what was last
// played rather than on the defaults.
const stored = (k, dflt) => {
  try { const v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); } catch { return dflt; }
};
const setup = {
  poolTarget: stored('pf.pool', 10),
  stalingrad: stored('pf.stalingrad', false),
  whistBlame: stored('pf.blame', 'both'),
};
let myName = stored('pf.name', '');   // what the others at a table will call you

// The dialog does one of four things, and says which: play the bots here, open a
// table for friends, walk into somebody's table with their code, or (from the
// menu, mid-table) deal the same company a fresh game.
let setupMode = 'local';         // 'local' | 'create' | 'join' | 'restart'

function drawSetup() {
  const restart = setupMode === 'restart';
  $('setuptitle').textContent = t(restart ? 'dlg.restartTitle' : 'dlg.setupTitle');
  $('setuplangs').innerHTML = langButtons();      // the menu is behind a modal dialog
  $('setuplangs').onclick = pickLang;
  const body = $('setupbody');
  body.innerHTML = '';

  // the three ways into a new game; at a table none of them is lit, because the
  // dialog is offering to deal that table again — picking one leaves it
  const modes = document.createElement('div');
  modes.className = 'modes';
  for (const [m, key] of [['local', 'mode.bots'], ['create', 'mode.create'], ['join', 'mode.join']])
    modes.append(btn(t(key), () => { setupMode = m; drawSetup(); }, setupMode === m ? 'primary' : ''));
  body.append(modes);

  // online, the seat carries a name; against bots there is nobody to tell
  if (setupMode === 'create' || setupMode === 'join') {
    const row = document.createElement('div');
    row.className = 'setrow';
    row.append(Object.assign(document.createElement('span'), { textContent: t('dlg.setupName') }));
    const name = document.createElement('input');
    name.className = 'name'; name.maxLength = 16; name.value = myName;
    name.placeholder = t('dlg.setupNameHint');
    name.oninput = () => { myName = name.value; };
    row.append(name);
    body.append(row);
  }

  if (setupMode === 'join') {
    // somebody else's table: the code is all you bring, the rules are theirs
    const row = document.createElement('div');
    row.className = 'setrow';
    row.append(Object.assign(document.createElement('span'), { textContent: t('dlg.setupCode') }));
    const code = document.createElement('input');
    code.className = 'code'; code.maxLength = 5; code.placeholder = '—————';
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    code.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    row.append(code);
    body.append(row);
    setTimeout(() => code.focus(), 0);
  } else {
    body.append(Object.assign(document.createElement('div'),
      { className: 'sechead', textContent: t('dlg.setupRules') }));

    const pool = document.createElement('div');
    pool.className = 'setrow';
    pool.append(Object.assign(document.createElement('span'), { textContent: t('dlg.setupPool') }));
    for (const n of [10, 20, 50])
      pool.append(btn(String(n), () => { setup.poolTarget = n; drawSetup(); },
        setup.poolTarget === n ? 'primary' : ''));
    body.append(pool);

    const blame = document.createElement('div');
    blame.className = 'setrow';
    blame.append(Object.assign(document.createElement('span'), { textContent: t('dlg.setupBlame') }));
    for (const [mode, key] of [['both', 'dlg.blameBoth'], ['short', 'dlg.blameShort']])
      blame.append(btn(t(key), () => { setup.whistBlame = mode; drawSetup(); },
        setup.whistBlame === mode ? 'primary' : ''));
    body.append(blame);

    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = setup.stalingrad;
    box.onchange = () => { setup.stalingrad = box.checked; };
    const line = document.createElement('label');
    line.className = 'setrow';
    line.append(box, Object.assign(document.createElement('span'), { textContent: t('dlg.setupStalingrad') }),
      Object.assign(document.createElement('small'), { textContent: t('dlg.setupStalingradHint') }));
    body.append(line);
  }

  // there is a game behind this dialog, and starting another ends it
  if (table && view && view.phase !== 'game_over')
    body.append(Object.assign(document.createElement('div'),
      { className: 'setnote', textContent: t('dlg.newGameText') }));

  const acts = $('setupactions');
  acts.innerHTML = '';
  if (table) acts.append(btn(t('btn.cancel'), () => setupdlg.close()));
  acts.append(btn(t({ local: 'btn.playBots', create: 'btn.createTable', join: 'btn.join',
    restart: 'btn.dealAgain' }[setupMode]), go, 'primary'));
}

// What the dialog's one button does, per mode.
function go() {
  remember();
  if (setupMode === 'join') {
    const code = $('setupbody').querySelector('input.code').value;
    return code.length === 5 && joinRoom(code);
  }
  if (setupMode === 'create') return openOnline();
  if (setupMode === 'restart') {
    setupdlg.close();
    return table.send({ type: 'newgame', opts: { ...setup } });
  }
  ROOM = null;
  history.replaceState(null, '', location.pathname);
  setupdlg.close();
  startGame();
}

const remember = () => {
  try {
    localStorage.setItem('pf.pool', String(setup.poolTarget));
    localStorage.setItem('pf.stalingrad', String(setup.stalingrad));
    localStorage.setItem('pf.blame', JSON.stringify(setup.whistBlame));
  } catch { /* private mode */ }
};

// The token is what holds a seat, so it is kept per room: a reload rejoins the
// same hand instead of taking a new seat.
const tokenOf = (code) => { try { return localStorage.getItem('pf.seat.' + code); } catch { return null; } };
const keepToken = ({ room, token }) => {
  try { localStorage.setItem('pf.seat.' + room, token); } catch { /* private mode */ }
};
const forgetToken = (room) => {
  try { localStorage.removeItem('pf.seat.' + room); } catch { /* private mode */ }
};

function goRoom(code, token) {
  ROOM = code;
  history.replaceState(null, '', `?room=${code}`);
  setupdlg.close();
  startGame(token);
}

function openOnline() {
  createRoom({ ...setup, name: myName.trim() })
    .then(({ room, token, error }) => {
      if (error) throw new Error(error);
      keepToken({ room, token });
      goRoom(room, token);
    })
    .catch((e) => setupError(e.message || String(e)));
}

const joinRoom = (code) => goRoom(code, tokenOf(code));

function setupError(code) {
  const msg = t('err.joinFailed', { msg: t('err.' + code) });
  const box = $('setupbody');
  box.querySelector('.warn')?.remove();
  box.insertAdjacentHTML('beforeend', `<div class="warn">${msg}</div>`);
}

function openSetup(mode) {
  setupMode = mode;
  drawSetup();
  if (!setupdlg.open) setupdlg.showModal();
}
// with no game behind it there is nothing to go back to, so Esc does not close it
setupdlg.addEventListener('cancel', (e) => { if (!table) e.preventDefault(); });

function startGame(token) {
  freshScreen();
  mainTable = null; mainView = null;
  table = ROOM ? new RemoteTable({ room: ROOM, token: token ?? tokenOf(ROOM), name: myName.trim() })
    : new LocalTable({ seat: 0, ...setup });
  if (table.onSeat) table.onSeat = keepToken;
  if (table.onError) table.onError = (code) => {
    // The table is not there — a server restart forgets its rooms, so an old
    // link outlives the game it points at. Leave the room rather than sit on a
    // dead page: the dialog comes back with the code filled in, to try again or
    // to start something else.
    const failed = ROOM;
    table = null;
    ROOM = null;
    forgetToken(failed);
    history.replaceState(null, '', location.pathname);
    showCode();
    $('status').textContent = t('err.joinFailed', { msg: t('err.' + code) });
    openSetup('join');
    const box = $('setupbody').querySelector('input.code');
    if (box) box.value = failed;
    setupError(code);
  };
  attach(table);
  table.run();
  showCode();
}

// A trial run of the deal just played: the same cards dealt again into a table
// of its own, here in the browser even when the real game is online. The real
// table keeps running behind it — its states are ignored while this one is on
// screen — and comes back untouched, score and all.
// That a trial run is written down nowhere has to be said before it starts, not
// after — so the sheet steps aside for the question and comes back on a no.
function askReplay() {
  pulkadlg.close();
  ask({ mode: 'confirm', title: t('btn.replay'), text: t('app.replayWarn'), buttons: [
    { label: t('btn.replay'), cls: 'primary', fn: startReplay },
    { label: t('btn.cancel'), fn: openPulka }] });
}

function startReplay() {
  const from = mainView || view;
  if (!from.dealt) return;
  pulkadlg.close();
  if (!mainTable) { mainTable = table; mainView = from; }
  freshScreen();
  table = new LocalTable({ seat: from.you, game: replayGame(from) });
  attach(table);
  table.run();
}

function endReplay() {
  if (!mainTable) return;
  pulkadlg.close();
  table = mainTable; mainTable = null;
  freshScreen();
  pulkaShownFor = mainView.deal;          // its sheet has been seen once already
  render(mainView);
  mainView = null;
  table.run();
}

// The log and the popups belong to whatever table is on screen.
function freshScreen() {
  clearTimeout(revealTimer); revealTimer = null; revealedFor = 0;
  logLines = []; logSeen = -1; logDeal = 0; discardSel = []; pulkaShownFor = 0;
  bidMode = null; askMode = null; bidDismissed = null;
}

// Only the table on screen may draw: a replay parks the real one, and an online
// room goes on streaming states that must not reach the page.
const attach = (tbl) => tbl.onState((v) => { if (tbl === table) render(v); });

// The menu: a room keeps its seats, so the host deals a fresh game into the same
// table and may change the rules while doing it. Off a table, the usual dialog.
const newGame = () => { const v = mainView || view;      // a trial run has no table of its own
  openSetup(ROOM && v && v.hostSeat === v.you ? 'restart' : 'local'); };

// Opening the page: a link with a room code walks straight in — the table is
// already set and its rules are the host's — otherwise ask what to play.
const boot = () => (ROOM ? startGame() : openSetup('local'));

renderStatic();
$('newgame').onclick = () => { closeMenu(); newGame(); };
$('replayback').onclick = endReplay;
$('showpulka').onclick = () => { closeMenu(); openPulka(); };
boot();
