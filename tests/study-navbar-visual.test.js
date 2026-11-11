const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getNavigationMetrics } = require('../miniprogram/utils/safe-top');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('导航标题与副标题分行布局并避开返回按钮及微信胶囊', () => {
  const template = read('miniprogram/components/study-navbar/index.wxml');
  const styles = read('miniprogram/components/study-navbar/index.wxss');
  const homePage = read('miniprogram/pages/home/index.wxml');
  const centeredPage = read('miniprogram/pages/mine/index.wxml');

  assert.match(template, /padding-left: \{\{centered \? rightSpace : \(back \? 56 : 17\)\}\}px; padding-right: \{\{rightSpace\}\}px;/);
  assert.match(template, /header-copy-centered/);
  assert.match(homePage, /<study-navbar[^>]*back="\{\{false\}\}"/);
  assert.match(centeredPage, /<study-navbar[^>]*centered="\{\{true\}\}"/);
  assert.match(styles, /\.back-hit \{[^}]*left: 8rpx;[^}]*width: 88rpx;/);
  assert.match(styles, /\.header-copy \{[^}]*flex-direction: column;/);
  assert.match(styles, /\.brand-title \{[^}]*display: block;[^}]*word-break: break-all;/);
  assert.match(styles, /\.brand-subtitle \{[^}]*display: block;/);
  assert.doesNotMatch(template, /more-button|onMore/);
  assert.doesNotMatch(styles, /\.brand-title[^}]*white-space: nowrap/);
});

for (const width of [375, 390, 430]) {
  test(`${width}px 导航内容低于刘海并完整避开胶囊`, () => {
    const statusHeight = width === 375 ? 44 : 47;
    const menu = { left: width - 97, top: statusHeight + 6, height: 32, bottom: statusHeight + 38 };
    const metrics = getNavigationMetrics({
      getWindowInfo: () => ({ windowWidth: width, statusBarHeight: statusHeight }),
      getMenuButtonBoundingClientRect: () => menu
    });
    assert.equal(metrics.statusHeight, statusHeight);
    assert.ok(metrics.statusHeight + metrics.barHeight > menu.bottom);
    const titleRight = width - metrics.rightSpace;
    assert.ok(titleRight <= menu.left - 12);
    assert.ok(titleRight - 56 >= 200, '非居中学习标题保留足够宽度');
    assert.ok(width - metrics.rightSpace * 2 >= 150, '居中标题可分行显示');
  });
}

test('窗口 API 或胶囊数据缺失仍保留独立导航行', () => {
  const metrics = getNavigationMetrics({
    getWindowInfo() { throw new Error('unsupported'); },
    getSystemInfoSync() { return { windowWidth: 390, statusBarHeight: 30 }; },
    getMenuButtonBoundingClientRect() { return { top: 0, height: 0 }; }
  });
  assert.deepEqual(metrics, { statusHeight: 30, barHeight: 58, rightSpace: 100 });
});

// 这些页面自带顶栏（返回 + 标题），不引 study-navbar 组件：
// bank 用「返回首页」头部，11-04 新增的四个板块用统一的 .top 顶栏。
const CUSTOM_HEADER_PAGES = [
  'pages/bank/index',
  'pages/knowledge/index',
  'pages/knowledge-list/index',
  'pages/knowledge-detail/index',
  'pages/mock/index',
  'pages/mock-paper/index',
  'pages/dictation/index',
  'pages/cert/index',
  'pages/cert-recite/index'
];

test('所有页面都有导航，自定义顶栏页面不再依赖空白占位', () => {
  const pages = JSON.parse(read('miniprogram/app.json')).pages;
  for (const route of pages) {
    const template = read(`miniprogram/${route}.wxml`);
    if (route === 'pages/bank/index') {
      // 题库科目页按设计稿使用「科目标题 + 山东专升本标签」的自定义头部
      assert.match(template, /class="intro-title"/);
      assert.match(template, /class="subject-tag"/);
      continue;
    }
    if (route === 'pages/bank-list/index') {
      // 题库列表页：返回胶囊 + 清除记录的自定义顶栏
      assert.match(template, /class="nav-row"/);
      assert.match(template, /bindtap="backToSubject"/);
      continue;
    }
    if (route === 'pages/bank-question/index') {
      // 答题页：退出练习 + 答题卡/收藏的自定义顶栏
      assert.match(template, /class="q-heading"/);
      assert.match(template, /bindtap="backToList"/);
      continue;
    }
    if (route === 'pages/mock/index') {
      // 机构模考列表：返回 + 居中标题的自定义顶栏
      assert.match(template, /class="nav-row"/);
      assert.match(template, /bindtap="goBack"/);
      continue;
    }
    if (route === 'pages/mock-paper/index') {
      // 模考做题页：试卷条（返回 + 卷名 + 倒计时）
      assert.match(template, /class="exambar"/);
      assert.match(template, /bindtap="goBack"/);
      continue;
    }
    if (route === 'pages/home/index') {
      // 首页按设计稿使用「品牌图标 + 升本题库」自定义顶栏，没有返回操作。
      assert.match(template, /class="home-header"/);
      assert.match(template, /class="brand-name">升本题库/);
      continue;
    }
    if (CUSTOM_HEADER_PAGES.indexOf(route) >= 0) {
      // 新板块自带顶栏（.top 或 .topbar），必须含返回操作
      assert.match(template, /class="(top|topbar)"/);
      assert.match(template, /bindtap="goBack"/);
      continue;
    }
    assert.match(template, /<study-navbar/);
    assert.doesNotMatch(template, /more="|more-plain="|bind:more="/);
  }
  // 文学 / 文言 / 专项 / 随机 四个页面已按设计稿移除，这里只校验剩余页面
});

test('应用文同页阅读保留安全导航和分行正文，组件仍支持覆盖详情返回', () => {
  const styles = read('miniprogram/pages/application/index.wxss');
  const template = read('miniprogram/pages/application/index.wxml');
  assert.match(template, /study-navbar[^>]*back="\{\{true\}\}"/);
  assert.match(styles, /\.template-content \{[^}]*display: block;[^}]*white-space: pre-wrap;/);
  assert.match(styles, /\.requirement-body \{[^}]*white-space: pre-wrap;/);
  assert.doesNotMatch(template, /detail-page|bindtap="openStudy"/);
  let definition;
  vm.runInNewContext(read('miniprogram/components/study-navbar/index.js'), {
    require: () => ({ getNavigationMetrics }),
    Component(value) { definition = value; },
    getCurrentPages() { throw new Error('详情返回不应改变页面栈'); }
  });
  const events = [];
  definition.methods.goBack.call({ data: { customBack: true }, triggerEvent: (event) => events.push(event) });
  assert.deepEqual(events, ['back']);
});
