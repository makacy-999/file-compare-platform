'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Upload, FileSpreadsheet, FileText, Image as ImageIcon, File,
  Sparkles, Download, Trash2, AlertCircle, CheckCircle2, XCircle,
  Loader2, ArrowRightLeft, Key,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileUpload } from '@/components/file-upload';
import { DiffResultView } from '@/components/diff-result-view';
import { AIAnalysisPanel } from '@/components/ai-analysis-panel';
import { parseFile, diffSheets, diffParagraphs, exportToExcel, detectBestKeyColumn, detectCrossKeyMapping } from '@/lib/file-utils';
import type { ParsedFile, DiffResult, DiffType, SheetData, SheetDiffResult, DocumentDiffResult, ReconciliationSummary, MatchClassification } from '@/types';

type CompareMode = 'auto' | 'sheet';
type FileStatus = 'idle' | 'parsing' | 'success' | 'error';

interface FileWithStatus extends ParsedFile {
  status: FileStatus;
  errorMsg?: string;
}

export default function Home() {
  const [files, setFiles] = useState<FileWithStatus[]>([]);
  const [diffResults, setDiffResults] = useState<DiffResult[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>('auto');
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [filter, setFilter] = useState<'all' | DiffType>('all');
  const [apiKey, setApiKey] = useState('');
  const [selectedKeyColumn, setSelectedKeyColumn] = useState<string>('');
  const [autoKeyColumn, setAutoKeyColumn] = useState<string>('');
  const [oldKeyColumn, setOldKeyColumn] = useState<string>('');
  const [newKeyColumn, setNewKeyColumn] = useState<string>('');
  const [compareError, setCompareError] = useState<string>('');

  const allSheets = useMemo(() => {
    const sheets: string[] = [];
    files.forEach((f) => {
      if (f.type === 'excel' && f.data?.sheets) {
        for (const s of f.data.sheets) {
          if (!sheets.includes(s.name)) sheets.push(s.name);
        }
      }
    });
    return sheets;
  }, [files]);

  const suggestedKeyColumn = useMemo(() => {
    if (autoKeyColumn) return autoKeyColumn;
    const excelFiles = files.filter((f) => f.type === 'excel' && f.data?.sheets);
    if (excelFiles.length === 0) return '';
    const firstFile = excelFiles[0];
    const sheets = firstFile.data!.sheets!;
    if (sheets.length === 0) return '';
    const bestCol = detectBestKeyColumn(sheets[0]);
    return bestCol || sheets[0].headers[0] || '';
  }, [files, autoKeyColumn]);

  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    const filesWithStatus: FileWithStatus[] = newFiles.map((f) => ({
      file: f, name: f.name, type: 'other' as const, status: 'idle' as const,
    }));
    setFiles((prev) => [...prev, ...filesWithStatus]);

    for (const f of newFiles) {
      try {
        const parsed = await parseFile(f);
        setFiles((prev) =>
          prev.map((pf) =>
            pf.file === f ? { ...parsed, status: 'success' as const } : pf
          )
        );
        if (parsed.type === 'excel' && parsed.data?.sheets && parsed.data.sheets.length > 0) {
          const bestKey = detectBestKeyColumn(parsed.data.sheets[0]);
          if (bestKey) setAutoKeyColumn(bestKey);
        }
      } catch (err) {
        setFiles((prev) =>
          prev.map((pf) =>
            pf.file === f
              ? { ...pf, status: 'error' as const, errorMsg: err instanceof Error ? err.message : '解析失败' }
              : pf
          )
        );
      }
    }
  }, []);

  const handleCompare = useCallback(async () => {
    const successFiles = files.filter((f) => f.status === 'success');
    if (successFiles.length < 2) return;

    setIsComparing(true);
    setDiffResults([]);
    setCompareError('');

    try {
      const fileA = successFiles[0];
      const fileB = successFiles[1];

      const isExcelA = fileA.type === 'excel';
      const isExcelB = fileB.type === 'excel';
      const isDocA = fileA.type === 'word' || fileA.type === 'pdf';
      const isDocB = fileB.type === 'word' || fileB.type === 'pdf';

      if ((isExcelA && isDocB) || (isDocA && isExcelB)) {
        setCompareError('请上传两个同类型文件进行比对（Excel 与 Excel，或 Word/PDF 与 Word/PDF）');
        return;
      }

      if (isExcelA && isExcelB) {
        const keyCol = selectedKeyColumn || suggestedKeyColumn || undefined;
        const oldKeyCol = oldKeyColumn || undefined;
        const newKeyCol = newKeyColumn || undefined;
        const oldSheets = fileA.data?.sheets ?? [];
        const newSheets = fileB.data?.sheets ?? [];

        if (oldSheets.length === 0 || newSheets.length === 0) {
          setCompareError('文件解析结果为空，请检查文件内容');
          return;
        }

        const totalRows = oldSheets.reduce((s, sh) => s + sh.rows.length, 0)
          + newSheets.reduce((s, sh) => s + sh.rows.length, 0);
        if (totalRows > 5000) {
          setCompareError(`文件较大（共 ${totalRows} 行），比对可能需要几秒，请耐心等待…`);
        }

        const results: SheetDiffResult[] = [];
        if (compareMode === 'sheet' && selectedSheet) {
          const oldSheet = oldSheets.find((s) => s.name === selectedSheet) || oldSheets[0];
          const newSheet = newSheets.find((s) => s.name === selectedSheet) || newSheets[0];
          results.push(diffSheets(oldSheet, newSheet, keyCol, oldKeyCol, newKeyCol));
        } else {
          const matched = new Set<string>();
          for (const oldSheet of oldSheets) {
            const newSheet = newSheets.find((s) => s.name === oldSheet.name && !matched.has(s.name));
            if (newSheet) {
              results.push(diffSheets(oldSheet, newSheet, keyCol, oldKeyCol, newKeyCol));
              matched.add(newSheet.name);
            }
          }
          const unmatchedOld = oldSheets.filter((s) => !matched.has(s.name));
          const unmatchedNew = newSheets.filter((s) => !matched.has(s.name));
          for (let i = 0; i < Math.min(unmatchedOld.length, unmatchedNew.length); i++) {
            results.push(diffSheets(unmatchedOld[i], unmatchedNew[i], keyCol, oldKeyCol, newKeyCol));
          }
        }

        // 填充文件名到对账汇总
        for (const r of results) {
          if (r.reconciliation) {
            r.reconciliation.oldFileName = fileA.name;
            r.reconciliation.newFileName = fileB.name;
          }
        }

        setDiffResults(results);
      } else if (isDocA && isDocB) {
        const oldParas = fileA.data?.paragraphs ?? [];
        const newParas = fileB.data?.paragraphs ?? [];

        if (oldParas.length === 0 && newParas.length === 0) {
          setCompareError('文件解析结果为空，请检查文件内容');
          return;
        }

        const items = diffParagraphs(oldParas, newParas);
        const addedCount = items.filter((i) => i.diffType === 'added').length;
        const removedCount = items.filter((i) => i.diffType === 'removed').length;
        const modifiedCount = items.filter((i) => i.diffType === 'modified').length;
        const docResult: DocumentDiffResult = {
          type: 'paragraph',
          oldFileName: fileA.name,
          newFileName: fileB.name,
          totalOldParagraphs: oldParas.length,
          totalNewParagraphs: newParas.length,
          added: addedCount,
          removed: removedCount,
          modified: modifiedCount,
          items,
        };
        setDiffResults([docResult]);
      } else {
        setCompareError('不支持的文件类型组合，请上传两个 Excel 或两个 Word/PDF 文件');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setCompareError(`比对失败：${msg}`);
    } finally {
      setIsComparing(false);
    }
  }, [files, compareMode, selectedSheet, selectedKeyColumn, suggestedKeyColumn]);

  const handleExport = useCallback(() => {
    if (diffResults.length === 0) return;
    const blob = exportToExcel(diffResults);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `比对报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [diffResults]);

  const handleClear = useCallback(() => {
    setFiles([]);
    setDiffResults([]);
    setFilter('all');
    setSelectedKeyColumn('');
    setAutoKeyColumn('');
    setOldKeyColumn('');
    setNewKeyColumn('');
    setCompareError('');
  }, []);

  const removeFile = useCallback((file: File) => {
    setFiles((prev) => prev.filter((f) => f.file !== file));
  }, []);

  const successFiles = files.filter((f) => f.status === 'success');
  const canCompare = successFiles.length >= 2;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600">
              <ArrowRightLeft className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-base font-semibold text-slate-800">智能文件比对分析平台</h1>
          </div>
          <div className="flex items-center gap-2">
            {diffResults.length > 0 && (
              <Button onClick={handleExport} size="sm" variant="outline" className="text-xs gap-1.5">
                <Download className="h-3.5 w-3.5" />
                导出报告
              </Button>
            )}
            {files.length > 0 && (
              <Button onClick={handleClear} size="sm" variant="ghost" className="text-xs gap-1.5 text-slate-500">
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        {/* 文件上传区 */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-5">
            <FileUpload onFilesAdded={handleFilesAdded} />

            {/* 已上传文件列表 */}
            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700">已上传文件 ({files.length})</h3>
                  <div className="flex items-center gap-2">
                    <Tabs value={compareMode} onValueChange={(v) => setCompareMode(v as CompareMode)}>
                      <TabsList className="h-8">
                        <TabsTrigger value="auto" className="text-xs px-3">自动匹配</TabsTrigger>
                        <TabsTrigger value="sheet" className="text-xs px-3">指定工作表</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>

                {compareMode === 'sheet' && allSheets.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">选择工作表:</span>
                    <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                      <SelectTrigger className="w-48 h-8 text-xs">
                        <SelectValue placeholder="请选择工作表" />
                      </SelectTrigger>
                      <SelectContent>
                        {allSheets.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 主键列选择：A/B 分别选择 */}
                {suggestedKeyColumn && successFiles.length >= 2 && successFiles[0].type === 'excel' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">A 主键列:</span>
                      <Select value={oldKeyColumn || suggestedKeyColumn} onValueChange={setOldKeyColumn}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(successFiles[0].data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">B 主键列:</span>
                      <Select value={newKeyColumn || suggestedKeyColumn} onValueChange={setNewKeyColumn}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(successFiles[1].data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] text-slate-400">
                        {oldKeyColumn || newKeyColumn ? '手动指定' : '自动识别（含值域重合检测）'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  {files.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 group hover:border-slate-300 transition-colors"
                    >
                      <FileIcon type={f.type} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{f.name}</p>
                        <p className="text-xs text-slate-500">
                          {f.type === 'excel' && f.data?.sheets
                            ? `${f.data.sheets.length} 个工作表, ${f.data.sheets.reduce((a, s) => a + s.rowCount, 0)} 行数据`
                            : f.type === 'word' || f.type === 'pdf'
                            ? `${f.data?.paragraphs?.length ?? 0} 个段落`
                            : f.type === 'image' ? '图片文件' : '等待解析...'}
                        </p>
                      </div>
                      <FileStatusBadge status={f.status} />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeFile(f.file)}
                      >
                        <XCircle className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={handleCompare}
                  disabled={!canCompare || isComparing}
                  className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                >
                  {isComparing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      正在比对分析...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      比对分析 ({successFiles.length} 个文件)
                    </>
                  )}
                </Button>

                {compareError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{compareError}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 结果展示区 */}
        {diffResults.length > 0 && (
          <div className="space-y-6">
            {/* 汇总概览卡片 */}
            <OverviewCards results={diffResults} />

            {/* 对账汇总 */}
            {(() => {
              const sheetResult = diffResults.find((r): r is SheetDiffResult => 'reconciliation' in r && !!r.reconciliation);
              if (!sheetResult?.reconciliation) return null;
              return <ReconciliationPanel result={sheetResult} />;
            })()}

            {/* 性能保护提示 */}
            {diffResults.some((r) => 'skippedSimilarity' in r && r.skippedSimilarity) && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>数据量过大，已跳过智能相似配对，差异行直接归入新增/删除。</span>
              </div>
            )}

            {/* 差异详情 */}
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-violet-600" />
                    差异详情
                  </h2>
                  <div className="flex gap-1.5">
                    {(['all', 'added', 'removed', 'modified', 'suspected'] as const).map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className={`cursor-pointer text-xs transition-colors ${
                          filter === t
                            ? t === 'added' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : t === 'removed' ? 'bg-red-50 text-red-700 border-red-200'
                              : t === 'modified' ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : t === 'suspected' ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-100 text-slate-800 border-slate-300'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                        onClick={() => setFilter(t)}
                      >
                        {t === 'all' ? '全部' : t === 'added' ? '新增' : t === 'removed' ? '删除' : t === 'modified' ? '修改' : '疑似'}
                      </Badge>
                    ))}
                  </div>
                </div>
                <DiffResultView results={diffResults} filter={filter} onFilterChange={setFilter} />
              </CardContent>
            </Card>

            {/* AI 分析 */}
            <AIAnalysisPanel diffResults={diffResults} apiKey={apiKey} onApiKeyChange={setApiKey} />
          </div>
        )}
      </main>
    </div>
  );
}

// ─── 汇总概览卡片 ─────────────────────────────────────────

function OverviewCards({ results }: { results: DiffResult[] }) {
  const stats = useMemo(() => {
    let added = 0, removed = 0, modified = 0, suspected = 0, unchanged = 0;
    for (const r of results) {
      if ('addedRows' in r) {
        added += r.addedRows;
        removed += r.removedRows;
        modified += r.modifiedRows;
        suspected += r.suspectedRows ?? 0;
        unchanged += r.unchangedRows;
      } else {
        for (const item of r.items) {
          if (item.diffType === 'added') added++;
          else if (item.diffType === 'removed') removed++;
          else if (item.diffType === 'modified') modified++;
          else if (item.diffType === 'suspected') suspected++;
          else unchanged++;
        }
      }
    }
    return { added, removed, modified, suspected, unchanged };
  }, [results]);

  const cards = [
    { label: '新增', value: stats.added, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: '删除', value: stats.removed, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    { label: '修改', value: stats.modified, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    { label: '疑似', value: stats.suspected, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: '未变', value: stats.unchanged, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-xl border ${c.border} ${c.bg} p-3 text-center`}>
          <div className={`text-xl font-bold tabular-nums ${c.color}`}>{c.value}</div>
          <div className="text-xs text-slate-500 mt-0.5">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 工具组件 ─────────────────────────────────────────

function FileIcon({ type }: { type: string }) {
  const iconMap: Record<string, { icon: typeof File; color: string }> = {
    excel: { icon: FileSpreadsheet, color: 'text-emerald-600' },
    document: { icon: FileText, color: 'text-blue-600' },
    word: { icon: FileText, color: 'text-blue-600' },
    pdf: { icon: FileText, color: 'text-red-600' },
    image: { icon: ImageIcon, color: 'text-purple-600' },
  };
  const { icon: Icon, color } = iconMap[type] || { icon: File, color: 'text-slate-500' };
  return <Icon className={`h-5 w-5 ${color}`} />;
}

function FileStatusBadge({ status }: { status: FileStatus }) {
  switch (status) {
    case 'parsing':
      return <Badge variant="secondary" className="text-xs gap-1"><Loader2 className="h-3 w-3 animate-spin" />解析中</Badge>;
    case 'success':
      return <Badge variant="secondary" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="h-3 w-3" />已解析</Badge>;
    case 'error':
      return <Badge variant="destructive" className="text-xs gap-1"><AlertCircle className="h-3 w-3" />失败</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">等待</Badge>;
  }
}

// ─── 对账汇总面板 ─────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

function ReconciliationPanel({ result }: { result: SheetDiffResult }) {
  const recon = result.reconciliation!;
  const mc = result.matchClassification;

  return (
    <div className="space-y-4">
      {/* 对账汇总卡片 */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="pt-5">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
            <FileSpreadsheet className="h-4 w-4 text-violet-600" />
            对账汇总
          </h2>

          {/* 行数对比 */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 mb-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">运单数量</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">
                  A「{recon.oldFileName}」{fmtNum(recon.oldRowCount)} 单
                </span>
                <span className="text-slate-400">vs</span>
                <span className="font-medium text-slate-800">
                  B「{recon.newFileName}」{fmtNum(recon.newRowCount)} 单
                </span>
                <span className={`font-semibold ${recon.rowDiff > 0 ? 'text-amber-600' : recon.rowDiff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  ，差 {fmtNum(Math.abs(recon.rowDiff))} 单
                </span>
              </div>
            </div>
          </div>

          {/* 数值列对比 */}
          {recon.numericComparisons.map((nc) => {
            const isMatch = Math.abs(nc.diff) < 0.01;
            return (
              <div key={nc.column} className="rounded-lg bg-slate-50 border border-slate-200 p-3 mb-2 last:mb-0">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    {isMatch ? '✅' : '⚠️'} {nc.column}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">
                      A「{recon.oldFileName}」{fmtNum(nc.oldSum)}
                    </span>
                    <span className="text-slate-400">vs</span>
                    <span className="font-medium text-slate-800">
                      B「{recon.newFileName}」{fmtNum(nc.newSum)}
                    </span>
                    {isMatch ? (
                      <span className="font-semibold text-emerald-600">，一致</span>
                    ) : (
                      <span className={`font-semibold ${nc.diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                        ，差 {fmtNum(Math.abs(nc.diff))}
                      </span>
                    )}
                  </div>
                </div>
                {(nc.oldUnparsed > 0 || nc.newUnparsed > 0) && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    已忽略 {nc.oldUnparsed + nc.newUnparsed} 个无法解析的值
                  </p>
                )}
              </div>
            );
          })}

          {/* 跨列主键提示 */}
          {result.crossKeyMapping && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
              <Key className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                主键跨列匹配：A「{result.crossKeyMapping.oldKeyColumn}」↔ B「{result.crossKeyMapping.newKeyColumn}」
                （{result.crossKeyMapping.method === 'valueOverlap'
                  ? `值域重合度 ${(result.crossKeyMapping.overlapRatio * 100).toFixed(0)}%`
                  : '列名匹配'}）
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 匹配分类统计表 */}
      {mc && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-5">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <ArrowRightLeft className="h-4 w-4 text-violet-600" />
              匹配分类统计
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 font-medium text-slate-600">分类</th>
                    <th className="text-right py-2 px-3 font-medium text-slate-600">单数</th>
                    {mc.numericColumns.map((col) => (
                      <th key={col} className="text-right py-2 px-3 font-medium text-slate-600">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mc.rows.map((row) => (
                    <tr key={row.category} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.category === 'both' ? 'bg-emerald-50 text-emerald-700'
                          : row.category === 'onlyOld' ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                        }`}>
                          {row.label}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 font-medium text-slate-800">{fmtNum(row.recordCount)}</td>
                      {mc.numericColumns.map((col) => {
                        const sums = row.numericSums[col];
                        if (!sums) return <td key={col} className="text-right py-2 px-3 text-slate-400">—</td>;
                        if (row.category === 'both') {
                          return (
                            <td key={col} className="text-right py-2 px-3 text-slate-700">
                              A: {fmtNum(sums.oldSum)} / B: {fmtNum(sums.newSum)}
                            </td>
                          );
                        }
                        const val = row.category === 'onlyOld' ? sums.oldSum : sums.newSum;
                        return (
                          <td key={col} className="text-right py-2 px-3 text-slate-700">{fmtNum(val)}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 数值不一致统计 */}
            {mc.inconsistentCount > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>两边都有但数值不一致的单据：{mc.inconsistentCount} 单</span>
              </div>
            )}

            {/* 自洽校验 */}
            {!mc.selfCheckPassed && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>自洽校验未通过，分类合计与全表合计不一致，请检查数据</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
