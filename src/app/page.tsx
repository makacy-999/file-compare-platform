'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Upload,
  GitCompare,
  Download,
  Save,
  Sparkles,
  BarChart3,
  FileSpreadsheet,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileUpload } from '@/components/file-upload';
import { DiffResultView } from '@/components/diff-result-view';
import { AIAnalysisPanel } from '@/components/ai-analysis-panel';
import { diffSheets, diffParagraphs } from '@/lib/file-utils';
import type {
  UploadedFile,
  AnalysisResult,
  AnalysisSummary,
  SheetDiffResult,
  DocumentDiffResult,
} from '@/types';

export default function HomePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [diffResults, setDiffResults] = useState<AnalysisResult[]>([]);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'result'>(
    'upload',
  );

  const parsedFiles = useMemo(
    () => files.filter((f) => f.status === 'parsed' && f.data),
    [files],
  );

  const excelFiles = useMemo(
    () => parsedFiles.filter((f) => f.type === 'excel'),
    [parsedFiles],
  );

  const docFiles = useMemo(
    () => parsedFiles.filter((f) => f.type === 'word' || f.type === 'pdf'),
    [parsedFiles],
  );

  const canCompare = parsedFiles.length >= 2;

  const handleCompare = useCallback(() => {
    if (parsedFiles.length < 2) return;
    setIsAnalyzing(true);

    try {
      const results: AnalysisResult[] = [];
      let totalAdded = 0;
      let totalRemoved = 0;
      let totalModified = 0;
      let comparisonType: 'excel' | 'document' | 'mixed' = 'mixed';

      // Excel 表格比对
      if (excelFiles.length >= 2) {
        const baseFile = excelFiles[0];
        for (let i = 1; i < excelFiles.length; i++) {
          const compareFile = excelFiles[i];
          const baseSheets = baseFile.data?.sheets || [];
          const compareSheets = compareFile.data?.sheets || [];

          // 匹配同名 sheet
          for (const baseSheet of baseSheets) {
            const matchSheet = compareSheets.find(
              (s) => s.name === baseSheet.name,
            );
            if (matchSheet) {
              const diff = diffSheets(baseSheet, matchSheet);
              const namedDiff: SheetDiffResult = {
                ...diff,
                sheetName: `${baseFile.name} → ${compareFile.name} / ${diff.sheetName}`,
              };
              results.push(namedDiff);
              totalAdded += diff.addedRows;
              totalRemoved += diff.removedRows;
              totalModified += diff.modifiedRows;
            }
          }
        }
      }

      // 文档比对 (Word / PDF)
      if (docFiles.length >= 2) {
        const baseFile = docFiles[0];
        for (let i = 1; i < docFiles.length; i++) {
          const compareFile = docFiles[i];
          const baseParas = baseFile.data?.paragraphs || [];
          const compareParas = compareFile.data?.paragraphs || [];

          const diffItems = diffParagraphs(baseParas, compareParas);
          const added = diffItems.filter((d) => d.diffType === 'added').length;
          const removed = diffItems.filter((d) => d.diffType === 'removed').length;
          const modified = diffItems.filter(
            (d) => d.diffType === 'modified',
          ).length;

          const docResult: DocumentDiffResult = {
            type: 'paragraph',
            oldFileName: baseFile.name,
            newFileName: compareFile.name,
            totalOldParagraphs: baseParas.length,
            totalNewParagraphs: compareParas.length,
            added,
            removed,
            modified,
            items: diffItems,
          };
          results.push(docResult);
          totalAdded += added;
          totalRemoved += removed;
          totalModified += modified;
        }
      }

      if (excelFiles.length >= 2 && docFiles.length === 0) {
        comparisonType = 'excel';
      } else if (docFiles.length >= 2 && excelFiles.length === 0) {
        comparisonType = 'document';
      }

      const diffCount = totalAdded + totalRemoved + totalModified;

      setDiffResults(results);
      setSummary({
        filesCompared: parsedFiles.length,
        totalDifferences: diffCount,
        added: totalAdded,
        removed: totalRemoved,
        modified: totalModified,
        comparisonType,
      });
      setActiveTab('result');
    } catch (err) {
      console.error('比对失败:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [parsedFiles, excelFiles, docFiles]);

  const handleExport = useCallback(
    async (format: 'xlsx' | 'csv' = 'xlsx') => {
      if (diffResults.length === 0) return;

      try {
        const response = await fetch('/api/files/export', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            diffResults,
            summary,
            format,
            fileName: `比对分析结果_${new Date().toISOString().slice(0, 10)}`,
          }),
        });

        if (!response.ok) {
          throw new Error('导出失败');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = format === 'csv' ? 'csv' : 'xlsx';
        a.download = `比对分析结果_${new Date().toISOString().slice(0, 10)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (err) {
        console.error('导出失败:', err);
        alert('导出失败，请重试');
      }
    },
    [diffResults, summary],
  );

  const handleSaveAs = useCallback(() => {
    // 另存为：打开导出格式选择
    void handleExport('xlsx');
  }, [handleExport]);

  // 概览统计
  const stats = useMemo(() => {
    return [
      { label: '已上传', value: files.length, icon: Upload, color: 'text-blue-600 bg-blue-50' },
      { label: '解析成功', value: parsedFiles.length, icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50' },
      { label: '差异总数', value: summary?.totalDifferences || 0, icon: BarChart3, color: 'text-amber-600 bg-amber-50' },
      { label: 'AI 建议', value: summary ? '已生成' : '待分析', icon: Sparkles, color: 'text-violet-600 bg-violet-50' },
    ];
  }, [files.length, parsedFiles.length, summary]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
                <FileSpreadsheet className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-800 leading-tight">
                  智能文件比对分析平台
                </h1>
                <p className="text-xs text-slate-500">
                  Excel / Word / PDF 多格式比对 · AI 智能分析
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExport('xlsx')}
                disabled={diffResults.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                导出
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveAs}
                disabled={diffResults.length === 0}
              >
                <Save className="h-4 w-4 mr-2" />
                另存为
              </Button>
              <Button
                size="sm"
                onClick={handleCompare}
                disabled={!canCompare || isAnalyzing}
                className="bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-slate-950"
              >
                <GitCompare className="h-4 w-4 mr-2" />
                {isAnalyzing ? '分析中...' : '比对分析'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map((stat) => (
            <Card key={stat.label} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${stat.color}`}
                  >
                    <stat.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">{stat.label}</p>
                    <p className="text-xl font-semibold text-slate-800 tabular-nums">
                      {stat.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 提示信息 */}
        {files.length > 0 && parsedFiles.length < files.length && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>部分文件解析中，请等待解析完成后再进行比对分析</span>
          </div>
        )}

        {/* 主体内容区 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧：上传 & 结果 */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'result')}>
              <TabsList className="mb-4">
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  文件上传
                  {files.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                      {files.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="result" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  分析结果
                  {diffResults.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                      {diffResults.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Upload className="h-5 w-5 text-slate-600" />
                      上传文件
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FileUpload files={files} onFilesChange={setFiles} />

                    {canCompare && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-700">
                              已就绪 {parsedFiles.length} 个文件
                            </p>
                            <p className="text-xs text-slate-500">
                              点击右上角"比对分析"开始比对
                            </p>
                          </div>
                          <Button
                            onClick={handleCompare}
                            disabled={isAnalyzing}
                            className="bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-slate-950"
                          >
                            <GitCompare className="h-4 w-4 mr-2" />
                            {isAnalyzing ? '分析中...' : '开始比对'}
                          </Button>
                        </div>
                      </div>
                    )}

                    {files.length > 0 && !canCompare && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-sm text-amber-600">
                          请至少上传 2 个可解析的文件以进行比对
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="result">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-slate-600" />
                      比对分析结果
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DiffResultView results={diffResults} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* 右侧：AI 分析面板 */}
          <div className="lg:col-span-1">
            <AIAnalysisPanel
              files={parsedFiles}
              diffResults={diffResults}
              summary={summary}
              disabled={diffResults.length === 0}
            />
          </div>
        </div>

        {/* 底部说明 */}
        <div className="mt-8 text-center text-xs text-slate-400">
          <p>支持 Excel (.xlsx, .xls, .csv) · Word (.docx, .doc) · PDF · 图片 等多格式</p>
          <p className="mt-1">文件仅用于即时分析，不会保存在服务器</p>
        </div>
      </main>
    </div>
  );
}
