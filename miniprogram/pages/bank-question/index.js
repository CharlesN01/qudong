const apiConfig = require('../../services/api-config');
const { getNavigationMetrics } = require('../../utils/safe-top');
const progress = require('../../utils/bank-progress');
const rich = require('../../utils/rich-text');
const questionType = require('../../utils/question-type');

const MODE_NAMES = { quick: '简练刷题', chapter: '章节练习', exam: '真题练习' };
const BOARD_COLORS = ['#202923', '#3E68D8', '#E4564F', '#0B9F5A', '#ED8B32'];

function baseUrl() { return apiConfig.getApiBaseUrl(); }

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

Page({
  data: {
    statusHeight: 24,
    navBarHeight: 58,
    rightSpace: 100,
    ready: false,
    subject: '',
    subjectName: '',
    mode: '',
    modeName: '',
    headerTitle: '',
    explainOpen: false,
    chapterName: '',
    title: '',
    index: 0,
    total: 0,
    current: null,
    submitted: false,
    correct: false,
    revealed: false,
    selfMarked: false,
    favorite: false,
    draft: '',
    showCard: false,
    showBoard: false,
    boardTool: 'pen',
    boardSize: 3,
    boardColor: BOARD_COLORS[0],
    boardColors: BOARD_COLORS,
    boardCount: 0,
    cardItems: []
  },

  onLoad(options) {
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    let queue = null;
    try {
      const raw = wx.getStorageSync('bank-queue');
      queue = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    } catch (_) { queue = null; }

    if (!queue || !Array.isArray(queue.items) || !queue.items.length) {
      this.setData({ statusHeight: metrics.statusHeight || 24, ready: false });
      wx.showToast({ title: '题目数据已失效', icon: 'none' });
      return;
    }

    const index = Math.min(Math.max(toNumber(options && options.index), 0), queue.items.length - 1);
    this._queue = queue;
    this._enterAt = Date.now();

    this.setData({
      statusHeight: metrics.statusHeight || 24,
      navBarHeight: metrics.barHeight || 58,
      rightSpace: metrics.rightSpace || 100,
      subject: queue.subject || '',
      subjectName: queue.subjectName || '',
      mode: queue.mode || '',
      modeName: MODE_NAMES[queue.mode] || (queue.scope === 'wrong' ? '错题本' : queue.scope === 'fav' ? '收藏本' : '题库'),
      headerTitle: (queue.subjectName || '题库') + ' · ' + (MODE_NAMES[queue.mode] || (queue.scope === 'wrong' ? '错题本' : queue.scope === 'fav' ? '收藏本' : '题库')),
      chapterName: queue.chapterName || queue.chapter || '全部章节',
      title: queue.title || '',
      total: queue.items.length,
      ready: true
    });

    this.renderQuestion(index);
  },

  onUnload() {
    if (this._enterAt) {
      progress.addSeconds(this.data.subject, (Date.now() - this._enterAt) / 1000);
      this._enterAt = 0;
    }
  },

  /* ---------------- 渲染 ---------------- */

  renderQuestion(index) {
    const items = (this._queue && this._queue.items) || [];
    const question = items[index];
    if (!question) return;

    const kind = question.renderKind || 'choice';
    const objective = kind === 'choice';
    const graded = !objective && questionType.autoGradedText(question.type);
    const answerText = (question.answer || []).join(objective ? '' : '；');
    const favorite = progress.isFavorite(this.data.subject, question.id);

    const options = (question.options || []).map((text, i) => ({
      key: String.fromCharCode(65 + i),
      text: rich.plainText(text, ''),
      picked: false,
      state: ''
    }));

    this.setData({
      index,
      current: Object.assign({}, question, {
        kind,
        objective,
        graded,
        typeName: questionType.typeName(question.type, kind),
        answerText,
        stemParts: rich.splitRich(question.stem, baseUrl()),
        explainParts: question.explanation ? rich.splitRich(question.explanation, baseUrl()) : [],
        sourceText: question.source || '',
        optionList: options
      }),
      submitted: false,
      correct: false,
      revealed: false,
      selfMarked: false,
      draft: '',
      favorite,
      boardCount: this.readBoardCount(question.id)
    }, () => this.buildCard());
    this._startAt = Date.now();
  },

  buildCard() {
    const items = (this._queue && this._queue.items) || [];
    const records = progress.readRecords(this.data.subject);
    const cardItems = items.map((question, index) => {
      const record = records[question.id] || {};
      return {
        number: question.number || index + 1,
        index,
        done: record.done === true,
        wrong: record.wrong === true,
        current: index === this.data.index
      };
    });
    this.setData({ cardItems });
  },

  /* ---------------- 作答 ---------------- */

  chooseOption(event) {
    if (this.data.submitted) return;
    const key = event.currentTarget.dataset.key;
    const current = this.data.current || {};
    const options = (current.optionList || []).map((option) => Object.assign({}, option));
    const multiple = current.type === 'multiple';

    if (multiple) {
      const target = options.find((option) => option.key === key);
      if (target) target.picked = !target.picked;
    } else {
      options.forEach((option) => { option.picked = option.key === key; });
    }

    this.setData({ current: Object.assign({}, current, { optionList: options }) });
  },

  onDraftInput(event) {
    this.setData({ draft: event.detail.value });
  },

  submit() {
    const current = this.data.current;
    if (!current || this.data.submitted) return;
    const options = current.optionList || [];
    const pickedKeys = options.filter((option) => option.picked).map((option) => option.key);

    if (current.objective) {
      if (!pickedKeys.length) {
        wx.showToast({ title: '请先选择答案', icon: 'none' });
        return;
      }
      const expected = (current.answer || []).slice().sort().join(',');
      const picked = pickedKeys.slice().sort().join(',');
      const correct = expected !== '' && expected === picked;
      this.finish(correct, options);
      return;
    }

    if (current.graded) {
      const expected = (current.answer || []).join('');
      const correct = questionType.normalizeAnswerText(this.data.draft) !== '' &&
        questionType.normalizeAnswerText(this.data.draft) === questionType.normalizeAnswerText(expected);
      this.finish(correct, options);
      return;
    }

    // 简答/作文这类没有标准答案比对，直接展开参考答案让用户自评
    this.setData({ revealed: !this.data.revealed });
  },

  toggleExplain() {
    this.setData({ explainOpen: !this.data.explainOpen });
  },

  finish(correct, options) {
    const current = this.data.current;
    const answer = (current.answer || []).map((item) => String(item).trim().toUpperCase());
    const marked = (options || []).map((option) => {
      const inAnswer = answer.indexOf(option.key) !== -1;
      let state = '';
      if (inAnswer) state = 'right';
      else if (option.picked) state = 'wrong';
      return Object.assign({}, option, { state });
    });

    this.setData({
      submitted: true,
      correct,
      current: Object.assign({}, current, { optionList: marked })
    });

    progress.markResult(this.data.subject, current, current.number, correct);
    this.buildCard();
  },

  markSelf(event) {
    if (this.data.selfMarked) return;
    const correct = event.currentTarget.dataset.known === 'yes';
    this.setData({ selfMarked: true, correct });
    progress.markResult(this.data.subject, this.data.current, this.data.current.number, correct);
    this.buildCard();
    wx.showToast({ title: correct ? '已记为掌握' : '已加入错题本', icon: 'none' });
  },

  /* ---------------- 收藏 / 导航 ---------------- */

  toggleFavorite() {
    const current = this.data.current;
    if (!current) return;
    const on = progress.toggleFavorite(this.data.subject, current, current.number);
    this.setData({ favorite: on });
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
  },

  prevQuestion() {
    if (this.data.index <= 0) {
      wx.showToast({ title: '已经是第一题', icon: 'none' });
      return;
    }
    this.renderQuestion(this.data.index - 1);
  },

  nextQuestion() {
    if (this.data.index >= this.data.total - 1) {
      wx.showToast({ title: '已经是本页最后一题', icon: 'none' });
      return;
    }
    this.renderQuestion(this.data.index + 1);
  },

  backToList() {
    wx.navigateBack({ delta: 1 });
  },

  toggleCard() {
    this.setData({ showCard: !this.data.showCard });
  },

  jumpTo(event) {
    const index = toNumber(event.currentTarget.dataset.index);
    this.setData({ showCard: false });
    if (index === this.data.index) return;
    this.renderQuestion(index);
  },

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ current: src, urls: [src] });
  },

  noop() {},

  /* ---------------- 默写板 ---------------- */

  readBoardCount(questionId) {
    try {
      const raw = wx.getStorageSync(this.boardKey(questionId));
      const strokes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return Array.isArray(strokes) ? strokes.length : 0;
    } catch (_) {
      return 0;
    }
  },

  boardKey(questionId) {
    return 'dictation-board:' + this.data.subject + ':' + questionId;
  },

  openBoard() {
    this.setData({ showBoard: true }, () => {
      setTimeout(() => this.initBoard(), 60);
    });
  },

  closeBoard() {
    this.setData({ showBoard: false });
    this._ctx = null;
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
      this._strokes = this.readBoard(this.data.current.id);
      this.redraw();
    });
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

  redraw() {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._boardW || 300, this._boardH || 300);
    (this._strokes || []).forEach((stroke) => {
      ctx.beginPath();
      ctx.lineWidth = stroke.size || 3;
      ctx.strokeStyle = stroke.color || '#202923';
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
    this._drawing = { color: this.data.boardTool === 'eraser' ? '#FFFFFF' : this.data.boardColor, size: this.data.boardTool === 'eraser' ? 22 : this.data.boardSize, points: [point] };
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
    this.setData({ boardTool: event.currentTarget.dataset.tool });
  },

  boardSize(event) {
    this.setData({ boardSize: toNumber(event.currentTarget.dataset.size) || 3, boardTool: 'pen' });
  },

  boardColor(event) {
    this.setData({ boardColor: event.currentTarget.dataset.color, boardTool: 'pen' });
  },

  boardUndo() {
    if (!this._strokes || !this._strokes.length) return;
    this._strokes.pop();
    this.redraw();
    this.setData({ boardCount: this._strokes.length });
  },

  boardClear() {
    this._strokes = [];
    this.redraw();
    this.setData({ boardCount: 0 });
  },

  boardSave() {
    try {
      wx.setStorageSync(this.boardKey(this.data.current.id), JSON.stringify(this._strokes || []));
      wx.showToast({ title: '已保存', icon: 'none' });
      this.setData({ boardCount: (this._strokes || []).length });
    } catch (_) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.closeBoard();
  }
});
