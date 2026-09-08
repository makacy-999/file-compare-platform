'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { parseFile, diffSheets, diffParagraphs, exportToExcel, detectBestKeyColumn, detectCrossKeyMapping, detectTimeColumn } from '@/lib/file-utils';
import type { ParsedFile, DiffResult, DiffType, SheetData, SheetDiffResult, DocumentDiffResult, ReconciliationSummary, MatchClassification, TimeGranularity } from '@/types';

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

  // 时间列选择
  const [oldTimeColumn, setOldTimeColumn] = useState<string>('');
  const [newTimeColumn, setNewTimeColumn] = useState<string>('');
  const [autoOldTimeColumn, setAutoOldTimeColumn] = useState<string>('');
  const [autoNewTimeColumn, setAutoNewTimeColumn] = useState<string>('');
  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity | ''>('');
  const [timeScope, setTimeScope] = useState<'all' | 'both'>('all');

  // AI 设置持久化
  const [aiBaseUrl, setAiBaseUrl] = useState('https://api.openai.com/v1');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  useEffect(() => {
    const savedKey = localStorage.getItem('ai_api_key');
    const savedBase = localStorage.getItem('ai_base_url');
    const savedModel = localStorage.getItem('ai_model');
    if (savedKey) setApiKey(savedKey);
    if (savedBase) setAiBaseUrl(savedBase);
    if (savedModel) setAiModel(savedModel);
  }, []);

  const saveAISettings = useCallback((base: string, model: string) => {
    setAiBaseUrl(base);
    setAiModel(model);
    localStorage.setItem('ai_api_key', apiKey);
    localStorage.setItem('ai_base_url', base);
    localStorage.setItem('ai_model', model);
  }, [apiKey]);

  // 文件变化时重置主键选择
  const prevFilesLen = useMemo(() => files.length, [files]);
  useEffect(() => {
    if (files.length === 0) {
      setOldKeyColumn('');
      setNewKeyColumn('');
      setAutoKeyColumn('');
      setOldTimeColumn('');
      setNewTimeColumn('');
      setAutoOldTimeColumn('');
      setAutoNewTimeColumn('');
      setTimeGranularity('');
    }
  }, [files.length]);

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
          // 检测时间列
          const timeCol = detectTimeColumn(parsed.data.sheets[0]);
          if (timeCol) {
            // 根据文件顺序设置 A 或 B 的时间列
            setFiles((prev) => {
              const excelFiles = prev.filter((pf) => pf.type === 'excel' && pf.data?.sheets);
              if (excelFiles.length === 1) {
                setAutoOldTimeColumn(timeCol);
              } else if (excelFiles.length === 2) {
                setAutoNewTimeColumn(timeCol);
              }
              return prev;
            });
          }
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
        const otc = oldTimeColumn || autoOldTimeColumn || undefined;
        const ntc = newTimeColumn || autoNewTimeColumn || undefined;
        const tg = timeGranularity || undefined;
        const ts = timeScope;
        if (compareMode === 'sheet' && selectedSheet) {
          const oldSheet = oldSheets.find((s) => s.name === selectedSheet) || oldSheets[0];
          const newSheet = newSheets.find((s) => s.name === selectedSheet) || newSheets[0];
          results.push(diffSheets(oldSheet, newSheet, keyCol, oldKeyCol, newKeyCol, otc, ntc, tg, ts));
        } else {
          const matched = new Set<string>();
          for (const oldSheet of oldSheets) {
            const newSheet = newSheets.find((s) => s.name === oldSheet.name && !matched.has(s.name));
            if (newSheet) {
              results.push(diffSheets(oldSheet, newSheet, keyCol, oldKeyCol, newKeyCol, otc, ntc, tg, ts));
              matched.add(newSheet.name);
            }
          }
          const unmatchedOld = oldSheets.filter((s) => !matched.has(s.name));
          const unmatchedNew = newSheets.filter((s) => !matched.has(s.name));
          for (let i = 0; i < Math.min(unmatchedOld.length, unmatchedNew.length); i++) {
            results.push(diffSheets(unmatchedOld[i], unmatchedNew[i], keyCol, oldKeyCol, newKeyCol, otc, ntc, tg, ts));
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
  }, [files, compareMode, selectedSheet, selectedKeyColumn, suggestedKeyColumn, oldKeyColumn, newKeyColumn, oldTimeColumn, newTimeColumn, autoOldTimeColumn, autoNewTimeColumn, timeGranularity, timeScope]);

  const handleExport = useCallback(() => {
    if (diffResults.length === 0) return;
    try {
      const blob = exportToExcel(diffResults);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `比对报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setCompareError(`导出失败：${err instanceof Error ? err.message : '未知错误'}`);
    }
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
                {successFiles.length >= 2 && successFiles[0].type === 'excel' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">A 主键列:</span>
                      <Select value={oldKeyColumn || '__auto__'} onValueChange={(v) => setOldKeyColumn(v === '__auto__' ? '' : v)}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue placeholder="自动识别" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自动识别</SelectItem>
                          {(successFiles[0]?.data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Key className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">B 主键列:</span>
                      <Select value={newKeyColumn || '__auto__'} onValueChange={(v) => setNewKeyColumn(v === '__auto__' ? '' : v)}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue placeholder="自动识别" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自动识别</SelectItem>
                          {(successFiles[1]?.data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] text-slate-400">
                        {oldKeyColumn || newKeyColumn ? '手动指定' : '自动识别（含值域重合检测）'}
                      </span>
                    </div>

                    {/* 时间列选择 */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100 mt-1">
                      <span className="text-xs text-slate-500">A 时间列:</span>
                      <Select value={oldTimeColumn || '__auto__'} onValueChange={(v) => setOldTimeColumn(v === '__auto__' ? '' : v)}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue placeholder={autoOldTimeColumn || '自动识别'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自动识别{autoOldTimeColumn ? ` (${autoOldTimeColumn})` : ''}</SelectItem>
                          {(successFiles[0]?.data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">B 时间列:</span>
                      <Select value={newTimeColumn || '__auto__'} onValueChange={(v) => setNewTimeColumn(v === '__auto__' ? '' : v)}>
                        <SelectTrigger className="w-44 h-8 text-xs">
                          <SelectValue placeholder={autoNewTimeColumn || '自动识别'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自动识别{autoNewTimeColumn ? ` (${autoNewTimeColumn})` : ''}</SelectItem>
                          {(successFiles[1]?.data?.sheets?.[0]?.headers ?? []).map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] text-slate-400">粒度:</span>
                      <Select value={timeGranularity || '__auto__'} onValueChange={(v) => setTimeGranularity(v === '__auto__' ? '' : v as TimeGranularity)}>
                        <SelectTrigger className="w-20 h-8 text-xs">
                          <SelectValue placeholder="自动" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">自动</SelectItem>
                          <SelectItem value="day">按日</SelectItem>
                          <SelectItem value="week">按周</SelectItem>
                          <SelectItem value="month">按月</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-[10px] text-slate-400">口径:</span>
                      <Select value={timeScope} onValueChange={(v) => setTimeScope(v as 'all' | 'both')}>
                        <SelectTrigger className="w-28 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部</SelectItem>
                          <SelectItem value="both">仅两边都有</SelectItem>
                        </SelectContent>
                      </Select>
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
            <AIAnalysisPanel
              diffResults={diffResults}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              apiBase={aiBaseUrl}
              apiModel={aiModel}
              onSaveSettings={saveAISettings}
            />
          </div>
        )}

        {/* 版本标识 */}
        <footer className="mt-8 pb-6 text-center text-xs text-slate-400">
          v2.6 · 2026-09-08 · 智能文件比对分析平台
        </footer>
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

          {/* 主键匹配率信息条 */}
          {result.matchQuality && (
            <div className={`rounded-lg border px-3 py-2 mb-3 flex items-center justify-between text-sm ${
              result.matchQuality.matchRate >= 0.95 ? 'bg-emerald-50 border-emerald-200'
              : result.matchQuality.matchRate >= 0.8 ? 'bg-amber-50 border-amber-200'
              : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-2">
                <Key className="h-3.5 w-3.5 opacity-60" />
                <span className="text-slate-600">
                  主键: {result.matchQuality.oldKey === result.matchQuality.newKey
                    ? `「${result.matchQuality.oldKey}」`
                    : `A「${result.matchQuality.oldKey}」↔ B「${result.matchQuality.newKey}」`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-800">
                  匹配 {fmtNum(result.matchQuality.matchedCount)} 单
                </span>
                <span className={`font-bold ${
                  result.matchQuality.matchRate >= 0.95 ? 'text-emerald-700'
                  : result.matchQuality.matchRate >= 0.8 ? 'text-amber-700'
                  : 'text-red-700'
                }`}>
                  {(result.matchQuality.matchRate * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
          {result.matchQuality?.warning && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3 text-xs text-amber-700 flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{result.matchQuality.warning}</span>
            </div>
          )}

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

      {/* 按时间对比 */}
      {result.timeComparison && result.timeComparison.rows.length > 0 ? (
        <TimeComparisonPanel data={result.timeComparison} />
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-5">
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-3">
              <span className="text-violet-600">📅</span>
              按时间对比
            </h2>
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>未识别到时间列，请手动选择</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TimeComparisonPanel({ data }: { data: import('@/types').TimeComparison }) {
  const [sortBy, setSortBy] = useState<'time' | 'diff'>('time');

  const sortedRows = useMemo(() => {
    if (sortBy === 'time') return data.rows;
    return [...data.rows].sort((a, b) => {
      const aMax = Math.max(...Object.values(a.numericSums).map((s) => Math.abs(s.diff)));
      const bMax = Math.max(...Object.values(b.numericSums).map((s) => Math.abs(s.diff)));
      return bMax - aMax;
    });
  }, [data.rows, sortBy]);

  const maxAbsDiff = useMemo(() => {
    let max = 0;
    for (const row of data.rows) {
      for (const sums of Object.values(row.numericSums)) {
        max = Math.max(max, Math.abs(sums.diff));
      }
    }
    return max || 1;
  }, [data.rows]);

  const granularityLabel = data.granularity === 'day' ? '按日' : data.granularity === 'week' ? '按周' : '按月';

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <span className="text-violet-600">📅</span>
            按时间对比（{granularityLabel}）
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">排序:</span>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'time' | 'diff')}>
              <SelectTrigger className="w-24 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="time">时间正序</SelectItem>
                <SelectItem value="diff">差异降序</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 顶部摘要：差异最大的前3个期间 */}
        {data.topDiffPeriods.length > 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <span className="font-medium">差异主要集中在：</span>
            {data.topDiffPeriods.slice(0, 3).map((p, i) => (
              <span key={i}>
                {i > 0 && '、'}{p.period} {p.column} 差{fmtNum(Math.abs(p.diff))}
              </span>
            ))}
          </div>
        )}

        {/* 总合计 */}
        <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
          <span className="text-slate-600">全表合计：</span>
          <span className="font-medium text-slate-800">A {fmtNum(data.totalOld)}</span>
          <span className="text-slate-400 mx-1">vs</span>
          <span className="font-medium text-slate-800">B {fmtNum(data.totalNew)}</span>
          <span className={`font-semibold ml-2 ${data.totalDiff > 0 ? 'text-amber-600' : data.totalDiff < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            差 {fmtNum(Math.abs(data.totalDiff))}
          </span>
        </div>

        {/* 对比表 */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-2 font-medium text-slate-600 sticky left-0 bg-white">期间</th>
                {data.numericColumns.map((col) => (
                  <th key={col} colSpan={3} className="text-center py-2 px-1 font-medium text-slate-600 border-l border-slate-100">{col}</th>
                ))}
              </tr>
              <tr className="border-b border-slate-100 text-[10px] text-slate-400">
                <th className="text-left py-1 px-2 sticky left-0 bg-white"></th>
                {data.numericColumns.map((col) => (
                  <React.Fragment key={col}>
                    <th className="text-right py-1 px-1 font-normal">A</th>
                    <th className="text-right py-1 px-1 font-normal">B</th>
                    <th className="text-right py-1 px-1 font-normal border-r border-slate-100">差值</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.period} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-1.5 px-2 text-slate-700 whitespace-nowrap sticky left-0 bg-white">{row.periodLabel}</td>
                  {data.numericColumns.map((col) => {
                    const sums = row.numericSums[col];
                    if (!sums) return (
                      <React.Fragment key={col}>
                        <td className="text-right py-1.5 px-1 text-slate-400">—</td>
                        <td className="text-right py-1.5 px-1 text-slate-400">—</td>
                        <td className="text-right py-1.5 px-1 text-slate-400 border-r border-slate-100">—</td>
                      </React.Fragment>
                    );
                    const absDiff = Math.abs(sums.diff);
                    const barWidth = maxAbsDiff > 0 ? (absDiff / maxAbsDiff) * 100 : 0;
                    const isZero = absDiff < 0.01;
                    return (
                      <React.Fragment key={col}>
                        <td className="text-right py-1.5 px-1 text-slate-600">{fmtNum(sums.oldSum)}</td>
                        <td className="text-right py-1.5 px-1 text-slate-600">{fmtNum(sums.newSum)}</td>
                        <td className={`text-right py-1.5 px-1 border-r border-slate-100 relative ${isZero ? 'text-emerald-600' : 'text-red-600'}`}>
                          {isZero ? '✅' : (sums.diff > 0 ? '+' : '') + fmtNum(sums.diff)}
                          {!isZero && (
                            <div
                              className={`absolute bottom-0 left-0 h-0.5 ${sums.diff > 0 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-slate-400 mt-2">
          时间列：A「{data.oldTimeColumn}」↔ B「{data.newTimeColumn}」· 粒度：{granularityLabel}（自动：{data.autoGranularity === 'day' ? '按日' : data.autoGranularity === 'week' ? '按周' : '按月'}）
        </p>
      </CardContent>
    </Card>
  );
}
