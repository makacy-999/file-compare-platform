'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import {
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  Square,
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

export function AIAnalysisPanel({
  files,
  diffResults,
  summary,
  disabled,
}: AIAnalysisPanelProps) {
  const [analysisText, setAnalysisText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const canAnalyze = diffResults.length > 0 && summary && !disabled && !isAnalyzing;

  const handleStartAnalysis = useCallback(async () => {
    if (!canAnalyze || !summary) return;

    setAnalysisText('');
    setError(null);
    setIsAnalyzing(true);
    setHasAnalyzed(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const fileSummaries = files
        .filter((f) => f.status === 'parsed' && f.data)
        .map((f) => getParsedDataSummary(f.data!));

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileSummaries, diffResults, summary }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `分析失败 (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 消息
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const chunk = line.slice(6);
            if (chunk === '[DONE]') continue;
            try {
              const data = JSON.parse(chunk);
              if (data.type === 'content' && data.content) {
                setAnalysisText((prev) => prev + data.content);
              } else if (data.type === 'error') {
                throw new Error(data.message || '分析出错');
              }
            } catch {
              // 忽略非 JSON 数据块
              setAnalysisText((prev) => prev + chunk);
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'AbortError') {
        setAnalysisText((prev) => prev + '\n\n---\n[分析已停止]');
      } else {
        const msg = err instanceof Error ? err.message : '未知错误';
        setError(msg);
      }
    } finally {
      setIsAnalyzing(false);
      abortRef.current = null;
    }
  }, [canAnalyze, summary, files, diffResults]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsAnalyzing(false);
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setAnalysisText('');
    setHasAnalyzed(false);
    setIsAnalyzing(false);
    setError(null);
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
            AI 智能分析
            {isAnalyzing && (
              <Badge variant="secondary" className="text-xs font-normal animate-pulse">
                分析中
              </Badge>
            )}
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
                  disabled={isAnalyzing}
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
            <h3 className="text-sm font-medium text-slate-800 mb-1">
              AI 智能差异分析
            </h3>
            <p className="text-xs text-slate-500 mb-4 max-w-xs">
              基于大语言模型，深度解读文件差异，给出风险提示与优化建议
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
              开始 AI 分析
            </Button>
            {!canAnalyze && diffResults.length === 0 && (
              <p className="text-xs text-slate-400 mt-3">请先上传文件并执行比对</p>
            )}
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 rounded-md border border-slate-200 bg-slate-50/50">
              <div className="p-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {analysisText}
                {isAnalyzing && (
                  <span className="inline-block w-2 h-4 bg-violet-500 ml-0.5 animate-pulse align-middle" />
                )}
                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-xs">
                    <div className="flex items-center gap-1.5 font-medium mb-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      分析失败
                    </div>
                    {error}
                  </div>
                )}
              </div>
            </ScrollArea>

            {isAnalyzing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStop}
                className="mt-3 w-full border-red-200 text-red-600 hover:bg-red-50"
              >
                <Square className="w-3.5 h-3.5 mr-2" />
                停止分析
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
