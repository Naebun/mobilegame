// The rules of the prepared arsenal (docs/arsenal.md): the Feedback Beam, the Bass-Drop Grenade and the Airhorn, stun, the
// SMG's alt-fire, the upgrades and the collectible records. Built and tested ahead of the levels that will use them; levels 1
// and 2 now place it (docs/placement.md).
//
// This lives apart from game3d.js on purpose: the game hands in the few things it owns (the state S, the world, ray casting,
// damage) as a host object and calls the hooks below from `fire`, `updateWeapon`, `updateProjectiles`, `updatePickups`,
// `updateEnemy` and the render loop. Everything numeric is in data.js (WEAPONS.beam, .grenade, .airhorn, ALT_FIRE,
// UPGRADES, RECORDS). With no renderer (the headless tests) every visual is skipped and the rules run unchanged.
import * as THREE from '../vendor/three.module.min.js';
import { EYE, WALL_H } from './consts.js';
import { WEAPONS, ALT_FIRE, UPGRADES, RECORDS } from './data.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const NONE = { clip: 0, reload: 0, altfire: 0 };
const GRENADE_R = 0.09; // how big the grenade is to a wall
const WAVE_LIFE = { ring: 0.7, cone: 0.45 };

export function createArsenalPlay(host) {
  const { S, M, audio, getWorld, getR, castRay, damageEnemy, alertNear, forward3, spark, fxHit, toast, mult, bounceOff, store } = host;
  let fx = null; // render-side objects, made on first use: { beam, waves: { ring: [], cone: [] }, stuns: [], live: [] }

  const upg = () => (S.player && S.player.upgrades) || NONE;
  const busy = () => !!(S.drink || S.laser || S.attach);

  // ---- upgrades: bigger clips and faster reloads for every weapon ----

  const tierValue = (id, tier, none) => (tier > 0 ? UPGRADES[id].tiers[Math.min(tier, UPGRADES[id].tiers.length) - 1] : none);

  // A weapon's clip with the clip upgrade applied (the Feedback Beam's charge meter, in units, scales the same way).
  function clipOf(w) {
    const k = tierValue('clip', upg().clip, 1);
    return k > 1 ? Math.max(w.clip + 1, Math.round(w.clip * k)) : w.clip;
  }

  // What every reload time is multiplied by (1 with no upgrade).
  const reloadMult = () => tierValue('reload', upg().reload, 1);

  function takeUpgrade(id) {
    const p = S.player;
    const u = UPGRADES[id];
    if (!u) return false;
    const tier = p.upgrades[id] || 0;
    if (tier >= u.tiers.length) {
      if (!S.toast) toast(`${u.name}: ALREADY FITTED`);
      return false; // the pickup stays where it is
    }
    const before = {};
    for (const wid of Object.keys(p.owned)) if (p.owned[wid]) before[wid] = clipOf(WEAPONS[wid]);
    p.upgrades[id] = tier + 1;
    if (id === 'clip') for (const wid of Object.keys(before)) p.ammo[wid] += clipOf(WEAPONS[wid]) - before[wid]; // the bigger clip arrives full of the difference
    const v = u.tiers[tier];
    if (id === 'clip') toast(`${u.name}: +${Math.round((v - 1) * 100)}% ROUNDS`);
    else if (id === 'reload') toast(`${u.name}: RELOADS ${Math.round((1 - v) * 100)}% QUICKER`);
    else toast(`${u.name}: ${host.inputMode() === 'mobile' ? 'TAP ALT ON THE SMG' : 'E OR RIGHT CLICK ON THE SMG'}`);
    audio.upgrade();
    return true;
  }

  // ---- collectible records ----

  // Walking over a record finds it. The first time (and not in a debug run) it is saved; either way the joke plays.
  function takeRecord(id) {
    const r = RECORDS.find((q) => q.id === id);
    if (!r) return false;
    const had = S.save.records.includes(id);
    if (!S.runRecords.includes(id)) S.runRecords.push(id);
    if (!had && !S.debugMode) {
      const set = new Set([...S.save.records, id]);
      S.save.records = RECORDS.map((q) => q.id).filter((x) => set.has(x));
      store.save(S.save);
    }
    const n = S.save.records.length;
    toast(S.debugMode && !had ? 'RECORD FOUND (DEBUG: NOT SAVED)' : had ? 'ALREADY ON YOUR SETLIST' : `RECORD FOUND: ${n} OF ${RECORDS.length}`);
    S.banner = { title: r.title, sub: `"${r.line}"`, t: 4, max: 4 };
    audio.recordFound();
    return true;
  }

  // ---- stun ----

  function stun(e, seconds) {
    if (e.dead || !(seconds > 0)) return;
    e.stunT = Math.max(e.stunT || 0, seconds);
    e.stunMax = Math.max(e.stunMax || 0, e.stunT);
  }

  // Called by updateEnemy after the dead check. A stunned robot does nothing: it cannot walk, swing or shoot, only slide
  // where it was shoved, held in a dazed lean. An attack it was in the middle of is cancelled. Returns true while held.
  function stunStep(e, dt) {
    if (!(e.stunT > 0)) return false;
    e.stunT -= dt;
    if (e.stunT <= 0) {
      e.stunT = 0;
      e.stunMax = 0;
    }
    if (e.state === 'windup' || e.state === 'swing' || e.state === 'aim' || e.state === 'shoot' || e.state === 'slam') {
      e.state = 'chase';
      e.stateT = 0;
      e.acted = false;
      e.cool = Math.max(e.cool, 0.6);
    }
    if (Math.abs(e.kx) + Math.abs(e.kz) > 0.05) {
      const mv = getWorld().moveCircle(e.x, e.z, e.kx * dt, e.kz * dt, e.r);
      e.x = mv.x;
      e.z = mv.z;
      const decay = Math.exp(-dt * 7);
      e.kx *= decay;
      e.kz *= decay;
    }
    e.robot.setPose('hurt', 0.2 + 0.06 * Math.sin(S.t * 8 + e.animT), 0.55);
    return true;
  }

  const stunFor = (e, w) => (e.boss ? w.stun * w.bossStun : w.stun);

  // ---- the player's state ----

  function reset() {
    const p = S.player;
    p.upgrades = { clip: 0, reload: 0, altfire: 0 };
    p.alt = { cd: 0, left: 0, gap: 0 };
    p.beam = { on: false, target: null, ramp: 0, miss: 0, idle: 0, tick: 0, ticks: 0, len: 0, hit: null };
    S.runRecords = [];
    if (fx) {
      for (const w of fx.live) { w.obj.group.visible = false; w.obj.group.parent && w.obj.group.parent.remove(w.obj.group); }
      fx.live.length = 0;
      fx.waves.ring.concat(fx.waves.cone).forEach((o) => { o.busy = false; });
      fx.beam.group.visible = false;
    }
    audio.beamHum(false);
  }

  // ---- firing: the grenade and the airhorn ----

  const handles = (w) => w.kind === 'grenade' || w.kind === 'cone';

  // Called at the top of fire() for the weapons that are not hitscan or a rocket: it does what fire() does for the rest
  // (spend a round, set the next shot, kick, noise) and then the weapon's own thing.
  function fire(w) {
    const p = S.player;
    const m = mult();
    p.ammo[p.weapon]--;
    p.fireT = w.interval / host.fireRate();
    p.kick = Math.min(1, p.kick + w.kick * 8);
    S.shots++;
    alertNear(p.x, p.z, w.noise);
    if (w.kind === 'grenade') throwGrenade(w);
    else blast(w, m);
  }

  function throwGrenade(w) {
    const p = S.player;
    const world = getWorld();
    const R = getR();
    const f = forward3(p.yaw, p.pitch);
    let sx = p.x + f.x * 0.55 + Math.cos(p.yaw) * 0.22;
    const sy = EYE - 0.32 + f.y * 0.5;
    let sz = p.z + f.z * 0.55 - Math.sin(p.yaw) * 0.22;
    if (world.raycast(p.x, p.z, sx - p.x, sz - p.z, Math.hypot(sx - p.x, sz - p.z) + 0.1) < Math.hypot(sx - p.x, sz - p.z) + 0.05) { // against a wall: throw from Naebun's feet
      sx = p.x;
      sz = p.z;
    }
    const mesh = M.makeProjectile('grenade');
    mesh.position.set(sx, sy, sz);
    if (R) R.scene.add(mesh);
    S.projectiles.push({
      owner: 'player', grenade: true, weapon: w, mesh, x: sx, y: sy, z: sz,
      vx: f.x * w.speed, vy: f.y * w.speed + w.lift, vz: f.z * w.speed,
      life: 1e9, fuse: w.fuse, fuseMax: w.fuse, rest: false, tumble: 0,
    });
    audio.grenadeThrow();
  }

  // One frame of a grenade in flight: gravity, bounces off walls, floor, ceiling and robots, and the fuse.
  function stepGrenade(pr, dt) {
    const w = pr.weapon;
    pr.fuse -= dt;
    if (pr.fuse <= 0) {
      pr.life = -1;
      bassDrop(pr.x, pr.y, pr.z, w);
      return;
    }
    const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
    const n = clamp(Math.ceil((speed * dt) / 0.2), 1, 8);
    for (let i = 0; i < n; i++) moveGrenade(pr, dt / n);
    pr.mesh.position.set(pr.x, pr.y, pr.z);
    pr.tumble += dt * (pr.rest ? 0 : 9 + Math.min(10, speed));
    const spin = pr.mesh.getObjectByName('spin');
    if (spin) spin.rotation.x = pr.tumble;
    pr.mesh.userData.setFuse(pr.fuse / pr.fuseMax, S.t);
  }

  function moveGrenade(pr, h) {
    const w = pr.weapon;
    const world = getWorld();
    if (pr.rest) {
      const k = Math.exp(-h * 5);
      pr.vx *= k;
      pr.vz *= k;
      if (Math.hypot(pr.vx, pr.vz) < 0.15) pr.vx = pr.vz = 0;
    } else {
      pr.vy -= w.gravity * h;
    }
    let nx = pr.x + pr.vx * h;
    let ny = pr.y + pr.vy * h;
    let nz = pr.z + pr.vz * h;

    // walls: a ray along the horizontal step. The grenade comes to rest against the wall it hit and turns round.
    const hs = Math.hypot(pr.vx, pr.vz) * h;
    if (hs > 1e-6) {
      const dx = (pr.vx * h) / hs;
      const dz = (pr.vz * h) / hs;
      const wd = world.raycast(pr.x, pr.z, dx, dz, hs + GRENADE_R + 0.02);
      if (wd < hs + GRENADE_R) {
        const stop = Math.max(0, wd - GRENADE_R);
        nx = pr.x + dx * stop;
        nz = pr.z + dz * stop;
        bounceOff(pr, pr.x + dx * wd, pr.z + dz * wd);
        pr.vx *= w.bounce;
        pr.vz *= w.bounce;
        pr.vy *= 0.8;
        if (Math.hypot(pr.vx, pr.vz) > 1) audio.grenadeBounce();
      }
    }
    // the floor and the ceiling
    if (ny < GRENADE_R) {
      ny = GRENADE_R;
      if (pr.vy < 0) {
        if (-pr.vy > 1.4) audio.grenadeBounce();
        pr.vy = -pr.vy * w.bounce;
        pr.vx *= 0.82;
        pr.vz *= 0.82;
        if (pr.vy < 1.2) {
          pr.vy = 0;
          pr.rest = true;
        }
      }
    } else if (ny > GRENADE_R + 0.02) {
      pr.rest = false;
    }
    if (ny > WALL_H - GRENADE_R) {
      ny = WALL_H - GRENADE_R;
      if (pr.vy > 0) pr.vy = -pr.vy * w.bounce;
    }
    // robots are solid: it rebounds off them like a wall
    for (const e of S.enemies) {
      if (e.dead || ny > e.h + GRENADE_R) continue;
      const ex = nx - e.x;
      const ez = nz - e.z;
      const d = Math.hypot(ex, ez);
      const min = e.r + GRENADE_R;
      if (d >= min || d < 1e-6) continue;
      const ux = ex / d;
      const uz = ez / d;
      const dot = pr.vx * ux + pr.vz * uz;
      if (dot < 0) {
        pr.vx -= (1 + w.bounce) * dot * ux;
        pr.vz -= (1 + w.bounce) * dot * uz;
        audio.grenadeBounce();
      }
      nx = e.x + ux * min;
      nz = e.z + uz * min;
    }
    pr.x = nx;
    pr.y = ny;
    pr.z = nz;
  }

  // The bass drop: a shockwave that hurts a little and stuns every robot it reaches (a boss for less time). Walls stop it.
  function bassDrop(x, y, z, w) {
    const world = getWorld();
    const m = mult();
    audio.bassDrop();
    S.player.shake = Math.max(S.player.shake, 0.35);
    spawnWave('ring', x, z, 0, w.radius);
    for (const e of S.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.z - z) - e.r;
      if (d > w.radius || y > e.h + 2) continue;
      if (d > 0.5 && !world.los(x, z, e.x, e.z)) continue;
      const fall = 1 - clamp(d / w.radius, 0, 1) * 0.5;
      stun(e, stunFor(e, w));
      damageEnemy(e, w.damage * fall * m.damage, false, x, z, w.knock * fall, { pierce: true });
    }
    alertNear(x, z, 26);
  }

  // The airhorn: an instant shockwave in a cone. Shoves, stuns for a moment and does little damage; it ignores shields.
  function blast(w, m) {
    const p = S.player;
    const world = getWorld();
    const R = getR();
    audio.airhorn();
    p.shake = Math.max(p.shake, 0.15);
    if (R) R.muzzleT = 0.06;
    spawnWave('cone', p.x, p.z, p.yaw, w.range, w.arc);
    for (const e of S.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const dist = Math.hypot(dx, dz);
      const reach = dist - e.r;
      if (reach > w.range) continue;
      const off = Math.abs(((Math.atan2(-dx, -dz) - p.yaw + Math.PI * 3) % TAU) - Math.PI);
      if (off > w.arc + Math.atan2(e.r, Math.max(dist, 0.1))) continue;
      if (reach > 0.4 && !world.los(p.x, p.z, e.x, e.z)) continue;
      const fall = 1 - clamp(reach / w.range, 0, 1) * 0.5;
      stun(e, stunFor(e, w));
      damageEnemy(e, w.damage * fall * m.damage, false, p.x, p.z, w.knock * fall, { pierce: true });
    }
  }

  // ---- the Feedback Beam ----

  // The damage per second the beam is doing after it has rested on one target for `ramp` seconds.
  const beamDps = (w, ramp) => lerp(w.dps, w.dpsMax, clamp(ramp / w.ramp, 0, 1));

  // Once per frame while the Feedback Beam is in hand. The meter drains while the trigger is held and there is charge; the
  // beam hits whatever the crosshair rests on, ten times a second, harder the longer it stays on that one target.
  function beamFrame(dt, firing) {
    const p = S.player;
    const w = WEAPONS.beam;
    const b = p.beam;
    const m = mult();
    const live = firing && p.reloadT <= 0 && p.switchT <= 0 && p.ammo.beam > 0;
    if (!live) {
      if (b.on) audio.beamHum(false);
      b.on = false;
      b.idle += dt;
      b.miss += dt;
      if (b.miss > w.grace) {
        b.target = null;
        b.ramp = 0;
      }
      if (p.reloadT <= 0 && b.idle >= w.rechargeDelay) p.ammo.beam = Math.min(clipOf(w), p.ammo.beam + w.recharge * dt);
      return;
    }
    if (!b.on) b.tick = 0;
    b.on = true;
    b.idle = 0;
    p.ammo.beam = Math.max(0, p.ammo.beam - w.drain * dt);
    const f = forward3(p.yaw, p.pitch);
    const hit = castRay(p.x, EYE, p.z, f, w.range, false);
    b.len = hit.t;
    b.hit = { x: hit.x, y: hit.y, z: hit.z };
    const tgt = hit.enemy;
    if (tgt && tgt === b.target) {
      b.ramp = Math.min(w.ramp + 1, b.ramp + dt);
      b.miss = 0;
    } else if (tgt) {
      b.target = tgt;
      b.ramp = 0;
      b.miss = 0;
    } else {
      b.miss += dt;
      if (b.miss > w.grace) {
        b.target = null;
        b.ramp = 0;
      }
    }
    b.tick += dt;
    while (b.tick >= w.tick - 1e-9) { // (the epsilon keeps six 60 Hz frames to a tenth of a second)
      b.tick -= w.tick;
      if (tgt && !tgt.dead) {
        // a hit flashes a robot white; ten of those a second would keep it white, so only every third tick flashes
        const flash = tgt.flashT;
        damageEnemy(tgt, beamDps(w, b.ramp) * w.tick * m.damage, false, p.x, p.z, 0, { dist: hit.t });
        if (++b.ticks % 3 && !tgt.dead) tgt.flashT = flash;
        if (tgt.dead) {
          b.target = null;
          b.ramp = 0;
        }
      }
      spark(hit.x - f.x * 0.05, hit.y - f.y * 0.05, hit.z - f.z * 0.05);
      fxHit(hit, f, !!tgt, 4);
      alertNear(p.x, p.z, w.noise);
    }
    audio.beamHum(true, clamp(b.ramp / w.ramp, 0, 1));
  }

  // ---- SMG alt-fire ----

  const altAvailable = () => !!(S.player && S.player.weapon === 'smg' && upg().altfire > 0);

  // Starts the burst if the SMG has the pedal fitted, the cooldown is over and the gun is ready.
  function startAlt() {
    const p = S.player;
    const a = ALT_FIRE.smg;
    if (!altAvailable() || busy()) return false;
    if (p.alt.cd > 0 || p.alt.left > 0 || p.reloadT > 0 || p.switchT > 0 || p.ammo.smg <= 0) return false;
    p.alt.left = a.rounds;
    p.alt.gap = 0;
    p.alt.cd = a.cooldown;
    p.fireT = Math.max(p.fireT, a.rounds * a.gap + 0.12);
    return true;
  }

  // Once per frame: the cooldown runs down, a button press starts a burst, and a burst in progress fires its rounds.
  function updateAlt(dt, ctl) {
    const p = S.player;
    const a = ALT_FIRE.smg;
    p.alt.cd = Math.max(0, p.alt.cd - dt);
    if (ctl && ctl.alt) startAlt();
    if (p.alt.left <= 0) return;
    if (p.weapon !== 'smg' || busy()) {
      p.alt.left = 0; // swapped away or interrupted mid-burst
      return;
    }
    p.alt.gap -= dt;
    while (p.alt.left > 0 && p.alt.gap <= 0) {
      if (p.ammo.smg <= 0) {
        p.alt.left = 0;
        break;
      }
      p.ammo.smg--;
      p.alt.left--;
      p.alt.gap += a.gap / mult().fire;
      altRound(a);
    }
  }

  function altRound(a) {
    const p = S.player;
    const m = mult();
    const R = getR();
    const f = forward3(p.yaw, p.pitch);
    const right = { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) };
    const up = { x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x };
    const ang = Math.random() * TAU;
    const r = a.spread * Math.sqrt(Math.random());
    const ca = Math.cos(ang) * r;
    const sa = Math.sin(ang) * r;
    const dx = f.x + right.x * ca + up.x * sa;
    const dy = f.y + right.y * ca + up.y * sa;
    const dz = f.z + right.z * ca + up.z * sa;
    const len = Math.hypot(dx, dy, dz);
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const hit = castRay(p.x, EYE, p.z, d, a.range, false);
    p.kick = Math.min(1, p.kick + 0.1);
    S.shots++;
    audio.burst();
    alertNear(p.x, p.z, a.noise);
    if (R) {
      R.muzzleT = 0.06;
      R.flashT = 0.05;
      R.fx.muzzle(p.x + f.x * 0.9 + Math.cos(p.yaw) * 0.18, EYE - 0.15 + f.y * 0.9, p.z + f.z * 0.9 - Math.sin(p.yaw) * 0.18, f.x, f.y, f.z);
    }
    if (hit.enemy) {
      damageEnemy(hit.enemy, a.damage * m.damage * (hit.head ? 2 : 1), hit.head, p.x, p.z, a.knock, { dist: hit.t });
      spark(hit.x, hit.y, hit.z);
      fxHit(hit, d, true, 1);
    } else if (hit.t < a.range - 0.01) {
      spark(hit.x - d.x * 0.05, hit.y - d.y * 0.05, hit.z - d.z * 0.05);
      fxHit(hit, d, false, 1);
    }
  }

  // ---- HUD ----

  // Adds the arsenal's part of the HUD state: the owned upgrades (tiers) and the alt-fire button.
  function hud(h) {
    const u = upg();
    h.upgrades = { clip: u.clip, reload: u.reload, altfire: u.altfire };
    const a = ALT_FIRE.smg;
    h.alt = altAvailable() ? { cd: clamp(S.player.alt.cd / a.cooldown, 0, 1), secs: S.player.alt.cd, name: a.name } : null;
    if (h.weapon) h.weapon.meter = WEAPONS[S.player.weapon].kind === 'beam';
  }

  // The floor mesh for an upgrade or a record pickup (null for anything else, which game3d makes itself).
  function meshFor(def) {
    if (def.kind === 'upgrade') return M.makeUpgradePickup(def.item);
    if (def.kind === 'record') return M.makeRecordPickup(Math.max(0, RECORDS.findIndex((r) => r.id === def.item)));
    return null;
  }

  // ---- helpers for tests and screenshots ----

  // Puts a pickup in the world now, as a level would have (any kind, including the prepared ones).
  function spawnPickup(def) {
    const R = getR();
    const mesh = meshFor(def) || (def.kind === 'weapon' ? M.makeWeaponPickup(def.item) : M.makeDrinkPickup(def.item));
    mesh.position.set(def.x, 0, def.z);
    if (R) R.scene.add(mesh);
    const pk = { def: { id: `test-${def.item}`, ...def }, mesh, taken: false, phase: 0 };
    S.pickups.push(pk);
    return pk;
  }

  // A shockwave held still at progress k, for a screenshot (it never fades or ends on its own).
  function freezeWave(kind, x, z, yaw, radius, arc, k) {
    spawnWave(kind, x, z, yaw, radius, arc);
    const w = fx && fx.live[fx.live.length - 1];
    if (w) {
      w.t = k;
      w.life = 1e12;
      w.obj.update(k, radius, arc);
    }
  }

  // ---- giving things (tests and screenshots) ----

  // give('beam'), give(['beam', 'clip', 'gala']) or give({ weapons, upgrades, records }): weapons, upgrades (one tier each
  // time) and records by id; 'all' hands over every weapon, prepared ones included.
  function give(arg) {
    const ids = [];
    if (typeof arg === 'string') ids.push(arg);
    else if (Array.isArray(arg)) ids.push(...arg);
    else if (arg && typeof arg === 'object') ids.push(...(arg.weapons || []), ...(arg.upgrades || []), ...(arg.records || []));
    for (const id of ids) {
      if (id === 'all') {
        for (const wid of Object.keys(WEAPONS)) giveWeapon(wid);
      } else if (WEAPONS[id]) giveWeapon(id);
      else if (UPGRADES[id]) takeUpgrade(id);
      else if (RECORDS.some((r) => r.id === id)) takeRecord(id);
    }
  }

  function giveWeapon(id) {
    const p = S.player;
    p.owned[id] = true;
    p.ammo[id] = clipOf(WEAPONS[id]);
  }

  // ---- visuals (only with a renderer) ----

  function ensureFx() {
    const R = getR();
    if (!R || fx) return fx;
    const beam = M.makeBeam();
    beam.group.visible = false;
    R.scene.add(beam.group);
    const pool = (kind, n) => Array.from({ length: n }, () => ({ obj: M.makeShockwave(kind), busy: false, kind }));
    const stuns = Array.from({ length: 12 }, () => {
      const o = M.makeStunMark();
      o.group.visible = false;
      R.scene.add(o.group);
      return o;
    });
    fx = { beam, waves: { ring: pool('ring', 3), cone: pool('cone', 3) }, stuns, live: [] };
    return fx;
  }

  function spawnWave(kind, x, z, yaw, radius, arc = 0.62) {
    const R = getR();
    if (!R || !ensureFx()) return;
    const slot = fx.waves[kind].find((o) => !o.busy);
    if (!slot) return;
    slot.busy = true;
    const g = slot.obj.group;
    g.position.set(x, kind === 'cone' ? EYE - 0.35 : 0, z);
    g.rotation.set(0, yaw, 0);
    R.scene.add(g);
    fx.live.push({ slot, obj: slot.obj, t: 0, life: WAVE_LIFE[kind], radius, arc });
  }

  // The weapon-scene muzzle of the Feedback Beam, as a point in the main scene on the ray through the same pixel, so the
  // beam appears to leave the gun's emitter whatever the screen shape.
  const _v = new THREE.Vector3();
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  function beamOrigin(R, out) {
    const mz = R.models.beam && R.models.beam.getObjectByName('muzzle');
    if (!mz) return out.set(R.camera.position.x, R.camera.position.y - 0.2, R.camera.position.z);
    R.wroot.updateMatrixWorld(true);
    mz.getWorldPosition(_v);
    _v.project(R.wcam);
    _v.z = 0.5;
    _v.unproject(R.camera);
    _d.copy(_v).sub(R.camera.position).normalize();
    return out.copy(R.camera.position).addScaledVector(_d, 0.35);
  }

  // Called every render frame, after the viewmodel has been posed.
  function animate(dt) {
    const R = getR();
    if (!R || !S.player) return;
    ensureFx();
    const p = S.player;
    const playing = S.mode === 'play';

    // the beam in the world, from the gun's emitter to where it lands
    const b = p.beam;
    const live = playing && b && b.on && b.hit && !S.drink && !S.laser;
    fx.beam.group.visible = !!live;
    if (live) {
      beamOrigin(R, _o);
      _d.set(b.hit.x, b.hit.y, b.hit.z).sub(_o);
      const len = _d.length();
      fx.beam.group.position.copy(_o);
      fx.beam.group.quaternion.setFromUnitVectors(_v.set(0, 0, -1), _d.multiplyScalar(1 / Math.max(len, 1e-6)));
      fx.beam.update(len, clamp(b.ramp / WEAPONS.beam.ramp, 0, 1), S.t);
    }

    // shockwaves
    for (let i = fx.live.length - 1; i >= 0; i--) {
      const w = fx.live[i];
      w.t += dt / w.life;
      if (w.t >= 1) {
        w.obj.group.parent && w.obj.group.parent.remove(w.obj.group);
        w.slot.busy = false;
        fx.live.splice(i, 1);
      } else w.obj.update(w.t, w.radius, w.arc);
    }

    // stars over stunned robots
    let n = 0;
    for (const e of S.enemies) {
      if (!(e.stunT > 0) || e.dead || n >= fx.stuns.length) continue;
      const s = fx.stuns[n++];
      s.group.visible = true;
      s.group.position.set(e.x, e.h + 0.3, e.z);
      s.update(S.t + n);
    }
    for (; n < fx.stuns.length; n++) fx.stuns[n].group.visible = false;

    // the viewmodels: the beam's meter and emitter, the grenade's throw
    const bm = R.models.beam;
    if (bm && bm.userData.setCharge) {
      bm.userData.setCharge(p.ammo.beam !== undefined ? p.ammo.beam / clipOf(WEAPONS.beam) : 1);
      bm.userData.setBeam(!!(b && b.on), b ? clamp(b.ramp / WEAPONS.beam.ramp, 0, 1) : 0);
    }
    const gm = R.models.grenade;
    if (gm && p.weapon === 'grenade' && gm.visible) {
      const w = WEAPONS.grenade;
      const k = p.fireT > 0 ? 1 - p.fireT / (w.interval / host.fireRate()) : 1;
      // swing forward and let go, then a fresh grenade comes up from below
      if (k < 0.28) {
        const t = k / 0.28;
        R.wroot.position.z -= 0.2 * Math.sin(t * Math.PI * 0.5);
        R.wroot.position.y += 0.06 * t;
        R.wroot.rotation.x += 0.9 * t;
      } else if (k < 0.55) gm.visible = false;
      else if (k < 1) R.wroot.position.y -= 0.5 * (1 - (k - 0.55) / 0.45) ** 2;
      gm.userData.pulse(S.t, 1);
    }
    // the grenade throws nothing the muzzle flash should show
    if (p.weapon === 'grenade' && R.flashes.grenade) R.flashes.grenade.visible = false;
  }

  return {
    clipOf, reloadMult, takeUpgrade, takeRecord, stunStep, stun, reset, handles, fire, stepGrenade, bassDrop, blast, beamFrame, beamDps,
    updateAlt, startAlt, altAvailable, hud, give, meshFor, spawnPickup, freezeWave, animate,
  };
}
