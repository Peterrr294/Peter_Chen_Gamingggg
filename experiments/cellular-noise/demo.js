// 从已经安装的 three 包中导入 Three.js 的全部核心工具。
import * as THREE from 'three';
// OrbitControls 是额外控制器，让鼠标能够旋转、缩放和平移相机。
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// lil-gui 根据 parameters 对象创建 sliders 和按钮。
import GUI from 'lil-gui';

import { CHUNK_SIZE, sampleNoise, shapeNoise, sampleHeight, worldCoordinate, generateMap as generateNoiseMap, checksum } from './noise.js';

const canvas = document.querySelector('#mapCanvas');
const context = canvas.getContext('2d', { alpha: false });
const chunkOutline = document.querySelector('#chunkOutline');
const guiMount = document.querySelector('#guiMount');
const mapSizeReadout = document.querySelector('#mapSizeReadout');
const chunkReadout = document.querySelector('#chunkReadout');
const cellReadout = document.querySelector('#cellReadout');
const valueReadout = document.querySelector('#valueReadout');
const checksumReadout = document.querySelector('#checksumReadout');
const orderResult = document.querySelector('#orderResult');
const mapState = document.querySelector('#mapState');
const simulationReadout = document.querySelector('#simulationReadout');
const simulationToggle = document.querySelector('#simulationToggle');
const wireframeToggle = document.querySelector('#wireframeToggle');

// 这个对象是 Stage 4 的单一参数来源，lil-gui 会直接修改其中的属性。
const parameters = {
  // seed 保持固定，使本阶段只研究 sliders 对画面的影响。
  seed: 20260909,
  // scale 越大，feature cells 越大，地图形状也越大。
  scale: 10,
  // shaping 决定连续 F1 要经过哪一种二值塑形运算。
  shaping: 'Threshold',
  // Threshold 模式使用自己的 cutoff 数值。
  threshold: 0.58,
  // Invert Threshold 模式保存独立 cutoff，切换模式不会覆盖它。
  invertThreshold: 0.58,
  // Band 模式保存独立宽度，决定被选中环带的厚度。
  bandWidth: 0.16,
  // gridHeight 把二值 1 转换成多少个 3D 世界单位。
  gridHeight: 2,
  // resolution 同时控制每边 noise samples 和 3D vertices 的数量。
  resolution: 64,
  // heightMode 决定 3D 是显示二值台阶，还是显示连续 F1 地形。
  heightMode: 'Layered terrain',
  // material 决定连续地形使用冷色等高线还是暖色地形材质。
  material: 'Terrain',
  // worldSize 固定世界范围，octaves 和 persistence 控制噪声叠加。
  worldSize: 32,
  octaves: 3,
  persistence: 0.35,
  // simulationSpeed 控制无限地图滚动时的世界坐标速度。
  simulationSpeed: 2,
  // worldOffset 让键盘和模拟器可以平移采样窗口，而不改变噪声算法。
  worldOffsetX: 0,
  worldOffsetY: 0,
};
// noiseField 保存阈值处理前的连续 F1 距离，每格可以是 0 到约 1.414 的小数。
let noiseField = new Float32Array(parameters.resolution ** 2);
// map 保存阈值处理后的二值结果，每格只能是 0 或 1。
let map = new Uint8Array(parameters.resolution ** 2);
let heightMap = new Float32Array(parameters.resolution ** 2);
let selectedCell = null;
let selectedChunk = { x: 0, y: 0 };
let simulationRunning = false;
let lastSimulationTime = 0;
let simulationFrame;

// 找到 HTML 中专门显示 3D 画面的 canvas。
const threeCanvas = document.querySelector('#threeCanvas');
// Scene 是一个容器，所有想被相机看到的 3D 对象都要放进它。
const threeScene = new THREE.Scene();
// 把 3D 场景背景设为纯黑色，和左侧 2D 地图保持一致。
threeScene.background = new THREE.Color(0x000000);

// PerspectiveCamera 模拟人眼透视：远处的东西看起来更小。
// 参数依次是视野角度、宽高比、最近可见距离和最远可见距离。
const threeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
// 把相机放到网格右上前方，因此可以同时看到网格的宽度和深度。
threeCamera.position.set(8, 7, 8);

// WebGLRenderer 负责把 Scene 和 Camera 转换成 canvas 中的像素。
const threeRenderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
// 限制像素比，避免高分辨率屏幕生成过大的画布而浪费性能。
threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// gridGeometry 使用 let，因为 resolution 改变时必须替换整份 geometry。
let gridGeometry = createGridGeometry();
// Standard 材质会响应灯光；wireframe 让每个被移动的三角形仍然可见。
const gridMaterial = new THREE.MeshStandardMaterial({
  // 使用明亮克莱因蓝作为网格颜色。
  color: 0xffffff,
  vertexColors: true,
  side: THREE.DoubleSide,
  // 保留线框显示，方便观察顶点组成的表面。
  wireframe: false,
  // 较高粗糙度让高低变化有柔和、清楚的明暗差异。
  roughness: 0.8,
  // 金属度为 0，保持普通表面反光。
  metalness: 0,
});
// Mesh 把“顶点组成的形状”和“表面显示方式”组合成一个对象。
const flatGrid = new THREE.Mesh(gridGeometry, gridMaterial);
// PlaneGeometry 默认竖在 XY 平面；绕 X 轴转 -90° 后，它平放在 XZ 地面。
flatGrid.rotation.x = -Math.PI / 2;
// 把平坦网格加入场景，使 renderer 可以绘制它。
threeScene.add(flatGrid);

// 环境光从所有方向提供基础亮度，避免背光区域完全消失。
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
// 把环境光加入场景。
threeScene.add(ambientLight);
// 方向光从右上方照向网格，使高度变化产生清楚的明暗。
const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2);
// 设置方向光的位置；它的默认目标是世界原点。
directionalLight.position.set(5, 8, 4);
// 把方向光加入场景。
threeScene.add(directionalLight);

// OrbitControls 让相机围绕一个目标点运动，而不是移动网格本身。
const threeControls = new OrbitControls(threeCamera, threeCanvas);
// 将旋转中心设置在世界原点，也就是网格的中心。
threeControls.target.set(0, 0, 0);
// 限制相机不能缩得过近，避免穿过网格。
threeControls.minDistance = 4;
// 限制相机不能拉得过远，避免网格变成一个看不清的小点。
threeControls.maxDistance = 24;
// 把上面的 target 设置立即同步到相机控制器。
threeControls.update();

// 这个函数只负责绘制当前 3D 状态，不修改任何顶点。
function renderThreeGrid() {
  // 使用当前场景和当前相机生成一帧画面。
  threeRenderer.render(threeScene, threeCamera);
}

// 根据当前 resolution 创建顶点数量完全匹配的新平面。
function createGridGeometry() {
  // 每边 N 个 samples 需要 N 个 vertices，也就是 N - 1 个 segments。
  const geometry = new THREE.PlaneGeometry(10, 10, parameters.resolution - 1, parameters.resolution - 1);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(parameters.resolution ** 2 * 3), 3));
  return geometry;
}

// resolution 改变时，旧 geometry 的顶点数量无法继续使用。
function rebuildGridGeometry() {
  // 保存旧 geometry，稍后释放它占用的 GPU 资源。
  const oldGeometry = gridGeometry;
  // 创建与新 resolution 匹配的 geometry。
  gridGeometry = createGridGeometry();
  // 让现有 Mesh 改用新的 geometry；相机、材质和控制器都可以保留。
  flatGrid.geometry = gridGeometry;
  // 释放旧的 vertex buffers，避免反复修改 resolution 后累积内存。
  oldGeometry.dispose();
}

// 把左侧 Canvas 使用的同一个二值 map 应用到 3D 顶点。
function applyMapToThreeGrid() {
  // position attribute 保存每个顶点的 local X、Y、Z 坐标。
  const positions = gridGeometry.attributes.position;
  // 如果样本数与顶点数不同，立即报告错误，避免错位后仍继续绘制。
  if (positions.count !== map.length) throw new Error('Noise sample count must match grid vertex count.');
  // 逐个读取 map；数组索引与 PlaneGeometry 的顶点索引一一对应。
  for (let index = 0; index < map.length; index += 1) {
    // PlaneGeometry 旋转前的 local Z 会在旋转后成为 world Y 高度。
    // 同一 heightMap 值也用于左侧灰度，确保两个视图一致。
    const normalized = heightMap[index];
    positions.setZ(index, normalized * parameters.gridHeight);
    const color = new THREE.Color();
    if (parameters.material === 'Contour') {
      color.setHSL(0.62, 0.65, 0.15 + normalized * 0.65);
    } else {
      // 按高度从低谷深绿过渡到山坡，再到高处的岩石和雪色。
      const stops = ['#17394a', '#426b46', '#9a9368', '#eeeeeb'];
      const t = normalized * (stops.length - 1);
      const low = Math.min(stops.length - 2, Math.floor(t));
      color.set(stops[low]).lerp(new THREE.Color(stops[low + 1]), t - low);
    }
    gridGeometry.attributes.color.setXYZ(index, color.r, color.g, color.b);
  }
  // 标记 position buffer 已改变，renderer 才会把新数据传给 GPU。
  positions.needsUpdate = true;
  // 顶点移动后重新计算法线，使灯光按照新的表面方向产生明暗。
  gridGeometry.computeVertexNormals();
  // 高度改变了 geometry 的范围，因此重新计算包围球。
  gridGeometry.computeBoundingSphere();
  gridGeometry.attributes.color.needsUpdate = true;
  updateReadouts();
  // 数据更新完成后绘制新的 3D 高度图。
  renderThreeGrid();
}

// 这个函数让 WebGL 像素尺寸跟随右侧面板的实际显示尺寸。
function resizeThreeGrid() {
  // 读取 canvas 在 CSS 布局中的当前宽度。
  const width = threeCanvas.clientWidth;
  // 读取 canvas 在 CSS 布局中的当前高度。
  const height = threeCanvas.clientHeight;
  // 如果面板暂时没有尺寸，就不进行无效计算。
  if (width === 0 || height === 0) return;
  // 更新 renderer 的绘图缓冲区，同时保留 CSS 控制的显示尺寸。
  threeRenderer.setSize(width, height, false);
  // 透视相机必须知道画面的宽高比，否则网格会被拉伸。
  threeCamera.aspect = width / height;
  // 修改 aspect 后，通知相机重新计算投影矩阵。
  threeCamera.updateProjectionMatrix();
  // 尺寸更新完成后重新绘制一帧。
  renderThreeGrid();
}

// 当用户拖动或缩放相机时，只在画面发生变化后重新渲染。
threeControls.addEventListener('change', renderThreeGrid);
// ResizeObserver 在面板尺寸变化时调用 resizeThreeGrid。
const threeResizeObserver = new ResizeObserver(resizeThreeGrid);
// 开始观察 canvas，确保桌面和窄屏布局都不会拉伸 3D 画面。
threeResizeObserver.observe(threeCanvas);

function generateMap(reverse = false) {
  return generateNoiseMap(parameters, reverse);
}

function drawMap() {
  const image = context.createImageData(parameters.resolution, parameters.resolution);
  for (let i = 0; i < map.length; i += 1) {
    const shade = Math.round(heightMap[i] * 255);
    const offset = i * 4;
    image.data[offset] = shade;
    image.data[offset + 1] = shade;
    image.data[offset + 2] = shade;
    image.data[offset + 3] = 255;
  }
  const buffer = document.createElement('canvas');
  buffer.width = parameters.resolution;
  buffer.height = parameters.resolution;
  buffer.getContext('2d').putImageData(image, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  checksumReadout.textContent = checksum(heightMap);
}

function positionChunkOutline() {
  const percent = (CHUNK_SIZE / parameters.resolution) * 100;
  chunkOutline.style.width = `${percent}%`;
  chunkOutline.style.height = `${percent}%`;
  chunkOutline.style.left = `${selectedChunk.x * percent}%`;
  chunkOutline.style.top = `${selectedChunk.y * percent}%`;
  chunkReadout.textContent = `${selectedChunk.x}, ${selectedChunk.y}`;
}

function rebuild() {
  mapState.textContent = 'GENERATING';
  // 生成连续 F1 数组和最终 0/1 数组。
  const result = generateMap(false);
  // 保存连续数组，之后 3D 阶段也可以读取相同的采样坐标。
  noiseField = result.noise;
  // 保存二值数组，当前 Canvas 使用它绘制黑白地图。
  map = result.binary;
  heightMap = result.height;
  drawMap();
  // 右侧 3D grid 读取与左侧 Canvas 完全相同的 map。
  applyMapToThreeGrid();
  // 在 2D panel 标题中显示当前 resolution。
  mapSizeReadout.textContent = `2D ${parameters.heightMode === 'Binary terraces' ? 'BINARY' : 'HEIGHT'} / ${parameters.resolution} × ${parameters.resolution}`;
  // resolution 改变时，蓝色 chunk outline 的比例也要更新。
  positionChunkOutline();
  orderResult.textContent = 'NOT RUN';
  mapState.textContent = 'READY';
}

function setSimulationState(running) {
  if (running === simulationRunning) return;
  simulationRunning = running;
  simulationToggle.setAttribute('aria-pressed', String(running));
  simulationToggle.textContent = running ? 'PAUSE SIMULATION' : 'START SIMULATION';
  simulationReadout.textContent = running ? 'RUNNING' : 'PAUSED';
  if (running) {
    lastSimulationTime = performance.now();
    simulationFrame = requestAnimationFrame(runSimulation);
  } else if (simulationFrame) {
    cancelAnimationFrame(simulationFrame);
  }
}

function runSimulation(now) {
  if (!simulationRunning) return;
  const elapsed = (now - lastSimulationTime) / 1000;
  // 生成以 15 Hz 更新，降低多层采样和法线更新的开销。
  if (elapsed < 1 / 15) {
    simulationFrame = requestAnimationFrame(runSimulation);
    return;
  }
  lastSimulationTime = now;
  parameters.worldOffsetX += Math.min(elapsed, 0.2) * parameters.simulationSpeed;
  parameters.worldOffsetY += Math.min(elapsed, 0.2) * parameters.simulationSpeed * 0.35;
  rebuild();
  simulationFrame = requestAnimationFrame(runSimulation);
}

// 只有 resolution 改变时才需要替换 geometry；其他 sliders 不调用这个函数。
function rebuildResolution() {
  // 回到第一个 chunk，避免缩小地图后仍选中不存在的 chunk。
  selectedChunk = { x: 0, y: 0 };
  selectedCell = null;
  cellReadout.textContent = valueReadout.textContent = document.querySelector('#heightReadout').textContent = '—';
  // 创建与新 resolution 顶点数量匹配的 PlaneGeometry。
  rebuildGridGeometry();
  // 重新建立对应长度的 noise arrays，并更新两个视图。
  rebuild();
}

document.querySelector('#reverse').addEventListener('click', () => {
  const forward = generateMap(false);
  const reverse = generateMap(true);
  const passed = checksum(forward.binary) === checksum(reverse.binary)
    && checksum(forward.height) === checksum(reverse.height)
    && checksum(forward.noise) === checksum(reverse.noise);
  noiseField = reverse.noise;
  map = reverse.binary;
  heightMap = reverse.height;
  drawMap();
  // chunk 顺序改变后仍把同一个最终二值数组应用到 3D。
  applyMapToThreeGrid();
  orderResult.textContent = passed ? 'PASS / IDENTICAL' : 'FAIL / MISMATCH';
});

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(parameters.resolution - 1, Math.floor(((event.clientX - rect.left) / rect.width) * parameters.resolution));
  const y = Math.min(parameters.resolution - 1, Math.floor(((event.clientY - rect.top) / rect.height) * parameters.resolution));
  selectedCell = { x, y };
  selectedChunk = { x: Math.floor(x / CHUNK_SIZE), y: Math.floor(y / CHUNK_SIZE) };
  updateReadouts();
  positionChunkOutline();
});

// 创建 lil-gui，并把它放入右侧 inspector 的指定容器。
const gui = new GUI({ container: guiMount, title: 'NOISE / GRID' });
// Noise Scale slider 每次变化只重算 noise，不替换 geometry。
gui.add(parameters, 'seed', 0, 2147483647, 1).name('Seed').onFinishChange(rebuild);
gui.add(parameters, 'scale', 4, 16, 1).name('Noise scale').onFinishChange(rebuild);
gui.add(parameters, 'worldSize', 16, 64, 1).name('World extent').onFinishChange(rebuild);
gui.add(parameters, 'octaves', 1, 4, 1).name('Noise layers').onFinishChange(rebuild);
gui.add(parameters, 'persistence', 0.1, 0.6, 0.05).name('Detail weight').onFinishChange(rebuild);
// 创建独立的 SHAPING folder，把 dropdown 和动态 slider 放在一起。
const shapingFolder = gui.addFolder('BINARY SHAPING');
// 这个变量记录当前显示的 slider，以便切换 operation 时移除它。
let shapingSlider;

// 根据 dropdown 选择创建对应参数的 slider。
function configureShapingSlider() {
  // 如果已经存在 slider，先从 GUI 中安全移除旧 controller。
  if (shapingSlider) shapingSlider.destroy();
  // Threshold 使用普通 cutoff：F1 小于 cutoff 时输出 1。
  if (parameters.shaping === 'Threshold') {
    // 保存新 controller，之后切换模式时可以销毁它。
    shapingSlider = shapingFolder.add(parameters, 'threshold', 0.2, 0.9, 0.01).name('Cutoff');
  // Invert Threshold 使用自己的 cutoff：F1 大于 cutoff 时输出 1。
  } else if (parameters.shaping === 'Invert Threshold') {
    // 独立属性让这个模式记住自己的 slider 数值。
    shapingSlider = shapingFolder.add(parameters, 'invertThreshold', 0.2, 0.9, 0.01).name('Invert cutoff');
  // 剩余选项是 Band，它使用环带宽度而不是 cutoff。
  } else {
    // bandWidth 越大，围绕 F1 = 0.5 的白色环带越厚。
    shapingSlider = shapingFolder.add(parameters, 'bandWidth', 0.02, 0.5, 0.01).name('Band width');
  }
  // 当前 operation 的 slider 变化时，重新生成共享二值 map。
  shapingSlider.onChange(rebuild);
}

// 添加 shaping operation dropdown，并限制为课程要求的三个选项。
shapingFolder
  // add 的数组参数会让 lil-gui 自动使用 dropdown。
  .add(parameters, 'shaping', ['Threshold', 'Invert Threshold', 'Band'])
  // 把 property 名改成更容易阅读的界面标签。
  .name('Operation')
  // 切换选项后替换 slider，并用新 operation 重新生成地图。
  .onChange(() => {
    // 先让界面显示新 operation 对应的参数。
    configureShapingSlider();
    // 再更新 2D 和 3D 两个视图。
    rebuild();
  });
// 页面第一次加载时，为默认 Threshold operation 创建 slider。
configureShapingSlider();
// Grid Height slider 只改变现有顶点高度，不重新计算 noise。
gui.add(parameters, 'gridHeight', 0, 3, 0.1).name('Grid height').onChange(applyMapToThreeGrid);
gui.add(parameters, 'heightMode', ['Layered terrain', 'Binary terraces']).name('Height mode').onChange(rebuild);
gui.add(parameters, 'material', ['Contour', 'Terrain']).name('Material').onChange(applyMapToThreeGrid);
gui.add(parameters, 'simulationSpeed', 0.5, 8, 0.5).name('Scroll speed');
// Resolution slider 使用 16 的倍数，确保地图仍能完整分成 16 × 16 chunks。
gui.add(parameters, 'resolution', 16, 128, 16).name('Resolution').onChange(rebuildResolution);
// actions 对象让 lil-gui 能够把普通函数显示成按钮。
const actions = { regenerate: rebuild };
// 添加手动重新生成按钮，用于重复检查 deterministic 结果。
gui.add(actions, 'regenerate').name('Generate map');

rebuild();
positionChunkOutline();

simulationToggle.addEventListener('click', () => setSimulationState(!simulationRunning));
function toggleWireframe() {
  gridMaterial.wireframe = !gridMaterial.wireframe;
  wireframeToggle.textContent = gridMaterial.wireframe ? 'SOLID SURFACE' : 'SHOW WIREFRAME';
  wireframeToggle.setAttribute('aria-pressed', String(gridMaterial.wireframe));
  renderThreeGrid();
}
wireframeToggle.addEventListener('click', toggleWireframe);

function updateReadouts() {
  const spacing = parameters.worldSize / (parameters.resolution - 1);
  const smallestFeature = parameters.scale / 2 ** (parameters.octaves - 1);
  document.querySelector('#worldReadout').textContent = parameters.worldOffsetX.toFixed(2) + ', ' + parameters.worldOffsetY.toFixed(2);
  document.querySelector('#calibrationReadout').textContent = 'SPACING ' + spacing.toFixed(2) + ' / FEATURE ' + smallestFeature.toFixed(2)
    + (spacing > smallestFeature / 4 ? ' / INCREASE RESOLUTION' : ' / WELL SAMPLED');
  if (!selectedCell) return;
  const { x, y } = selectedCell;
  const index = y * parameters.resolution + x;
  const [wx, wy] = worldCoordinate(x, y, parameters);
  const distance = sampleNoise(wx, wy, parameters);
  const independentHeight = parameters.heightMode === 'Binary terraces'
    ? shapeNoise(distance, parameters) : sampleHeight(wx, wy, parameters);
  const agrees = Math.abs(independentHeight - heightMap[index]) < 1e-6;
  cellReadout.textContent = x + ', ' + y;
  valueReadout.textContent = distance.toFixed(3) + ' / ' + heightMap[index].toFixed(3);
  document.querySelector('#heightReadout').textContent = (heightMap[index] * parameters.gridHeight).toFixed(3)
    + ' / GRAY ' + Math.round(heightMap[index] * 255) + (agrees ? ' / MATCH' : ' / MISMATCH');
}

document.querySelector('#resetWorld').addEventListener('click', () => {
  setSimulationState(false);
  parameters.worldOffsetX = 0;
  parameters.worldOffsetY = 0;
  rebuild();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setSimulationState(false);
});
window.addEventListener('keydown', (event) => {
  // 编辑 inspector 的输入时，快捷键不能接管文字或滑块操作。
  if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'w') { toggleWireframe(); return; }
  if (event.code === 'Space') {
    if (event.target.closest('button') || event.repeat) return;
    event.preventDefault();
    setSimulationState(!simulationRunning);
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const amount = event.shiftKey ? 8 : 2;
  if (event.key === 'ArrowUp') parameters.worldOffsetY -= amount;
  if (event.key === 'ArrowDown') parameters.worldOffsetY += amount;
  if (event.key === 'ArrowLeft') parameters.worldOffsetX -= amount;
  if (event.key === 'ArrowRight') parameters.worldOffsetX += amount;
  rebuild();
});
