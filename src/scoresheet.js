// The classic paper score sheet: a vertical from the top down to the pool-target
// box, two rays from the box down to the base of a trapezoid, giving three
// sectors. Narrow columns hug the side sectors, and beyond them sit the whist
// boxes, two per player. Approximate points live in a separate table above the
// sheet, never inside the drawing.
import { finalScores } from './engine.js';
import { contractName, playerName } from './format.js';
import { t } from './i18n.js';

const PAPER = '#f7f4dd', LINE = '#c0574a', INK = '#2f2a24';
const MOUNTAIN = '#b3261e', MUTED = '#8d8574', NEW = '#a8781a';   // NEW: points table only

const W = 500, H = 360;
const XV1 = 98, XV2 = 122, XV3 = W - XV2, XV4 = W - XV1;   // side verticals
const YH = 130;                                            // split of the side whist boxes
const CX = W / 2, BOXW = 28, BOXY0 = 118, BOXY1 = 145;     // the pool-target box
const BY = 258;                                            // base of the trapezoid

// height at which a side vertical meets the ray
const YV2 = BOXY1 + ((CX - BOXW - XV2) / (CX - BOXW - XV1)) * (BY - BOXY1);

const fmt = (n) => String(Math.round(n * 10) / 10);      // scores can be fractional

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// running totals: one entry per deal that moved the counter
const running = (history, pick) => {
  let acc = 0;
  return history.filter((h) => pick(h)).map((h) => (acc += pick(h)));
};
const poolRun = (H, seat) => running(H, (h) => h.pool[seat]);
const mountRun = (H, seat) => running(H, (h) => h.mountain[seat]);
const whistRun = (H, i, j) => running(H, (h) => h.whists[i][j]);

// Every cell reads from the seat it belongs to: for the player on the left the
// line runs top to bottom with letters facing right (rotate 90), for the one on
// the right the other way round (rotate -90), and normally for the bottom seat.
// The player on the left reads top-to-bottom, the one on the right
// bottom-to-top, the one at the bottom normally. The anchor always sits at the
// start of the line, so left cells fill from the top and right ones from the
// bottom, the way two people would write from opposite sides of the table.
const spin = (x, y, rot) => (rot ? ` transform="rotate(${rot} ${x} ${y})"` : '');

// "4·6·12·22·36" — a dot separates entries, none after the last. A long run does
// not spill out of its cell: it wraps. A mountain grows upward, so its next line
// is written above the one it came from (`up`); every other run wraps the usual
// way. `len` is the room along a line and `room` the room across them; a sector
// bounded by a slanting ray gives each further line `shrink` less length and, in
// the trapezoid, a `slant` later start (both in line heights). When even that is
// not enough the hand writes smaller — exactly what happens on paper.
function records(x, y, values, color, fresh, { rot = 0, size = 15, len = 1e4, room = 1e4, shrink = 0, slant = 0, up = false, mark = '' } = {}) {
  const list = (values.length ? values : [0]).map(String);
  // colour says what the number is, weight says when: only what the deal just
  // played added is bold
  const items = list.map((v, i) => ({ s: v, bold: i === list.length - 1 && fresh }));
  if (mark) items.push({ s: mark, bold: false });

  const wrap = (fs) => {
    const cw = fs * 0.58, dw = fs * 0.3;          // digit and separator width
    const rows = [[]];
    let used = 0, cap = len;
    for (const it of items) {
      const need = (rows[rows.length - 1].length ? dw : 0) + it.s.length * cw;
      if (used && used + need > cap) { rows.push([it]); used = it.s.length * cw; cap -= shrink * fs * 1.26; }
      else { rows[rows.length - 1].push(it); used += need; }
    }
    return rows;
  };

  let fs = size, rows = wrap(fs);
  while (fs > 8 && rows.length > 1 + Math.floor(room / (fs * 1.26))) rows = wrap(--fs);

  const lh = fs * 1.26;
  const pos = (i) => {
    const o = (up ? i : -i) * lh;                 // toward the reader's own "up"
    const d = i * slant * lh;                     // along the line, into the sector
    if (rot === 90) return [x + o, y + d];
    if (rot === -90) return [x - o, y - d];
    return [x + d, y - o];
  };
  return rows.map((row, i) => {
    const [rx, ry] = pos(i).map((n) => n.toFixed(1));
    const body = row.map((it) => `<tspan${it.bold ? ' font-weight="700"' : ''}>${esc(it.s)}</tspan>`)
      .join('<tspan opacity=".45">·</tspan>');
    return `<text x="${rx}" y="${ry}" font-size="${fs}" fill="${color}"${spin(rx, ry, rot)}>${body}</text>`;
  }).join('');
}

const label = (x, y, text, rot, { size = 12, weight = 700, color = INK } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}"
     ${spin(x, y, rot)}>${text}</text>`;

export function scoresheetSVG(v) {
  const S = v.score, Hi = v.history, before = v.result ? v.result.before : null;
  const moved = (k, seat) => !!before && S[k][seat] !== before[k][seat];
  const wMoved = (i, j) => !!before && S.whists[i][j] !== before.whists[i][j];
  const nm = (i) => esc(playerName(v, i));
  const shut = (seat) => (S.pool[seat] >= v.poolTarget ? '>>' : '');
  const onto = (i) => (i === v.you ? t('sheet.you') : nm(i));
  const me = v.you, left = (v.you + 1) % 3, right = (v.you + 2) % 3;

  // in rotated cells the caption and the entries are two parallel lines
  // (different x); in the bottom ones the caption sits above (different y)
  const whist = (capX, recX, y, from, to, rot, len) =>
    label(capX, y, t('sheet.whistOn', { from: nm(from), to: onto(to) }), rot, { size: 9, weight: 400, color: MUTED }) +
    records(recX, rot ? y : y + 20, whistRun(Hi, from, to), INK, wMoved(from, to), { rot, size: 13, len, room: 64 });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">
    <rect width="${W}" height="${H}" fill="${PAPER}"/>
    <g stroke="${LINE}" stroke-width="1.6" fill="none">
      <rect x=".8" y=".8" width="${W - 1.6}" height="${H - 1.6}"/>
      <line x1="${CX}" y1="0" x2="${CX}" y2="${BOXY0}"/>
      <rect x="${CX - BOXW}" y="${BOXY0}" width="${BOXW * 2}" height="${BOXY1 - BOXY0}" fill="#fff"/>
      <line x1="${CX - BOXW}" y1="${BOXY1}" x2="${XV1}" y2="${BY}"/>
      <line x1="${CX + BOXW}" y1="${BOXY1}" x2="${XV4}" y2="${BY}"/>
      <line x1="${XV1}" y1="${BY}" x2="${XV4}" y2="${BY}"/>
      <line x1="${XV1}" y1="0" x2="${XV1}" y2="${BY}"/>
      <line x1="${XV2}" y1="0" x2="${XV2}" y2="${YV2.toFixed(1)}"/>
      <line x1="${XV3}" y1="0" x2="${XV3}" y2="${YV2.toFixed(1)}"/>
      <line x1="${XV4}" y1="0" x2="${XV4}" y2="${BY}"/>
      <line x1="0" y1="${YH}" x2="${XV1}" y2="${YH}"/>
      <line x1="${XV4}" y1="${YH}" x2="${W}" y2="${YH}"/>
      <line x1="${CX}" y1="${BY}" x2="${CX}" y2="${H}"/>
      <line x1="${XV1}" y1="${BY}" x2="0" y2="${H}"/>
      <line x1="${XV4}" y1="${BY}" x2="${W}" y2="${H}"/>
    </g>
    <text x="${CX}" y="${BOXY1 - 8}" text-anchor="middle" font-size="15" font-weight="700" fill="${INK}">${v.poolTarget}</text>

    <text x="${CX - 8}" y="14" text-anchor="end" font-size="12" font-weight="700" fill="${INK}">${nm(left)}</text>
    ${records(XV2 + 8, 30, mountRun(Hi, left), MOUNTAIN, moved('mountain', left), { rot: 90, len: 180, shrink: 1.1, room: 66, up: true })}
    ${records(XV1 + 5, 12, poolRun(Hi, left), INK, moved('pool', left), { rot: 90, mark: shut(left) })}

    <text x="${CX + 8}" y="14" text-anchor="start" font-size="12" font-weight="700" fill="${INK}">${nm(right)}</text>
    ${records(XV3 - 12, 196, mountRun(Hi, right), MOUNTAIN, moved('mountain', right), { rot: -90, len: 190, shrink: 1.1, slant: 1.1, room: 70, up: true })}
    ${records(XV4 - 4, 226, poolRun(Hi, right), INK, moved('pool', right), { rot: -90, mark: shut(right) })}

    <text x="${CX}" y="158" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">${nm(me)}</text>
    ${records(150, 228, mountRun(Hi, me), MOUNTAIN, moved('mountain', me), { len: 192, shrink: 2.2, slant: 1.1, room: 58, up: true })}
    <line x1="${XV2}" y1="${YV2.toFixed(1)}" x2="${XV3}" y2="${YV2.toFixed(1)}"
      stroke="${LINE}" stroke-width="1.5"/>
    ${records(128, 252, poolRun(Hi, me), INK, moved('pool', me), { mark: shut(me) })}

    ${whist(XV1 - 12, XV1 - 28, 20, left, right, 90, 105)}
    ${whist(XV1 - 12, XV1 - 28, YH + 20, left, me, 90, 105)}
    ${whist(W - XV1 + 12, W - XV1 + 30, YH - 4, right, left, -90, 120)}
    ${whist(W - XV1 + 12, W - XV1 + 30, BY - 4, right, me, -90, 120)}
    ${whist(96, 78, BY + 16, me, left, 0, 168)}
    ${whist(CX + 14, CX + 12, BY + 16, me, right, 0, 168)}
  </svg>`;
}

// separate table of approximate points, shown above the sheet
export function pointsHTML(v) {
  const prev = v.result ? finalScores(v.result.before) : null;
  const cells = [(v.you + 1) % 3, v.you, (v.you + 2) % 3].map((seat) => {   // same order as the seats at the table
    const d = prev ? v.finals[seat] - prev[seat] : 0;
    return `<div class="pcell"><span class="pname">${esc(playerName(v, seat))}</span>
      <span class="pval">${fmt(v.finals[seat])}</span>
      ${Math.abs(d) > 0.05 ? `<span class="pdelta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>` : ''}</div>`;
  }).join('');
  return `<div class="prow">${cells}</div>`;
}

// only the current deal: everything earlier is already on the sheet
export function historyHTML(v) {
  const h = v.history[v.history.length - 1];
  if (!h || h.deal !== v.deal) return `<div class="hcard empty">${t('sheet.notPlayed')}</div>`;
  const bits = [];
  v.players.forEach((_, i) => {
    const who = esc(playerName(v, i));
    if (h.pool[i]) bits.push(t('score.poolAdd', { player: who, n: h.pool[i] }));
    // help and a closed pool can push the mountain down, so the sign matters
    if (h.mountain[i] > 0) bits.push(t('score.mountainAdd', { player: who, n: h.mountain[i] }));
    else if (h.mountain[i] < 0) bits.push(t('score.mountainLess', { player: who, n: -h.mountain[i] }));
    const won = h.whists[i].reduce((a, b) => a + b, 0);
    if (won) bits.push(t('score.whistsAdd', { player: who, n: won }));
  });
  const who = h.declarer === null ? ''
    : t('sheet.declaredBy', { player: esc(playerName(v, h.declarer)) });
  return `<div class="hcard">
    <div class="htop">${t('sheet.dealLine', {
      deal: h.deal, contract: esc(contractName(h.contract)), who, tricks: h.tricks.join(' · '),
    })}</div>
    <div class="hbot">${bits.join(' · ') || t('sheet.nothing')}</div>
  </div>`;
}
