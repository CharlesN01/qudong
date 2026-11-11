const knowledge = require('../../data/knowledge');
const knowledgeProgress = require('../../utils/knowledge-progress');

const FAVORITE_KEY = 'knowledge-favorites.v1';

function readFavorites() {
  try {
    const raw = wx.getStorageSync(FAVORITE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function writeFavorites(list) {
  try {
    wx.setStorageSync(FAVORITE_KEY, list);
  } catch (_) {
    /* 存储失败不影响阅读 */
  }
}

function favoriteKeyOf(subjectId, bookId, index) {
  return subjectId + '|' + bookId + '|' + index;
}

Page({
  data: {
    subjectId: '',
    bookId: '',
    subjectName: '',
    bookName: '',
    points: [],
    index: 0,
    total: 0,
    current: null,
    showAnswer: true,
    favorited: false,
    showCard: false,
    cardItems: [],
    pageLabels: [],
    pageIndex: 0
  },

  onLoad(query) {
    const subjectId = query.subjectId || 'math';
    const bookId = query.bookId || '';
    const subject = knowledge.getSubject(subjectId);
    const book = knowledge.getBook(subjectId, bookId);
    if (!subject || !book) {
      wx.showToast({ title: '知识点不存在', icon: 'none' });
      setTimeout(() => this.goBack(), 800);
      return;
    }
    const start = Math.max(0, Math.min(book.points.length - 1, Number(query.index) || 0));
    this.setData({
      subjectId,
      bookId,
      subjectName: subject.name,
      bookName: book.name,
      points: book.points,
      total: book.points.length,
      pageLabels: book.points.map((_, i) => '第 ' + (i + 1) + ' 页')
    });
    this.goTo(start);
  },

  goTo(index) {
    const points = this.data.points;
    if (!points.length) return;
    const next = Math.max(0, Math.min(points.length - 1, index));
    // 看过就算背过，写进背诵自己的进度（与刷题记录互不影响）
    knowledgeProgress.markSeen(wx, this.data.subjectId, this.data.bookId, next);
    this.setData({
      index: next,
      pageIndex: next,
      current: points[next],
      favorited: this.isFavorited(next)
    });
    this.buildCardItems();
  },

  // 本册条目卡片：题号 + 是否当前条 + 是否已收藏
  buildCardItems() {
    const points = this.data.points || [];
    if (!points.length) {
      this.setData({ cardItems: [] });
      return;
    }
    const favorites = readFavorites();
    const keys = favorites.map((item) => item.key);
    const subjectId = this.data.subjectId;
    const bookId = this.data.bookId;
    const cardItems = points.map((_, i) => ({
      number: i + 1,
      index: i,
      current: i === this.data.index,
      favorited: keys.indexOf(favoriteKeyOf(subjectId, bookId, i)) >= 0
    }));
    this.setData({ cardItems });
  },

  isFavorited(index) {
    const list = readFavorites();
    const key = favoriteKeyOf(this.data.subjectId, this.data.bookId, index);
    return list.some((item) => item.key === key);
  },

  previous() {
    if (this.data.index <= 0) {
      wx.showToast({ title: '已经是第一页', icon: 'none' });
      return;
    }
    this.goTo(this.data.index - 1);
  },

  next() {
    if (this.data.index >= this.data.total - 1) {
      wx.showToast({ title: '已经是最后一页', icon: 'none' });
      return;
    }
    this.goTo(this.data.index + 1);
  },

  onPagePick(event) {
    this.goTo(Number(event.detail.value) || 0);
  },

  toggleAnswer() {
    this.setData({ showAnswer: !this.data.showAnswer });
  },

  toggleCard() {
    this.setData({ showCard: !this.data.showCard });
  },

  // 点题号跳到对应条目
  jumpTo(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ showCard: false });
    if (Number.isNaN(index) || index === this.data.index) return;
    this.goTo(index);
  },

  noop() {},

  toggleFavorite() {
    const list = readFavorites();
    const key = favoriteKeyOf(this.data.subjectId, this.data.bookId, this.data.index);
    const exists = list.some((item) => item.key === key);
    let nextList;
    if (exists) {
      nextList = list.filter((item) => item.key !== key);
    } else {
      nextList = list.concat([{
        key,
        subjectId: this.data.subjectId,
        bookId: this.data.bookId,
        index: this.data.index,
        topic: this.data.current ? this.data.current.topic : '',
        question: this.data.current ? this.data.current.q : ''
      }]);
    }
    writeFavorites(nextList);
    this.setData({ favorited: !exists });
    this.buildCardItems();
    wx.showToast({ title: exists ? '已取消收藏' : '已收藏', icon: 'none' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/knowledge/index' });
  }
});
