const api = require('../../services/api');

const apiConfig = require('../../services/api-config');
const { getNavigationMetrics } = require('../../utils/safe-top');
// 后端地址统一从 services/api-config.js 取，换服务器只改那一处
function bankApiBase() { return apiConfig.getApiBaseUrl() + '/api/student/v1'; }
const RESULT_KEY = 'mock-results.v1';

const ROUNDS = ['全部', '平时测试', '一模', '二模', '三模', '四模'];

// 机构关键词：命中即归到该机构。顺序有意义，先匹配到的优先。
const AGENCY_RULES = [
  { id: 'zhibo', name: '智博教育', keys: ['智博'] },
  { id: 'shida', name: '师大', keys: ['师大'] },
  { id: 'yanshuo', name: '研硕', keys: ['研硕'] },
  { id: 'dasheng', name: '大圣', keys: ['大圣'] },
  { id: 'haina', name: '海纳', keys: ['海纳'] },
  { id: 'sd', name: 'sd', keys: ['sd'] },
  { id: 'hn', name: 'hn', keys: ['hn'] }
];

const AGENCY_FALLBACK = '其他机构';

// 题库里的历年真题大多是 1~3 题的碎片，全部铺开会有几十个「1 题的试卷」。
// 低于这个题数的不进列表；若某次过滤后一套不剩，则退回展示全部。
const MIN_QUESTION_COUNT = 3;

function readResults() {
  try {
    const raw = wx.getStorageSync(RESULT_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function readProgress() {
  try {
    const raw = wx.getStorageSync('mock-progress.v1');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

// 题库的 source_label 精确到单题，形如「【2026（23级）师大二模 高数一 第3题】」。
// 直接按它分组会把一套卷拆成 4~5 个「1 题的试卷」，所以先去掉题号后缀再归并。
function normalizeSource(name) {
  return String(name || '')
    .replace(/\s*第\s*\d+\s*题/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function detectRound(name) {
  const text = String(name || '');
  if (text.includes('四模')) return '四模';
  if (text.includes('三模')) return '三模';
  if (text.includes('二模')) return '二模';
  if (text.includes('一模')) return '一模';
  return '平时测试';
}

function detectAgency(name) {
  const text = String(name || '').toLowerCase();
  for (const rule of AGENCY_RULES) {
    if (rule.keys.some((key) => text.includes(key))) return { id: rule.id, name: rule.name };
  }
  // 形如「【2023山东高数一】」的是历年真题
  if (/^【\d{4}/.test(text)) return { id: 'past', name: '历年真题' };
  return { id: 'other', name: AGENCY_FALLBACK };
}

function request(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: bankApiBase() + path,
      method: 'GET',
      timeout: 8000,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(new Error('HTTP ' + response.statusCode));
      },
      fail: (error) => reject(new Error(error && error.errMsg ? error.errMsg : 'NETWORK_ERROR'))
    });
  });
}

Page({
  data: {
    statusHeight: 24,
    navBarHeight: 58,
    loading: true,
    failed: false,
    exams: [],
    visible: [],
    groups: [],
    rounds: ROUNDS,
    subjects: [{ id: '全部', name: '全部' }],
    agencies: [{ id: '全部', name: '全部' }],
    round: '全部',
    subject: '全部',
    agency: '全部',
    resultCount: 0
  },

  onLoad() {
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    this.setData({
      statusHeight: metrics.statusHeight || 24,
      navBarHeight: metrics.barHeight || 58
    });
    this.load();
  },

  onShow() {
    // 从做题页返回时刷新状态标签
    if (!this.data.loading && !this.data.failed) this.applyFilter();
  },

  async load() {
    this.setData({ loading: true, failed: false });
    try {
      const subjectPayload = await request('/bank/subjects/');
      const subjects = (subjectPayload && subjectPayload.results) || [];
      const lists = await Promise.all(
        subjects.map((subject) =>
          request('/bank/subjects/' + encodeURIComponent(subject.id) + '/sources/')
            .then((payload) => ({ subject, rows: (payload && payload.results) || [] }))
            .catch(() => ({ subject, rows: [] }))
        )
      );
      const buckets = new Map();
      lists.forEach(({ subject, rows }) => {
        rows.forEach((row) => {
          const raw = row.name || '';
          if (!raw) return;
          const normalized = normalizeSource(raw);
          if (!normalized) return;
          const key = subject.id + '::' + normalized;
          let bucket = buckets.get(key);
          if (!bucket) {
            const agency = detectAgency(normalized);
            bucket = {
              id: key,
              name: normalized,
              subjectId: subject.id,
              subjectName: subject.name,
              count: 0,
              sources: [],
              round: detectRound(normalized),
              agencyId: agency.id,
              agencyName: agency.name
            };
            buckets.set(key, bucket);
          }
          bucket.count += row.questionCount || 0;
          if (bucket.sources.indexOf(raw) < 0) bucket.sources.push(raw);
        });
      });

      const all = Array.from(buckets.values());
      const enough = all.filter((exam) => exam.count >= MIN_QUESTION_COUNT);
      const exams = enough.length ? enough : all;
      exams.sort((a, b) => (b.count || 0) - (a.count || 0));

      // 机构筛选项按实际出现的机构生成，避免出现空分类
      const agencyNames = [];
      exams.forEach((exam) => {
        if (agencyNames.indexOf(exam.agencyName) < 0) agencyNames.push(exam.agencyName);
      });

      this.setData({
        loading: false,
        exams,
        subjects: ['全部']
          .concat(subjects.map((subject) => subject.name))
          .map((name) => ({ name })),
        agencies: ['全部'].concat(agencyNames).map((name) => ({ name }))
      });
      this.applyFilter();
    } catch (error) {
      this.setData({ loading: false, failed: true });
    }
  },

  applyFilter() {
    const { exams, round, subject, agency } = this.data;
    const results = readResults();
    const progress = readProgress();
    const visible = exams.filter((exam) => {
      if (round !== '全部' && exam.round !== round) return false;
      if (subject !== '全部' && exam.subjectName !== subject) return false;
      if (agency !== '全部' && exam.agencyName !== agency) return false;
      return true;
    }).map((exam) => {
      const record = results[exam.id];
      const saved = progress[exam.id];
      const hasProgress = Boolean(saved && saved.answers && Object.keys(saved.answers).length);
      return Object.assign({}, exam, {
        status: record && record.done ? '已完成' : (hasProgress ? '进行中' : '未作答'),
        statusClass: record && record.done ? 'status-done' : (hasProgress ? 'status-progress' : ''),
        hasProgress: !(record && record.done) && hasProgress
      });
    });

    const groups = [];
    visible.forEach((exam) => {
      let group = groups.find((entry) => entry.agencyName === exam.agencyName);
      if (!group) {
        group = { agencyName: exam.agencyName, exams: [] };
        groups.push(group);
      }
      group.exams.push(exam);
    });

    this.setData({ visible, groups, resultCount: visible.length });
  },

  pickRound(event) {
    this.setData({ round: event.currentTarget.dataset.value }, () => this.applyFilter());
  },

  pickSubject(event) {
    this.setData({ subject: event.currentTarget.dataset.value }, () => this.applyFilter());
  },

  pickAgency(event) {
    this.setData({ agency: event.currentTarget.dataset.value }, () => this.applyFilter());
  },

  resetFilter() {
    this.setData({ round: '全部', subject: '全部', agency: '全部' }, () => this.applyFilter());
  },

  startExam(event) {
    const dataset = event.currentTarget.dataset || {};
    const id = dataset.id;
    const exam = this.data.exams.find((item) => item.id === id);
    if (!exam) return;
    // 一套卷可能由多个原始 source_label 拼成（题目级来源），要把它们都带上
    const sources = (exam.sources && exam.sources.length ? exam.sources : [exam.name]).join('|');
    const resume = String(dataset.resume) === '1' ? '1' : '0';
    if (resume !== '1') {
      try {
        const all = wx.getStorageSync('mock-progress.v1') || {};
        delete all[exam.id];
        wx.setStorageSync('mock-progress.v1', all);
      } catch (_) { /* 无法清除旧草稿时仍允许开始新一轮 */ }
    }
    wx.navigateTo({
      url: '/pages/mock-paper/index?subjectId=' + exam.subjectId +
        '&examId=' + encodeURIComponent(exam.id) +
        '&name=' + encodeURIComponent(exam.name) +
        '&sources=' + encodeURIComponent(sources) +
        '&resume=' + resume
    });
  },

  retry() {
    this.load();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  }
});
