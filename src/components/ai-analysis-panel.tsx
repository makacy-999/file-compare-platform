'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Sparkles,
  RotateCcw,
  Copy,
  Check,
  Square,
  AlertCircle,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import type { AnalysisResult, AnalysisSummary, UploadedFile } from '@/types';
import { getParsedDataSummary } from '@/lib/file-utils';

interface AIAnalysisPanelProps {
  files: UploadedFile[];
  diffResults: AnalysisResult[];
  summary: AnalysisSummary | null;
  disabled?: boolean;
}

const STORAGE_KEY = 'file-compare-ai-config';

interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_CONFIG: AIConfig = {
  apiKey: '',
  baseUrl: 'https://api.coze.cn/v3',
  model: '',
};

const PRESET_PROVIDERS = [
  {
    name: '扣子 Coze',
    baseUrl: 'https://api.coze.cn/v3',
    model: '',
    hint: '从 coze.cn 控制台获取 API Key，模型留空即可',
  },
  {
    name: '豆包/火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-lite-260215',
    hint: '需要在火山方舟控制台创建推理接入点，填入 Endpoint ID 作为模型名',
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '从 deepseek.com 获取 API Key',
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '从阿里云百炼平台获取 API Key',
  },
];

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
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 从 localStorage 读取配置
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      }
    } catch {
      // ignore
    }
  }, []);

  const saveConfig = (newConfig: AIConfig) => {
    setConfig(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch {
      // ignore
    }
  };

  const canAnalyze =
    diffResults.length > 0 &&
    summary &&
    !disabled &&
    !isAnalyzing &&
    config.apiKey.trim().length > 0;

  const buildPrompt = (fileSummaries: string[]): string => {
    if (!summary) return '';
    const diffsJson = JSON.stringify(
      diffResults.map((r) => {
        if ('sheetName' in r) {
          // 表格比对结果
          return {
            type: 'sheet',
            sheetName: r.sheetName,
            totalOldRows: r.totalOldRows,
            totalNewRows: r.totalNewRows,
            addedRows: r.addedRows,
            removedRows: r.removedRows,
            modifiedRows: r.modifiedRows,
            modifiedDetails: r.rows
              .filter((row) => row.diffType === 'modified')
              .slice(0, 10)
              .map((row) => ({
                key: row.key,
                changes: row.cells
                  .filter((c) => c.diffType === 'modified')
                  .map((c) => ({
                    column: c.column,
                    old: c.oldValue,
                    new: c.newValue,
                  })),
              })),
          };
        } else {
          // 文档比对结果
          return {
            type: 'document',
            oldFileName: r.oldFileName,
            newFileName: r.newFileName,
            totalOldParagraphs: r.totalOldParagraphs,
            totalNewParagraphs: r.totalNewParagraphs,
            added: r.added,
            removed: r.removed,
            modified: r.modified,
          };
        }
      }),
    );

    return `你是一位专业的数据分析师。请分析以下文件比对结果，并给出专业的分析报告。

## 文件概览
${fileSummaries.join('\n')}

## 比对统计
- 比对文件数: ${summary.filesCompared}
- 总差异数: ${summary.totalDifferences}
- 新增: ${summary.added} 项
- 删除: ${summary.removed} 项
- 修改: ${summary.modified} 项

## 详细差异数据
${diffsJson}

## 分析要求
请按照以下结构输出分析报告（使用 Markdown 格式）：

### 一、整体概览
简要描述本次比对的整体情况和数据变化趋势。

### 二、关键差异分析
详细分析最重要的差异点，说明可能的原因和影响。

### 三、风险提示
指出数据变化中可能存在的风险和需要关注的问题。

### 四、优化建议
针对数据管理和质量控制给出具体建议。

### 五、行动建议
列出需要跟进处理的具体事项。

请用专业、简洁的语言输出，重点突出，条理清晰。`;
  };

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

      const prompt = buildPrompt(fileSummaries);

      // 前端直接调用 LLM API（OpenAI 兼容格式）
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: [
            {
              role: 'system',
              content:
                '你是一位资深数据分析师，擅长对比分析和给出专业建议。请用中文输出，结构清晰，重点突出。',
            },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          `API 调用失败 (${response.status})：${errText || '请检查 API Key 和配置'}`,
        );
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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const chunk = trimmed.slice(5).trim();
          if (chunk === '[DONE]') continue;

          try {
            const data = JSON.parse(chunk);
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              setAnalysisText((prev) => prev + content);
            }
          } catch {
            // 忽略解析错误
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
  }, [canAnalyze, summary, files, diffResults, config]);

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
              <Badge
                variant="secondary"
                className="text-xs font-normal animate-pulse"
              >
                分析中
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Dialog open={configOpen} onOpenChange={setConfigOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="API 设置"
                  className="h-8 w-8"
                >
                  <Settings className="w-4 h-4 text-slate-500" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>AI 分析配置</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>选择平台</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {PRESET_PROVIDERS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => {
                            setConfig({
                              ...config,
                              baseUrl: p.baseUrl,
                              model: p.model,
                            });
                          }}
                          className={`px-3 py-2 text-xs rounded-md border transition-colors ${
                            config.baseUrl === p.baseUrl
                              ? 'bg-slate-800 text-white border-slate-800'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="api-key">API Key</Label>
                    <Input
                      id="api-key"
                      type="password"
                      placeholder="请输入你的 API Key"
                      value={config.apiKey}
                      onChange={(e) =>
                        setConfig({ ...config, apiKey: e.target.value })
                      }
                    />
                    <p className="text-xs text-slate-500">
                      🔒 仅保存在你的浏览器本地，不会上传到任何服务器
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="base-url">API 地址</Label>
                    <Input
                      id="base-url"
                      placeholder="https://api.coze.cn/v3"
                      value={config.baseUrl}
                      onChange={(e) =>
                        setConfig({ ...config, baseUrl: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">模型名称 / Bot ID</Label>
                    <Input
                      id="model"
                      placeholder="Coze 平台可留空；其他平台填模型名"
                      value={config.model}
                      onChange={(e) =>
                        setConfig({ ...config, model: e.target.value })
                      }
                    />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                    <p className="font-medium mb-1">💡 使用说明</p>
                    <p>
                      支持扣子 Coze、豆包/火山方舟、DeepSeek、通义千问等 OpenAI 兼容格式。
                      选择对应平台后填入 API Key 即可使用。
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">取消</Button>
                  </DialogClose>
                  <Button
                    onClick={() => {
                      saveConfig(config);
                      setConfigOpen(false);
                    }}
                  >
                    保存
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
              AI 智能分析
            </h3>
            <p className="text-xs text-slate-500 mb-4 max-w-[220px]">
              深度解读文件差异，识别风险点，给出专业的分析建议
            </p>
            {!config.apiKey ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfigOpen(true)}
                className="gap-1"
              >
                <Settings className="w-3.5 h-3.5" />
                先配置 API Key
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleStartAnalysis}
                disabled={!canAnalyze || isAnalyzing}
                className="gap-1"
              >
                <Sparkles className="w-4 h-4" />
                开始分析
              </Button>
            )}
            {!canAnalyze && config.apiKey && diffResults.length === 0 && (
              <p className="text-xs text-slate-400 mt-3">
                请先完成文件比对后再分析
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {stats && (
              <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                <div className="bg-slate-50 rounded-lg py-2 px-1">
                  <div className="text-sm font-semibold text-slate-700 tabular-nums">
                    {stats.total}
                  </div>
                  <div className="text-[10px] text-slate-500">总差异</div>
                </div>
                <div className="bg-emerald-50 rounded-lg py-2 px-1">
                  <div className="text-sm font-semibold text-emerald-600 tabular-nums">
                    +{stats.added}
                  </div>
                  <div className="text-[10px] text-slate-500">新增</div>
                </div>
                <div className="bg-rose-50 rounded-lg py-2 px-1">
                  <div className="text-sm font-semibold text-rose-600 tabular-nums">
                    -{stats.removed}
                  </div>
                  <div className="text-[10px] text-slate-500">删除</div>
                </div>
                <div className="bg-amber-50 rounded-lg py-2 px-1">
                  <div className="text-sm font-semibold text-amber-600 tabular-nums">
                    ~{stats.modified}
                  </div>
                  <div className="text-[10px] text-slate-500">修改</div>
                </div>
              </div>
            )}
            <ScrollArea className="flex-1 rounded-lg border border-slate-200 bg-slate-50/50">
              <div className="p-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {analysisText || (
                  <span className="text-slate-400 italic">正在分析...</span>
                )}
                {isAnalyzing && (
                  <span className="inline-block w-1.5 h-4 bg-violet-500 ml-0.5 align-middle animate-pulse" />
                )}
              </div>
            </ScrollArea>
            {error && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-700">
                  <p className="font-medium mb-1">分析失败</p>
                  <p className="break-all">{error}</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-rose-600 text-xs"
                    onClick={() => setConfigOpen(true)}
                  >
                    检查 API 配置
                  </Button>
                </div>
              </div>
            )}
            <div className="mt-3 flex justify-center gap-2">
              {isAnalyzing ? (
                <Button variant="outline" size="sm" onClick={handleStop}>
                  <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                  停止分析
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleStartAnalysis}
                  disabled={!canAnalyze}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  重新分析
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
