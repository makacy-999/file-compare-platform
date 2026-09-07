import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import {
  arrayToSheetData,
  getFileType,
} from '@/lib/file-utils';
import type { ParsedData, SheetData, ParagraphData } from '@/types';

async function parsePdfText(buffer: Buffer): Promise<{ text: string; numpages: number; info: unknown }> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const info = await parser.getInfo();
  return {
    text: result.text,
    numpages: Array.isArray(result.pages) ? result.pages.length : (info as { numpages?: number })?.numpages || 1,
    info,
  };
}

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: '未接收到文件' },
        { status: 400 },
      );
    }

    const results: {
      fileName: string;
      fileType: string;
      size: number;
      success: boolean;
      data?: ParsedData;
      error?: string;
    }[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        results.push({
          fileName: file.name,
          fileType: 'other',
          size: file.size,
          success: false,
          error: '文件过大，最大支持 50MB',
        });
        continue;
      }

      const fileType = getFileType(file.name, file.type);
      const buffer = Buffer.from(await file.arrayBuffer());

      try {
        let data: ParsedData = {
          fileName: file.name,
          metadata: {
            size: file.size,
            type: file.type,
          },
        };

        if (fileType === 'excel') {
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          const sheets: SheetData[] = [];

          for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, {
              header: 1,
              defval: '',
            }) as unknown[][];
            const sheetData = arrayToSheetData(sheetName, jsonData);
            sheets.push(sheetData);
          }

          data.sheets = sheets;
        } else if (fileType === 'word') {
          const result = await mammoth.extractRawText({ buffer });
          const paragraphs: ParagraphData[] = (result.value as string)
            .split(/\n\n+/)
            .filter((p: string) => p.trim().length > 0)
            .map((text: string, idx: number) => ({
              text: text.trim(),
              index: idx,
            }));
          data.paragraphs = paragraphs;
          data.textContent = result.value;
        } else if (fileType === 'pdf') {
          const pdfResult = await parsePdfText(buffer);
          const paragraphs: ParagraphData[] = String(pdfResult.text)
            .split(/\n\n+/)
            .filter((p: string) => p.trim().length > 0)
            .map((text: string, idx: number) => ({
              text: text.trim(),
              index: idx,
            }));
          data.paragraphs = paragraphs;
          data.textContent = pdfResult.text;
          data.metadata = {
            ...data.metadata,
            pages: pdfResult.numpages,
            info: JSON.stringify(pdfResult.info),
          };
        } else if (fileType === 'image') {
          data.textContent = `[图片文件: ${file.name}]`;
          data.metadata = {
            ...data.metadata,
            format: fileType,
          };
        } else {
          data.textContent = `[不支持解析的文件格式: ${file.name}]`;
        }

        results.push({
          fileName: file.name,
          fileType,
          size: file.size,
          success: true,
          data,
        });
      } catch (err) {
        results.push({
          fileName: file.name,
          fileType,
          size: file.size,
          success: false,
          error: err instanceof Error ? err.message : '解析失败',
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('文件解析失败:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '服务器错误' },
      { status: 500 },
    );
  }
}
