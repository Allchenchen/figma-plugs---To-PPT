# Figma → IR → PowerPoint 文字属性映射表

统一入口：`readText` → `IRText`（TextBox）/ `IRTextParagraph` / `IRTextRun` → `textBoxOptions` + `textRuns` → OOXML `postprocess`。

容器（Frame / Group / Component / Instance / Auto Layout）只提供坐标与继承上下文，**不**实现第二套文字样式算法（R-TXT-14）。

## TextBox（几何与整体布局）

| Figma | IR | PowerPoint / DrawingML | 状态 |
|---|---|---|---|
| absoluteBoundingBox → 相对根 Frame | `rect` | `a:off` / `a:ext`（pt→EMU，×12700；经 page-scale） | ✅ |
| textAlignVertical | `textAlignVertical` | `bodyPr/@anchor` t/ctr/b | ✅ |
| textAlignHorizontal（框级回退） | `textAlignHorizontal` | 段级 `pPr/@algn` 优先 | ✅ |
| textAutoResize * | `textAutoResize` | 保留测量框 + `noAutofit`；不启用 spAutoFit | ✅ 有意 |
| rotation / flip | `rotation` / `flipH` / `flipV` | `xfrm/@rot`、flip | ✅ |
| opacity（单样式） | `opacity` | 颜色烘焙或形状透明 | ✅ |
| leadingTrim | Paragraph.`leadingTrim` | **无等价**；写 IR + 报告 | ⚠ |
| containerContext | `containerContext` | 仅诊断 | ✅ |

\* WIDTH_AND_HEIGHT / HEIGHT / NONE / TRUNCATE：导出时一律使用 Figma 已测量几何。

## Paragraph

| Figma | IR | DrawingML | 状态 |
|---|---|---|---|
| `\n` / `\r` / `\r\n` / U+2029 | `boundaries[]` + `breakAfter: paragraphBreak` | `<a:p>`；同度量且段距 0 时可 soft-merge 为 `<a:br/>` | ✅ |
| U+2028 | `boundaries[]` + `breakAfter: softBreak` | 优先同一 `<a:p>` 内 `<a:br/>` | ✅ |
| lineHeight PIXELS | `{unit:PIXELS,value}` | `lnSpc/spcPts`（value×scale → pt） | ✅ |
| lineHeight PERCENT | `{unit:PERCENT,value}` | `lnSpc/spcPct`（value×1000） | ✅ |
| lineHeight AUTO | `{unit:AUTO}` | 不写 lnSpc | ✅ |
| 段内混合行距 | `mixedLineHeight` | 精确 SVG 基线 → 多文本框；否则 editable 保留/fidelity PNG | ✅ |
| paragraphSpacing | `paragraphSpacing` | 组边界 `spcAft`（仅显式段距；SVG 时为基线差减 next LH 残差，R-TXT-26） | ✅ |
| listSpacing（列表项间距） | `listSpacing` | 无 paragraphSpacing 时作 `spcAft` | ✅ |
| paragraphIndent | `paragraphIndent` | `pPr/@indent`（pt×12700 EMU） | ✅ |
| indentation | `indentation` | `pPr/@marL` | ✅ |
| listOptions.type | `listType` | `buChar` / `buAutoNum` | ✅ 部分 |
| textAlignHorizontal | `textAlignHorizontal` | `algn` l/ctr/r/just | ✅ |

软换行合并条件（R-TXT-21）：相邻逻辑段行高相同、段距 0、非列表、非空、对齐相同。

## TextRun

| Figma | IR | DrawingML | 状态 |
|---|---|---|---|
| fontName.family | `fontFamily` | `a:latin`（及 pptxgenjs 同步的 ea/cs） | ✅ 不嵌入 |
| fontName.style / fontWeight | `fontStyle` / `fontWeight` | bold≥600；italic/oblique | ✅ 部分字重 |
| fontSize | `fontSize` | `sz` = Figma 数字 × pageScale ×100（1:1 pt） | ✅ |
| letterSpacing | `letterSpacing` | `spc`（pt） | ✅ |
| fills + opacity | `color` / `opacity` | srgb + 底色烘焙 | ✅ |
| textDecoration | underline / strikethrough | u / strike | ✅ |
| textCase UPPER / SMALL_CAPS | `textCase` | `rPr/@cap` all/small；字符不改写 | ✅ |
| textCase LOWER / TITLE | `textCase` | **无 cap**；`<a:t>` 字符变换 + 报告 | ⚠ |
| 混合 textCase | run 级 | 按 run 注入 cap / 变换 | ✅ |

## 垂直位置：分层结论（禁止改框伪装）

| 层 | 正确做法 | 禁止 |
|---|---|---|
| 框几何 | 保持 Figma `rect` | 固定 Y 偏移、改 height |
| 框内对齐 | 映射 `textAlignVertical` → anchor | 全局强制 CENTER |
| 行距 | soft-break + lnSpc | 用 `lineHeight−fontSize` 当 tIns |
| 自动折行 | SVG exact≥2 → 烘焙 + `wrap=none`；exact 单行且能装进框 → `wrap=none`；假单行超框 → `wrap=square` | 拉宽框/改字号掩盖；指标数字被 PPT 拆字 |
| 首行 cap 齐顶 | 报告 CAP_HEIGHT 限制 | 猜测字体度量改 inset |
| autofit | `noAutofit` | spAutoFit / normAutofit |

框几何正确而字形相对框顶有偏差时，优先核对：U+2028→软换行、lnSpc 单位、字体是否被 PPT 替换、leadingTrim。剩余为 Figma 半行距 vs PPT Exact 行盒的引擎差，见 `known-limitations.md`。

**禁止**重新引入 `textVerticalCorrection`：它与 soft-break + lnSpc 冲突，会在混合行距修好后再次造成框内垂直偏移。策略守卫见 `src/converter/text-vertical.ts`。

## 兼容性报告字段（Reader）

- `leadingTrim=CAP_HEIGHT…`
- `textCase=LOWER|TITLE…` / `mixed textCase…`
- `hasMissingFont…`
- `Figma SVG baseline diagnostics unavailable…`
- 容器栅格化时的嵌入 TextNode ID（R-TXT-18）
