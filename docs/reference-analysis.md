# 开源方案研究与技术取舍

基于对下列仓库 **源码 / 许可证 / 架构** 的阅读（不只 README），对照本项目现有
`Reader → IR → Compat → Converter → OOXML postprocess` 管线做取舍。  
分析日期以仓库公开状态为准；结论服务于**可复用转换引擎**，不拼装多项目代码。

| 项目 | SPDX / 许可 | Stars（约） | 与本项目关系 |
|---|---|---|---|
| [FigDeck](https://github.com/DaftdragonAIlab/figdeck-plugin) | 未声明（默认版权保留） | ~2 | 同域 Figma 插件；**思想借鉴，不复制** |
| [svg2ooxml](https://github.com/BramAlkema/svg2ooxml) | **AGPL-3.0** + 商业双许可 | ~8 | DrawingML 能力标杆；**禁止直接并入** |
| [OpenDesign](https://github.com/Pandemonium-Research/OpenDesign) | MIT | ~4 | PPTX 仅为 deck 模板导出 |
| [html-to-editable-pptx](https://github.com/Hasasasa/html-to-editable-pptx) | MIT | ~88 | HTML→PPT 审计工作流 |
| [DOM Native PPTX](https://github.com/UtenKekkoDev/dom-native-pptx) | MIT | ~0 | 原生优先 + 显式栅格策略 |
| [Fig2PPT-React](https://github.com/rohit1521/Fig2PPT-React) | MIT | ~0 | 插件脚手架；转换过简 |

---

## 1. FigDeck (`code.js`)

### 值得吸收

- **有效透明度**：`effectiveOpacity = parentOpacity × nodeOpacity`，容器递归下传。
- **绝对坐标**：一律 `absoluteBoundingBox` / 缺失时 `absoluteRenderBounds`，相对 Frame 原点换算；容器无 bbox 时仍递归（避免 INSTANCE 丢子树）。
- **局部 PNG**：复杂叶子（VECTOR/STAR/POLYGON/布尔、图片填充、效果、叶子透明度）`exportAsync` + **用 renderBounds 放置**，避免细线/描边被 AABB 拉伸。
- **Fill 透明度单独提取**（`fillLayerOpacity` / 文本 `fillOpacity`），与 Layer opacity 区分。
- 诊断向自我测试（INSTANCE bbox、报告字符串）——利于插件内调试。

### 局限 / 不适合直接集成

- **无 IR**：AST 直接喂 UI 侧 pptx 生成，难做纯函数测试与策略分叉。
- **未发现显式 `isMask` 分段**：复杂遮罩依赖「叶子/效果 → PNG」偶然保真，容器默认仍递归，风险与我们早期「拆散 Mask」同类。
- 文本高度/宽度有经验裕量；与我们「框几何保真（`TEXT_WIDTH_SCALE = 1`）」目标冲突时以本项目规则为准。
- 许可证未声明 → **不可复制粘贴源码**；仅吸收算法思想并自行实现。

### 对本架构的影响（已落地）

| FigDeck 行为 | 本项目 |
|---|---|
| 容器一律 `traverse` 子节点，**绝不**因多子合并 | `compat`：含 TEXT 的 GROUP/FRAME 保持 native 递归 |
| 仅叶子 VECTOR/图片填充/效果 → PNG | 同；另对无 TEXT 插画簇整组 PNG |
| 容器有 fill/stroke → 先推 shape 再下钻 | `readFrameChrome` |
| ELLIPSE+IMAGE → `exportAsync` PNG | `tryReadImageFill` 仅 RECT；椭圆走 PNG 保圆 |
| `dashPattern` → solid/dash/dot | `reader/dash.ts` + `IRStroke.dash` |
| CDN 加载 pptxgenjs | **不采用**；本地 esbuild 打包 |

额外强化：Mask 分段整组 PNG、文本 Fill opacity 回退与底色烘焙、clipsContent 溢出整框 PNG。

---

## 2. svg2ooxml

### 值得吸收（思想层）

- 完整 **IR + pipeline + policy**：clip/mask 有 native / EMF / raster 降级梯。
- DrawingML `custGeom`、渐变、滤镜、变换文档化充分；Companion `openxml-audit` 用实证约束 PowerPoint 行为。
- 「可编辑优先 + 可解释降级」与本项目目标一致。

### 关键限制

- **AGPL-3.0**：并入闭源/未开源插件会触发传染义务；无商业许可则 **不得拷贝其 Python 实现**。
- 栈为 Python SVG→PPTX，不是 Figma Plugin；集成成本高（WASM/桥/双运行时）。
- 动画 / CSS 级联对本插件范围过重。

### 取舍

**P3 阶段仅借鉴规范与降级阶梯命名**（Native → OOXML → Raster），自研最小 DrawingML 扩展（本仓库已有 `postprocess` / `pictureShape`）。  
不引入 svg2ooxml 依赖、不 vendoring 其源码。

---

## 3. OpenDesign

### 实际实现（`app/src/lib/export/pptx.ts`）

- 输入是 AI 生成的 **Deck 结构化数据**（title / bullets / notes），不是任意 Figma 节点树。
- 直接 `pptxgenjs` 写固定 16:9 布局；**无几何 IR、无遮罩、无图片填充语义**。

### 取舍

吸收「多产物导出编排 + pptxgenjs 可编辑文本」产品思路；**不吸收其 PPTX 映射**（与 Figma 场景无关）。Figma token ingest 与本机插件管线正交。

---

## 4. html-to-editable-pptx

### 值得吸收

- **多阶段**：预扫风险 → 测量 → 组装 → 结构化自检 → **视觉 audit 对比图**。
- 复杂装饰 **局部截图兜底**，正文保持可编辑。
- `audited.html` 工作副本、增量重跑（`--only-slides`）利于回归迭代。

### 局限

- 输入是 HTML/CSS，不是 Figma SceneGraph。
- Agent Skill 工作流假设人工/子代理看图，本插件需自动化单测 + 人工 Figma/PPT 清单。

### 取舍

将「预检 / 报告 reason / 视觉对比物料」映射到本项目的 `IRReport` + `fixtures/` 人工清单；不引入 Playwright HTML 管线。

---

## 5. DOM Native PPTX

### 值得吸收

- **`RASTER_POLICY.md`**：默认拒绝栅格；仅显式 `data-pptx-raster` 角色允许；受保护文本不得进栅格容器。
- 失败报告含选择器 / 原因 / 修复建议（fail-closed）。
- 源码地图明确依赖边界（PptxGenJS 写对象，自有 policy 胶水）。

### 局限

- 面向「幻灯片安全 HTML」，非 Figma。
- 严格 fail-closed 对设计工具导出过严（Figma 插画常必须局部 PNG）。

### 取舍

吸收政策思维：本项目等价规则为  
「默认 native；Mask / clipsContent 溢出 / 复杂矢量 → **显式局部 PNG + report.reason**；禁止默默整页截图」。  
不复制其 DOM 解析器。

---

## 6. Fig2PPT-React

### 实际实现（`src/plugin/controller.ts`）

- `findAll(TEXT)` + 矩形图片填充；另 **整 Frame `exportAsync` 作 thumbnail**。
- 坐标用 **局部 `node.x/y`**，未处理嵌套变换与 Mask。
- 本质是 React 插件模板 + 极简导出。

### 取舍

仅作插件 UI/webpack 参考；**转换逻辑不可取**（嵌套坐标与保真均不足）。本项目已用 esbuild + 自有 Reader，无需迁移其脚手架。

---

## 综合决策（本项目统一架构）

| 能力 | 采用来源 | 实现位置 |
|---|---|---|
| 绝对盒相对 Frame | FigDeck 思想 | `reader/geometry.ts` |
| Mask 兄弟分段 + 整组 PNG | 自研（修复拆散根因） | `reader/mask.ts` + `reader.ts` |
| renderBounds / PNG 宽高比放置 | FigDeck + 自研 | `image-placement.ts` |
| 文本 Fill opacity 回退 + 底色烘焙 | 自研（WPS 兼容） | `reader/colors.ts` + `converter/text.ts` |
| 显式降级 reason | DOM Native / html2pptx 思想 | `IRReport` + `compat.ts` |
| DrawingML 路径/动画 | svg2ooxml **仅作 P3 规范参考** | 未集成库 |
| HTML 审计流水线 | html2pptx 思想 | `fixtures/` 人工对比 |

**禁止**：把 AGPL 代码并入仓库；为单页硬编码坐标；默认整 Frame 栅格化；为过测试删除断言。
