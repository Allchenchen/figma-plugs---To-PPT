# 当前转换边界与降级情况

只记录**代码真实行为**。未验证项明确标注，不得视为已通过。

## 近期修复（文字排版）

- **根因**：Figma **百分比行高**被折成 Exact pt，PPT 换字体后显得行距/段距偏紧、多行挤在框顶。
- **修复**：`text-layout.ts` 按单位分流（Multiple vs Exact）；AUTO/MIXED 不虚构统一倍率；零边距；保留源字体名和 `\n` 段落。
- **新增语义**：IR 保留 `textAutoResize`、`paragraphIndent`、`textCase`；首行缩进和 UPPER/SMALL_CAPS 由 OOXML 后处理补齐。
- **混合行距**：每个逻辑段落独立写入 `<a:pPr>/<a:lnSpc>`；已用 11 段回归验证 22.5pt/15pt 可共存于一个原生文本框。
- **段内混合**：仅此场景使用 `SVG_STRING`（`svgOutlineText:false`）tspan 作为视觉行元数据；UTF-16 严格对齐后拆为有序原生文本框。跨段不同行高保持单框 + 每段独立 `lnSpc`。验收：自动化覆盖字符/OOXML/几何/z-order；**PowerPoint 像素级换行仍需人工/渲染对比，未完成前不宣称视觉一致**。
- **全局入口**：可编辑优先下，普通 Frame、Group、Component、Instance、Auto Layout 中的文字均使用同一 Reader/IR/Converter。视觉一致优先不走这条，每个选中 Frame 是一张 2 倍 PNG。
- **变换**：累计旋转、缩放及反射映射到原生文本形状；affine shear 无 DrawingML 文本等价表达时局部 PNG 并记录 TextNode ID。
- **文本框垂直位置**：已禁用 PowerPoint `<a:spAutoFit>` 二次改框；已移除历史 `textVerticalCorrection`（改框 Y/H / 伪造 tIns）。垂直对齐只映射 `textAlignVertical`；行距走 soft-break + `<a:lnSpc>`（见 `text-vertical.ts` / R-TXT-22）。
- **段落合成回退**：缺 Paragraph IR 时按 `\n` 合成逻辑段，保证 soft-break 与每段行距仍生效（R-TXT-23）。
- **显式换行（R-TXT-27，已验收基线）**：Reader 已把 `\n`/`\r`/`\r\n`/U+2028/U+2029 写入 `boundaries`；U+2028 为 softBreak。曾在 soft-break 合并中 `trim()`+丢弃空 body，导致空行/缩进丢失——已禁止。日志须用 `formatCharactersForLog` 转义。后续开发约束见 `development-constraints.md`。
- **自动断行（Figma 优先）**：≥2 行 SVG `exact` → 烘焙软换行 + `wrap=none`；exact 单行且估算宽度能装进框 → `wrap=none`（Results 指标）；假单行超框保持 `wrap=square`（R-TXT-25）。无视觉行时依赖固定框宽 + PPT 自动换行；字体替换仍可能导致轻微溢出。自动折行不得记入 `boundaries` 冒充“读到了换行”。
- **混合段落行距**：同度量且段距 0 的 `\n` 走 soft-break + `lnSpc`；不同 PIXELS / 非零段距保留独立 `<a:p>`，组边界 `spcAft` 仅显式段距或 SVG 残差（R-TXT-26，避免与 Exact 双计溢出）。合并失败时仍逐段注入行距。
- **仍有差异**：Figma 与 PPT 排版引擎无法 100% 一致；字重仅 bold/regular；`leadingTrim=CAP_HEIGHT` 无 DrawingML 等价。结构测试通过 ≠ 桌面视觉一致（第三层需人工）。
- **LOWER/TITLE**：已通过变换 `<a:t>` 字符还原视觉（报告注明）；非 DrawingML `cap`，编辑时看到的是变换后文本。
- **属性总表**：见 `docs/text-attribute-mapping.md`；矩阵测试见 `test/text-mapping-matrix.test.ts`。

## 近期修复（Research 灰底）

- **根因**：`readShape` 在无 SOLID fill 时默认 `#CCCCCC`，描边-only 内容卡/分隔线变成大面积灰块。
- **修复**：无填充 → `fill: null` → PPT `fill.type: 'none'`；并计入 `color.a`。半透明实心填充只有在下面没有别的内容时才相对幻灯片背景烘焙。盖在图片上的背景层保留透明度，见 R-OP-6。
- **诊断**：界面不再提供「下载 IR 诊断」。导出失败只显示 Export failed.

## 已支持（有实现 + 自动化测试）

- 根 Frame → 幻灯片；多 Frame 多页
- 相对 Frame 的绝对坐标放置
- 原生 TEXT / RECTANGLE / ELLIPSE / 轴对齐 LINE
- 图片填充 + OOXML srcRect / tile 后处理
- Mask 兄弟分区；含 mask 的组整段局部 PNG
- 简单几何 mask → picture-shape（有条件）
- 文本 Fill opacity 回退；半透明色烘焙到幻灯片背景
- TextRun / Paragraph / VisualLine 三级模型；段落级混合 Exact/Percent 行距
- 半透明多子 Group → 整组 PNG
- 栅格放置：renderBounds + PNG 宽高比修正
- 嵌套 `clipsContent` 且子节点溢出 → 整节点 PNG
- 布局 Frame chrome（fill/stroke）+ 子树分解；深层 Mask 不拖垮整张卡片
- 每节点 `IRReport` reason

## 有意降级（局部 PNG，非整页）

| 场景 | reason 示例 |
|---|---|
| 任意深度 Mask 组 | `mask group (local PNG, intact)` |
| VECTOR / BOOLEAN / STAR / POLYGON | `complex type=…` |
| 旋转 ≠ 0 | `rotation not yet supported natively` |
| 特效 / 非默认混合模式（无 TEXT） | `effects` / `blendMode=` |
| 渐变 / 多填充 / 图片填充走 compat | `image/gradient/complex fill` |
| 无 TEXT 插画簇 | `illustration cluster (no text)` |
| 半透明多子 Group（无 TEXT / fidelity） | `group opacity with multiple children` |
| clipsContent + 溢出（无 TEXT 或 fidelity） | `clipsContent with overflow` |
| 对角线 LINE | `diagonal line` |

## 未实现 / 部分实现

| 项 | 状态 |
|---|---|
| UI `editable` / `fidelity` 行为分叉 | **已实现**：视觉一致优先每个选中 Frame 一张 2 倍 PNG。可编辑优先仍走逐层导出 |
| 原生文本旋转 / 翻转 | 已实现累计矩阵分解；affine shear 仍局部 PNG |
| Auto Layout 语义保留 | 未实现（仅烘焙后几何） |
| 完整字体嵌入 | 未实现（依赖本机/PPT 字体） |
| 字体缺失自动检测/警告 | Reader 已记录 Figma `hasMissingFont`；PPTX 仍不嵌入字体，PowerPoint 最终替代字体需在客户端确认 |
| Figma 文本自动适应编辑行为 | 导出时保留当前测量框，不让 PPT 自动改框；后续编辑时不会完全复制 Figma 的自动高度行为 |
| `leadingTrim=CAP_HEIGHT` | DrawingML 无直接等价物；同度量 `\n` 行已合并为 `<a:br/>`+`lnSpc` 以还原行距，但 cap-top 与 PPT 行盒仍可能有少量差异；字体替换会放大误差 |
| 段内混合行距的 SVG 文本无法对齐 | 可编辑优先保持文本并报告潜在偏差。视觉一致优先整页是一张图 |
| SVG 路径 → DrawingML 通用转换 | 未实现（P3；不可用 AGPL 库直接并入） |
| 文本视觉误差自动化 | 已提供文本框、字形上下边界、基线及视觉行数的分项报告；仍需 PowerPoint/LibreOffice 先渲染 PNG |
| PowerPoint / WPS 桌面渲染权威对比 | **待人工**（见 `fixtures/checklist.md`） |

## 已知客户端差异

- **WPS / 部分 PPT**：文本 run 的 DrawingML alpha 常被忽略；Shape Opacity 表示形状填充，不能当作「文字 80%」读数。本引擎对半透明字做**底色烘焙**以统一观感；在支持 alpha 的客户端上颜色为已烘焙实色（不再叠第二次 alpha）。
- **Keynote**：文字线性渐变、径向渐变和菱形渐变写在文字填充上，PowerPoint 可直接看到。Keynote 打开同一份 pptx 时可能把字变成纯色。变成纯色时，用导出的同一组色标和手柄再设一次，并让渐变铺满文字框。方向以手柄朝向为准。径向中心用文字框里的焦点。PowerPoint 的径向是按文字框铺开的椭圆，和 Figma 旋转过的椭圆不是同一条曲线，色标按字上的位置对齐。角度渐变在文字上写成第一枚色标的纯色。
- **字体度量**：Figma 与 PowerPoint 行盒可能差 1–2px；禁止用固定偏移 hack「对齐某一页」。
- **字号 1:1**：在 1920×1080 pt 页面映射下，Frame 为 1920×1080 时 Figma 面板数字 1:1 为 PPT pt（18→18pt）。几何与字号共用同一 `scale`；Figma/PPT 字体度量差可能导致极紧框显得更满。
- **列表**：ORDERED/UNORDERED、缩进可原生写入；Figma 未提供的自定义编号起始值与复杂项目符号样式仍无法无损还原。
- **低多边形插画**：强制 STAR/POLYGON 为 custGeom 曾出现视觉「炸开」→ 当前默认 PNG。

## 许可约束

- 不得将 [svg2ooxml](https://github.com/BramAlkema/svg2ooxml)（AGPL-3.0）源码并入本仓库。
- FigDeck 等未声明许可的代码仅可作思想参考，不可复制粘贴。

## 人工验证步骤（环境不具备时不得宣称完成）

1. `npm run build`，Figma Desktop → Import `manifest.json`
2. 打开含 Mask / 半透明字 / Clip / 多段不同 lineHeight 的 Frame，导出 PPTX
3. 用 Microsoft PowerPoint 与（如需要）WPS 分别打开
4. 对照 `fixtures/exports/before-figma.png` 与 checklist 勾选
5. 确认：多段行距仍在同一可编辑文本框；段内混合行距的分行文本框顺序正确；整页未被一张大图替换
