// 题库本地进度：做题记录、错题本、收藏本、刷题统计共用一套读写规则，
// 让「刷题首页 / 题库列表 / 答题页」三个页面看到的数据始终一致。

const KEY = {
  stats: 'bank-stats:',
  wrong: 'bank-wrong:',
  fav: 'bank-fav:',
  record: 'bank-record:'
};

const MAX_WRONG = 200;
const MAX_FAV = 200;
const MAX_RECORD = 300;

function readJson(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return fallback;
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    wx.setStorageSync(key, JSON.stringify(value));
  } catch (_) { /* 存储不可用时静默降级 */ }
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}

/* ---------------- 刷题统计 ---------------- */

function rawStats(subjectId) {
  const raw = readJson(KEY.stats + subjectId, {}) || {};
  const today = todayKey();
  return {
    date: raw.date === today ? today : today,
    todayCount: raw.date === today ? (raw.todayCount || 0) : 0,
    totalCount: raw.totalCount || 0,
    seconds: raw.seconds || 0
  };
}

function readStats(subjectId) {
  const raw = rawStats(subjectId);
  return {
    today: raw.todayCount,
    total: raw.totalCount,
    minutes: Math.round(raw.seconds / 60)
  };
}

function bumpStats(subjectId) {
  const raw = rawStats(subjectId);
  raw.date = todayKey();
  raw.todayCount += 1;
  raw.totalCount += 1;
  writeJson(KEY.stats + subjectId, raw);
  return readStats(subjectId);
}

function addSeconds(subjectId, seconds) {
  if (!(seconds > 0)) return readStats(subjectId);
  const raw = rawStats(subjectId);
  raw.date = todayKey();
  raw.seconds += Math.round(seconds);
  writeJson(KEY.stats + subjectId, raw);
  return readStats(subjectId);
}

/* ---------------- 错题本 / 收藏本 ---------------- */

function readWrong(subjectId) {
  const list = readJson(KEY.wrong + subjectId, []);
  return Array.isArray(list) ? list : [];
}

function readFavorites(subjectId) {
  const list = readJson(KEY.fav + subjectId, []);
  return Array.isArray(list) ? list : [];
}

function isFavorite(subjectId, questionId) {
  return readFavorites(subjectId).some((item) => item.id === questionId);
}

function withMeta(question, number) {
  const copy = Object.assign({}, question);
  if (number) copy.number = number;
  return copy;
}

function toggleFavorite(subjectId, question, number) {
  const list = readFavorites(subjectId);
  const exists = list.some((item) => item.id === question.id);
  const next = exists
    ? list.filter((item) => item.id !== question.id)
    : [withMeta(question, number)].concat(list).slice(0, MAX_FAV);
  writeJson(KEY.fav + subjectId, next);

  const records = readRecords(subjectId);
  if (records[question.id]) {
    records[question.id].favorite = !exists;
    writeJson(KEY.record + subjectId, records);
  }
  return !exists;
}

/* ---------------- 做题记录 ---------------- */

function readRecords(subjectId) {
  const map = readJson(KEY.record + subjectId, {});
  return map && typeof map === 'object' ? map : {};
}

function compact(question) {
  return {
    id: question.id,
    subjectId: question.subjectId || '',
    chapter: question.chapter || '',
    section: question.section || '',
    source: question.source || '',
    type: question.type || '',
    renderKind: question.renderKind || 'choice',
    difficulty: question.difficulty || '',
    stem: question.stem || '',
    options: question.options || [],
    answer: question.answer || [],
    explanation: question.explanation || ''
  };
}

function markResult(subjectId, question, number, correct) {
  const records = readRecords(subjectId);
  const prev = records[question.id] || {};
  const firstTime = !prev.done;

  records[question.id] = {
    number: number || prev.number || 0,
    done: true,
    wrong: !correct,
    favorite: prev.favorite === true,
    chapter: question.chapter || prev.chapter || '',
    section: question.section || prev.section || '',
    source: question.source || prev.source || '',
    snapshot: compact(question)
  };
  const keys = Object.keys(records);
  if (keys.length > MAX_RECORD) {
    // 超出上限时丢掉最早记录，避免本地存储无限增长
    const keep = keys.slice(keys.length - MAX_RECORD);
    const trimmed = {};
    keep.forEach((id) => { trimmed[id] = records[id]; });
    writeJson(KEY.record + subjectId, trimmed);
  } else {
    writeJson(KEY.record + subjectId, records);
  }

  const wrong = readWrong(subjectId);
  const exists = wrong.some((item) => item.id === question.id);
  if (!correct && !exists) {
    writeJson(KEY.wrong + subjectId, [withMeta(question, number)].concat(wrong).slice(0, MAX_WRONG));
  } else if (correct && exists) {
    writeJson(KEY.wrong + subjectId, wrong.filter((item) => item.id !== question.id));
  }

  if (firstTime) bumpStats(subjectId);
  return records[question.id];
}

// 按章节 / 小节 / 来源过滤本地记录，供「已做 / 做错 / 收藏」视图使用
function recordsInScope(subjectId, scope) {
  const records = readRecords(subjectId);
  const chapter = (scope && scope.chapter) || '';
  const section = (scope && scope.section) || '';
  const source = (scope && scope.source) || '';
  return Object.keys(records)
    .map((id) => Object.assign({ id }, records[id]))
    .filter((item) => {
      if (chapter && item.chapter !== chapter) return false;
      if (section && item.section !== section) return false;
      if (source && item.source !== source) return false;
      return true;
    });
}

function clearRecords(subjectId) {
  try {
    wx.removeStorageSync(KEY.record + subjectId);
    wx.removeStorageSync(KEY.wrong + subjectId);
    wx.removeStorageSync(KEY.stats + subjectId);
  } catch (_) { /* 忽略存储异常 */ }
}

module.exports = {
  todayKey,
  readStats,
  bumpStats,
  addSeconds,
  readWrong,
  readFavorites,
  isFavorite,
  toggleFavorite,
  readRecords,
  recordsInScope,
  markResult,
  clearRecords
};
