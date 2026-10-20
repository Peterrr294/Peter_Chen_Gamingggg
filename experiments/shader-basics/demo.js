import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const vertexShader = `
varying vec2 vUv;
varying vec3 vLocalPosition;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vLocalPosition = position;

  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const fragmentShader = `
precision highp float;

uniform int uExperiment;
uniform int uUvMode;
uniform int uCoordinateMode;
uniform vec3 uFixedColor;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uMixAmount;
uniform vec2 uRepeat;
uniform float uLineWidth;
uniform float uSmoothEdges;
uniform vec2 uResolution;

varying vec2 vUv;
varying vec3 vLocalPosition;
varying vec3 vWorldPosition;

float gridLine(vec2 coordinates, float width, float smoothEdges) {
  vec2 repeated = fract(coordinates);
  vec2 distanceToEdge = min(repeated, 1.0 - repeated);
  float nearestEdge = min(distanceToEdge.x, distanceToEdge.y);
  float hardLine = 1.0 - step(width, nearestEdge);
  float softLine = 1.0 - smoothstep(width, width + 0.035, nearestEdge);
  return mix(hardLine, softLine, smoothEdges);
}

void main() {
  vec3 color = uFixedColor;

  if (uExperiment == 1) {
    if (uUvMode == 0) color = vec3(vUv.x);
    else if (uUvMode == 1) color = vec3(vUv.y);
    else if (uUvMode == 2) color = vec3(vUv.x, vUv.y, 0.0);
    else if (uUvMode == 3) color = vec3(step(0.5, vUv.x), step(0.5, vUv.y), 0.0);
    else color = vec3(smoothstep(0.35, 0.65, vUv.x), smoothstep(0.35, 0.65, vUv.y), 0.0);
  }

  if (uExperiment == 2) {
    float line = gridLine(vUv * uRepeat, uLineWidth, uSmoothEdges);
    vec3 tileColor = vec3(fract(vUv * uRepeat), 0.16);
    color = mix(tileColor * 0.28, vec3(0.18, 0.48, 1.0), line);
  }

  if (uExperiment == 3) {
    float gradient = clamp(vUv.x + (uMixAmount - 0.5), 0.0, 1.0);
    color = mix(uColorA, uColorB, gradient);
  }

  if (uExperiment == 4) {
    if (uCoordinateMode == 0) {
      color = vec3(vUv, 0.0);
    } else if (uCoordinateMode == 1) {
      vec2 local = vLocalPosition.xy * 0.25 + 0.5;
      color = vec3(local, 0.0);
    } else if (uCoordinateMode == 2) {
      vec2 worldGrid = vWorldPosition.xy * 0.75;
      float line = gridLine(worldGrid, 0.055, 1.0);
      color = mix(vec3(0.035), vec3(0.18, 0.48, 1.0), line);
    } else {
      vec2 screen = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      color = vec3(screen, 0.0);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

const minimalVertexCode = `void main() {
  gl_Position = projectionMatrix
    * modelViewMatrix
    * vec4(position, 1.0);
}`;

const minimalFragmentCode = `uniform vec3 uFixedColor;

void main() {
  gl_FragColor = vec4(uFixedColor, 1.0);
}`;

const experiments = [
  { name: 'A · FIXED COLOR', question: 'How does a fixed color travel from JavaScript to a pixel?' },
  { name: 'B · UV VISUALIZATION', question: 'How does each fragment receive an interpolated position on the plane?' },
  { name: 'C · REPEATED GRID', question: 'How can multiplication and fract create a pattern without an image texture?' },
  { name: 'D · UNIFORM COLOR MIX', question: 'How can JavaScript change shader input without rebuilding geometry?' },
  { name: 'E · COORDINATE SPACES', question: 'Which coordinate system should anchor a pattern, and what makes it move?' },
];

const coordinateFacts = [
  '<strong>UV:</strong> origin at the plane’s lower-left; approximately 0–1. It follows the mesh and does not change when the camera moves.',
  '<strong>Local:</strong> origin at the mesh pivot; this plane spans about −2 to +2 on X and Y. It follows the object transform.',
  '<strong>World:</strong> origin belongs to the scene. Moving the plane samples new world locations, so the grid stays anchored across objects or chunks.',
  '<strong>Screen:</strong> origin is the lower-left of the drawing buffer in pixels. Moving the object or camera changes which screen pixels it covers.',
];

const canvas = document.querySelector('#shaderCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x050505, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0, 6.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 11;
controls.target.set(0, 0, 0);

const uniforms = {
  uExperiment: { value: 0 },
  uUvMode: { value: 2 },
  uCoordinateMode: { value: 0 },
  uFixedColor: { value: new THREE.Color('#1748d4') },
  uColorA: { value: new THREE.Color('#1748d4') },
  uColorB: { value: new THREE.Color('#ff5a36') },
  uMixAmount: { value: 0.5 },
  uRepeat: { value: new THREE.Vector2(8, 6) },
  uLineWidth: { value: 0.06 },
  uSmoothEdges: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
};

const geometry = new THREE.PlaneGeometry(4, 4, 1, 1);
const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.DoubleSide });
const plane = new THREE.Mesh(geometry, material);
scene.add(plane);

document.querySelector('#vertexCode').textContent = minimalVertexCode;
document.querySelector('#fragmentCode').textContent = minimalFragmentCode;
const vertexLines = [
  '<code>void main()</code> is the entry point executed once for every vertex.',
  '<code>position</code> is the vertex attribute stored by the plane geometry.',
  '<code>modelViewMatrix</code> moves the local vertex into camera space.',
  '<code>projectionMatrix</code> converts camera space into clip space.',
  '<code>gl_Position</code> is the required vertex-stage output.',
];
const fragmentLines = [
  '<code>uniform vec3 uFixedColor</code> declares one RGB value supplied by JavaScript.',
  '<code>void main()</code> is the fragment-stage entry point.',
  '<code>vec4</code> adds alpha 1.0 to the RGB uniform.',
  '<code>gl_FragColor</code> becomes the output color for this fragment.',
];
document.querySelector('#vertexExplanation').innerHTML = vertexLines.map(line => `<li>${line}</li>`).join('');
document.querySelector('#fragmentExplanation').innerHTML = fragmentLines.map(line => `<li>${line}</li>`).join('');

const elements = {
  fixedColor: document.querySelector('#fixedColor'),
  uvMode: document.querySelector('#uvMode'),
  gridFocus: document.querySelector('#gridFocus'),
  repeatX: document.querySelector('#repeatX'),
  repeatY: document.querySelector('#repeatY'),
  lineWidth: document.querySelector('#lineWidth'),
  edgeMode: document.querySelector('#edgeMode'),
  colorA: document.querySelector('#colorA'),
  colorB: document.querySelector('#colorB'),
  mixAmount: document.querySelector('#mixAmount'),
  coordinateMode: document.querySelector('#coordinateMode'),
  planeX: document.querySelector('#planeX'),
  cameraX: document.querySelector('#cameraX'),
};

let currentExperiment = 0;
let running = true;
let frame = 0;
let rotation = 0;
let previousTime = performance.now();

function updateGridFocus() {
  const focus = elements.gridFocus.value;
  elements.repeatX.disabled = focus !== 'repeatX';
  elements.repeatY.disabled = focus !== 'repeatY';
  elements.lineWidth.disabled = focus !== 'lineWidth';
  elements.edgeMode.disabled = focus !== 'edge';
}

function updateCoordinateFacts() {
  document.querySelector('#coordinateFacts').innerHTML = coordinateFacts[Number(elements.coordinateMode.value)];
}

function updateReadouts() {
  document.querySelector('#fixedColorValue').textContent = elements.fixedColor.value;
  document.querySelector('#repeatXValue').textContent = elements.repeatX.value;
  document.querySelector('#repeatYValue').textContent = elements.repeatY.value;
  document.querySelector('#lineWidthValue').textContent = Number(elements.lineWidth.value).toFixed(3);
  document.querySelector('#mixAmountValue').textContent = Number(elements.mixAmount.value).toFixed(2);
  document.querySelector('#planeXValue').textContent = Number(elements.planeX.value).toFixed(2);
  document.querySelector('#cameraXValue').textContent = Number(elements.cameraX.value).toFixed(2);
}

function updateUniforms() {
  uniforms.uUvMode.value = Number(elements.uvMode.value);
  uniforms.uCoordinateMode.value = Number(elements.coordinateMode.value);
  uniforms.uFixedColor.value.set(elements.fixedColor.value);
  uniforms.uColorA.value.set(elements.colorA.value);
  uniforms.uColorB.value.set(elements.colorB.value);
  uniforms.uMixAmount.value = Number(elements.mixAmount.value);
  uniforms.uRepeat.value.set(Number(elements.repeatX.value), Number(elements.repeatY.value));
  uniforms.uLineWidth.value = Number(elements.lineWidth.value);
  uniforms.uSmoothEdges.value = Number(elements.edgeMode.value);
  plane.position.x = Number(elements.planeX.value);
  camera.position.x = Number(elements.cameraX.value);
  camera.lookAt(controls.target);
  controls.update();
  updateCoordinateFacts();
  updateReadouts();
}

function setExperiment(index) {
  currentExperiment = index;
  uniforms.uExperiment.value = index;
  document.querySelectorAll('[data-experiment]').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.experiment) === index));
  });
  document.querySelectorAll('[data-controls]').forEach(section => {
    section.hidden = Number(section.dataset.controls) !== index;
  });
  document.querySelector('#modeName').textContent = experiments[index].name;
  document.querySelector('#controlMode').textContent = `EXPERIMENT ${String.fromCharCode(65 + index)}`;
  document.querySelector('#researchQuestion').textContent = experiments[index].question;
}

function resetExperiment() {
  const defaults = {
    fixedColor: '#1748d4', uvMode: '2', gridFocus: 'repeatX', repeatX: '8', repeatY: '6',
    lineWidth: '0.06', edgeMode: '0', colorA: '#1748d4', colorB: '#ff5a36',
    mixAmount: '0.5', coordinateMode: '0', planeX: '0', cameraX: '0',
  };
  for (const [key, value] of Object.entries(defaults)) elements[key].value = value;
  rotation = 0;
  plane.rotation.z = 0;
  camera.position.set(0, 0, 6.6);
  controls.target.set(0, 0, 0);
  controls.update();
  running = true;
  document.querySelector('#pauseButton').textContent = 'PAUSE';
  document.querySelector('#pauseButton').setAttribute('aria-pressed', 'false');
  document.querySelector('#runState').textContent = 'RUNNING';
  updateGridFocus();
  updateUniforms();
}

document.querySelectorAll('[data-experiment]').forEach(button => {
  button.addEventListener('click', () => setExperiment(Number(button.dataset.experiment)));
});
for (const element of Object.values(elements)) element.addEventListener('input', updateUniforms);
elements.gridFocus.addEventListener('change', updateGridFocus);
elements.coordinateMode.addEventListener('change', updateCoordinateFacts);
document.querySelector('#resetButton').addEventListener('click', resetExperiment);
document.querySelector('#pauseButton').addEventListener('click', event => {
  running = !running;
  event.currentTarget.textContent = running ? 'PAUSE' : 'RESUME';
  event.currentTarget.setAttribute('aria-pressed', String(!running));
  document.querySelector('#runState').textContent = running ? 'RUNNING' : 'PAUSED';
});

function resizeRenderer() {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const pixelRatio = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  renderer.getDrawingBufferSize(uniforms.uResolution.value);
}

function render(time) {
  const delta = Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;
  resizeRenderer();
  if (running) {
    rotation += delta * 0.12;
    plane.rotation.z = Math.sin(rotation) * 0.08;
    frame += 1;
  }
  controls.update();
  renderer.render(scene, camera);
  document.querySelector('#frameReadout').textContent = `FRAME ${String(frame).padStart(4, '0')} · GEOMETRY ${geometry.uuid.slice(0, 8).toUpperCase()}`;
  requestAnimationFrame(render);
}

updateGridFocus();
updateUniforms();
setExperiment(0);
requestAnimationFrame(render);
