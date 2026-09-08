import type {
  FileType, SheetData, ParagraphData, ParsedData, ParagraphDiffItem,
  DiffType, CellDiff, RowDiff, SheetDiffResult, ColumnMapping, KeyScore,
  FieldHotspot, NumericChangeSummary, DiffStatistics, TypicalDiff,
  DocumentDiffResult, ReconciliationSummary, NumericColumnComparison,
  MatchClassification, MatchClassificationRow, CrossKeyMapping, MatchQuality,
  TimeGranularity, TimeComparisonRow, TimeComparison,
} from '@/types';
import * as XLSX from 'xlsx';

// ─── 基础工具 ─────────────────────────────────────────────

export function getFileType(fileName: string, mimeType: string): FileType {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const excelExts = ['xlsx', 'xls', 'csv', 'ods'];
  const wordExts = ['docx', 'doc', 'docm', 'dotx'];
  const pdfExts = ['pdf'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff'];

  if (excelExts.includes(ext) || mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'excel';
  if (wordExts.includes(ext) || mimeType.includes('word') || mimeType.includes('document')) return 'word';
  if (pdfExts.includes(ext)) return 'pdf';
  if (imageExts.includes(ext) || mimeType.startsWith('image/')) return 'image';
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export function getFileIcon(type: FileType): string {
  const icons: Record<FileType, string> = { excel: '📊', word: '📄', pdf: '📕', image: '🖼️', other: '📁' };
  return icons[type];
}

export function arrayToSheetData(name: string, data: unknown[][]): SheetData {
  if (!data || data.length === 0) {
    return { name, headers: [], rows: [], rowCount: 0, columnCount: 0 };
  }
  const headers = (data[0] as string[]).map((h) => String(h ?? '').trim());
  const rows = data.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, idx) => { obj[header] = row[idx]; });
    return obj;
  });
  return { name, headers, rows, rowCount: rows.length, columnCount: headers.length };
}

// ─── 值归一化 ─────────────────────────────────────────────

const NUMERIC_EPSILON = 1e-6;

const DATE_PATTERNS = [
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
  /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/,
];

function parseDateToISO(val: string): string | null {
  const trimmed = val.trim();
  for (const pat of DATE_PATTERNS) {
    const m = trimmed.match(pat);
    if (!m) continue;
    if (pat === DATE_PATTERNS[0]) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function tryParseNumber(val: unknown): number | null {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val !== 'string' || val.trim() === '') return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

// 增强数值解析：容忍千分位逗号、货币符号、空白、常见单位后缀
export function parseRobustNumber(val: unknown): { num: number | null; unparsed: boolean } {
  if (val === undefined || val === null) return { num: null, unparsed: false };
  if (typeof val === 'number' && isFinite(val)) return { num: val, unparsed: false };
  if (typeof val !== 'string') return { num: null, unparsed: true };

  const trimmed = val.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return { num: null, unparsed: false };

  // 去除货币符号、空白、常见单位后缀
  const cleaned = trimmed
    .replace(/[¥$€£￥]/g, '')
    .replace(/\s+/g, '')
    .replace(/(件|单|个|台|套|箱|包|瓶|kg|KG|Kg|g|G|ml|ML|L|l)$/i, '')
    .replace(/,$/, '');

  if (cleaned === '' || cleaned === '-') return { num: null, unparsed: false };

  // 去除千分位逗号（如 "1,234,567" → "1234567"）
  const noCommas = cleaned.replace(/,/g, '');
  const n = Number(noCommas);
  if (isFinite(n)) return { num: n, unparsed: false };

  return { num: null, unparsed: true };
}

// 值域重合度检测：从两列各抽样非空值，计算交集占较小一侧的比例
export function computeValueOverlap(
  oldCol: string,
  newCol: string,
  oldRows: Record<string, unknown>[],
  newRows: Record<string, unknown>[],
  maxSample = 500,
): number {
  const extractValues = (rows: Record<string, unknown>[], col: string, max: number): Set<string> => {
    const vals = new Set<string>();
    for (let i = 0; i < rows.length && vals.size < max; i++) {
      const v = rows[i][col];
      if (v !== undefined && v !== null) {
        const s = String(v).trim();
        if (s !== '') vals.add(s);
      }
    }
    return vals;
  };

  const oldVals = extractValues(oldRows, oldCol, maxSample);
  const newVals = extractValues(newRows, newCol, maxSample);

  if (oldVals.size === 0 || newVals.size === 0) return 0;

  let intersection = 0;
  const smaller = oldVals.size <= newVals.size ? oldVals : newVals;
  const larger = oldVals.size <= newVals.size ? newVals : oldVals;
  for (const v of smaller) {
    if (larger.has(v)) intersection++;
  }
  return intersection / smaller.size;
}

// 跨列主键检测：综合列名相似度 + 值域重合度 + 值唯一性评分
export function detectCrossKeyMapping(
  oldSheet: SheetData,
  newSheet: SheetData,
): { oldKey: string; newKey: string; method: 'name' | 'valueOverlap'; overlapRatio: number } {
  const oldScores = analyzeKeyColumns(oldSheet);
  const newScores = analyzeKeyColumns(newSheet);

  // 先尝试同名匹配
  for (const os of oldScores) {
    for (const ns of newScores) {
      if (os.column === ns.column && os.uniqueRatio > 0.5 && ns.uniqueRatio > 0.5) {
        return { oldKey: os.column, newKey: ns.column, method: 'name', overlapRatio: 1 };
      }
    }
  }

  // 再尝试列名相似度
  for (const os of oldScores) {
    for (const ns of newScores) {
      const nameSim = columnNameSimilarity(os.column, ns.column);
      if (nameSim >= 0.65 && os.uniqueRatio > 0.3 && ns.uniqueRatio > 0.3) {
        return { oldKey: os.column, newKey: ns.column, method: 'name', overlapRatio: nameSim };
      }
    }
  }

  // 最后尝试值域重合度
  let bestOverlap = 0;
  let bestPair = { oldKey: oldScores[0]?.column || '', newKey: newScores[0]?.column || '' };
  for (const os of oldScores.slice(0, 5)) {
    for (const ns of newScores.slice(0, 5)) {
      const overlap = computeValueOverlap(os.column, ns.column, oldSheet.rows, newSheet.rows);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestPair = { oldKey: os.column, newKey: ns.column };
      }
    }
  }

  if (bestOverlap >= 0.6) {
    return { oldKey: bestPair.oldKey, newKey: bestPair.newKey, method: 'valueOverlap', overlapRatio: bestOverlap };
  }

  // fallback: 各取评分最高的列
  return {
    oldKey: oldScores[0]?.column || oldSheet.headers[0] || '',
    newKey: newScores[0]?.column || newSheet.headers[0] || '',
    method: 'name',
    overlapRatio: 0,
  };
}

export function normalizeValue(val: unknown): { normalized: string; numVal: number | null } {
  if (val === undefined || val === null) return { normalized: '', numVal: null };

  const num = tryParseNumber(val);
  if (num !== null) {
    return { normalized: String(num), numVal: num };
  }

  const str = String(val).trim();
  const dateISO = parseDateToISO(str);
  if (dateISO) {
    return { normalized: dateISO, numVal: null };
  }

  return { normalized: str, numVal: null };
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);

  if (na.numVal !== null && nb.numVal !== null) {
    return Math.abs(na.numVal - nb.numVal) < NUMERIC_EPSILON;
  }

  return na.normalized === nb.normalized;
}

// ─── 相似度计算 ─────────────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const maxLen = Math.max(la, lb);
  if (Math.abs(la - lb) / maxLen > 0.4) return maxLen;

  const dp: number[] = Array.from({ length: lb + 1 }, (_, j) => j);

  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[lb];
}

export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function rowToString(row: Record<string, unknown>, headers: string[]): string {
  return headers.map((h) => String(row[h] ?? '').trim()).join('|');
}

function computeRowSimilarity(
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>,
  headers: string[],
  keyCol: string,
): { similarity: number; reason: string } {
  const oldKey = String(oldRow[keyCol] ?? '').trim();
  const newKey = String(newRow[keyCol] ?? '').trim();
  const keySim = stringSimilarity(oldKey, newKey);

  const oldStr = rowToString(oldRow, headers).slice(0, 500);
  const newStr = rowToString(newRow, headers).slice(0, 500);
  const rowSim = stringSimilarity(oldStr, newStr);

  const combined = keySim * 0.5 + rowSim * 0.5;

  const reasons: string[] = [];
  if (keySim >= 0.8 && keySim < 1) {
    reasons.push(`主键 "${oldKey}" ≈ "${newKey}"`);
  }
  if (rowSim >= 0.85) {
    reasons.push('整行内容高度相似');
  }

  const diffs: string[] = [];
  for (const h of headers) {
    if (!valuesEqual(oldRow[h], newRow[h])) {
      diffs.push(h);
    }
  }
  if (diffs.length > 0 && diffs.length <= 3) {
    reasons.push(`仅 ${diffs.join('、')} 有差异`);
  }

  return { similarity: combined, reason: reasons.join('，') || '综合相似度匹配' };
}

// ─── 智能主键识别 ─────────────────────────────────────────────

export function analyzeKeyColumns(sheet: SheetData): KeyScore[] {
  if (sheet.headers.length === 0 || sheet.rows.length === 0) return [];

  return sheet.headers.map((col) => {
    const values = sheet.rows.map((r) => r[col]);
    const nonNull = values.filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
    const uniqueVals = new Set(nonNull.map((v) => String(v).trim()));
    const uniqueRatio = nonNull.length > 0 ? uniqueVals.size / sheet.rows.length : 0;
    const nullRatio = 1 - nonNull.length / sheet.rows.length;
    const score = uniqueRatio * 0.7 + (1 - nullRatio) * 0.3;
    return { column: col, uniqueRatio, nullRatio, score };
  }).sort((a, b) => b.score - a.score);
}

export function selectBestKey(scores: KeyScore[], userKey?: string): string {
  if (userKey) return userKey;
  if (scores.length === 0) return '';
  return scores[0].column;
}

// ─── 智能列映射 ─────────────────────────────────────────────

function columnNameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return stringSimilarity(na, nb);
}

const COLUMN_MAP_THRESHOLD = 0.65;

export function mapColumns(
  oldHeaders: string[],
  newHeaders: string[],
): { mappings: ColumnMapping[]; unmappedOld: string[]; unmappedNew: string[] } {
  const mappings: ColumnMapping[] = [];
  const usedNew = new Set<string>();
  const unmappedOld: string[] = [];

  for (const oldCol of oldHeaders) {
    let bestMatch = '';
    let bestSim = 0;
    for (const newCol of newHeaders) {
      if (usedNew.has(newCol)) continue;
      const sim = columnNameSimilarity(oldCol, newCol);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = newCol;
      }
    }
    if (bestSim >= COLUMN_MAP_THRESHOLD && bestMatch) {
      mappings.push({ oldColumn: oldCol, newColumn: bestMatch, similarity: bestSim });
      usedNew.add(bestMatch);
    } else {
      unmappedOld.push(oldCol);
    }
  }

  const unmappedNew = newHeaders.filter((h) => !usedNew.has(h));
  return { mappings, unmappedOld, unmappedNew };
}

// ─── 文本比对（保留原有 LCS 逻辑） ─────────────────────────

export function diffParagraphs(
  oldParagraphs: ParagraphData[],
  newParagraphs: ParagraphData[],
): ParagraphDiffItem[] {
  const oldTexts = oldParagraphs.map((p) => p.text);
  const newTexts = newParagraphs.map((p) => p.text);
  const result: ParagraphDiffItem[] = [];
  const oldLen = oldTexts.length;
  const newLen = newTexts.length;
  let i = 0, j = 0, idx = 0;

  while (i < oldLen && j < newLen) {
    if (oldTexts[i] === newTexts[j]) {
      result.push({ index: idx++, diffType: 'unchanged', oldIndex: i, newIndex: j, oldText: oldTexts[i], newText: newTexts[j] });
      i++; j++;
    } else {
      let found = false;
      const lookAhead = 5;
      for (let k = 1; k <= lookAhead && i + k < oldLen; k++) {
        if (oldTexts[i + k] === newTexts[j]) {
          for (let m = 0; m < k; m++) {
            result.push({ index: idx++, diffType: 'removed', oldIndex: i + m, oldText: oldTexts[i + m] });
          }
          i += k; found = true; break;
        }
      }
      if (!found) {
        for (let k = 1; k <= lookAhead && j + k < newLen; k++) {
          if (oldTexts[i] === newTexts[j + k]) {
            for (let m = 0; m < k; m++) {
              result.push({ index: idx++, diffType: 'added', newIndex: j + m, newText: newTexts[j + m] });
            }
            j += k; found = true; break;
          }
        }
      }
      if (!found) {
        result.push({ index: idx++, diffType: 'modified', oldIndex: i, newIndex: j, oldText: oldTexts[i], newText: newTexts[j] });
        i++; j++;
      }
    }
  }
  while (i < oldLen) {
    result.push({ index: idx++, diffType: 'removed', oldIndex: i, oldText: oldTexts[i] });
    i++;
  }
  while (j < newLen) {
    result.push({ index: idx++, diffType: 'added', newIndex: j, newText: newTexts[j] });
    j++;
  }
  return result;
}

// ─── 键值归一化 ─────────────────────────────────────────────

function normalizeKeyValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  // 全角→半角（字母、数字、常见标点）
  s = s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/\u3000/g, ' '); // 全角空格→半角
  // 去千分位逗号
  s = s.replace(/,/g, '');
  // 大小写统一
  s = s.toUpperCase();
  // 数值型去前导零（保留 "0" 本身）
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    s = String(Number(s));
  }
  return s;
}

// 找到与指定列值域重合度最高的目标 sheet 列
function findBestOverlapColumn(
  sourceCol: string,
  sourceRows: Record<string, unknown>[],
  targetSheet: SheetData,
): { column: string; overlapRatio: number } {
  let bestCol = targetSheet.headers[0] || sourceCol;
  let bestOverlap = 0;
  for (const col of targetSheet.headers) {
    const overlap = computeValueOverlap(sourceCol, col, sourceRows, targetSheet.rows);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestCol = col;
    }
  }
  return { column: bestCol, overlapRatio: bestOverlap };
}

// ─── 核心：智能表格比对引擎 ─────────────────────────────────

const SUSPECTED_THRESHOLD = 0.85;

export function diffSheets(
  oldSheet: SheetData,
  newSheet: SheetData,
  keyColumn?: string,
  oldKeyColumn?: string,
  newKeyColumn?: string,
  oldTimeColumn?: string,
  newTimeColumn?: string,
  timeGranularity?: TimeGranularity,
): SheetDiffResult {
  const allHeaders = [...new Set([...oldSheet.headers, ...newSheet.headers])];
  const keyScores = analyzeKeyColumns(oldSheet.headers.length > 0 ? oldSheet : newSheet);

  // ─── 跨列主键检测（始终执行，除非用户两侧都明确指定） ───
  let crossKeyMapping: CrossKeyMapping | undefined;
  let oldKey: string;
  let newKey: string;
  let method: CrossKeyMapping['method'] = 'auto';

  if (oldKeyColumn && newKeyColumn) {
    // 用户两侧都明确指定
    oldKey = oldKeyColumn;
    newKey = newKeyColumn;
    method = 'manual';
  } else if (oldKeyColumn && !newKeyColumn) {
    // 用户只指定了 A 侧，用值域重合找 B 侧
    oldKey = oldKeyColumn;
    const overlap = findBestOverlapColumn(oldKey, oldSheet.rows, newSheet);
    newKey = overlap.column;
    method = 'partialA';
  } else if (!oldKeyColumn && newKeyColumn) {
    // 用户只指定了 B 侧，用值域重合找 A 侧
    newKey = newKeyColumn;
    const overlap = findBestOverlapColumn(newKey, newSheet.rows, oldSheet);
    oldKey = overlap.column;
    method = 'partialB';
  } else {
    // 自动模式：始终执行跨列检测
    const detected = detectCrossKeyMapping(oldSheet, newSheet);
    oldKey = detected.oldKey;
    newKey = detected.newKey;
    method = detected.method;
  }

  // ─── 主键列存在性校验 ───
  if (!oldSheet.headers.includes(oldKey)) {
    throw new Error(`主键列「${oldKey}」在文件A中不存在（可用列：${oldSheet.headers.join('、')}），请重新选择主键`);
  }
  if (!newSheet.headers.includes(newKey)) {
    throw new Error(`主键列「${newKey}」在文件B中不存在（可用列：${newSheet.headers.join('、')}），请重新选择主键`);
  }

  if (oldKey !== newKey) {
    const overlap = computeValueOverlap(oldKey, newKey, oldSheet.rows, newSheet.rows);
    crossKeyMapping = { oldKeyColumn: oldKey, newKeyColumn: newKey, method, overlapRatio: overlap };
  }

  const displayKey = oldKey; // 展示用主键名（优先用 A 侧列名）

  // 列映射
  const { mappings: columnMappings, unmappedOld, unmappedNew } = mapColumns(oldSheet.headers, newSheet.headers);
  const displayHeaders = allHeaders;

  // 复合键处理：统计主键重复（使用归一化键值）
  const oldKeyCounts = new Map<string, number>();
  const newKeyCounts = new Map<string, number>();
  for (const row of oldSheet.rows) {
    const k = normalizeKeyValue(row[oldKey]);
    oldKeyCounts.set(k, (oldKeyCounts.get(k) || 0) + 1);
  }
  for (const row of newSheet.rows) {
    const k = normalizeKeyValue(row[newKey]);
    newKeyCounts.set(k, (newKeyCounts.get(k) || 0) + 1);
  }
  const duplicateKeys = new Set<string>();
  for (const [k, c] of oldKeyCounts) { if (c > 1) duplicateKeys.add(k); }
  for (const [k, c] of newKeyCounts) { if (c > 1) duplicateKeys.add(k); }
  const duplicateKeyCount = duplicateKeys.size;

  // 构建复合键索引（使用归一化键值）
  const buildCompositeMap = (
    rows: Record<string, unknown>[],
    keyCounts: Map<string, number>,
    keyCol: string,
  ): Map<string, Record<string, unknown>[]> => {
    const map = new Map<string, Record<string, unknown>[]>();
    const counter = new Map<string, number>();
    for (const row of rows) {
      const rawKey = normalizeKeyValue(row[keyCol]);
      const total = keyCounts.get(rawKey) || 1;
      const idx = (counter.get(rawKey) || 0) + 1;
      counter.set(rawKey, idx);
      const compositeKey = total > 1 ? `${rawKey}#${idx}` : rawKey;
      const arr = map.get(compositeKey) || [];
      arr.push(row);
      map.set(compositeKey, arr);
    }
    return map;
  };

  const oldIndex = buildCompositeMap(oldSheet.rows, oldKeyCounts, oldKey);
  const newIndex = buildCompositeMap(newSheet.rows, newKeyCounts, newKey);

  const allKeys = new Set([...oldIndex.keys(), ...newIndex.keys()]);
  const rows: RowDiff[] = [];
  let added = 0, removed = 0, modified = 0, unchanged = 0, suspected = 0;
  let rowIndex = 0;

  const matchedNewKeys = new Set<string>();

  // 比较两行在所有列上的差异
  const compareRows = (
    oldRow: Record<string, unknown>,
    newRow: Record<string, unknown>,
  ): { cells: CellDiff[]; hasDiff: boolean } => {
    const cells: CellDiff[] = [];
    let hasDiff = false;
    for (const col of displayHeaders) {
      const oldVal = oldRow[col];
      const newVal = newRow[col];
      const eq = valuesEqual(oldVal, newVal);
      if (!eq) hasDiff = true;
      cells.push({
        column: col,
        oldValue: oldVal,
        newValue: newVal,
        diffType: eq ? 'unchanged' : 'modified',
      });
    }
    return { cells, hasDiff };
  };

  // 第一轮：精确主键匹配
  for (const k of allKeys) {
    const oldRows = oldIndex.get(k);
    const newRows = newIndex.get(k);

    if (oldRows && newRows) {
      // 两侧都有该键
      const pairCount = Math.max(oldRows.length, newRows.length);
      for (let p = 0; p < pairCount; p++) {
        const oldRow = oldRows[Math.min(p, oldRows.length - 1)];
        const newRow = newRows[Math.min(p, newRows.length - 1)];
        const { cells, hasDiff } = compareRows(oldRow, newRow);
        if (hasDiff) {
          modified++;
          rows.push({ rowIndex: rowIndex++, key: k, diffType: 'modified', cells, oldRow, newRow });
        } else {
          unchanged++;
          rows.push({ rowIndex: rowIndex++, key: k, diffType: 'unchanged', cells, oldRow, newRow });
        }
      }
      matchedNewKeys.add(k);
    }
  }

  // 第二轮：收集未匹配的行，做相似度配对
  const unmatchedOld: Array<{ key: string; row: Record<string, unknown> }> = [];
  const unmatchedNew: Array<{ key: string; row: Record<string, unknown> }> = [];

  for (const [k, oldRows] of oldIndex) {
    if (!matchedNewKeys.has(k)) {
      for (const row of oldRows) unmatchedOld.push({ key: k, row });
    }
  }
  for (const [k, newRows] of newIndex) {
    if (!matchedNewKeys.has(k)) {
      for (const row of newRows) unmatchedNew.push({ key: k, row });
    }
  }

  // 相似度贪心匹配（带性能保护）
  const usedOldIdx = new Set<number>();
  const usedNewIdx = new Set<number>();
  const skipSimilarity = unmatchedOld.length * unmatchedNew.length > 20000;

  if (!skipSimilarity) {
    const pairScores: Array<{ oldIdx: number; newIdx: number; sim: number; reason: string }> = [];
    for (let oi = 0; oi < unmatchedOld.length; oi++) {
      for (let ni = 0; ni < unmatchedNew.length; ni++) {
        const { similarity, reason } = computeRowSimilarity(
          unmatchedOld[oi].row, unmatchedNew[ni].row, displayHeaders, oldKey,
        );
        if (similarity >= SUSPECTED_THRESHOLD) {
          pairScores.push({ oldIdx: oi, newIdx: ni, sim: similarity, reason });
        }
      }
    }
    pairScores.sort((a, b) => b.sim - a.sim);

    for (const pair of pairScores) {
      if (usedOldIdx.has(pair.oldIdx) || usedNewIdx.has(pair.newIdx)) continue;
      usedOldIdx.add(pair.oldIdx);
      usedNewIdx.add(pair.newIdx);

      const oldRow = unmatchedOld[pair.oldIdx].row;
      const newRow = unmatchedNew[pair.newIdx].row;
      const { cells } = compareRows(oldRow, newRow);
      const displayKey = unmatchedOld[pair.oldIdx].key;
      suspected++;
      rows.push({
        rowIndex: rowIndex++,
        key: displayKey,
        diffType: 'suspected',
        cells,
        oldRow,
        newRow,
        matchReason: pair.reason,
        similarity: pair.sim,
      });
    }
  }

  // 剩余未匹配的 → added / removed
  for (let ni = 0; ni < unmatchedNew.length; ni++) {
    if (usedNewIdx.has(ni)) continue;
    const newRow = unmatchedNew[ni].row;
    added++;
    const cells: CellDiff[] = displayHeaders.map((col) => ({
      column: col,
      oldValue: undefined,
      newValue: newRow[col],
      diffType: 'added' as DiffType,
    }));
    rows.push({ rowIndex: rowIndex++, key: unmatchedNew[ni].key, diffType: 'added', cells, newRow });
  }

  for (let oi = 0; oi < unmatchedOld.length; oi++) {
    if (usedOldIdx.has(oi)) continue;
    const oldRow = unmatchedOld[oi].row;
    removed++;
    const cells: CellDiff[] = displayHeaders.map((col) => ({
      column: col,
      oldValue: oldRow[col],
      newValue: undefined,
      diffType: 'removed' as DiffType,
    }));
    rows.push({ rowIndex: rowIndex++, key: unmatchedOld[oi].key, diffType: 'removed', cells, oldRow });
  }

  // 对账汇总
  const reconciliation = computeReconciliationSummary(oldSheet, newSheet, oldKey, newKey, columnMappings);
  const matchClassification = computeMatchClassification(rows, oldKey, newKey, columnMappings);

  // 按时间对比
  const effectiveOldTimeCol = oldTimeColumn || detectTimeColumn(oldSheet) || '';
  const effectiveNewTimeCol = newTimeColumn || detectTimeColumn(newSheet) || '';
  const timeComparisonResult = (effectiveOldTimeCol && effectiveNewTimeCol)
    ? computeTimeComparison(oldSheet, newSheet, effectiveOldTimeCol, effectiveNewTimeCol, columnMappings, timeGranularity || null)
    : undefined;
  const timeComparison = timeComparisonResult ?? undefined;

  // 匹配质量统计
  const matchedCount = unchanged + modified + suspected;
  const minRows = Math.min(oldSheet.rowCount, newSheet.rowCount) || 1;
  const matchRate = matchedCount / minRows;
  const overlapRatio = crossKeyMapping?.overlapRatio ?? 0;
  const matchQuality: MatchQuality = {
    matchedCount,
    matchRate,
    oldKey,
    newKey,
    overlapRatio,
    method: crossKeyMapping?.method || method,
  };
  if (matchRate < 0.1) {
    matchQuality.warning = `主键匹配率过低（${(matchRate * 100).toFixed(1)}%），请检查主键列选择是否正确`;
  }

  return {
    sheetName: newSheet.name || oldSheet.name,
    keyColumn: displayKey,
    totalOldRows: oldSheet.rowCount,
    totalNewRows: newSheet.rowCount,
    addedRows: added,
    removedRows: removed,
    modifiedRows: modified,
    unchangedRows: unchanged,
    suspectedRows: suspected,
    rows,
    headers: displayHeaders,
    columnMappings,
    unmappedOldColumns: unmappedOld,
    unmappedNewColumns: unmappedNew,
    duplicateKeyCount,
    keyColumnScores: keyScores,
    skippedSimilarity: skipSimilarity || undefined,
    reconciliation,
    matchClassification,
    crossKeyMapping,
    matchQuality,
    timeComparison,
  };
}

// ─── 对账汇总计算 ─────────────────────────────────────────

export function computeReconciliationSummary(
  oldSheet: SheetData,
  newSheet: SheetData,
  oldKeyCol: string,
  newKeyCol: string,
  columnMappings: ColumnMapping[],
): ReconciliationSummary {
  // 找出共同的数值列（通过列映射匹配）
  const numericComparisons: NumericColumnComparison[] = [];

  // 构建列映射对：包括显式映射和同名列
  const columnPairs: Array<{ oldCol: string; newCol: string }> = [];
  const mappedNewCols = new Set(columnMappings.map((m) => m.newColumn));
  for (const m of columnMappings) {
    columnPairs.push({ oldCol: m.oldColumn, newCol: m.newColumn });
  }
  // 同名列但未在映射中的也加入
  for (const oldCol of oldSheet.headers) {
    if (columnPairs.some((p) => p.oldCol === oldCol)) continue;
    if (newSheet.headers.includes(oldCol) && !mappedNewCols.has(oldCol)) {
      columnPairs.push({ oldCol, newCol: oldCol });
    }
  }

  // 对每对列检查是否为数值列并计算合计
  for (const { oldCol, newCol } of columnPairs) {
    let oldSum = 0, newSum = 0;
    let oldUnparsed = 0, newUnparsed = 0;
    let isNumeric = false;

    for (const row of oldSheet.rows) {
      const { num, unparsed } = parseRobustNumber(row[oldCol]);
      if (num !== null) { oldSum += num; isNumeric = true; }
      if (unparsed) oldUnparsed++;
    }
    for (const row of newSheet.rows) {
      const { num, unparsed } = parseRobustNumber(row[newCol]);
      if (num !== null) { newSum += num; isNumeric = true; }
      if (unparsed) newUnparsed++;
    }

    if (isNumeric) {
      numericComparisons.push({
        column: oldCol === newCol ? oldCol : `${oldCol} ≈ ${newCol}`,
        oldColumn: oldCol,
        newColumn: newCol,
        oldSum,
        newSum,
        diff: newSum - oldSum,
        oldUnparsed,
        newUnparsed,
      });
    }
  }

  return {
    oldFileName: '',
    newFileName: '',
    oldRowCount: oldSheet.rowCount,
    newRowCount: newSheet.rowCount,
    rowDiff: newSheet.rowCount - oldSheet.rowCount,
    numericComparisons,
  };
}

// ─── 匹配分类统计 ─────────────────────────────────────────

export function computeMatchClassification(
  rows: RowDiff[],
  oldKeyCol: string,
  newKeyCol: string,
  columnMappings: ColumnMapping[],
): MatchClassification {
  // 分类统计
  const bothRows = rows.filter((r) => r.diffType === 'modified' || r.diffType === 'unchanged');
  const onlyOldRows = rows.filter((r) => r.diffType === 'removed');
  const onlyNewRows = rows.filter((r) => r.diffType === 'added');

  // 找出共同数值列
  const columnPairs: Array<{ oldCol: string; newCol: string; displayCol: string }> = [];
  const mappedNewCols = new Set(columnMappings.map((m) => m.newColumn));
  for (const m of columnMappings) {
    columnPairs.push({ oldCol: m.oldColumn, newCol: m.newColumn, displayCol: m.oldColumn === m.newColumn ? m.oldColumn : `${m.oldColumn} ≈ ${m.newColumn}` });
  }
  // 同名列补充
  const allOldCols = new Set(rows.flatMap((r) => r.cells.map((c) => c.column)));
  for (const col of allOldCols) {
    if (columnPairs.some((p) => p.oldCol === col || p.newCol === col)) continue;
    columnPairs.push({ oldCol: col, newCol: col, displayCol: col });
  }

  // 计算每个分类的数值合计
  const sumNumeric = (
    targetRows: RowDiff[],
    side: 'old' | 'new',
    colPair: { oldCol: string; newCol: string },
  ): { sum: number; unparsed: number } => {
    let sum = 0, unparsed = 0;
    for (const row of targetRows) {
      const col = side === 'old' ? colPair.oldCol : colPair.newCol;
      const cell = row.cells.find((c) => c.column === col);
      const val = cell ? (side === 'old' ? cell.oldValue : cell.newValue) : undefined;
      const { num, unparsed: u } = parseRobustNumber(val);
      if (num !== null) sum += num;
      if (u) unparsed++;
    }
    return { sum, unparsed };
  };

  const numericColumns = columnPairs.map((p) => p.displayCol);
  const matchRows: MatchClassificationRow[] = [
    {
      category: 'both',
      label: '两边都有',
      recordCount: bothRows.length,
      numericSums: Object.fromEntries(
        columnPairs.map((p) => {
          const oldS = sumNumeric(bothRows, 'old', p);
          const newS = sumNumeric(bothRows, 'new', p);
          return [p.displayCol, { oldSum: oldS.sum, newSum: newS.sum }];
        })
      ),
    },
    {
      category: 'onlyOld',
      label: '仅A有',
      recordCount: onlyOldRows.length,
      numericSums: Object.fromEntries(
        columnPairs.map((p) => {
          const oldS = sumNumeric(onlyOldRows, 'old', p);
          return [p.displayCol, { oldSum: oldS.sum, newSum: 0 }];
        })
      ),
    },
    {
      category: 'onlyNew',
      label: '仅B有',
      recordCount: onlyNewRows.length,
      numericSums: Object.fromEntries(
        columnPairs.map((p) => {
          const newS = sumNumeric(onlyNewRows, 'new', p);
          return [p.displayCol, { oldSum: 0, newSum: newS.sum }];
        })
      ),
    },
  ];

  // 数值不一致单据数
  const inconsistentCount = bothRows.filter((r) => {
    if (r.diffType !== 'modified') return false;
    return r.cells.some((c) => {
      const pair = columnPairs.find((p) => p.oldCol === c.column || p.newCol === c.column);
      if (!pair) return false;
      const { num: on } = parseRobustNumber(c.oldValue);
      const { num: nn } = parseRobustNumber(c.newValue);
      if (on === null || nn === null) return false;
      return Math.abs(on - nn) > 1e-6;
    });
  }).length;

  // 差异最大的 Top20 单
  const topDiffs: MatchClassification['topDiffs'] = [];
  for (const row of bothRows) {
    if (row.diffType !== 'modified') continue;
    for (const cell of row.cells) {
      const pair = columnPairs.find((p) => p.oldCol === cell.column || p.newCol === cell.column);
      if (!pair) continue;
      const { num: on } = parseRobustNumber(cell.oldValue);
      const { num: nn } = parseRobustNumber(cell.newValue);
      if (on !== null && nn !== null && Math.abs(on - nn) > 1e-6) {
        topDiffs.push({ key: row.key, column: pair.displayCol, oldValue: on, newValue: nn, diff: nn - on });
      }
    }
  }
  topDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // 仅A/仅B的单号样例
  const onlyOldSampleKeys = onlyOldRows.slice(0, 20).map((r) => r.key);
  const onlyNewSampleKeys = onlyNewRows.slice(0, 20).map((r) => r.key);

  // 自洽校验
  const selfCheckPassed = columnPairs.every((p) => {
    const bothOld = matchRows[0].numericSums[p.displayCol]?.oldSum ?? 0;
    const onlyOldSum = matchRows[1].numericSums[p.displayCol]?.oldSum ?? 0;
    const bothNew = matchRows[0].numericSums[p.displayCol]?.newSum ?? 0;
    const onlyNewSum = matchRows[2].numericSums[p.displayCol]?.newSum ?? 0;

    // 计算全表合计
    let totalOld = 0, totalNew = 0;
    for (const row of rows) {
      const cell = row.cells.find((c) => c.column === p.oldCol);
      if (cell) { const { num } = parseRobustNumber(cell.oldValue); if (num !== null) totalOld += num; }
    }
    for (const row of rows) {
      const cell = row.cells.find((c) => c.column === p.newCol);
      if (cell) { const { num } = parseRobustNumber(cell.newValue); if (num !== null) totalNew += num; }
    }

    const oldMatch = Math.abs((bothOld + onlyOldSum) - totalOld) < 0.01;
    const newMatch = Math.abs((bothNew + onlyNewSum) - totalNew) < 0.01;
    if (!oldMatch || !newMatch) {
      console.warn(`[对账自洽校验] 列 "${p.displayCol}" 不通过: A侧 ${bothOld}+${onlyOldSum}≠${totalOld}, B侧 ${bothNew}+${onlyNewSum}≠${totalNew}`);
    }
    return oldMatch && newMatch;
  });

  return {
    rows: matchRows,
    numericColumns,
    inconsistentCount,
    topDiffs: topDiffs.slice(0, 20),
    onlyOldSampleKeys,
    onlyNewSampleKeys,
    selfCheckPassed,
  };
}

// ─── 按时间对比 ─────────────────────────────────────────────

const TIME_COLUMN_PATTERNS = [
  '日期', '时间', '单据日期', '业务日期', '创建日期', '发货日期', '出库日期',
  '入库日期', '交易日期', '记账日期', '制单日期', '下单日期', '交货日期',
  'date', 'time', 'datetime', 'created', 'updated', 'ship', 'deliver',
  'month', '月', '年', '日',
];

export function parseRobustDate(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;

  // Excel serial date number
  if (typeof val === 'number' && val > 1 && val < 200000) {
    const excelEpoch = new Date(1899, 11, 30);
    const ms = excelEpoch.getTime() + val * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) return d;
  }

  const str = String(val).trim();
  if (!str) return null;

  // "2026年9月1日" or "2026年09月01日"
  const cnMatch = str.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnMatch) {
    const d = new Date(Number(cnMatch[1]), Number(cnMatch[2]) - 1, Number(cnMatch[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // "20260901" (8-digit compact)
  if (/^\d{8}$/.test(str)) {
    const y = Number(str.slice(0, 4));
    const m = Number(str.slice(4, 6));
    const d = Number(str.slice(6, 8));
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d);
    }
  }

  // "2026/9/1", "2026-09-01", "2026.9.1" with optional time
  const dateMatch = str.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (dateMatch) {
    const y = Number(dateMatch[1]);
    const m = Number(dateMatch[2]);
    const d = Number(dateMatch[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d);
    }
  }

  // Fallback: try native Date parse but use local components to avoid UTC shift
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() > 1900) return fallback;

  return null;
}

export function detectTimeColumn(sheet: SheetData, sampleSize = 500): string | null {
  const candidates: Array<{ col: string; score: number }> = [];

  for (const header of sheet.headers) {
    const lower = header.toLowerCase();
    const nameMatch = TIME_COLUMN_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
    if (nameMatch) {
      // Verify by sampling values
      const sample = sheet.rows.slice(0, sampleSize);
      let parseable = 0;
      for (const row of sample) {
        if (parseRobustDate(row[header]) !== null) parseable++;
      }
      const ratio = sample.length > 0 ? parseable / sample.length : 0;
      if (ratio >= 0.3) {
        candidates.push({ col: header, score: 0.5 + ratio * 0.5 });
      }
    }
  }

  // If no name match, try value-based detection
  if (candidates.length === 0) {
    for (const header of sheet.headers) {
      const sample = sheet.rows.slice(0, sampleSize);
      let parseable = 0;
      for (const row of sample) {
        if (parseRobustDate(row[header]) !== null) parseable++;
      }
      const ratio = sample.length > 0 ? parseable / sample.length : 0;
      if (ratio >= 0.7) {
        candidates.push({ col: header, score: ratio });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].col;
}

function getPeriodKey(date: Date, granularity: TimeGranularity): string {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  switch (granularity) {
    case 'day':
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    case 'week': {
      const jan1 = new Date(y, 0, 1);
      const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000) + 1;
      const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
      return `${y}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'month':
      return `${y}-${String(m + 1).padStart(2, '0')}`;
  }
}

function getPeriodLabel(periodKey: string, granularity: TimeGranularity): string {
  switch (granularity) {
    case 'day': {
      const parts = periodKey.split('-');
      return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
    }
    case 'week':
      return periodKey.replace('-W', ' 第') + '周';
    case 'month': {
      const parts = periodKey.split('-');
      return `${parts[0]}年${Number(parts[1])}月`;
    }
  }
}

function detectAutoGranularity(allDates: Date[]): TimeGranularity {
  if (allDates.length === 0) return 'month';
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  const spanDays = (maxDate.getTime() - minDate.getTime()) / 86400000;
  if (spanDays <= 62) return 'day';
  return 'month';
}

export function computeTimeComparison(
  oldSheet: SheetData,
  newSheet: SheetData,
  oldTimeCol: string,
  newTimeCol: string,
  columnMappings: ColumnMapping[],
  granularity: TimeGranularity | null,
  scope: 'all' | 'both' = 'all',
): TimeComparison | null {
  if (!oldTimeCol || !newTimeCol) return null;

  const numericMappings = columnMappings.filter((m) => {
    const sampleOld = oldSheet.rows.slice(0, 50);
    const sampleNew = newSheet.rows.slice(0, 50);
    let numCount = 0;
    for (const row of sampleOld) {
      const { num } = parseRobustNumber(row[m.oldColumn]);
      if (num !== null) numCount++;
    }
    for (const row of sampleNew) {
      const { num } = parseRobustNumber(row[m.newColumn]);
      if (num !== null) numCount++;
    }
    return numCount > (sampleOld.length + sampleNew.length) * 0.3;
  });

  if (numericMappings.length === 0) return null;

  // Collect all dates for auto granularity
  const allDates: Date[] = [];
  for (const row of oldSheet.rows) {
    const d = parseRobustDate(row[oldTimeCol]);
    if (d) allDates.push(d);
  }
  for (const row of newSheet.rows) {
    const d = parseRobustDate(row[newTimeCol]);
    if (d) allDates.push(d);
  }

  const autoGranularity = detectAutoGranularity(allDates);
  const effectiveGranularity = granularity ?? autoGranularity;

  // Build period maps
  const periodMap = new Map<string, {
    oldSums: Record<string, number>;
    newSums: Record<string, number>;
    oldUnparsed: number;
    newUnparsed: number;
  }>();

  const ensurePeriod = (key: string) => {
    if (!periodMap.has(key)) {
      const sums: Record<string, number> = {};
      for (const m of numericMappings) sums[m.oldColumn] = 0;
      periodMap.set(key, { oldSums: { ...sums }, newSums: { ...sums }, oldUnparsed: 0, newUnparsed: 0 });
    }
  };

  for (const row of oldSheet.rows) {
    const d = parseRobustDate(row[oldTimeCol]);
    if (!d) continue;
    const key = getPeriodKey(d, effectiveGranularity);
    ensurePeriod(key);
    const entry = periodMap.get(key)!;
    for (const m of numericMappings) {
      const { num, unparsed } = parseRobustNumber(row[m.oldColumn]);
      if (num !== null) entry.oldSums[m.oldColumn] += num;
      if (unparsed) entry.oldUnparsed++;
    }
  }

  for (const row of newSheet.rows) {
    const d = parseRobustDate(row[newTimeCol]);
    if (!d) continue;
    const key = getPeriodKey(d, effectiveGranularity);
    ensurePeriod(key);
    const entry = periodMap.get(key)!;
    for (const m of numericMappings) {
      const { num, unparsed } = parseRobustNumber(row[m.newColumn]);
      if (num !== null) entry.newSums[m.oldColumn] += num;
      if (unparsed) entry.newUnparsed++;
    }
  }

  // Build rows sorted by period
  const sortedKeys = Array.from(periodMap.keys()).sort();
  const rows: TimeComparisonRow[] = sortedKeys.map((key) => {
    const entry = periodMap.get(key)!;
    const numericSums: Record<string, { oldSum: number; newSum: number; diff: number }> = {};
    for (const m of numericMappings) {
      numericSums[m.oldColumn] = {
        oldSum: entry.oldSums[m.oldColumn],
        newSum: entry.newSums[m.oldColumn],
        diff: entry.newSums[m.oldColumn] - entry.oldSums[m.oldColumn],
      };
    }
    return {
      period: key,
      periodLabel: getPeriodLabel(key, effectiveGranularity),
      numericSums,
      oldUnparsed: entry.oldUnparsed,
      newUnparsed: entry.newUnparsed,
    };
  });

  // Find top diff periods
  const topDiffPeriods: TimeComparison['topDiffPeriods'] = [];
  for (const row of rows) {
    for (const [col, sums] of Object.entries(row.numericSums)) {
      topDiffPeriods.push({
        period: row.periodLabel,
        column: col,
        diff: sums.diff,
        absDiff: Math.abs(sums.diff),
      });
    }
  }
  topDiffPeriods.sort((a, b) => b.absDiff - a.absDiff);

  // Totals
  let totalOld = 0;
  let totalNew = 0;
  for (const row of rows) {
    for (const sums of Object.values(row.numericSums)) {
      totalOld += sums.oldSum;
      totalNew += sums.newSum;
    }
  }

  return {
    oldTimeColumn: oldTimeCol,
    newTimeColumn: newTimeCol,
    granularity: effectiveGranularity,
    autoGranularity,
    rows,
    numericColumns: numericMappings.map((m) => m.oldColumn),
    topDiffPeriods: topDiffPeriods.slice(0, 10),
    totalOld,
    totalNew,
    totalDiff: totalNew - totalOld,
    scope,
  };
}

// ─── 汇总统计 ─────────────────────────────────────────────

export function computeDiffStatistics(result: SheetDiffResult): DiffStatistics {
  const totalRows = result.rows.length;
  const addedCount = result.addedRows;
  const removedCount = result.removedRows;
  const modifiedCount = result.modifiedRows;
  const suspectedCount = result.suspectedRows;
  const unchangedCount = result.unchangedRows;

  // 字段级变更热点
  const fieldChangeCounts = new Map<string, number>();
  const changedRows = result.rows.filter((r) => r.diffType === 'modified' || r.diffType === 'suspected');
  for (const row of changedRows) {
    for (const cell of row.cells) {
      if (cell.diffType === 'modified') {
        fieldChangeCounts.set(cell.column, (fieldChangeCounts.get(cell.column) || 0) + 1);
      }
    }
  }
  const fieldHotspots: FieldHotspot[] = [...fieldChangeCounts.entries()]
    .map(([column, changeCount]) => ({
      column,
      changeCount,
      changeRate: changedRows.length > 0 ? changeCount / changedRows.length : 0,
    }))
    .sort((a, b) => b.changeCount - a.changeCount);

  // 数值字段增减汇总
  const numericColumns = new Set<string>();
  for (const row of result.rows) {
    for (const cell of row.cells) {
      if (tryParseNumber(cell.oldValue) !== null || tryParseNumber(cell.newValue) !== null) {
        numericColumns.add(cell.column);
      }
    }
  }

  const numericSummaries: NumericChangeSummary[] = [];
  for (const col of numericColumns) {
    let oldSum = 0, newSum = 0;
    const changes: Array<{ key: string; oldValue: number; newValue: number; change: number }> = [];

    for (const row of result.rows) {
      const cell = row.cells.find((c) => c.column === col);
      if (!cell) continue;
      const ov = tryParseNumber(cell.oldValue);
      const nv = tryParseNumber(cell.newValue);
      if (ov !== null) oldSum += ov;
      if (nv !== null) newSum += nv;
      if (ov !== null && nv !== null && Math.abs(ov - nv) > NUMERIC_EPSILON) {
        changes.push({ key: row.key, oldValue: ov, newValue: nv, change: nv - ov });
      }
    }

    changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const changePercent = oldSum !== 0 ? ((newSum - oldSum) / oldSum) * 100 : 0;

    numericSummaries.push({
      column: col,
      oldSum,
      newSum,
      changePercent,
      topChanges: changes.slice(0, 5),
    });
  }
  numericSummaries.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  // 典型差异样例
  const 典型差异: TypicalDiff[] = [];
  const sampleRows = changedRows.slice(0, 5);
  for (const row of sampleRows) {
    const modifiedCells = row.cells.filter((c) => c.diffType === 'modified');
    if (modifiedCells.length > 0) {
      const cell = modifiedCells[0];
      典型差异.push({
        key: row.key,
        column: cell.column,
        oldValue: formatCellValue(cell.oldValue),
        newValue: formatCellValue(cell.newValue),
        diffType: row.diffType,
      });
    }
  }

  return {
    totalRows,
    addedCount,
    removedCount,
    modifiedCount,
    suspectedCount,
    unchangedCount,
    fieldHotspots: fieldHotspots.slice(0, 10),
    numericSummaries: numericSummaries.slice(0, 5),
    典型差异,
  };
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ─── 结构化差异摘要（用于 AI 输入） ─────────────────────────

export function buildStructuredDiffSummary(
  results: SheetDiffResult[],
  fileNames: string[],
): string {
  const parts: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const stats = computeDiffStatistics(r);
    parts.push(`## 比对 ${i + 1}: ${r.sheetName}`);
    parts.push(`文件: ${fileNames[i] || '未知'}`);
    parts.push(`主键列: ${r.keyColumn}${r.duplicateKeyCount > 0 ? `（存在 ${r.duplicateKeyCount} 处重复值）` : ''}`);
    parts.push(`行数: 原表 ${r.totalOldRows} → 新表 ${r.totalNewRows}`);
    parts.push('');
    parts.push('### 变更统计');
    parts.push(`- 新增: ${stats.addedCount} 行`);
    parts.push(`- 删除: ${stats.removedCount} 行`);
    parts.push(`- 修改: ${stats.modifiedCount} 行`);
    parts.push(`- 疑似配对: ${stats.suspectedCount} 行`);
    parts.push(`- 未变: ${stats.unchangedCount} 行`);

    if (stats.fieldHotspots.length > 0) {
      parts.push('');
      parts.push('### 字段变更热点 Top5');
      for (const h of stats.fieldHotspots.slice(0, 5)) {
        parts.push(`- ${h.column}: ${h.changeCount} 次修改 (${(h.changeRate * 100).toFixed(1)}%)`);
      }
    }

    if (stats.numericSummaries.length > 0) {
      parts.push('');
      parts.push('### 数值字段变化');
      for (const ns of stats.numericSummaries.slice(0, 3)) {
        parts.push(`- ${ns.column}: ${ns.oldSum.toLocaleString()} → ${ns.newSum.toLocaleString()} (${ns.changePercent >= 0 ? '+' : ''}${ns.changePercent.toFixed(2)}%)`);
      }
    }

    if (stats.典型差异.length > 0) {
      parts.push('');
      parts.push('### 典型差异样例');
      for (const d of stats.典型差异.slice(0, 3)) {
        parts.push(`- 行 "${d.key}" 的 [${d.column}]: "${d.oldValue}" → "${d.newValue}"`);
      }
    }

    if (r.columnMappings.some((m) => m.similarity < 1)) {
      parts.push('');
      parts.push('### 列名映射（自动识别）');
      for (const m of r.columnMappings) {
        if (m.oldColumn !== m.newColumn) {
          parts.push(`- "${m.oldColumn}" ↔ "${m.newColumn}" (相似度 ${(m.similarity * 100).toFixed(0)}%)`);
        }
      }
    }
    if (r.unmappedOldColumns.length > 0 || r.unmappedNewColumns.length > 0) {
      parts.push('');
      parts.push('### 仅单侧存在的列');
      if (r.unmappedOldColumns.length > 0) parts.push(`- 仅旧表: ${r.unmappedOldColumns.join(', ')}`);
      if (r.unmappedNewColumns.length > 0) parts.push(`- 仅新表: ${r.unmappedNewColumns.join(', ')}`);
    }

    parts.push('');
  }

  return parts.join('\n');
}

// ─── 文件解析（前端） ─────────────────────────────────────────

import type { ParsedFile } from '@/types';

export async function parseFile(file: File): Promise<ParsedFile> {
  const type = getFileType(file.name, file.type);
  const result: ParsedFile = { file, name: file.name, type };

  if (type === 'excel') {
    const data = await parseExcelFile(file);
    result.data = { fileName: file.name, sheets: data };
  } else if (type === 'word' || type === 'pdf') {
    const text = await parseDocumentFile(file, type);
    result.data = {
      fileName: file.name,
      paragraphs: text.split('\n').filter(Boolean).map((t, i) => ({ text: t, index: i })),
      textContent: text,
    };
  }
  return result;
}

async function parseExcelFile(file: File): Promise<SheetData[]> {
  const { read, utils } = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = read(buffer, { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const data: unknown[][] = utils.sheet_to_json(ws, { header: 1, defval: '' });
    return arrayToSheetData(name, data);
  });
}

async function parseDocumentFile(file: File, type: 'word' | 'pdf'): Promise<string> {
  if (type === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await file.arrayBuffer();
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

// ─── 主键检测 ─────────────────────────────────────────

export function detectBestKeyColumn(sheet: SheetData): string {
  const scores = analyzeKeyColumns(sheet);
  return selectBestKey(scores) || sheet.headers[0] || '';
}

// ─── 导出 Excel ─────────────────────────────────────────

export function exportToExcel(results: Array<SheetDiffResult | DocumentDiffResult>): Blob {
  const { utils, write } = XLSX;
  const wb = utils.book_new();

  for (const result of results) {
    if ('sheetName' in result) {
      const sheetResult = result as SheetDiffResult;
      // 汇总 sheet
      const stats = computeDiffStatistics(sheetResult);
      const summaryData = [
        ['比对汇总', sheetResult.sheetName],
        [''],
        ['主键列', sheetResult.keyColumn],
        ['原表行数', sheetResult.totalOldRows],
        ['新表行数', sheetResult.totalNewRows],
        [''],
        ['变更类型', '数量'],
        ['新增', stats.addedCount],
        ['删除', stats.removedCount],
        ['修改', stats.modifiedCount],
        ['疑似', stats.suspectedCount],
        ['未变', stats.unchangedCount],
      ];
      if (stats.fieldHotspots.length > 0) {
        summaryData.push([''], ['字段变更热点', '修改次数', '修改率']);
        for (const h of stats.fieldHotspots.slice(0, 10)) {
          summaryData.push([h.column, h.changeCount, `${(h.changeRate * 100).toFixed(1)}%`]);
        }
      }
      const summarySheet = utils.aoa_to_sheet(summaryData);
      utils.book_append_sheet(wb, summarySheet, `${sheetResult.sheetName}-汇总`);

      // 对账汇总 sheet
      if (sheetResult.reconciliation) {
        const recon = sheetResult.reconciliation;
        const mc = sheetResult.matchClassification;
        const reconData: unknown[][] = [
          ['对账汇总'],
          [''],
          ['文件A', recon.oldFileName, '行数', recon.oldRowCount],
          ['文件B', recon.newFileName, '行数', recon.newRowCount],
          ['行数差', recon.rowDiff],
          [''],
          ['数值列对比', 'A合计', 'B合计', '差值'],
        ];
        for (const nc of recon.numericComparisons) {
          reconData.push([nc.column, nc.oldSum, nc.newSum, nc.diff]);
        }
        if (mc) {
          reconData.push([''], ['匹配分类统计']);
          reconData.push(['分类', '单数', ...mc.numericColumns]);
          for (const row of mc.rows) {
            const vals = mc.numericColumns.map((col) => {
              const sums = row.numericSums[col];
              if (!sums) return '—';
              if (row.category === 'both') return `A:${sums.oldSum} / B:${sums.newSum}`;
              return row.category === 'onlyOld' ? sums.oldSum : sums.newSum;
            });
            reconData.push([row.label, row.recordCount, ...vals]);
          }
          if (mc.inconsistentCount > 0) {
            reconData.push([''], ['两边都有但数值不一致', mc.inconsistentCount, '单']);
          }
          if (mc.topDiffs.length > 0) {
            reconData.push([''], ['差异最大的单据 Top' + mc.topDiffs.length]);
            reconData.push(['单号', '列', 'A值', 'B值', '差值']);
            for (const td of mc.topDiffs) {
              reconData.push([td.key, td.column, td.oldValue, td.newValue, td.diff]);
            }
          }
        }
        const reconSheet = utils.aoa_to_sheet(reconData);
        utils.book_append_sheet(wb, reconSheet, `${sheetResult.sheetName}-对账汇总`);
      }

      // 按时间对比 sheet
      if (sheetResult.timeComparison && sheetResult.timeComparison.rows.length > 0) {
        const tc = sheetResult.timeComparison;
        const granularityLabel = tc.granularity === 'day' ? '按日' : tc.granularity === 'week' ? '按周' : '按月';
        const tcData: unknown[][] = [
          ['按时间对比', `粒度: ${granularityLabel}`],
          ['时间列', `A: ${tc.oldTimeColumn}`, `B: ${tc.newTimeColumn}`],
          [''],
          ['期间', ...tc.numericColumns.flatMap((col) => [`${col}(A)`, `${col}(B)`, `${col}(差值)`])],
        ];
        for (const row of tc.rows) {
          const vals: unknown[] = [row.periodLabel];
          for (const col of tc.numericColumns) {
            const sums = row.numericSums[col];
            if (sums) {
              vals.push(sums.oldSum, sums.newSum, sums.diff);
            } else {
              vals.push('—', '—', '—');
            }
          }
          tcData.push(vals);
        }
        tcData.push([''], ['全表合计', `A: ${tc.totalOld}`, `B: ${tc.totalNew}`, `差: ${tc.totalDiff}`]);
        if (tc.topDiffPeriods.length > 0) {
          tcData.push([''], ['差异最大的期间 Top' + tc.topDiffPeriods.length]);
          tcData.push(['期间', '列', '差值']);
          for (const p of tc.topDiffPeriods) {
            tcData.push([p.period, p.column, p.diff]);
          }
        }
        const tcSheet = utils.aoa_to_sheet(tcData);
        utils.book_append_sheet(wb, tcSheet, `${sheetResult.sheetName}-按时间对比`);
      }

      // 明细 sheet
      const detailData: unknown[][] = [
        ['状态', '主键', ...sheetResult.headers],
      ];
      for (const row of sheetResult.rows) {
        const statusLabel = row.diffType === 'added' ? '新增' : row.diffType === 'removed' ? '删除' : row.diffType === 'modified' ? '修改' : row.diffType === 'suspected' ? '疑似' : '不变';
        const values = sheetResult.headers.map((h) => {
          const cell = row.cells.find((c) => c.column === h);
          return cell ? (cell.newValue ?? cell.oldValue ?? '') : '';
        });
        detailData.push([statusLabel, row.key, ...values]);
      }
      const detailSheet = utils.aoa_to_sheet(detailData);
      utils.book_append_sheet(wb, detailSheet, `${sheetResult.sheetName}-明细`);
    }
  }

  const buf = write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ─── AI 摘要构建（结构化 JSON） ─────────────────────────────────

export function buildDiffSummary(results: Array<SheetDiffResult | DocumentDiffResult>): Record<string, unknown> {
  let totalRows = 0, added = 0, removed = 0, modified = 0, suspected = 0, unchanged = 0;
  const allHotspots: Map<string, { changeCount: number; total: number }> = new Map();
  const numericSummaries: Array<{ column: string; oldSum: number; newSum: number; changePercent: number }> = [];
  const examples: Array<{ key: string; column: string; oldValue: string; newValue: string; type: string }> = [];
  const warnings: string[] = [];
  let reconciliation: Record<string, unknown> | undefined;
  let matchClassification: Record<string, unknown> | undefined;
  let timeComparison: Record<string, unknown> | undefined;

  for (const r of results) {
    if ('sheetName' in r) {
      const sr = r as SheetDiffResult;
      const stats = computeDiffStatistics(sr);
      totalRows += stats.totalRows;
      added += stats.addedCount;
      removed += stats.removedCount;
      modified += stats.modifiedCount;
      suspected += stats.suspectedCount;
      unchanged += stats.unchangedCount;

      for (const h of stats.fieldHotspots) {
        const existing = allHotspots.get(h.column) || { changeCount: 0, total: 0 };
        existing.changeCount += h.changeCount;
        existing.total += stats.totalRows;
        allHotspots.set(h.column, existing);
      }
      numericSummaries.push(...stats.numericSummaries.map((ns) => ({
        column: ns.column, oldSum: ns.oldSum, newSum: ns.newSum, changePercent: ns.changePercent,
      })));
      for (const ex of stats.典型差异.slice(0, 2)) {
        examples.push({ key: ex.key, column: ex.column, oldValue: ex.oldValue, newValue: ex.newValue, type: ex.diffType });
      }
      if (sr.duplicateKeyCount > 0) {
        warnings.push(`主键列 "${sr.keyColumn}" 存在 ${sr.duplicateKeyCount} 处重复值`);
      }

      // 对账数据
      if (sr.reconciliation) {
        reconciliation = {
          oldFileName: sr.reconciliation.oldFileName,
          newFileName: sr.reconciliation.newFileName,
          oldRowCount: sr.reconciliation.oldRowCount,
          newRowCount: sr.reconciliation.newRowCount,
          rowDiff: sr.reconciliation.rowDiff,
          numericComparisons: sr.reconciliation.numericComparisons.map((nc) => ({
            column: nc.column, oldSum: nc.oldSum, newSum: nc.newSum, diff: nc.diff,
          })),
        };
      }
      if (sr.matchClassification) {
        const mc = sr.matchClassification;
        matchClassification = {
          rows: mc.rows.map((row) => ({
            label: row.label, recordCount: row.recordCount,
            numericSums: row.numericSums,
          })),
          inconsistentCount: mc.inconsistentCount,
          topDiffs: mc.topDiffs.slice(0, 20),
          onlyOldSampleKeys: mc.onlyOldSampleKeys.slice(0, 20),
          onlyNewSampleKeys: mc.onlyNewSampleKeys.slice(0, 20),
        };
      }
      // 按时间对比数据
      if (sr.timeComparison && sr.timeComparison.rows.length > 0) {
        timeComparison = {
          oldTimeColumn: sr.timeComparison.oldTimeColumn,
          newTimeColumn: sr.timeComparison.newTimeColumn,
          granularity: sr.timeComparison.granularity,
          totalOld: sr.timeComparison.totalOld,
          totalNew: sr.timeComparison.totalNew,
          totalDiff: sr.timeComparison.totalDiff,
          topDiffPeriods: sr.timeComparison.topDiffPeriods.slice(0, 10),
          periodCount: sr.timeComparison.rows.length,
          rows: sr.timeComparison.rows.length > 62
            ? sr.timeComparison.topDiffPeriods.slice(0, 10).map((p) => ({
                period: p.period, column: p.column, diff: p.diff,
              }))
            : sr.timeComparison.rows.map((row) => ({
                period: row.periodLabel,
                numericSums: row.numericSums,
              })),
        };
      }
    }
  }

  const fieldHotspots = [...allHotspots.entries()]
    .map(([column, { changeCount, total }]) => ({ column, changeCount, changeRate: total > 0 ? changeCount / total : 0 }))
    .sort((a, b) => b.changeCount - a.changeCount)
    .slice(0, 5);

  const changeRate = totalRows > 0 ? (added + removed + modified + suspected) / totalRows : 0;

  // 提取 matchQuality 和 crossKeyMapping
  const firstSheetResult = results.find((r) => 'sheetName' in r) as SheetDiffResult | undefined;
  const matchQuality = firstSheetResult?.matchQuality ? {
    matchedCount: firstSheetResult.matchQuality.matchedCount,
    matchRate: firstSheetResult.matchQuality.matchRate,
    oldKey: firstSheetResult.matchQuality.oldKey,
    newKey: firstSheetResult.matchQuality.newKey,
    overlapRatio: firstSheetResult.matchQuality.overlapRatio,
    method: firstSheetResult.matchQuality.method,
    warning: firstSheetResult.matchQuality.warning,
  } : undefined;
  const crossKeyMapping = firstSheetResult?.crossKeyMapping ? {
    oldKeyColumn: firstSheetResult.crossKeyMapping.oldKeyColumn,
    newKeyColumn: firstSheetResult.crossKeyMapping.newKeyColumn,
    method: firstSheetResult.crossKeyMapping.method,
    overlapRatio: firstSheetResult.crossKeyMapping.overlapRatio,
  } : undefined;

  return {
    overview: { totalRows, added, removed, modified, suspected, unchanged, changeRate },
    fieldHotspots,
    numericSummaries: numericSummaries.slice(0, 5),
    typicalExamples: examples.slice(0, 5),
    warnings,
    reconciliation,
    matchClassification,
    matchQuality,
    crossKeyMapping,
    timeComparison,
  };
}

// ─── 本地统计分析（无 API Key 降级） ─────────────────────────

export function generateLocalAnalysis(summary: Record<string, unknown>): string {
  const ov = summary.overview as { totalRows: number; added: number; removed: number; modified: number; suspected: number; unchanged: number; changeRate: number };
  const hotspots = (summary.fieldHotspots || []) as Array<{ column: string; changeCount: number; changeRate: number }>;
  const numerics = (summary.numericSummaries || []) as Array<{ column: string; oldSum: number; newSum: number; changePercent: number }>;
  const examples = (summary.typicalExamples || []) as Array<{ key: string; column: string; oldValue: string; newValue: string; type: string }>;
  const warnings = (summary.warnings || []) as string[];
  const reconciliation = summary.reconciliation as Record<string, unknown> | undefined;
  const matchClassification = summary.matchClassification as Record<string, unknown> | undefined;
  const matchQuality = summary.matchQuality as Record<string, unknown> | undefined;
  const timeComparison = summary.timeComparison as Record<string, unknown> | undefined;

  const sections: string[] = [];

  // 主键匹配质量
  if (matchQuality) {
    const oldKey = matchQuality.oldKey as string;
    const newKey = matchQuality.newKey as string;
    const matchedCount = matchQuality.matchedCount as number;
    const matchRate = matchQuality.matchRate as number;
    const keyDesc = oldKey === newKey ? `主键列「${oldKey}」` : `A「${oldKey}」↔ B「${newKey}」`;
    sections.push(`【主键匹配】${keyDesc}，匹配 ${matchedCount} 单，匹配率 ${(matchRate * 100).toFixed(1)}%${matchQuality.warning ? '。⚠️ ' + matchQuality.warning : ''}`);
    sections.push('');
  }

  // 变更概览
  sections.push('【变更概览】');
  if (reconciliation) {
    const ncs = (reconciliation.numericComparisons || []) as Array<{ column: string; oldSum: number; newSum: number; diff: number }>;
    sections.push(`文件A「${reconciliation.oldFileName}」共 ${reconciliation.oldRowCount} 单，文件B「${reconciliation.newFileName}」共 ${reconciliation.newRowCount} 单，差 ${Math.abs(reconciliation.rowDiff as number)} 单。`);
    for (const nc of ncs) {
      const match = Math.abs(nc.diff) < 0.01 ? '一致' : `差 ${nc.diff.toLocaleString()}`;
      sections.push(`${nc.column}: A合计 ${nc.oldSum.toLocaleString()} vs B合计 ${nc.newSum.toLocaleString()}，${match}。`);
    }
  }
  sections.push(`比对共涉及 ${ov.totalRows} 行数据，整体变更率 ${(ov.changeRate * 100).toFixed(1)}%。`);
  sections.push(`其中新增 ${ov.added} 行、删除 ${ov.removed} 行、修改 ${ov.modified} 行、疑似匹配 ${ov.suspected} 行、未变 ${ov.unchanged} 行。`);
  sections.push('');

  // 按时间对比
  if (timeComparison) {
    const tcRows = (timeComparison.rows || []) as Array<{ period: string; label: string; oldCount: number; newCount: number; diff: number; absDiff: number }>;
    const granularity = timeComparison.granularity as string;
    const oldCol = timeComparison.oldColumn as string;
    const newCol = timeComparison.newColumn as string;
    const totalOld = tcRows.reduce((s, r) => s + r.oldCount, 0);
    const totalNew = tcRows.reduce((s, r) => s + r.newCount, 0);
    const totalDiff = tcRows.reduce((s, r) => s + r.absDiff, 0);
    const granLabel = granularity === 'day' ? '日' : granularity === 'week' ? '周' : '月';
    sections.push(`【按时间对比（${granLabel}粒度）】`);
    sections.push(`时间列: A「${oldCol}」/ B「${newCol}」，共 ${tcRows.length} 个期间。`);
    sections.push(`全表合计: A ${totalOld} 单 / B ${totalNew} 单，差 ${totalNew - totalOld} 单。期间差异绝对值累计 ${totalDiff} 单。`);
    const sorted = [...tcRows].sort((a, b) => b.absDiff - a.absDiff);
    if (sorted.length > 0 && sorted[0].absDiff > 0) {
      sections.push(`差异最大期间: ${sorted[0].label}（A:${sorted[0].oldCount} / B:${sorted[0].newCount}，差 ${sorted[0].diff > 0 ? '+' : ''}${sorted[0].diff}）`);
    }
    const diffPeriods = tcRows.filter((r) => r.absDiff > 0);
    if (diffPeriods.length > 0) {
      sections.push(`有差异期间: ${diffPeriods.length} / ${tcRows.length} 个期间存在件数差异。`);
    } else {
      sections.push('所有期间件数完全一致。');
    }
    sections.push('');
  }

  // 差异量化拆解
  sections.push('【重点风险 — 差异量化拆解】');
  if (matchClassification) {
    const rows = (matchClassification.rows || []) as Array<{ label: string; recordCount: number; numericSums: Record<string, { oldSum: number; newSum: number }> }>;
    for (const row of rows) {
      const sumParts: string[] = [];
      for (const [col, sums] of Object.entries(row.numericSums)) {
        if (row.label === '两边都有') {
          sumParts.push(`${col} A:${sums.oldSum.toLocaleString()}/B:${sums.newSum.toLocaleString()}`);
        } else if (row.label === '仅A有') {
          sumParts.push(`${col} A:${sums.oldSum.toLocaleString()}`);
        } else {
          sumParts.push(`${col} B:${sums.newSum.toLocaleString()}`);
        }
      }
      sections.push(`• ${row.label}: ${row.recordCount} 单${sumParts.length > 0 ? '（' + sumParts.join('，') + '）' : ''}`);
    }
    const inconsistentCount = matchClassification.inconsistentCount as number;
    if (inconsistentCount > 0) {
      sections.push(`• 两边都有但数值不一致: ${inconsistentCount} 单`);
    }
    // 差异贡献分析
    if (reconciliation) {
      const ncs = (reconciliation.numericComparisons || []) as Array<{ column: string; diff: number }>;
      for (const nc of ncs) {
        if (Math.abs(nc.diff) < 0.01) continue;
        const onlyOld = rows.find((r) => r.label === '仅A有');
        const onlyNew = rows.find((r) => r.label === '仅B有');
        const onlyOldSum = onlyOld?.numericSums[nc.column]?.oldSum ?? 0;
        const onlyNewSum = onlyNew?.numericSums[nc.column]?.newSum ?? 0;
        const bothDiff = nc.diff - onlyNewSum + onlyOldSum;
        sections.push(`• ${nc.column} 差异拆解: 仅B有贡献 +${onlyNewSum.toLocaleString()}，仅A有贡献 -${onlyOldSum.toLocaleString()}，两边都有但数值不同贡献 ${bothDiff >= 0 ? '+' : ''}${bothDiff.toLocaleString()}`);
      }
    }
  } else {
    if (numerics.length > 0) {
      const bigChanges = numerics.filter((n) => Math.abs(n.changePercent) > 10);
      if (bigChanges.length > 0) {
        sections.push(`• 以下数值字段变动超过 10%，需重点关注:`);
        for (const n of bigChanges) {
          sections.push(`  - ${n.column}: ${n.oldSum.toLocaleString()} → ${n.newSum.toLocaleString()} (${n.changePercent >= 0 ? '+' : ''}${n.changePercent.toFixed(2)}%)`);
        }
      }
    }
  }
  if (warnings.length > 0) {
    for (const w of warnings) sections.push(`• ${w}`);
  }
  sections.push('');

  // 数据质量观察
  sections.push('【数据质量观察】');
  if (hotspots.length > 0) {
    sections.push(`• 变更最集中的字段: ${hotspots.slice(0, 3).map((h) => `${h.column}(${h.changeCount}次)`).join('、')}`);
  }
  if (warnings.length > 0) {
    sections.push(`• 存在 ${warnings.length} 项数据质量警告，建议检查主键唯一性和数据格式一致性。`);
  }
  if (examples.length > 0) {
    sections.push('• 典型差异样例:');
    for (const ex of examples.slice(0, 3)) {
      sections.push(`  - 行 "${ex.key}" 的 [${ex.column}]: "${ex.oldValue}" → "${ex.newValue}"`);
    }
  }
  if (matchClassification) {
    const topDiffs = (matchClassification.topDiffs || []) as Array<{ key: string; column: string; oldValue: number; newValue: number; diff: number }>;
    if (topDiffs.length > 0) {
      sections.push('• 差异最大的单据:');
      for (const td of topDiffs.slice(0, 5)) {
        sections.push(`  - 单号 ${td.key}，${td.column}: A=${td.oldValue} → B=${td.newValue}，差 ${td.diff}`);
      }
    }
  }
  sections.push('');

  // 后续建议
  sections.push('【后续建议】');
  if (matchClassification) {
    const onlyOldKeys = (matchClassification.onlyOldSampleKeys || []) as string[];
    const onlyNewKeys = (matchClassification.onlyNewSampleKeys || []) as string[];
    if (onlyNewKeys.length > 0) {
      sections.push(`• 优先核查仅B有的 ${onlyNewKeys.length} 单（样例: ${onlyNewKeys.slice(0, 5).join('、')}），可能是A侧漏单或B侧重复提交。`);
    }
    if (onlyOldKeys.length > 0) {
      sections.push(`• 核查仅A有的 ${onlyOldKeys.length} 单（样例: ${onlyOldKeys.slice(0, 5).join('、')}），可能是B侧漏单或数据时点差异。`);
    }
    const inconsistentCount = matchClassification.inconsistentCount as number;
    if (inconsistentCount > 0) {
      sections.push(`• 对 ${inconsistentCount} 单两边都有但数值不一致的单据逐单核对，重点关注差异金额最大的单据。`);
    }
  }
  if (ov.suspected > 0) {
    sections.push('• 对疑似匹配的行进行人工复核，确认是否为同一数据项的格式差异。');
  }
  if (numerics.some((n) => Math.abs(n.changePercent) > 5)) {
    sections.push('• 对数值变动超过 5% 的字段进行业务验证，确认变更合理性。');
  }
  sections.push('• 建议统一日期和数值格式，减少因格式差异导致的误报。');
  if (timeComparison) {
    const tcRows = (timeComparison.rows || []) as Array<{ period: string; label: string; oldCount: number; newCount: number; diff: number; absDiff: number }>;
    const sorted = [...tcRows].sort((a, b) => b.absDiff - a.absDiff).filter((r) => r.absDiff > 0);
    if (sorted.length > 0) {
      sections.push(`• 优先核查差异最大的时间段「${sorted[0].label}」（差 ${sorted[0].diff > 0 ? '+' : ''}${sorted[0].diff} 单），排查该时段是否有漏单或重复录入。`);
    }
  }
  sections.push('• 配置 API Key 可获取更深度的 AI 智能分析与业务原因推断。');

  return sections.join('\n');
}

// 保留旧接口兼容
export function getParsedDataSummary(data: ParsedData): string {
  const parts: string[] = [`文件: ${data.fileName}`];
  if (data.sheets && data.sheets.length > 0) {
    parts.push(`包含 ${data.sheets.length} 个工作表:`);
    for (const sheet of data.sheets) {
      parts.push(`  - ${sheet.name}: ${sheet.rowCount} 行 x ${sheet.columnCount} 列`);
      if (sheet.rows.length > 0) {
        parts.push(`    表头: ${sheet.headers.join(', ')}`);
        parts.push(`    示例数据: ${JSON.stringify(sheet.rows.slice(0, 3)).substring(0, 300)}`);
      }
    }
  }
  if (data.paragraphs && data.paragraphs.length > 0) {
    parts.push(`包含 ${data.paragraphs.length} 个段落`);
    const text = data.paragraphs.map((p) => p.text).join('\n');
    parts.push(`内容摘要: ${text.substring(0, 500)}`);
  }
  if (data.textContent) {
    parts.push(`文本内容: ${data.textContent.substring(0, 500)}`);
  }
  return parts.join('\n');
}
