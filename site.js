import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './src/firebase.js';

// 每个栏目描述它的名称与页面位置；新增页面时先在这里登记。
export const sections = {
  home: { title: 'HOME / PROJECT HUB' },
  game: { title: 'STARLIGHT COLLECTION / FIRST GAME', page: './legacy-game.html', description: 'Guide a lantern, collect starlight, and avoid shadows in a 30-second game.' },
  noise: { title: 'Cellular Noise / TERRAIN EXPERIMENT', page: './experiments/cellular-noise/index.html', description: 'Explore layered noise, height fields, map simulation, and terrain resolution.' },
  voxel: { title: 'VOXEL TERRAIN / DENSITY FIELD', page: './experiments/voxel-terrain/index.html', description: 'Learn density fields, CSG, chunking, and surface meshing one stage at a time.' },
  scene: { title: '3D LEARNING / REACT THREE FIBER', page: './scene.html', description: 'Learn 3D scenes through geometry, coordinates, cameras, and lighting.' },
  portfolio: { title: 'PORTFOLIO / ORIGINAL WEBSITE', page: './archive/portfolio/index.html', description: 'Explore the original website, project stories, and development roadmap.' },
  files: { title: 'FILES & NOTES / PROJECT LIBRARY', description: 'Read learning notes, Markdown documents, and game and experiment source code.' },
};

// Vite 在开发和构建时登记这些文件；raw 表示把内容作为文本读取。
// 明确范围，避免把依赖、生成目录或本机配置放进网站。
const files = import.meta.glob([
  './*.md', './*.html', './*.js', './*.css', './*.json', './*.cmd',
  './src/**/*.{js,jsx,css}',
  './experiments/**/*.{md,html,js,css}',
  './archive/**/*.{md,html,js,css}',
  '!./package-lock.json',
], { query: '?raw', import: 'default' });
const content = document.querySelector('#content');
const title = document.querySelector('#sectionTitle');
const openPage = document.querySelector('#openPage');
let activeSection;
let fileRequest = 0;

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
    if (key === 'home') continue;
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

function showFiles() {
  const library = document.createElement('section');
  library.className = 'library';
  library.innerHTML = `<aside><label for="fileSelect">Project files</label><select id="fileSelect"></select>
    <p class="hint">Notes are shown as Markdown text. Source files are available to read and are not executed here.</p></aside>
    <article><div class="file-heading"><strong id="fileName"></strong>
    <a id="downloadFile">Download file ↓</a></div><pre id="fileText" tabindex="0"></pre></article>`;
  const select = library.querySelector('select');
  const groups = ['NOTES / MARKDOWN', 'CODE & PROJECT FILES / SOURCE'];
  for (const [i, label] of groups.entries()) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const path of Object.keys(files).sort()) {
      if (path.endsWith('.md') !== (i === 0)) continue;
      const option = document.createElement('option');
      option.value = path;
      option.textContent = path.slice(2);
      group.append(option);
    }
    select.append(group);
  }
  content.append(library);
  let downloadURL;
  async function readFile() {
    const request = ++fileRequest;
    const path = select.value;
    library.querySelector('#fileName').textContent = path.slice(2);
    const text = library.querySelector('#fileText');
    text.textContent = 'Loading…';
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
    } catch {
      if (request === fileRequest) text.textContent = 'Could not load this file. Refresh and try again.';
    }
  }
  select.value = './PROJECT-STATE.md';
  select.addEventListener('change', readFile);
  readFile();
  // 离开栏目后释放下载地址。
  return () => { if (downloadURL) URL.revokeObjectURL(downloadURL); };
}

let cleanup;
function navigate() {
  const requested = location.hash.slice(1) || 'home';
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
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === '#' + key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  openPage.hidden = !section.page;
  if (section.page) {
    openPage.href = section.page;
    const frame = document.createElement('iframe');
    frame.src = section.page;
    frame.title = section.title;
    frame.className = 'project-frame';
    content.append(frame);
  } else if (key === 'home') showHome();
  else cleanup = showFiles();
}
window.addEventListener('hashchange', navigate);
navigate();
