const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

test('收藏页走题库接口并按科目分组', () => {
  const script = read('miniprogram/pages/favorites/index.js');
  assert.match(script, /\/bank\/favorites\//);
  assert.match(script, /subjects: data\.subjects/);
  assert.match(script, /filterSubject/);
  assert.match(script, /Authorization: 'Bearer ' \+ auth/);
  const template = read('miniprogram/pages/favorites/index.wxml');
  assert.match(template, /wx:for="\{\{subjects\}\}"/);
  assert.match(template, /filter-chip/);
});

test('收藏页未登录时提示登录而不是空列表', () => {
  const script = read('miniprogram/pages/favorites/index.js');
  assert.match(script, /needLogin: true/);
  assert.match(script, /isLogin: false/);
  const template = read('miniprogram/pages/favorites/index.wxml');
  assert.match(template, /登录后可同步收藏/);
  assert.match(template, /wx:if="\{\{!isLogin\}\}"/);
});

test('错题页走错题接口并支持标记掌握', () => {
  const script = read('miniprogram/pages/wrong/index.js');
  assert.match(script, /\/bank\/wrong-book\//);
  assert.match(script, /\/master\//);
  const template = read('miniprogram/pages/wrong/index.wxml');
  assert.match(template, /错 \{\{item.wrongCount\}\} 次/);
  assert.match(template, /标记掌握/);
  assert.match(template, /共 \{\{total\}\} 道待掌握/);
  assert.match(template, /还没有错题，继续保持/);
});

test('底部导航为四项且错题排在收藏右侧', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const route of pages) {
    const template = read(`miniprogram/${route}.wxml`);
    const labels = Array.from(template.matchAll(/study-bottom-navigation-label">([^<]*)</g)).map((m) => m[1]);
    if (!labels.length) continue;
    assert.equal(labels.length, 4, route + ' 底部导航应为 4 项');
    assert.ok(labels.indexOf('收藏') < labels.indexOf('错题'), route + ' 错题应在收藏右侧');
    assert.ok(labels.indexOf('错题') < labels.indexOf('我的'), route + ' 错题应在我的左侧');
  }
  const styles = read('miniprogram/styles/bottom-navigation.wxss');
  assert.match(styles, /grid-template-columns:\s*repeat\(4,/);
});

test('白天主题为白蓝配色，与首页一致', () => {
  const styles = read('miniprogram/styles/theme.wxss');
  assert.match(styles, /--theme-background:\s*#f5fafe/);
  assert.match(styles, /--theme-accent:\s*#247fee/);
  assert.match(styles, /--theme-ink:\s*#172433/);
  assert.doesNotMatch(styles, /--theme-background:\s*#fcf7f1/);
});

test('品牌名已统一为趣洞', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const route of pages) {
    for (const ext of ['.js', '.wxml']) {
      const content = read(`miniprogram/${route}${ext}`);
      assert.doesNotMatch(content, /文常记/, route + ext + ' 仍含旧品牌名');
    }
  }
  const mine = read('miniprogram/pages/mine/index.wxml');
  assert.match(mine, /趣洞/);
});
