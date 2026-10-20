import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        scene: 'scene.html',
        firstGame: 'legacy-game.html',
        portfolio: 'archive/portfolio/index.html',
        cellularNoise: 'experiments/cellular-noise/index.html',
        voxelTerrain: 'experiments/voxel-terrain/index.html',
        shaderBasics: 'experiments/shader-basics/index.html',
        pcgTerrain: 'experiments/pcg-terrain/index.html',
        flavorClashPrototype: 'experiments/flavor-clash-prototype/index.html',
        icelandRegion: 'experiments/iceland-region/index.html',
        roadProjection: 'experiments/road-projection/index.html',
        roadMesh: 'experiments/road-mesh/index.html',
        terrainSeam: 'experiments/terrain-seam/index.html',
        manhattanTerrainGreybox: 'experiments/manhattan-terrain-greybox/index.html',
        seedTerrain: 'experiments/seed-terrain/index.html',
        worldGrid: 'experiments/world-grid/index.html',
      },
    },
  },
});
