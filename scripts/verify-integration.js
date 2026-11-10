// 联调验证：用真实后端跑模考页的组装逻辑与做题页的多来源合并。
// 前提：backend 已在 127.0.0.1:8000 运行。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');

function loadPage(relativePath, wxMock) {
  const filename = path.join(root, 'miniprogram', relativePath);
  const localRequire = createRequire(filename);
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: (request) => (request === '../../services/api' ? {} : localRequire(request)),
    Page(value) { definition = value; },
    wx: wxMock,
    getCurrentPages: () => [],
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

function wxWithFetch(storage) {
  return {
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    showToast() {},
    showModal() {},
    navigateTo() {},
    navigateBack() {},
    reLaunch() {},
    pageScrollTo() {},
    request(payload) {
      fetch(payload.url)
        .then((res) => res.json())
        .then((data) => payload.success({ statusCode: 200, data }))
        .catch((error) => payload.fail && payload.fail({ errMsg: error.message }));
    }
  };
}

(async () => {
  const storage = {};

  console.log('=== 模考列表 ===');
  const list = loadPage('pages/mock/index.js', wxWithFetch(storage));
  await list.load();

  if (list.data.failed) {
    console.log('加载失败');
    process.exit(1);
  }

  console.log('聚合试卷数:', list.data.exams.length);
  console.log('机构筛选项:', list.data.agencies.map((a) => a.name).join(' / '));
  console.log('科目筛选项:', list.data.subjects.map((s) => s.name).join(' / '));
  console.log('');

  const byAgency = {};
  list.data.exams.forEach((exam) => {
    byAgency[exam.agencyName] = byAgency[exam.agencyName] || [];
    byAgency[exam.agencyName].push(exam);
  });
  Object.keys(byAgency).forEach((agency) => {
    const group = byAgency[agency];
    console.log(`[${agency}] ${group.length} 套，题数 ${group.map((e) => e.count).join(',')}`);
    group.slice(0, 3).forEach((exam) => {
      console.log(`   ${exam.subjectName} | ${exam.round} | ${exam.count} 题 | ${exam.name}`);
      console.log(`      来源碎片: ${exam.sources.length} 个`);
    });
  });

  console.log('');
  console.log('=== 单题卷检查（题数=1 的卷）===');
  const single = list.data.exams.filter((exam) => exam.count === 1);
  console.log('数量:', single.length);

  console.log('');
  console.log('=== 做题页多来源合并 ===');
  const target = list.data.exams.find((exam) => exam.sources.length > 1) || list.data.exams[0];
  console.log('目标卷:', target.name);
  console.log('来源碎片数:', target.sources.length);
  console.log('列表显示题数:', target.count);

  const paper = loadPage('pages/mock-paper/index.js', wxWithFetch(storage));
  paper.onLoad({
    subjectId: target.subjectId,
    name: encodeURIComponent(target.name),
    sources: encodeURIComponent(target.sources.join('|'))
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log('做题页实际取到:', paper.data.total, '题');
  console.log('状态:', paper.data.failed ? '失败' : '正常');
  if (paper.data.current) {
    console.log('第一题题干:', paper.data.current.stem.slice(0, 50));
    console.log('第一题选项:', paper.data.current.options.map((o) => o.letter + '.' + o.text).join(' | ').slice(0, 70));
  }
  console.log('');
  console.log('题数一致:', paper.data.total === target.count ? '是' : `否（列表 ${target.count}，实取 ${paper.data.total}）`);
})();
