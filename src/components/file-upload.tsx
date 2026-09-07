'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, X, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatFileSize, getFileIcon, getFileType, generateId } from '@/lib/file-utils';
import type { UploadedFile, ParsedData, FileType } from '@/types';

interface FileUploadProps {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  multiple?: boolean;
}

const ACCEPTED_TYPES =
  '.xlsx,.xls,.csv,.ods,.docx,.doc,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg,.tiff';

export function FileUpload({ files, onFilesChange, multiple = true }: FileUploadProps) {
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

  const parseFiles = async (fileList: FileList | File[]) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map((file) => ({
      id: generateId(),
      name: file.name,
      size: file.size,
      type: getFileType(file.name, file.type),
      mimeType: file.type,
      uploadedAt: new Date(),
      status: 'pending' as const,
    }));

    onFilesChange([...files, ...newFiles]);
    setUploadProgress(0);

    // 逐个解析文件
    for (let i = 0; i < newFiles.length; i++) {
      const fileObj = newFiles[i];
      const fileData = Array.from(fileList)[i];

      // 更新状态为解析中
      onFilesChange(
        [...files, ...newFiles].map((f) =>
          f.id === fileObj.id ? { ...f, status: 'parsing' } : f,
        ),
      );

      try {
        const formData = new FormData();
        formData.append('files', fileData);

        const response = await fetch('/api/files/parse', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('解析失败');
        }

        const result = await response.json();
        const parsed = result.results?.[0];

        if (parsed?.success && parsed.data) {
          onFilesChange(
            [...files, ...newFiles].map((f) =>
              f.id === fileObj.id
                ? { ...f, status: 'parsed' as const, data: parsed.data as ParsedData }
                : f,
            ),
          );
        } else {
          throw new Error(parsed?.error || '解析失败');
        }
      } catch (err) {
        onFilesChange(
          [...files, ...newFiles].map((f) =>
            f.id === fileObj.id
              ? {
                  ...f,
                  status: 'error' as const,
                  error: err instanceof Error ? err.message : '未知错误',
                }
              : f,
          ),
        );
      }

      setUploadProgress(Math.round(((i + 1) / newFiles.length) * 100));
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
    onFilesChange(files.filter((f) => f.id !== id));
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
        return <FileText className="h-4 w-4 text-slate-400" />;
    }
  };

  const fileTypeLabels: Record<FileType, string> = {
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

        {uploadProgress > 0 && (
          <div className="mt-4 w-full max-w-xs">
            <Progress value={uploadProgress} className="h-2" />
            <p className="mt-1 text-xs text-center text-slate-500">
              解析中 {uploadProgress}%
            </p>
          </div>
        )}
      </div>

      {/* 已上传文件列表 */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              已上传 {files.length} 个文件
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFilesChange([])}
              className="text-xs text-slate-500 hover:text-red-500"
            >
              清空全部
            </Button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {files.map((file) => (
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
                      {fileTypeLabels[file.type]}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500">
                      {formatFileSize(file.size)}
                    </span>
                    {file.status === 'error' && (
                      <span className="text-xs text-red-500">
                        · {file.error}
                      </span>
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
