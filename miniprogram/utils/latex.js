// 题库题干与选项里带 LaTeX 片段（如 $y=\frac{1}{\sqrt{4-x^{2}}}$）。
// 小程序没有数学排版能力，这里做轻量降级：按字符扫描解析，把命令换成可读符号。
// 目标不是排版精美，而是让人一眼看懂题目在问什么。

const SUPERSCRIPT = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴',
  5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', k: 'ᵏ', m: 'ᵐ'
};

const SUBSCRIPT = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄',
  5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  n: 'ₙ', i: 'ᵢ', x: 'ₓ', a: 'ₐ', k: 'ₖ', m: 'ₘ'
};

// 命令名 -> 替换文本。未列出的命令会被丢弃（保留其后的内容）。
const COMMANDS = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓',
  cdots: '…', ldots: '…', dots: '…',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', propto: '∝',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ',
  epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  Theta: 'Θ', iota: 'ι', kappa: 'κ', lambda: 'λ', Lambda: 'Λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', Pi: 'Π', rho: 'ρ',
  sigma: 'σ', Sigma: 'Σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', omega: 'ω', Omega: 'Ω',
  prime: '′', circ: '°', degree: '°', angle: '∠', perp: '⊥', parallel: '∥',
  ln: 'ln', log: 'log', lg: 'lg', lim: 'lim', max: 'max', min: 'min',
  sup: 'sup', inf: 'inf', det: 'det', gcd: 'gcd', mod: 'mod',
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '',
  ' ': ' ', '\\': '\n',
  '%': '%', '&': '&', '#': '#', '_': '_', '{': '{', '}': '}'
};

// 需要吞掉、不产生输出的排版命令
const SILENT = ['displaystyle', 'textstyle', 'scriptstyle', 'left', 'right',
  'limits', 'nolimits', 'mathrm', 'mathbf', 'mathit', 'text', 'textbf',
  'operatorname', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr'];

function readGroup(src, start) {
  // 读 {...}；没有花括号时读单个字符
  if (src[start] !== '{') {
    if (start >= src.length) return { text: '', next: start };
    return { text: src[start], next: start + 1 };
  }
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return { text: src.slice(start + 1, i), next: i + 1 };
    }
  }
  return { text: src.slice(start + 1), next: src.length };
}

function scriptText(body, map, mark) {
  const chars = Array.from(body);
  if (chars.length && chars.every((char) => map[char])) {
    return chars.map((char) => map[char]).join('');
  }
  // 单个符号（如 ′、°）直接跟上去，不套 ^()
  if (chars.length === 1 && !/[a-zA-Z0-9]/.test(chars[0])) return body;
  return mark + '(' + body + ')';
}

function readScript(src, start) {
  let i = start;
  while (src[i] === ' ') i += 1;
  return readGroup(src, i);
}

function render(src) {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const char = src[i];

    if (char === '\\') {
      let j = i + 1;
      let name = '';
      if (/[a-zA-Z]/.test(src[j] || '')) {
        while (j < src.length && /[a-zA-Z]/.test(src[j])) {
          name += src[j];
          j += 1;
        }
      } else {
        name = src[j] || '';
        j += 1;
      }
      let hadSpace = false;
      while (src[j] === ' ') {
        j += 1;
        hadSpace = true;
      }

      if (SILENT.indexOf(name) >= 0) {
        i = j;
        continue;
      }

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const numerator = readGroup(src, j);
        const denominator = readGroup(src, numerator.next);
        out += '(' + render(numerator.text) + ')/(' + render(denominator.text) + ')';
        i = denominator.next;
        continue;
      }

      if (name === 'sqrt') {
        let k = j;
        let index = '';
        if (src[k] === '[') {
          const close = src.indexOf(']', k);
          if (close > 0) {
            index = src.slice(k + 1, close);
            k = close + 1;
          }
          while (src[k] === ' ') k += 1;
        }
        const group = readGroup(src, k);
        const body = render(group.text);
        out += index ? '(' + body + ')^(1/' + render(index) + ')' : '√(' + body + ')';
        i = group.next;
        continue;
      }

      if (name === 'overline' || name === 'bar') {
        const group = readGroup(src, j);
        out += render(group.text) + '̄';
        i = group.next;
        continue;
      }

      if (COMMANDS[name] !== undefined) {
        const value = COMMANDS[name];
        out += value;
        // 命令后的空格是分隔符，替换后要补回来，否则 sin x 变成 sinx、⊆ A 变成 ⊆A
        if (hadSpace && value && value !== ' ') out += ' ';
        i = j;
        continue;
      }

      // 未知命令：丢掉命令名，保留后面的内容
      i = j;
      continue;
    }

    if (char === '{') {
      const group = readGroup(src, i);
      out += render(group.text);
      i = group.next;
      continue;
    }

    if (char === '}' || char === '$') {
      i += 1;
      continue;
    }

    if (char === '^' || char === '_') {
      const next = src[i + 1];
      // 只有 _{...} 或 _x 这种才是上下标。
      // 英语填空题的空格是一长串下划线（__________），不能当下标吃进去。
      const isScript = next === '{' || (next !== undefined && /[0-9a-zA-Z]/.test(next));
      if (!isScript) {
        out += char;
        i += 1;
        continue;
      }
      const target = readScript(src, i + 1);
      const body = render(target.text);
      out += char === '^'
        ? scriptText(body, SUPERSCRIPT, '^')
        : scriptText(body, SUBSCRIPT, '_');
      i = target.next;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

function prettify(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);

  // 数学环境标记先剥掉
  text = text.replace(/\$\$/g, '');
  text = text.replace(/\$/g, '');
  text = text.replace(/\\\(|\\\)/g, '');
  text = text.replace(/\\\[|\\\]/g, '');

  text = render(text);

  // 收尾：合并空白、去掉多余空格
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  return text.trim();
}

// 选项统一加 A/B/C/D 前缀，便于和答案字母对应。
// 英语选词填空题最多给到 12 个词，必须支持到 L，所以直接铺满 26 个字母。
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function buildOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option, index) => ({
    letter: LETTERS[index] || String(index + 1),
    text: prettify(option)
  }));
}

function normalizeAnswer(answer) {
  if (Array.isArray(answer)) return answer.map((item) => String(item).trim().toUpperCase());
  if (answer === null || answer === undefined || answer === '') return [];
  return [String(answer).trim().toUpperCase()];
}

module.exports = { prettify, buildOptions, normalizeAnswer, LETTERS };
