const apiConfig = require('../../services/api-config');
// 后端地址统一从 services/api-config.js 取，换服务器只改那一处
function bankApiBase() { return apiConfig.getApiBaseUrl() + '/api/student/v1'; }
const { getNavigationMetrics } = require('../../utils/safe-top');
const { decodeParam } = require('../../utils/params');
const progress = require('../../utils/bank-progress');

const MODES = [
  { id: 'quick', name: '简练刷题', desc: '按题型快速练习，巩固基础' },
  { id: 'chapter', name: '章节练习', desc: '按章巩固，打好知识基础' },
  { id: 'exam', name: '真题练习', desc: '历年真题，把握出题方向' }
];

const PAGE_SIZE = 20;

function request(path) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: bankApiBase() + path,
      method: 'GET',
      timeout: 10000,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else reject(new Error('HTTP ' + response.statusCode));
      },
      fail: reject
    });
  });
}

Page({
  data: {
    subjectId: '',
    subjectName: '',
    totalCount: 0,
    statusHeight: 24,
    navBarHeight: 58,
    modes: MODES,
    wrongCount: 0,
    favCount: 0,
    stats: { today: 0, total: 0, minutes: 0 },
    loading: false,
    errorMessage: ''
  },

  onLoad(options) {
    const subjectId = decodeParam(options && options.subject) || 'math1';
    const subjectName = decodeParam(options && options.name) || '高数一';
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    this.setData({ subjectId, subjectName, statusHeight: metrics.statusHeight || 24, navBarHeight: metrics.barHeight || 58 });
    this._chapters = [];
    if (!subjectId) {
      this.setData({ errorMessage: '缺少科目参数' });
      return;
    }
    this.refreshLocal();
    this.loadChapters();
  },

  onShow() {
    // 从答题页返回后刷新进度与错题/收藏数量
    if (this.data.subjectId) this.refreshLocal();
  },

  refreshLocal() {
    const subjectId = this.data.subjectId;
    const stats = progress.readStats(subjectId);
    this.setData({
      wrongCount: progress.readWrong(subjectId).length,
      favCount: progress.readFavorites(subjectId).length,
      stats
    });
  },

  async loadChapters() {
    this.setData({ loading: true });
    try {
      const data = await request('/bank/subjects/' + encodeURIComponent(this.data.subjectId) + '/chapters/');
      const subject = data.subject || {};
      this._chapters = data.results || [];
      this.setData({
        loading: false,
        subjectName: subject.name || this.data.subjectName,
        totalCount: subject.questionCount || 0
      });
    } catch (_) {
      this.setData({ loading: false, errorMessage: '题库连接失败，请确认后端已启动' });
    }
  },

  backHome() {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/home/index' }) });
  },

  openStats() {
    const stats = this.data.stats || { today: 0, total: 0, minutes: 0 };
    wx.showModal({
      title: this.data.subjectName + '刷题统计',
      content: '今日刷题 ' + stats.today + ' 题\n累计刷题 ' + stats.total + ' 题\n累计时长 ' + stats.minutes + ' 分钟',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  openMode(event) {
    const mode = event.currentTarget.dataset.mode;
    const query = [
      'subject=' + encodeURIComponent(this.data.subjectId),
      'name=' + encodeURIComponent(this.data.subjectName || ''),
      'mode=' + encodeURIComponent(mode || 'quick')
    ].join('&');
    wx.navigateTo({ url: '/pages/bank-list/index?' + query });
  },

  openWrongBook() {
    if (!progress.readWrong(this.data.subjectId).length) {
      wx.showToast({ title: '错题本还是空的', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/bank-list/index?subject=' + encodeURIComponent(this.data.subjectId) +
        '&name=' + encodeURIComponent(this.data.subjectName || '') + '&scope=wrong'
    });
  },

  openFavoriteBook() {
    if (!progress.readFavorites(this.data.subjectId).length) {
      wx.showToast({ title: '收藏本还是空的', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/bank-list/index?subject=' + encodeURIComponent(this.data.subjectId) +
        '&name=' + encodeURIComponent(this.data.subjectName || '') + '&scope=fav'
    });
  }
});
