const latex = require('../../utils/latex');
const rich = require('../../utils/rich-text');
const questionType = require('../../utils/question-type');
const { getNavigationMetrics } = require('../../utils/safe-top');

const apiConfig = require('../../services/api-config');
// 后端地址统一从 services/api-config.js 取，换服务器只改那一处
function bankApiBase() { return apiConfig.getApiBaseUrl() + '/api/student/v1'; }
const RESULT_KEY = 'mock-results.v1';
const PROGRESS_KEY = 'mock-progress.v1';
const BOARD_COLORS = ['#24364D', '#3277ED', '#E56872', '#0B9F5A', '#ED8B32'];
const MAX_QUESTIONS = 100;

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
      fail: (error) => reject(new Error(error && error.errMsg ? error.errMsg : 'NETWORK_ERROR'))
    });
  });
}

function sameAnswer(selected, answer) {
  const left = (selected || []).slice().sort().join('');
  const right = (answer || []).slice().sort().join('');
  return left !== '' && left === right;
}

function hasAnswer(question) {
  if (!question) return false;
  if (question.objective) return (question.selected || []).length > 0;
  if (String(question.draft || '').trim()) return true;
  return Boolean(question.selfMarked);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

Page({
  data: {
    statusHeight: 24,
    navBarHeight: 58,
    rightSpace: 100,
    subjectId: '',
    examId: '',
    examName: '',
    loading: true,
    failed: false,
    view: 'doing',
    mode: 'browse',
    questions: [],
    index: 0,
    current: null,
    total: 0,
    answeredCount: 0,
    remainText: '--:--',
    correctCount: 0,
    accuracy: 0,
    sheetVisible: false,
    sheetCells: [],
    boardVisible: false,
    boardTitle: '',
    boardCount: 0,
    boardTool: 'pen',
    boardSize: 4,
    boardColor: BOARD_COLORS[0],
    boardColors: BOARD_COLORS
  },

  onLoad(query) {
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    const subjectId = query.subjectId || '';
    const examName = decodeURIComponent(query.name || '');
    const examId = decodeURIComponent(query.examId || '') || (subjectId + '::' + examName);
    const resume = String(query.resume || '0') === '1';
    const rawSources = decodeURIComponent(query.sources || '');
    const sources = rawSources
      ? rawSources.split('|').map((item) => item.trim()).filter(Boolean)
      : (examName ? [examName] : []);

    this.setData({
      statusHeight: metrics.statusHeight || 24,
      navBarHeight: metrics.barHeight || 58,
      rightSpace: metrics.rightSpace || 100,
      subjectId,
      examId,
      examName
    });

    if (!subjectId || !examName) {
      wx.showToast({ title: '试卷参数缺失', icon: 'none' });
      setTimeout(() => this.goBack(), 800);
      return;
    }
    this._resume = resume;
    this._sourceList = sources.slice();
    this.load(examName, sources);
  },

  onUnload() {
    this.stopTimer();
    this.saveProgress();
  },

  async load(examName, sourceList) {
    this.setData({ loading: true, failed: false });
    try {
      const sources = sourceList && sourceList.length ? sourceList : [examName];
      const rows = [];
      const seen = new Set();

      for (const source of sources) {
        let offset = 0;
        let total = 0;
        do {
          const payload = await request(
            '/bank/questions/?subject=' + encodeURIComponent(this.data.subjectId) +
            '&source=' + encodeURIComponent(source) +
            '&limit=50&offset=' + offset
          ).catch(() => null);
          const batch = (payload && payload.results) || [];
          total = (payload && payload.count) || batch.length;
          batch.forEach((row) => {
            if (!row || !row.id || seen.has(row.id)) return;
            seen.add(row.id);
            rows.push(row);
          });
          offset += batch.length;
          if (!batch.length || rows.length >= MAX_QUESTIONS) break;
        } while (offset < total);
        if (rows.length >= MAX_QUESTIONS) break;
      }

      const slices = rows.slice(0, MAX_QUESTIONS);
      const questions = slices.map((row, index) => this.buildQuestion(row, index));
      if (!questions.length) {
        this.setData({ loading: false, failed: true });
        return;
      }

      this.setData({
        loading: false,
        questions,
        total: questions.length,
        index: 0,
        current: questions[0],
        answeredCount: 0
      });

      if (this._resume) this.restoreProgress();
      this.buildSheet();
      this.startTimer(questions.length);
    } catch (error) {
      this.setData({ loading: false, failed: true });
    }
  },

  buildQuestion(row, index) {
    const renderKind = row.renderKind || 'choice';
    const objective = questionType.isObjective(renderKind);
    const answer = latex.normalizeAnswer(row.answer);
    return {
      id: row.id,
      no: index + 1,
      stem: rich.plainText(row.stem),
      stemParts: rich.splitRich(row.stem, apiConfig.getApiBaseUrl()),
      options: objective
        ? latex.buildOptions(row.options).map((option) => Object.assign({ picked: false, state: '', letter: option.letter, text: option.text }, option))
        : [],
      answer,
      answerText: answer.join('、'),
      explanation: rich.plainText(row.explanation) || '原试卷未提供解析',
      explanationParts: row.explanation
        ? rich.splitRich(row.explanation, apiConfig.getApiBaseUrl())
        : [{ kind: 'text', text: '原试卷未提供解析' }],
      source: row.source || '',
      type: row.type,
      renderKind,
      typeName: questionType.typeName(row.type, renderKind),
      objective,
      gradable: !objective && questionType.autoGradedText(row.type),
      draftCorrect: null,
      selected: [],
      draft: '',
      revealed: false,
      selfMarked: false,
      selfCorrect: null,
      correct: null,
      submitted: false,
      favorite: this.isFavorite(row.id),
      starred: false,
      done: false
    };
  },

  /* ---------------- 收藏（本地） ---------------- */

  favKey() {
    return 'mock-fav:' + this.data.examId;
  },

  readFavorites() {
    try {
      const raw = wx.getStorageSync(this.favKey());
      const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  },

  isFavorite(id) {
    return this.readFavorites().indexOf(id) >= 0;
  },

  toggleStar(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const questions = this.data.questions.slice();
    const question = questions[index];
    if (!question) return;
    const list = this.readFavorites();
    const at = list.indexOf(question.id);
    if (at >= 0) list.splice(at, 1);
    else list.push(question.id);
    try {
      wx.setStorageSync(this.favKey(), JSON.stringify(list));
    } catch (_) { /* 存储失败不影响作答 */ }
    questions[index] = Object.assign({}, question, { favorite: at < 0 });
    this.setData({ questions });
  },

  /* ---------------- 计时 ---------------- */

  startTimer(total) {
    this.stopTimer();
    const minutes = Math.min(120, Math.max(30, Math.round(total * 1.5)));
    this._deadline = Date.now() + minutes * 60 * 1000;
    this.tick();
    if (typeof setInterval === 'function') {
      this._timer = setInterval(() => this.tick(), 1000);
    }
  },

  stopTimer() {
    if (this._timer) {
      if (typeof clearInterval === 'function') clearInterval(this._timer);
      this._timer = null;
    }
  },

  tick() {
    if (!this._deadline) return;
    const left = Math.max(0, Math.round((this._deadline - Date.now()) / 1000));
    this.setData({ remainText: pad2(Math.floor(left / 60)) + ':' + pad2(left % 60) });
    if (left <= 0) {
      this.stopTimer();
      if (this.data.view === 'doing') {
        wx.showToast({ title: '时间到，自动交卷', icon: 'none' });
        this.grade();
      }
    }
  },

  /* ---------------- 模式切换 ---------------- */

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || mode === this.data.mode) return;
    this.setData({ mode });
  },

  /* ---------------- 作答 ---------------- */

  pickOption(event) {
    const dataset = event.currentTarget.dataset || {};
    const letter = dataset.letter;
    if (!letter) return;
    const index = dataset.index === undefined ? this.data.index : Number(dataset.index);
    const questions = this.data.questions.slice();
    const base = questions[index];
    if (!base || base.submitted || !base.objective) return;

    const multiple = base.type === 'multiple';
    const selected = multiple
      ? (base.selected.indexOf(letter) >= 0
        ? base.selected.filter((item) => item !== letter)
        : base.selected.concat([letter]))
      : [letter];

    const next = Object.assign({}, base, {
      selected,
      done: selected.length > 0,
      options: base.options.map((option) => Object.assign({}, option, {
        picked: selected.indexOf(option.letter) >= 0
      }))
    });
    questions[index] = next;

    this.setData({
      questions,
      current: next,
      answeredCount: questions.filter(hasAnswer).length
    });
    this.buildSheet();
    this.saveProgress();
  },

  onDraftInput(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const index = dataset.index === undefined ? this.data.index : Number(dataset.index);
    const questions = this.data.questions.slice();
    const base = questions[index];
    if (!base || base.submitted) return;
    const next = Object.assign({}, base, { draft: event.detail.value, done: true });
    questions[index] = next;
    this.setData({
      questions,
      current: next,
      answeredCount: questions.filter(hasAnswer).length
    });
    this.buildSheet();
    this.saveProgress();
  },

  confirmDraft() {
    const questions = this.data.questions.slice();
    const base = questions[this.data.index];
    if (!base || base.submitted || !base.gradable) return;
    const mine = questionType.normalizeAnswerText(base.draft);
    if (!mine) {
      wx.showToast({ title: '先写下你的答案', icon: 'none' });
      return;
    }
    const expected = questionType.normalizeAnswerText(base.answerText);
    const draftCorrect = expected !== '' && mine === expected;
    const next = Object.assign({}, base, {
      revealed: true,
      draftCorrect,
      selfMarked: true,
      selfCorrect: draftCorrect
    });
    questions[this.data.index] = next;
    this.setData({ questions, current: next, answeredCount: questions.filter(hasAnswer).length });
    this.buildSheet();
  },

  revealAnswer() {
    const questions = this.data.questions.slice();
    const base = questions[this.data.index];
    if (!base || base.submitted) return;
    const next = Object.assign({}, base, { revealed: !base.revealed });
    questions[this.data.index] = next;
    this.setData({ questions, current: next });
  },

  markSelf(event) {
    const known = event.currentTarget.dataset.known === 'yes';
    const questions = this.data.questions.slice();
    const base = questions[this.data.index];
    if (!base || base.submitted) return;
    const next = Object.assign({}, base, { revealed: true, selfMarked: true, selfCorrect: known, done: true });
    questions[this.data.index] = next;
    this.setData({ questions, current: next, answeredCount: questions.filter(hasAnswer).length });
    this.buildSheet();
    this.saveProgress();
  },

  /* ---------------- 导航 ---------------- */

  previous() {
    if (this.data.index <= 0) {
      wx.showToast({ title: '已经是第一题', icon: 'none' });
      return;
    }
    this.jumpTo(this.data.index - 1);
  },

  next() {
    if (this.data.index >= this.data.total - 1) {
      wx.showToast({ title: '已经是最后一题', icon: 'none' });
      return;
    }
    this.jumpTo(this.data.index + 1);
  },

  jumpTo(index) {
    const questions = this.data.questions;
    const next = Math.max(0, Math.min(questions.length - 1, index));
    this.setData({ index: next, current: questions[next], sheetVisible: false });
    this.buildSheet();
  },

  jumpFromSheet(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    if (this.data.mode === 'browse') {
      this.setData({ sheetVisible: false, mode: 'single' });
    }
    this.jumpTo(index);
  },

  buildSheet() {
    const cells = this.data.questions.map((question, index) => ({
      index,
      no: question.no,
      done: hasAnswer(question),
      active: index === this.data.index,
      favorite: question.favorite
    }));
    this.setData({ sheetCells: cells });
  },

  openSheet() {
    this.buildSheet();
    this.setData({ sheetVisible: true });
  },

  closeSheet() {
    this.setData({ sheetVisible: false });
  },

  noop() {},

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ current: src, urls: [src] });
  },

  /* ---------------- 交卷与结果 ---------------- */

  submit(event) {
    const unanswered = this.data.questions.filter((item) => !hasAnswer(item)).length;
    if (unanswered > 0) {
      wx.showModal({
        title: '还有题目没作答',
        content: '还有 ' + unanswered + ' 题未作答，确定要提交并查看解析吗？',
        confirmText: '提交',
        cancelText: '继续作答',
        success: (res) => {
          if (res.confirm) this.grade();
        }
      });
      return;
    }
    wx.showModal({
      title: '确认交卷',
      content: '确认提交试卷并查看答案解析吗？',
      confirmText: '提交',
      cancelText: '继续作答',
      success: (res) => {
        if (res.confirm) this.grade();
      }
    });
  },

  grade() {
    const questions = this.data.questions.map((question) => {
      let correct;
      if (question.objective) correct = sameAnswer(question.selected, question.answer);
      else if (question.gradable) correct = question.draftCorrect === true;
      else correct = question.selfCorrect === true;
      return Object.assign({}, question, { correct, submitted: true });
    });
    const correctCount = questions.filter((item) => item.correct).length;
    const accuracy = questions.length ? Math.round(correctCount / questions.length * 100) : 0;

    this.stopTimer();
    this.setData({
      questions,
      correctCount,
      accuracy,
      view: 'result',
      sheetVisible: false
    });

    try {
      const results = wx.getStorageSync(RESULT_KEY) || {};
      results[this.data.subjectId + '::' + this.data.examName] = {
        done: true,
        correct: correctCount,
        total: questions.length,
        at: Date.now()
      };
      wx.setStorageSync(RESULT_KEY, results);
    } catch (_) { /* 记录失败不影响成绩展示 */ }

    try {
      const all = wx.getStorageSync(PROGRESS_KEY) || {};
      delete all[this.data.examId];
      wx.setStorageSync(PROGRESS_KEY, all);
    } catch (_) { /* 忽略 */ }

    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  retake() {
    const questions = this.data.questions.map((question) => Object.assign({}, question, {
      selected: [],
      draft: '',
      revealed: false,
      selfMarked: false,
      selfCorrect: null,
      draftCorrect: null,
      correct: null,
      submitted: false,
      done: false,
      options: (question.options || []).map((option) => Object.assign({}, option, { picked: false }))
    }));
    this.setData({
      questions,
      index: 0,
      current: questions[0],
      answeredCount: 0,
      correctCount: 0,
      accuracy: 0,
      view: 'doing',
      mode: 'browse'
    });
    this.buildSheet();
    this.startTimer(questions.length);
  },

  reviewQuestion(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    this.setData({ view: 'doing', mode: 'single', index, current: this.data.questions[index] });
  },

  /* ---------------- 进度保存（继续作答） ---------------- */

  saveProgress() {
    if (!this.data.examId || this.data.view !== 'doing') return;
    const answers = {};
    this.data.questions.forEach((question) => {
      if (!hasAnswer(question)) return;
      answers[question.id] = {
        selected: question.selected || [],
        draft: question.draft || '',
        selfCorrect: question.selfCorrect,
        draftCorrect: question.draftCorrect,
        selfMarked: question.selfMarked
      };
    });
    try {
      const all = wx.getStorageSync(PROGRESS_KEY) || {};
      all[this.data.examId] = { answers, at: Date.now() };
      wx.setStorageSync(PROGRESS_KEY, all);
    } catch (_) { /* 忽略 */ }
  },

  restoreProgress() {
    let saved = null;
    try {
      const all = wx.getStorageSync(PROGRESS_KEY) || {};
      saved = all[this.data.examId] || null;
    } catch (_) { saved = null; }
    if (!saved || !saved.answers) return;

    const questions = this.data.questions.map((question) => {
      const answer = saved.answers[question.id];
      if (!answer) return question;
      const selected = answer.selected || [];
      return Object.assign({}, question, {
        selected,
        draft: answer.draft || '',
        selfCorrect: answer.selfCorrect,
        draftCorrect: answer.draftCorrect,
        selfMarked: answer.selfMarked === true,
        revealed: answer.selfMarked === true,
        done: true,
        options: (question.options || []).map((option) => Object.assign({}, option, {
          picked: selected.indexOf(option.letter) >= 0
        }))
      });
    });

    const firstUnanswered = questions.findIndex((question) => !hasAnswer(question));
    const index = firstUnanswered >= 0 ? firstUnanswered : 0;
    this.setData({
      questions,
      answeredCount: questions.filter(hasAnswer).length,
      index,
      current: questions[index]
    });
  },

  /* ---------------- 默写板 ---------------- */

  openBoard(event) {
    const dataset = (event.currentTarget && event.currentTarget.dataset) || {};
    const index = dataset.index === undefined ? this.data.index : Number(dataset.index);
    const question = this.data.questions[index];
    if (!question) return;
    this._boardIndex = index;
    this.setData({
      boardVisible: true,
      boardTitle: '第 ' + question.no + ' 题 · 草稿演算',
      boardCount: this.readBoard(question.id).length
    }, () => setTimeout(() => this.initBoard(), 60));
  },

  closeBoard() {
    this.setData({ boardVisible: false });
    this._ctx = null;
    this._strokes = [];
  },

  boardKey(questionId) {
    return 'mock-board:' + this.data.examId + ':' + questionId;
  },

  readBoard(questionId) {
    try {
      const raw = wx.getStorageSync(this.boardKey(questionId));
      const strokes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return Array.isArray(strokes) ? strokes : [];
    } catch (_) {
      return [];
    }
  },

  initBoard() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#boardCanvas').fields({ node: true, size: true, rect: true }).exec((res) => {
      const info = res && res[0];
      if (!info || !info.node) return;
      const canvas = info.node;
      const ctx = canvas.getContext('2d');
      let dpr = 2;
      try {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : null;
        dpr = (win && win.pixelRatio) || 2;
      } catch (_) { dpr = 2; }
      canvas.width = Math.max(1, Math.floor(info.width * dpr));
      canvas.height = Math.max(1, Math.floor(info.height * dpr));
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this._canvas = canvas;
      this._ctx = ctx;
      this._boardW = info.width;
      this._boardH = info.height;
      this._boardRect = { left: info.left || 0, top: info.top || 0 };
      this._strokes = this.readBoard(this.data.questions[this._boardIndex].id);
      this.redraw();
      this.setData({ boardCount: this._strokes.length });
    });
  },

  redraw() {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._boardW || 300, this._boardH || 300);
    (this._strokes || []).forEach((stroke) => {
      ctx.beginPath();
      ctx.lineWidth = stroke.size || 4;
      ctx.strokeStyle = stroke.color || '#24364D';
      (stroke.points || []).forEach((point, i) => {
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    });
  },

  pointOf(event) {
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    if (!touch) return null;
    const rect = this._boardRect || { left: 0, top: 0 };
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  },

  boardStart(event) {
    const point = this.pointOf(event);
    if (!point) return;
    this._drawing = {
      color: this.data.boardTool === 'eraser' ? '#FFFFFF' : this.data.boardColor,
      size: this.data.boardTool === 'eraser' ? 24 : this.data.boardSize,
      points: [point]
    };
    this._strokes.push(this._drawing);
    this.redraw();
  },

  boardMove(event) {
    if (!this._drawing) return;
    const point = this.pointOf(event);
    if (!point) return;
    this._drawing.points.push(point);
    this.redraw();
  },

  boardEnd() {
    if (!this._drawing) return;
    this._drawing = null;
    this.setData({ boardCount: (this._strokes || []).length });
  },

  boardTool(event) {
    const tool = event.currentTarget.dataset.tool;
    if (tool === 'undo') {
      if (this._strokes && this._strokes.length) {
        this._strokes.pop();
        this.redraw();
        this.setData({ boardCount: this._strokes.length });
      }
      return;
    }
    this.setData({ boardTool: tool });
  },

  boardColor(event) {
    this.setData({ boardColor: event.currentTarget.dataset.color, boardTool: 'pen' });
  },

  boardClear() {
    this._strokes = [];
    this.redraw();
    this.setData({ boardCount: 0 });
  },

  boardSave() {
    const question = this.data.questions[this._boardIndex];
    if (!question) return;
    try {
      wx.setStorageSync(this.boardKey(question.id), JSON.stringify(this._strokes || []));
      wx.showToast({ title: '已保存草稿', icon: 'none' });
    } catch (_) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.closeBoard();
  },

  retry() {
    this.load(this.data.examName, this._sourceList);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/mock/index' });
  }
});
