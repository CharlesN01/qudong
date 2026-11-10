// 题型中文名与「要不要给选项」的统一判断。
// 题库里 render_kind 决定渲染方式：choice 给选项、fill/subjective 要写字，
// type 决定具体叫法（单选/多选/判断/填空/文言翻译…）。

const TYPE_NAMES = {
  single: '单选题', multiple: '多选题', judge: '判断题', choice: '选择题',
  fill: '填空题', word_explain: '字词解释', classical_translation: '文言翻译',
  translation: '翻译', c2e_translation: '英译汉', short: '简答题', proof: '证明题',
  reading: '阅读理解', seven_choice: '七选五', cloze: '完形填空',
  practical_writing: '应用文', argumentative_writing: '作文',
  modern_reading: '现代文阅读', poem_reading: '诗歌鉴赏', subjective: '主观题'
};

function typeName(type, renderKind) {
  if (TYPE_NAMES[type]) return TYPE_NAMES[type];
  if (renderKind === 'fill') return '填空题';
  if (renderKind === 'subjective') return '主观题';
  return '选择题';
}

// true 表示这道题有 A/B/C/D 选项；false 表示要写文字作答
function isObjective(renderKind) {
  return (renderKind || 'choice') === 'choice';
}

function multipleChoice(type) {
  return type === 'multiple';
}

// 要写字、但可以按答案文字自动判分的题型（与刷题页保持一致）
const AUTO_GRADED_TYPES = ['fill', 'word_explain', 'classical_translation', 'translation', 'c2e_translation'];

function autoGradedText(type) {
  return AUTO_GRADED_TYPES.indexOf(type) >= 0;
}

// 文字比对时忽略空白和常见标点，避免「，」和「,」被判成不同答案
function normalizeAnswerText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\s，。、；;,.!?！？""''（）()]/g, '')
    .toLowerCase();
}

module.exports = {
  TYPE_NAMES, typeName, isObjective, multipleChoice,
  AUTO_GRADED_TYPES, autoGradedText, normalizeAnswerText
};
