import { start } from './engine.js';
import * as game from './game.js';

if (location.search.includes("debug")) window.__game = game;

start(document.getElementById('game'), game);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
