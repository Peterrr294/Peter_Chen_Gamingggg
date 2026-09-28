import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';

const C = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const E = [[0,1],[1,2],[3,2],[0,3],[4,5],[5,6],[7,6],[4,7],[0,4],[1,5],[2,6],[3,7]];
const TETRAHEDRA = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const TET_EDGES = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];

const interpolate = (a, b, va, vb) => { const d = vb - va; const t = Math.abs(d) < 1e-12 ? .5 : -va / d; return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t }; };
function outputBuilder(field) {
  const positions = [], normals = [];
  function triangle(a, b, c) {
    const ab={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z}, ac={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
    const face={x:ab.y*ac.z-ab.z*ac.y,y:ab.z*ac.x-ab.x*ac.z,z:ab.x*ac.y-ab.y*ac.x};
    const center={x:(a.x+b.x+c.x)/3,y:(a.y+b.y+c.y)/3,z:(a.z+b.z+c.z)/3}; const outward=field.normalAt(center);
    if(face.x*outward.x+face.y*outward.y+face.z*outward.z<0)[b,c]=[c,b];
    for(const p of [a,b,c]){const n=field.normalAt(p);positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);}
  }
  return { triangle, finish:()=>({positions:new Float32Array(positions),normals:new Float32Array(normals),vertexCount:positions.length/3,triangleCount:positions.length/9,bufferBytes:(positions.length+normals.length)*4}) };
}
const cellCorners=(field,x,y,z)=>C.map(([dx,dy,dz])=>({point:field.position(x+dx,y+dy,z+dz),value:field.get(x+dx,y+dy,z+dz)}));

export function marchingCubes(field, chunk) {
  const out=outputBuilder(field), edgeVertices=new Array(12);
  for(let z=chunk.z0;z<chunk.z1;z+=1)for(let y=chunk.y0;y<chunk.y1;y+=1)for(let x=chunk.x0;x<chunk.x1;x+=1){
    const corners=cellCorners(field,x,y,z);let cube=0;for(let i=0;i<8;i+=1)if(corners[i].value<0)cube|=1<<i;
    const mask=edgeTable[cube];if(!mask)continue;
    for(let edge=0;edge<12;edge+=1)if(mask&(1<<edge)){const[a,b]=E[edge];edgeVertices[edge]=interpolate(corners[a].point,corners[b].point,corners[a].value,corners[b].value);}
    const offset=cube*16;for(let i=0;triTable[offset+i]!==-1;i+=3)out.triangle(edgeVertices[triTable[offset+i]],edgeVertices[triTable[offset+i+1]],edgeVertices[triTable[offset+i+2]]);
  }
  return out.finish();
}

export function marchingTetrahedra(field, chunk) {
  const out=outputBuilder(field);
  for(let z=chunk.z0;z<chunk.z1;z+=1)for(let y=chunk.y0;y<chunk.y1;y+=1)for(let x=chunk.x0;x<chunk.x1;x+=1){
    const corners=cellCorners(field,x,y,z);
    for(const tetra of TETRAHEDRA){const crossings=[];for(const[ta,tb]of TET_EDGES){const a=tetra[ta],b=tetra[tb];if((corners[a].value<0)!==(corners[b].value<0))crossings.push(interpolate(corners[a].point,corners[b].point,corners[a].value,corners[b].value));}
      if(crossings.length<3)continue;const center=crossings.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y,z:s.z+p.z}),{x:0,y:0,z:0});center.x/=crossings.length;center.y/=crossings.length;center.z/=crossings.length;
      const n=field.normalAt(center),helper=Math.abs(n.x)<.8?{x:1,y:0,z:0}:{x:0,y:1,z:0};const ux=n.y*helper.z-n.z*helper.y,uy=n.z*helper.x-n.x*helper.z,uz=n.x*helper.y-n.y*helper.x;const ul=Math.hypot(ux,uy,uz)||1;const u={x:ux/ul,y:uy/ul,z:uz/ul},v={x:n.y*u.z-n.z*u.y,y:n.z*u.x-n.x*u.z,z:n.x*u.y-n.y*u.x};
      crossings.sort((a,b)=>Math.atan2((a.x-center.x)*v.x+(a.y-center.y)*v.y+(a.z-center.z)*v.z,(a.x-center.x)*u.x+(a.y-center.y)*u.y+(a.z-center.z)*u.z)-Math.atan2((b.x-center.x)*v.x+(b.y-center.y)*v.y+(b.z-center.z)*v.z,(b.x-center.x)*u.x+(b.y-center.y)*u.y+(b.z-center.z)*u.z));
      for(let i=1;i<crossings.length-1;i+=1)out.triangle(crossings[0],crossings[i],crossings[i+1]);
    }
  }
  return out.finish();
}

export function surfaceNets(field, chunk) {
  const out=outputBuilder(field),cache=new Map(),key=(x,y,z)=>`${x},${y},${z}`;
  function vertex(x,y,z){if(x<0||y<0||z<0||x>=field.totalCells||y>=field.totalCells||z>=field.totalCells)return null;const k=key(x,y,z);if(cache.has(k))return cache.get(k);const corners=cellCorners(field,x,y,z),points=[];for(const[a,b]of E)if((corners[a].value<0)!==(corners[b].value<0))points.push(interpolate(corners[a].point,corners[b].point,corners[a].value,corners[b].value));const result=points.length?points.reduce((s,p)=>({x:s.x+p.x/points.length,y:s.y+p.y/points.length,z:s.z+p.z/points.length}),{x:0,y:0,z:0}):null;cache.set(k,result);return result;}
  const owned=(x,y,z)=>x>=chunk.x0&&x<chunk.x1&&y>=chunk.y0&&y<chunk.y1&&z>=chunk.z0&&z<chunk.z1;
  function quad(cells){const points=cells.map(c=>vertex(...c));if(points.some(p=>!p))return;out.triangle(points[0],points[1],points[2]);out.triangle(points[0],points[2],points[3]);}
  const N=field.totalCells;
  for(let z=1;z<N;z+=1)for(let y=1;y<N;y+=1)for(let x=0;x<N;x+=1)if(owned(x,y-1,z-1)&&(field.get(x,y,z)<0)!==(field.get(x+1,y,z)<0))quad([[x,y-1,z-1],[x,y,z-1],[x,y,z],[x,y-1,z]]);
  for(let z=1;z<N;z+=1)for(let y=0;y<N;y+=1)for(let x=1;x<N;x+=1)if(owned(x-1,y,z-1)&&(field.get(x,y,z)<0)!==(field.get(x,y+1,z)<0))quad([[x-1,y,z-1],[x-1,y,z],[x,y,z],[x,y,z-1]]);
  for(let z=0;z<N;z+=1)for(let y=1;y<N;y+=1)for(let x=1;x<N;x+=1)if(owned(x-1,y-1,z)&&(field.get(x,y,z)<0)!==(field.get(x,y,z+1)<0))quad([[x-1,y-1,z],[x,y-1,z],[x,y,z],[x-1,y,z]]);
  return out.finish();
}

export const meshAlgorithms={MarchingCubes:marchingCubes,SurfaceNets:surfaceNets,MarchingTetrahedra:marchingTetrahedra};
