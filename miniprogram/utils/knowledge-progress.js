// 知识点背诵自己的进度记录，和刷题的 bank-record 完全隔离。
// 只记「背过哪几条」，不参与刷题的对错统计。
// 取 wx 时支持显式传入（页面把 wx 传进来，测试里也能用假 wx）。
const KEY = 'knowledge-records.v1';

function resolveStore(store) {
  if (store && typeof store.getStorageSync === 'function') return store;
  return typeof wx !== 'undefined' ? wx : null;
}

function readAll(store) {
  const api = resolveStore(store);
  if (!api) return {};
  try {
    const raw = api.getStorageSync(KEY);
    const value = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

function writeAll(store, map) {
  const api = resolveStore(store);
  if (!api || typeof api.setStorageSync !== 'function') return;
  try {
    api.setStorageSync(KEY, JSON.stringify(map));
  } catch (_) { /* 存储不可用时静默降级 */ }
}

function keyOf(subjectId, bookId) {
  return String(subjectId || '') + '|' + String(bookId || '');
}

function readSeen(store, subjectId, bookId) {
  const list = readAll(store)[keyOf(subjectId, bookId)];
  return Array.isArray(list) ? list.filter((item) => Number.isFinite(Number(item))).map(Number) : [];
}

function markSeen(store, subjectId, bookId, index) {
  const at = Number(index);
  const list = readSeen(store, subjectId, bookId);
  if (!Number.isFinite(at) || at < 0 || list.indexOf(at) !== -1) return list;
  const map = readAll(store);
  list.push(at);
  map[keyOf(subjectId, bookId)] = list;
  writeAll(store, map);
  return list;
}

function clearSeen(store, subjectId, bookId) {
  const map = readAll(store);
  delete map[keyOf(subjectId, bookId)];
  writeAll(store, map);
}

module.exports = { KEY, readSeen, markSeen, clearSeen };
