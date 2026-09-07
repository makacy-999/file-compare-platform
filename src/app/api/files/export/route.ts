import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { SheetDiffResult, DocumentDiffResult } from '@/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      diffResults,
      summary,
      format = 'xlsx',
      fileName = 'analysis-result',
    } = body as {
      diffResults: Array<SheetDiffResult | DocumentDiffResult>;
      summary?: {
        filesCompared: number;
        totalDifferences: number;
        added: number;
        removed: number;
        modified: number;
      };
      format?: 'xlsx' | 'csv';
      fileName?: string;
    };

    if (!diffResults || diffResults.length === 0) {
      return NextResponse.json(
        { error: '没有可导出的数据' },
        { status: 400 },
      );
    }

    const workbook = XLSX.utils.book_new();

    // 汇总 sheet
    if (summary) {
      const summaryData = [
        ['文件比对分析报告'],
        [],
        ['比对文件数', summary.filesCompared],
        ['差异总数', summary.totalDifferences],
        ['新增行数', summary.added],
        ['删除行数', summary.removed],
        ['修改行数', summary.modified],
        ['生成时间', new Date().toLocaleString('zh-CN')],
      ];
      const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summaryWs, '分析摘要');
    }

    // 每个比对结果一个 sheet
    diffResults.forEach((result, idx) => {
      if ('sheetName' in result) {
        // Excel 表格比对结果
        const sheetData: unknown[][] = [];
        sheetData.push([
          `工作表: ${result.sheetName}  |  主键列: ${result.keyColumn}`,
        ]);
        sheetData.push([
          `原表行数: ${result.totalOldRows}  |  新表行数: ${result.totalNewRows}`,
        ]);
        sheetData.push([
          `新增: ${result.addedRows}  |  删除: ${result.removedRows}  |  修改: ${result.modifiedRows}  |  不变: ${result.unchangedRows}`,
        ]);
        sheetData.push([]);

        const headers = ['行状态', ...result.headers];
        sheetData.push(headers);

        for (const row of result.rows) {
          const statusMap: Record<string, string> = {
            added: '新增',
            removed: '删除',
            modified: '修改',
            unchanged: '不变',
          };
          const rowData = [statusMap[row.diffType] || row.diffType];
          for (const cell of row.cells) {
            const val = cell.newValue !== undefined ? cell.newValue : cell.oldValue;
            rowData.push(String(val ?? ''));
          }
          sheetData.push(rowData);
        }

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const sheetName = `比对${idx + 1}_${result.sheetName.substring(0, 20)}`;
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      } else if ('type' in result) {
        // 文档比对结果
        const sheetData: unknown[][] = [];
        sheetData.push([
          `文档比对: ${result.oldFileName} vs ${result.newFileName}`,
        ]);
        sheetData.push([
          `原段落数: ${result.totalOldParagraphs}  |  新段落数: ${result.totalNewParagraphs}`,
        ]);
        sheetData.push([
          `新增: ${result.added}  |  删除: ${result.removed}  |  修改: ${result.modified}`,
        ]);
        sheetData.push([]);
        sheetData.push(['状态', '原文', '新文']);

        for (const item of result.items) {
          const statusMap: Record<string, string> = {
            added: '新增',
            removed: '删除',
            modified: '修改',
            unchanged: '不变',
          };
          sheetData.push([
            statusMap[item.diffType] || item.diffType,
            item.oldText || '',
            item.newText || '',
          ]);
        }

        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        const sheetName = `文档比对${idx + 1}`;
        XLSX.utils.book_append_sheet(workbook, ws, sheetName.substring(0, 31));
      }
    });

    if (format === 'csv') {
      // 导出第一个 sheet 的 CSV
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(firstSheet);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}.csv"`,
        },
      });
    }

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    return new NextResponse(excelBuffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('导出失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '导出失败' },
      { status: 500 },
    );
  }
}
