export default function SceneObjects() {
  return (
    <group>
      {/* A mesh combines geometry (shape) with a material (surface). */}
      <mesh position={[-2.4, 0.75, 0]}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshStandardMaterial color="#e76f51" />
      </mesh>

      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.9, 32, 24]} />
        <meshStandardMaterial color="#2a9d8f" />
      </mesh>

      <mesh position={[2.4, 0.9, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 1.8, 32]} />
        <meshStandardMaterial color="#e9c46a" />
      </mesh>
    </group>
  );
}
