import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import type { Message } from 'coze-coding-dev-sdk';
import type { AnalysisResult, AnalysisSummary } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      fileSummaries,
      diffResults,
      summary,
    }: {
      fileSummaries: string[];
      diffResults: AnalysisResult[];
      summary: AnalysisSummary;
    } = body;

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 构造差异分析摘要文本
    let diffText = '';
    for (const result of diffResults) {
      if ('sheetName' in result) {
        diffText += `\n【表格比对 - ${result.sheetName}】\n`;
        diffText += `主键列: ${result.keyColumn}\n`;
        diffText += `原表 ${result.totalOldRows} 行 → 新表 ${result.totalNewRows} 行\n`;
        diffText += `新增 ${result.addedRows} 行 / 删除 ${result.removedRows} 行 / 修改 ${result.modifiedRows} 行\n`;

        // 只取前 20 条差异行作为示例
        const diffRows = result.rows.filter(
          (r) => r.diffType !== 'unchanged',
        ).slice(0, 20);
        diffText += `差异示例 (共${result.rows.filter((r) => r.diffType !== 'unchanged').length}条，仅展示前20条):\n`;
        for (const row of diffRows) {
          const changedCells = row.cells.filter((c) => c.diffType !== 'unchanged');
          const changes = changedCells
            .map(
              (c) =>
                `${c.column}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`,
            )
            .join('; ');
          diffText += `  [${row.diffType}] 行"${row.key}": ${changes.substring(0, 200)}\n`;
        }
      } else if ('oldFileName' in result) {
        diffText += `\n【文档比对 - ${result.oldFileName} vs ${result.newFileName}】\n`;
        diffText += `原 ${result.totalOldParagraphs} 段 → 新 ${result.totalNewParagraphs} 段\n`;
        diffText += `新增 ${result.added} 段 / 删除 ${result.removed} 段 / 修改 ${result.modified} 段\n`;
        const diffItems = result.items
          .filter((i) => i.diffType !== 'unchanged')
          .slice(0, 10);
        diffText += '差异示例:\n';
        for (const item of diffItems) {
          diffText += `  [${item.diffType}] 原: "${(item.oldText || '').substring(0, 80)}" → 新: "${(item.newText || '').substring(0, 80)}"\n`;
        }
      }
    }

    const systemPrompt = `你是一位专业的数据分析师，擅长文件比对和数据分析。
你的任务是：基于用户上传的文件及其比对结果，进行深度分析并给出专业建议。

分析要求：
1. 用结构化的方式呈现分析结果
2. 重点关注数据差异背后的业务含义
3. 给出具体、可执行的建议
4. 用中文回复，语言专业但易懂
5. 适当使用 emoji 分隔不同板块，提升可读性

输出结构建议：
📊 **整体概览**
- 简要总结比对情况

🔍 **关键差异分析**
- 列出最值得关注的 3-5 个差异点
- 分析可能的原因

⚠️ **风险提示**
- 数据不一致可能带来的风险

💡 **优化建议**
- 针对发现的问题给出具体建议

✅ **后续行动建议**
- 用户接下来可以做什么`;

    const userContent = `以下是文件比对分析的数据，请基于这些数据进行专业分析：

【文件信息】
${fileSummaries.join('\n\n')}

【比对摘要】
- 比对文件数：${summary.filesCompared}
- 差异总数：${summary.totalDifferences}
- 新增：${summary.added}
- 删除：${summary.removed}
- 修改：${summary.modified}
- 比对类型：${summary.comparisonType}

【详细差异】${diffText}

请进行深度分析，并给出专业建议。`;

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const stream = client.stream(messages, {
      model: 'doubao-seed-2-0-lite-260215',
      temperature: 0.7,
    });

    // 构造 SSE 响应
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              const data = JSON.stringify({ content: text });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          console.error('AI 分析流错误:', err);
          const errorData = JSON.stringify({
            error: err instanceof Error ? err.message : '分析出错',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    console.error('AI 分析失败:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '服务器错误' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
