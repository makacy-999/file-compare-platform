'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import {
  formatFileSize,
  getFileIcon,
  getFileType,
  generateId,
  arrayToSheetData,
} from '@/lib/file-utils';
import type { UploadedFile, ParsedData, SheetData, ParagraphData } from '@/types';

interface FileUploadProps {
  files?: UploadedFile[];
  onFilesChange?: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  onFilesAdded?: (files: File[]) => void;
  multiple?: boolean;
}

const ACCEPTED_TYPES =
  '.xlsx,.xls,.csv,.ods,.docx,.doc,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg,.tiff';

export function FileUpload({ files, onFilesChange, onFilesAdded, multiple = true }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const parseExcelFile = async (file: File): Promise<ParsedData> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
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

    if (sheets.length === 0) {
      throw new Error('未找到有效工作表数据');
    }

    return {
      fileName: file.name,
      sheets,
      metadata: { size: file.size, type: file.type },
    };
  };

  const parseWordFile = async (file: File): Promise<ParsedData> => {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const paragraphs: ParagraphData[] = result.value
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 0)
      .map((text, idx) => ({
        text: text.trim(),
        index: idx,
      }));

    return {
      fileName: file.name,
      paragraphs,
      textContent: result.value,
      metadata: { size: file.size, type: file.type },
    };
  };

  const parsePdfFile = async (file: File): Promise<ParsedData> => {
    const pdfjsLib = await import('pdfjs-dist');
    // 配置 worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => {
          // @ts-expect-error pdfjs types
          return item.str || '';
        })
        .join(' ');
      fullText += pageText + '\n\n';
    }

    const paragraphs: ParagraphData[] = fullText
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 0)
      .map((text, idx) => ({
        text: text.trim(),
        index: idx,
      }));

    return {
      fileName: file.name,
      paragraphs,
      textContent: fullText,
      metadata: { size: file.size, type: file.type, pages: totalPages },
    };
  };

  const parseImageFile = async (file: File): Promise<ParsedData> => {
    return {
      fileName: file.name,
      textContent: `[图片文件: ${file.name}]`,
      metadata: { size: file.size, type: file.type, format: 'image' },
    };
  };

  const parseFile = async (file: File): Promise<ParsedData> => {
    const fileType = getFileType(file.name, file.type);

    switch (fileType) {
      case 'excel':
        return parseExcelFile(file);
      case 'word':
        return parseWordFile(file);
      case 'pdf':
        return parsePdfFile(file);
      case 'image':
        return parseImageFile(file);
      default:
        return {
          fileName: file.name,
          textContent: `[不支持的格式: ${file.name}]`,
          metadata: { size: file.size, type: file.type },
        };
    }
  };

  const parseFiles = async (fileList: FileList | File[]) => {
    const fileArray = Array.from(fileList);

    if (onFilesAdded) {
      onFilesAdded(fileArray);
      return;
    }

    const newFiles: UploadedFile[] = fileArray.map((file) => ({
      id: generateId(),
      name: file.name,
      size: file.size,
      type: getFileType(file.name, file.type),
      mimeType: file.type,
      uploadedAt: new Date(),
      status: 'pending' as const,
    }));

    // 使用本地变量维护状态，避免闭包捕获旧值
    let currentFiles = [...newFiles];
    onFilesChange?.((prev: UploadedFile[]) => {
      currentFiles = [...prev, ...newFiles];
      return currentFiles;
    });
    setUploadProgress(0);

    // 逐个解析
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const fileObj = newFiles[i];

      currentFiles = currentFiles.map((f) =>
        f.id === fileObj.id ? { ...f, status: 'parsing' as const } : f,
      );
      onFilesChange?.([...currentFiles]);

      try {
        const data = await parseFile(file);
        currentFiles = currentFiles.map((f) =>
          f.id === fileObj.id
            ? { ...f, status: 'parsed' as const, data }
            : f,
        );
        onFilesChange?.([...currentFiles]);
      } catch (err) {
        currentFiles = currentFiles.map((f) =>
          f.id === fileObj.id
            ? {
                ...f,
                status: 'error' as const,
                error: err instanceof Error ? err.message : '解析失败',
              }
            : f,
        );
        onFilesChange?.([...currentFiles]);
      }

      setUploadProgress(Math.round(((i + 1) / fileArray.length) * 100));
    }

    setTimeout(() => setUploadProgress(0), 1000);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        void parseFiles(e.dataTransfer.files);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void parseFiles(e.target.files);
        e.target.value = '';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files],
  );

  const removeFile = (id: string) => {
    onFilesChange?.((files ?? []).filter((f) => f.id !== id));
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'parsing':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'parsed':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-slate-400" />;
    }
  };

  const fileTypeLabels: Record<string, string> = {
    excel: 'Excel',
    word: 'Word',
    pdf: 'PDF',
    image: '图片',
    other: '其他',
  };

  return (
    <div className="space-y-4">
      {/* 拖拽上传区域 */}
      <div
        className={cn(
          'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200 cursor-pointer',
          isDragging
            ? 'border-blue-500 bg-blue-50 scale-[1.01]'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={ACCEPTED_TYPES}
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm mb-4">
          <Upload className="h-7 w-7 text-slate-500" />
        </div>
        <p className="text-base font-medium text-slate-700">
          拖拽文件到此处，或点击上传
        </p>
        <p className="mt-1 text-sm text-slate-500">
          支持 Excel、Word、PDF、图片等多格式文件，可批量上传
        </p>
        <p className="mt-1 text-xs text-slate-400">
          文件在本地浏览器解析，不上传服务器
        </p>

        {uploadProgress > 0 && (
          <div className="mt-4 w-full max-w-xs">
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-center text-slate-500">
              解析中 {uploadProgress}%
            </p>
          </div>
        )}
      </div>

      {/* 已上传文件列表 */}
      {(files?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              已上传 {files?.length ?? 0} 个文件
            </p>
            <button
              onClick={() => onFilesChange?.([])}
              className="text-xs text-slate-500 hover:text-red-500 transition-colors"
            >
              清空全部
            </button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {(files ?? []).map((file) => (
              <div
                key={file.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border bg-white p-3 transition-all',
                  file.status === 'error'
                    ? 'border-red-200 bg-red-50/50'
                    : 'border-slate-200',
                )}
              >
                <span className="text-2xl">{getFileIcon(file.type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {file.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-500">
                      {fileTypeLabels[file.type] || file.type}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500">
                      {formatFileSize(file.size)}
                    </span>
                    {file.status === 'error' && (
                      <span className="text-xs text-red-500">· {file.error}</span>
                    )}
                    {file.status === 'parsed' && file.data?.sheets && (
                      <span className="text-xs text-emerald-600">
                        · {file.data.sheets.length} 个工作表
                      </span>
                    )}
                    {file.status === 'parsed' && file.data?.paragraphs && (
                      <span className="text-xs text-emerald-600">
                        · {file.data.paragraphs.length} 段文本
                      </span>
                    )}
                  </div>
                </div>
                {getStatusIcon(file.status)}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(file.id);
                  }}
                  className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
