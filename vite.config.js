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
      },
    },
  },
});
