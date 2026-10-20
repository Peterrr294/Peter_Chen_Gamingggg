const MERMAID_MODULE_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
let mermaidPromise;
let diagramCounter = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function normalizeRepositoryPath(sourcePath, target) {
  const [targetPath, fragment = ''] = target.split('#');
  if (!targetPath) return { href: `#${fragment}`, notePath: null };
  const base = sourcePath.replace(/^\.\//, '').split('/');
  base.pop();
  const parts = targetPath.startsWith('/') ? [] : base;
  for (const part of targetPath.replace(/^\//, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const normalized = `./${parts.join('/')}`;
  return {
    href: normalized + (fragment ? `#${fragment}` : ''),
    notePath: normalized.toLowerCase().endsWith('.md') ? normalized : null,
  };
}

function safeLink(rawTarget, sourcePath) {
  const target = rawTarget.trim();
  if (/^(https?:|mailto:)/i.test(target)) return { href: target, notePath: null };
  if (target.startsWith('#')) return { href: target, notePath: null };
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return { href: '#', notePath: null };
  return normalizeRepositoryPath(sourcePath, target);
}

function renderInline(value, sourcePath, resolveAsset) {
  const tokens = [];
  const token = html => {
    const index = tokens.push(html) - 1;
    return `\uE000${index}\uE001`;
  };
  let text = String(value);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, rawTarget) => {
    const image = safeLink(rawTarget, sourcePath);
    const source = /^(https?:)/i.test(image.href) ? image.href : (resolveAsset?.(image.href) || image.href);
    return token(`<img class="markdown-image" src="${escapeAttribute(source)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async">`);
  });
  text = text.replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, rawTarget) => {
    const link = safeLink(rawTarget, sourcePath);
    const noteData = link.notePath ? ` data-note-path="${escapeAttribute(link.notePath)}"` : '';
    const external = /^(https?:)/i.test(link.href) ? ' target="_blank" rel="noreferrer"' : '';
    return token(`<a href="${escapeAttribute(link.href)}"${noteData}${external}>${escapeHtml(label)}</a>`);
  });
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)]);
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? '';
  if (!line.trim()) return true;
  if (/^```/.test(line) || /^#{1,6}\s+/.test(line) || /^>\s?/.test(line)) return true;
  if (/^\s*(?:[-+*]|\d+\.)\s+/.test(line)) return true;
  return index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1]);
}

function markdownToHtml(source, sourcePath, resolveAsset) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  const headingIds = new Map();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const language = fence[1].toLowerCase();
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const codeText = code.join('\n');
      if (language === 'mermaid') {
        output.push(`<figure class="mermaid-frame"><div class="mermaid-diagram"><pre class="mermaid-source"><code>${escapeHtml(codeText)}</code></pre></div></figure>`);
      } else {
        const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : '';
        output.push(`<pre><code${languageClass}>${escapeHtml(codeText)}</code></pre>`);
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const baseId = heading[2].toLowerCase().replace(/`/g, '').replace(/[^a-z\d\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
      const count = headingIds.get(baseId) || 0;
      headingIds.set(baseId, count + 1);
      const id = count ? `${baseId}-${count + 1}` : baseId;
      output.push(`<h${level} id="${escapeAttribute(id)}">${renderInline(heading[2], sourcePath, resolveAsset)}</h${level}>`);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const head = headers.map(cell => `<th>${renderInline(cell, sourcePath, resolveAsset)}</th>`).join('');
      const body = rows.map(row => `<tr>${headers.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || '', sourcePath, resolveAsset)}</td>`).join('')}</tr>`).join('');
      output.push(`<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote>${quote.map(item => renderInline(item, sourcePath, resolveAsset)).join('<br>')}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]) !== ordered) break;
        const checkbox = match[2].match(/^\[([ xX])\]\s+(.+)$/);
        if (checkbox) {
          const checked = checkbox[1].toLowerCase() === 'x' ? ' checked' : '';
          items.push(`<li class="task-item"><input type="checkbox" disabled${checked}> ${renderInline(checkbox[2], sourcePath, resolveAsset)}</li>`);
        } else {
          items.push(`<li>${renderInline(match[2], sourcePath, resolveAsset)}</li>`);
        }
        index += 1;
      }
      output.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      output.push('<hr>');
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(' '), sourcePath, resolveAsset)}</p>`);
  }

  return output.join('\n');
}

async function getMermaid() {
  if (!mermaidPromise) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('loading timed out')), 12000));
    mermaidPromise = Promise.race([import(/* @vite-ignore */ MERMAID_MODULE_URL), timeout]).then(module => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        flowchart: { htmlLabels: false, curve: 'basis' },
        themeVariables: {
          background: '#f8fafc',
          primaryTextColor: '#111827',
          lineColor: '#475569',
          fontFamily: 'Inter, Arial, sans-serif',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

async function renderMermaidBlocks(container) {
  const diagrams = [...container.querySelectorAll('.mermaid-diagram')];
  if (!diagrams.length) return;
  let mermaid;
  try {
    mermaid = await getMermaid();
  } catch (error) {
    for (const diagram of diagrams) showMermaidError(diagram, `Mermaid could not load: ${error.message}`);
    return;
  }

  for (const diagram of diagrams) {
    const source = diagram.querySelector('.mermaid-source')?.textContent || '';
    try {
      await mermaid.parse(source);
      const id = `mermaid-diagram-${Date.now()}-${diagramCounter++}`;
      const result = await mermaid.render(id, source);
      diagram.innerHTML = result.svg;
      result.bindFunctions?.(diagram);
    } catch (error) {
      showMermaidError(diagram, `Mermaid could not render this diagram: ${error.message}`, source);
    }
  }
}

function showMermaidError(diagram, message, source) {
  const code = source ?? diagram.querySelector('.mermaid-source')?.textContent ?? '';
  diagram.replaceChildren();
  diagram.classList.add('mermaid-error');
  const notice = document.createElement('p');
  notice.textContent = message;
  const pre = document.createElement('pre');
  const codeElement = document.createElement('code');
  codeElement.textContent = code;
  pre.append(codeElement);
  diagram.append(notice, pre);
}

export async function renderMarkdown(source, container, { sourcePath = './README.md', resolveAsset } = {}) {
  container.innerHTML = markdownToHtml(source, sourcePath, resolveAsset);
  await renderMermaidBlocks(container);
}
