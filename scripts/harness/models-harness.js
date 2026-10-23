// Shared scene for the models harness pages: the game's look (ACES tone mapping, procedural environment lighting,
// warm dim lights), a portrait camera, and grid layouts.
import * as THREE from '../../vendor/three.module.min.js';
import * as M from '../../src/models.js';
import { makeEnvironment } from '../../src/gfx-env.js';

export { THREE, M };

export function setup({ fov = 40, fogNear = 12, fogFar = 40, exposure = 1.1 } = {}) {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0807);
  scene.fog = new THREE.Fog(0x0e0806, fogNear, fogFar);
  scene.environment = makeEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 80);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0x8a6a50, 0x2a1c14, 0.7));
  const lights = [
    new THREE.PointLight(0xffa04a, 30, 16, 1.4),
    new THREE.PointLight(0xff7a3a, 20, 16, 1.4),
    new THREE.PointLight(0x8aa0c8, 8, 10, 1.4),
  ];
  lights[0].position.set(-4, 3, 2);
  lights[1].position.set(4, 3, 1);
  lights[2].position.set(0, 3.2, -3);
  scene.add(...lights);
  const torch = new THREE.PointLight(0xffe2c0, 12, 12, 1.4);
  torch.position.set(0, 0.1, 0.2);
  camera.add(torch);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 30, 0x4a3a2a, 0x2e241a);
  grid.position.y = 0.01;
  scene.add(grid);
  const content = new THREE.Group();
  scene.add(content);
  const render = () => renderer.render(scene, camera);
  return { renderer, scene, camera, content, render, lights, torch };
}

// Fit a camera to a width x height block centred at (0, h/2) seen from the front.
export function frame(camera, width, height, pad = 1.05, yAbove = 0.0) {
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const dh = (height * pad) / (2 * tan);
  const dw = (width * pad) / (2 * tan * camera.aspect);
  const d = Math.max(dh, dw);
  camera.position.set(0, height / 2 + yAbove, d);
  camera.lookAt(0, height / 2, 0);
}
