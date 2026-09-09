// The bots' search, off the page's thread. A first trick is a full double-dummy
// solve of the deal and takes about a second, which is a second the browser
// spends painting nothing — so the local game asks for the move here and the
// table stays alive while the answer is worked out.
//
// Nothing but a seat view goes in and an action comes out: the worker holds no
// game of its own, so there is no state to keep in step.
import { botAction } from './bots.js';

self.onmessage = (e) => {
  const { id, view } = e.data;
  try {
    self.postMessage({ id, action: botAction(view) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
