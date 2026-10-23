// Screenshots of the prepared arsenal in the real pipeline (full render, HUD, robots), portrait and landscape:
//   node scripts/harness/arsenal-views.mjs <outdir> [scene,scene,...]      Q=low|medium|high (default medium)
// Scenes: vm (the three viewmodels), ref (the pistol, SMG and launcher for comparison), strip (eight weapons on the HUD), beam (firing at a robot), torch (level 2, torch on),
// pickups (weapons, upgrades, records on the floor), grenade (in flight), wave (the bass-drop ring and the airhorn cone),
// stun (a stunned robot), alt (mobile ALT button and upgrade chips), setlist (the title with its button, the setlist).
// Needs the ?test hook (the page exposes window.__game only with it). Uses testHook('give'), ('pickup') and ('arsenal').
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const out = process.argv[2];
const want = (process.argv[3] || 'vm,strip,beam,torch,pickups,grenade,wave,stun,alt,setlist').split(',');
const PORT = Number(process.env.PORT || 8300 + Math.floor(Math.random() * 500));
const server = spawn('node', ['scripts/serve.mjs', String(PORT)], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
const WAIT = Number(process.env.WAIT || 1600);

// the open lane on the Cowgate's dance floor: Naebun at x = 20, z = 65, facing east
const LANE = { x: 20, z: 65, yaw: -Math.PI / 2 };

for (const [tag, W, H] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
  page.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(`${tag}: ${m.text()}`));
  await page.goto(`http://localhost:${PORT}/?test&q=${process.env.Q || 'medium'}&mobile`);
  await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 120000 });

  // a clean level with no robots about, Naebun in the lane, everything in his pockets
  const reset = async (level = 1, weapon = 'pistol') => {
    await page.evaluate(async ([level, weapon, LANE]) => {
      const g = window.__game;
      g.testHook('level', level);
      g.testHook('torch', { attached: true, on: false });
      const S = g.getState();
      const spot = level === 1 ? LANE : { x: 28, z: 10, yaw: -Math.PI / 2 };
      for (const e of S.enemies) { e.dead = true; e.state = 'dead'; e.robot.group.visible = false; }
      for (const pk of S.pickups) { pk.taken = true; pk.mesh.visible = false; }
      g.testHook('teleport', spot);
      S.player.health = S.player.maxHealth = 1e6;
      S.player.pitch = 0;
      g.testHook('give', 'all');
      S.player.weapon = weapon;
      S.player.switchT = 0;
      S.banner = null;
      S.toast = null;
    }, [level, weapon, LANE]);
  };
  const shot = async (name, wait = WAIT) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${tag}-${name}.png` });
    console.log('shot', tag, name);
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  if (want.includes('vm')) {
    for (const id of ['beam', 'grenade', 'airhorn']) {
      await reset(1, id);
      await shot(`vm-${id}`);
    }
  }

  if (want.includes('ref')) { // the existing guns in the same light, to judge the new ones against
    for (const id of ['pistol', 'smg', 'launcher']) {
      await reset(1, id);
      await shot(`ref-${id}`);
    }
  }

  if (want.includes('strip')) {
    await reset(1, 'beam');
    await ev(() => { window.__game.getState().player.ammo.beam = 63; });
    await shot('strip-eight');
  }

  if (want.includes('beam')) {
    await reset(1, 'beam');
    await ev(async ([LANE]) => {
      const g = window.__game;
      const S = g.getState();
      const e = S.enemies.find((q) => q.kind === 'fizzbang');
      e.dead = false; e.state = 'idle'; e.hp = e.maxHp = 1e6; e.x = LANE.x + 6; e.z = LANE.z; e.speedMult = 0; e.cool = 1e6; e.robot.group.visible = true;
      const f = S.enemies.find((q) => q.kind === 'fizzbang' && q !== e);
      f.dead = false; f.state = 'idle'; f.hp = f.maxHp = 1e6; f.x = LANE.x + 9; f.z = LANE.z + 1.4; f.speedMult = 0; f.cool = 1e6; f.robot.group.visible = true;
    }, [LANE]);
    await page.keyboard.down(' ');
    await ev(() => { window.__game.getState().player.ammo.beam = 100; });
    await page.waitForFunction(() => window.__game.getState().player.beam.ramp > 0.35, null, { timeout: 60000 });
    await ev(() => { window.__game.getState().player.ammo.beam = 90; });
    await shot('beam-on', 100);
    await page.waitForFunction(() => window.__game.getState().player.beam.ramp > 1.6, null, { timeout: 60000 });
    await ev(() => { window.__game.getState().player.ammo.beam = 60; });
    await shot('beam-ramped', 100);
    await page.keyboard.up(' ');
  }

  if (want.includes('torch')) {
    await reset(2, 'beam');
    await ev(() => { window.__game.testHook('torch', { attached: true, on: true }); });
    await shot('torch-beam-gun', 2200);
    await ev(() => { window.__game.getState().player.weapon = 'airhorn'; });
    await shot('torch-airhorn', 1500);
  }

  if (want.includes('pickups')) {
    // three rows in front of Naebun: the weapons, then the upgrades, then the four records
    const lay = async (items, forward, spread) => {
      await ev(async ([items, forward, spread, LANE]) => {
        const g = window.__game;
        const S = g.getState();
        const ARS = g.testHook('arsenal');
        for (const pk of S.pickups) { pk.taken = true; pk.mesh.visible = false; }
        S.pickups.length = 0;
        items.forEach((def, i) => {
          const lat = (i - (items.length - 1) / 2) * spread;
          // east is forward; the right of Naebun is +z (he faces east, so right = south)
          ARS.spawnPickup({ ...def, x: LANE.x + forward, z: LANE.z + lat });
        });
        S.player.health = 1e6;
      }, [items, forward, spread, LANE]);
    };
    await reset(1, 'pistol');
    await lay([{ kind: 'weapon', item: 'beam' }, { kind: 'weapon', item: 'grenade' }, { kind: 'weapon', item: 'airhorn' }], 4.2, 1.15);
    await ev(() => { const S = window.__game.getState(); S.player.x -= 0; for (const pk of S.pickups) pk.def.z += 0; });
    await ev(() => { window.__game.getState().player.weapon = 'pistol'; });
    // the pickups would be collected at 1.2 m; they are 4 m away, so they stay
    await shot('pickups-weapons');
    await lay([{ kind: 'upgrade', item: 'clip' }, { kind: 'upgrade', item: 'reload' }, { kind: 'upgrade', item: 'altfire' }], 4.0, 1.1);
    await shot('pickups-upgrades');
    await lay([0, 1, 2, 3].map((i) => ({ kind: 'record', item: ['haar', 'bypass', 'gala', 'pipes'][i] })), 4.4, 1.0);
    await shot('pickups-records');
  }

  if (want.includes('grenade')) {
    await reset(1, 'grenade');
    await ev(async ([LANE]) => {
      const g = window.__game;
      const S = g.getState();
      const ARS = g.testHook('arsenal');
      const { WEAPONS } = await import('/src/data.js');
      ARS.fire(WEAPONS.grenade);
      const pr = S.projectiles.find((q) => q.grenade);
      pr.weapon = { ...pr.weapon, gravity: 0 };
      pr.vx = pr.vy = pr.vz = 0;
      pr.fuse = 1e9;
      pr.x = LANE.x + 2.2; pr.y = 1.25; pr.z = LANE.z + 0.35;
      S.player.ammo.grenade = 3;
      S.player.fireT = 0;
    }, [LANE]);
    await shot('grenade-flight');
    // the throw itself: the viewmodel swinging forward just after the trigger
    await ev(async () => {
      const g = window.__game;
      const S = g.getState();
      for (const pr of S.projectiles) pr.life = -1;
    });
  }

  if (want.includes('wave')) {
    await reset(1, 'pistol');
    await ev(async ([LANE]) => {
      const g = window.__game;
      const S = g.getState();
      const ARS = g.testHook('arsenal');
      for (const pr of S.projectiles) pr.life = -1;
      ARS.freezeWave('ring', LANE.x + 7, LANE.z, 0, 7, 0.62, 0.3);
    }, [LANE]);
    await shot('wave-ring');
    await reset(1, 'airhorn');
    await ev(async ([LANE]) => {
      const g = window.__game;
      const S = g.getState();
      const ARS = g.testHook('arsenal');
      const e = S.enemies.find((q) => q.kind === 'fizzbang');
      e.dead = false; e.state = 'idle'; e.hp = e.maxHp = 1e6; e.x = LANE.x + 4.2; e.z = LANE.z; e.speedMult = 0; e.cool = 1e6; e.robot.group.visible = true;
      ARS.freezeWave('cone', LANE.x, LANE.z, LANE.yaw, 7, 0.62, 0.45);
      ARS.stun(e, 1e6);
    }, [LANE]);
    await shot('wave-cone');
  }

  if (want.includes('stun')) {
    await reset(1, 'pistol');
    await ev(async ([LANE]) => {
      const g = window.__game;
      const S = g.getState();
      const ARS = g.testHook('arsenal');
      const spots = [[LANE.x + 4.2, LANE.z + 0.2], [LANE.x + 6.5, LANE.z - 1.6]];
      S.enemies.filter((q) => q.kind === 'fizzbang').slice(0, 2).forEach((e, i) => {
        e.dead = false; e.state = 'chase'; e.hp = e.maxHp = 1e6; [e.x, e.z] = spots[i]; e.yaw = Math.PI / 2; e.speedMult = 0; e.cool = 1e6; e.robot.group.visible = true;
        ARS.stun(e, 1e6);
      });
    }, [LANE]);
    await shot('stun');
  }

  if (want.includes('alt')) {
    await reset(1, 'smg');
    await ev(() => { window.__game.testHook('give', ['clip', 'reload', 'altfire', 'clip']); });
    await ev(() => { const S = window.__game.getState(); S.toast = null; S.banner = null; });
    await shot('hud-alt-ready');
    await ev(() => { window.__game.getState().player.alt.cd = 1.6; });
    await shot('hud-alt-cooldown', 300);
    await ev(() => { window.__game.testHook('setting', { input: 'pc' }); });
    await shot('hud-alt-pc');
    await ev(() => { window.__game.testHook('setting', { input: 'mobile' }); });
    await reset(1, 'beam');
    await ev(() => { window.__game.testHook('give', ['clip']); });
    await shot('hud-beam-meter');
  }

  if (want.includes('setlist')) {
    await ev(() => { window.__game.testHook('give', ['haar', 'gala', 'hold', 'foot']); window.__game.testHook('screen', 'title'); });
    await shot('title-setlist', 2500);
    await ev(() => window.__game.testHook('screen', 'setlist'));
    await shot('setlist-4', 1000);
    await ev(() => { window.__game.testHook('give', ['bypass', 'pipes', 'wee', 'supper', 'tram', 'refund']); });
    await shot('setlist-10', 700);
    await ev(() => { window.__game.testHook('save', { records: [] }); });
    await shot('setlist-0', 700);
  }
  await page.close();
}
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
server.kill();
