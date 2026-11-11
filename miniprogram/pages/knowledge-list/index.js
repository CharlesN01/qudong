const knowledge = require('../../data/knowledge');
const { getNavigationMetrics } = require('../../utils/safe-top');
const progress = require('../../utils/knowledge-progress');

// 知识点背诵的题号页：只属于背诵，不读刷题的做题记录
Page({
  data: {
    statusHeight: 24,
    navBarHeight: 58,
    subjectId: '',
    bookId: '',
    subjectName: '',
    bookName: '',
    total: 0,
    seenCount: 0,
    items: []
  },

  onLoad(query) {
    const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
    const subjectId = (query && query.subjectId) || 'math';
    const bookId = (query && query.bookId) || '';
    const subject = knowledge.getSubject(subjectId);
    const book = knowledge.getBook(subjectId, bookId);

    this.setData({
      statusHeight: metrics.statusHeight || 24,
      navBarHeight: metrics.barHeight || 58
    });

    if (!subject || !book) {
      wx.showToast({ title: '知识点不存在', icon: 'none' });
      setTimeout(() => this.goBack(), 800);
      return;
    }

    this.setData({
      subjectId,
      bookId,
      subjectName: subject.name,
      bookName: book.name,
      total: book.points.length
    });
    this.buildItems();
  },

  onShow() {
    if (this.data.total) this.buildItems();
  },

  buildItems() {
    const book = knowledge.getBook(this.data.subjectId, this.data.bookId);
    const seen = progress.readSeen(wx, this.data.subjectId, this.data.bookId);
    const points = (book && book.points) || [];
    const items = points.map((point, index) => ({
      number: index + 1,
      index,
      topic: point.topic,
      seen: seen.indexOf(index) >= 0
    }));
    this.setData({
      items,
      seenCount: items.filter((item) => item.seen).length
    });
  },

  openItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isFinite(index)) return;
    wx.navigateTo({
      url: '/pages/knowledge-detail/index?subjectId=' + this.data.subjectId +
        '&bookId=' + this.data.bookId + '&index=' + index
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/knowledge/index' });
  }
});
