const knowledge = require('../../data/knowledge');

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
    this.setData({
      index: next,
      pageIndex: next,
      current: points[next],
      favorited: this.isFavorited(next)
    });
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
    wx.showToast({ title: exists ? '已取消收藏' : '已收藏', icon: 'none' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/knowledge/index' });
  }
});
