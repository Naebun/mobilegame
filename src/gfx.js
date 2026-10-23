// Render pipeline and quality ladder.
//
// medium and high: the scene (and the weapon, drawn on top) render in linear light into a half-float target, then a
// small chain makes bloom from anything brighter than 1 (bulbs, eyes, muzzle flashes use HDR colours on purpose), and
// one composite pass does filmic tone mapping, colour grading, vignette, hurt feedback and film grain.
// low: render straight to the screen with the renderer's own tone mapping. About what the game cost before this pass.
//
// Needs WebGL. Nothing else in the game imports this except game3d.js, so the headless tests stay free of it.

import * as THREE from '../vendor/three.module.min.js';

// pixelRatio is a ceiling; maxPixels caps the total rendered pixels so a big iPad screen costs no more than a phone.
export const TIERS = {
  high: { pixelRatio: 2, maxPixels: 1.5e6, msaa: 4, bloomScale: 0.5, post: true },
  medium: { pixelRatio: 1.5, maxPixels: 1.0e6, msaa: 2, bloomScale: 0.25, post: true },
  low: { pixelRatio: 1, maxPixels: 0.6e6, msaa: 0, bloomScale: 0.25, post: false },
};
export const TIER_ORDER = ['high', 'medium', 'low'];

const FS_VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D tScene;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.35;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, l - threshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc;
uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
  sum += texture2D(tSrc, vUv + dir * 1.3846154).rgb * 0.3162162;
  sum += texture2D(tSrc, vUv - dir * 1.3846154).rgb * 0.3162162;
  sum += texture2D(tSrc, vUv + dir * 3.2307692).rgb * 0.0702703;
  sum += texture2D(tSrc, vUv - dir * 3.2307692).rgb * 0.0702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COPY_FRAG = `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;

const COMPOSITE_FRAG = `
uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform float exposure;
uniform float bloomStrength;
uniform float vignette;
uniform float grain;
uniform float time;
uniform float hurt;
uniform float flash;
uniform vec3 lift;
uniform vec3 gammaV;
uniform vec3 gain;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r = length(d);
  float ab = 0.0015 + hurt * 0.012 * r;
  vec3 col;
  col.r = texture2D(tScene, uv + d * ab).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - d * ab).b;
  col += (texture2D(tBloomA, uv).rgb * 0.55 + texture2D(tBloomB, uv).rgb * 0.9) * bloomStrength;
  col *= exposure * (1.0 + flash * 0.25);
  col = aces(col);
  col = pow(max(col * gain + lift, 0.0), 1.0 / gammaV);
  col *= mix(1.0, smoothstep(0.95, 0.3, r * 1.25), vignette);
  col = mix(col, col * vec3(1.45, 0.5, 0.5), hurt * smoothstep(0.15, 0.85, r * 1.3));
  col = toSrgb(col);
  float n = fract(sin(dot(uv * vec2(1731.0, 911.0) + time, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * grain;
  gl_FragColor = vec4(col, 1.0);
}`;

function fsMaterial(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
  });
}

export function createPipeline(renderer, view, tierName) {
  const gl = renderer.getContext();
  const hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const rtType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const fsScene = new THREE.Scene();
  const fsMesh = new THREE.Mesh(tri, null);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);
  const fsCam = new THREE.Camera();

  const mats = {
    bright: fsMaterial(BRIGHT_FRAG, { tScene: { value: null }, threshold: { value: 0.85 } }),
    blur: fsMaterial(BLUR_FRAG, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } }),
    copy: fsMaterial(COPY_FRAG, { tSrc: { value: null } }),
    composite: fsMaterial(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloomA: { value: null }, tBloomB: { value: null }, exposure: { value: 1 }, bloomStrength: { value: 0.5 },
      vignette: { value: 0.35 }, grain: { value: 0.03 }, time: { value: 0 }, hurt: { value: 0 }, flash: { value: 0 },
      lift: { value: new THREE.Vector3(0, 0, 0) }, gammaV: { value: new THREE.Vector3(1, 1, 1) }, gain: { value: new THREE.Vector3(1, 1, 1) },
    }),
  };

  let tier = tierName;
  let sceneRT = null;
  let bright = null;
  let blurA1 = null;
  let blurA2 = null;
  let down = null;
  let blurB1 = null;
  let blurB2 = null;
  let size = { w: view.w, h: view.h, dpr: view.dpr || 1 };
  const ratio = () => {
    const t = TIERS[tier];
    return Math.max(1, Math.min(t.pixelRatio, size.dpr, Math.sqrt(t.maxPixels / (size.w * size.h))));
  };

  const makeRT = (w, h, samples = 0, depth = false) => new THREE.WebGLRenderTarget(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)), {
    type: rtType, samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: depth, generateMipmaps: false,
  });

  function disposeTargets() {
    for (const rt of [sceneRT, bright, blurA1, blurA2, down, blurB1, blurB2]) if (rt) rt.dispose();
    sceneRT = bright = blurA1 = blurA2 = down = blurB1 = blurB2 = null;
  }

  function build() {
    disposeTargets();
    const t = TIERS[tier];
    const pr = ratio();
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
    if (!t.post) return;
    sceneRT = makeRT(size.w * pr, size.h * pr, t.msaa, true);
    const bw = size.w * t.bloomScale * pr;
    const bh = size.h * t.bloomScale * pr;
    bright = makeRT(bw, bh);
    blurA1 = makeRT(bw, bh);
    blurA2 = makeRT(bw, bh);
    down = makeRT(bw / 2, bh / 2);
    blurB1 = makeRT(bw / 2, bh / 2);
    blurB2 = makeRT(bw / 2, bh / 2);
  }

  function pass(material, target) {
    fsMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  }

  function blur(src, tmp, dst, rt) {
    mats.blur.uniforms.tSrc.value = src.texture;
    mats.blur.uniforms.dir.value.set(1 / rt.width, 0);
    pass(mats.blur, tmp);
    mats.blur.uniforms.tSrc.value = tmp.texture;
    mats.blur.uniforms.dir.value.set(0, 1 / rt.height);
    pass(mats.blur, dst);
  }

  build();

  return {
    get tier() { return tier; },
    get hdr() { return hdr; },
    get pixelRatio() { return ratio(); },
    resize(v) {
      size = { w: v.w, h: v.h, dpr: v.dpr || 1 };
      build();
    },
    setTier(name) {
      if (name === tier || !TIERS[name]) return;
      tier = name;
      build();
    },
    // look: { exposure, bloom, vignette, grade: { lift, gamma, gain } } hints from the level. fx: { time, hurt, flash }.
    render(scene, camera, wscene, wcam, look, fx) {
      const t = TIERS[tier];
      if (!t.post) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = look.exposure;
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        if (wscene) {
          renderer.clearDepth();
          renderer.render(wscene, wcam);
        }
        return;
      }
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      if (wscene) {
        renderer.clearDepth();
        renderer.render(wscene, wcam);
      }
      mats.bright.uniforms.tScene.value = sceneRT.texture;
      pass(mats.bright, bright);
      blur(bright, blurA1, blurA2, bright);
      mats.copy.uniforms.tSrc.value = blurA2.texture;
      pass(mats.copy, down);
      blur(down, blurB1, blurB2, down);

      const u = mats.composite.uniforms;
      u.tScene.value = sceneRT.texture;
      u.tBloomA.value = blurA2.texture;
      u.tBloomB.value = blurB2.texture;
      u.exposure.value = look.exposure;
      u.bloomStrength.value = look.bloom;
      u.vignette.value = look.vignette;
      u.grain.value = tier === 'high' ? 0.035 : 0.025;
      u.time.value = fx.time % 100;
      u.hurt.value = fx.hurt;
      u.flash.value = fx.flash;
      u.lift.value.fromArray(look.grade.lift);
      u.gammaV.value.fromArray(look.grade.gamma);
      u.gain.value.fromArray(look.grade.gain);
      pass(mats.composite, null);
    },
  };
}
