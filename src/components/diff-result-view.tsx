'use client';

import { useState, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus, Sparkles,
  Search, AlertCircle, Shuffle,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { computeDiffStatistics } from '@/lib/file-utils';
import type { SheetDiffResult, DocumentDiffResult, DiffType, DiffStatistics } from '@/types';

interface DiffResultViewProps {
  results: Array<SheetDiffResult | DocumentDiffResult>;
  filter?: 'all' | DiffType;
  onFilterChange?: (f: 'all' | DiffType) => void;
}

const DIFF_FILTERS: Array<{ type: DiffType | 'all'; label: string; color: string; activeColor: string }> = [
  { type: 'all', label: '全部', color: 'bg-white border-slate-200 text-slate-600', activeColor: 'bg-slate-100 border-slate-300 text-slate-800' },
  { type: 'added', label: '新增', color: 'bg-white border-slate-200 text-slate-600', activeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { type: 'removed', label: '删除', color: 'bg-white border-slate-200 text-slate-600', activeColor: 'bg-red-50 text-red-700 border-red-200' },
  { type: 'modified', label: '修改', color: 'bg-white border-slate-200 text-slate-600', activeColor: 'bg-amber-50 text-amber-700 border-amber-200' },
  { type: 'suspected', label: '疑似', color: 'bg-white border-slate-200 text-slate-600', activeColor: 'bg-blue-50 text-blue-700 border-blue-200' },
];

export function DiffResultView({ results, filter: externalFilter, onFilterChange }: DiffResultViewProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Sparkles className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">暂无分析结果</p>
        <p className="text-xs mt-1">上传文件并点击「比对分析」查看差异</p>
      </div>
    );
  }

  const sheetResults = results.filter((r): r is SheetDiffResult => 'sheetName' in r);
  const docResults = results.filter((r): r is DocumentDiffResult => 'oldFileName' in r);

  return (
    <Tabs defaultValue={sheetResults.length > 0 ? 'sheet' : 'document'}>
      <TabsList className="mb-4">
        {sheetResults.length > 0 && (
          <TabsTrigger value="sheet">表格比对 ({sheetResults.length})</TabsTrigger>
        )}
        {docResults.length > 0 && (
          <TabsTrigger value="document">文档比对 ({docResults.length})</TabsTrigger>
        )}
      </TabsList>

      {sheetResults.length > 0 && (
        <TabsContent value="sheet" className="space-y-6">
          {sheetResults.map((result, idx) => (
            <SheetDiffCard key={idx} result={result} filter={externalFilter} onFilterChange={onFilterChange} />
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

// ─── 汇总统计面板 ─────────────────────────────────────────

function SummaryPanel({ stats }: { stats: DiffStatistics }) {
  const total = stats.addedCount + stats.removedCount + stats.modifiedCount + stats.suspectedCount + stats.unchangedCount;
  const segments = [
    { label: '新增', count: stats.addedCount, color: 'bg-emerald-500' },
    { label: '删除', count: stats.removedCount, color: 'bg-red-500' },
    { label: '修改', count: stats.modifiedCount, color: 'bg-amber-500' },
    { label: '疑似', count: stats.suspectedCount, color: 'bg-blue-500' },
    { label: '未变', count: stats.unchangedCount, color: 'bg-slate-300' },
  ];

  return (
    <div className="space-y-4">
      {/* 变更类型分布条 */}
      <div>
        <h4 className="text-xs font-medium text-slate-500 mb-2">变更类型分布</h4>
        <div className="flex h-4 rounded-full overflow-hidden bg-slate-100">
          {segments.map((s) => (
            s.count > 0 && (
              <div
                key={s.label}
                className={cn('h-full transition-all', s.color)}
                style={{ width: `${(s.count / total) * 100}%` }}
                title={`${s.label}: ${s.count}`}
              />
            )
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-2">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs text-slate-600">
              <div className={cn('w-2.5 h-2.5 rounded-full', s.color)} />
              {s.label} {s.count}
            </div>
          ))}
        </div>
      </div>

      {/* 字段变更热点 */}
      {stats.fieldHotspots.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-slate-500 mb-2">字段变更热点</h4>
          <div className="space-y-1.5">
            {stats.fieldHotspots.slice(0, 5).map((h) => {
              const maxCount = stats.fieldHotspots[0].changeCount;
              return (
                <div key={h.column} className="flex items-center gap-2">
                  <span className="text-xs text-slate-700 w-24 truncate font-medium">{h.column}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all"
                      style={{ width: `${(h.changeCount / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums w-16 text-right">
                    {h.changeCount} 次 ({(h.changeRate * 100).toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 数值字段增减 */}
      {stats.numericSummaries.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-slate-500 mb-2">数值字段变化</h4>
          <div className="space-y-2">
            {stats.numericSummaries.slice(0, 3).map((ns) => (
              <div key={ns.column} className="rounded-lg border border-slate-150 bg-slate-50/50 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700">{ns.column}</span>
                  <span className={cn(
                    'text-xs font-semibold tabular-nums',
                    ns.changePercent > 0 ? 'text-emerald-600' : ns.changePercent < 0 ? 'text-red-600' : 'text-slate-500',
                  )}>
                    {ns.changePercent >= 0 ? '+' : ''}{ns.changePercent.toFixed(2)}%
                  </span>
                </div>
                <div className="text-xs text-slate-500 tabular-nums">
                  {ns.oldSum.toLocaleString()} → {ns.newSum.toLocaleString()}
                </div>
                {ns.topChanges.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {ns.topChanges.slice(0, 3).map((tc) => (
                      <div key={tc.key} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 truncate max-w-24">{tc.key}</span>
                        <span className={cn('tabular-nums', tc.change > 0 ? 'text-emerald-600' : 'text-red-600')}>
                          {tc.change >= 0 ? '+' : ''}{tc.change.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 表格比对卡片 ─────────────────────────────────────────

function SheetDiffCard({ result, filter: externalFilter, onFilterChange }: {
  result: SheetDiffResult;
  filter?: 'all' | DiffType;
  onFilterChange?: (f: 'all' | DiffType) => void;
}) {
  const [internalFilter, setInternalFilter] = useState<DiffType | 'all'>('all');
  const filter = externalFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const isZeroMatch = (result.matchQuality?.matchRate ?? 1) === 0;
  const [collapsed, setCollapsed] = useState(isZeroMatch);

  const stats = useMemo(() => computeDiffStatistics(result), [result]);

  const filteredRows = useMemo(() => {
    let rows = result.rows;
    if (filter !== 'all') {
      rows = rows.filter((r) => r.diffType === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.key.toLowerCase().includes(q) ||
        r.cells.some((c) =>
          String(c.oldValue ?? '').toLowerCase().includes(q) ||
          String(c.newValue ?? '').toLowerCase().includes(q) ||
          c.column.toLowerCase().includes(q)
        )
      );
    }
    // 差异优先排序：修改 > 新增 > 删除 > 疑似 > 未变
    const priority: Record<string, number> = { modified: 0, added: 1, removed: 2, suspected: 3, unchanged: 4 };
    return [...rows].sort((a, b) => (priority[a.diffType] ?? 5) - (priority[b.diffType] ?? 5));
  }, [result.rows, filter, search]);

  const toggleRow = (rowKey: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey); else next.add(rowKey);
      return next;
    });
  };

  const statCounts = [
    { label: '新增', value: result.addedRows, type: 'added' as DiffType, icon: TrendingUp },
    { label: '删除', value: result.removedRows, type: 'removed' as DiffType, icon: TrendingDown },
    { label: '修改', value: result.modifiedRows, type: 'modified' as DiffType, icon: Minus },
    { label: '疑似', value: result.suspectedRows, type: 'suspected' as DiffType, icon: Shuffle },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* 头部 */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{result.sheetName}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              主键列: {result.keyColumn} · 原表 {result.totalOldRows} 行 → 新表 {result.totalNewRows} 行
              {result.duplicateKeyCount > 0 && (
                <span className="ml-1 text-amber-600">
                  · 主键存在 {result.duplicateKeyCount} 处重复值
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-1.5">
            {statCounts.map((s) => (
              <button
                key={s.type}
                onClick={() => setFilter(filter === s.type ? 'all' : s.type)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  filter === s.type
                    ? s.type === 'added' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : s.type === 'removed' ? 'bg-red-50 text-red-700 border-red-200'
                      : s.type === 'modified' ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <s.icon className="h-3 w-3" />
                {s.label}: {s.value}
              </button>
            ))}
          </div>
        </div>

        {/* 搜索栏 */}
        <div className="mt-3 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="搜索主键、列名或值..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-white"
          />
        </div>

        {/* 列映射提示 */}
        {result.columnMappings.some((m) => m.oldColumn !== m.newColumn) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.columnMappings.filter((m) => m.oldColumn !== m.newColumn).map((m) => (
              <span key={m.oldColumn} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px]">
                {m.oldColumn} ≈ {m.newColumn}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 0% 匹配强提示 */}
      {isZeroMatch && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          匹配率为 0%，请检查主键列选择是否正确
        </div>
      )}

      {/* 汇总统计 */}
      {!collapsed && (
      <>
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/30">
        <SummaryPanel stats={stats} />
      </div>

      {/* 差异表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="w-8 py-2.5 px-3 text-left" />
              <th className="py-2.5 px-3 text-left text-xs font-medium text-slate-500">状态</th>
              {result.headers.slice(0, 8).map((h) => (
                <th key={h} className="py-2.5 px-3 text-left text-xs font-medium text-slate-500">{h}</th>
              ))}
              {result.headers.length > 8 && (
                <th className="py-2.5 px-3 text-left text-xs font-medium text-slate-500">...</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.slice(0, 200).map((row) => {
              const isExpanded = expandedRows.has(`${row.key}-${row.rowIndex}`);
              const rowColors: Record<DiffType, string> = {
                added: 'bg-emerald-50/30 hover:bg-emerald-50/60',
                removed: 'bg-red-50/30 hover:bg-red-50/60',
                modified: 'bg-amber-50/30 hover:bg-amber-50/60',
                unchanged: 'hover:bg-slate-50',
                suspected: 'bg-blue-50/30 hover:bg-blue-50/60',
              };

              return (
                <DiffTableRow
                  key={`${row.key}-${row.rowIndex}`}
                  row={row}
                  isExpanded={isExpanded}
                  onToggle={() => toggleRow(`${row.key}-${row.rowIndex}`)}
                  rowColors={rowColors}
                  headers={result.headers}
                />
              );
            })}
          </tbody>
        </table>
        {filteredRows.length > 200 && (
          <div className="py-3 text-center text-xs text-slate-400 border-t border-slate-100">
            仅显示前 200 行，共 {filteredRows.length} 行
          </div>
        )}
        {filteredRows.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">没有符合筛选条件的行</div>
        )}
      </div>
      </>
      )}

      {/* 折叠/展开切换 */}
      {isZeroMatch && (
        <div className="px-5 py-3 border-t border-slate-100 text-center">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            {collapsed ? '展开差异明细' : '折叠差异明细'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 差异表格行 ─────────────────────────────────────────

function DiffTableRow({ row, isExpanded, onToggle, rowColors, headers }: {
  row: import('@/types').RowDiff;
  isExpanded: boolean;
  onToggle: () => void;
  rowColors: Record<DiffType, string>;
  headers: string[];
}) {
  const hasModifiedCells = row.cells.filter((c) => c.diffType === 'modified').length > 0;
  const showExpand = row.diffType !== 'unchanged' && hasModifiedCells;

  return (
    <>
      <tr
        className={cn('border-b border-slate-100 transition-colors cursor-pointer', rowColors[row.diffType])}
        onClick={onToggle}
      >
        <td className="py-2 px-3">
          {showExpand && (
            isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </td>
        <td className="py-2 px-3">
          <RowBadge type={row.diffType} similarity={row.similarity} />
        </td>
        {row.cells.slice(0, 8).map((cell) => (
          <td
            key={cell.column}
            className={cn('py-2 px-3 font-mono tabular-nums text-sm', getCellClass(cell))}
          >
            <CellDisplay cell={cell} rowType={row.diffType} />
          </td>
        ))}
        {headers.length > 8 && <td className="py-2 px-3 text-slate-400">...</td>}
      </tr>
      {isExpanded && showExpand && (
        <tr className="bg-slate-50/80">
          <td colSpan={Math.min(headers.length, 8) + 2} className="py-3 px-6">
            {row.diffType === 'suspected' && row.matchReason && (
              <div className="flex items-center gap-1.5 mb-2 text-xs text-blue-600">
                <AlertCircle className="h-3 w-3" />
                匹配理由: {row.matchReason}
                {row.similarity !== undefined && ` (相似度 ${(row.similarity * 100).toFixed(0)}%)`}
              </div>
            )}
            <div className="space-y-1.5">
              {row.cells.filter((c) => c.diffType === 'modified').map((cell) => (
                <div key={cell.column} className="flex items-start gap-4 text-xs">
                  <span className="font-medium text-slate-600 min-w-20">{cell.column}:</span>
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
}

function getCellClass(cell: import('@/types').CellDiff): string {
  switch (cell.diffType) {
    case 'modified': return 'bg-amber-100/50 font-medium text-amber-900';
    case 'added': return 'text-emerald-700';
    case 'removed': return 'text-red-600 line-through';
    default: return 'text-slate-700';
  }
}

function CellDisplay({ cell, rowType }: { cell: import('@/types').CellDiff; rowType: DiffType }) {
  if (rowType === 'added') return <>{formatCellValue(cell.newValue)}</>;
  if (rowType === 'removed') return <>{formatCellValue(cell.oldValue)}</>;
  if (cell.diffType === 'modified') {
    return (
      <div className="space-y-0.5">
        <div className="text-red-600 line-through text-xs opacity-70">{formatCellValue(cell.oldValue)}</div>
        <div className="text-emerald-700 font-medium text-xs">{formatCellValue(cell.newValue)}</div>
      </div>
    );
  }
  return <>{formatCellValue(cell.newValue)}</>;
}

// ─── 文档比对卡片 ─────────────────────────────────────────

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
              原文档 {result.totalOldParagraphs} 段 → 新文档 {result.totalNewParagraphs} 段
            </p>
          </div>
          <div className="flex gap-2">
            {DIFF_FILTERS.map((f) => (
              <Badge
                key={f.type}
                variant="outline"
                className={cn('cursor-pointer text-xs', filter === f.type ? f.activeColor : f.color)}
                onClick={() => setFilter(filter === f.type ? 'all' : f.type)}
              >
                {f.label}
              </Badge>
            ))}
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
            suspected: 'bg-blue-50/50',
          };
          return (
            <div key={idx} className={cn('p-4', bgColors[item.diffType])}>
              <div className="flex items-start gap-3">
                <RowBadge type={item.diffType} />
                <div className="flex-1 space-y-1.5 min-w-0">
                  {item.oldText && item.diffType !== 'added' && (
                    <p className={cn('text-sm',
                      item.diffType === 'modified' ? 'text-red-600 line-through' : item.diffType === 'removed' ? 'text-red-700' : 'text-slate-700',
                    )}>{item.oldText}</p>
                  )}
                  {item.newText && item.diffType !== 'removed' && (
                    <p className={cn('text-sm',
                      item.diffType === 'modified' ? 'text-emerald-700' : item.diffType === 'added' ? 'text-emerald-700' : 'text-slate-700',
                    )}>{item.newText}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {filteredItems.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">没有符合筛选条件的内容</div>
        )}
      </div>
    </div>
  );
}

// ─── 通用组件 ─────────────────────────────────────────

function RowBadge({ type, similarity }: { type: DiffType; similarity?: number }) {
  const styles: Record<DiffType, string> = {
    added: 'bg-emerald-100 text-emerald-700',
    removed: 'bg-red-100 text-red-700',
    modified: 'bg-amber-100 text-amber-700',
    unchanged: 'bg-slate-100 text-slate-600',
    suspected: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<DiffType, string> = {
    added: '新增',
    removed: '删除',
    modified: '修改',
    unchanged: '不变',
    suspected: '疑似',
  };

  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', styles[type])}>
      {labels[type]}
      {type === 'suspected' && similarity !== undefined && (
        <span className="ml-1 text-[10px] opacity-70">{(similarity * 100).toFixed(0)}%</span>
      )}
    </span>
  );
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}
