// 11-04 新增页面的行为测试：直接加载页面 JS，用 vm 沙箱执行，mock 掉 wx API。
// 验证的是真实逻辑（生命周期、点击处理、数据变化、存储写入），不是静态检查。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

// ---------------------------------------------------------------- 测试脚手架

function createWx(options = {}) {
  const storage = Object.assign({}, options.storage || {});
  const calls = { toast: [], modal: [], navigate: [], request: [] };
  const responses = options.responses || {};

  const wx = {
    getStorageSync(key) {
      return storage[key];
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    showToast(payload) {
      calls.toast.push(payload);
    },
    showModal(payload) {
      calls.modal.push(payload);
      if (typeof payload.success === 'function') {
        payload.success({ confirm: options.confirmModal !== false });
      }
    },
    navigateTo(payload) {
      calls.navigate.push(payload);
    },
    navigateBack() {
      calls.navigate.push({ back: true });
    },
    reLaunch(payload) {
      calls.navigate.push(payload);
    },
    pageScrollTo() {},
    openSetting() {},
    saveImageToPhotosAlbum(payload) {
      if (payload.success) payload.success({});
    },
    canvasToTempFilePath(payload) {
      if (payload.success) payload.success({ tempFilePath: '/tmp/x.png' });
    },
    getWindowInfo() {
      return { pixelRatio: 2, windowWidth: 375 };
    },
    getSystemInfoSync() {
      return { pixelRatio: 2, windowWidth: 375 };
    },
    createSelectorQuery() {
      return {
        in() { return this; },
        select() { return this; },
        fields() { return this; },
        exec(callback) {
          // 模拟拿不到 canvas 节点：页面应当优雅退出而不是崩溃
          callback([null]);
        }
      };
    },
    request(payload) {
      calls.request.push(payload.url);
      // 多个 key 可能同时命中（/bank/subjects/math1/sources/ 既含 subjects 也含 sources），
      // 取最长的那条，才能命中更具体的路由
      const handler = Object.keys(responses)
        .filter((key) => payload.url.indexOf(key) >= 0)
        .sort((a, b) => b.length - a.length)[0];
      if (handler) {
        const result = responses[handler];
        if (result && result.fail) {
          if (payload.fail) payload.fail({ errMsg: result.fail });
          return;
        }
        if (payload.success) payload.success({ statusCode: 200, data: result });
        return;
      }
      if (payload.fail) payload.fail({ errMsg: 'no mock for ' + payload.url });
    }
  };

  return { wx, calls, storage };
}

function loadPage(relativePath, overrides = {}, globals = {}) {
  const filename = path.join(root, 'miniprogram', relativePath);
  const localRequire = createRequire(filename);
  let definition;

  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(request) {
      return Object.prototype.hasOwnProperty.call(overrides, request)
        ? overrides[request]
        : localRequire(request);
    },
    Page(value) { definition = value; },
    wx: globals.wx,
    getCurrentPages: globals.getCurrentPages || (() => []),
    console,
    setTimeout,
    clearTimeout
  }, { filename });

  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value, callback) {
      Object.assign(this.data, value);
      if (typeof callback === 'function') callback();
    }
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------- latex 工具

test('latex：分数套根号不丢结构', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  assert.equal(
    prettify('$y=\\frac{1}{\\sqrt{4-x^{2}}}$'),
    'y=(1)/(√(4-x²))'
  );
});

test('latex：上下标转成可读字符', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  assert.equal(prettify('$x^{2}+y_{1}$'), 'x²+y₁');
  assert.equal(prettify('$\\int_{0}^{1} x dx$'), '∫₀¹ x dx');
});

test('latex：函数名后的空格要保留，不能粘成 sinx', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  assert.equal(prettify('$\\sin x / x$'), 'sin x / x');
  // 多字符下标用 _() 包裹，比硬转成下标字符更可读
  assert.equal(prettify('$\\lim _{x \\to 2} f(x)$'), 'lim _(x → 2) f(x)');
});

test('latex：希腊字母与关系符号', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  assert.equal(prettify('$\\alpha \\leq \\beta$'), 'α ≤ β');
  assert.equal(prettify('$A \\cup B \\subseteq C$'), 'A ∪ B ⊆ C');
});

test('latex：未知命令不残留反斜杠', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  const output = prettify('$\\unknowncmd{abc} + 1$');
  assert.ok(!output.includes('\\'), '不应残留反斜杠，实际：' + output);
  assert.ok(output.includes('abc'), '花括号内容要保留，实际：' + output);
});

test('latex：选项加 ABCD 前缀，答案统一大写数组', () => {
  const { buildOptions, normalizeAnswer } = require('../miniprogram/utils/latex');
  const options = buildOptions(['$1$', '$2$', '$3$', '$4$']);
  assert.deepEqual(options.map((item) => item.letter), ['A', 'B', 'C', 'D']);
  assert.equal(options[1].text, '2');
  assert.deepEqual(normalizeAnswer(['b', 'A']), ['B', 'A']);
  assert.deepEqual(normalizeAnswer('c'), ['C']);
  assert.deepEqual(normalizeAnswer(null), []);
});

// ---------------------------------------------------------------- knowledge 页

test('知识点页：默认进高等数学，左栏 6 项含我的收藏', async () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  assert.equal(page.data.subjectList.length, 6);
  assert.equal(page.data.subjectList[5].id, 'favorites');
  assert.equal(page.data.activeSubject, 'math');
  assert.equal(page.data.books.length, 4);
  assert.equal(page.data.books[0].name, '函数、极限与连续');
});

test('知识点页：切换科目换掉书单', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  page.switchSubject({ currentTarget: { dataset: { id: 'english' } } });
  assert.equal(page.data.activeSubject, 'english');
  assert.equal(page.data.activeName, '英语');
  assert.ok(page.data.books.every((book) => book.id.indexOf('english') === 0));
});

test('知识点页：搜索命中并可以清空', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  page.onSearchInput({ detail: { value: '极限' } });
  assert.equal(page.data.searching, true);
  assert.ok(page.data.searchResults.length > 0, '应搜到含极限的书');
  assert.ok(page.data.searchResults.every((item) => item.subjectName && item.bookName));
  page.clearSearch();
  assert.equal(page.data.searching, false);
  assert.equal(page.data.searchResults.length, 0);
});

test('知识点页：点书带科目与书号跳详情', () => {
  const { wx, calls } = createWx();
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  page.openBook({ currentTarget: { dataset: { id: 'math-limit' } } });
  assert.equal(calls.navigate.length, 1);
  assert.ok(calls.navigate[0].url.indexOf('subjectId=math') >= 0);
  assert.ok(calls.navigate[0].url.indexOf('bookId=math-limit') >= 0);
});

test('知识点页：没有收藏时收藏面板是空的', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  page.switchSubject({ currentTarget: { dataset: { id: 'favorites' } } });
  assert.equal(page.data.isFavoritePanel, true);
  assert.equal(page.data.favoriteGroups.length, 0);
});

test('知识点页：有收藏记录时按书分组', () => {
  const favorites = [
    { key: 'math|math-limit|0', subjectId: 'math', bookId: 'math-limit', index: 0 },
    { key: 'math|math-limit|1', subjectId: 'math', bookId: 'math-limit', index: 1 }
  ];
  const { wx } = createWx({ storage: { 'knowledge-favorites.v1': favorites } });
  const page = loadPage('pages/knowledge/index.js', {}, { wx });
  page.onLoad();
  page.switchSubject({ currentTarget: { dataset: { id: 'favorites' } } });
  assert.equal(page.data.favoriteGroups.length, 1);
  assert.equal(page.data.favoriteGroups[0].count, 2);
  assert.equal(page.data.favoriteGroups[0].bookName, '函数、极限与连续');
});

// ------------------------------------------------------- knowledge-detail 页

test('知识点背诵页：加载指定书的第一条', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  page.onLoad({ subjectId: 'math', bookId: 'math-limit' });
  assert.equal(page.data.total, 4);
  assert.equal(page.data.index, 0);
  assert.equal(page.data.current.topic, '基础概念');
  assert.ok(page.data.current.q.includes('ε-δ'));
});

test('知识点背诵页：翻页不越界', () => {
  const { wx, calls } = createWx();
  const page = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  page.onLoad({ subjectId: 'math', bookId: 'math-limit' });
  page.previous();
  assert.equal(page.data.index, 0);
  assert.ok(calls.toast.some((item) => item.title.indexOf('第一页') >= 0));

  for (let i = 0; i < 3; i += 1) page.next();
  assert.equal(page.data.index, 3);
  page.next();
  assert.equal(page.data.index, 3);
  assert.ok(calls.toast.some((item) => item.title.indexOf('最后一页') >= 0));
});

test('知识点背诵页：答案可以收起再展开', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  page.onLoad({ subjectId: 'math', bookId: 'math-limit' });
  assert.equal(page.data.showAnswer, true);
  page.toggleAnswer();
  assert.equal(page.data.showAnswer, false);
  page.toggleAnswer();
  assert.equal(page.data.showAnswer, true);
});

test('知识点背诵页：收藏写入存储，再点取消', () => {
  const { wx, storage } = createWx();
  const page = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  page.onLoad({ subjectId: 'math', bookId: 'math-limit' });
  page.toggleFavorite();
  assert.equal(page.data.favorited, true);
  assert.equal(storage['knowledge-favorites.v1'].length, 1);
  assert.equal(storage['knowledge-favorites.v1'][0].bookId, 'math-limit');

  page.toggleFavorite();
  assert.equal(page.data.favorited, false);
  assert.equal(storage['knowledge-favorites.v1'].length, 0);
});

test('知识点背诵页：页码选择直接跳页', () => {
  const { wx } = createWx();
  const page = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  page.onLoad({ subjectId: 'math', bookId: 'math-limit' });
  page.onPagePick({ detail: { value: 2 } });
  assert.equal(page.data.index, 2);
  assert.equal(page.data.pageIndex, 2);
});

// ---------------------------------------------------------------- mock 页

function mockResponses() {
  return {
    '/bank/subjects/math1/sources/': {
      results: [{ name: '2024级sd高数一第一章单元测试卷2', questionCount: 20 }]
    },
    '/bank/subjects/english/sources/': {
      results: [{ name: '2027年山东专升本智博教育8月份月考英语试题', questionCount: 50 }]
    },
    '/bank/subjects/': {
      results: [{ id: 'math1', name: '高数一' }, { id: 'english', name: '英语' }]
    }
  };
}

test('模考页：按来源聚合出试卷并识别机构与轮次', async () => {
  const { wx } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.failed, false);
  assert.equal(page.data.exams.length, 2);
  assert.equal(page.data.resultCount, 2);

  const english = page.data.exams.find((item) => item.subjectName === '英语');
  assert.equal(english.agencyName, '智博教育');
  assert.equal(english.count, 50);
  assert.equal(english.round, '平时测试');

  const math = page.data.exams.find((item) => item.subjectName === '高数一');
  assert.equal(math.agencyName, 'sd');
});

test('模考页：按科目筛选与重置', async () => {
  const { wx } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  page.pickSubject({ currentTarget: { dataset: { value: '英语' } } });
  assert.equal(page.data.visible.length, 1);
  assert.equal(page.data.visible[0].subjectName, '英语');

  page.resetFilter();
  assert.equal(page.data.visible.length, 2);
});

test('模考页：按机构筛选分组', async () => {
  const { wx } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  page.pickAgency({ currentTarget: { dataset: { value: '智博教育' } } });
  assert.equal(page.data.groups.length, 1);
  assert.equal(page.data.groups[0].agencyName, '智博教育');
  assert.equal(page.data.groups[0].exams.length, 1);
});

test('模考页：接口挂掉时给出失败态并可重试', async () => {
  const { wx } = createWx({ responses: { '/bank/subjects/': { fail: 'timeout' } } });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();
  assert.equal(page.data.failed, true);
  assert.equal(page.data.loading, false);
});

test('模考页：点开始模考带科目和试卷名跳转', async () => {
  const { wx, calls } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  const target = page.data.exams[0];
  page.startExam({ currentTarget: { dataset: { id: target.id } } });
  assert.equal(calls.navigate.length, 1);
  assert.ok(calls.navigate[0].url.indexOf('subjectId=') >= 0);
  assert.ok(calls.navigate[0].url.indexOf('name=') >= 0);
});

test('模考页：开始新一轮会清除该试卷旧草稿，继续作答保留草稿', async () => {
  const { wx, calls, storage } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();
  const target = page.data.exams[0];
  storage['mock-progress.v1'] = { [target.id]: { answers: { q1: { selected: ['A'] } } } };
  page.startExam({ currentTarget: { dataset: { id: target.id, resume: '1' } } });
  assert.ok(storage['mock-progress.v1'][target.id], '继续作答不应清除草稿');
  page.startExam({ currentTarget: { dataset: { id: target.id, resume: '0' } } });
  assert.deepEqual(storage['mock-progress.v1'], {});
  assert.equal(calls.navigate.length, 2);
});

test('模考页：仅未完成草稿显示进行中与继续作答，完成卷隐藏继续入口', async () => {
  const { wx, storage } = createWx({ responses: mockResponses() });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();
  const [inProgress, completed] = page.data.exams;
  storage['mock-progress.v1'] = { [inProgress.id]: { answers: { q1: { selected: ['A'] } } } };
  storage['mock-results.v1'] = { [completed.id]: { done: true } };
  page.applyFilter();
  const cards = page.data.groups.flatMap((group) => group.exams);
  const resumed = cards.find((item) => item.id === inProgress.id);
  const done = cards.find((item) => item.id === completed.id);
  assert.equal(resumed.status, '进行中');
  assert.equal(resumed.hasProgress, true);
  assert.equal(done.status, '已完成');
  assert.equal(done.hasProgress, false);
  const template = fs.readFileSync(path.join(root, 'miniprogram/pages/mock/index.wxml'), 'utf8');
  assert.match(template, /wx:if="\{\{exam\.hasProgress\}\}" class="action-btn"[^>]*>继续作答/);
});

// ----------------------------------------------------------- mock-paper 页

function paperResponses() {
  return {
    '/bank/questions/': {
      results: [
        {
          id: 'q1', type: 'single', stem: '$x^{2}$ 的导数是？',
          options: ['$x$', '$2x$', '$x^{2}$', '$2$'],
          answer: ['B'], explanation: '幂函数求导'
        },
        {
          id: 'q2', type: 'multiple', stem: '下列属于偶函数的是',
          options: ['$x^{2}$', '$x^{3}$'], answer: ['A'], explanation: ''
        }
      ]
    }
  };
}

test('做题页：题干与选项转成可读文本', async () => {
  const { wx } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  assert.equal(page.data.total, 2);
  assert.equal(page.data.current.stem, 'x² 的导数是？');
  assert.equal(page.data.current.options[1].letter, 'B');
  assert.equal(page.data.current.options[1].text, '2x');
  assert.equal(page.data.current.explanation, '幂函数求导');
});

test('做题页：单选替换选中，多选累加，再点取消', async () => {
  const { wx } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  assert.deepEqual(Array.from(page.data.current.selected), ['A']);
  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  assert.deepEqual(Array.from(page.data.current.selected), ['B'], '单选应替换而不是累加');
  assert.equal(page.data.answeredCount, 1);

  page.jumpTo(1);
  page.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  assert.deepEqual(Array.from(page.data.current.selected), ['A', 'B'], '多选应累加');
  page.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  assert.deepEqual(Array.from(page.data.current.selected), ['B'], '再点应取消');
});

test('做题页：有未答题时提交先弹确认', async () => {
  const { wx, calls } = createWx({ responses: paperResponses(), confirmModal: false });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.submit();
  assert.equal(calls.modal.length, 1);
  assert.ok(calls.modal[0].content.indexOf('2 题未作答') >= 0);
  assert.equal(page.data.view, 'doing', '取消后不应提交');
});

test('做题页：答题卡提交也必须经过确认弹窗', async () => {
  const { wx, calls } = createWx({ responses: paperResponses(), confirmModal: false });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');
  page.submit({ currentTarget: { dataset: { from: 'sheet' } } });
  assert.equal(calls.modal.length, 1);
  assert.equal(page.data.view, 'doing');
});

test('做题页：判分算对错与正确率并写完成记录', async () => {
  const { wx, storage } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  page.jumpTo(1);
  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  page.submit();

  assert.equal(page.data.view, 'result');
  assert.equal(page.data.correctCount, 1);
  assert.equal(page.data.accuracy, 50);
  assert.equal(page.data.questions[0].correct, true);
  assert.equal(page.data.questions[1].correct, false);

  const record = storage['mock-results.v1'];
  const key = Object.keys(record)[0];
  assert.equal(record[key].done, true);
  assert.equal(record[key].correct, 1);
  assert.equal(record[key].total, 2);
});

test('做题页：提交后不能再改答案', async () => {
  const { wx } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  page.jumpTo(1);
  page.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  page.submit();

  page.reviewQuestion({ currentTarget: { dataset: { index: 0 } } });
  page.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  assert.deepEqual(Array.from(page.data.questions[0].selected), ['B'], '已提交的题不应被改写');
});

test('做题页：重新模考清空作答', async () => {
  const { wx } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  page.retake();
  assert.equal(page.data.view, 'doing');
  assert.equal(page.data.index, 0);
  assert.equal(page.data.answeredCount, 0);
  assert.deepEqual(Array.from(page.data.questions[0].selected), []);
});

test('做题页：答题卡跳转', async () => {
  const { wx } = createWx({ responses: paperResponses() });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  await page.load('测试卷');

  page.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  page.jumpFromSheet({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.index, 1);
  assert.equal(page.data.sheetVisible, false);
});

// ------------------------------------------------------------ dictation 页

test('默写板：默认画笔，切工具与笔粗', () => {
  const { wx } = createWx();
  const page = loadPage('pages/dictation/index.js', {}, { wx });
  page.onLoad();
  assert.equal(page.data.tool, 'pen');
  page.pickTool({ currentTarget: { dataset: { value: 'eraser' } } });
  assert.equal(page.data.tool, 'eraser');
  page.pickSize({ currentTarget: { dataset: { value: 10 } } });
  assert.equal(page.data.size, 10);
});

test('默写板：选颜色会切回画笔', () => {
  const { wx } = createWx();
  const page = loadPage('pages/dictation/index.js', {}, { wx });
  page.onLoad();
  page.pickTool({ currentTarget: { dataset: { value: 'eraser' } } });
  page.pickColor({ currentTarget: { dataset: { value: '#e4564f' } } });
  assert.equal(page.data.color, '#e4564f');
  assert.equal(page.data.tool, 'pen');
});

test('默写板：canvas 不可用时绘制与撤销不崩', () => {
  const { wx, calls } = createWx();
  const page = loadPage('pages/dictation/index.js', {}, { wx });
  page.onLoad();
  page.onReady();          // 拿不到 canvas 节点
  page.onTouchStart({ touches: [{ x: 10, y: 10 }] });
  page.undo();             // 没有笔迹
  assert.ok(calls.toast.some((item) => item.title.indexOf('没有可撤销') >= 0));
});

test('默写板：清空需要确认', () => {
  const { wx, calls } = createWx({ confirmModal: true });
  const page = loadPage('pages/dictation/index.js', {}, { wx });
  page.onLoad();
  page.strokes = [{ color: '#000', size: 6, points: [{ x: 1, y: 1 }] }];
  page.clear();
  assert.equal(calls.modal.length, 1);
  assert.equal(page.strokes.length, 0);
  assert.equal(page.data.hasStroke, false);
});

// ---------------------------------------------------------------- cert 页

test('资格证书页：默认教师资格，切换后换文案', () => {
  const { wx } = createWx();
  const page = loadPage('pages/cert/index.js', {}, { wx });
  page.onLoad();
  assert.equal(page.data.activeId, 'teacher');
  assert.equal(page.data.active.name, '教师资格');
  assert.equal(page.data.types.length, 3);

  page.pickCert({ currentTarget: { dataset: { id: 'ncre' } } });
  assert.equal(page.data.active.name, '计算机等级');
  assert.equal(page.data.hasContent, false, '内容未到位时不应标记为有内容');
});

test('资格证书页：题型入口给出待上线提示', () => {
  const { wx, calls } = createWx();
  const page = loadPage('pages/cert/index.js', {}, { wx });
  page.onLoad();
  page.startType({ currentTarget: { dataset: { name: '单选题' } } });
  assert.equal(calls.modal.length, 1);
  assert.ok(calls.modal[0].title.indexOf('单选题') >= 0);
});

test('资格证书页：进背诵页带证书号', () => {
  const { wx, calls } = createWx();
  const page = loadPage('pages/cert/index.js', {}, { wx });
  page.onLoad();
  page.pickCert({ currentTarget: { dataset: { id: 'mandarin' } } });
  page.openRecite();
  assert.equal(calls.navigate.length, 1);
  assert.ok(calls.navigate[0].url.indexOf('certId=mandarin') >= 0);
});

// ------------------------------------------------------------ cert-recite 页

test('证书背诵页：内容为空时显示空态', () => {
  const { wx } = createWx();
  const page = loadPage('pages/cert-recite/index.js', {}, { wx });
  page.onLoad({ certId: 'accounting' });
  assert.equal(page.data.certName, '会计');
  assert.equal(page.data.isEmpty, true);
});

// ------------------------------------------------------- 跨页面流程（集成）

test('完整流程：选书 → 背诵 → 收藏 → 回收藏面板能看到', () => {
  const { wx, storage, calls } = createWx();

  // 1. 知识点页点开一本书
  const list = loadPage('pages/knowledge/index.js', {}, { wx });
  list.onLoad();
  list.openBook({ currentTarget: { dataset: { id: 'math-derivative' } } });
  assert.equal(calls.navigate.length, 1);

  const url = calls.navigate[0].url;
  const query = {};
  url.split('?')[1].split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    query[key] = decodeURIComponent(value);
  });
  assert.equal(query.subjectId, 'math');
  assert.equal(query.bookId, 'math-derivative');

  // 2. 背诵页用这个参数打开，收藏第一条
  const detail = loadPage('pages/knowledge-detail/index.js', {}, { wx });
  detail.onLoad(query);
  assert.equal(detail.data.total, 4);
  assert.equal(detail.data.bookName, '一元函数微分学');
  detail.toggleFavorite();
  assert.equal(storage['knowledge-favorites.v1'].length, 1);

  // 3. 回到列表页的收藏面板
  const back = loadPage('pages/knowledge/index.js', {}, { wx });
  back.onLoad();
  back.switchSubject({ currentTarget: { dataset: { id: 'favorites' } } });
  assert.equal(back.data.favoriteGroups.length, 1);
  assert.equal(back.data.favoriteGroups[0].bookName, '一元函数微分学');
  assert.equal(back.data.favoriteGroups[0].subjectName, '高等数学');
  assert.equal(back.data.favoriteGroups[0].count, 1);
});

test('完整流程：模考列表 → 做题 → 判分 → 回列表显示已完成', async () => {
  const { wx, storage } = createWx({
    responses: Object.assign(mockResponses(), paperResponses())
  });

  // 1. 列表页拿到试卷
  const list = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await list.load();
  assert.equal(list.data.exams.length, 2);
  const target = list.data.exams.find((item) => item.subjectName === '英语');

  // 2. 做题页按真实入口参数打开（onLoad 会先落 subjectId 再取题）
  const paper = loadPage('pages/mock-paper/index.js', {}, { wx });
  paper.onLoad({ subjectId: target.subjectId, name: encodeURIComponent(target.name) });
  await flush();
  assert.equal(paper.data.subjectId, target.subjectId);
  assert.equal(paper.data.total, 2);
  paper.pickOption({ currentTarget: { dataset: { letter: 'B' } } });
  paper.jumpTo(1);
  paper.pickOption({ currentTarget: { dataset: { letter: 'A' } } });
  paper.submit();
  assert.equal(paper.data.view, 'result');
  assert.equal(paper.data.correctCount, 2);
  assert.equal(paper.data.accuracy, 100);

  // 3. 回列表页，状态变成已完成（status 由 applyFilter 生成，挂在 groups 上）
  const back = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await back.load();
  const shown = back.data.groups.reduce((all, group) => all.concat(group.exams), []);
  const same = shown.find((item) => item.subjectName === '英语');
  assert.equal(same.status, '已完成');
  assert.equal(same.statusClass, 'status-done');
  assert.ok(storage['mock-results.v1'][same.id].done);
});

// ------------------------------------------------- 模考来源归一化（联调发现）

function fragmentResponses(fragments, subjects) {
  return {
    // 用完整路径做 key：/bank/subjects/ 会同时命中科目列表和来源两个请求
    '/bank/subjects/math1/sources/': { results: fragments },
    '/bank/subjects/': { results: subjects || [{ id: 'math1', name: '高数一' }] }
  };
}

test('模考页：带「第N题」的碎片合并成一套卷', async () => {
  const { wx } = createWx({
    responses: fragmentResponses([
      { name: '【2026（23级）师大二模 高数一 第1题】', questionCount: 1 },
      { name: '【2026（23级）师大二模 高数一 第2题】', questionCount: 1 },
      { name: '【2026（23级）师大二模 高数一 第3题】', questionCount: 1 },
      { name: '【2026（23级）师大二模 高数一 第4题】', questionCount: 1 }
    ])
  });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  assert.equal(page.data.exams.length, 1, '四道碎片应合并成一套卷');
  const exam = page.data.exams[0];
  assert.equal(exam.name, '【2026（23级）师大二模 高数一】', '卷名要去掉题号');
  assert.equal(exam.count, 4);
  assert.equal(exam.sources.length, 4, '要记住四个原始来源，做题时逐个取');
  assert.equal(exam.agencyName, '师大');
  assert.equal(exam.round, '二模');
});

test('模考页：题数不足 3 的碎片不进列表', async () => {
  const { wx } = createWx({
    responses: fragmentResponses([
      { name: '【2026（23级）智博一模 高数一 第1题】', questionCount: 1 },
      { name: '【2026（23级）智博一模 高数一 第2题】', questionCount: 1 },
      { name: '【2026（23级）智博一模 高数一 第3题】', questionCount: 1 },
      { name: '【2020山东高数三】', questionCount: 1 }
    ])
  });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  assert.equal(page.data.exams.length, 1, '只剩合并后 3 题的那套');
  assert.equal(page.data.exams[0].count, 3);
});

test('模考页：全都不足 3 题时退回展示全部，避免空列表', async () => {
  const { wx } = createWx({
    responses: fragmentResponses([
      { name: '【2020山东高数三】', questionCount: 1 },
      { name: '【2021山东高数三】', questionCount: 2 }
    ])
  });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  assert.equal(page.data.exams.length, 2, '全被过滤时不能给用户一个空页面');
});

test('模考页：历年真题按【年份】归到历年真题，不落到其他机构', async () => {
  const { wx } = createWx({
    responses: fragmentResponses([
      { name: '【2020山东高数三】', questionCount: 5 },
      { name: '【2021山东高数三】', questionCount: 5 }
    ])
  });
  const page = loadPage('pages/mock/index.js', { '../../services/api': {} }, { wx });
  await page.load();

  assert.ok(page.data.exams.every((exam) => exam.agencyName === '历年真题'));
  const names = page.data.agencies.map((item) => item.name);
  assert.ok(names.indexOf('历年真题') >= 0, '机构筛选项要包含历年真题');
});

test('做题页：多个来源合并后按题目 id 去重', async () => {
  const { wx } = createWx({
    responses: {
      '/bank/questions/': {
        results: [
          { id: 'q1', type: 'single', stem: '题目一', options: ['甲', '乙'], answer: ['A'], explanation: '' },
          { id: 'q2', type: 'single', stem: '题目二', options: ['丙', '丁'], answer: ['B'], explanation: '' }
        ]
      }
    }
  });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  page.onLoad({
    subjectId: 'math1',
    name: encodeURIComponent('【2026（23级）师大二模 高数一】'),
    sources: encodeURIComponent('碎片一|碎片二|碎片三')
  });
  await flush();

  assert.equal(page.data.total, 2, '三个来源各返回同样两题，去重后应为两题');
  assert.equal(page.data.questions[0].id, 'q1');
  assert.equal(page.data.questions[1].id, 'q2');
});

test('做题页：没有 sources 参数时退回用卷名查', async () => {
  const { wx, calls } = createWx({
    responses: {
      '/bank/questions/': {
        results: [{ id: 'q1', type: 'single', stem: '题', options: ['甲'], answer: ['A'], explanation: '' }]
      }
    }
  });
  const page = loadPage('pages/mock-paper/index.js', {}, { wx });
  page.onLoad({ subjectId: 'english', name: encodeURIComponent('2027年山东专升本智博教育8月份月考英语试题') });
  await flush();

  assert.equal(page.data.total, 1);
  assert.equal(calls.request.length, 1);
  assert.ok(calls.request[0].indexOf('source=') >= 0, '要带上 source 参数');
});

test('latex：填空题的连续下划线不当下标吞掉', () => {
  const { prettify } = require('../miniprogram/utils/latex');
  assert.equal(
    prettify('Sharing humor __________ a sense of closeness.'),
    'Sharing humor __________ a sense of closeness.'
  );
  // 但真正的下标要照常处理
  assert.equal(prettify('$a_{n+1} = a_n + 1$'), 'aₙ₊₁ = aₙ + 1');
});

test('latex：选项超过 8 个时字母继续往后排（英语选词填空 12 个词）', () => {
  const { buildOptions, normalizeAnswer } = require('../miniprogram/utils/latex');
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const options = buildOptions(words);
  assert.equal(options.length, 12);
  assert.equal(options[8].letter, 'I');
  assert.equal(options[11].letter, 'L');

  // 答案 J 必须能对上第 10 个选项，不能变成数字编号
  const answer = normalizeAnswer(['J']);
  const hit = options.filter((item) => answer.indexOf(item.letter) >= 0);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].text, 'j');
});
