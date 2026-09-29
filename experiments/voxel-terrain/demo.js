import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createShape, evaluateSequence } from './sdf.js';
import { createDensityField } from './density-field.js';
import { meshAlgorithms } from './mesh-algorithms.js';
import { compareChunkSeam } from './marching-cubes.js';
import { compareSharedVertices } from './mesh-audit.js';
import { onAuthStateChanged } from 'firebase/auth';
import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../src/firebase.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#voxelCanvas'),scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);
const camera=new THREE.PerspectiveCamera(45,1,.1,300);camera.position.set(22,18,25);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
const controls=new OrbitControls(camera,canvas);controls.target.set(0,0,0);controls.enableDamping=true;

const parameters={algorithm:'Marching Cubes',chunkCount:3,cellsPerChunk:12,spacing:.5,showChunkBounds:true,wireframe:false,
  sphereRadius:5,sphereX:-1,sphereY:0,sphereZ:0,boxX:3,boxY:0,boxZ:0,boxWidth:7,boxHeight:6,boxDepth:6,
  cutterRadius:2.5,cutterX:3,cutterY:0,cutterZ:0,smoothing:.8};
const algorithmIds={'Marching Cubes':'MarchingCubes','Surface Nets':'SurfaceNets','Marching Tetrahedra':'MarchingTetrahedra'};
const operationLabels={union:'Union',intersect:'Intersect',subtract:'Subtract',smoothUnion:'Smooth union'},shapeLabels={boxB:'Box B',cutterC:'Sphere C'};
let operations=[{type:'union',shapeId:'boxB'},{type:'subtract',shapeId:'cutterC'}];
const chunks=new Map();let gui,currentUser=null;
const savedConfigurations=new Map();

function makeShapes(){return{sphereA:createShape('sphere',{position:{x:parameters.sphereX,y:parameters.sphereY,z:parameters.sphereZ},radius:parameters.sphereRadius}),boxB:createShape('box',{position:{x:parameters.boxX,y:parameters.boxY,z:parameters.boxZ},size:{x:parameters.boxWidth/2,y:parameters.boxHeight/2,z:parameters.boxDepth/2}}),cutterC:createShape('sphere',{position:{x:parameters.cutterX,y:parameters.cutterY,z:parameters.cutterZ},radius:parameters.cutterRadius})};}
const activeOperations=()=>operations.slice(0,Number($('#stepRange').value)).map(step=>({...step,smoothing:parameters.smoothing}));
const chunkKey=(x,y,z)=>`${x},${y},${z}`;
function descriptors(){const list=[],c=parameters.cellsPerChunk;for(let z=0;z<parameters.chunkCount;z+=1)for(let y=0;y<parameters.chunkCount;y+=1)for(let x=0;x<parameters.chunkCount;x+=1)list.push({x,y,z,key:chunkKey(x,y,z),x0:x*c,y0:y*c,z0:z*c,x1:(x+1)*c,y1:(y+1)*c,z1:(z+1)*c});return list;}
function disposeMaterial(material){if(Array.isArray(material))material.forEach(item=>item.dispose());else material.dispose();}
function clearChunks(){for(const chunk of chunks.values()){scene.remove(chunk.mesh,chunk.helper);chunk.mesh.geometry.dispose();disposeMaterial(chunk.mesh.material);chunk.helper.geometry.dispose();disposeMaterial(chunk.helper.material);}chunks.clear();}
function median(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];}
function benchmark(factory,runs=5){factory();const times=[];let value;for(let i=0;i<runs;i+=1){const start=performance.now();value=factory();times.push(performance.now()-start);}return{value,time:median(times)};}

function meshAll(field,algorithm,items){return items.map(descriptor=>({descriptor,data:algorithm(field,descriptor)}));}
function createChunkObjects(results,worldMin,chunkWorldSize){
  for(const {descriptor,data} of results){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({color:0xf2f2f4,roughness:.72,metalness:0,side:THREE.FrontSide,wireframe:parameters.wireframe});const mesh=new THREE.Mesh(geometry,material);
    const min={x:worldMin+descriptor.x*chunkWorldSize,y:worldMin+descriptor.y*chunkWorldSize,z:worldMin+descriptor.z*chunkWorldSize};const max={x:min.x+chunkWorldSize,y:min.y+chunkWorldSize,z:min.z+chunkWorldSize};
    const helper=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(min.x,min.y,min.z),new THREE.Vector3(max.x,max.y,max.z)),0x1748d4);helper.visible=parameters.showChunkBounds;scene.add(mesh,helper);chunks.set(descriptor.key,{...descriptor,mesh,helper,data});}
}
function auditSeams(chunkWorldSize,worldMin){let matches=0,maxNormalDelta=0;const axes=[['x',1,0,0],['y',0,1,0],['z',0,0,1]],surfaceNets=parameters.algorithm==='Surface Nets';
  for(const chunk of chunks.values())for(const[axis,dx,dy,dz]of axes){const neighbor=chunks.get(chunkKey(chunk.x+dx,chunk.y+dy,chunk.z+dz));if(!neighbor)continue;const coordinate=worldMin+(chunk[axis]+1)*chunkWorldSize;const result=surfaceNets?compareSharedVertices(chunk.data,neighbor.data):compareChunkSeam(chunk.data,neighbor.data,axis,coordinate);matches+=result.matches;maxNormalDelta=Math.max(maxNormalDelta,result.maxNormalDelta);}return{matches,maxNormalDelta};}

function generateWorld(){const button=$('#generateButton');button.disabled=true;button.textContent='MEASURING 5 RUNS…';
  const shapes=makeShapes(),sequence=activeOperations(),sample=point=>evaluateSequence(point,shapes,'sphereA',sequence);const totalCells=parameters.chunkCount*parameters.cellsPerChunk,worldSize=totalCells*parameters.spacing,worldMin=-worldSize/2,items=descriptors();
  const sampled=benchmark(()=>createDensityField({worldMin,totalCells,spacing:parameters.spacing,sample}));const field=sampled.value;clearChunks();
  const algorithm=meshAlgorithms[algorithmIds[parameters.algorithm]];const meshed=benchmark(()=>meshAll(field,algorithm,items));createChunkObjects(meshed.value,worldMin,parameters.cellsPerChunk*parameters.spacing);
  const totals=meshed.value.reduce((sum,item)=>({vertices:sum.vertices+item.data.vertexCount,triangles:sum.triangles+item.data.triangleCount,bytes:sum.bytes+item.data.bufferBytes}),{vertices:0,triangles:0,bytes:field.values.byteLength});const seams=auditSeams(parameters.cellsPerChunk*parameters.spacing,worldMin);
  $('#chunkCount').textContent=String(chunks.size);$('#sampleTime').textContent=`${sampled.time.toFixed(1)} ms`;$('#meshTime').textContent=`${meshed.time.toFixed(1)} ms`;$('#vertexCount').textContent=totals.vertices.toLocaleString();$('#triangleCount').textContent=totals.triangles.toLocaleString();$('#bufferBytes').textContent=totals.bytes<1048576?`${(totals.bytes/1024).toFixed(1)} KiB`:`${(totals.bytes/1048576).toFixed(2)} MiB`;
  $('#seamReadout').textContent=seams.matches>0&&seams.maxNormalDelta<1e-5?`PASS / ${seams.matches}`:seams.matches===0?'NO CROSSING':`CHECK / Δ ${seams.maxNormalDelta.toFixed(4)}`;$('#worldReadout').textContent=`${parameters.algorithm.toUpperCase()} · ${worldSize.toFixed(1)}³`;camera.far=Math.max(100,worldSize*8);camera.updateProjectionMatrix();markReady();}
function markDirty(){const button=$('#generateButton');button.disabled=false;button.textContent=chunks.size?'REGENERATE / BENCHMARK':'GENERATE / BENCHMARK';button.classList.add('dirty');}
function markReady(){const button=$('#generateButton');button.disabled=false;button.textContent='REGENERATE / BENCHMARK';button.classList.remove('dirty');}

function updateStepControl(showFinal=false){const range=$('#stepRange');range.max=operations.length;if(showFinal||Number(range.value)>operations.length)range.value=operations.length;const step=Number(range.value);$('#operationReadout').textContent=step===0?'INITIAL / SPHERE A':`AFTER STEP ${step}`;$('#stepReadout').textContent=step===0?`0 / ${operations.length} · INITIAL`:`${step} / ${operations.length} · ${operationLabels[operations[step-1].type]}`;}
function option(value,label,selected){const item=document.createElement('option');item.value=value;item.textContent=label;item.selected=value===selected;return item;}
function renderOperationList(){const list=$('#operationList');list.replaceChildren();operations.forEach((step,index)=>{const row=document.createElement('div');row.className='operation-row';const number=document.createElement('span');number.textContent=String(index+1).padStart(2,'0');const type=document.createElement('select');Object.entries(operationLabels).forEach(([v,l])=>type.append(option(v,l,step.type)));type.addEventListener('change',()=>{step.type=type.value;markDirty();});const shape=document.createElement('select');Object.entries(shapeLabels).forEach(([v,l])=>shape.append(option(v,l,step.shapeId)));shape.addEventListener('change',()=>{step.shapeId=shape.value;markDirty();});const up=document.createElement('button');up.textContent='↑';up.disabled=index===0;up.addEventListener('click',()=>moveStep(index,index-1));const down=document.createElement('button');down.textContent='↓';down.disabled=index===operations.length-1;down.addEventListener('click',()=>moveStep(index,index+1));const remove=document.createElement('button');remove.textContent='×';remove.addEventListener('click',()=>{operations.splice(index,1);refreshSequence(true);});row.append(number,type,shape,up,down,remove);list.append(row);});}
function moveStep(from,to){if(to<0||to>=operations.length)return;const[step]=operations.splice(from,1);operations.splice(to,0,step);refreshSequence(true);}function refreshSequence(final=false){updateStepControl(final);renderOperationList();markDirty();}
function updateGui(){gui.controllersRecursive().forEach(controller=>controller.updateDisplay());}
function loadPreset(name){if(name==='sphere'){Object.assign(parameters,{sphereRadius:5,sphereX:0,sphereY:0,sphereZ:0});operations=[];}else if(name==='boxCut'){Object.assign(parameters,{sphereRadius:5,sphereX:0,boxX:3,boxY:0,boxZ:0,boxWidth:5,boxHeight:8,boxDepth:5});operations=[{type:'subtract',shapeId:'boxB'}];}else{Object.assign(parameters,{sphereRadius:5,sphereX:-1,boxX:3,boxY:0,boxZ:0,boxWidth:7,boxHeight:6,boxDepth:6,cutterRadius:2.5,cutterX:3,cutterY:0,cutterZ:0});operations=[{type:'union',shapeId:'boxB'},{type:'subtract',shapeId:'cutterC'}];}updateGui();refreshSequence(true);}

const configName=$('#configName'),configSelect=$('#configSelect'),saveConfigButton=$('#saveConfig'),loadConfigButton=$('#loadConfig'),refreshConfigsButton=$('#refreshConfigs'),exportConfigButton=$('#exportConfig'),importConfigInput=$('#importConfig'),cloudStatus=$('#cloudStatus');
function setCloudStatus(message,isError=false){cloudStatus.textContent=message;cloudStatus.classList.toggle('error',isError);}
function setCloudControls(enabled){configName.disabled=!enabled;saveConfigButton.disabled=!enabled;refreshConfigsButton.disabled=!enabled;configSelect.disabled=!enabled;loadConfigButton.disabled=!enabled||!configSelect.value;}
function serializeConfiguration(){return{schemaVersion:1,parameters:{...parameters},operations:operations.map(step=>({type:step.type,shapeId:step.shapeId}))};}
function applyConfiguration(configuration){
  if(!configuration?.parameters||!Array.isArray(configuration.operations))throw new Error('Invalid configuration data');
  for(const key of Object.keys(parameters)){const value=configuration.parameters[key];if(typeof value===typeof parameters[key])parameters[key]=value;}
  const validTypes=new Set(Object.keys(operationLabels)),validShapes=new Set(Object.keys(shapeLabels));
  operations=configuration.operations.filter(step=>validTypes.has(step.type)&&validShapes.has(step.shapeId)).map(step=>({type:step.type,shapeId:step.shapeId}));
  updateGui();refreshSequence(true);generateWorld();
}
async function refreshCloudConfigs(){
  savedConfigurations.clear();configSelect.replaceChildren(option('','Choose a saved configuration…',''));
  if(!currentUser){setCloudControls(false);return;}
  setCloudStatus('Loading your configurations…');setCloudControls(false);
  try{
    const snapshot=await getDocs(collection(db,'users',currentUser.uid,'terrainConfigs'));
    const documents=snapshot.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>(b.updatedAt?.toMillis?.()||0)-(a.updatedAt?.toMillis?.()||0));
    for(const configuration of documents){savedConfigurations.set(configuration.id,configuration);configSelect.append(option(configuration.id,configuration.name||'Untitled configuration',''));}
    setCloudStatus(documents.length?`${documents.length} configuration${documents.length===1?'':'s'} saved for ${currentUser.displayName||currentUser.email}.`:'No saved configurations yet.');
  }catch(error){console.error('Could not load Firestore configurations:',error);setCloudStatus(`Load failed: ${error.code||error.message}`,true);}
  finally{setCloudControls(true);}
}
async function saveCloudConfig(){
  const name=configName.value.trim();if(!currentUser){setCloudStatus('Sign in from the Game Lab header first.',true);return;}if(!name){setCloudStatus('Enter a configuration name first.',true);configName.focus();return;}
  saveConfigButton.disabled=true;setCloudStatus('Saving configuration…');
  try{await addDoc(collection(db,'users',currentUser.uid,'terrainConfigs'),{name:name.slice(0,60),...serializeConfiguration(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});configName.value='';await refreshCloudConfigs();setCloudStatus('Configuration saved to your account.');}
  catch(error){console.error('Could not save Firestore configuration:',error);setCloudStatus(`Save failed: ${error.code||error.message}`,true);saveConfigButton.disabled=false;}
}
function loadCloudConfig(){const configuration=savedConfigurations.get(configSelect.value);if(!configuration){setCloudStatus('Choose a saved configuration first.',true);return;}try{applyConfiguration(configuration);setCloudStatus(`Loaded “${configuration.name||'Untitled configuration'}”.`);}catch(error){console.error(error);setCloudStatus('This configuration is invalid and could not be loaded.',true);}}
function exportJsonConfig(){
  const name=configName.value.trim()||'terrain-configuration',payload={name,exportedAt:new Date().toISOString(),...serializeConfiguration()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=`${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'terrain-configuration'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);setCloudStatus('Configuration exported as a local JSON file.');
}
async function importJsonConfig(event){
  const[file]=event.target.files;if(!file)return;
  try{const configuration=JSON.parse(await file.text());applyConfiguration(configuration);if(typeof configuration.name==='string')configName.value=configuration.name.slice(0,60);setCloudStatus(`Imported “${configuration.name||file.name}” from JSON.`);}
  catch(error){console.error('Could not import configuration:',error);setCloudStatus('Import failed: choose a valid terrain configuration JSON file.',true);}
  finally{event.target.value='';}
}

onAuthStateChanged(auth,user=>{currentUser=user;if(user){setCloudStatus(`Signed in as ${user.displayName||user.email}.`);refreshCloudConfigs();}else{configSelect.replaceChildren(option('','Sign in to view configurations',''));setCloudStatus('Sign in from the Game Lab header to save configurations.');setCloudControls(false);}});
saveConfigButton.addEventListener('click',saveCloudConfig);loadConfigButton.addEventListener('click',loadCloudConfig);refreshConfigsButton.addEventListener('click',refreshCloudConfigs);configSelect.addEventListener('change',()=>{loadConfigButton.disabled=!currentUser||!configSelect.value;});
exportConfigButton.addEventListener('click',exportJsonConfig);importConfigInput.addEventListener('change',importJsonConfig);

$('#generateButton').addEventListener('click',generateWorld);$('#presetSphere').addEventListener('click',()=>loadPreset('sphere'));$('#presetBoxCut').addEventListener('click',()=>loadPreset('boxCut'));$('#presetCave').addEventListener('click',()=>loadPreset('cave'));$('#addOperation').addEventListener('click',()=>{operations.push({type:'union',shapeId:'boxB'});refreshSequence(true);});$('#stepRange').addEventListener('input',()=>{updateStepControl();markDirty();});
scene.add(new THREE.HemisphereLight(0xffffff,0x172044,2.2));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(12,20,15);scene.add(light);
gui=new GUI({container:$('#guiMount'),title:'ALGORITHM / SHAPES'});const generation=gui.addFolder('Generation');generation.add(parameters,'algorithm',Object.keys(algorithmIds)).name('Algorithm').onChange(markDirty);generation.add(parameters,'chunkCount',[1,2,3,4]).name('Chunks / axis').onChange(markDirty);generation.add(parameters,'cellsPerChunk',[8,12,16]).name('Cells / chunk').onChange(markDirty);generation.add(parameters,'spacing',[.25,.5,.75,1]).name('Sample spacing').onChange(markDirty);generation.add(parameters,'showChunkBounds').name('Chunk boundaries').onChange(value=>chunks.forEach(chunk=>{chunk.helper.visible=value;}));generation.add(parameters,'wireframe').name('Mesh wireframe').onChange(value=>chunks.forEach(chunk=>{chunk.mesh.material.wireframe=value;chunk.mesh.material.needsUpdate=true;}));
function addPosition(folder,prefix){folder.add(parameters,`${prefix}X`,-10,10,.1).name('Position X').onChange(markDirty);folder.add(parameters,`${prefix}Y`,-10,10,.1).name('Position Y').onChange(markDirty);folder.add(parameters,`${prefix}Z`,-10,10,.1).name('Position Z').onChange(markDirty);}const sphere=gui.addFolder('Initial / Sphere A');sphere.add(parameters,'sphereRadius',1,9,.1).name('Radius').onChange(markDirty);addPosition(sphere,'sphere');const box=gui.addFolder('Shape / Box B');box.add(parameters,'boxWidth',1,12,.1).name('Width').onChange(markDirty);box.add(parameters,'boxHeight',1,12,.1).name('Height').onChange(markDirty);box.add(parameters,'boxDepth',1,12,.1).name('Depth').onChange(markDirty);addPosition(box,'box');const cutter=gui.addFolder('Shape / Sphere C');cutter.add(parameters,'cutterRadius',.5,7,.1).name('Radius').onChange(markDirty);addPosition(cutter,'cutter');gui.add(parameters,'smoothing',0,3,.1).name('Smooth amount').onChange(markDirty);
function resize(){const width=canvas.clientWidth,height=canvas.clientHeight;if(canvas.width===Math.round(width*renderer.getPixelRatio())&&canvas.height===Math.round(height*renderer.getPixelRatio()))return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}function animate(){resize();controls.update();renderer.render(scene,camera);requestAnimationFrame(animate);}updateStepControl(true);renderOperationList();generateWorld();animate();
