# AGENTS.md - 智能文件比对分析平台

## 项目概览

一个基于 Next.js 16 + React 19 + TypeScript 的智能文件比对分析平台。支持多格式文件上传（Excel、Word、PDF、图片）、自动解析、表格/文档差异比对、AI 智能分析与结果导出。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5 (strict mode)
- **UI 组件**: shadcn/ui (Radix UI)
- **Styling**: Tailwind CSS 4
- **LLM**: coze-coding-dev-sdk (流式 SSE 输出)
- **文件解析**: xlsx, mammoth, pdf-parse

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── ai/analyze/route.ts     # AI 分析流式 API
│   │   └── files/
│   │       ├── parse/route.ts      # 文件解析 API
│   │       └── export/route.ts     # 结果导出 API
│   ├── globals.css                 # 全局样式
│   ├── layout.tsx                  # 根布局
│   └── page.tsx                    # 首页主页面
├── components/
│   ├── ui/                         # shadcn/ui 组件库
│   ├── file-upload.tsx             # 文件上传组件
│   ├── diff-result-view.tsx        # 比对结果展示组件
│   └── ai-analysis-panel.tsx       # AI 分析面板组件
├── lib/
│   ├── file-utils.ts               # 文件工具与比对算法
│   └── utils.ts                    # 通用工具 (cn)
├── hooks/
│   └── use-mobile.ts               # 移动端检测
└── types/
    └── index.ts                    # 全局类型定义
```

## 核心功能模块

### 1. 文件上传与解析 (`file-upload.tsx` + `api/files/parse`)
- 拖拽上传 + 点击上传，支持批量
- 支持格式: .xlsx, .xls, .csv, .docx, .doc, .pdf, 图片
- 实时显示解析进度与状态
- 后端解析后返回结构化数据

### 2. 数据比对算法 (`lib/file-utils.ts`)
- **Excel 比对**: 基于主键列的行级比对，识别新增/删除/修改/不变
- **文档比对**: 段落级 LCS 简化比对，支持 Word/PDF 文本差异
- 差异类型: `added` (绿) / `removed` (红) / `modified` (琥珀) / `unchanged`
- **智能主键检测**: 唯一性+空值率+值域重合度综合评分，支持跨列自动匹配
- **值归一化**: 数值精度容差(1e-6)、日期格式归一、字符串trim
- **相似度配对**: 编辑距离(Levenshtein)+长度预剪枝+字符串截断，上限20000对
- **对账汇总**: 跨列主键匹配、值域重合检测、匹配分类统计(仅A有/仅B有/两边都有)
- **按时间对比**: 鲁棒日期解析(Excel序列日期/中文日期/紧凑格式)、粒度自动检测(日/周/月)、期间对比表+差异摘要

### 3. 结果展示 (`diff-result-view.tsx`)
- Tab 切换: 表格比对 / 文档比对
- 差异筛选: 点击状态徽章过滤
- 行详情展开: 展示修改单元格前后对比
- 斑马纹 + 颜色编码直观呈现
- 差异优先排序: 默认按修改>新增>删除>疑似>未变排序

### 4. AI 智能分析 (`ai-analysis-panel.tsx`)
- 前端直连 LLM（OpenAI 兼容 SSE 流式），支持中途停止、复制、重置
- 分析维度: 整体概览 / 关键差异 / 风险提示 / 优化建议 / 行动建议
- 输入包含: 对账汇总 + 匹配分类 + 数值对比 + 按时间对比 + 主键匹配质量
- 本地降级分析: 未配置 API Key 时自动生成统计摘要
- AI 设置保存: Base URL / Model 可持久化到 localStorage

### 5. 结果导出 (`api/files/export`)
- 支持 Excel (.xlsx) 和 CSV 格式
- 包含摘要 sheet + 对账汇总 sheet + 匹配分类 sheet + 按时间对比 sheet + 各比对结果 sheet
- 浏览器端 Blob 下载

## 开发规范

### 编码规范
- TypeScript strict mode，禁止隐式 any
- 优先使用已声明的类型与导入
- catch 错误必须先类型收窄再使用

### API 路由规范
- runtime: 'nodejs'（需要 Node 专用库时）
- 错误统一 JSON 格式返回
- AI 分析使用 SSE 流式输出

### Hydration 注意
- 所有客户端组件顶部声明 'use client'
- 动态数据在 useEffect 中获取
- 禁止非法 HTML 嵌套

## 构建与测试命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动开发服务
pnpm build          # 生产构建
pnpm ts-check       # TypeScript 类型检查
pnpm lint --quiet   # ESLint 检查
```

## 关键依赖

- `xlsx` - Excel 解析与导出
- `mammoth` - Word 文档解析
- `pdf-parse` - PDF 文本提取
- `coze-coding-dev-sdk` - LLM AI 分析
- `shadcn/ui` (已预装) - UI 组件库

## 常见问题排查

1. **文件解析失败**: 检查文件格式是否支持，大小是否超 50MB
2. **比对无结果**: 确保至少 2 个同类型文件解析成功
3. **AI 分析报错**: 查看 app.log 中的 LLM 调用错误
4. **导出为空**: 检查 diffResults 数据结构是否正确
