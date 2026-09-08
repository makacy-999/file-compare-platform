import type {
  FileType, SheetData, ParagraphData, ParsedData, ParagraphDiffItem,
  DiffType, CellDiff, RowDiff, SheetDiffResult, ColumnMapping, KeyScore,
  FieldHotspot, NumericChangeSummary, DiffStatistics, TypicalDiff,
  DocumentDiffResult,
} from '@/types';

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

// ─── 核心：智能表格比对引擎 ─────────────────────────────────

const SUSPECTED_THRESHOLD = 0.85;

export function diffSheets(
  oldSheet: SheetData,
  newSheet: SheetData,
  keyColumn?: string,
): SheetDiffResult {
  const allHeaders = [...new Set([...oldSheet.headers, ...newSheet.headers])];
  const keyScores = analyzeKeyColumns(oldSheet.headers.length > 0 ? oldSheet : newSheet);
  const key = selectBestKey(keyScores, keyColumn) || allHeaders[0] || 'id';

  // 列映射
  const { mappings: columnMappings, unmappedOld, unmappedNew } = mapColumns(oldSheet.headers, newSheet.headers);
  const displayHeaders = allHeaders;

  // 复合键处理：统计主键重复
  const oldKeyCounts = new Map<string, number>();
  const newKeyCounts = new Map<string, number>();
  for (const row of oldSheet.rows) {
    const k = String(row[key] ?? '').trim();
    oldKeyCounts.set(k, (oldKeyCounts.get(k) || 0) + 1);
  }
  for (const row of newSheet.rows) {
    const k = String(row[key] ?? '').trim();
    newKeyCounts.set(k, (newKeyCounts.get(k) || 0) + 1);
  }
  const duplicateKeys = new Set<string>();
  for (const [k, c] of oldKeyCounts) { if (c > 1) duplicateKeys.add(k); }
  for (const [k, c] of newKeyCounts) { if (c > 1) duplicateKeys.add(k); }
  const duplicateKeyCount = duplicateKeys.size;

  // 构建复合键索引
  const buildCompositeMap = (
    rows: Record<string, unknown>[],
    keyCounts: Map<string, number>,
  ): Map<string, Record<string, unknown>[]> => {
    const map = new Map<string, Record<string, unknown>[]>();
    const counter = new Map<string, number>();
    for (const row of rows) {
      const rawKey = String(row[key] ?? '').trim();
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

  const oldIndex = buildCompositeMap(oldSheet.rows, oldKeyCounts);
  const newIndex = buildCompositeMap(newSheet.rows, newKeyCounts);

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
          unmatchedOld[oi].row, unmatchedNew[ni].row, displayHeaders, key,
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

  return {
    sheetName: newSheet.name || oldSheet.name,
    keyColumn: key,
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
  const { utils, write } = require('xlsx') as typeof import('xlsx');
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
    }
  }

  const fieldHotspots = [...allHotspots.entries()]
    .map(([column, { changeCount, total }]) => ({ column, changeCount, changeRate: total > 0 ? changeCount / total : 0 }))
    .sort((a, b) => b.changeCount - a.changeCount)
    .slice(0, 5);

  const changeRate = totalRows > 0 ? (added + removed + modified + suspected) / totalRows : 0;

  return {
    overview: { totalRows, added, removed, modified, suspected, unchanged, changeRate },
    fieldHotspots,
    numericSummaries: numericSummaries.slice(0, 5),
    typicalExamples: examples.slice(0, 5),
    warnings,
  };
}

// ─── 本地统计分析（无 API Key 降级） ─────────────────────────

export function generateLocalAnalysis(summary: Record<string, unknown>): string {
  const ov = summary.overview as { totalRows: number; added: number; removed: number; modified: number; suspected: number; unchanged: number; changeRate: number };
  const hotspots = (summary.fieldHotspots || []) as Array<{ column: string; changeCount: number; changeRate: number }>;
  const numerics = (summary.numericSummaries || []) as Array<{ column: string; oldSum: number; newSum: number; changePercent: number }>;
  const examples = (summary.typicalExamples || []) as Array<{ key: string; column: string; oldValue: string; newValue: string; type: string }>;
  const warnings = (summary.warnings || []) as string[];

  const sections: string[] = [];

  // 变更概览
  sections.push('【变更概览】');
  sections.push(`本次比对共涉及 ${ov.totalRows} 行数据，整体变更率 ${(ov.changeRate * 100).toFixed(1)}%。`);
  sections.push(`其中新增 ${ov.added} 行、删除 ${ov.removed} 行、修改 ${ov.modified} 行、疑似匹配 ${ov.suspected} 行、未变 ${ov.unchanged} 行。`);
  if (ov.suspected > 0) {
    sections.push(`发现 ${ov.suspected} 组疑似同行修改（相似度≥85%），可能是格式差异导致的误匹配，建议人工复核。`);
  }
  sections.push('');

  // 重点风险
  sections.push('【重点风险】');
  if (numerics.length > 0) {
    const bigChanges = numerics.filter((n) => Math.abs(n.changePercent) > 10);
    if (bigChanges.length > 0) {
      sections.push(`• 以下数值字段变动超过 10%，需重点关注:`);
      for (const n of bigChanges) {
        sections.push(`  - ${n.column}: ${n.oldSum.toLocaleString()} → ${n.newSum.toLocaleString()} (${n.changePercent >= 0 ? '+' : ''}${n.changePercent.toFixed(2)}%)`);
      }
    }
  }
  if (warnings.length > 0) {
    for (const w of warnings) sections.push(`• ${w}`);
  }
  if (sections[sections.length - 1] === '【重点风险】') {
    sections.push('• 未发现明显风险项。');
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
  sections.push('');

  // 后续建议
  sections.push('【后续建议】');
  sections.push('• 对疑似匹配的行进行人工复核，确认是否为同一数据项的格式差异。');
  if (numerics.some((n) => Math.abs(n.changePercent) > 5)) {
    sections.push('• 对数值变动超过 5% 的字段进行业务验证，确认变更合理性。');
  }
  sections.push('• 建议统一日期和数值格式，减少因格式差异导致的误报。');
  sections.push('• 配置 API Key 可获取更深度的 AI 智能分析。');

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
