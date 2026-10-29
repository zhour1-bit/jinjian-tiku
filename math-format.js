let katex, loading;
const contentCache = new Map();

export function prepareMath() {
  if (katex) return Promise.resolve();
  if (loading) return loading;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./vendor/katex/katex.min.css', import.meta.url).href;
  const script = document.createElement('script');
  script.src = new URL('./vendor/katex/katex.min.js', import.meta.url).href;
  loading = Promise.all([stylesheet, script].map(element => new Promise((resolve, reject) => {
    element.onload = resolve;
    element.onerror = () => reject(new Error('公式资源加载失败，请重试。'));
    document.head.append(element);
  }))).then(() => { katex = window.katex; contentCache.clear(); }).catch(error => {
    stylesheet.remove(); script.remove(); loading = null; throw error;
  });
  return loading;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function textHtml(text) {
  return escapeHtml(text)
    .replace(/!\[([^\]]*)\]\((https?:[^)]+)\)/g, (_, alt, url) => `<img alt="${alt}" src="${url}" loading="lazy">`)
    .replace(/\n/g, '<br>');
}

// Extract math before inserting <br>, so multiline environments remain intact.
export function formatContent(value) {
  const text = String(value ?? '');
  if (!katex) return textHtml(text);
  if (contentCache.has(text)) return contentCache.get(text);
  const math = /(?<!\\)(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\[\s\S]|[^$\\\n])+)\$)/g;
  let html = '', end = 0;
  for (const match of text.matchAll(math)) {
    html += textHtml(text.slice(end, match.index));
    const tex = match[2] ?? match[3] ?? match[4] ?? match[5];
    const displayMode = match[2] !== undefined || match[3] !== undefined;
    // English reading passages also use dollar signs for prices, not formulas.
    if (match[5] !== undefined && /^\s*[\d,.]+\s+[A-Za-z]{2,}/.test(tex) && !/[\\^_={}]/.test(tex)) {
      html += textHtml(match[0]);
      end = match.index + match[0].length;
      continue;
    }
    try {
      html += katex.renderToString(tex, {displayMode, throwOnError:true, trust:false, strict:'ignore', maxExpand:1000});
    } catch {
      html += `<span class="math-error" title="公式暂无法解析，显示原文">${escapeHtml(match[0])}</span>`;
    }
    end = match.index + match[0].length;
  }
  const result = html + textHtml(text.slice(end));
  if (contentCache.size >= 200) contentCache.delete(contentCache.keys().next().value);
  contentCache.set(text, result);
  return result;
}
