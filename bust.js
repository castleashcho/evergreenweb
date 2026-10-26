// Renders assets/plato.glb into #bustWrap. The fallback PNG stays visible
// until the model is ready, and for good if WebGL or the load fails.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const EG = window.EG;
const wrap = document.getElementById('bustWrap');
const canvas = wrap.querySelector('canvas');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchOrSmall = matchMedia('(hover: none), (max-width: 768px)');

const deg = THREE.MathUtils.degToRad;
const HEAD_GAP = 104;      // px above the head; 80 minimum + room for the ±10° tilt
const OVERHANG = 1.15;     // bust is this much taller than the space below the gap, so the base is cut off
const SWING = deg(60);     // auto rotation goes back and forth within ±60°
const FOLLOW = deg(20);    // extra yaw from the cursor's horizontal position
const TILT = deg(10);      // X tilt from the cursor's vertical position
const OPEN_YAW = deg(50);  // when the menu is open the bust turns to face it
const MODEL_YAW = 0;       // offset if the model's front is not +Z

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (e) {
    console.warn('WebGL unavailable, keeping the fallback image', e);
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // orthographic camera in CSS pixels, so the head gap is exact
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  camera.position.z = 1000;

  const pivot = new THREE.Group();
  scene.add(pivot);
  let model = null, topY = 0.5, height = 1, radiusXZ = 0.45;

  function fit() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2; camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    if (!model) return;
    const byWidth = 0.95 * w / (2 * radiusXZ);
    const byHeight = (h - HEAD_GAP) * OVERHANG / height;
    const s = Math.min(byWidth, byHeight);
    pivot.scale.setScalar(s);
    pivot.position.y = h / 2 - HEAD_GAP - topY * s;
    EG.bustFit = { headGapPx: HEAD_GAP, cutBelowPx: Math.round(HEAD_GAP + height * s - h) };
  }
  new ResizeObserver(fit).observe(wrap);

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('assets/plato.glb', gltf => {
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -c.y, -c.z);   // spin around the bust's own centre
    topY = box.max.y - c.y;
    height = box.max.y - box.min.y;
    radiusXZ = Math.hypot((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2);

    model.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      // keep the model's own textures; push the factors towards polished silver
      m.metalness = Math.max(m.metalness, 1);
      m.roughness = Math.min(m.roughness, 0.45);
      m.envMapIntensity = 1.25;
      // the base colour texture is warm (reads as gold); drop its saturation so the metal reads as silver
      m.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n  diffuseColor.rgb = vec3(min(1.0, dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 1.15));'
        );
      };
    });

    pivot.add(model);
    fit();
    wrap.classList.add('loaded');
    EG.bustReady = true;
  }, undefined, err => console.warn('plato.glb failed to load, keeping the fallback image', err));

  let mouseX = 0, mouseY = 0;
  addEventListener('pointermove', e => {
    mouseX = e.clientX / innerWidth * 2 - 1;
    mouseY = e.clientY / innerHeight * 2 - 1;
  });

  const clock = new THREE.Clock();
  const cur = { yaw: 0, tilt: 0 };
  let phase = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const slow = touchOrSmall.matches;
    const speed = reduce ? 0 : slow ? 0.05 : 0.3;   // rad/s of the swing phase
    const follow = reduce || slow ? 0 : 1;
    if (!EG.isOpen && !EG.dragging) phase += dt * speed;
    if (!EG.dragging) EG.dragYaw *= Math.pow(0.04, dt);   // drift back to the auto rotation

    let yaw, tilt;
    if (EG.isOpen) {
      yaw = OPEN_YAW;
      tilt = 0;
    } else {
      yaw = Math.sin(phase) * SWING + mouseX * FOLLOW * follow;
      tilt = mouseY * TILT * follow;
    }
    yaw += EG.dragYaw + MODEL_YAW;

    const k = 1 - Math.pow(0.001, dt);   // frame-rate independent lerp
    cur.yaw += (yaw - cur.yaw) * k;
    cur.tilt += (tilt - cur.tilt) * k;
    pivot.rotation.set(cur.tilt, cur.yaw, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init();
