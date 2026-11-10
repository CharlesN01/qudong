// 题库题干 / 解析里混着两种特殊写法：
//   1) Markdown 图片：![题干图片](/media/questions/computer/ch1_single_00.png)
//   2) LaTeX 片段：$\lim\limits_{n \to \infty}\frac{1}{n}$
// 小程序不能直接渲染这两种，这里统一降级成「文字段 + 图片段」。
//
// 注意顺序：必须先按图片语法切分，再对文字段做 LaTeX 降级。
// 否则 latex.prettify 会把图片文件名里的下划线当成下标，把
// ch1_single_00.png 改写成 ch1_(s)ingle_(0)0.png，图片就 404 了。

const latex = require('./latex');

const IMAGE_MARK = /!\[([^\]]*)\]\(\s*([^)\s]+?)\s*\)/g;

function isAbsolute(url) {
  return /^https?:\/\//i.test(url) || /^wxfile:\/\//i.test(url);
}

function joinUrl(base, url) {
  if (isAbsolute(url)) return url;
  const prefix = String(base || '').replace(/\/+$/, '');
  return prefix + (url.charAt(0) === '/' ? url : '/' + url);
}

// 返回 [{ kind: 'text', text }] / [{ kind: 'image', url, alt }]
function splitRich(value, baseUrl) {
  const source = value === null || value === undefined ? '' : String(value);
  const base = baseUrl || '';
  const parts = [];
  let cursor = 0;
  let match;

  IMAGE_MARK.lastIndex = 0;
  while ((match = IMAGE_MARK.exec(source)) !== null) {
    if (match.index > cursor) {
      const text = latex.prettify(source.slice(cursor, match.index));
      if (text) parts.push({ kind: 'text', text });
    }
    parts.push({
      kind: 'image',
      url: joinUrl(base, match[2]),
      alt: match[1] || '题目配图'
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    const text = latex.prettify(source.slice(cursor));
    if (text) parts.push({ kind: 'text', text });
  }

  if (!parts.length) parts.push({ kind: 'text', text: '' });
  return parts;
}

// 只要纯文字（列表摘要用，图片换成一句占位，避免整条空掉）
function plainText(value, imagePlaceholder) {
  const parts = splitRich(value, '');
  const holder = imagePlaceholder === undefined ? '［配图］' : imagePlaceholder;
  return parts.map((part) => (part.kind === 'image' ? holder : part.text)).join(' ').trim();
}

module.exports = { splitRich, plainText };
