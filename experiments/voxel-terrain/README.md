# Voxel Terrain Assignment

The experiment compares Marching Cubes, basic Surface Nets, and Marching Tetrahedra using one finite density field, iso-value zero, chunk layout, SDF convention, material, lights, and camera.

## Shared sampling and measurement

The complete finite world is sampled once into a `Float32Array` with a one-sample halo. Every chunk and algorithm reads this same buffer. The halo supports central-difference normals without private chunk sampling. Sampling and meshing each run once for warm-up and five measured times; the UI reports the median. Mesh timing includes vertex placement and normal generation. Buffer bytes include the shared density field plus position and normal buffers.

## Algorithms

- Marching Cubes reuses Three.js's exported edge and triangle tables and interpolates zero crossings.
- Surface Nets creates one averaged edge-crossing vertex for each active cell. Every sign-changing grid edge owns exactly one quad. Ownership is assigned to one cell and therefore one chunk; neighboring cell vertices are recomputed from the shared field, preventing missing or duplicated boundary faces.
- Marching Tetrahedra uses the same six-tetrahedron split in every cell. This keeps diagonals consistent across adjacent cells and chunks.

All algorithms emit non-indexed triangles. Winding is checked against the shared density gradient, and every final vertex receives a normal from the same trilinearly sampled density buffer.

## Presets

Sphere isolates the basic curved surface. Box Cut subtracts Box B from Sphere A. Chunk Cave joins Sphere A and Box B, then subtracts Sphere C centered on a default chunk boundary.

The experiment remains finite and synchronous. It does not include Dual Contouring, WFC, LOD, an infinite world, or asynchronous generation.
