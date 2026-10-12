// 扫源码断言的**统一入口**（阶段 67 / BRIEF FR-139 / AC-129 A1）。
//
// 为什么存在：本仓过去大量断言把**源码文本**当行为契约，直接对**未剥注释**的文本断言。
// 这会产生两个方向的错：
//   - 假红：源码里加一行注释 `// 已删除 pm-mode-use`，`blob.includes('pm-mode-use')` 就变红；
//           把按钮抽成子组件（DOM 顺序与行为都没变）也会红。
//   - 假绿：`assertSomewhere(/<Form[\s>]/)` 把 web/src 全拼成一个 blob，任意一个文件命中即过
//           ⇒ 把整段功能删掉仍然绿。
//
// 因此：凡是要扫源码的测试都必须走这里（`readSource` / `readWebSource` / `sourceFiles` /
// `webSourceFiles`），拿到的文本**已经剥掉注释**。仍然需要未剥注释文本的读取一律用 `readRaw`，
// 且只允许用于「文件是否存在 / 构建产物 / JSON / 二进制」这类**非源码文本**断言，并写明理由。
//
// ⚠️ 本文件**不是** `*.test.ts`（AC-16 的文件计数只数 `*.test.*`），也不会被单独执行。
//
// ⚠️ 剥注释保留**换行**：注释里的字符被替换成空格，行号与偏移量与原文对齐，
//    这样基于 `indexOf` / 行号定位的断言与失败信息仍然可读。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 源码种类决定注释语法。`none` = 没有注释语法的文本（JSON 等），剥注释是恒等变换。 */
export type SourceKind = 'code' | 'css' | 'html' | 'sql' | 'hash' | 'none';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const HASH_EXTENSIONS = ['.yml', '.yaml', '.sh', '.env', '.example', '.conf', '.service', '.toml', '.ini'];

export function sourceKindOf(file: string): SourceKind {
  const ext = path.extname(file).toLowerCase();
  if (CODE_EXTENSIONS.includes(ext)) return 'code';
  if (ext === '.css') return 'css';
  if (ext === '.html') return 'html';
  if (ext === '.sql') return 'sql';
  if (HASH_EXTENSIONS.includes(ext)) return 'hash';
  return 'none';
}

/** 把若干区段替换成空格（换行保留），使剥注释前后的行号与列位置对齐。 */
function blankOut(text: string, ranges: Array<[number, number]>): string {
  const chars = text.split('');
  for (const [from, to] of ranges) {
    for (let index = from; index < to && index < chars.length; index += 1) {
      if (chars[index] !== '\n') chars[index] = ' ';
    }
  }
  return chars.join('');
}

/** `/* … *\/` 形式的块注释（CSS / SQL 用）。 */
function stripBlockComments(text: string, pattern: RegExp): string {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    ranges.push([start, start + match[0].length]);
  }
  return blankOut(text, ranges);
}

/**
 * 剥掉 TS / TSX / JS 的注释。
 *
 * 手写扫描器而不是正则，因为正则会把**字符串里**的 `//`（例如 `'https://…'`）当成注释，
 * 也会把正则字面量里的 `\/` 弄乱 —— 那会让断言在"看起来没问题"的情况下悄悄改变语义。
 * 这里跟踪字符串 / 模板串 / 正则字面量，只清掉真正的注释字符。
 *
 * ⚠️ 本仓的 `typescript` 是 7.x（原生 tsgo），**没有** JS 编译器 API（`ts.createScanner`
 * 不存在），所以无法借用 TS 自己的 scanner；这也是这里手写扫描器的原因。
 */
export function stripCodeComments(text: string): string {
  const chars = text.split('');
  const length = chars.length;
  const ranges: Array<[number, number]> = [];
  // 上一个「有意义的字符」与「上一个单词」，用来判断 `/` 是正则字面量还是除号。
  let previousChar = '';
  let previousWord = '';
  let index = 0;

  const regexAllowed = (): boolean => {
    if (previousChar === '') return true;
    if (/[A-Za-z0-9_$)\]}]/.test(previousChar)) {
      // `return /re/`、`typeof /re/` 这类关键字后面仍然是正则，不是除号。
      return ['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void', 'new', 'do', 'else', 'yield', 'await'].includes(
        previousWord,
      );
    }
    return true;
  };

  while (index < length) {
    const char = chars[index]!;
    const next = chars[index + 1];

    if (char === '/' && next === '/') {
      let end = index;
      while (end < length && chars[end] !== '\n') end += 1;
      ranges.push([index, end]);
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      let end = index + 2;
      while (end < length && !(chars[end] === '*' && chars[end + 1] === '/')) end += 1;
      let commentStart = index;
      let commentEnd = Math.min(length, end + 2);
      // JSX 注释 `{/* … */}`：连外层那对 `{` `}` 一起去掉。
      // 否则剥完会留下一个空的表达式容器 `{    }`，让"品牌区只剩 PromptM"这类断言误判。
      //
      // ⚠️ 只认**紧贴**的 `{/*`（`{` 与 `/*` 之间不允许空白）：对象字面量里的
      // `{\n  /** JSDoc */` 与空对象 `{ /* c */ }` 不是 JSX 注释，擦掉开括号会破坏文本
      // （`catch { /* 隐私模式忽略 */ }` 会被擦成 `catch              `）。
      // 守卫用例：`tests/stage67-source-text.test.ts`。
      if (index > 0 && chars[index - 1] === '{') {
        let after = commentEnd;
        while (after < length && (chars[after] === ' ' || chars[after] === '\t' || chars[after] === '\n')) after += 1;
        if (after < length && chars[after] === '}') {
          commentStart = index - 1;
          commentEnd = after + 1;
        }
      }
      ranges.push([commentStart, commentEnd]);
      index = Math.min(length, end + 2);
      continue;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      while (index < length) {
        if (chars[index] === '\\') {
          index += 2;
          continue;
        }
        if (chars[index] === quote) {
          index += 1;
          break;
        }
        if (chars[index] === '\n') break; // 未闭合的字符串：到此为止，别吃掉后面的代码
        index += 1;
      }
      previousChar = quote;
      previousWord = '';
      continue;
    }

    if (char === '`') {
      index += 1;
      while (index < length) {
        if (chars[index] === '\\') {
          index += 2;
          continue;
        }
        if (chars[index] === '`') {
          index += 1;
          break;
        }
        index += 1;
      }
      previousChar = '`';
      previousWord = '';
      continue;
    }

    if (char === '/' && regexAllowed()) {
      let end = index + 1;
      let inClass = false;
      while (end < length) {
        const inner = chars[end]!;
        if (inner === '\\') {
          end += 2;
          continue;
        }
        if (inner === '\n') break;
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) {
          end += 1;
          break;
        }
        end += 1;
      }
      index = end;
      previousChar = '/';
      previousWord = '';
      continue;
    }

    if (!/\s/.test(char)) {
      previousChar = char;
      previousWord = /[A-Za-z0-9_$]/.test(char) ? `${previousWord}${char}` : '';
    } else if (char === '\n') {
      previousWord = '';
    }
    index += 1;
  }

  return blankOut(text, ranges);
}

/**
 * 剥 SQL 注释（`-- …` 与 `/* … *\/`）。
 *
 * 不能直接用正则：`'a -- b'` 与 `'/* x *\/'` 里的内容**是字符串字面量**，
 * 正则会把 `'read'` / `'write'` / `'view'` 这类值整段擦掉（实测命中
 * `migrations/005_token-scope.sql` 与 `migrations/006_usage-kind.sql` 多处），
 * 让断言读到被破坏的 SQL。这里只在**引号外**识别注释。
 */
function stripSqlComments(text: string): string {
  const ranges: Array<[number, number]> = [];
  const length = text.length;
  let index = 0;
  while (index < length) {
    const char = text[index]!;
    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      while (index < length) {
        if (text[index] === quote) {
          if (text[index + 1] === quote) {
            index += 2; // SQL 的 `''` 转义
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === '-' && text[index + 1] === '-') {
      const end = text.indexOf('\n', index);
      const stop = end === -1 ? length : end;
      ranges.push([index, stop]);
      index = stop;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? length : end + 2;
      ranges.push([index, stop]);
      index = stop;
      continue;
    }
    index += 1;
  }
  return blankOut(text, ranges);
}

/**
 * 剥 YAML / shell 的 `#` 注释。
 *
 * - `^[ \t]*#…`：整行注释；
 * - 行内 `#`：**前一个字符必须是空白**（YAML / shell 的规定），且不在 `'` `"` 引号内
 *   —— 这样 `${VAR#prefix}`、`URL#frag`、`foo#bar` 都不会被误剥。
 *
 * 之前只剥整行注释，于是 `key: 1 # c` / `echo hi # c` 剥完仍含 `# c`，
 * 对 `.yml` / `.sh` 的源码断言仍可能被行内注释骗过（对抗性复核实测）。
 */
function stripHashComments(text: string): string {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    let index = 0;
    while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1;
    if (line[index] === '#') {
      ranges.push([offset, offset + line.length]);
    } else {
      let quote: string | null = null;
      for (let position = 0; position < line.length; position += 1) {
        const char = line[position]!;
        if (quote !== null) {
          if (char === quote) quote = null;
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
          continue;
        }
        if (char === '#' && (position === 0 || /\s/.test(line[position - 1]!))) {
          ranges.push([offset + position, offset + line.length]);
          break;
        }
      }
    }
    offset += line.length + 1;
  }
  return blankOut(text, ranges);
}

/** 按文件种类剥注释（`none` 原样返回）。 */
export function stripSourceComments(text: string, kind: SourceKind = 'code'): string {
  switch (kind) {
    case 'code':
      return stripCodeComments(text);
    case 'css':
      return stripBlockComments(text, /\/\*[\s\S]*?\*\//g);
    case 'html':
      return stripBlockComments(text, /<!--[\s\S]*?-->/g);
    case 'sql':
      return stripSqlComments(text);
    case 'hash':
      return stripHashComments(text);
    default:
      return text;
  }
}

const rawCache = new Map<string, string>();
const strippedCache = new Map<string, string>();

/**
 * 读**未剥注释**的文本。
 *
 * ⚠️ 只允许用于「文件是否存在 / 构建产物 / JSON / 二进制」这类**非源码文本**断言，
 * 并在调用处写明理由。任何「源码里有没有某个写法」的断言都必须用 `readSource`。
 */
export function readRaw(relative: string): string {
  const key = path.normalize(relative);
  const cached = rawCache.get(key);
  if (cached !== undefined) return cached;
  const text = readFileSync(path.isAbsolute(relative) ? relative : path.join(PROJECT_ROOT, relative), 'utf8');
  rawCache.set(key, text);
  return text;
}

/** 读**二进制**（构建产物体积、gzip 统计等非文本断言）。路径相对仓库根，或传绝对路径。 */
export function readBytes(relative: string): Buffer {
  return readFileSync(path.isAbsolute(relative) ? relative : path.join(PROJECT_ROOT, relative));
}

/** 读并解析 JSON（JSON 没有注释语法，剥注释是恒等变换）。路径相对仓库根，或传绝对路径。 */
export function readJson<T>(relative: string): T {
  return JSON.parse(readRaw(relative)) as T;
}

/** 读仓库内某个文件并**剥掉注释**（源码级断言的默认入口）。路径相对仓库根，或传绝对路径。 */
export function readSource(relative: string): string {
  const key = path.normalize(relative);
  const cached = strippedCache.get(key);
  if (cached !== undefined) return cached;
  const text = stripSourceComments(readRaw(relative), sourceKindOf(relative));
  strippedCache.set(key, text);
  return text;
}

/** 读 `web/src/<relative>` 并剥注释（前端源码级断言最常用的入口）。 */
export function readWebSource(relative: string): string {
  return readSource(path.join('web', 'src', relative));
}

export interface SourceFile {
  /** 相对仓库根的路径（POSIX 分隔符），与 `path.relative(PROJECT_ROOT, …)` 一致。 */
  rel: string;
  /** 已剥注释的文本。 */
  text: string;
}

function walkFiles(absoluteDir: string): string[] {
  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkFiles(full);
    if (!entry.isFile()) return [];
    return [full];
  });
}

/** 递归收集某个目录下的源码文件（默认 `.ts` / `.tsx`），文本已剥注释。 */
export function sourceFiles(relativeDir: string, extensions: string[] = ['.ts', '.tsx']): SourceFile[] {
  const absoluteDir = path.join(PROJECT_ROOT, relativeDir);
  return walkFiles(absoluteDir)
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => ({ rel: path.relative(PROJECT_ROOT, file), text: readSource(file) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** `web/src` 下的全部 `.ts` / `.tsx`（已剥注释），`rel` 相对仓库根。 */
export function webSourceFiles(): SourceFile[] {
  return sourceFiles(path.join('web', 'src'));
}

/** 文件是否存在（唯一允许不读文本的检查；AC-129 ② 的例外）。 */
export function fileExists(relative: string): boolean {
  try {
    return statSync(path.join(PROJECT_ROOT, relative)).isFile();
  } catch {
    return false;
  }
}
