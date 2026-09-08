'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, Copy, Check, RefreshCw, Square, AlertTriangle, TrendingUp, TrendingDown, ShieldAlert, Lightbulb, FileText, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildDiffSummary, generateLocalAnalysis } from '@/lib/file-utils';
import type { DiffResult, SheetDiffResult } from '@/types';

interface AIAnalysisPanelProps {
  diffResults: DiffResult[];
  apiKey?: string;
  onApiKeyChange?: (key: string) => void;
  apiBase?: string;
  apiModel?: string;
}

export function AIAnalysisPanel({ diffResults, apiKey, onApiKeyChange, apiBase, apiModel }: AIAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [localBase, setLocalBase] = useState(apiBase || '');
  const [localModel, setLocalModel] = useState(apiModel || '');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasKey = !!apiKey?.trim();

  const structuredSummary = useMemo(() => {
    if (diffResults.length === 0) return null;
    return buildDiffSummary(diffResults);
  }, [diffResults]);

  const localAnalysis = useMemo(() => {
    if (!structuredSummary) return null;
    return generateLocalAnalysis(structuredSummary);
  }, [structuredSummary]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [analysis]);

  const handleAnalyze = async () => {
    if (!structuredSummary) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsAnalyzing(true);
    setAnalysis('');
    setError(null);

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(structuredSummary);

    try {
      const baseURL = (localBase || apiBase || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const url = `${baseURL}/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: localModel || apiModel || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        let errMsg = `请求失败 (${res.status})`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch {
          if (errText) errMsg = errText.slice(0, 200);
        }
        setError(errMsg);
        setIsAnalyzing(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) setAnalysis((prev) => prev + delta);
            const errMsg = parsed.choices?.[0]?.message?.content;
            if (parsed.error) {
              setError(parsed.error.message || '分析出错');
              break;
            }
            if (errMsg && parsed.error) {
              setError(errMsg);
              break;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : '分析请求失败';
      setError(msg.includes('Failed to fetch') ? '无法连接 LLM 服务，请检查 API Base URL 是否正确，或是否存在跨域限制' : msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStop = () => { abortRef.current?.abort(); setIsAnalyzing(false); };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(analysis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => { setAnalysis(''); setError(null); };

  const displayContent = analysis || (hasKey ? '' : localAnalysis || '');

  if (diffResults.length === 0) {
    return (
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-600" />
            AI 智能分析
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-slate-400">
            <FileText className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">完成文件比对后，可进行 AI 分析</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-violet-600" />
          AI 智能分析
          {!hasKey && <span className="text-[10px] font-normal text-slate-400 ml-1">本地统计模式</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasKey && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            未配置 API Key，将使用本地统计分析。配置 Key 可获得更深度的 AI 洞察。
          </div>
        )}

        {hasKey && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="输入 API Key 进行 AI 分析..."
                value={apiKey || ''}
                onChange={(e) => onApiKeyChange?.(e.target.value)}
                className="flex-1 h-9 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </div>
            {showSettings && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">API Base URL（OpenAI 兼容格式）</label>
                  <Input
                    placeholder="https://api.openai.com/v1"
                    value={localBase}
                    onChange={(e) => setLocalBase(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-0.5 block">模型名称</label>
                  <Input
                    placeholder="gpt-4o-mini"
                    value={localModel}
                    onChange={(e) => setLocalModel(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {!isAnalyzing ? (
            <Button
              onClick={handleAnalyze}
              disabled={!structuredSummary}
              size="sm"
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-xs"
            >
              <Sparkles className="h-3 w-3 mr-1" />
              {analysis ? '重新分析' : '开始分析'}
            </Button>
          ) : (
            <Button onClick={handleStop} size="sm" variant="destructive" className="flex-1 text-xs">
              <Square className="h-3 w-3 mr-1" />
              停止分析
            </Button>
          )}
          {analysis && (
            <>
              <Button onClick={handleCopy} size="sm" variant="outline" className="text-xs">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
              <Button onClick={handleReset} size="sm" variant="outline" className="text-xs">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            {error}
          </div>
        )}

        {displayContent && (
          <div ref={scrollRef} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 max-h-[500px] overflow-y-auto">
            <AnalysisRenderer content={displayContent} />
            {isAnalyzing && (
              <span className="inline-block w-1.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── 分析内容渲染器（分块展示） ─────────────────────────────────

function AnalysisRenderer({ content }: { content: string }) {
  const sections = parseAnalysisSections(content);

  return (
    <div className="space-y-4">
      {sections.map((section, idx) => (
        <div key={idx}>
          {section.title && (
            <div className="flex items-center gap-2 mb-2">
              {section.icon === 'overview' && <TrendingUp className="h-4 w-4 text-violet-600" />}
              {section.icon === 'risk' && <ShieldAlert className="h-4 w-4 text-red-600" />}
              {section.icon === 'quality' && <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {section.icon === 'suggestion' && <Lightbulb className="h-4 w-4 text-emerald-600" />}
              {section.icon === 'default' && <Sparkles className="h-4 w-4 text-slate-500" />}
              <h4 className="text-sm font-semibold text-slate-800">{section.title}</h4>
            </div>
          )}
          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {section.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseAnalysisSections(content: string): Array<{ title: string; content: string; icon: string }> {
  const sectionMap: Record<string, string> = {
    '变更概览': 'overview',
    '重点风险': 'risk',
    '数据质量观察': 'quality',
    '后续建议': 'suggestion',
  };

  const sections: Array<{ title: string; content: string; icon: string }> = [];
  const lines = content.split('\n');
  let currentTitle = '';
  let currentIcon = 'default';
  let currentContent: string[] = [];

  for (const line of lines) {
    let matched = false;
    for (const [keyword, icon] of Object.entries(sectionMap)) {
      if (line.includes(`【${keyword}】`) || line.includes(`## ${keyword}`) || line.includes(`### ${keyword}`)) {
        if (currentContent.length > 0 || currentTitle) {
          sections.push({ title: currentTitle, content: currentContent.join('\n').trim(), icon: currentIcon });
        }
        currentTitle = keyword;
        currentIcon = icon;
        const remaining = line.replace(new RegExp(`[【】]|##\\s*|###\\s*|${keyword}`, 'g'), '').trim();
        currentContent = remaining ? [remaining] : [];
        matched = true;
        break;
      }
    }
    if (!matched) {
      currentContent.push(line);
    }
  }

  if (currentContent.length > 0 || currentTitle) {
    sections.push({ title: currentTitle, content: currentContent.join('\n').trim(), icon: currentIcon });
  }

  if (sections.length === 0) {
    sections.push({ title: '', content, icon: 'default' });
  }

  return sections;
}

// ─── Prompt 构建 ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `你是一位专业的数据比对分析师。用户会提供一份结构化的文件差异比对摘要，请你基于这些数据进行深度分析。

请严格按以下四个分块输出，每块用【】标注标题：

【变更概览】用 2-3 句话概括整体变更规模、影响范围和变更集中方向。
【重点风险】列出需要重点关注的高风险变更，如金额大额变动、关键字段缺失、主键异常等。
【数据质量观察】指出数据格式不一致、主键重复、空值异常等质量问题。
【后续建议】给出 3-5 条具体可执行的后续操作建议。

要求：分析要基于数据事实，不要编造；数字要准确；建议要具体可操作。`;
}

function buildUserPrompt(summary: Record<string, unknown>): string {
  if (!summary) return '请分析以下差异数据。';

  const parts: string[] = [];
  const overview = summary.overview as Record<string, number> | undefined;
  const fieldHotspots = (summary.fieldHotspots || []) as Array<{ column: string; changeCount: number; changeRate: number }>;
  const numericSummaries = (summary.numericSummaries || []) as Array<{ column: string; oldSum: number; newSum: number; changePercent: number }>;
  const typicalExamples = (summary.typicalExamples || []) as Array<{ key: string; column: string; oldValue: string; newValue: string; type: string }>;
  const warnings = (summary.warnings || []) as string[];

  if (overview) {
    parts.push(`## 比对概要`);
    parts.push(`- 总行数: ${overview.totalRows}`);
    parts.push(`- 新增: ${overview.added}, 删除: ${overview.removed}, 修改: ${overview.modified}, 疑似配对: ${overview.suspected}, 未变: ${overview.unchanged}`);
    parts.push(`- 变更率: ${(overview.changeRate * 100).toFixed(1)}%`);
    parts.push('');
  }

  if (warnings.length > 0) {
    parts.push(`## 警告`);
    for (const w of warnings) parts.push(`- ⚠️ ${w}`);
    parts.push('');
  }

  if (fieldHotspots.length > 0) {
    parts.push(`## 字段变更热点 Top5`);
    for (const h of fieldHotspots.slice(0, 5)) {
      parts.push(`- ${h.column}: ${h.changeCount} 次修改 (${(h.changeRate * 100).toFixed(1)}%)`);
    }
    parts.push('');
  }

  if (numericSummaries.length > 0) {
    parts.push(`## 数值字段增减`);
    for (const n of numericSummaries.slice(0, 5)) {
      parts.push(`- ${n.column}: ${n.oldSum.toFixed(2)} → ${n.newSum.toFixed(2)} (${n.changePercent.toFixed(1)}%)`);
    }
    parts.push('');
  }

  if (typicalExamples.length > 0) {
    parts.push(`## 典型差异样例`);
    for (const t of typicalExamples.slice(0, 5)) {
      parts.push(`- 主键 [${t.key}] 列 "${t.column}": ${t.oldValue} → ${t.newValue} (${t.type})`);
    }
  }

  return parts.join('\n');
}
