const { getNavigationMetrics } = require('../../utils/safe-top');

// 顶部状态栏占位：env(safe-area-inset-top) 在部分运行环境里返回 0，
// 会导致返回按钮和标题被状态栏压住，这里统一用真实状态栏高度兜底。
Component({
  data: { height: 24 },
  lifetimes: {
    attached() { this.refresh(); },
    ready() { this.refresh(); }
  },
  pageLifetimes: {
    show() { this.refresh(); },
    resize() { this.refresh(); }
  },
  methods: {
    refresh() {
      const metrics = getNavigationMetrics(typeof wx !== 'undefined' ? wx : null);
      if (metrics.statusHeight !== this.data.height) {
        this.setData({ height: metrics.statusHeight });
      }
    }
  }
});
