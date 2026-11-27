// Stub for the two three.js names island29s hydrology.js imports.
// They are only constructed inside buildFreshwaterGeometry (river surface
// meshes for island29s own renderer); the terrain generator kn never calls
// it, so these classes are never instantiated on the generation path.
export class BufferGeometry {
  setAttribute() {}
  dispose() {}
}
export class Float32BufferAttribute {
  constructor( array, itemSize ) { this.array = array; this.itemSize = itemSize; }
}
