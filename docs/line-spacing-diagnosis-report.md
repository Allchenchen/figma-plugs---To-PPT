# Figma → PPTX 文本布局专项诊断报告

> **后续修复（已落地）**：已移除改框式 `textVerticalCorrection`；同度量 `\n` 段在 OOXML 后处理中合并为 `<a:br/>`，使 Exact `lnSpc` 作用于视觉行（见 R-TXT-21 现行定义）。下文保留为根因取证记录。

**范围（原文）**：只验证与定位。  
**样本**：Insight 正文「慥螎谥頠… / 港尸朕睜弨堙頉嚺…」  
**证据来源**：仓库源码、`fixtures/exports/Figma_Export.pptx` OOXML、人工三张 PPT 调参截图、诊断脚本 `scripts/line-spacing-diag.ts`。  
**未取得**：该节点实时 Figma Plugin API dump / IR debug JSON（见 §7）。

---

## 0. 调用链（代码位置）

```
Figma TextNode
  → src/reader/reader.ts  readText()
      getStyledTextSegments / node.lineHeight / node.characters
      normalizeLineHeight()          src/converter/text-layout.ts
      buildTextParagraphs()          src/reader/text-model.ts   （按 \n 拆 Paragraph）
  → IRText / IRTextParagraph         src/ir/types.ts
  → src/converter/converter.ts       scaleElement() → textRenderFragments() → addText()
      textBoxOptions()               src/converter/text.ts
      textRuns()                     src/converter/text.ts
  → src/converter/postprocess.ts     injectTextProperties()
      PIXELS → <a:lnSpc><a:spcPts val="{px*75}"/>
      PERCENT → <a:spcPct val="{percent*1000}"/>
```

相关近期能力（只作背景，本报告不改它们）：

- `fit:'none'` / 禁止 `spAutoFit`（R-TXT-8）
- `leadingTrim` 进 Paragraph（R-TXT-19）
- `textVerticalCorrection` / R-TXT-21（renderBounds 补偿；与本行距重叠问题正交）

---

## 1. 已确认的事实

### 1.1 最终导出 OOXML（`Figma_Export.pptx` / slide1 / `F2P_TXT_4:21`）

| 项 | 实际值 | 换算 |
|---|---|---|
| 对象 | 唯一，无重复文本 shape | `shapes_with_same_text = 1` |
| 几何 `<a:off/ext>` | x=972px y=568px **w=748px h=80px** | h=60pt |
| `<a:bodyPr>` | `anchor="t"` `lIns/tIns/rIns/bIns="0"` | 顶对齐、零边距 |
| autofit | 无 `spAutoFit` / `normAutofit` / `noAutofit` | 与 `fit:none` 一致 |
| 段落数 | **2** 个 `<a:p>` | 对应两行文案 |
| 段 0 文本 | `慥螎谥頠纄愚奃、嬅掹嘔澁奷嘓嘚暦纄箯悃琛廴，` | 21 字 |
| 段 1 文本 | `港尸朕睜弨堙頉嚺纄漀瀸柃廠蔠` | 15 字 |
| 字符重复 | 无 | concat 无控制字符 |
| 字号 | `sz="1500"` | **15.00 pt** = 20px×72/96 |
| 字体 | `<a:latin/ea typeface="PingFang SC">` | 请求面与设计一致（是否被客户端替换需人工看） |
| 行距 | 每段 `<a:spcPts val="3000"/>` | **Exactly 30.00 pt** = 40px×72/96 |
| 段距 | 无 `spcBef` / `spcAft` | 0 |

结论：**当前插件对「Figma 40px 固定行高」走的是 PIXELS → Exact 30pt 路径，且两行被拆成两个段落。**

### 1.2 换算公式（源码，可静态证明）

| 量 | 公式 | 本样本 |
|---|---|---|
| 字号 | `pxToPt(px)=px*72/96` | 20→15pt |
| 框尺寸 | `pxToInch(px)=px/96` | 748×80 正确 |
| PIXELS 行高 OOXML | `spcPts val = round(px * 75)`（百分之一磅） | 40×75=3000 → 30pt |
| PERCENT 行高 OOXML | `spcPct val = round(percent * 1000)` | 本样本未走此路径 |
| Frame 预设缩放 | `scale=1` | 无二次缩放 |

**未发现字号双重缩放。**  
**PIXELS 行距在生产路径只由 `injectTextProperties` 写入一次**（`textBoxOptions` 不写 `lineSpacing`，符合 R-TXT-16）。

### 1.3 人工 PPT 调参（三张截图，用户确认均为 PPT）

| 设置 | 用户观察 |
|---|---|
| Exactly **30pt** | 两行重叠 / 重影 |
| Exactly **39pt** | 行距接近 Figma |
| Lines **1.4** | 行距也接近 Figma |

不能把 39pt 或 1.4 直接当成正确全局公式（约束 §九）。

### 1.4 字体度量（本机 PingFang.ttc「苹方-简 / 常规体」，诊断用）

| 字号 | win 行盒 (ascent+descent) | typo 行盒 |
|---|---|---|
| 20px | **28.00px** | 28.00px |
| 15pt | **21.00pt** | 21.00pt |

因此：**Exact 30pt > 21pt 字盒**，单从「Exact 小于字体 ascent+descent」**不能**解释重叠（该假说对本字体度量不成立）。  
参考：`1.4 × 15pt = 21pt`（恰等于 win 行盒）；人工觉得好的 Exact 39pt / Lines 1.4 与「字号×1.4」或「单倍行距×1.4」都**不是**同一简单公式，需实验区分。

### 1.5 诊断产物（未改生产逻辑）

- `scripts/line-spacing-diag.ts`
- `fixtures/exports/line-spacing-diag.pptx`（A–F 对照页）
- `fixtures/exports/line-spacing-diag-report.json`

各页 OOXML 已写出：Exact 30/39、Multiple 1.4/2.0 等。**视觉结果需人工在 PowerPoint 打开确认**（标记为人工验证）。

---

## 2. 已排除的原因（有证据）

| 假说 | 结论 | 依据 |
|---|---|---|
| 多个重叠文本对象叠字 | 排除 | 仅 1 个含该文案的 shape |
| 字符 / TextRun 内容重复 | 排除 | 两段文本拼接 = 完整句子，无重复片段 |
| `spAutoFit` 二次改框 | 排除 | OOXML 无 autofit 子元素；框高仍 80px |
| 字号错误（不是 15pt） | 排除 | `sz="1500"` |
| 文本框几何写错 | 排除 | 748×80 与用户给出的 Figma 框一致 |
| 非零内边距导致错位 | 排除 | 四边 inset=0 |
| 垂直对齐不是 TOP | 排除 | `anchor="t"` |
| 字号/行距被 scale 算两次（frame 预设） | 排除 | `resolveLayout(frame).scale === 1`；postprocess 再乘 scale 仍为 1 |
| Exact 30pt < PingFang win 行盒导致必然重叠 | 排除 | win 行盒≈21pt < 30pt |

---

## 3. 疑似根因（按可能性；区分证实度）

### P1 — **段落结构 × Exact 行距语义（尚待验证，可能性最高）**

**现象**：Figma 中两行共享同一「固定行高 40px」；导出后变成 **两个单行 `<a:p>`**，每段带 `lnSpc/spcPts=3000`，段距为 0。

**机制假说**：DrawingML 的 `lnSpc` 主要约束**段内**行距。当每段只有一行时，「两行之间的基线距」更多由**段与段如何堆叠**（及 `spcBef`/`spcAft`）决定，而不保证等于 Exact 30pt。Figma 的 PIXELS 行高则保证**视觉行**之间的间距。于是出现：数学上 40px→30pt「换算正确」，但**跨段视觉间距 ≠ Figma 行高**。

**与人工结果的关系（待验证）**：调大 Exact 或改 Lines，可能改变 PPT 对单行段落最小行盒/段堆叠的表现，从而「看起来接近」——这不能反推 39 或 1.4 为正确映射。

**如何证实/证伪**：

1. 在 PPT 中把两段合并为**一段两行**（仅一个 `<a:p>`，段内软换行），保持 Exact 30pt，看是否仍重叠。  
2. 保持两段结构，只把段间距设为与行高等价的 `spcAft`，看是否接近 Figma。  
3. 打开诊断包 slide A vs 人工改结构后再设 30pt。

### P2 — **Figma PIXELS 行高 ≠ PowerPoint Exact 的视觉语义（已部分证实换算，语义差尚待验证）**

**已证实**：插件按 R-TXT-4 把 PIXELS 写成 Exact pt，公式与 96dpi 一致。  
**未证实**：同一数值在 Figma 与 PPT 中对 PingFang 的「墨水间距」是否同义。  
人工「39pt / Lines 1.4 更好」只说明 **Exact 30pt 路径视觉失败**，不能证明正确值是 39 或 1.4。

### P3 — **Figma 实际 unit 可能是 PERCENT 而非 PIXELS（尚待 Reader 实测）**

用户说明为「固定行高 40px」。导出走了 `spcPts`，与 PIXELS 路径一致。  
若 Figma UI 显示的是 Lines/百分比，而 API 给出 PIXELS（或相反），需要 IR dump 才能钉死。  
**在拿到 `figma-export-ir-debug.json` 前，不能宣称 API 字段已核对。**

### P4 — **leadingTrim / 首行垂直偏移（次要，正交）**

框内顶隙与 CAP_HEIGHT 相关问题由 R-TXT-21 处理；**不能解释两行互相重叠**。本样本重叠是行间问题。

---

## 4. 关键参数对照

| 阶段 | fontSize | lineHeight | 框 | 段落 | 备注 |
|---|---|---|---|---|---|
| 用户声明的 Figma | 20px PingFang SC | **40px 固定** | 748×80 TOP/LEFT | 两行 | API 值未用插件现场 dump 复核 |
| Reader 期望行为 | 原样 px | `normalizeLineHeight` 保留 PIXELS | transform 几何 | `\n` → 多 Paragraph | 代码路径如此 |
| IR（由 OOXML 反推） | 20px 等价 | PIXELS 40 | 748×80 | 2 段 | 无 IR 文件，属反推 |
| Converter addText | 15pt | （框级不写行距） | inch 几何 | runs 保留 `\n` 分段 | |
| 最终 OOXML | 15pt | **Exact 30pt ×2 段** | 748×80 anchor=t | 2×`<a:p>` | **已证实** |

水平/垂直缩放：frame 预设下均为 1，无分离缩放异常。

---

## 5. 三种行距方式分析

| 模式 | OOXML | 与本插件关系 | 已确认视觉 | 结构含义 |
|---|---|---|---|---|
| Exactly 30pt | `spcPts=3000` | **当前导出值**（40px→30pt） | 重叠 | 固定磅值；段内行距 |
| Exactly 39pt | `spcPts=3900` | 人工改参 | 较接近 Figma | 同为 Exact，数值更大 |
| Lines 1.4 | `spcPct=140000` | 若 Figma 为 PERCENT 140 才会导出；本样本不是 | 较接近 Figma | 相对 PPT「单倍行距」 |

注意：

- Figma **40px / 20px = 2.0**。若误用 Multiple **2.0**（诊断页 D），数值上对应比例 200%，**不等于**人工觉得好的 1.4。  
- Lines 1.4 ≈ Exact 39 的观感接近，暗示 PPT「单倍」对 PingFang 15pt 大约在 39/1.4 ≈ **28pt** 量级——接近 win 行盒 21pt 之上的某种单倍定义，**不能**推导成通用系数。

---

## 6. 建议修复方案（只方案，本阶段不实施）

1. **先用 IR dump 钉死**该节点的 `lineHeight.unit/value`、`characters` 中 `\n` 位置、`leadingTrim`、`sourceRenderBounds`。  
2. **区分「段内多行」与「多段单行」**：  
   - 若 Figma 视觉行来自同一逻辑段的换行，评估是否应减少错误的段切分，或在段间写入与行高一致的 `spcAft`（需用对照实验定公式，禁止拍脑袋 39/1.4）。  
3. **PIXELS → Exact 保留为默认数学映射**，但增加「单行段落 + PIXELS 行高」回归：用诊断 PPTX 在真实 PPT 测量基线距；若证实 `lnSpc` 不作用于段间，则修复点在 **段落模型 / 段距**，不是改全局 pt 系数。  
4. **不要**全局改成 39pt 或 1.4；不要固定 Y 偏移；不要栅格化该文本。  
5. 补充自动化：解析 OOXML 断言段落数、`spcPts`、框几何；视觉仍标人工。

---

## 7. 仍需人工验证

1. Figma 选中该文本 → 插件导出后点「下载 IR 诊断」，提供含该节点的 `figma-export-ir-debug.json`。  
2. Figma 右侧确认：行高 UI 是 **Fixed 40** 还是 **Lines/Percent**；与 IR 是否一致。  
3. 用 Microsoft PowerPoint 打开 `fixtures/exports/line-spacing-diag.pptx`，逐页对比 A–F 与 Figma。  
4. 在现有 `Figma_Export.pptx` 上：  
   - 将两段合并为一段后再设 Exactly 30pt；  
   - 或保持两段，只加 `After: 15pt/30pt` 试探段距是否才是控制量。  
5. 字体下拉确认渲染面是否仍为 PingFang SC（有无回退）。

---

## 8. 本阶段未做事项（遵守约束）

- 未修改 `src/**` 生产转换行为。  
- 未把全局行距改为 39pt 或 1.4。  
- 未加固定 Y 偏移、未改框几何、未转图片、未按文案硬编码。  
- 未将 OOXML「写对」等同于视觉通过。
