# Preferans

**English** · [Українська](README.uk.md)

A web game of three-handed Preferans, for people or for bots. Open a table,
hand out the code and play it with friends — the same engine runs on the server,
and whatever seats are still free when you start are filled by bots. On your own,
that is all three seats but yours.

**Play it: [preferans-iwrx.onrender.com](https://preferans-iwrx.onrender.com/)**
— the current version of this repo, deployed on every push to `main`. It runs on
Render's free plan, so the first request after a quiet spell wakes the instance
and takes a few seconds.

## Running

```bash
node server.mjs        # http://localhost:8080
```

## Playing with people

The dialog that opens a game asks one thing first: **against bots**, **create a
table**, or **join** one with a code. The first two then show the house rules —
pool target, who carries a whist shortfall, Stalingrad — and the third shows
only the code field, because at somebody else's table the rules are theirs. Both
online modes take a name, which is what the rest of the table sees on your seat
instead of "Player 2"; the browser remembers it. A seat handed back to a bot
goes back to its plain label.

Creating opens a game on the server with your rules and gives you a
five-character code — the address bar
becomes `?room=CODE`, and the header carries a chip that copies the link when
clicked. Anyone with the code joins from their own dialog, or just by opening
the link.

Nothing is dealt out until you say so: the table waits while your friends read
the code and sit down, they see who else is seated, and you press **Start the
game** when the company is complete. Whatever seats are still free then are
played by the same bots, and every seat says whether a person or a bot holds it.
Starting the table over from the menu is the host's call too: the dialog opens
on that table — the rules, a note that the running game will be lost, and **Deal
again** — so the company keeps its seats and can change the rules while they are
at it. Picking one of the three modes instead leaves the table. A seat is yours for as long as you
hold its token: your browser keeps it, so a reload drops you back into the same
hand. Lose the connection and the seat waits a minute for you before a bot takes
over — come back later and you get it back if nobody else has sat down.

The token is also the only thing that opens a seat's stream, so knowing the room
code lets you join the table, never read somebody else's cards.

### Hosting

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/eschava/preferans)

The repo carries a `render.yaml`, so the button above sets the service up on
[Render](https://render.com) in one click: it builds with `npm install` and
starts with `npm start`, and the server takes its port from `PORT`. There is
nothing else to configure — the project has no runtime dependencies and no
database.

The instance above is set up exactly this way. On Render's free plan it sleeps
after a spell of inactivity and is restarted on the next request. Rooms live in the server's memory, so an online
table does not survive that; a game against bots runs entirely in the browser
and is unaffected.

Checking the rules and the bots:

```bash
npm test        # rules, bots, and the online table
```

## Structure

| File | What it does |
|---|---|
| `src/engine.js` | rules and the deal state machine. No DOM, no network — the same module runs in the browser and in Node |
| `src/bots.js` | bot decisions: bidding, discard, whist. They only ever see `viewFor(seat)` |
| `src/solver.js` | card play: exact double-dummy search + Monte Carlo over the unseen cards |
| `src/transport.js` | the seam between UI and rules: `LocalTable` (in-browser) and `RemoteTable` (SSE to the server) |
| `src/worker.js` | the bots' search, off the page's thread, so a long think does not freeze the table |
| `src/ui.js` | rendering. Knows only `send(action)` and `onState(view)` |
| `src/i18n.js` | every piece of text, in both languages |
| `src/format.js` | turns engine data into text for the current language: contracts, cards, log lines |
| `src/cards.js` | the deck in SVG: suits are drawn as paths, not font glyphs |
| `src/scoresheet.js` | the score sheet in SVG: pool, mountain, whists by pair, deal history |
| `server.mjs` | static files + one authoritative engine per room, state pushed over SSE. Zero dependencies |
| `scripts/calibrate*.mjs` | fit the bots' trick estimates against real play |

Online and local play differ by one line in `ui.js`: which transport class to
create. The UI is the same.

## Interface

Game decisions — bidding, declaring after the talon, whisting, confirmations —
are non-modal popups centred on the table: nothing is blurred and the cards in
your hand stay visible. The bar at the bottom keeps only hints and the buttons
that open those popups. Each player's bid is shown in their own zone.

The bids are laid out as a ladder, the way they are written on paper: levels
down the side, suits across, and misère on its own rung between 8NT and 9♠ —
exactly where it outranks them. Nothing scrolls and nothing rearranges itself
between rounds: a bid is always in the same place and simply greys out when it
can no longer be named. The cheapest one still available is ringed, a repeat is
marked ↺, and misère asks for confirmation, as starting a new game mid-match
does.

The end of a deal is not thrown open at once: the last trick lies there for two
and a half seconds, then the hands go face up, and two seconds after that the
score sheet arrives. The sheet is hidden by default and a menu item opens it. The drawing is the classic one — a vertical from the top down to the
box holding the pool target, two rays from the box down to the base of a
trapezoid giving three sectors; narrow columns hug the side sectors, and beyond
them lie the whist zones, two per player. The wide sector records the
**mountain**, the narrow column the **pool**; the bottom seat keeps both in its
sector, split by a rule. Inside there are only numbers: black for pool and
whists, red for the mountain, and bold for whatever the deal just played added.
The whist zones say in small print who writes on whom ("West → You").

Everywhere — pool, mountain and whists — entries are written from the edge of
their cell, the way a hand writes on paper, not centred: top to bottom in the
narrow zones, left to right in the wide ones. Every cell reads from the seat it
belongs to. Entries are separated by dots: `4·6·12·22·36`. A run that fills its
line does not spill over the drawing: whists carry on the next line down, the
mountain on the line **above** — it grows upward, each line stepping in along
the slanting side of the sector, so a long game builds a pyramid. When even that
is not enough the hand writes smaller. A pool that is closed gets a `>>` after
its last number.

Approximate points are not written into the drawing — they sit in a separate
table above the sheet, in the same order as the seats (left opponent, you,
right); the change from the last deal stands next to each, green or red. Under
the sheet is the summary of that one deal.

A deal that is over can be played again: **Replay** on the score sheet deals the
same cards to the same seats, with the same hand dealing, and lets the whole
thing be played differently — a trial run, on a sheet nobody keeps. It says so
in three places: the button asks first, in as many words; a note stands in the
header where the deal number was; and a way back sits on the action bar. The real game waits behind it
untouched, an online one still streaming, and comes back score and all; the
sheet on screen stays the real one throughout, because that is the thing the
trial run is promising not to change.

When the last few tricks are decided, the bot says so instead of playing them:
a popup names the split — "You 1 · West 2 · East 0" — and it is written down
unplayed if everybody agrees. Claiming costs something, as it does at a real
table: the hand goes face up and stays there, so a refusal is played out
against open cards, and nobody asks twice in a deal. It is only offered with
four or three cards left — two are quicker played than discussed — and never in
an all-pass deal, where every trick is somebody's loss and the cards are cheap. What is claimed is not a good line or a likely
one: **every** layout the unseen cards could be in is tried, and in each of them
every legal line has to end in the same numbers, or there is no claim. That is
strictly more than the search does for its own play — a value under best play
says nothing about a defender who throws a trick away — and it is why the claim
only starts once four cards are left, where the layouts can all be counted. It
costs under a millisecond in the ordinary case.

In an all-pass deal the talon stays on the table: the face-up card is shown
large, next to an ALL PASS badge and a hint of which suit must be led.

On a phone the table keeps its size for the whole deal: the room for your own
cards is reserved for all ten, a face-up hand keeps its four suit rows, and the
"took the trick" line holds its place while empty. Otherwise every card played
pulls the status bar up the screen.

On a desktop the table takes the whole window, and the size of the cards, the
side panels and the log column scale with its width (CSS `clamp` on `vw`), so a
big screen gets big cards while a phone keeps what it had.

Opponents sit in narrow panels at the sides, and the cards of a trick fall in a
triangle by seat — yours at the bottom, theirs left and right. When someone
plays with their hand face up, their column widens and the cards are laid out
by suit, one suit per row (a long suit is squeezed into an overlap); if you are
playing for two, the legal cards in their hand are highlighted.

At the end of a deal the table is revealed: every hand as it was dealt, and in
the centre the talon and the declarer's discard.

## Languages

The interface is available in English and Ukrainian, English by default.
Everything that is not the table itself — score sheet, new game, the language
flags — lives in a single dropdown menu in the header, and the flags appear in
the new-game dialog too, since that one is modal and covers the menu. The choice
is remembered in `localStorage`.

There is not one line of display text in the code: the engine writes `{k, p}`
structures to the log and throws errors as codes, and `format.js` turns those
into text through the dictionary in `i18n.js`. That is why the language switches
on the fly — together with the rank letters on the cards (A/K/Q/J against
Т/К/Д/В) and the log already played.

## Game settings

A dialog opens before the first deal and again on every new game: how far the
pool runs (10, 20 or 50), who carries a whist shortfall (every whister, or only
the one who did not take his half of the duty), and whether **Stalingrad** is on
— on a six of spades, the cheapest game there is, the defence may not wave the
deal through and both must whist. The choice is remembered in `localStorage`, so the dialog opens on
what was last played. An online room takes its settings from the server, so
joining one skips the dialog.

## Rules implemented

- 32-card deck, 10 cards each, 2 to the talon.
- Bidding 6♠…10NT; when everybody passes the deal is played all-pass.
- **All-pass** is played with the talon face up: the first talon card is turned
  before the first trick and the second before the second, and its suit dictates
  the lead (its rank does not count — the trick goes to the highest card of that
  suit). Anyone void discards freely. From the third trick the suit is free and
  the spent talon cards are cleared away. The **first three tricks are all led
  by the hand left of the dealer**, whoever takes them; only from the fourth
  does the taker lead.
- **Misère** sits between 8NT and 9♠ — only a bid of nine beats it. It is a
  binding bid: misère may only be a player's **own first** call, and having won
  the auction with it there is no way out — after the talon all that is left is
  the discard.
- **Repeat across a passer**: instead of raising you may name the standing bid
  itself, if everyone between its owner and you has passed and you are senior to
  them (the hand left of the dealer is senior, the dealer junior). The repeat
  hands the bid to the senior, and the junior can only raise or pass — which is
  why the bidding always ends. Nobody can repeat the first hand's bid.
- The talon is turned up for everyone; the declarer discards 2 cards and names
  the contract (no lower than the winning bid).
- Whist or pass in two rounds; on misère there is no whisting. With
  **Stalingrad** on there is no passing a six of spades either.
- Play: following suit is **compulsory**, and if void you **must trump**. Nobody
  is obliged to beat: you may duck under a higher card, and you are not forced
  to overtrump either.
- The game runs until **all three** close their pool, not the first one to do so.
- **The whisters' duty**: between them they owe 4 tricks on a six, 2 on a seven,
  1 on an eight or a nine — the count is for the pair, not for each. Every
  missing trick is written into the mountain at the contract's **full** value;
  that price is never halved or split. Who writes it is a setting: every whister,
  or only a whister who did not take his half of the duty. A lone whister carries
  it either way.
- **The first lead** always belongs to the **eldest hand** — the seat left of the
  dealer — whoever declared. So the declarer leads when the deal was theirs to
  open, and on a misère of their own they lead **blind**: the defence lays its
  cards down the moment that first card is on the table, not before.
- **Open play**: on misère the whisters lay their cards on the table. On a normal
  contract, when one whists and the other passes, this is *whist in the light*:
  **both** defence hands go face up and the whister plays them both (switched off
  with the `openOnHalfWhist` option). So the declarer sees the whole defence, and
  the defence sees itself. There is no "in the dark" variant.
- Scoring (Sochi): a game of 6…10 is worth 2…10 into the pool, a shortfall the
  same per trick into the mountain; misère is 10, and every trick taken on
  misère is 10 into the mountain; an all-pass deal is 2 into the mountain per
  trick.
- **The pool does not overflow**: a win first fills the winner's own pool up to
  the target. The surplus goes to **help** — it closes the other players' pools,
  every point written as 10 whists against the player helped — and only what
  nobody can take writes off the winner's own mountain.
- Settlement: `whists − 10×mountain`, normalised by the mean — the three scores
  always add up to 0, so it is clear who owes whom. Values can be fractional.
  The pool is deliberately absent: the game does not end until all three close
  it, so at the finish it is the same for everyone, and counting it would only
  flatter whoever leads a race that has to end level — mid-game it would show a
  player with the biggest mountain level with the field. What a closed pool is
  worth is already paid in whists, through the help it gives the others.

## Bots

Card play is not a heuristic but a search — **Perfect-Information Monte Carlo**,
the approach strong bridge and skat engines use. The bot cannot see the other
hands, so it samples them: it deals the unseen cards into the hidden hands at
random but consistent with what is known, solves that complete deal **exactly**
(alpha-beta to the end, double dummy) and averages the result of every candidate
card over the samples.

The search has the usual machinery: a transposition table with bounds, zero
windows (MTD(f)), move ordering, and equivalence reduction (cards separated only
by already-played ones are interchangeable). The goal differs by contract: the
declarer maximises their own tricks, the defence its own, on misère the defence
maximises the declarer's tricks, and in an all-pass deal each player minimises
their own against the other two.

Only deals that could have happened are sampled: a seat that failed to follow a
suit is never dealt that suit back, and if it did not trump either, the trump
goes too. Reading a table it cannot see is all a bot has, and guessing at deals
the play has already ruled out is worse than not guessing — it is what let a
defence lead a suit the declarer had shown void in, handing over a free discard.

The number of samples tunes itself to a time budget: one sample costs the better
part of a second on the first trick and about 2 ms on the fourth, so by the end
of a deal the bot fits in 20+ samples and plays essentially perfectly. In the
local game that search runs in a Web Worker, so the first trick no longer freezes
the page while it thinks; online the server does the thinking anyway.

The search is cross-checked against an independent brute-force minimax
(`test/solver.test.mjs`): 240 positions agree on the value and 54 on the card
chosen, from all three positions in a trick. Head to head against the previous
heuristic it wins 33 matches out of 48 over four seeds, about +70 points a match.

The contract is not guessed either: at the talon the bot counts what the hand
takes with the **same double-dummy search**, over sampled opponent hands, and
declares that. One linear fit over every hand shape flattens the ends of the
range, and that is how a hand that went on to take nine came to be declared at
seven. The auction itself is still that heuristic, fitted against real play
(`scripts/calibrate.mjs`, and `scripts/calibrate-dd.mjs` checks the count against
played deals); re-run them after changing the card play, because stronger play
shifts the fit and a stale one makes the bots over- or underbid.
The whist decision weighs the duty: can the pair carry its tricks, and will you
have to carry them alone if the partner passes. Measured honestly, that is not
stronger than always whisting — the difference sits within the noise over 600
matches a seed — because under this scoring whisting is rarely a loss. It does
make play more varied: light whists actually happen.

## Deliberate simplifications

- There is no **half-whist** — whist or pass only.
- When both defenders pass, the contract is scored unplayed.
- Whists are recorded to each whister for **their own** tricks; a defender who
  passed plays but records nothing.
- The server has no authentication — a seat goes to whoever joins the room
  first. Fine for playing with friends on a local network, not for public
  hosting.
