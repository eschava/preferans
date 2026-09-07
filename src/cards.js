// SVG card faces. Suits are drawn as paths, not font glyphs, so the deck looks
// the same everywhere. One <svg> per card, sized by CSS on the wrapper.
import { suitOf } from './engine.js';
import { rankLabel } from './format.js';
import { getLang } from './i18n.js';

const RED = '#c8102e', BLACK = '#1b1b1b';
export const colorOf = (s) => ('dh'.includes(s) ? RED : BLACK);

// Every pip is designed inside a -11..11 box and placed with translate/scale.
const PIP = {
  s: '<path d="M0,-10.5C-1.5,-5 -9.5,-2.5 -9.5,2.5C-9.5,6 -6.5,7.8 -3.8,6.6C-2.4,6 -1.6,6.4 -2,7.6L-3.6,10.5L3.6,10.5L2,7.6C1.6,6.4 2.4,6 3.8,6.6C6.5,7.8 9.5,6 9.5,2.5C9.5,-2.5 1.5,-5 0,-10.5Z"/>',
  h: '<path d="M0,9.5C-3.5,5.5 -10,1.5 -10,-4C-10,-8.5 -6,-10.8 -3,-9.2C-1.5,-8.4 -0.5,-7.1 0,-5.8C0.5,-7.1 1.5,-8.4 3,-9.2C6,-10.8 10,-8.5 10,-4C10,1.5 3.5,5.5 0,9.5Z"/>',
  d: '<path d="M0,-10.5C2.5,-5 5.5,-2 8.5,0C5.5,2 2.5,5 0,10.5C-2.5,5 -5.5,2 -8.5,0C-5.5,-2 -2.5,-5 0,-10.5Z"/>',
  c: '<circle cx="0" cy="-5.5" r="4.6"/><circle cx="-5.8" cy="2.2" r="4.6"/><circle cx="5.8" cy="2.2" r="4.6"/>' +
     '<path d="M-2.2,3.4C-2.2,7 -3.4,9 -5,10.6L5,10.6C3.4,9 2.2,7 2.2,3.4Z"/>',
};

const pip = (suit, x, y, scale = 1, flip = false) =>
  `<g transform="translate(${x},${y}) scale(${scale})${flip ? ' rotate(180)' : ''}">${PIP[suit]}</g>`;

// Standard pip layouts. Columns 36/50/64, rows spread over y 32..108.
const L = 36, C = 50, R = 64, r1 = 32, r2 = 51, r3 = 70, r4 = 89, r5 = 108, rA = 41.5, rB = 98.5;
const LAYOUT = {
  '7': [[L, r1], [R, r1], [C, rA], [L, r3], [R, r3], [L, r5], [R, r5]],
  '8': [[L, r1], [R, r1], [C, rA], [L, r3], [R, r3], [C, rB], [L, r5], [R, r5]],
  '9': [[L, r1], [R, r1], [L, r2], [R, r2], [C, r3], [L, r4], [R, r4], [L, r5], [R, r5]],
  '10': [[L, r1], [R, r1], [C, rA], [L, r2], [R, r2], [L, r4], [R, r4], [C, rB], [L, r5], [R, r5]],
};

// Court cards: one half-figure, mirrored about the middle of the inner panel.
function courtHalf(rank, suit, col) {
  const crown = {
    K: '<path d="M-14,10L-14,2.5L-8.5,7L-4,-0.5L0,5L4,-0.5L8.5,7L14,2.5L14,10Z"/>',
    Q: '<path d="M-11,10L-11,3.5L-5.5,7.5L0,0.5L5.5,7.5L11,3.5L11,10Z"/>' +
       '<circle cx="-11" cy="2" r="2"/><circle cx="0" cy="-1" r="2"/><circle cx="11" cy="2" r="2"/>',
    J: '<path d="M-12,10C-12,3.5 12,3.5 12,10Z"/><path d="M10,6C15,2 17,-3 15,-7C13,-3 10,-1 8,-0.5Z"/>',
  }[rank];
  return `<g transform="translate(50,26)" fill="${col}">
    ${crown}
    <circle cx="0" cy="18" r="7.5" fill="#fff" stroke="${col}" stroke-width="1.6"/>
    <path d="M-18,44L-18,35C-18,29.5 -8,26 0,26C8,26 18,29.5 18,35L18,44Z" fill="#fff" stroke="${col}" stroke-width="1.6"/>
    <path d="M0,26L-6,44L6,44Z"/>
    <g transform="translate(0,36) scale(0.42)">${PIP[suit]}</g>
  </g>`;
}

function face(card) {
  const suit = suitOf(card), rank = card.slice(1), col = colorOf(suit);
  let body;
  if (rank === 'A') {
    body = `<g fill="${col}">${pip(suit, 50, 70, 2.1)}</g>`;
  } else if (LAYOUT[rank]) {
    body = `<g fill="${col}">${LAYOUT[rank].map(([x, y]) => pip(suit, x, y, 0.82, y > 70)).join('')}</g>`;
  } else {
    body = `<rect x="20" y="22" width="60" height="96" rx="4" fill="#fff" stroke="${col}" stroke-width="1.4"/>
      <rect x="20" y="22" width="60" height="96" rx="4" fill="${col}" opacity=".07"/>
      ${courtHalf(rank, suit, col)}
      <g transform="rotate(180 50 70)">${courtHalf(rank, suit, col)}</g>
      <line x1="20" y1="70" x2="80" y2="70" stroke="${col}" stroke-width="1" opacity=".45"/>`;
  }
  const corner = `<text x="0" y="0" font-size="21" font-weight="700" text-anchor="middle"
      font-family="system-ui,sans-serif" fill="${col}">${rankLabel(rank)}</text>
    <g transform="translate(0,15) scale(0.45)" fill="${col}">${PIP[suit]}</g>`;
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="98" height="138" rx="9" fill="#fffdf8" stroke="#00000026"/>
    ${body}
    <g transform="translate(13,22)">${corner}</g>
    <g transform="rotate(180 50 70) translate(13,22)">${corner}</g>
  </svg>`;
}

const faces = new Map();                       // keyed by language: rank letters differ
export function cardSVG(card) {
  const key = getLang() + card;
  if (!faces.has(key)) faces.set(key, face(card));
  return faces.get(key);
}

export const backSVG = () => `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
  <clipPath id="pfback"><rect x="1" y="1" width="98" height="138" rx="9"/></clipPath>
  <rect x="1" y="1" width="98" height="138" rx="9" fill="#7d1f28" stroke="#00000033"/>
  <g stroke="#ffffff2e" stroke-width="2" clip-path="url(#pfback)">
    ${Array.from({ length: 17 }, (_, i) => `<path d="M${-60 + i * 14},142L${80 + i * 14},2"/>`).join('')}
    ${Array.from({ length: 17 }, (_, i) => `<path d="M${-60 + i * 14},-2L${80 + i * 14},138"/>`).join('')}
  </g>
  <rect x="7" y="7" width="86" height="126" rx="6" fill="none" stroke="#e8c46a" stroke-width="1.6"/>
</svg>`;
