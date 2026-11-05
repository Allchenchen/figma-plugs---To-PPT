# Figma → PPTX 通用映射规则

规则对**任意**使用相同设计特性的页面生效。测试页仅是验证样例，不是特例表。

**稳定基线**：文字换行（R-TXT-25 / R-TXT-27）已验收，后续修改须遵守 `docs/development-constraints.md`，不得破坏该基线。其他能力仅在明确验收后升格为基线。

## 坐标与变换

| 规则 | 说明 |
|---|---|
| R-GEO-1 | 位置 = `absoluteBoundingBox` 相对根 Frame 左上角；禁止 Σ(local x/y) |
| R-GEO-2 | 栅格放置优先 `absoluteRenderBounds`，避免 Mask/描边导致 AABB 拉伸 |
| R-GEO-3 | PNG 像素宽高比与放置盒差 >1% 时，按 PNG 比例收缩并保持中心 |
| R-GEO-4 | 允许负坐标（溢出 Frame）；由 PPT 裁切，不强制塞进幻灯片内 |
| R-GEO-5 | 非零旋转：当前 → 局部 PNG（原生旋转未实现） |
| R-GEO-6 | 固定目标页 **1920×1080 pt**；`scale=min(1920/fw,1080/fh)` + 居中 letterbox；1920×1080 Frame → 1 px→1 pt。百分比坐标与 `mapRectToSlide` 等价；禁止非等比拉压。见 `docs/page-scale-mapping.md` |
| R-GEO-7 | 设计值最终 `round2`（pt）；发射 inch=`pt/72` 保持更高精度；页面物理英寸不 round2；中间变换全精度 |

## 透明度

| 规则 | 说明 |
|---|---|
| R-OP-1 | 叶子有效透明度 = 继承 × `node.opacity` × `paint.opacity` |
| R-OP-2 | 多子节点 Group 且 `opacity < 1` → 整组 PNG（禁止逐子相乘）；editable 且子树含 TEXT 时例外（递归保可编辑） |
| R-OP-3 | 文本：segment fills 缺 `opacity` 时回退 `TextNode.fills` |
| R-OP-4 | 半透明文字颜色烘焙到**幻灯片背景色**后再写入 run（WPS/部分 PPT 忽略 glyph alpha；Shape Opacity 滑条≠文字填充） |
| R-OP-5 | PNG 已含自身 alpha 时，仅再乘祖先透明度，不重复乘 paint |
| R-OP-6 | **背景覆盖层见「背景覆盖层」。** 盖住下层图片的大块实色保留有效不透明度，并叠在图片之上。不写成不透明页背景，也不乘到文字上 |

## 背景覆盖层

同一套关系对任意文件生效。不按某一页的颜色、文案或某个百分比写死。

1. **覆盖层是谁。** 一个实心形状盖住所在 Frame 一半以上的面积，并且压在至少一张更低层的图片上。它是背景上的蒙层。图片本身、文字、面积不到一半的色条，都不是这层。
2. **不透明度写在这层上。** 有效不透明度 = 该形状自己的不透明度 × 根 Frame 的不透明度。根 Frame 的不透明度小于 1 时，必须乘进这层，不能丢掉。这层不是幻灯片的不透明页背景。
3. **叠放顺序保持不变。** 图片在下，覆盖层在上，文字仍在覆盖层之上。根 Frame 的不透明度不乘到文字上，也不乘到图片上。
4. **下面已有内容时，保留透明度。** 半透明形状下面已经有可见内容时，透明度留在形状上，由 PowerPoint 按叠放顺序合成。把这层颜色烘焙进幻灯片背景色之后，它会变成不透明色块，下层图片被挡住。
5. **只有页背景时才烘焙。** 半透明实色下面没有别的内容、只贴着幻灯片背景时，才把颜色烘焙进该背景色。这样宿主把透明度对着白色合成时，深色块不会变成灰色。

验收：任意文件里，盖在图片上的大块实色，不透明度等于形状不透明度乘根 Frame 不透明度，并且能透出下面的图片。文字断行和文字颜色不因这条改变。

## Mask / 裁剪

| 规则 | 说明 |
|---|---|
| R-MASK-1 | `isMask` 遮罩后续兄弟直至下一 mask；mask 节点本身不单独渲染 |
| R-MASK-2 | 无 TEXT 的 mask 集群 → **整组局部 PNG**；含 TEXT 的 GROUP/SECTION 递归，mask+媒体仍局部 PNG |
| R-MASK-3 | Frame 级 masked 段与 plain 段分离：masked 的非文本整段 PNG；**直接 TEXT 兄弟剥离为原生文本框**（头像+引文可编辑） |
| R-MASK-4 | 简单几何 mask（矩形/椭圆/星/多边形）且单内容可覆盖时，可 picture-shape；否则 PNG |
| R-MASK-5 | LUMINANCE、复合路径、嵌套 mask、多复杂内容 → 强制 PNG |
| R-MASK-6 | 放置盒用导出测量盒（`chooseExportPlacement`），不用未裁剪 AABB 并集 |
| R-CLIP-1 | 嵌套 Frame/Component/Instance：`clipsContent` 且子 AABB 溢出 → 无文本整节点 PNG；editable 且含 TEXT 时递归（裁切可能不完美）。视觉一致优先不走这条，整页是一张图，见策略开关 |
| R-FRAME-1 | 布局 Frame 的 fill/stroke/圆角作为独立原生矩形 chrome 输出，再处理子节点；禁止「只递归子节点而丢掉边框」 |
| R-FRAME-2 | 含文本的布局 Frame 即使子树有 Mask，也不整框 PNG；Mask 仅在所属 GROUP/分段内局部降级 |
| R-FRAME-3 | 故意溢出卡片边缘的装饰（`clipsContent` 关闭）随子节点绝对坐标放置，不被 Frame 导出盒裁切 |

## 节点类型

| Figma | PPTX | 条件 |
|---|---|---|
| TEXT | 原生文本框 | 含 runs / 对齐 / 行距 / 段距；透明度见 R-OP-* |
| RECTANGLE / ELLIPSE | 原生形状 | 无旋转/特效/复杂填充；**无 SOLID 填充时 fill=null（禁止默认灰）** |
| 描边-only 矩形/椭圆 | 原生形状，`fill: none` | 内容卡描边、分隔线；不得填 `#CCCCCC` |
| LINE（轴对齐） | 原生线 | 对角线 → PNG |
| 单图填充 RECT 等 | 原生图 + sizing | FILL/FIT/CROP/TILE → srcRect/tile 后处理；CROP 的 `imageTransform` 按**单位正方形**（container→image）解释，禁止当 Figma px |
| RECT 图片填充 + 圆角 | 仍为原生 `p:pic` | 读取本节点四角半径；均匀且 smoothing≈0 → `prstGeom roundRect`+adj；否则 `custGeom`；不改 blip/srcRect/xfrm |
| 截图上的裸实心顶/底细条 | 丢弃该 shape | 与图片同宽、贴边、≤5% 边长、更高 zIndex、无描边；避免遮住位图页脚/顶栏细节（`dropImageEdgeCoverShapes`） |
| STAR / POLYGON / VECTOR / BOOLEAN | 局部 PNG | 视觉优先（低多边形 custGeom 易「炸开」） |
| GROUP / FRAME 含 TEXT | **递归下钻**（FigDeck：绝不因多子合并容器） | 头像+引文行保持可编辑字 |
| GROUP 含 isMask（无 TEXT） | 整组局部 PNG | 禁止拆散 |
| GROUP 含 isMask + TEXT | 递归；mask+媒体 PNG，TEXT 原生 | 头像行可编辑 |
| 无 TEXT 的纯矢量簇 | 局部 PNG | `illustration cluster (no text)` |
| FRAME / COMPONENT / INSTANCE（布局） | 先输出 fill/stroke chrome，再递归 | |
| ELLIPSE + IMAGE 填充 | 局部 PNG（exportAsync） | 保留圆形裁切；禁止方图 |
| 虚线描边 `dashPattern` | PPT dash/sysDot | FigDeck 启发式 |
| FRAME（根） | 幻灯片 | 背景取顶层 SOLID fill |

## 降级与报告

| 规则 | 说明 |
|---|---|
| R-FB-1 | 每个非 native 节点写入 `IRReport`：`tier` + `reason` |
| R-FB-2 | 禁止静默丢弃可见节点 |
| R-FB-3 | 禁止因单对象复杂而栅格化整张幻灯片 |
| R-FB-4 | 混合模式 ≠ NORMAL/PASS_THROUGH → PNG；**含 TEXT 的容器例外**（递归保可编辑，容器级 blend/effects 丢弃） |
| R-FB-5 | 含 TEXT 的 FRAME/GROUP/COMPONENT/INSTANCE：不因 `hasEffects` / 旋转整组 PNG（Auto Layout 引文行必须拆开） |

## 文字断行

一个 Figma 文本节点导出成一个 PowerPoint 文本框。框用 Figma 已经测好的尺寸，关闭自动适应。断行按下面三条处理，对任意文件生效，不按某一页的句子写死。

1. **自动折行。** 同一段里，相邻两行的基线距离相同。写成这一段里的一次软换行 `<a:br/>`，并关闭 PowerPoint 自动换行。
2. **段内换行（U+2028）。** 与自动折行相同，留在同一段，用一次 `<a:br/>` 连接。行距写在这一段上。规范化成 `\n` 之后，段落号仍然不数它。
3. **回车（`\n`、`\r`、U+2029）。** 另起一段 `<a:p>`。段落号只数回车。

Figma 的文本 SVG 会把这一行自己的 U+2028 或回车画在 tspan 末尾。这个字符只表示本行结束，拆行时到此为止。两个换行符之间没有字符，才是空行，空行保留。行尾结束符再拆出的空行会变成连续 `<a:br/>` 或空 `<a:p>`，两行之间就比只有一次换行的段落高出一行。

同一段里，相邻视觉行的基线差写成这一段的精确磅值。段间距为 0 时，回车不再另加一行空白。段间距大于 0 时，只把 Figma 的 `paragraphSpacing` 写到下一段之前。

字号、行高、段间距相同的两段正文，行与行之间的空隙相同。标准是一行文字、一次换行、紧接着下一行。

## 文字渐变

只改文字填充。形状、底色、描边保持原样。文字仍然是可编辑文本框。全文里每个文字图层都按这条处理。

1. **只用最上面一层可见填充。** 线性渐变写成线性文字填充。径向渐变写成径向文字填充，中心用这一层的径向手柄，色标按这些颜色落在文字框上的位置重排，使字上的颜色与 Figma 一致。菱形渐变写成矩形路径渐变，中心和色标按同一方式落在文字框上。它是纯色，就写纯色。角度渐变不改成线性、径向或菱形，文字仍可编辑，颜色用第一枚色标。被挡住或隐藏的填充不参与。
2. **色标和方向来自这一层的渐变手柄，铺在这个文字框上。** 角度按手柄方向，0° 从左到右，顺时针增加：从上到下 90°，从右到左 180°，从下到上 270°。斜向按同一顺时针规则写入。
3. **用文字框四个角投到渐变线上的那一段。** 这段里颜色有变化，两端当作 0% 和 100%，中间色标按在这段里的位置重算，写成铺满文字框的线性渐变。整框都是同一个颜色，才导出纯色。手柄画在框外时，只要字上的颜色仍在变，就写渐变。
4. **透明度写在色标上。** 图层不透明度、填充不透明度和色标自己的透明度相乘，写在对应色标上。字符不再另加一层透明度，也不烘焙成灰色。
5. **Keynote 不保证保留文字渐变。** 只交一份 pptx。PowerPoint 打开应看到渐变。Keynote 打开后如果变成纯色，用同一组色标、透明度和方向再设一次，字仍可编辑。方向以手柄朝向为准。

## 文本布局（Text Layout Normalizer）

| 规则 | 说明 |
|---|---|
| R-TXT-1 | 文本框宽高 = Figma 框；`TEXT_WIDTH_SCALE = 1`；`margin=[0,0,0,0]`；禁止 autofit 缩字号 |
| R-TXT-2 | 加宽时按对齐修正原点；禁止固定垂直偏移 |
| R-TXT-3 | **字重按 Figma 的字体样式名写。** Medium 写成 Medium，Semibold 写成 Semibold。只有 Bold / Black / Heavy 才写 `b="1"`。本机没有该样式时保留样式名并写入报告，不收成 Regular，也不收成 Bold |
| R-TXT-4 | **已作废。** 百分比行高不再写成多倍行距。PERCENT 与 PIXELS 都写成精确磅值，见 R-TXT-29。AUTO 不虚构数值 |
| R-TXT-5 | `paragraphSpacing` px → `paraSpaceAfter` pt；`\n` 保留为段落分隔，不合并独立 Text 节点 |
| R-TXT-6 | 默认保留 Figma 字体名称；缺失字体属于导出诊断/客户端部署问题，禁止静默替换后改变字宽和换行 |
| R-TXT-7 | `paragraphIndent` 通过 DrawingML `indent` 写入；UPPER/SMALL_CAPS 用原生 `cap`（字符不改写）；LOWER/TITLE 无 DrawingML 等价 → 变换 `<a:t>` 并写兼容报告；run 级 textCase 按 span 注入 |
| R-TXT-7b | 列表：`listType` → `buChar`/`buAutoNum`；`listSpacing` 在无 `paragraphSpacing` 时写入 `spcAft`；`indentation` → `marL` |
| R-TXT-8 | 所有 `textAutoResize` 模式均保留 Figma 已测量框；OOXML 强制 `<a:noAutofit/>`，禁止 `spAutoFit`/`normAutofit` 二次改框或缩字号 |
| R-TXT-9 | `getStyledTextSegments` 保留 UTF-16 `start/end`、run 行高及段落属性；显式换行经 `normalizeTextWithBoundaries` 写入 `boundaries` + 规范化 `characters`；自动换行不写入 boundaries（见 R-TXT-25/27） |
| R-TXT-27 | **显式换行完整传递**：Reader 从原始 `node.characters` 提取 `TextBoundary`（`\\n`/`\\r`/`\\r\\n`/U+2029→`paragraphBreak`，U+2028→`softBreak`）；IR 保存 `boundaries` 与段落 `breakAfter`；当 `characters` 换行数 > runs 内换行数时必须按字符行发 `breakLine`；soft-break 合并禁止 `trim()`/`filter(Boolean)` 丢掉空行与行首空格；`softBreak`→`<a:br/>`，`paragraphBreak`→`<a:p>`。日志用转义形式。禁止把自动折行伪称为“读到了换行” |
| R-TXT-9b | 字号：`round2(sourcePx × pageScale)` pt（1920×1080 Frame 为 1:1）。字距与 PIXELS 行距/段距同步；PERCENT 行高不缩放。框几何走页面比例（R-GEO-6）；见 `docs/page-scale-mapping.md` |
| R-TXT-10 | 不同逻辑段落可在同一 PPT 文本框中拥有不同 `<a:lnSpc>`，一律 `<a:spcPts>`。**百分比写成 `spcPct` 已作废**，见 R-TXT-29 |
| R-TXT-11 | 所有非空 TextNode 读取 `SVG_STRING`（`svgOutlineText:false`）tspan 基线；用于自动折行烘焙（R-TXT-25）和每段自己的行距（R-TXT-21、R-TXT-29）。须与源字符 UTF-16 无损对齐；禁止平均/最大/首字符行高或固定 Y 补偿 |
| R-TXT-12 | **已作废。** 不再按视觉行拆成多个文本框。一个文本节点保持一个文本框，见 R-TXT-1、R-TXT-21 |
| R-TXT-13 | SVG 对齐失败：editable 保留单文本框并报告。视觉一致优先不走这条，整页是一张图，见策略开关 |
| R-TXT-14 | 所有普通 Frame、Group、Component、Instance、Auto Layout 中的 TextNode 只调用统一 Reader；容器不得实现第二套文字样式算法 |
| R-TXT-15 | TextRun 禁止保存行距/段距/段落缩进；这些属性只存在于 Paragraph；累计矩阵、旋转、翻转只存在于 TextBox |
| R-TXT-16 | Paragraph IR 存在时，禁止再写文本框级 `lineSpacing/paraSpaceAfter`；最终段落指标只由一个 OOXML 后处理入口生成 |
| R-TXT-17 | 简单累计旋转/缩放/翻转映射原生文本形状；DrawingML 文本形状不能表达的 affine shear 才局部 PNG，并写 TextNode 报告 |
| R-TXT-18 | Mask、组合透明度或复杂裁剪导致容器栅格化时，报告必须额外列出其中失去编辑能力的 TextNode ID |
| R-TXT-19 | 垂直对齐只映射 Figma `textAlignVertical`；文本框几何保持 Figma 测量值；禁止改框 Y/H 或固定 Y 偏移伪造字形位置。`leadingTrim` 保留到 Paragraph |
| R-TXT-20 | 字形边界与文本框边界分别验证；最终 PPTX 必须审计 shape 几何、`bodyPr`、段落间距及 run 字体 |
| R-TXT-21 | **文字断行见「文字断行」。** 自动折行与 U+2028 是同一段里的一次 `<a:br/>`。回车才是新的 `<a:p>`。段落号只数回车。tspan 行尾的换行符只表示本行结束 |
| R-TXT-22 | 框内垂直位置分层：几何=`rect`；对齐=`textAlignVertical`→anchor；行距=soft-break+lnSpc；零 inset；`noAutofit`。禁止固定 Y 偏移或全局居中掩盖引擎差。完整属性表见 `docs/text-attribute-mapping.md` |
| R-TXT-23 | 无 Paragraph IR 时，`resolveTextParagraphs` 按 `\n` 合成逻辑段（与 Reader `buildTextParagraphs` 同分裂），禁止整段单 blob 只给首个 `<a:p>` 写行距 |
| R-TXT-24 | 段落 OOXML 指标仅在 postprocess 从 **Frame 空间 IR × page scale** 写入一次；createPptx 不改写 `doc`。禁止与已删除的 `textVerticalCorrection` 叠加深偏移 |
| R-TXT-25 | **Figma 断行优先**：SVG `exact` 且 ≥2 行时烘焙缺失折行为 `\n`/`<a:br/>` 并 `wrap=none`。SVG `exact` 单行、无 `\n`、且估算宽度能装进框时也 `wrap=none`（避免 Results 指标被 PPT 拆成 `196,33`/`6`）。估算明显超框的假单行 SVG 不锁定，保持 `wrap=square`（Idea 溢出守卫）。禁止拉宽框、改字号或 autofit 改几何；禁止按内容/节点硬编码断点 |
| R-TXT-26 | **已作废。** 不再把基线差减去下一行行高写入 `spcAft`。段距只写 Figma 的显式段距，行距见 R-TXT-29 |
| R-TXT-28 | **文本框不因基线下移。** SVG 文本的 y 是基线，不是上边距。垂直位置只写 `textAlignVertical` → `anchor`（顶端 / 居中 / 底端）。四边内边距为 0。禁止把第一行 `baselineY` 写入 `tIns`。写入后再叠加基线，整段正文会低于 Figma |
| R-TXT-29 | **段间距离只计一次，且行距不小于该行字号。** 同一段里，相邻视觉行的基线差写成这一段的精确 `lnSpc`。按回车之后的空隙只写 Figma 的 `paragraphSpacing` 到 `spcAft`。上一段末行到下一段首行的基线差已经包含行距和段距，禁止两处都写满。从这段基线差里减去段距后，若剩余值小于这一行的字号，行距保持整段基线差，段距不再另写。行距小于字号时，大字会压住下一行 |
| R-TXT-30 | **字距只写一次，单位用解析后的像素。** Figma 百分比字距先换成 `fontSize × percent / 100` 像素，再按页面比例写成磅。禁止把百分比数字直接当磅。字距只写在 run 上，不在文本框和 run 上各写一遍。字距偏大时，这一行变宽，居中排在它下面的下一行会跟着左右偏移 |
| R-TXT-31 | **标签和值的距离用 Figma 的框，不压进行盒。** 同一文本节点里的两行（标签在上、值在下）用这两行的基线差做行距，不用更小的默认行距把它们挤近。它们若是两个文本节点，各自的框顶用相对根 Frame 的绝对坐标，禁止把下一个节点收进上一个节点的行盒 |
| R-TXT-32 | **文字颜色按每个字符段的实色写。** 同一文本节点里不同颜色的 run 各自保留 SOLID 填充，例如紫色标题和灰色正文不能变成同一种颜色。该 run 没有填充时，才用文本节点上的实色。已经读到实色时禁止写成 `#000000`。这条只约束实色文字，不改形状填充。线性渐变见「文字渐变」 |
| R-TXT-33 | **字符原文照写。** 不删 Figma 里已经重复的词，不改标点。稿面上的重复不是导出错误 |
| R-TXT-34 | **文字透明度写在 run 上。** 文本节点或填充的透明度（如标签 70%、正文 80%）保留为 `<a:alpha>`。禁止丢掉透明度变成不透明白，也禁止烘焙成灰色十六进制。线性、径向、菱形渐变的透明度写在色标上，见「文字渐变」 |
| R-TXT-36 | **文字渐变见「文字渐变」。** 只写文字填充，文字保持可编辑。线性按文字框在渐变线上的投影写。径向按手柄中心写，色标按落在文字框上的位置重排。菱形写成矩形路径渐变。角度渐变保持可编辑纯色 |
| R-TXT-35 | **图片字保持图片。** Figma 里用图片填充画出来的标题，按该矩形导出图片，不改成可编辑文字，也不漏掉。可见的纯色底仍是原生形状 |
| R-PAGE-1 | **只导出当前选中的可见顶层 Frame。** 每个选中项各成一页，从上到下，再从左到右。没选中的画板不补。隐藏图层不导出 |

## 策略开关

| 模式 | 规则 |
|---|---|
| `editable` | 上表默认路径；含 TEXT 的多子容器递归 |
| `fidelity` | 每个选中的可见顶层 Frame 导出为一张 2 倍 PNG，相当于 Figma Export 的 2x PNG，放进 1920×1080 pt 页。不读该 Frame 自己的 Export 设置。文字、形状都在这张图里。旋转烤进图里，放置时不再转一次，也不再乘一次 Frame 不透明度。透明保留。四周留白用 Frame 最上面的实色，没有则白。失败写入报告，不改成 1 倍 |

导出选项经 `code.ts` → `readDocument(selection, options)` 传入 Reader。`fidelity` 在读页时直接导出整框，不进入上表的逐层路径。
