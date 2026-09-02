import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import SceneObjects from './components/SceneObjects.jsx';

function GroundGrid() {
  return (
    // Drei's Grid lies on the XZ plane and fades into the distance.
    <Grid
      position={[0, 0, 0]}
      args={[30, 30]}
      cellSize={0.5}
      cellThickness={0.6}
      cellColor="#606060"
      sectionSize={2.5}
      sectionThickness={1.1}
      sectionColor="#909090"
      fadeDistance={22}
      fadeStrength={1.5}
      infiniteGrid
    />
  );
}

export default function App() {
  return (
    // Canvas creates the renderer, scene, and perspective camera for us.
    <Canvas camera={{ position: [7, 6, 9], fov: 48 }}>
      <color attach="background" args={['#292929']} />

      {/* Standard materials need light in order to be visible. */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 4]} intensity={2.2} />

      <SceneObjects />
      <GroundGrid />

      {/* OrbitControls enables rotate, zoom, and pan with the mouse. */}
      <OrbitControls makeDefault target={[0, 0.75, 0]} />
    </Canvas>
  );
}
