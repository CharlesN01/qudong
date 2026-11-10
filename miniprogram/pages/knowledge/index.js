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

Page({
  data: {
    subjectList: [],
    activeSubject: 'math',
    activeName: '高等数学',
    books: [],
    keyword: '',
    searching: false,
    searchResults: [],
    favorites: [],
    favoriteGroups: [],
    isFavoritePanel: false
  },

  onLoad() {
    const subjectList = knowledge.getSubjects().concat([{ id: 'favorites', name: '我的收藏' }]);
    this.setData({ subjectList });
    this.switchSubjectById('math');
  },

  onShow() {
    this.refreshFavorites();
    if (this.data.isFavoritePanel) this.buildFavoriteGroups();
  },

  switchSubject(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeSubject) return;
    this.switchSubjectById(id);
  },

  switchSubjectById(id) {
    if (id === 'favorites') {
      this.setData({
        activeSubject: 'favorites',
        activeName: '我的收藏',
        isFavoritePanel: true,
        books: []
      });
      this.refreshFavorites();
      this.buildFavoriteGroups();
      return;
    }
    const subject = knowledge.getSubject(id);
    if (!subject) return;
    this.setData({
      activeSubject: id,
      activeName: subject.name,
      isFavoritePanel: false,
      books: subject.books
    });
  },

  refreshFavorites() {
    this.setData({ favorites: readFavorites() });
  },

  // 收藏项按科目+书分组，供“我的收藏”面板展示
  buildFavoriteGroups() {
    const favorites = this.data.favorites;
    const groups = [];
    favorites.forEach((item) => {
      const subject = knowledge.getSubject(item.subjectId);
      const book = knowledge.getBook(item.subjectId, item.bookId);
      if (!subject || !book) return;
      let group = groups.find((entry) => entry.bookId === item.bookId);
      if (!group) {
        group = {
          bookId: item.bookId,
          subjectId: item.subjectId,
          subjectName: subject.name,
          bookName: book.name,
          count: 0
        };
        groups.push(group);
      }
      group.count += 1;
    });
    this.setData({ favoriteGroups: groups });
  },

  openBook(event) {
    const bookId = event.currentTarget.dataset.id;
    if (!bookId) return;
    wx.navigateTo({
      url: '/pages/knowledge-detail/index?subjectId=' + this.data.activeSubject + '&bookId=' + bookId
    });
  },

  openFavoriteBook(event) {
    const bookId = event.currentTarget.dataset.id;
    const subjectId = event.currentTarget.dataset.subject;
    if (!bookId || !subjectId) return;
    wx.navigateTo({
      url: '/pages/knowledge-detail/index?subjectId=' + subjectId + '&bookId=' + bookId
    });
  },

  onSearchInput(event) {
    const keyword = event.detail.value || '';
    if (!keyword.trim()) {
      this.setData({ keyword, searching: false, searchResults: [] });
      return;
    }
    this.setData({
      keyword,
      searching: true,
      searchResults: knowledge.search(keyword)
    });
  },

  clearSearch() {
    this.setData({ keyword: '', searching: false, searchResults: [] });
  },

  openSearchResult(event) {
    const subjectId = event.currentTarget.dataset.subject;
    const bookId = event.currentTarget.dataset.id;
    if (!subjectId || !bookId) return;
    wx.navigateTo({
      url: '/pages/knowledge-detail/index?subjectId=' + subjectId + '&bookId=' + bookId
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  }
});
