// Shared scene for the models harness pages: dim neon lighting like the game, portrait camera, grid layouts.
import * as THREE from '../../vendor/three.module.min.js';
import * as M from '../../src/models.js';

export { THREE, M };

export function setup({ fov = 40, fogNear = 12, fogFar = 40 } = {}) {
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030a);
  scene.fog = new THREE.Fog(0x0a0614, fogNear, fogFar);
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 80);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0x6a5aa0, 0x2a1830, 1.6));
  const lights = [
    new THREE.PointLight(0x22d3ee, 22, 16, 1.4),
    new THREE.PointLight(0xff2e93, 22, 16, 1.4),
    new THREE.PointLight(0xfbbf24, 12, 10, 1.4),
  ];
  lights[0].position.set(-4, 3, 2);
  lights[1].position.set(4, 3, 1);
  lights[2].position.set(0, 3.2, -3);
  scene.add(...lights);
  const torch = new THREE.PointLight(0xffe2c0, 14, 12, 1.4);
  torch.position.set(0, 0.1, 0.2);
  camera.add(torch);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x1d1830 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 30, 0x3b2f5a, 0x241c3a);
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
