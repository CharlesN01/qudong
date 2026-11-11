// 小程序页面参数解码。
// 上级页面用 encodeURIComponent 传参，这里统一解码；
// 遇到「已经是明文」或含裸 % 的文本时不能抛错，直接原样返回。
function decodeParam(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch (_) {
    return text;
  }
}

module.exports = { decodeParam };
