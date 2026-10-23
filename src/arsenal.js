// The prepared arsenal as three.js objects: the Feedback Beam, Bass-Drop Grenade and Airhorn (viewmodels, floor pickups and
// the grenade in flight), the three upgrade pickups, the collectible record, and the effects that go with them (the beam,
// shockwaves, the stun mark). The meshes are modelled in Blender (scripts/blender/arsenal.py) and live in
// arsenal-meshes.js; the effects are plain code, like the muzzle flash. No images and no DOM, so it runs under plain Node.
//
// models.js owns the shared material and geometry helpers, so it passes them in: `createArsenal(kit)` returns the factory
// functions and models.js re-exports them (makeWeaponModel, makeWeaponPickup and makeProjectile hand the new ids over).
// Torch contract, the same for every held weapon: child meshes named `torch` and `lens`, `userData.lens = { pos, dir }` in the
// weapon's frame, and `userData.setTorch({ mounted, on, k })` (an omitted mounted or on keeps its value, an omitted k is 1;
// safe to call every frame). New weapons start mounted and off.
// The grenade is thrown, so it has no torch parts, only a harmless `setTorch`.
import * as THREE from '../vendor/three.module.min.js';
import { ARSENAL_MESHES } from './arsenal-meshes.js';

export const ARSENAL_WEAPON_IDS = ['beam', 'grenade', 'airhorn'];
export const ARSENAL_UPGRADE_IDS = ['clip', 'reload', 'altfire'];
export const RECORD_VARIANTS = 4;

const HALF = Math.PI / 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// Plinth ring colour per item.
const COLOUR = { beam: 0x35e6ff, grenade: 0xff2e93, airhorn: 0xff7a2a, clip: 0xffb030, reload: 0x35e6ff, altfire: 0x8b6cff };
const RECORD_ACCENT = [0xff5a8a, 0xe0357c, 0x22d3ee, 0x7ac943];
const PICKUP_SCALE = { beam: 2.0, grenade: 2.6, airhorn: 2.1 };
const UPGRADE_SCALE = { clip: 2.4, reload: 2.6, altfire: 3.0 };
// Torch lens colours, the same as the other guns': dark glass when unlit, warm white well past 1 when lit so it blooms.
const LENS_OFF = new THREE.Color(0x353a42);
const LENS_ON = new THREE.Color(0xfff0d0).multiplyScalar(7);

export function createArsenal(kit) {
  const { once, pbrMat, glowBasic, hdr, meshGeo, plinth } = kit;

  const geoOf = (set, id) => once(`ars:${set}:${id}`, () => {
    const src = ARSENAL_MESHES[set][id];
    const geo = {};
    for (const [name, m] of Object.entries(src.parts)) geo[name] = { geo: meshGeo(m), glow: m.glow || null };
    return { src, geo };
  });

  const glowMesh = (part, name) => {
    const m = new THREE.Mesh(part.geo, glowBasic(part.glow[0], part.glow[1], false));
    m.name = name;
    return m;
  };

  // ---- held weapons ----

  function makeWeaponModel(id, { hands = true, torch: mountTorch } = {}) {
    if (!ARSENAL_WEAPON_IDS.includes(id)) throw new Error(`makeWeaponModel: unknown weapon "${id}"`);
    const { src, geo } = geoOf('weapons', id);
    const g = new THREE.Group();
    g.name = `weapon-${id}`;
    const body = new THREE.Mesh(geo.body.geo, pbrMat());
    body.name = 'body';
    const lamp = new THREE.Mesh(once('ars:lamp', () => new THREE.SphereGeometry(0.011, 8, 6)), glowBasic(COLOUR[id], 5, false));
    lamp.name = 'glow'; // the small indicator lamp
    lamp.position.set(...src.lamp);
    g.add(body, lamp);
    for (const name of Object.keys(geo)) {
      if (geo[name].glow && name !== 'lens') g.add(glowMesh(geo[name], name)); // the emitter, the meter LEDs, the light band
    }
    if (hands && geo.hands) {
      const h = new THREE.Mesh(geo.hands.geo, pbrMat());
      h.name = 'hands';
      g.add(h);
    }
    const muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(...src.muzzle);
    g.add(muzzle);

    // The torch: a body painted in the gun's style and a lens that glows when the torch is on. The lens material belongs to
    // this model alone, so two guns never share a glow.
    const st = { mounted: mountTorch ?? true, on: false };
    if (geo.torch && geo.lens) {
      const torch = new THREE.Mesh(geo.torch.geo, pbrMat());
      torch.name = 'torch';
      const lensMat = new THREE.MeshBasicMaterial({ color: LENS_OFF.clone(), fog: false });
      const lens = new THREE.Mesh(geo.lens.geo, lensMat);
      lens.name = 'lens';
      g.add(torch, lens);
      g.userData.lens = { pos: [...src.lens.pos], dir: [...src.lens.dir] };
      g.userData.setTorch = (opts) => {
        const { mounted, on, k } = opts || {};
        if (mounted !== undefined) st.mounted = !!mounted;
        if (on !== undefined) st.on = !!on;
        torch.visible = lens.visible = st.mounted;
        lensMat.color.copy(LENS_OFF);
        if (st.on) lensMat.color.lerp(LENS_ON, clamp(num(k, 1), 0, 1));
      };
      g.userData.setTorch();
    } else {
      g.userData.setTorch = () => {};
    }

    if (id === 'beam') {
      // The five LEDs on each flank are the charge meter: setCharge(f) lights the first ceil(5 f) of them. The emitter
      // ball hums brighter while the beam is on (setBeam(on, ramp), ramp 0 to 1).
      const leds = [0, 1, 2, 3, 4].map((i) => g.getObjectByName(`led${i}`));
      const emitter = g.getObjectByName('emitter');
      const emitMat = emitter.material.clone();
      emitter.material = emitMat;
      const base = emitMat.color.clone();
      g.userData.setCharge = (f) => {
        const lit = Math.ceil(clamp(num(f, 0), 0, 1) * 5 - 1e-6);
        leds.forEach((m, i) => { m.visible = i < lit; });
      };
      g.userData.setBeam = (on, ramp = 0) => {
        emitMat.color.copy(base).multiplyScalar(on ? 0.9 + 0.7 * clamp(num(ramp, 0), 0, 1) : 0.35);
        emitter.scale.setScalar(on ? 1 + 0.12 * clamp(num(ramp, 0), 0, 1) : 1);
      };
      g.userData.setCharge(1);
      g.userData.setBeam(false);
    }
    if (id === 'grenade') {
      // pulse(t, fuse01): the light band throbs, faster as the fuse runs down (the held grenade just glows steadily)
      const band = g.getObjectByName('band');
      const bandMat = band.material.clone();
      band.material = bandMat;
      const base = bandMat.color.clone();
      g.userData.pulse = (t = 0, f = 1) => {
        const quick = f < 0.4 ? 1 + 8 * (1 - f / 0.4) : 1;
        bandMat.color.copy(base).multiplyScalar(0.7 + 0.5 * Math.sin(num(t, 0) * 6 * quick));
      };
      g.userData.pulse(0, 1);
    }
    return g;
  }

  function makeWeaponPickup(id) {
    const g = new THREE.Group();
    g.name = `pickup-${id}`;
    g.add(plinth(COLOUR[id] ?? 0x35e6ff));
    const item = new THREE.Group();
    item.name = 'item';
    const model = makeWeaponModel(id, { hands: false });
    const bb = new THREE.Box3().setFromObject(model);
    const c = bb.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -c.y, -c.z);
    item.add(model);
    item.scale.setScalar(PICKUP_SCALE[id] ?? 2);
    item.position.y = 0.95;
    g.add(item);
    return g;
  }

  // ---- the grenade in flight ----

  function makeGrenade() {
    const { geo } = geoOf('weapons', 'grenade');
    const g = new THREE.Group();
    g.name = 'projectile-grenade';
    const spin = new THREE.Group();
    spin.name = 'spin'; // the game tumbles this about x
    const body = new THREE.Mesh(geo.body.geo, pbrMat());
    const band = glowMesh(geo.band, 'band');
    const bandMat = band.material.clone();
    band.material = bandMat;
    const base = bandMat.color.clone();
    // the model's origin is at the grip: shift it so the head, the heavy part, is near the centre of the tumble
    const holder = new THREE.Group();
    holder.position.set(0, -0.09, 0.02);
    holder.add(body, band);
    spin.add(holder);
    spin.scale.setScalar(1.25);
    const halo = new THREE.Mesh(once('ars:halo', () => new THREE.SphereGeometry(0.13, 10, 8)), once('ars:haloMat', () => new THREE.MeshBasicMaterial({
      color: hdr(0xff2e93, 1.0), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })));
    g.add(spin, halo);
    // setFuse(remaining01, t): the band throbs faster and brighter as the fuse runs out
    g.userData.setFuse = (f, t = 0) => {
      const ff = clamp(num(f, 1), 0, 1);
      const quick = 1 + 7 * (1 - ff);
      bandMat.color.copy(base).multiplyScalar(0.8 + 0.6 * Math.max(0, Math.sin(num(t, 0) * 7 * quick)) + 0.5 * (1 - ff));
    };
    g.userData.setFuse(1, 0);
    return g;
  }

  // ---- upgrades and records ----

  function pickupFrom(set, id, name, colour, scale, tilt = 0) {
    const { geo } = geoOf(set, id);
    const g = new THREE.Group();
    g.name = name;
    g.add(plinth(colour));
    const item = new THREE.Group();
    item.name = 'item';
    const model = new THREE.Group();
    for (const [pname, part] of Object.entries(geo)) {
      const m = part.glow ? glowMesh(part, pname) : new THREE.Mesh(part.geo, pbrMat());
      m.name = pname;
      model.add(m);
    }
    model.rotation.x = tilt;
    item.add(model);
    const bb = new THREE.Box3().setFromObject(model);
    const c = bb.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -c.y, -c.z);
    item.scale.setScalar(scale);
    item.position.y = 0.95;
    g.add(item);
    return g;
  }

  function makeUpgradePickup(id) {
    if (!ARSENAL_UPGRADE_IDS.includes(id)) throw new Error(`makeUpgradePickup: unknown upgrade "${id}"`);
    return pickupFrom('pickups', id, `pickup-upgrade-${id}`, COLOUR[id], UPGRADE_SCALE[id]);
  }

  // `index` is the record's place in the RECORDS list: the label colours repeat every four.
  function makeRecordPickup(index = 0) {
    const v = ((Math.floor(num(index, 0)) % RECORD_VARIANTS) + RECORD_VARIANTS) % RECORD_VARIANTS;
    return pickupFrom('pickups', `record${v}`, `pickup-record-${v}`, RECORD_ACCENT[v], 2.8, -0.18);
  }

  // ---- effects (HDR and additive, so they bloom) ----

  const additive = (hex, k, opacity) => new THREE.MeshBasicMaterial({
    color: hdr(hex, k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });

  // The Feedback Beam as seen in the world: a hot core inside a cyan sheath and a wide magenta glow, from the origin along
  // -z, with a bright spot where it lands. update(len, ramp, t): ramp (0 to 1) is how long it has stayed on one target.
  function makeBeam() {
    const group = new THREE.Group();
    group.name = 'fx-beam';
    const part = (w, hex, k, opacity) => {
      // a thin cone along -z, a tenth as wide at the gun as at the far end, so it never fills the screen near the camera
      const geo = once(`ars:beam:${w}`, () => {
        const b = new THREE.CylinderGeometry(w / 2, w / 20, 1, 8, 1, true);
        b.rotateX(-HALF);
        b.translate(0, 0, -0.5);
        return b;
      });
      const m = new THREE.Mesh(geo, additive(hex, k, opacity));
      m.frustumCulled = false;
      group.add(m);
      return m;
    };
    const core = part(0.035, 0xffffff, 5, 1);
    const mid = part(0.09, 0x7ff0ff, 2.6, 0.5);
    const glow = part(0.2, 0xff2e93, 1.4, 0.16);
    const spot = new THREE.Mesh(once('ars:spot', () => new THREE.SphereGeometry(0.1, 10, 8)), additive(0xbff8ff, 2.5, 0.7));
    spot.frustumCulled = false;
    group.add(spot);
    const warm = new THREE.Color();
    const cool = new THREE.Color(0x7ff0ff);
    const hot = new THREE.Color(0xff9ae0);
    return {
      group,
      update(len, ramp = 0, t = 0) {
        const L = Math.max(0.1, num(len, 1));
        const r = clamp(num(ramp, 0), 0, 1);
        const pulse = 1 + 0.12 * Math.sin(num(t, 0) * 55) + 0.1 * r * Math.sin(num(t, 0) * 23);
        core.scale.set(pulse * (1 + 0.8 * r), pulse * (1 + 0.8 * r), L);
        mid.scale.set(pulse * (1 + 0.6 * r), pulse * (1 + 0.6 * r), L);
        glow.scale.set(1 + 1.2 * r, 1 + 1.2 * r, L);
        // the feedback builds: the sheath goes from cyan to hot pink-white
        warm.copy(cool).lerp(hot, r);
        mid.material.color.copy(warm).multiplyScalar(2.6);
        spot.position.z = -L;
        spot.scale.setScalar((0.6 + 1.4 * r) * pulse);
      },
    };
  }

  // A shockwave on the floor and in the air: an expanding ring and a thin shell for 'ring' (the grenade), a fan of rings
  // moving out along -z for 'cone' (the airhorn, whose group the game points along the player's heading). update(k, radius, arc) takes
  // k from 0 to 1 over the wave's life; `radius` is how far it reaches (and `arc` how wide the cone is, in radians).
  function makeShockwave(kind = 'ring') {
    const group = new THREE.Group();
    group.name = `fx-wave-${kind}`;
    const mats = [];
    const mk = (geo, hex, k, op) => {
      const m = new THREE.Mesh(geo, additive(hex, k, op));
      m.frustumCulled = false;
      mats.push(m.material);
      group.add(m);
      return m;
    };
    let update;
    if (kind === 'cone') {
      const rings = [0, 1, 2, 3].map((i) => {
        const m = mk(once('ars:conering', () => new THREE.RingGeometry(0.93, 1, 28)), i % 2 ? 0xffb347 : 0xfff0c8, 1.6, 0.8);
        return m;
      });
      const shell = mk(once('ars:coneshell', () => {
        const c = new THREE.ConeGeometry(1, 1, 20, 1, true);
        c.rotateX(-HALF); // apex at the origin, opening along -z
        c.translate(0, 0, -0.5);
        return c;
      }), 0xff9a3a, 1.0, 0.07);
      update = (k, radius = 7, arc = 0.62) => {
        const kk = clamp(num(k, 0), 0, 1);
        const reach = radius * (0.25 + 0.75 * (1 - (1 - kk) * (1 - kk)));
        shell.scale.set(Math.tan(arc) * reach, Math.tan(arc) * reach, reach);
        shell.material.opacity = 0.08 * (1 - kk);
        rings.forEach((m, i) => {
          const f = clamp(kk * 1.25 - i * 0.1, 0, 1);
          const d = Math.max(0.2, radius * f);
          m.position.z = -d;
          m.scale.setScalar(Math.max(0.05, Math.tan(arc) * d));
          m.material.opacity = 0.9 * (1 - f) * (f > 0 ? 1 : 0);
        });
      };
    } else {
      const ring = mk(once('ars:ring', () => new THREE.RingGeometry(0.88, 1, 40)), 0xff5ec0, 1.8, 0.85);
      ring.rotation.x = -HALF;
      ring.position.y = 0.07;
      const ring2 = mk(once('ars:ring', () => new THREE.RingGeometry(0.88, 1, 40)), 0x7ff0ff, 1.4, 0.6);
      ring2.rotation.x = -HALF;
      ring2.position.y = 0.09;
      const dome = mk(once('ars:wall', () => {
        const c = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
        c.translate(0, 0.5, 0);
        return c;
      }), 0xff2e93, 1.2, 0.25); // a low wall of light riding out with the ring
      const flash = mk(once('ars:flash', () => new THREE.SphereGeometry(1, 10, 8)), 0xffffff, 2, 0.7);
      update = (k, radius = 7) => {
        const kk = clamp(num(k, 0), 0, 1);
        const e = 1 - (1 - kk) * (1 - kk) * (1 - kk);
        const r = Math.max(0.05, radius * e);
        ring.scale.setScalar(r);
        ring2.scale.setScalar(Math.max(0.05, radius * Math.min(1, e * 1.2) * 0.8));
        dome.scale.set(r, 0.9 * (1 - kk * 0.6), r);
        flash.scale.setScalar(0.3 + 0.6 * (1 - kk));
        ring.material.opacity = 0.9 * (1 - kk);
        ring2.material.opacity = 0.7 * (1 - kk) * (1 - kk);
        dome.material.opacity = 0.3 * (1 - kk) * (1 - kk);
        flash.material.opacity = 0.8 * Math.max(0, 1 - kk * 5);
      };
    }
    update(0);
    return { group, update, materials: mats };
  }

  // Stars circling a stunned robot's head. update(t) turns them.
  function makeStunMark() {
    const group = new THREE.Group();
    group.name = 'fx-stun';
    const star = once('ars:star', () => new THREE.OctahedronGeometry(0.075));
    const mat = once('ars:starMat', () => additive(0xffe27a, 4, 0.95));
    const stars = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(star, mat);
      m.frustumCulled = false;
      group.add(m);
      return m;
    });
    const ring = new THREE.Mesh(once('ars:stunring', () => new THREE.TorusGeometry(0.42, 0.012, 4, 24)), once('ars:stunringMat', () => additive(0xffe27a, 2, 0.35)));
    ring.rotation.x = HALF;
    ring.frustumCulled = false;
    group.add(ring);
    return {
      group,
      update(t = 0) {
        const tt = num(t, 0);
        stars.forEach((m, i) => {
          const a = tt * 4.2 + (i * Math.PI * 2) / 3;
          m.position.set(Math.cos(a) * 0.42, Math.sin(tt * 6 + i) * 0.04, Math.sin(a) * 0.42);
          m.rotation.set(tt * 3 + i, tt * 4, 0);
        });
      },
    };
  }

  return {
    makeWeaponModel,
    makeWeaponPickup,
    makeProjectile: (kind) => {
      if (kind === 'grenade') return makeGrenade();
      throw new Error(`makeProjectile: unknown arsenal projectile "${kind}"`);
    },
    makeUpgradePickup,
    makeRecordPickup,
    makeBeam,
    makeShockwave,
    makeStunMark,
  };
}
