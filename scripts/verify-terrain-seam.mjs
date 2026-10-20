import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4180;
const base = `http://${host}:${port}`;
const pageUrl = `${base}/experiments/terrain-seam/`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

async function findBrowser() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found. Set PLAYWRIGHT_CHROME_PATH.');
}

async function startServer() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(pageUrl)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await findBrowser(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));

  await page.goto(`${base}/experiments/flavor-clash-prototype/`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="../terrain-seam/"]').count() === 1, 'Flavor Clash Terrain Seam child entry is missing.');
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__terrainSeamLab?.ready === true);

  const result = await page.evaluate(() => {
    const api = window.__terrainSeamLab;
    const snapshot = api.snapshot();
    const leftTerrain = api.left.result.terrain;
    const rightTerrain = api.right.result.terrain;
    const offSeamZ = 2.75;
    return {
      snapshot,
      separateMeshes: leftTerrain.mesh !== rightTerrain.mesh,
      separateGeometries: leftTerrain.mesh.geometry !== rightTerrain.mesh.geometry,
      separateMaterials: leftTerrain.mesh.material !== rightTerrain.mesh.material,
      differentProfiles: api.configs.venice.heightProfile !== api.configs.japan.heightProfile,
      offSeamDifference: Math.abs(leftTerrain.heightAt(-6, offSeamZ) - rightTerrain.heightAt(6, offSeamZ)),
      seamLineType: api.seamDebug.object3D.getObjectByName('Noise displaced biome boundary')?.type,
      seamPointCount: api.seamDebug.object3D.getObjectByName('Shared geometric edge vertices')?.geometry.attributes.position.count,
      transitionZoneType: api.seamDebug.object3D.getObjectByName('Transition zone')?.type,
      visibleUnrelatedLayers: [api.left, api.right].some(({ result: item }) => item.roads.object3D.visible || item.mainRoute.object3D.visible || item.decorations.object3D.visible),
      buildingLayers: [api.left, api.right].map(({ result }, index) => ({
        terrainBound: result.buildings.terrainMesh === result.terrain.mesh
          && result.buildings.surfaceQuery.terrain === result.terrain,
        attachedToRegion: result.buildings.object3D.parent === result.object3D,
        visible: result.buildings.object3D.visible && result.object3D.visible,
        sharedYaw: result.buildings.accepted.every(item => Math.abs(item.yaw - result.buildings.zoneYaw) <= 1e-12),
        fixedHorizontalYaw: result.buildings.zoneYaw === 0,
        roofOverhangRatio: result.buildings.roofOverhangRatio,
        gridAligned: result.buildings.accepted.every(item => {
          const axis = result.buildings.axisYaw;
          const u = Math.cos(axis) * (item.x - result.terrain.mesh.position.x) + Math.sin(axis) * (item.z - result.terrain.mesh.position.z);
          const v = -Math.sin(axis) * (item.x - result.terrain.mesh.position.x) + Math.cos(axis) * (item.z - result.terrain.mesh.position.z);
          const spacing = result.buildings.gridSpacing;
          const start = result.buildings.gridStart;
          return Math.abs((u - start.u) / spacing - Math.round((u - start.u) / spacing)) <= 1e-6
            && Math.abs((v - start.v) / spacing - Math.round((v - start.v) / spacing)) <= 1e-6;
        }),
        steepRejected: result.buildings.accepted.every(item => result.buildings.surfaceQuery.querySurface(item.x, item.z).slope < result.buildings.maxSlope),
        uprightUniform: [result.buildings.bodyMesh, result.buildings.roofMesh].every(mesh => {
          const values = mesh.instanceMatrix.array;
          for (let index = 0; index < mesh.count; index += 1) {
            const offset = index * 16;
            const sx = Math.hypot(values[offset], values[offset + 1], values[offset + 2]);
            const sy = Math.hypot(values[offset + 4], values[offset + 5], values[offset + 6]);
            const sz = Math.hypot(values[offset + 8], values[offset + 9], values[offset + 10]);
            if (Math.abs(sx - sy) > 1e-6 || Math.abs(sy - sz) > 1e-6 || Math.abs(values[offset + 1]) > 1e-6 || Math.abs(values[offset + 9]) > 1e-6) return false;
          }
          return true;
        }),
        validSurface: result.buildings.accepted.every(item => {
          const sample = result.buildings.surfaceQuery.querySurface(item.x, item.z);
          return sample && sample.waterMask < 0.5
            && sample.slope < result.buildings.maxSlope
            && sample.buildability >= result.buildings.buildabilityThreshold
            && Math.abs(sample.buildability - item.buildability) <= 1e-12
            && Math.abs(sample.height - item.y) <= 1e-12;
        }),
        withinPinnedBounds: result.buildings.accepted.every(item => {
          const bounds = index === 0 ? api.configs.venice.buildingBounds : api.configs.japan.buildingBounds;
          return item.x >= bounds.minX && item.x <= bounds.maxX && item.z >= bounds.minZ && item.z <= bounds.maxZ;
        }),
      })),
    };
  });

  const s = result.snapshot;
  assert(s.leftBoundary === s.rightBoundary && s.leftBoundary === 0, 'Zone boundaries do not share the same world-space coordinate.');
  assert(s.leftDimensions.width === 54 && s.leftDimensions.depth === 54 && s.leftDimensions.resolution === 120
    && s.rightDimensions.width === 54 && s.rightDimensions.depth === 54 && s.rightDimensions.resolution === 120, 'Expanded zone bounds or terrain resolution are incorrect.');
  assert(s.leftSpacing === s.rightSpacing && s.leftSpacing === 0.45, 'Zone vertex spacing does not match.');
  assert(s.leftSeed !== s.rightSeed, 'Zone seeds are not independent.');
  assert(s.leftMaterial !== s.rightMaterial && result.separateMaterials, 'Zone materials are not independent.');
  assert(result.separateMeshes && result.separateGeometries, 'Zones do not use separate meshes and geometries.');
  assert(result.differentProfiles && result.offSeamDifference > 0.01, 'Separate height profiles are not observable away from the seam.');
  assert(s.maxHeightError <= 1e-12 && s.meanHeightError <= 1e-12, `Seam height mismatch is ${s.maxHeightError}.`);
  assert(s.seamSamples === 121 && result.seamPointCount === 121, 'Seam does not compare every matching boundary vertex.');
  assert(result.seamLineType === 'Line' && result.transitionZoneType === 'Mesh', 'Transition-zone debug visualization is missing.');
  assert(s.boundaryIrregularity === 1.1 && s.transitionWidth === 6, 'Conservative transition defaults changed unexpectedly.');
  assert(s.boundaryMax - s.boundaryMin > 0.1 && s.boundaryMax - s.boundaryMin <= s.boundaryIrregularity * 2, 'Biome boundary is not smoothly noise-displaced within its configured range.');
  assert(!result.visibleUnrelatedLayers, 'Road, route, or scatter layers are visible in the focused seam prototype.');
  assert(s.leftBuildings > 0 && s.rightBuildings > 0, 'Boundary building layers did not generate on both zones.');
  assert(s.japanGlbMeshes > 0 && Number.isFinite(s.japanGlbUniformScale) && s.japanGlbUniformScale > 0, 'Japan GLB test asset was not loaded or normalized.');
  assert(s.japanGlbCacheSize === 9, 'Asset cache did not retain Tiny Tokyo plus the eight active GLB sources.');
  assert(Array.isArray(s.japanStandaloneReplacement) && s.japanStandaloneReplacement.length >= 2, 'The standalone GLB did not reserve a multi-cell Japan span.');
  assert(s.japanStandaloneCount === 8 && s.japanStandaloneAssetIds.every(id => id.startsWith('glb-') && !['glb-01', 'glb-02', 'glb-03'].includes(id)), 'The Japan GLB pool should place the remaining eight assets.');
  assert(s.japanAssetAudit.length === 8 && s.japanAssetAudit.filter(asset => asset.status === 'loaded').length === 8 && s.japanAssetAudit.filter(asset => asset.spawned).length === 8, 'GLB removal/load/spawn audit is incomplete.');
  assert(s.japanGlbInventory.meshCount === s.japanGlbMeshes && s.japanGlbInventory.materialCount > 0 && s.japanGlbInventory.worldBounds.max[1] > s.japanGlbInventory.worldBounds.min[1] && s.japanGlbInventory.separableBuildings === false, 'GLB inventory or segmentation assessment is invalid.');
  assert(s.leftValidGridCells > 0 && s.rightValidGridCells > 0 && s.leftBuildings <= s.leftValidGridCells && s.rightBuildings <= s.rightValidGridCells, 'Grid coverage metadata is invalid.');
  assert(s.leftBuildingCoverage > 0 && s.rightBuildingCoverage > 0 && s.leftBuildingCoverage <= 1 && s.rightBuildingCoverage <= 1, 'Building coverage ratios are invalid.');
  assert(s.leftBuildingSeed !== s.rightBuildingSeed, 'Building layer seeds are not independent.');
  assert(result.buildingLayers.every(layer => layer.terrainBound && layer.attachedToRegion && layer.visible && layer.validSurface && layer.withinPinnedBounds && layer.sharedYaw && layer.fixedHorizontalYaw && layer.gridAligned && layer.steepRejected && layer.uprightUniform && layer.roofOverhangRatio >= 0.05 && layer.roofOverhangRatio <= 0.1), 'A building layer is not bound, attached, visible, grid-aligned, within its pinned bounds, roof-proportioned, fixed-horizontal, slope-safe, yaw-consistent, upright, uniform, or aligned with its own terrain surface.');

  await page.goto(`${pageUrl}?irregularity=1.8&width=8&veniceSeed=3101&veniceDensity=0.2&japanSeed=3202&japanDensity=0.6&veniceSpacing=1.4&japanSpacing=1.8`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__terrainSeamLab?.ready === true);
  const custom = await page.evaluate(() => window.__terrainSeamLab.snapshot());
  assert(custom.boundaryIrregularity === 1.8 && custom.transitionWidth === 8, 'Configurable transition parameters were not applied.');
  assert(custom.leftBuildingSeed === 3101 && custom.rightBuildingSeed === 3202 && custom.leftBuildingDensity === 0.2 && custom.rightBuildingDensity === 0.6, 'Independent building seed or density controls were not applied.');
  assert(custom.leftBuildingYaw === 0 && custom.rightBuildingYaw === 0, 'Building yaw is not fixed horizontally.');
  assert(custom.leftBuildingGridSpacing === 1.4 && custom.rightBuildingGridSpacing === 1.8, 'Independent grid spacing controls were not applied.');
  assert(custom.maxHeightError <= 1e-12, `Custom transition created a seam error of ${custom.maxHeightError}.`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `Mobile layout overflows horizontally by ${overflow}px.`);
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);

  console.log(JSON.stringify({ pageUrl, ...s, customParameters: { boundaryIrregularity: custom.boundaryIrregularity, transitionWidth: custom.transitionWidth, maxHeightError: custom.maxHeightError }, separateMeshes: true, separateSeeds: true, separateProfiles: true, separateMaterials: true, browserErrors: errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
