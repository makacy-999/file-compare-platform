import type { FileType, SheetData, ParagraphData, ParsedData, ParagraphDiffItem, DiffType } from '@/types';

export function getFileType(fileName: string, mimeType: string): FileType {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const excelExts = ['xlsx', 'xls', 'csv', 'ods'];
  const wordExts = ['docx', 'doc', 'docm', 'dotx'];
  const pdfExts = ['pdf'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'tiff'];

  if (excelExts.includes(ext) || mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) {
    return 'excel';
  }
  if (wordExts.includes(ext) || mimeType.includes('word') || mimeType.includes('document')) {
    return 'word';
  }
  if (pdfExts.includes(ext) || mimeType.includes('pdf')) {
    return 'pdf';
  }
  if (imageExts.includes(ext) || mimeType.startsWith('image/')) {
    return 'image';
  }
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

// 从文件扩展名推断 sheet 名
export function getFileIcon(type: FileType): string {
  const icons: Record<FileType, string> = {
    excel: '📊',
    word: '📄',
    pdf: '📕',
    image: '🖼️',
    other: '📁',
  };
  return icons[type];
}

// 将二维数组转成 SheetData
export function arrayToSheetData(
  name: string,
  data: unknown[][],
): SheetData {
  if (!data || data.length === 0) {
    return { name, headers: [], rows: [], rowCount: 0, columnCount: 0 };
  }
  const headers = (data[0] as string[]).map((h) => String(h ?? '').trim());
  const rows = data.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx];
    });
    return obj;
  });
  return {
    name,
    headers,
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
  };
}

// 简单文本比对 - LCS 基础的段落比对
export function diffParagraphs(
  oldParagraphs: ParagraphData[],
  newParagraphs: ParagraphData[],
): ParagraphDiffItem[] {
  const oldTexts = oldParagraphs.map((p) => p.text);
  const newTexts = newParagraphs.map((p) => p.text);

  const result: ParagraphDiffItem[] = [];

  const oldLen = oldTexts.length;
  const newLen = newTexts.length;
  let i = 0,
    j = 0,
    idx = 0;

  while (i < oldLen && j < newLen) {
    if (oldTexts[i] === newTexts[j]) {
      result.push({
        index: idx++,
        diffType: 'unchanged' as DiffType,
        oldIndex: i,
        newIndex: j,
        oldText: oldTexts[i],
        newText: newTexts[j],
      });
      i++;
      j++;
    } else {
      let found = false;
      const lookAhead = 5;
      for (let k = 1; k <= lookAhead && i + k < oldLen; k++) {
        if (oldTexts[i + k] === newTexts[j]) {
          for (let m = 0; m < k; m++) {
            result.push({
              index: idx++,
              diffType: 'removed' as DiffType,
              oldIndex: i + m,
              oldText: oldTexts[i + m],
            });
          }
          i += k;
          found = true;
          break;
        }
      }
      if (!found) {
        for (let k = 1; k <= lookAhead && j + k < newLen; k++) {
          if (oldTexts[i] === newTexts[j + k]) {
            for (let m = 0; m < k; m++) {
              result.push({
                index: idx++,
                diffType: 'added' as DiffType,
                newIndex: j + m,
                newText: newTexts[j + m],
              });
            }
            j += k;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        result.push({
          index: idx++,
          diffType: 'modified' as DiffType,
          oldIndex: i,
          newIndex: j,
          oldText: oldTexts[i],
          newText: newTexts[j],
        });
        i++;
        j++;
      }
    }
  }

  while (i < oldLen) {
    result.push({
      index: idx++,
      diffType: 'removed' as DiffType,
      oldIndex: i,
      oldText: oldTexts[i],
    });
    i++;
  }
  while (j < newLen) {
    result.push({
      index: idx++,
      diffType: 'added' as DiffType,
      newIndex: j,
      newText: newTexts[j],
    });
    j++;
  }

  return result;
}

// Excel 表格比对：基于主键列的行级比对
export function diffSheets(
  oldSheet: SheetData,
  newSheet: SheetData,
  keyColumn?: string,
): {
  sheetName: string;
  keyColumn: string;
  totalOldRows: number;
  totalNewRows: number;
  addedRows: number;
  removedRows: number;
  modifiedRows: number;
  unchangedRows: number;
  rows: Array<{
    rowIndex: number;
    key: string;
    diffType: 'added' | 'removed' | 'modified' | 'unchanged';
    cells: Array<{
      column: string;
      oldValue: unknown;
      newValue: unknown;
      diffType: 'added' | 'removed' | 'modified' | 'unchanged';
    }>;
    oldRow?: Record<string, unknown>;
    newRow?: Record<string, unknown>;
  }>;
  headers: string[];
} {
  const headers = newSheet.headers.length > 0 ? newSheet.headers : oldSheet.headers;
  const key = keyColumn || headers[0] || 'id';

  const oldMap = new Map<string, Record<string, unknown>>();
  const newMap = new Map<string, Record<string, unknown>>();

  oldSheet.rows.forEach((row, idx) => {
    const k = String(row[key] ?? `__row_${idx}`);
    oldMap.set(k, row);
  });

  newSheet.rows.forEach((row, idx) => {
    const k = String(row[key] ?? `__row_${idx}`);
    newMap.set(k, row);
  });

  const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
  const rows: Array<{
    rowIndex: number;
    key: string;
    diffType: 'added' | 'removed' | 'modified' | 'unchanged';
    cells: Array<{
      column: string;
      oldValue: unknown;
      newValue: unknown;
      diffType: 'added' | 'removed' | 'modified' | 'unchanged';
    }>;
    oldRow?: Record<string, unknown>;
    newRow?: Record<string, unknown>;
  }> = [];

  let added = 0,
    removed = 0,
    modified = 0,
    unchanged = 0;

  let rowIndex = 0;
  for (const k of allKeys) {
    const oldRow = oldMap.get(k);
    const newRow = newMap.get(k);
    const cells: Array<{
      column: string;
      oldValue: unknown;
      newValue: unknown;
      diffType: 'added' | 'removed' | 'modified' | 'unchanged';
    }> = [];

    let rowType: 'added' | 'removed' | 'modified' | 'unchanged';

    if (!oldRow && newRow) {
      rowType = 'added';
      added++;
      for (const col of headers) {
        cells.push({
          column: col,
          oldValue: undefined,
          newValue: newRow[col],
          diffType: 'added',
        });
      }
    } else if (oldRow && !newRow) {
      rowType = 'removed';
      removed++;
      for (const col of headers) {
        cells.push({
          column: col,
          oldValue: oldRow[col],
          newValue: undefined,
          diffType: 'removed',
        });
      }
    } else if (oldRow && newRow) {
      let hasDiff = false;
      for (const col of headers) {
        const oldVal = oldRow[col];
        const newVal = newRow[col];
        const isSame = JSON.stringify(oldVal) === JSON.stringify(newVal);
        if (!isSame) hasDiff = true;
        cells.push({
          column: col,
          oldValue: oldVal,
          newValue: newVal,
          diffType: isSame ? 'unchanged' : 'modified',
        });
      }
      if (hasDiff) {
        rowType = 'modified';
        modified++;
      } else {
        rowType = 'unchanged';
        unchanged++;
      }
    } else {
      continue;
    }

    rows.push({
      rowIndex: rowIndex++,
      key: k,
      diffType: rowType,
      cells,
      oldRow,
      newRow,
    });
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
    rows,
    headers,
  };
}

// 获取解析数据的文本摘要（用于 AI 分析）
export function getParsedDataSummary(data: ParsedData): string {
  const parts: string[] = [`文件: ${data.fileName}`];

  if (data.sheets && data.sheets.length > 0) {
    parts.push(`包含 ${data.sheets.length} 个工作表:`);
    for (const sheet of data.sheets) {
      parts.push(
        `  - ${sheet.name}: ${sheet.rowCount} 行 x ${sheet.columnCount} 列`,
      );
      if (sheet.rows.length > 0) {
        const sample = sheet.rows.slice(0, 3);
        parts.push(`    表头: ${sheet.headers.join(', ')}`);
        parts.push(
          `    示例数据: ${JSON.stringify(sample).substring(0, 300)}`,
        );
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
