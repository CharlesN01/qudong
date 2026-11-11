const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

function loadPage(relativePath, overrides = {}, globals = {}) {
  const filename = path.join(root, 'miniprogram', relativePath);
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(request) {
      if (request === '../../utils/study-timer') return { withStudyTime: (definition) => definition, clock: { async settled() {} } };
      return Object.prototype.hasOwnProperty.call(overrides, request) ? overrides[request] : localRequire(request);
    },
    Page(value) { definition = value; },
    wx: globals.wx,
    getCurrentPages: globals.getCurrentPages || (() => [])
  }, { filename });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) { Object.assign(this.data, value); }
  };
  return page;
}

function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

test('18 个原生路由承载原型状态所需页面均已注册', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.deepEqual(config.pages, [
    // 文学 / 文言 / 专项 / 随机 四个页面已按 11-10 设计稿移除
    'pages/home/index', 'pages/favorites/index', 'pages/orders/index',
    'pages/application/index', 'pages/mine/index', 'pages/resources/index', 'pages/wrong/index', 'pages/bank/index',
    // 11-10 按「首页上刷题页面定稿」补充：题库列表页 + 答题页
    'pages/bank-question/index', 'pages/bank-list/index',
    // 11-11 知识点背诵独立出题号页（不共用刷题记录）
    'pages/knowledge/index', 'pages/knowledge-list/index', 'pages/knowledge-detail/index',
    'pages/mock/index', 'pages/mock-paper/index',
    'pages/dictation/index', 'pages/cert/index', 'pages/cert-recite/index'
  ]);
});

test('订单中心登记为无参数主路径并从我的订单入口直达', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  assert.ok(config.pages.includes('pages/orders/index'));
  const mine = fs.readFileSync(path.join(root, 'miniprogram/pages/mine/index.js'), 'utf8');
  assert.match(mine, /openOrders\(\)\s*\{\s*navigation\.openPage\('\/pages\/orders\/index'\);\s*\}/);
});

test('订单中心直接进入时，未登录留在订单路径并可原地登录', async () => {
  let session = null;
  const api = {
    auth: { getSession: () => session, async login() { session = { token: 'test-session' }; } },
    orders: { async list() { return { results: [], next: null }; } }
  };
  const page = loadPage('pages/orders/index.js', { '../../services/api': api, '../../utils/order-view': { orderView: (order) => order } }, {
    wx: { showToast() {} }
  });
  await page.onShow();
  assert.equal(page.data.loggedIn, false);
  assert.equal(page.data.loading, false);
  assert.match(fs.readFileSync(path.join(root, 'miniprogram/pages/orders/index.wxml'), 'utf8'), /bindtap="login"/);
  assert.equal(page.data.detailVisible, false);
  await page.login();
  assert.equal(page.data.loggedIn, true);
  assert.equal(page.data.detailVisible, false);
});

test('订单详情有明确返回列表操作，返回后仍处于订单中心', () => {
  const page = loadPage('pages/orders/index.js', { '../../services/api': { auth: {}, orders: {} } }, { wx: {} });
  page.data.detailVisible = true;
  page.data.selectedOrder = { id: 'order-1' };
  page.backToList();
  assert.equal(page.data.detailVisible, false);
  assert.equal(page.data.selectedOrder, null);
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/orders/index.wxml'), 'utf8');
  assert.match(template, /bindtap="backToList"/);
});

test('资料群按钮打开首页弹窗，模块入口仍按页面参数跳转', () => {
  const routes = [];
  const navigation = { openPage(path, params) { routes.push({ path, params: jsonCopy(params || {}) }); } };
  const page = loadPage('pages/home/index.js', {
    '../../services/api': {},
    '../../utils/navigation': navigation
  }, { wx: { showToast() {} } });

  // 首页「继续学习」入口已按设计稿移除，这里只覆盖仍然存在的入口
  page.openGroupModal();
  assert.equal(page.data.groupModalVisible, true);
  // 备考资源入口仍然按 data-page 跳转（文学类入口已随板块删除）
  page.openModule({ currentTarget: { dataset: { page: 'knowledge' } } });
  assert.deepEqual(routes.pop(), { path: '/pages/knowledge/index', params: {} });
  const homeTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxml'), 'utf8');
  assert.doesNotMatch(homeTemplate, /study-navbar[^>]*bind:more=/);
});

test('首页备考资料入口只打开弹窗，不再跳转资料页', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxml'), 'utf8');
  assert.match(template, /class="group-card"\s+bindtap="openGroupModal"/);
  assert.doesNotMatch(template, /class="group-card"[^>]*data-page="resources"/);
  assert.match(template, /class="group-action"[^>]*catchtap="openGroupModal"/);
});

test('首页按放大后的首页设计显示更清楚的标题、倒计时和科目名', () => {
  const styles = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxss'), 'utf8');
  assert.match(styles, /\.kicker-title\s*\{[^}]*font-size:\s*31rpx;/);
  assert.match(styles, /\.exam-days\s*\{[^}]*font-size:\s*58rpx;/);
  assert.match(styles, /\.tile-name\s*\{[^}]*font-size:\s*27rpx;/);
  assert.match(styles, /\.tile-count\s*\{[^}]*display:\s*none;/);
});

test('退费规则和客服联系弹窗使用已确认文案与二维码', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/mine/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/mine/index.wxml'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'miniprogram/pages/mine/index.wxss'), 'utf8');
  assert.match(script, /本产品为刷题题库（线上虚拟权限），开通后即可使用，不支持退款。使用中遇到问题，可联系客服处理。/);
  assert.match(template, /wx:if="\{\{infoKind === 'customer'\}\}" class="customer-qr"/);
  assert.match(template, /src="\/assets\/contact-qr\.jpg"/);
  assert.match(styles, /\.customer-qr\s*\{[^}]*width:\s*240px;[^}]*height:\s*240px;/s);
});

test('首页按参考骨架排列：倒计时 / 选择科目 / 备考资源 / 资料群 / 继续学习 / 学习趋势', () => {
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxml'), 'utf8');
  const order = [
    'class="exam-card"', 'class="tile-grid"', 'class="resource-list"',
    'class="group-card"', 'class="trend-card"'
  ];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(template.indexOf(order[i - 1]) < template.indexOf(order[i]),
      order[i - 1] + ' 应排在 ' + order[i] + ' 之前');
  }
  assert.ok(template.indexOf('选择科目') < template.indexOf('class="tile-grid"'));
  assert.ok(template.indexOf('备考资源') < template.indexOf('class="resource-list"'));
  // 新版首页去掉了「连续学习 / 今日学习」统计卡，不应再出现
  assert.doesNotMatch(template, /dashboard-stats/);
  assert.doesNotMatch(template, /连续学习/);
  const styles = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxss'), 'utf8');
  // 顺序由 DOM 决定，任何 order 规则都会把卡片挤乱
  assert.doesNotMatch(styles, /\.exam-card\s*\{\s*order:/);
  assert.doesNotMatch(styles, /\.tile-grid\s*\{\s*order:/);
  // 继续学习卡片已按设计稿移除
  assert.doesNotMatch(template, /continue-card/);
});

test('首页资源列表不显示通用默写板入口', () => {
  const script = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/home/index.wxml'), 'utf8');
  assert.doesNotMatch(script, /name:\s*'通用默写板'/);
  assert.match(script, /name:\s*'知识点背诵'/);
  assert.match(script, /name:\s*'各机构模考'/);
  assert.match(script, /name:\s*'资格证书备考'/);
  assert.doesNotMatch(template, /通用默写板/);
});

