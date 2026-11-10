// 资格证书知识点背诵：内容未到位，先保留结构与展开交互。
// 有内容后把 POINTS 换成接口数据即可，渲染逻辑不变。

const CERT_NAMES = {
  teacher: '教师资格',
  mandarin: '普通话',
  ncre: '计算机等级',
  accounting: '会计'
};

const POINTS = [];

Page({
  data: {
    certId: 'teacher',
    certName: '教师资格',
    points: POINTS,
    openIndex: -1,
    isEmpty: true
  },

  onLoad(query) {
    const certId = query.certId || 'teacher';
    this.setData({
      certId,
      certName: CERT_NAMES[certId] || '资格证书',
      points: POINTS,
      isEmpty: POINTS.length === 0
    });
  },

  toggle(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    this.setData({ openIndex: this.data.openIndex === index ? -1 : index });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/cert/index' });
  }
});
