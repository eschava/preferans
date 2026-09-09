// Turns engine data into text for the current language. The engine itself
// stores only structures: contract objects, card ids, seat indices, {k, p} log
// entries — everything readable is produced here.
import { SUIT_SYM } from './engine.js';
import { t } from './i18n.js';

export const suitSym = (s) => (s === 'nt' ? t('suit.nt') : SUIT_SYM[s]);
export const rankLabel = (r) => t('rank.' + r);
export const cardLabel = (c) => rankLabel(c.slice(1)) + suitSym(c[0]);

export function contractName(c) {
  if (!c) return t('contract.none');
  if (c.raspas) return t('contract.raspas');
  if (c.misere) return t('contract.misere');
  return c.level + ' ' + suitSym(c.suit);
}

// Seat labels are keys for the built-in seats and plain names for real players.
export const playerName = (view, seat) => {
  const label = view.players[seat];
  return label.startsWith('player.') ? t(label) : label;
};

// {k, p} -> text: seat indices, contracts and cards are resolved on the way.
export function entryText(view, e) {
  const p = { ...e.p };
  if (p.player !== undefined) p.player = playerName(view, p.player);
  if (p.to !== undefined) p.to = playerName(view, p.to);
  if (p.contract !== undefined) p.contract = contractName(p.contract);
  if (p.cards !== undefined) p.cards = p.cards.map(cardLabel).join(' ');
  if (p.card) p.card = cardLabel(p.card);          // only a forced trick carries one
  if (p.suit !== undefined) p.suit = suitSym(p.suit);
  return t(e.k, p);
}
