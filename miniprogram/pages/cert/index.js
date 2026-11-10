// 资格证书备考：客户尚未提供题库内容，这里先把结构和交互搭好。
// 等题库到位后，把 CERTS 里的 count 换成接口返回的题量即可，页面不用改。

const CERTS = [
  { id: 'teacher', name: '教师资格', subject: '综合素质 · 教育知识与能力', tag: '热门', ready: false },
  { id: 'mandarin', name: '普通话', subject: '普通话水平测试', tag: '常考', ready: false },
  { id: 'ncre', name: '计算机等级', subject: '一级 / 二级 MS Office', tag: '', ready: false },
  { id: 'accounting', name: '会计', subject: '初级会计实务 · 经济法基础', tag: '', ready: false }
];

const TYPES = [
  { id: 'single', name: '单选题', desc: '基础知识点逐题突破' },
  { id: 'multiple', name: '多选题', desc: '易错易混集中训练' },
  { id: 'judge', name: '判断题', desc: '快速检验概念掌握' }
];

Page({
  data: {
    certs: CERTS,
    activeId: CERTS[0].id,
    active: CERTS[0],
    types: TYPES.map((item) => Object.assign({}, item, { count: 0, progress: 0 })),
    hasContent: false
  },

  onLoad() {
    this.select(CERTS[0].id);
  },

  pickCert(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === this.data.activeId) return;
    this.select(id);
  },

  select(id) {
    const active = CERTS.find((item) => item.id === id) || CERTS[0];
    this.setData({
      activeId: active.id,
      active,
      types: TYPES.map((item) => Object.assign({}, item, { count: 0, progress: 0 })),
      hasContent: Boolean(active.ready)
    });
  },

  startType(event) {
    const name = event.currentTarget.dataset.name || '该题型';
    wx.showModal({
      title: name + '还没上线',
      content: '资格证书题库正在整理中，上线后这里会直接进入答题。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  openRecite() {
    wx.navigateTo({ url: '/pages/cert-recite/index?certId=' + this.data.activeId });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  }
});
