'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, StopCircle, RotateCcw, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [analysisText, isAnalyzing]);

  const handleStartAnalysis = async () => {
    if (isAnalyzing || !summary || diffResults.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const fileSummaries = files
        .filter((f) => f.data)
        .map((f) => getParsedDataSummary(f.data!));

      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileSummaries,
          diffResults,
          summary,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('分析请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                setAnalysisText((prev) => prev + parsed.content);
              } else if (parsed.error) {
                setAnalysisText((prev) => prev + `\n\n⚠️ ${parsed.error}`);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setAnalysisText((prev) => prev + '\n\n--- 分析已停止 ---');
      } else {
        setAnalysisText(
          (prev) =>
            prev +
            `\n\n❌ 分析失败: ${err instanceof Error ? err.message : '未知错误'}`,
        );
      }
    } finally {
      setIsAnalyzing(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleReset = () => {
    setAnalysisText('');
  };

  const handleCopy = async () => {
    if (!analysisText) return;
    try {
      await navigator.clipboard.writeText(analysisText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 忽略复制错误
    }
  };

  const canAnalyze = !disabled && diffResults.length > 0 && summary && files.length > 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          AI 智能分析
        </CardTitle>
        <div className="flex items-center gap-2">
          {analysisText && !isAnalyzing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="text-xs h-8"
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-1" />
                ) : (
                  <Copy className="h-4 w-4 mr-1" />
                )}
                {copied ? '已复制' : '复制'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-xs h-8"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                重置
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0">
        {!analysisText && !isAnalyzing ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-violet-50 flex items-center justify-center mb-4">
              <Sparkles className="h-8 w-8 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-slate-700 mb-1">AI 智能分析</p>
            <p className="text-xs text-slate-500 mb-4 max-w-xs">
              基于比对结果进行深度分析，自动识别关键差异、潜在风险并给出优化建议
            </p>
            <Button
              onClick={handleStartAnalysis}
              disabled={!canAnalyze}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              开始 AI 分析
            </Button>
            {!canAnalyze && diffResults.length === 0 && (
              <p className="text-xs text-slate-400 mt-3">请先进行比对分析</p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div
              ref={scrollRef}
              className="flex-1 px-5 py-4 overflow-y-auto"
            >
              <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {analysisText}
                {isAnalyzing && (
                  <span className="inline-block w-2 h-4 ml-1 bg-violet-500 animate-pulse rounded-sm" />
                )}
              </div>
            </div>
            {isAnalyzing && (
              <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                  AI 正在分析中...
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStop}
                  className="text-xs h-8"
                >
                  <StopCircle className="h-4 w-4 mr-1" />
                  停止
                </Button>
              </div>
            )}
            {!isAnalyzing && analysisText && (
              <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
                <p className="text-xs text-slate-400">分析完成</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartAnalysis}
                  className="text-xs h-8"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  重新分析
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
