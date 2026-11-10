const COLORS = [
  { value: '#202923', name: '黑' },
  { value: '#3e68d8', name: '蓝' },
  { value: '#e4564f', name: '红' },
  { value: '#0b9f5a', name: '绿' },
  { value: '#ed8b32', name: '橙' }
];

const SIZES = [
  { value: 3, name: '细' },
  { value: 6, name: '中' },
  { value: 10, name: '粗' }
];

const SUBJECTS = ['通用', '高数', '英语', '计算机', '其他'];

Page({
  data: {
    subjects: SUBJECTS,
    subject: '通用',
    colors: COLORS,
    color: COLORS[0].value,
    sizes: SIZES,
    size: 6,
    tool: 'pen',
    hasStroke: false
  },

  onLoad() {
    this.strokes = [];
    this.current = null;
    this.ready = false;
  },

  onReady() {
    this.initCanvas();
  },

  initCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#paper').fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0];
      if (!item || !item.node) return;
      const canvas = item.node;
      const ctx = canvas.getContext('2d');
      let ratio = 1;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        ratio = info.pixelRatio || 1;
      } catch (_) {
        ratio = 1;
      }
      canvas.width = item.width * ratio;
      canvas.height = item.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.canvas = canvas;
      this.ctx = ctx;
      this.width = item.width;
      this.height = item.height;
      this.ratio = ratio;
      this.ready = true;
      this.redraw();
    });
  },

  pickSubject(event) {
    this.setData({ subject: event.currentTarget.dataset.value });
  },

  pickTool(event) {
    this.setData({ tool: event.currentTarget.dataset.value });
  },

  pickSize(event) {
    this.setData({ size: Number(event.currentTarget.dataset.value) });
  },

  pickColor(event) {
    this.setData({ color: event.currentTarget.dataset.value, tool: 'pen' });
  },

  onTouchStart(event) {
    if (!this.ready) return;
    const touch = event.touches[0];
    if (!touch) return;
    this.current = {
      color: this.data.tool === 'eraser' ? '#ffffff' : this.data.color,
      size: this.data.tool === 'eraser' ? this.data.size * 2.6 : this.data.size,
      points: [{ x: touch.x, y: touch.y }]
    };
    this.strokes.push(this.current);
    this.drawSegment(this.current, touch.x, touch.y, touch.x, touch.y);
    if (!this.data.hasStroke) this.setData({ hasStroke: true });
  },

  onTouchMove(event) {
    if (!this.ready || !this.current) return;
    const touch = event.touches[0];
    if (!touch) return;
    const points = this.current.points;
    const last = points[points.length - 1];
    points.push({ x: touch.x, y: touch.y });
    this.drawSegment(this.current, last.x, last.y, touch.x, touch.y);
  },

  onTouchEnd() {
    this.current = null;
  },

  drawSegment(stroke, fromX, fromY, toX, toY) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  },

  redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    this.strokes.forEach((stroke) => {
      const points = stroke.points;
      if (points.length === 1) {
        this.drawSegment(stroke, points[0].x, points[0].y, points[0].x + 0.1, points[0].y + 0.1);
        return;
      }
      for (let i = 1; i < points.length; i += 1) {
        this.drawSegment(stroke, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
      }
    });
  },

  undo() {
    if (!this.strokes.length) {
      wx.showToast({ title: '没有可撤销的笔迹', icon: 'none' });
      return;
    }
    this.strokes.pop();
    this.redraw();
    this.setData({ hasStroke: this.strokes.length > 0 });
  },

  clear() {
    if (!this.strokes.length) return;
    wx.showModal({
      title: '清空默写板',
      content: '当前写的全部内容会被清除，确定吗？',
      confirmText: '清空',
      success: (res) => {
        if (!res.confirm) return;
        this.strokes = [];
        this.redraw();
        this.setData({ hasStroke: false });
      }
    });
  },

  save() {
    if (!this.strokes.length) {
      wx.showToast({ title: '还没有写内容', icon: 'none' });
      return;
    }
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => {
            wx.showModal({
              title: '需要相册权限',
              content: '保存图片需要授权访问相册，请在设置里打开后重试',
              confirmText: '去设置',
              success: (modal) => {
                if (modal.confirm) wx.openSetting();
              }
            });
          }
        });
      },
      fail: () => wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/home/index' });
  }
});
