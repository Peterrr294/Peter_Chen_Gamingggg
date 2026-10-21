import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './src/firebase.js';
import { renderMarkdown } from './markdown-viewer.js';

// 每个栏目描述它的名称与页面位置；新增页面时先在这里登记。
export const sections = {
  home: { title: 'HOME / PROJECT HUB' },
  miniWorld: { title: 'PROCEDURAL MINI WORLD / 3 × 3 WORLD GRID', navLabel: '3 × 3 WORLD GRID', page: './experiments/world-grid/index.html', description: 'Nine 1024 m chunks: seed terrain, City DNA per slot, roads, parcels, buildings, and harmonised seams.' },
  seedTerrain: { title: 'PROCEDURAL MINI WORLD / SINGLE CHUNK', navLabel: 'SINGLE CHUNK', page: './experiments/seed-terrain/index.html', description: 'One seed-terrain chunk through the full chain: terrain fields, City DNA match, network, blocks, parcels, buildings.', parent: 'miniWorld' },
  manhattanTerrain: { title: 'MANHATTAN TERRAIN / GREYBOX', page: './experiments/manhattan-terrain-greybox/index.html', description: 'Earlier seeded Manhattan terrain, water, slope, and buildability study.', parent: 'miniWorld' },
  game: { title: 'STARLIGHT COLLECTION / FIRST GAME', page: './legacy-game.html', description: 'Guide a lantern, collect starlight, and avoid shadows in a 30-second game.' },
  noise: { title: 'Cellular Noise / TERRAIN EXPERIMENT', page: './experiments/cellular-noise/index.html', description: 'Explore layered noise, height fields, map simulation, and terrain resolution.' },
  voxel: { title: 'VOXEL TERRAIN / DENSITY FIELD', page: './experiments/voxel-terrain/index.html', description: 'Learn density fields, CSG, chunking, and surface meshing one stage at a time.' },
  scene: { title: '3D LEARNING / REACT THREE FIBER', page: './scene.html', description: 'Learn 3D scenes through geometry, coordinates, cameras, and lighting.' },
  shader: { title: 'SHADER BASICS / GPU PIPELINE', page: './experiments/shader-basics/index.html', description: 'Compare vertex and fragment work, uniforms, UV patterns, and coordinate spaces on one plane.' },
  pcg: { title: 'PCG TERRAIN LAB / CLASS 06', page: './experiments/pcg-terrain/index.html', description: 'Experiments in terrain scattering, spline paths, vector fields, particles, and procedural environmental systems.' },
  flavor: { title: 'FLAVOR CLASH / REGIONAL WORLD LABS', page: './experiments/flavor-clash-prototype/index.html', description: 'Open the finite map and its focused Iceland terrain, surface-query, road-projection, and road-mesh studies.' },
  iceland: { title: 'ICELAND REGION LAB / FINITE TERRAIN', page: './experiments/iceland-region/index.html', description: 'Shape one reproducible Iceland height field with layered noise, ridges, coastal falloff, and an independent sea level.', parent: 'flavor' },
  roadProjection: { title: 'ROAD PROJECTION LAB / SURFACE PATHS', page: './experiments/road-projection/index.html', description: 'Project normalized road inputs onto terrain data, validate slope and water constraints, and export serializable path samples.', parent: 'flavor' },
  roadMesh: { title: 'ROAD MESH LAB / RIBBON GEOMETRY', page: './experiments/road-mesh/index.html', description: 'Turn frozen projected paths into deterministic road ribbons with terrain normals, continuous UVs, and limited miter joins.', parent: 'flavor' },
  terrainSeam: { title: 'TERRAIN SEAM / CONNECTED ZONES', page: './experiments/terrain-seam/index.html', description: 'Compare two separate terrain meshes blended toward one deterministic shared boundary.', parent: 'flavor' },
  portfolio: { title: 'PORTFOLIO / ORIGINAL WEBSITE', page: './archive/portfolio/index.html', description: 'Explore the original website, project stories, and development roadmap.' },
  files: { title: 'FILES & NOTES / PROJECT LIBRARY', description: 'Read learning notes, Markdown documents, and game and experiment source code.' },
};

// Vite 在开发和构建时登记这些文件；raw 表示把内容作为文本读取。
// 明确范围，避免把依赖、生成目录或本机配置放进网站。
const files = import.meta.glob([
  './*.md', './*.html', './*.js', './*.css', './*.json', './*.cmd',
  './docs/**/*.md',
  './src/**/*.{js,jsx,css}',
  './experiments/**/*.{md,html,js,css}',
  './archive/**/*.{md,html,js,css}',
  '!./package-lock.json',
], { query: '?raw', import: 'default' });
// 文档图片可位于 docs/ 下任意层级；实验档案的 Obsidian 副本（![[...]] 引用）不打包。
const documentImages = import.meta.glob([
  './docs/**/*.{png,jpg,jpeg,webp,gif,svg}',
  '!./docs/procedural-mini-world/04-experiments/EXP-Procedural-Mini-World/Screenshots/**',
], {
  eager: true,
  query: '?url',
  import: 'default',
});
const content = document.querySelector('#content');
const title = document.querySelector('#sectionTitle');
const openPage = document.querySelector('#openPage');
let activeSection;
let fileRequest = 0;

function relatedProjects(key) {
  const root = sections[key].parent || key;
  const children = Object.keys(sections).filter(candidate => sections[candidate].parent === root);
  return children.length ? [root, ...children] : [];
}

function showProject(key, section) {
  const project = document.createElement('section');
  project.className = 'project-view';
  const related = relatedProjects(key);
  if (related.length) {
    const switcher = document.createElement('nav');
    switcher.className = 'experiment-switcher';
    switcher.setAttribute('aria-label', `${sections[section.parent || key].title} experiments`);
    for (const relatedKey of related) {
      const link = document.createElement('a');
      link.href = `#${relatedKey}`;
      link.textContent = sections[relatedKey].navLabel || sections[relatedKey].title.split(' / ')[0];
      if (relatedKey === key) link.setAttribute('aria-current', 'page');
      switcher.append(link);
    }
    project.append(switcher);
  }
  const frame = document.createElement('iframe');
  frame.src = section.page;
  frame.title = section.title;
  frame.className = 'project-frame';
  project.append(frame);
  content.append(project);
}

const authButton = document.querySelector('#authButton');
const authStatus = document.querySelector('#authStatus');
const userPhoto = document.querySelector('#userPhoto');

onAuthStateChanged(auth, user => {
  authButton.disabled = false;
  if (user) {
    authStatus.textContent = user.displayName || user.email || 'Signed in';
    authButton.textContent = 'Sign out';
    if (user.photoURL) {
      userPhoto.src = user.photoURL;
      userPhoto.alt = `${user.displayName || 'Signed-in user'} profile photo`;
      userPhoto.hidden = false;
    } else {
      userPhoto.hidden = true;
      userPhoto.removeAttribute('src');
    }
  } else {
    authStatus.textContent = 'Signed out';
    authButton.textContent = 'Sign in with Google';
    userPhoto.hidden = true;
    userPhoto.removeAttribute('src');
  }
});

authButton.addEventListener('click', async () => {
  authButton.disabled = true;
  try {
    if (auth.currentUser) await signOut(auth);
    else await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error('Firebase Authentication failed:', error);
    authStatus.textContent = 'Login failed — try again';
    authButton.disabled = false;
  }
});

function showHome() {
  const intro = document.createElement('section');
  intro.className = 'hub';
  intro.innerHTML = `<p class="eyebrow">A PLACE FOR EVERY EXPERIMENT</p>
    <h1>Games, experiments, and learning.<br>One place to explore.</h1>
    <p class="intro">Choose a category to play a game, explore terrain, or read the notes behind the code.</p>
    <p class="hint">Switching categories ends the current run. Choose “Open Separately” to keep a project running.</p>
    <div class="cards"></div>`;
  const cards = intro.querySelector('.cards');
  for (const [key, section] of Object.entries(sections)) {
    if (key === 'home' || section.parent) continue;
    const card = document.createElement('a');
    card.href = '#' + key;
    card.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    const description = document.createElement('p');
    description.textContent = section.description;
    card.append(heading, description);
    cards.append(card);
  }
  content.append(intro);
}

function showFiles(initialPath = './docs/README.md') {
  const library = document.createElement('section');
  library.className = 'library';
  library.innerHTML = `<aside><label for="fileSelect">Project files</label><select id="fileSelect"></select>
    <p class="hint">Markdown opens in a safe rendered view. Switch to Source for the original text; downloads always preserve the original file.</p></aside>
    <article><div class="file-heading"><strong id="fileName"></strong>
    <div class="file-actions"><div class="view-controls" role="group" aria-label="Document view">
    <button id="renderedView" type="button">Rendered</button><button id="sourceView" type="button">Source</button></div>
    <a id="downloadFile">Download file ↓</a></div></div>
    <div id="fileRendered" class="markdown-body" tabindex="0"></div><pre id="fileText" tabindex="0" hidden></pre></article>`;
  const select = library.querySelector('select');
  const markdownGroups = [
    ['START HERE', path => path === './README.md' || path === './docs/README.md' || path === './docs/ASSIGNMENT-1-CHECKLIST.md' || path.startsWith('./docs/_meta/')],
    ['PROCEDURAL MINI WORLD / MIDTERM KNOWLEDGE BASE', path => path.startsWith('./docs/procedural-mini-world/')],
    ['EXPLORATION MAPS', path => path === './docs/EXPLORATION-MAP.md'],
    ['PLAYABLE PROJECTS', path => path === './docs/projects/README.md' || path.startsWith('./docs/projects/starlight-run/') || path.startsWith('./docs/projects/flavor-clash/')],
    ['OPEN-SOURCE REFERENCES', path => path === './docs/OPEN_SOURCE_SOURCES.md'],
    ['PROCEDURAL GENERATION EXPERIMENTS', path => path.startsWith('./docs/projects/cellular-noise/') || path.startsWith('./docs/projects/voxel-terrain/') || path.startsWith('./docs/learning/pcg-terrain/') || path.startsWith('./experiments/')],
    ['3D LEARNING', path => path === './docs/learning/README.md' || path.startsWith('./docs/learning/react-three-fiber/') || path.startsWith('./docs/learning/shaders/')],
    ['TUTORIALS & LEARNING MATERIALS', path => path.startsWith('./docs/learning/prompting-and-debugging/')],
    ['WEBSITE & FIREBASE INFRASTRUCTURE', path => path.startsWith('./docs/infrastructure/')],
    ['DESIGN & DOCUMENTATION STANDARDS', path => path.startsWith('./docs/standards/')],
    ['DEVELOPMENT LOGS', path => path.startsWith('./docs/logs/')],
  ];
  // 未匹配任何栏目的笔记放入兜底分组，避免新文档在列表中消失。
  const knownGroups = markdownGroups.slice();
  markdownGroups.push(['OTHER NOTES', path => !knownGroups.some(([, matches]) => matches(path))]);
  // 每个分组的入口页排在最前。
  const pinnedFirst = new Set(['./docs/procedural-mini-world/README.md']);
  const sortedPaths = Object.keys(files).sort();
  for (const [label, matches] of markdownGroups) {
    const matchingPaths = sortedPaths.filter(path => path.endsWith('.md') && matches(path))
      .sort((a, b) => Number(pinnedFirst.has(b)) - Number(pinnedFirst.has(a)));
    if (!matchingPaths.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const path of matchingPaths) {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path.slice(2);
      group.append(option);
    }
    select.append(group);
  }
  const sourceGroup = document.createElement('optgroup');
  sourceGroup.label = 'CODE & PROJECT FILES / SOURCE';
  for (const path of sortedPaths.filter(path => !path.endsWith('.md'))) {
    const option = document.createElement('option');
    option.value = path;
    option.textContent = path.slice(2);
    sourceGroup.append(option);
  }
  select.append(sourceGroup);
  content.append(library);

  const rendered = library.querySelector('#fileRendered');
  const text = library.querySelector('#fileText');
  const renderedButton = library.querySelector('#renderedView');
  const sourceButton = library.querySelector('#sourceView');
  let downloadURL;
  let preferredView = 'rendered';
  let currentIsMarkdown = true;

  function setView(requestedView, remember = true) {
    const view = requestedView === 'rendered' && !currentIsMarkdown ? 'source' : requestedView;
    if (remember && currentIsMarkdown) preferredView = view;
    rendered.hidden = view !== 'rendered';
    text.hidden = view !== 'source';
    renderedButton.setAttribute('aria-pressed', String(view === 'rendered'));
    sourceButton.setAttribute('aria-pressed', String(view === 'source'));
    renderedButton.disabled = !currentIsMarkdown;
  }

  renderedButton.addEventListener('click', () => setView('rendered'));
  sourceButton.addEventListener('click', () => setView('source'));
  rendered.addEventListener('click', event => {
    const link = event.target.closest('a[data-note-path]');
    if (!link) return;
    const option = [...select.options].find(item => item.value === link.dataset.notePath);
    if (!option) return;
    event.preventDefault();
    select.value = option.value;
    readFile();
  });

  async function readFile() {
    const request = ++fileRequest;
    const path = select.value;
    currentIsMarkdown = path.endsWith('.md');
    library.querySelector('#fileName').textContent = path.slice(2);
    text.textContent = 'Loading…';
    rendered.textContent = currentIsMarkdown ? 'Rendering…' : '';
    setView(currentIsMarkdown ? preferredView : 'source', false);
    try {
      const source = await files[path]();
      // 快速切换文件时，忽略较早请求，防止显示错文件。
      if (request !== fileRequest || activeSection !== 'files') return;
      text.textContent = source;
      text.scrollTop = 0;
      if (downloadURL) URL.revokeObjectURL(downloadURL);
      downloadURL = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
      const download = library.querySelector('#downloadFile');
      download.href = downloadURL;
      download.download = path.split('/').pop();

      if (currentIsMarkdown) {
        const draft = document.createElement('div');
        await renderMarkdown(source, draft, {
          sourcePath: path,
          resolveAsset: assetPath => documentImages[assetPath] || assetPath,
        });
        if (request !== fileRequest || activeSection !== 'files') return;
        rendered.replaceChildren(...draft.childNodes);
      }
    } catch (error) {
      console.error('Could not display project file:', error);
      if (request === fileRequest) {
        text.textContent = 'Could not load this file. Refresh and try again.';
        rendered.textContent = 'Could not render this file. Switch to Source or refresh and try again.';
      }
    }
  }

  select.value = Object.hasOwn(files, initialPath) ? initialPath : './docs/README.md';
  select.addEventListener('change', readFile);
  readFile();
  // 离开栏目后释放下载地址。
  return () => { if (downloadURL) URL.revokeObjectURL(downloadURL); };
}

let cleanup;
function navigate() {
  const fragment = location.hash.slice(1);
  const queryStart = fragment.indexOf('?');
  const requested = (queryStart === -1 ? fragment : fragment.slice(0, queryStart)) || 'home';
  const query = new URLSearchParams(queryStart === -1 ? '' : fragment.slice(queryStart + 1));
  const key = Object.hasOwn(sections, requested) ? requested : 'home';
  if (key === activeSection) return;
  cleanup?.();
  cleanup = null;
  ++fileRequest;
  activeSection = key;
  const section = sections[key];
  // 移除旧 iframe 会卸载它的页面，停止旧游戏与实验的动画。
  content.replaceChildren();
  title.textContent = section.title;
  document.title = section.title + " — Peter's Game Lab";
  const navKey = section.parent || key;
  document.querySelectorAll('.site-header nav a').forEach(link => {
    if (link.hash === '#' + navKey) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  openPage.hidden = !section.page;
  if (section.page) {
    openPage.href = section.page;
    showProject(key, section);
  } else if (key === 'home') showHome();
  else cleanup = showFiles(query.get('file') || './docs/README.md');
}
window.addEventListener('hashchange', navigate);
navigate();
