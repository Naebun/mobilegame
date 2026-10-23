// Particles and dust. Two pooled point clouds (additive sparks and alpha-blended smoke and oil) plus slow dust motes.
// Colours above 1 are intentional: sparks and fire are HDR so the bloom pass picks them up.
// Pure three.js, no DOM, so the game logic that calls it still runs headless (the calls just draw nothing there).

import * as THREE from '../vendor/three.module.min.js';

const VERT = `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 0.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
varying vec4 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, r);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

const rand = (a, b) => a + Math.random() * (b - a);

function makeCloud(count, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i++) pos[i * 3 + 1] = -100;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 3 : 2;
  const p = Array.from({ length: count }, () => ({ life: 0, max: 1, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s0: 0, s1: 0, r: 0, gc: 0, b: 0, a: 0 }));
  return { points, geo, mat, p, next: 0 };
}

export function createFx(scene) {
  const sparks = makeCloud(280, true);
  const smoke = makeCloud(160, false);
  const dust = makeCloud(140, true);
  scene.add(sparks.points, smoke.points, dust.points);

  // dust motes keep a fixed offset in a box around the camera and drift slowly, wrapping at the edges
  const motes = Array.from({ length: 140 }, () => ({ x: rand(-6, 6), y: rand(0.2, 3.2), z: rand(-6, 6), ph: rand(0, 6.28), sp: rand(0.05, 0.2) }));
  let quality = 1;
  let t = 0;

  const emit = (cloud, o) => {
    const q = cloud.p[cloud.next];
    cloud.next = (cloud.next + 1) % cloud.p.length;
    Object.assign(q, o, { life: o.max, max: o.max });
  };

  function updateCloud(cloud, dt) {
    const pos = cloud.geo.attributes.position.array;
    const col = cloud.geo.attributes.aColor.array;
    const size = cloud.geo.attributes.aSize.array;
    for (let i = 0; i < cloud.p.length; i++) {
      const q = cloud.p[i];
      if (q.life > 0) {
        q.life -= dt;
        q.vy -= q.g * dt;
        const d = Math.exp(-q.drag * dt);
        q.vx *= d;
        q.vy *= d;
        q.vz *= d;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.z += q.vz * dt;
        if (q.y < 0.02 && q.g > 0) { q.y = 0.02; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
      }
      const k = q.life > 0 ? 1 - q.life / q.max : 1; // 0 young .. 1 old
      const alive = q.life > 0;
      pos[i * 3] = q.x;
      pos[i * 3 + 1] = alive ? q.y : -100;
      pos[i * 3 + 2] = q.z;
      col[i * 4] = q.r;
      col[i * 4 + 1] = q.gc;
      col[i * 4 + 2] = q.b;
      col[i * 4 + 3] = alive ? q.a * (1 - k) * (1 - k * 0.3) : 0;
      size[i] = alive ? q.s0 + (q.s1 - q.s0) * k : 0;
    }
    cloud.geo.attributes.position.needsUpdate = true;
    cloud.geo.attributes.aColor.needsUpdate = true;
    cloud.geo.attributes.aSize.needsUpdate = true;
  }

  return {
    setQuality(f) { quality = f; },
    setScale(pixelsPerUnit) {
      sparks.mat.uniforms.uScale.value = pixelsPerUnit;
      smoke.mat.uniforms.uScale.value = pixelsPerUnit;
      dust.mat.uniforms.uScale.value = pixelsPerUnit;
    },

    // a spray of hot sparks leaving a surface along (nx, ny, nz)
    sparks(x, y, z, nx, ny, nz, count = 8) {
      const n = Math.max(1, Math.round(count * quality));
      for (let i = 0; i < n; i++) {
        const sp = rand(2, 6);
        emit(sparks, {
          x, y, z, vx: nx * sp + rand(-1.6, 1.6), vy: ny * sp + rand(0.4, 2.2), vz: nz * sp + rand(-1.6, 1.6), g: 9, drag: 1.2,
          s0: rand(0.03, 0.06), s1: 0.01, r: 5, gc: rand(1.6, 2.6), b: 0.5, a: 1, max: rand(0.25, 0.6),
        });
      }
    },
    // a grey-brown puff that swells and rises
    smoke(x, y, z, count = 2, size = 0.5, rise = 0.6, shade = 0.34) {
      const n = Math.max(1, Math.round(count * quality));
      for (let i = 0; i < n; i++) {
        emit(smoke, {
          x: x + rand(-0.08, 0.08), y, z: z + rand(-0.08, 0.08), vx: rand(-0.25, 0.25), vy: rand(0.2, 0.5) * rise, vz: rand(-0.25, 0.25), g: -0.15, drag: 1.4,
          s0: size * 0.4, s1: size * rand(1.2, 1.9), r: shade, gc: shade * 0.92, b: shade * 0.85, a: 0.45, max: rand(0.9, 1.6),
        });
      }
    },
    // dark droplets thrown out of a damaged robot (oil, not blood)
    oil(x, y, z, count = 5) {
      const n = Math.max(1, Math.round(count * quality));
      for (let i = 0; i < n; i++) {
        emit(smoke, {
          x, y, z, vx: rand(-2, 2), vy: rand(0.5, 2.5), vz: rand(-2, 2), g: 10, drag: 0.4,
          s0: rand(0.05, 0.1), s1: 0.03, r: 0.03, gc: 0.025, b: 0.02, a: 0.9, max: rand(0.5, 0.9),
        });
      }
    },
    // a flash of fire with a sparks burst and a rolling smoke column
    explosion(x, y, z, radius = 3) {
      for (let i = 0; i < Math.round(46 * quality); i++) {
        const a = rand(0, 6.283);
        const e = rand(-0.3, 1);
        const sp = rand(2, 9) * (radius / 3.6);
        emit(sparks, {
          x, y, z, vx: Math.cos(a) * sp, vy: e * sp + 2, vz: Math.sin(a) * sp, g: 6, drag: 0.9,
          s0: rand(0.08, 0.2), s1: 0.02, r: 6, gc: rand(1.4, 3.2), b: 0.4, a: 1, max: rand(0.4, 1),
        });
      }
      for (let i = 0; i < Math.round(14 * quality); i++) {
        emit(smoke, {
          x: x + rand(-radius * 0.3, radius * 0.3), y: y + rand(0, 1), z: z + rand(-radius * 0.3, radius * 0.3), vx: rand(-0.6, 0.6), vy: rand(0.4, 1.4), vz: rand(-0.6, 0.6), g: -0.1, drag: 1,
          s0: radius * 0.25, s1: radius * rand(0.7, 1.2), r: 0.2, gc: 0.17, b: 0.15, a: 0.55, max: rand(1.2, 2.2),
        });
      }
    },
    // a burst of white foam and bright bubbles (a Fizzbang Shaken going off)
    foam(x, y, z, radius = 3) {
      for (let i = 0; i < Math.round(36 * quality); i++) {
        const a = rand(0, 6.283);
        const sp = rand(1.5, 6) * (radius / 3.2);
        emit(smoke, {
          x, y, z, vx: Math.cos(a) * sp, vy: rand(1, 4), vz: Math.sin(a) * sp, g: 5, drag: 0.8,
          s0: rand(0.12, 0.3), s1: rand(0.25, 0.55), r: 0.95, gc: 0.93, b: 0.88, a: 0.75, max: rand(0.6, 1.3),
        });
      }
      for (let i = 0; i < Math.round(30 * quality); i++) {
        const a = rand(0, 6.283);
        const sp = rand(2, 8) * (radius / 3.2);
        emit(sparks, {
          x, y, z, vx: Math.cos(a) * sp, vy: rand(0.5, 5), vz: Math.sin(a) * sp, g: 6, drag: 0.9,
          s0: rand(0.04, 0.1), s1: 0.02, r: 2.2, gc: 2.1, b: 2.2, a: 0.9, max: rand(0.4, 0.9),
        });
      }
    },
    // a small puff and a few sparks at the muzzle
    muzzle(x, y, z, dx, dy, dz) {
      this.smoke(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, 1, 0.22, 0.4, 0.5);
      this.sparks(x, y, z, dx, dy, dz, 3);
    },
    // the robot has stopped: a puff of smoke and some sparks rising from it
    wreck(x, y, z) {
      this.smoke(x, y, z, 3, 0.7, 1, 0.22);
      this.sparks(x, y, z, 0, 1, 0, 10);
      this.oil(x, y, z, 6);
    },

    update(dt, camera, dustVisible = true) {
      t += dt;
      updateCloud(sparks, dt);
      updateCloud(smoke, dt);
      // dust: place the motes around the camera, drifting
      const n = dustVisible ? Math.round(motes.length * quality) : 0;
      const pos = dust.geo.attributes.position.array;
      const col = dust.geo.attributes.aColor.array;
      const size = dust.geo.attributes.aSize.array;
      const cx = camera.position.x;
      const cz = camera.position.z;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        if (i >= n) { col[i * 4 + 3] = 0; size[i] = 0; pos[i * 3 + 1] = -100; continue; }
        const wx = ((m.x + Math.sin(t * m.sp + m.ph) * 0.8 - cx + 6) % 12 + 12) % 12 - 6;
        const wz = ((m.z + Math.cos(t * m.sp * 0.8 + m.ph) * 0.8 - cz + 6) % 12 + 12) % 12 - 6;
        pos[i * 3] = cx + wx;
        pos[i * 3 + 1] = m.y + Math.sin(t * m.sp * 1.7 + m.ph) * 0.15;
        pos[i * 3 + 2] = cz + wz;
        col[i * 4] = 1.6;
        col[i * 4 + 1] = 1.25;
        col[i * 4 + 2] = 0.85;
        col[i * 4 + 3] = 0.16 * (0.6 + 0.4 * Math.sin(t * 0.8 + m.ph * 3));
        size[i] = 0.035;
      }
      dust.geo.attributes.position.needsUpdate = true;
      dust.geo.attributes.aColor.needsUpdate = true;
      dust.geo.attributes.aSize.needsUpdate = true;
    },
  };
}
