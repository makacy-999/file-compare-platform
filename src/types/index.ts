// 文件与数据分析相关的类型定义

export type FileType = 'excel' | 'word' | 'pdf' | 'image' | 'other';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: FileType;
  mimeType: string;
  uploadedAt: Date;
  status: 'pending' | 'parsing' | 'parsed' | 'error';
  error?: string;
  data?: ParsedData;
}

export interface ParsedData {
  fileName: string;
  sheets?: SheetData[];          // Excel
  paragraphs?: ParagraphData[];  // Word / PDF
  textContent?: string;          // 纯文本
  metadata?: Record<string, string | number | boolean>;
}

export interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  columnCount: number;
}

export interface ParagraphData {
  text: string;
  style?: string;
  index: number;
}

// 比对结果类型
export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface CellDiff {
  column: string;
  oldValue: unknown;
  newValue: unknown;
  diffType: DiffType;
}

export interface RowDiff {
  rowIndex: number;
  key: string;
  diffType: DiffType;
  cells: CellDiff[];
  oldRow?: Record<string, unknown>;
  newRow?: Record<string, unknown>;
}

export interface SheetDiffResult {
  sheetName: string;
  keyColumn: string;
  totalOldRows: number;
  totalNewRows: number;
  addedRows: number;
  removedRows: number;
  modifiedRows: number;
  unchangedRows: number;
  rows: RowDiff[];
  headers: string[];
}

export interface DocumentDiffResult {
  type: 'paragraph' | 'text';
  oldFileName: string;
  newFileName: string;
  totalOldParagraphs: number;
  totalNewParagraphs: number;
  added: number;
  removed: number;
  modified: number;
  items: ParagraphDiffItem[];
}

export interface ParagraphDiffItem {
  index: number;
  diffType: DiffType;
  oldText?: string;
  newText?: string;
  oldIndex?: number;
  newIndex?: number;
}

export type AnalysisResult = SheetDiffResult | DocumentDiffResult;

export interface AnalysisSummary {
  filesCompared: number;
  totalDifferences: number;
  added: number;
  removed: number;
  modified: number;
  comparisonType: 'excel' | 'document' | 'mixed';
}

// AI 分析相关
export interface AIAnalysisRequest {
  files: UploadedFile[];
  diffResults: AnalysisResult[];
  summary: AnalysisSummary;
}
