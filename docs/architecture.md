# 统一转换引擎架构

本文描述**当前已实现**的管线。计划中的能力见 `implementation-plan.md`，边界见 `known-limitations.md`。  
**开发方式**（最小范围修复、已验收基线保护）：见 `development-constraints.md`。

## 总览

```
Figma Plugin API
    → Figma Reader          (src/reader/*)
    → Intermediate Representation  (src/ir/types.ts)
    → Geometry & Style 已在 Reader 内归一化
    → Compatibility Analyzer  (src/reader/compat.ts + mask.ts)
    → PPTX Converter          (src/converter/* + PptxGenJS)
    → OOXML Postprocess       (src/converter/postprocess.ts)
    → Export Report           (IRDocument.report)
```

插件入口：`src/code.ts`（沙箱）调度 Reader；`src/ui.ts` / `ui.html` 接收 `IRDocument` 并写出 `.pptx`。  
全程本地，无设计数据上传。

## 模块职责

### 1. Figma Reader

| 文件 | 职责 |
|---|---|
| `reader.ts` | 递归遍历、Mask 分段、组透明度、Clip 溢出、导出 PNG |
| `describe.ts` | `SceneNode` → 可序列化 `NodeDesc`（无 figma 全局） |
| `compat.ts` | native vs image 决策（纯函数） |
| `mask.ts` | `isMask` 兄弟分区、`decideMask`、导出盒选择 |
| `geometry.ts` | 相对 Frame 盒、子节点溢出检测 |
| `matrix.ts` | 2D 仿射矩阵（纯函数，供变换扩展） |
| `colors.ts` / `text.ts` / `corners.ts` / `image*.ts` / `line.ts` | 样式与媒体归一化 |

坐标约定：一律用 `absoluteBoundingBox`（必要时 `absoluteRenderBounds`）相对**根 Frame** 左上角，**禁止**累加局部 x/y。

透明度约定：

- 叶子：`inherited × node.opacity × paint.opacity`
- 多子节点半透明 Group：整组 PNG（禁止对重叠子节点分别乘透明度）
- 文本：`getStyledTextSegments` 常省略 fill opacity → 回退 `node.fills`

### 2. IR（`src/ir/types.ts`）

与 Figma API / PptxGenJS 解耦：

- `IRText` / `IRShape` / `IRImage` / `IRPictureShape` / `IRLine`
- 文本三级模型：`IRText`/TextBox（几何、累计变换、旋转、透明度、容器上下文）→ `IRTextParagraph`（行距、段距、对齐、缩进、列表）→ `IRTextRun`（UTF-16 字体、字号、字重、斜体、颜色）；`IRTextVisualLine` 仅是必要降级时的布局元数据
- `IRImageSizing`：cover / contain / crop / tile → 后处理注入 `srcRect` / tile
- `IRReport`：每节点 `tier: native | ooxml | png` + `reason`
- 坐标：Figma px；颜色 `#RRGGBB`；opacity 0..1；旋转顺时针度

已区分语义：

- 局部 PNG vs 原生图（`sizing` 有无）
- 遮罩 picture-shape vs 普通 image
- 层透明度 vs 文本 run 透明度

尚未在 IR 中一等建模（仍在 Reader 内即时处理）：父级累计矩阵快照、Auto Layout 约束。

### 3. Compatibility Analyzer

`decideFallback(NodeDesc)` + `decideMask(...)`：

- **Native**：TEXT、无效果 RECTANGLE/ELLIPSE、可分解的单孩子容器等
- **PNG（局部）**：Mask 组、clipsContent+溢出、VECTOR/BOOLEAN/STAR/POLYGON、旋转、特效、渐变/多填充、多孩子容器、半透明多孩子组
- **OOXML**：STAR/POLYGON 路径等经 converter 路径（复杂路径仍常 PNG）

组合语义优先于单节点：含 `isMask` 的 **GROUP** 整组降级；**布局 Frame** 则输出 chrome 后对子树做 `partitionChildren`，仅 Mask 段局部 PNG，避免整张内容卡被栅格化。

### 4. PPTX Converter

- `converter.ts`：多幻灯片；固定 1920×1080 pt 页面 + Frame 等比映射
- `text-layout.ts`：**Text Layout Normalizer**（行高 Multiple/Exact/AUTO、段距、边距、源字体保留）
- `reader/text-model.ts`：逻辑段落构建、SVG tspan 视觉行严格对齐、UTF-16 run 切片及策略化降级
- `text.ts`：框几何 + Normalizer 输出 + 半透明字烘焙；固定 Figma 测量框、禁用 PPT shape autofit；仅段内混合行距按视觉行拆分可编辑文本框
- `text-paragraphs.ts` / `text-wrap.ts`：soft-break 合并、视觉折行锁定（与段内混合拆分正交）
- `shape.ts` / `polygon.ts` / `units.ts` / `colors.ts`
- `postprocess.ts`：图片 crop / picture-shape；同度量 `\n` 段合并为 `<a:br/>` 后**按段落索引**写入 `<a:lnSpc>` / `spcPct|spcPts`、段距与缩进

### 4b. 混合行距策略（已落地）

| 条件 | 行为 |
|---|---|
| 段落内行高一致（跨段可不同） | **一个**原生文本框；每段独立 `<a:pPr>/<a:lnSpc>` |
| 同一逻辑段内混合行高 + SVG `exact` | 按 VisualLine 基线差拆成多个原生行文本框；按 UTF-16 切 runs |
| SVG 对齐失败 | `editable`：单框 + 报告；`fidelity`：仅该 TextNode 局部 PNG |

禁止：平均/最大/首字符行高、固定 Y 补偿、整页栅格化。  
布局元数据：`SVG_STRING` + `svgOutlineText:false`，须与源字符 UTF-16 无损对齐后才采用。

### 5. 质量报告与验证

- `report/quality.ts`：分别统计 **IR 结构**、**原生可编辑对象占比**、**扁平 PNG**、**整页栅格嫌疑**、降级原因 Top
- `report/pptx-text-audit.ts`：解析最终 PPTX 中每个 `F2P_TXT_*` 形状的几何、`bodyPr`、段落行距与 run 字体
- `validation/text-visual-diff.ts` + `npm run visual:text`：分项报告文本框误差、可见字形上下边界、基线误差与视觉行数
- Vitest：单位、颜色/透明度、Mask、策略分叉、质量报告、OOXML zip
- `fixtures/`：人工 Figma ↔ PPT 对比（像素级自动化需桌面渲染链，当前未宣称完成）

### 6. 导出策略

| 模式 | 行为 |
|---|---|
| `editable`（默认） | FigDeck 式容器递归；仅 Mask 组 / 无文字插画簇 / 复杂叶子 → PNG |
| `fidelity` | 无文本的多子容器可整组 PNG；含 TextNode 的普通 Frame/Group/Component/Instance 仍递归到统一文本 Reader；Mask/组合透明度等共同渲染语义仍可局部 PNG |

## 数据流示意

```
Frame
 └─ partitionChildren (mask | plain)
      ├─ masked → rasterizeMaskSegment (单 IRImage)
      └─ plain  → traverse
           ├─ group opacity × multi-child → PNG
           ├─ decideFallback → native | PNG
           └─ TEXT / RECT / ELLIPSE / LINE / image-fill → IR*
```

## 设计原则（已落地）

1. 视觉保真优先于可编辑；可编辑是在保真之上的目标。
2. 降级范围最小化：只栅格化有问题的组合，不默认整页截图。
3. 纯函数核心可单测；Figma API 仅在 Reader 边界。
4. 每次修复提炼通用规则，禁止页面坐标硬编码。
