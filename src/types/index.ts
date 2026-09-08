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
  sheets?: SheetData[];
  paragraphs?: ParagraphData[];
  textContent?: string;
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

// 比对结果类型 — 'suspected' 表示相似度匹配的疑似同行修改
export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged' | 'suspected';

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
  matchReason?: string;
  similarity?: number;
}

// 列映射：两侧列名不一致时的映射关系
export interface ColumnMapping {
  oldColumn: string;
  newColumn: string;
  similarity: number;
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
  suspectedRows: number;
  rows: RowDiff[];
  headers: string[];
  columnMappings: ColumnMapping[];
  unmappedOldColumns: string[];
  unmappedNewColumns: string[];
  duplicateKeyCount: number;
  keyColumnScores: KeyScore[];
  skippedSimilarity?: boolean;
  reconciliation?: ReconciliationSummary;
  matchClassification?: MatchClassification;
  crossKeyMapping?: CrossKeyMapping;
  matchQuality?: MatchQuality;
  timeComparison?: TimeComparison;
}

// 主键匹配质量
export interface MatchQuality {
  matchedCount: number;
  matchRate: number;
  oldKey: string;
  newKey: string;
  overlapRatio: number;
  method: string;
  warning?: string;
}

// 主键候选评分
export interface KeyScore {
  column: string;
  uniqueRatio: number;
  nullRatio: number;
  score: number;
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
  suspected: number;
  unchanged: number;
  comparisonType: 'excel' | 'document' | 'mixed';
}

// 汇总统计类型
export interface FieldHotspot {
  column: string;
  changeCount: number;
  changeRate: number;
}

export interface NumericChangeSummary {
  column: string;
  oldSum: number;
  newSum: number;
  changePercent: number;
  topChanges: Array<{
    key: string;
    oldValue: number;
    newValue: number;
    change: number;
  }>;
}

export interface DiffStatistics {
  totalRows: number;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  suspectedCount: number;
  unchangedCount: number;
  fieldHotspots: FieldHotspot[];
  numericSummaries: NumericChangeSummary[];
 典型差异: TypicalDiff[];
}

export interface TypicalDiff {
  key: string;
  column: string;
  oldValue: string;
  newValue: string;
  diffType: DiffType;
}

// 通用比对结果联合类型
export type DiffResult = SheetDiffResult | DocumentDiffResult;

// 解析后的文件（用于页面状态管理）
export interface ParsedFile {
  file: File;
  name: string;
  type: FileType;
  data?: ParsedData;
}

// ─── 对账汇总类型 ─────────────────────────────────────────

// 数值列 A/B 合计对比
export interface NumericColumnComparison {
  column: string;
  oldColumn: string;
  newColumn: string;
  oldSum: number;
  newSum: number;
  diff: number;
  oldUnparsed: number;
  newUnparsed: number;
}

// 对账汇总卡片数据
export interface ReconciliationSummary {
  oldFileName: string;
  newFileName: string;
  oldRowCount: number;
  newRowCount: number;
  rowDiff: number;
  numericComparisons: NumericColumnComparison[];
}

// 匹配分类统计表行
export interface MatchClassificationRow {
  category: 'both' | 'onlyOld' | 'onlyNew';
  label: string;
  recordCount: number;
  numericSums: Record<string, { oldSum: number; newSum: number }>;
}

// 匹配分类统计
export interface MatchClassification {
  rows: MatchClassificationRow[];
  numericColumns: string[];
  inconsistentCount: number;
  topDiffs: Array<{
    key: string;
    column: string;
    oldValue: number;
    newValue: number;
    diff: number;
  }>;
  onlyOldSampleKeys: string[];
  onlyNewSampleKeys: string[];
  selfCheckPassed: boolean;
}

// 跨列主键映射信息
export interface CrossKeyMapping {
  oldKeyColumn: string;
  newKeyColumn: string;
  method: 'name' | 'valueOverlap' | 'auto' | 'manual' | 'partialA' | 'partialB';
  overlapRatio: number;
}

// ─── 按时间对比类型 ─────────────────────────────────────────

export type TimeGranularity = 'day' | 'week' | 'month';

export interface TimeComparisonRow {
  period: string;
  periodLabel: string;
  numericSums: Record<string, { oldSum: number; newSum: number; diff: number }>;
  oldUnparsed: number;
  newUnparsed: number;
}

export interface TimeComparison {
  oldTimeColumn: string;
  newTimeColumn: string;
  granularity: TimeGranularity;
  autoGranularity: TimeGranularity;
  rows: TimeComparisonRow[];
  numericColumns: string[];
  topDiffPeriods: Array<{ period: string; column: string; diff: number; absDiff: number }>;
  totalOld: number;
  totalNew: number;
  totalDiff: number;
  scope: 'all' | 'both';
}

// AI 分析相关
export interface AIAnalysisRequest {
  files: UploadedFile[];
  diffResults: AnalysisResult[];
  summary: AnalysisSummary;
}
