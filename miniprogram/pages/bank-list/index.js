const apiConfig = require('../../services/api-config');
const { getNavigationMetrics } = require('../../utils/safe-top');
const progress = require('../../utils/bank-progress');
const richtext = require('../../utils/rich-text');
const questionType = require('../../utils/question-type');
const { decodeParam } = require('../../utils/params');

function bankApiBase() { return apiConfig.getApiBaseUrl() + '/api/student/v1'; }

function request(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: bankApiBase() + path,
      method: 'GET',
      timeout: 12000,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(new Error('HTTP ' + response.statusCode));
      },
      fail: reject
    });
  });
}

const PAGE_SIZE = 48;
const MODE_NAMES = { quick: '简练刷题', chapter: '章节练习', exam: '真题练习', recite: '背诵' };
const STATE_NAMES = { all: '全部', done: '已做', todo: '未做', wrong: '做错', fav: '收藏' };

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

Page({
  data: {
    statusHeight: 24,
    navBarHeight: 58,
    subjectId: '',
    subjectName: '',
    mode: 'quick',
    recite: false,
    scope: '',
    title: '题库',
    state: 'all',
    states: [
      { id: 'all', name: '全部', count: 0 },
      { id: 'done', name: '已做', count: 0 },
      { id: 'todo', name: '未做', count: 0 },
      { id: 'wrong', name: '做错', count: 0 },
      { id: 'fav', name: '收藏', count: 0 }
    ],
    chapters: [],
    chapterIndex: 0,
    sections: [],
    sectionIndex: 0,
    subjects: [],
    subjectIndex: 0,
    sources: [],
    sourceIndex: 0,
    chapter: '',
    section: '',
    source: '',
    keyword: '',
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
    rangeText: '',
    filtered: 0,
    loading: false,
    emptyText: '这里还没有题目',
    canClear: true
  },

  onLoad(options) {
    const opts = options || {};
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    const scope = String(opts.scope || '');
    let mode = String(opts.mode || (scope ? '' : 'quick'));
    const reciteFlag = String(opts.recite || '');
    const recite = reciteFlag === '1' || reciteFlag === 'recite' || mode === 'recite';
    if (mode === 'recite') mode = 'quick';
    const subjectName = decodeParam(opts.name);
    const subjectId = opts.subject || '';
    const titleTail = scope === 'wrong' ? '错题本'
      : scope === 'fav' ? '收藏本'
        : (recite ? '背诵' : (MODE_NAMES[mode] || '题库'));

    this.setData({
      statusHeight: metrics.statusHeight || 24,
      navBarHeight: metrics.barHeight || 58,
      subjectId,
      subjectName,
      scope,
      mode,
      recite,
      canClear: !scope,
      title: subjectName + ' · ' + titleTail
    });

    if (!subjectId) {
      this.setData({ emptyText: '缺少科目参数', loading: false });
      return;
    }

    this._items = [];
    if (scope === 'wrong') {
      this.setData({ state: 'wrong', emptyText: '错题本还是空的' });
      this.loadLocal();
      return;
    }
    if (scope === 'fav') {
      this.setData({ state: 'fav', emptyText: '收藏本还是空的' });
      this.loadLocal();
      return;
    }

    this.loadFilters().then(() => this.loadPage());
  },

  pageTitle(name) {
    const subject = name || this.data.subjectName;
    if (this.data.scope === 'wrong') return subject + ' · 错题本';
    if (this.data.scope === 'fav') return subject + ' · 收藏本';
    return subject + ' · ' + (this.data.recite ? '背诵' : (MODE_NAMES[this.data.mode] || '题库'));
  },

  onShow() {
    if (this._needRefresh) {
      this._needRefresh = false;
      this.refreshView();
    }
  },

  /* ---------------- 筛选条件 ---------------- */

  async loadFilters() {
    const subjectId = this.data.subjectId;
    try {
      const subjectsData = await request('/bank/subjects/');
      const subjects = (subjectsData.results || []).map((item) => ({ id: item.id, name: item.name }));
      const at = subjects.findIndex((item) => item.id === subjectId);
      this.setData({ subjects, subjectIndex: at >= 0 ? at : 0 });
    } catch (_) { /* 科目列表失败时只保留当前科目 */ }

    try {
      const data = await request('/bank/subjects/' + encodeURIComponent(subjectId) + '/chapters/');
      const chapters = [{ title: '全部章节', value: '', sections: [] }].concat(
        (data.results || []).map((item) => ({
          title: item.title,
          value: item.title,
          sections: item.sections || []
        }))
      );
      this.setData({
        chapters,
        sections: [{ title: '全部小节', value: '' }],
        subjectName: (data.subject && data.subject.name) || this.data.subjectName,
        title: this.pageTitle((data.subject && data.subject.name) || this.data.subjectName)
      });
    } catch (_) {
      this.setData({ chapters: [{ title: '全部章节', value: '', sections: [] }] });
    }

    if (this.data.mode === 'exam') {
      try {
        const data = await request('/bank/subjects/' + encodeURIComponent(subjectId) + '/sources/');
        const sources = [{ title: '全部试卷', value: '' }].concat(
          (data.results || []).map((item) => ({ title: item.name, value: item.name, count: item.questionCount }))
        );
        this.setData({ sources });
      } catch (_) {
        this.setData({ sources: [{ title: '全部试卷', value: '' }] });
      }
    }
  },

  async onSubjectChange(event) {
    const index = toNumber(event.detail.value);
    const subject = this.data.subjects[index];
    if (!subject || subject.id === this.data.subjectId) return;
    this.setData({
      subjectIndex: index,
      subjectId: subject.id,
      subjectName: subject.name,
      chapterIndex: 0,
      chapter: '',
      sectionIndex: 0,
      section: '',
      sourceIndex: 0,
      source: '',
      page: 1,
      title: this.pageTitle(subject.name)
    }, async () => {
      await this.loadFilters();
      this.refreshView();
    });
  },

  onChapterChange(event) {
    const index = toNumber(event.detail.value);
    const chapter = this.data.chapters[index] || {};
    const sections = [{ title: '全部小节', value: '' }].concat(
      (chapter.sections || []).map((item) => ({ title: item.title, value: item.title, count: item.count }))
    );
    this.setData({
      chapterIndex: index,
      chapter: chapter.value || '',
      sections,
      sectionIndex: 0,
      section: '',
      page: 1
    }, () => this.refreshView());
  },

  onSectionChange(event) {
    const index = toNumber(event.detail.value);
    const section = this.data.sections[index] || {};
    this.setData({ sectionIndex: index, section: section.value || '', page: 1 }, () => this.refreshView());
  },

  onSourceChange(event) {
    const index = toNumber(event.detail.value);
    const source = this.data.sources[index] || {};
    this.setData({ sourceIndex: index, source: source.value || '', page: 1 }, () => this.refreshView());
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value || '' }, () => this.applyKeyword());
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.applyKeyword());
  },

  pickState(event) {
    const state = event.currentTarget.dataset.state;
    if (!state || state === this.data.state) return;
    this.setData({ state, page: 1 }, () => this.refreshView());
  },

  /* ---------------- 数据装载 ---------------- */

  scopeQuery() {
    const parts = ['subject=' + encodeURIComponent(this.data.subjectId)];
    if (this.data.chapter) parts.push('chapter=' + encodeURIComponent(this.data.chapter));
    if (this.data.section) parts.push('section=' + encodeURIComponent(this.data.section));
    if (this.data.source) parts.push('source=' + encodeURIComponent(this.data.source));
    if (this.data.mode === 'quick' && !this.data.chapter && !this.data.source) parts.push('kind=choice');
    return parts.join('&');
  },

  refreshView() {
    const state = this.data.state;
    if (state === 'done' || state === 'wrong' || state === 'fav') {
      this.loadLocal();
    } else {
      this.loadPage();
    }
  },

  async loadPage() {
    this.setData({ loading: true });
    this._localList = null;
    const offset = (this.data.page - 1) * this.data.pageSize;
    try {
      const data = await request('/bank/questions/?' + this.scopeQuery() +
        '&limit=' + this.data.pageSize + '&offset=' + offset);
      const total = toNumber(data.count);
      const base = toNumber(data.offset) || offset;
      const records = progress.readRecords(this.data.subjectId);
      const favIds = {};
      progress.readFavorites(this.data.subjectId).forEach((item) => { favIds[item.id] = true; });
      const raw = data.results || [];
      const items = raw.map((question, index) => this.decorate(question, base + index + 1, records, favIds));
      this._items = items;
      const totalPages = Math.max(1, Math.ceil(total / this.data.pageSize));
      this.setData({
        items,
        total,
        totalPages,
        loading: false,
        emptyText: '这里还没有题目',
        rangeText: '第 ' + this.data.page + ' 页 · 共 ' + items.length + ' 题'
      }, () => {
        this.applyKeyword(true);
        this.updateCounts();
      });
    } catch (_) {
      this.setData({ loading: false, items: [], emptyText: '题库连接失败，请确认后端已启动' });
    }
  },

  loadLocal() {
    const subjectId = this.data.subjectId;
    const scope = { chapter: this.data.chapter, section: this.data.section, source: this.data.source };
    let list = [];

    if (this.data.scope === 'wrong') {
      list = progress.readWrong(subjectId);
    } else if (this.data.scope === 'fav') {
      list = progress.readFavorites(subjectId);
    } else if (this.data.state === 'wrong') {
      list = progress.recordsInScope(subjectId, scope).filter((item) => item.wrong && item.snapshot).map((item) => Object.assign({ number: item.number }, item.snapshot));
    } else if (this.data.state === 'fav') {
      list = progress.readFavorites(subjectId);
    } else {
      list = progress.recordsInScope(subjectId, scope).filter((item) => item.snapshot).map((item) => Object.assign({ number: item.number }, item.snapshot));
    }

    list = list.filter((item) => {
      if (this.data.chapter && item.chapter !== this.data.chapter) return false;
      if (this.data.section && item.section !== this.data.section) return false;
      if (this.data.source && item.source !== this.data.source) return false;
      return true;
    });

    const records = progress.readRecords(subjectId);
    const favIds = {};
    progress.readFavorites(subjectId).forEach((item) => { favIds[item.id] = true; });
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / this.data.pageSize));
    const page = Math.min(this.data.page, totalPages);
    const start = (page - 1) * this.data.pageSize;
    const items = list.slice(start, start + this.data.pageSize)
      .map((question, index) => this.decorate(question, toNumber(question.number) || start + index + 1, records, favIds));

    this._items = items;
    this._localList = list;
    this.setData({
      items,
      total,
      page,
      totalPages,
      loading: false,
      emptyText: this.data.state === 'done' ? '还没有做过的题目' : this.data.state === 'wrong' ? '还没有做错的题目' : '收藏本还是空的',
      rangeText: '第 ' + page + ' 页 · 共 ' + items.length + ' 题'
    }, () => {
      this.applyKeyword(true);
      this.updateCounts();
    });
  },

  decorate(question, number, records, favIds) {
    const record = records[question.id] || {};
    return {
      id: question.id,
      number,
      done: record.done === true,
      wrong: record.wrong === true,
      favorite: record.favorite === true || Boolean(favIds && favIds[question.id]),
      preview: richtext.plainText(question.stem || '').slice(0, 46),
      question
    };
  },

  applyKeyword(keepTotal) {
    const keyword = (this.data.keyword || '').trim();
    const base = this._items || [];
    let items = base;
    if (keyword) {
      const lower = keyword.toLowerCase();
      items = base.filter((item) => item.preview.toLowerCase().indexOf(lower) >= 0 || String(item.number).indexOf(keyword) >= 0);
    }
    if (this.data.state === 'todo' && !this._localList) {
      items = items.filter((item) => !item.done);
    }
    this.setData({
      items,
      filtered: items.length,
      rangeText: '第 ' + this.data.page + ' 页 · 共 ' + items.length + ' 题'
    });
    if (!keepTotal) return;
  },

  updateCounts() {
    const subjectId = this.data.subjectId;
    const scope = { chapter: this.data.chapter, section: this.data.section, source: this.data.source };
    const localAll = progress.recordsInScope(subjectId, scope);
    const done = localAll.filter((item) => item.done).length;
    const wrong = localAll.filter((item) => item.wrong).length;
    const fav = localAll.filter((item) => item.favorite).length;
    const total = this.data.total || 0;
    const states = [
      { id: 'all', name: '全部', count: total },
      { id: 'done', name: '已做', count: done },
      { id: 'todo', name: '未做', count: Math.max(0, total - done) },
      { id: 'wrong', name: '做错', count: wrong },
      { id: 'fav', name: '收藏', count: fav }
    ];
    this.setData({
      states,
      totalText: total,
      summary: '共 ' + total + ' 题'
    });
  },

  /* ---------------- 交互 ---------------- */

  prevPage() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 }, () => this.refreshView());
  },

  nextPage() {
    if (this.data.page >= this.data.totalPages) return;
    this.setData({ page: this.data.page + 1 }, () => this.refreshView());
  },

  openQuestion(event) {
    const index = toNumber(event.currentTarget.dataset.index);
    const items = this.data.items || [];
    const target = items[index];
    if (!target) return;

    const queue = items.map((item) => Object.assign({ number: item.number }, item.question || {}));
    try {
      wx.setStorageSync('bank-queue', JSON.stringify({
        subject: this.data.subjectId,
        subjectName: this.data.subjectName,
        mode: this.data.mode,
        scope: this.data.scope,
        state: this.data.state,
        chapter: this.data.chapter,
        chapterName: (this.data.chapters[this.data.chapterIndex] || {}).title || '',
        section: this.data.section,
        title: this.data.title,
        items: queue
      }));
    } catch (_) { /* 存储失败时仍可进入答题页单题模式 */ }

    this._needRefresh = true;
    wx.navigateTo({
      url: '/pages/bank-question/index?index=' + index + (this.data.recite ? '&recite=1' : '')
    });
  },

  async backToSubject() {
    wx.navigateBack({ delta: 1 });
  },

  clearRecords() {
    wx.showModal({
      title: '清除记录',
      content: '将清除本科目的做题、错题和收藏记录，确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        progress.clearRecords(this.data.subjectId);
        this.setData({ page: 1 }, () => this.refreshView());
        wx.showToast({ title: '已清除', icon: 'none' });
      }
    });
  }
});
