import { start } from './engine.js';
import * as game from './game3d.js';

if (location.search.includes("test")) window.__game = game;

start(document.getElementById('game'), game);

// __ARTIFACT__ is defined by scripts/build-artifact.mjs: hosted pages cannot run service workers
if ('serviceWorker' in navigator && typeof __ARTIFACT__ === 'undefined') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
