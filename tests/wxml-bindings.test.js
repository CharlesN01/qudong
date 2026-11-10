// wxml 绑定校验：页面模板里引用的每个变量，都必须在 page.data 里有对应字段。
// 单元测试能验证逻辑，但抓不到「模板里把 books 写成 book」这种绑定错误。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

const NEW_PAGES = [
  'pages/knowledge/index',
  'pages/knowledge-detail/index',
  'pages/mock/index',
  'pages/mock-paper/index',
  'pages/dictation/index',
  'pages/cert/index',
  'pages/cert-recite/index'
];

// wxml 表达式里的字面量与运算符，不属于变量名
const KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'item', 'index',
  'Math', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON'
]);

function loadDefinition(relativePath) {
  const filename = path.join(root, 'miniprogram', relativePath + '.js');
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (request) => localRequire(request),
    Page(value) { definition = value; },
    wx: {},
    getCurrentPages: () => [],
    console,
    setTimeout,
    clearTimeout
  }, { filename });
  return definition;
}

function loadData(relativePath) {
  return loadDefinition(relativePath).data || {};
}

function readWxml(relativePath) {
  return fs.readFileSync(path.join(root, 'miniprogram', relativePath + '.wxml'), 'utf8');
}

// 收集 wx:for-item 声明的局部变量名
function localVariables(template) {
  const locals = new Set(['item', 'index']);
  const pattern = /wx:for-item="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(template))) locals.add(match[1].trim());
  const indexPattern = /wx:for-index="([^"]+)"/g;
  while ((match = indexPattern.exec(template))) locals.add(match[1].trim());
  return locals;
}

// 从 {{ ... }} 里抽根变量名
function rootIdentifiers(expression) {
  const cleaned = expression
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const names = new Set();
  const pattern = /[A-Za-z_$][\w$]*/g;
  let match;
  while ((match = pattern.exec(cleaned))) {
    const name = match[0];
    // 跳过属性访问：a.b 里的 b
    const before = cleaned.slice(0, match.index).trimEnd();
    if (before.endsWith('.')) continue;
    if (KEYWORDS.has(name)) continue;
    names.add(name);
  }
  return names;
}

for (const route of NEW_PAGES) {
  test(`${route}：模板变量都能在 data 里找到`, () => {
    const template = readWxml(route);
    const data = loadData(route);
    const locals = localVariables(template);
    const declared = new Set(Object.keys(data));

    const used = new Set();
    const pattern = /\{\{([\s\S]*?)\}\}/g;
    let match;
    while ((match = pattern.exec(template))) {
      rootIdentifiers(match[1]).forEach((name) => used.add(name));
    }

    const missing = [...used].filter((name) => !declared.has(name) && !locals.has(name));
    assert.deepEqual(
      missing, [],
      `${route} 的 wxml 引用了 data 里没有的字段：${missing.join(', ')}`
    );
  });
}

test('新页面的 wxml 标签都正常闭合', () => {
  const PAIRED = ['view', 'text', 'scroll-view', 'block', 'picker'];
  for (const route of NEW_PAGES) {
    const template = readWxml(route);
    for (const tag of PAIRED) {
      const open = (template.match(new RegExp(`<${tag}(\\s|>)`, 'g')) || []).length;
      const close = (template.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      // 自闭合写法 <view ... /> 也要算作闭合
      const selfClose = (template.match(new RegExp(`<${tag}[^>]*/>`, 'g')) || []).length;
      assert.equal(
        open - selfClose, close,
        `${route} 的 <${tag}> 开合不匹配：开 ${open - selfClose}，闭 ${close}`
      );
    }
  }
});

test('新页面的 wx:for 都带 wx:key', () => {
  for (const route of NEW_PAGES) {
    const template = readWxml(route);
    const loops = template.match(/<[a-z-]+[^>]*wx:for="[^"]*"[^>]*>/g) || [];
    loops.forEach((tag) => {
      assert.match(tag, /wx:key="/, `${route} 有一处 wx:for 缺少 wx:key：${tag.slice(0, 60)}`);
    });
  }
});

test('新页面模板里绑定的事件处理函数都存在', () => {
  for (const route of NEW_PAGES) {
    const template = readWxml(route);
    const definition = loadDefinition(route);
    const handlers = new Set();
    const pattern = /(?:bind|catch):?[a-zA-Z]+="([^"{}]+)"/g;
    let match;
    while ((match = pattern.exec(template))) handlers.add(match[1].trim());

    const missing = [...handlers].filter((name) => typeof definition[name] !== 'function');
    assert.deepEqual(
      missing, [],
      `${route} 的 wxml 绑定了不存在的方法：${missing.join(', ')}`
    );
  }
});

test('新页面都有 goBack 兜底，避免栈底无法返回', () => {
  for (const route of NEW_PAGES) {
    const definition = loadDefinition(route);
    assert.equal(typeof definition.goBack, 'function', `${route} 缺少 goBack`);
  }
});
