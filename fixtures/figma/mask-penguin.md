# M1 — 企鹅 Mask Group

## 复现结构（示例）

```
Frame
  └─ Group "Penguin"
       ├─ VECTOR/BOOLEAN (isMask=true, maskType=ALPHA)   ← 剪影
       └─ 若干填充矢量 / 分组内容
```

## 期望

- 导出为**一个**局部图片（或等价的不可拆对象），位置相对 Frame 正确。
- 不得把遮罩与内容拆成多个错位图层。
- 同页其它文本/形状仍可编辑。

## 状态

待验证（需真实 .fig + PowerPoint 截图放入 `fixtures/exports/`）
