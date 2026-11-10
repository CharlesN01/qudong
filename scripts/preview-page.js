// 把 wxss 的 rpx 按 375 设计宽换成 px，再拼一个静态预览页，用来检查布局。
// 只是本地验证工具，不参与小程序打包。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const page = process.argv[2] || 'pages/knowledge/index';
const outFile = process.argv[3] || 'preview.html';

function rpxToPx(css) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (_, num) => (parseFloat(num) / 2).toFixed(2) + 'px');
}

const wxss = rpxToPx(fs.readFileSync(path.join(root, 'miniprogram', page + '.wxss'), 'utf8'));

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=375, initial-scale=1">
<style>
  html,body{margin:0;background:#dfe6ef;}
  body{width:375px;height:100vh;overflow:hidden;margin:0 auto;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
  div,span{box-sizing:border-box;}
  .safe-top{padding-top:0;}
${wxss}
</style></head>
<body>
${fs.readFileSync(path.join(__dirname, 'fragments', path.basename(path.dirname(page)) + '.html'), 'utf8')}
</body></html>`;

fs.writeFileSync(path.join(root, '.preview', outFile), html);
console.log('written', outFile);
