'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SheetDiffResult, DocumentDiffResult, DiffType } from '@/types';

interface DiffResultViewProps {
  results: Array<SheetDiffResult | DocumentDiffResult>;
}

export function DiffResultView({ results }: DiffResultViewProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Sparkles className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">暂无分析结果</p>
        <p className="text-xs mt-1">上传文件并点击"比对分析"查看差异</p>
      </div>
    );
  }

  const sheetResults = results.filter(
    (r): r is SheetDiffResult => 'sheetName' in r,
  );
  const docResults = results.filter(
    (r): r is DocumentDiffResult => 'oldFileName' in r,
  );

  return (
    <Tabs defaultValue={sheetResults.length > 0 ? 'sheet' : 'document'}>
      <TabsList className="mb-4">
        {sheetResults.length > 0 && (
          <TabsTrigger value="sheet">
            表格比对 ({sheetResults.length})
          </TabsTrigger>
        )}
        {docResults.length > 0 && (
          <TabsTrigger value="document">
            文档比对 ({docResults.length})
          </TabsTrigger>
        )}
      </TabsList>

      {sheetResults.length > 0 && (
        <TabsContent value="sheet" className="space-y-6">
          {sheetResults.map((result, idx) => (
            <SheetDiffCard key={idx} result={result} />
          ))}
        </TabsContent>
      )}

      {docResults.length > 0 && (
        <TabsContent value="document" className="space-y-6">
          {docResults.map((result, idx) => (
            <DocumentDiffCard key={idx} result={result} />
          ))}
        </TabsContent>
      )}
    </Tabs>
  );
}

function SheetDiffCard({ result }: { result: SheetDiffResult }) {
  const [filter, setFilter] = useState<DiffType | 'all'>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => {
    if (filter === 'all') return result.rows;
    return result.rows.filter((r) => r.diffType === filter);
  }, [result.rows, filter]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const statBadges = [
    { label: '新增', value: result.addedRows, type: 'added' as DiffType, icon: TrendingUp, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { label: '删除', value: result.removedRows, type: 'removed' as DiffType, icon: TrendingDown, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: '修改', value: result.modifiedRows, type: 'modified' as DiffType, icon: Minus, color: 'bg-amber-50 text-amber-700 border-amber-200' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* 头部 */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {result.sheetName}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              主键列: {result.keyColumn} · 原表 {result.totalOldRows} 行 → 新表{' '}
              {result.totalNewRows} 行
            </p>
          </div>
          <div className="flex gap-2">
            {statBadges.map((s) => (
              <button
                key={s.type}
                onClick={() => setFilter(filter === s.type ? 'all' : s.type)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  filter === s.type ? s.color : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <s.icon className="h-3.5 w-3.5" />
                {s.label}: {s.value}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="w-8 py-2.5 px-3 text-left"></th>
              <th className="py-2.5 px-3 text-left text-xs font-medium text-slate-500">
                状态
              </th>
              {result.headers.slice(0, 6).map((h) => (
                <th
                  key={h}
                  className="py-2.5 px-3 text-left text-xs font-medium text-slate-500"
                >
                  {h}
                </th>
              ))}
              {result.headers.length > 6 && (
                <th className="py-2.5 px-3 text-left text-xs font-medium text-slate-500">
                  ...
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.slice(0, 100).map((row) => {
              const isExpanded = expandedRows.has(row.key);
              const rowColors: Record<DiffType, string> = {
                added: 'bg-emerald-50/30 hover:bg-emerald-50/60',
                removed: 'bg-red-50/30 hover:bg-red-50/60',
                modified: 'bg-amber-50/30 hover:bg-amber-50/60',
                unchanged: 'hover:bg-slate-50',
              };

              return (
                <>
                  <tr
                    key={row.key}
                    className={cn(
                      'border-b border-slate-100 transition-colors cursor-pointer',
                      rowColors[row.diffType],
                    )}
                    onClick={() => toggleRow(row.key)}
                  >
                    <td className="py-2 px-3">
                      {row.diffType !== 'unchanged' &&
                      row.cells.filter((c) => c.diffType === 'modified').length > 1 ? (
                        isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        )
                      ) : null}
                    </td>
                    <td className="py-2 px-3">
                      <RowBadge type={row.diffType} />
                    </td>
                    {row.cells.slice(0, 6).map((cell) => (
                      <td
                        key={cell.column}
                        className={cn(
                          'py-2 px-3 font-mono tabular-nums',
                          cell.diffType === 'modified'
                            ? 'bg-amber-100/50 font-medium text-amber-900'
                            : 'text-slate-700',
                        )}
                      >
                        {formatCellValue(
                          row.diffType === 'removed' ? cell.oldValue : cell.newValue,
                        )}
                      </td>
                    ))}
                    {result.headers.length > 6 && (
                      <td className="py-2 px-3 text-slate-400">...</td>
                    )}
                  </tr>
                  {isExpanded && row.diffType === 'modified' && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={Math.min(result.headers.length, 6) + 2} className="py-3 px-6">
                        <div className="space-y-1.5">
                          {row.cells
                            .filter((c) => c.diffType === 'modified')
                            .map((cell) => (
                              <div
                                key={cell.column}
                                className="flex items-start gap-4 text-xs"
                              >
                                <span className="font-medium text-slate-600 min-w-20">
                                  {cell.column}:
                                </span>
                                <div className="flex items-center gap-3 flex-1">
                                  <span className="flex-1 px-2 py-1 rounded bg-red-100 text-red-700 line-through">
                                    {formatCellValue(cell.oldValue)}
                                  </span>
                                  <span className="text-slate-400">→</span>
                                  <span className="flex-1 px-2 py-1 rounded bg-emerald-100 text-emerald-700">
                                    {formatCellValue(cell.newValue)}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        {filteredRows.length > 100 && (
          <div className="py-3 text-center text-xs text-slate-400 border-t border-slate-100">
            仅显示前 100 行，共 {filteredRows.length} 行
          </div>
        )}
        {filteredRows.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">
            没有符合筛选条件的行
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentDiffCard({ result }: { result: DocumentDiffResult }) {
  const [filter, setFilter] = useState<DiffType | 'all'>('all');

  const filteredItems = useMemo(() => {
    if (filter === 'all') return result.items;
    return result.items.filter((i) => i.diffType === filter);
  }, [result.items, filter]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {result.oldFileName} ↔ {result.newFileName}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              原文档 {result.totalOldParagraphs} 段 → 新文档{' '}
              {result.totalNewParagraphs} 段
            </p>
          </div>
          <div className="flex gap-2">
            <Badge
              variant="outline"
              className={cn(
                filter === 'all' ? 'bg-slate-100' : 'bg-white cursor-pointer',
              )}
              onClick={() => setFilter('all')}
            >
              全部
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'cursor-pointer bg-emerald-50 text-emerald-700 border-emerald-200',
                filter === 'added' ? 'bg-emerald-100' : '',
              )}
              onClick={() => setFilter(filter === 'added' ? 'all' : 'added')}
            >
              新增 {result.added}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'cursor-pointer bg-red-50 text-red-700 border-red-200',
                filter === 'removed' ? 'bg-red-100' : '',
              )}
              onClick={() => setFilter(filter === 'removed' ? 'all' : 'removed')}
            >
              删除 {result.removed}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'cursor-pointer bg-amber-50 text-amber-700 border-amber-200',
                filter === 'modified' ? 'bg-amber-100' : '',
              )}
              onClick={() => setFilter(filter === 'modified' ? 'all' : 'modified')}
            >
              修改 {result.modified}
            </Badge>
          </div>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
        {filteredItems.map((item, idx) => {
          const bgColors: Record<DiffType, string> = {
            added: 'bg-emerald-50/50',
            removed: 'bg-red-50/50',
            modified: 'bg-amber-50/50',
            unchanged: 'bg-white',
          };

          return (
            <div key={idx} className={cn('p-4', bgColors[item.diffType])}>
              <div className="flex items-start gap-3">
                <RowBadge type={item.diffType} />
                <div className="flex-1 space-y-1.5 min-w-0">
                  {item.oldText && item.diffType !== 'added' && (
                    <p
                      className={cn(
                        'text-sm',
                        item.diffType === 'modified'
                          ? 'text-red-600 line-through'
                          : item.diffType === 'removed'
                            ? 'text-red-700'
                            : 'text-slate-700',
                      )}
                    >
                      {item.oldText}
                    </p>
                  )}
                  {item.newText && item.diffType !== 'removed' && (
                    <p
                      className={cn(
                        'text-sm',
                        item.diffType === 'modified'
                          ? 'text-emerald-700'
                          : item.diffType === 'added'
                            ? 'text-emerald-700'
                            : 'text-slate-700',
                      )}
                    >
                      {item.newText}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filteredItems.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">
            没有符合筛选条件的内容
          </div>
        )}
      </div>
    </div>
  );
}

function RowBadge({ type }: { type: DiffType }) {
  const styles: Record<DiffType, string> = {
    added: 'bg-emerald-100 text-emerald-700',
    removed: 'bg-red-100 text-red-700',
    modified: 'bg-amber-100 text-amber-700',
    unchanged: 'bg-slate-100 text-slate-600',
  };

  const labels: Record<DiffType, string> = {
    added: '新增',
    removed: '删除',
    modified: '修改',
    unchanged: '不变',
  };

  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', styles[type])}>
      {labels[type]}
    </span>
  );
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}
