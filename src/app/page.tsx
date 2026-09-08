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
import { parseFile, diffSheets, exportToExcel, detectBestKeyColumn } from '@/lib/file-utils';
import type { ParsedFile, DiffResult, DiffType, SheetData, SheetDiffResult } from '@/types';

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

    try {
      const keyCol = selectedKeyColumn || suggestedKeyColumn || undefined;

      // 获取两个文件的 sheet 数据
      const getSheets = (f: FileWithStatus): SheetData[] => {
        if (f.type === 'excel' && f.data?.sheets) return f.data.sheets;
        return [];
      };

      const oldSheets = getSheets(successFiles[0]);
      const newSheets = getSheets(successFiles[1]);

      if (oldSheets.length === 0 || newSheets.length === 0) {
        // 文档比对
        const results: DiffResult[] = [];
        // 简化处理：只比对第一个 sheet
        if (oldSheets.length > 0 && newSheets.length > 0) {
          const result = diffSheets(oldSheets[0], newSheets[0], keyCol);
          results.push(result);
        }
        setDiffResults(results);
      } else {
        // 表格比对
        const results: SheetDiffResult[] = [];
        if (compareMode === 'sheet' && selectedSheet) {
          const oldSheet = oldSheets.find((s) => s.name === selectedSheet) || oldSheets[0];
          const newSheet = newSheets.find((s) => s.name === selectedSheet) || newSheets[0];
          results.push(diffSheets(oldSheet, newSheet, keyCol));
        } else {
          // 自动匹配：按 sheet 名称配对
          const matched = new Set<string>();
          for (const oldSheet of oldSheets) {
            const newSheet = newSheets.find((s) => s.name === oldSheet.name && !matched.has(s.name));
            if (newSheet) {
              results.push(diffSheets(oldSheet, newSheet, keyCol));
              matched.add(newSheet.name);
            }
          }
          // 未匹配的 sheet 按顺序配对
          const unmatchedOld = oldSheets.filter((s) => !matched.has(s.name));
          const unmatchedNew = newSheets.filter((s) => !matched.has(s.name));
          for (let i = 0; i < Math.min(unmatchedOld.length, unmatchedNew.length); i++) {
            results.push(diffSheets(unmatchedOld[i], unmatchedNew[i], keyCol));
          }
        }
        setDiffResults(results);
      }
    } catch (err) {
      console.error('比对失败:', err);
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

                {/* 主键列选择 */}
                {suggestedKeyColumn && (
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">主键列:</span>
                    <Select value={selectedKeyColumn || suggestedKeyColumn} onValueChange={setSelectedKeyColumn}>
                      <SelectTrigger className="w-48 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const excelFile = successFiles.find((f) => f.type === 'excel' && f.data?.sheets);
                          if (!excelFile?.data?.sheets) return null;
                          return excelFile.data.sheets[0].headers.map((h) => (
                            <SelectItem key={h} value={h}>{h}</SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    <span className="text-[10px] text-slate-400">
                      {selectedKeyColumn ? '手动选择' : '自动识别'}
                    </span>
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* 结果展示区 */}
        {diffResults.length > 0 && (
          <div className="space-y-6">
            {/* 汇总概览卡片 */}
            <OverviewCards results={diffResults} />

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
