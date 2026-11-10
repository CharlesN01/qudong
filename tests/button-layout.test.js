const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function declarations(filename, selector) {
  const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', filename), 'utf8');
  const result = {};
  for (const match of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(',').some((value) => value.trim() === selector)) continue;
    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      result[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
    }
  }
  return result;
}

function assertCentered(style, context) {
  assert.ok(['flex', 'inline-flex'].includes(style.display), `${context}: use flex layout`);
  assert.equal(style['align-items'], 'center', `${context}: vertical alignment`);
  assert.equal(style['justify-content'], 'center', `${context}: horizontal alignment`);
  assert.equal(style['line-height'], 'normal', `${context}: no inherited or fixed-height line box`);
}

test('原生按钮即使只有最小高度，也将文字放在按钮中央', () => {
  assertCentered(declarations('app.wxss', 'button'), 'native button');
  const copy = declarations('pages/resources/index.wxss', '.bottom button');
  assertCentered(copy, 'resource copy');
  assert.equal(copy['min-height'], '42px');
  assert.equal(copy['font-size'], '24rpx');
  for (const selector of ['.primary', '.secondary', '.login-button', '.member-row button']) {
    assertCentered(declarations('pages/mine/index.wxss', selector), `mine ${selector}`);
  }
  assertCentered(declarations('pages/application/index.wxss', '.page-nav button'), 'application previous/next');
});

test('继续、扫码、分页、查看答案及关闭弹窗采用相同居中规则', () => {
  const controls = {
    'pages/home/index.wxss': ['.group-action', '.retry-button', '.group-modal-close'],
    'pages/mine/index.wxss': ['.close', '.type-pill']
  };
  for (const [filename, selectors] of Object.entries(controls)) {
    for (const selector of selectors) assertCentered(declarations(filename, selector), `${filename} ${selector}`);
  }
});

test('原来按文字宽度显示的操作保持紧凑，不因居中改成整行按钮', () => {
  assert.equal(declarations('components/empty-state/index.wxss', '.action').display, 'inline-flex');
});
