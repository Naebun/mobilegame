// Procedural image-based lighting, so metal and glossy surfaces have something warm to reflect.
// A dark room: brown ceiling, dim walls, a few bright lamps and one cool window. Colours above 1 are intentional (HDR).
// Needs a WebGLRenderer; everything else in the game that is not rendering stays free of the DOM.
import * as THREE from '../vendor/three.module.min.js';

export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();

  // vertex-coloured interior sphere: dark above and below, a warmer band at the horizon
  const geo = new THREE.SphereGeometry(10, 32, 20);
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x1b1310);
  const mid = new THREE.Color(0x4a3426);
  const bottom = new THREE.Color(0x0c0907);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 10; // -1 bottom .. 1 top
    if (t >= 0) c.copy(mid).lerp(top, Math.pow(t, 0.6));
    else c.copy(mid).lerp(bottom, Math.pow(-t, 0.6));
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // lamps and a window, as bright rectangles on the inside of the sphere
  const lamp = (colour, power, w, h, dir) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.copy(dir).setLength(9);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  lamp(0xffb26b, 9, 3.2, 1.4, new THREE.Vector3(0.7, 0.55, -0.5));
  lamp(0xffa050, 7, 2.6, 1.2, new THREE.Vector3(-0.8, 0.4, 0.3));
  lamp(0xff7a4a, 5, 2.4, 1.0, new THREE.Vector3(0.1, 0.6, 0.9));
  lamp(0x7f95ff, 4, 3.4, 2.4, new THREE.Vector3(-0.3, 0.2, -0.95)); // a cool window

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return target.texture;
}
