'use client';

import { useState, useMemo } from 'react';
import {
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { AnalysisResult, AnalysisSummary, UploadedFile } from '@/types';
import { getParsedDataSummary } from '@/lib/file-utils';

interface AIAnalysisPanelProps {
  files: UploadedFile[];
  diffResults: AnalysisResult[];
  summary: AnalysisSummary | null;
  disabled?: boolean;
}

/**
 * 纯静态版本的 AI 分析面板
 * - 生成结构化的规则化分析报告（基于比对数据计算）
 * - 不需要后端 LLM 调用，纯前端即可运行
 * - 适合 GitHub Pages 等纯静态环境
 */
export function AIAnalysisPanel({
  files,
  diffResults,
  summary,
  disabled,
}: AIAnalysisPanelProps) {
  const [analysisText, setAnalysisText] = useState('');
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [copied, setCopied] = useState(false);

  const canAnalyze = diffResults.length > 0 && summary && !disabled;

  // 生成规则化分析报告
  const generateReport = (): string => {
    if (!summary) return '';

    const lines: string[] = [];

    lines.push('# 📊 文件比对分析报告');
    lines.push('');
    lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('');

    // 1. 整体概览
    lines.push('## 一、整体概览');
    lines.push('');
    lines.push(`本次共比对 **${summary.filesCompared}** 个文件，发现 **${summary.totalDifferences}** 处差异。`);
    lines.push('');
    lines.push('| 差异类型 | 数量 |');
    lines.push('|---------|------|');
    lines.push(`| 新增 | ${summary.added} |`);
    lines.push(`| 删除 | ${summary.removed} |`);
    lines.push(`| 修改 | ${summary.modified} |`);
    lines.push('');

    // 文件列表
    if (files.length > 0) {
      lines.push('**参与比对的文件：**');
      files.forEach((f) => {
        const type = f.type === 'excel' ? 'Excel 表格' : f.type === 'word' ? 'Word 文档' : f.type === 'pdf' ? 'PDF 文档' : '图片';
        const sizeKB = (f.size / 1024).toFixed(1);
        lines.push(`- ${f.name}（${type}，${sizeKB} KB）`);
      });
      lines.push('');
    }

    // 2. 详细差异分析
    lines.push('## 二、详细差异分析');
    lines.push('');

    diffResults.forEach((result, idx) => {
      if ('sheetName' in result) {
        lines.push(`### ${idx + 1}. 工作表「${result.sheetName}」`);
        lines.push('');
        lines.push(`- 主键列：\`${result.keyColumn}\``);
        lines.push(`- 原表行数：${result.totalOldRows}，新表行数：${result.totalNewRows}`);
        lines.push(`- 新增 ${result.addedRows} 行，删除 ${result.removedRows} 行，修改 ${result.modifiedRows} 行，不变 ${result.unchangedRows} 行`);
        lines.push('');

        if (result.modifiedRows > 0) {
          lines.push('**修改项示例（前 5 条）：**');
          const modifiedRows = result.rows.filter((r) => r.diffType === 'modified').slice(0, 5);
          modifiedRows.forEach((row) => {
            const changes = row.cells
              .filter((c) => c.diffType === 'modified')
              .map((c) => `${c.column}: \`${c.oldValue}\` → \`${c.newValue}\``)
              .join('、');
            lines.push(`- 行 [${row.key}]：${changes}`);
          });
          lines.push('');
        }

        if (result.addedRows > 0) {
          lines.push(`**新增 ${result.addedRows} 行**，主要集中在尾部或中间插入。`);
          lines.push('');
        }

        if (result.removedRows > 0) {
          lines.push(`**删除 ${result.removedRows} 行**，请确认这些数据是否应该移除。`);
          lines.push('');
        }
      } else if ('type' in result) {
        lines.push(`### ${idx + 1}. 文档比对`);
        lines.push('');
        lines.push(`- 原文件：${result.oldFileName}`);
        lines.push(`- 新文件：${result.newFileName}`);
        lines.push(`- 原段落数：${result.totalOldParagraphs}，新段落数：${result.totalNewParagraphs}`);
        lines.push(`- 新增 ${result.added} 段，删除 ${result.removed} 段，修改 ${result.modified} 段`);
        lines.push('');
      }
    });

    // 3. 关键差异与风险提示
    lines.push('## 三、关键差异与风险提示');
    lines.push('');

    if (summary.totalDifferences === 0) {
      lines.push('✅ **未发现任何差异**。两个文件内容完全一致。');
    } else {
      const changeRate = summary.filesCompared > 0
        ? ((summary.totalDifferences / Math.max(1, summary.added + summary.removed + summary.modified + 100)) * 100).toFixed(1)
        : '0';

      if (summary.modified > 0) {
        lines.push('⚠️ **数据修改风险**：');
        lines.push('- 存在数据字段修改，请确认修改是否符合业务预期。');
        lines.push('- 建议重点关注金额、日期、状态等关键字段的变更。');
        lines.push('');
      }

      if (summary.removed > 0) {
        lines.push('🔴 **数据删除风险**：');
        lines.push(`- 检测到 ${summary.removed} 条记录被删除，请确认是否为误操作。`);
        lines.push('- 建议与业务方确认删除的必要性，避免数据丢失。');
        lines.push('');
      }

      if (summary.added > 0) {
        lines.push('🟢 **新增数据提示**：');
        lines.push(`- 新增 ${summary.added} 条记录，请确保新数据的完整性和准确性。`);
        lines.push('');
      }

      if (Number(changeRate) > 30) {
        lines.push('🔶 **差异率较高**：');
        lines.push(`- 当前差异率约 ${changeRate}%，建议人工复核，确认是否属于正常版本迭代。`);
        lines.push('');
      }
    }

    // 4. 优化建议
    lines.push('## 四、优化建议');
    lines.push('');
    lines.push('1. **定期比对**：建议对重要文件定期进行版本比对，及时发现异常变更。');
    lines.push('2. **主键规范**：Excel 比对依赖主键列，请确保主键列值唯一且不为空。');
    lines.push('3. **版本管理**：建议对文件使用版本号命名（如 `数据_v1.xlsx`、`数据_v2.xlsx`）。');
    lines.push('4. **备份留存**：重要文件修改前请做好备份，便于回溯。');
    lines.push('5. **结果导出**：可使用「导出」功能将分析结果保存为 Excel，便于分享和归档。');
    lines.push('');

    lines.push('---');
    lines.push('*本报告由文件比对分析平台自动生成（规则化分析模式）。*');

    return lines.join('\n');
  };

  const handleStartAnalysis = () => {
    if (!canAnalyze) return;
    const report = generateReport();

    // 模拟打字机效果
    setAnalysisText('');
    setHasAnalyzed(true);
    let i = 0;
    const speed = 3; // 每次追加字符数
    const timer = setInterval(() => {
      i += speed;
      if (i >= report.length) {
        setAnalysisText(report);
        clearInterval(timer);
      } else {
        setAnalysisText(report.slice(0, i));
      }
    }, 10);
  };

  const handleReset = () => {
    setAnalysisText('');
    setHasAnalyzed(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(analysisText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('复制失败，请手动选择复制');
    }
  };

  const stats = useMemo(() => {
    if (!summary) return null;
    return {
      total: summary.totalDifferences,
      added: summary.added,
      removed: summary.removed,
      modified: summary.modified,
    };
  }, [summary]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            智能分析
            <Badge variant="secondary" className="text-xs font-normal">
              规则引擎
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            {hasAnalyzed && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  title="复制"
                  className="h-8 w-8"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-slate-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReset}
                  title="重新分析"
                  className="h-8 w-8"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-4 pt-0">
        {!hasAnalyzed ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <div className="w-14 h-14 rounded-full bg-violet-50 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-violet-600" />
            </div>
            <h3 className="text-sm font-medium text-slate-800 mb-1">一键生成分析报告</h3>
            <p className="text-xs text-slate-500 mb-4 max-w-xs">
              基于比对数据，自动生成概览、差异详情、风险提示与优化建议
            </p>
            {stats && (
              <div className="flex gap-3 mb-4 text-xs">
                <span className="text-emerald-600">新增 {stats.added}</span>
                <span className="text-red-500">删除 {stats.removed}</span>
                <span className="text-amber-600">修改 {stats.modified}</span>
              </div>
            )}
            <Button
              onClick={handleStartAnalysis}
              disabled={!canAnalyze}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              生成分析报告
            </Button>
            {!canAnalyze && diffResults.length === 0 && (
              <p className="text-xs text-slate-400 mt-3">请先上传文件并执行比对</p>
            )}
          </div>
        ) : (
          <ScrollArea className="flex-1 rounded-md border border-slate-200 bg-slate-50/50">
            <div className="p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
              {analysisText}
              {analysisText.length < generateReport().length && (
                <span className="inline-block w-2 h-4 bg-violet-500 ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </ScrollArea>
        )}

        <div className="mt-3 flex items-start gap-2 text-xs text-slate-500">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
          <span>
            纯静态环境下使用规则引擎生成分析报告；部署到 Vercel 等 Node 环境后可启用大模型深度分析。
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
