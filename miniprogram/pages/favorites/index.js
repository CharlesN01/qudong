const SHARE_TITLE = '趣洞｜山东专升本';
const SHARE_PATH = '/pages/home/index';
const SHARE_IMAGE = '/assets/share-cover.png';
function shareAppMessage() { return { title: SHARE_TITLE, path: SHARE_PATH, imageUrl: SHARE_IMAGE }; }
function shareTimeline() { return { title: SHARE_TITLE, query: '', imageUrl: SHARE_IMAGE }; }

const apiConfig = require('../../services/api-config');
// 后端地址统一从 services/api-config.js 取，换服务器只改那一处
function bankApiBase() { return apiConfig.getApiBaseUrl() + '/api/student/v1'; }
const api = require('../../services/api');
const navigation = require('../../utils/navigation');
const themeStore = require('../../utils/theme');
const rich = require('../../utils/rich-text');

function token() {
  try {
    return api.auth && typeof api.auth.getToken === 'function' ? api.auth.getToken() : '';
  } catch (_) {
    return '';
  }
}

function request(path, options) {
  const opts = options || {};
  const auth = token();
  return new Promise((resolve, reject) => {
    wx.request({
      url: bankApiBase() + path,
      method: opts.method || 'GET',
      data: opts.data,
      timeout: 10000,
      header: auth ? { Authorization: 'Bearer ' + auth } : {},
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else if (response.statusCode === 401) reject({ needLogin: true });
        else reject(new Error('HTTP ' + response.statusCode));
      },
      fail: reject
    });
  });
}

Page({
  data: {
    theme: 'day',
    loading: true,
    isLogin: true,
    error: '',
    total: 0,
    subjects: [],
    activeSubject: '',
    list: [],
    detailVisible: false,
    detailItem: null
  },

  onLoad() {
    this.setData({ theme: themeStore.getTheme() });
  },

  onShow() {
    this.setData({ theme: themeStore.getTheme() });
    this.load();
  },

  async load() {
    if (!token()) {
      this.setData({ loading: false, isLogin: false, error: '', list: [], subjects: [], total: 0 });
      return;
    }
    this.setData({ loading: true, isLogin: true, error: '' });
    const params = [];
    if (this.data.activeSubject) params.push('subject=' + encodeURIComponent(this.data.activeSubject));
    try {
      const data = await request('/bank/favorites/' + (params.length ? '?' + params.join('&') : ''));
      const list = (data.results || []).map((item) => {
        const answerKeys = (item.answer || []).map((key) => String(key).trim().toUpperCase());
        return Object.assign({}, item, {
          // 题干里的图片/LaTeX 在数据层拆好，视图只负责渲染
          stemText: rich.plainText(item.stem),
          stemParts: rich.splitRich(item.stem, apiConfig.getApiBaseUrl()),
          optionList: (item.options || []).map((text, i) => {
            const key = String.fromCharCode(65 + i);
            return {
              key,
              text: rich.plainText(text, ''),
              // WXML 不支持 indexOf，正确答案标记在这里算好
              right: answerKeys.indexOf(key) >= 0
            };
          }),
          answerText: answerKeys.join('、'),
          lastAt: String(item.favoritedAt || '').slice(0, 10),
          typeName: item.renderKind === 'choice' ? '选择题' : (item.renderKind === 'fill' ? '填空题' : '主观题')
        });
      });
      this.setData({
        loading: false,
        total: data.count || list.length,
        subjects: data.subjects || [],
        list
      });
    } catch (error) {
      if (error && error.needLogin) {
        this.setData({ loading: false, isLogin: false, list: [], subjects: [], total: 0 });
        return;
      }
      this.setData({ loading: false, error: '收藏加载失败，请确认后端已启动' });
    }
  },

  filterSubject(event) {
    const id = event.currentTarget.dataset.id || '';
    if (id === this.data.activeSubject) return;
    this.setData({ activeSubject: id });
    this.load();
  },

  async removeFavorite(event) {
    const questionId = event.currentTarget.dataset.qid;
    if (!questionId) return;
    try {
      await request('/bank/favorites/' + encodeURIComponent(questionId) + '/', { method: 'DELETE' });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
      this.load();
    } catch (_) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  openDetail(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.list[index];
    if (!item) return;
    this.setData({ detailVisible: true, detailItem: item });
  },

  closeDetail() {
    this.setData({ detailVisible: false, detailItem: null });
  },

  goLogin() {
    navigation.openPage('/pages/mine/index');
  },

  onTab(event) {
    const page = event.currentTarget.dataset.page;
    if (page === 'home') wx.reLaunch({ url: '/pages/home/index' });
    if (page === 'wrong') navigation.openPage('/pages/wrong/index');
    if (page === 'mine') navigation.openPage('/pages/mine/index');
  },

  noop() {},

  previewImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ current: src, urls: [src] });
  },

  shareAppMessage,
  shareTimeline
});
