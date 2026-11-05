# T1 / T2 — 文字排版与透明度

## T1

- 左/中/右对齐文本块，固定框与自动高度各一。
- 检查：框原点相对 Frame；中/右对齐在安全加宽后锚点不漂。

## T2

- TextNode.opacity < 1
- Fill Paint.opacity < 1
- 半透明 Group 含重叠的两个矩形 + 一段文字

## 期望

- 叶子透明度进入 PPTX alpha。
- 半透明多子 Group → 整组 PNG，而非子元素各自 × 组透明度。

## 状态

待验证
