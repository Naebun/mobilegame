import { start } from './engine.js';
import * as game from './game.js';

start(document.getElementById('game'), game);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
