# APP STYLE GUIDE

> Version 0.1.0 · 2026-09-02  
> 本文档是项目视觉、交互、内容和用户定位的唯一基础规范。新功能开始前先检查本文件，完成后记录偏差与新增规则。

## 1. Product Direction

### 核心定位

这是一个用于展示、实验和记录游戏开发过程的个人应用。它既是作品集，也是持续生长的创作工具。

### 产品关键词

`TECHNICAL` · `MODULAR` · `PRECISE` · `DARK` · `EXPERIMENTAL` · `PLAYABLE`

### 设计参考方向

- TouchDesigner：实时数据、节点系统、参数面板、性能反馈
- Max/MSP：模块化结构、patch cable、明确的输入与输出
- 3D 编辑器：空间网格、坐标、视口、层级和检查器
- 开发工具：高信息密度、清楚的状态、可追踪的变化

参考这些工具的系统思维，不直接复制它们的商标、图标或界面布局。

## 2. Visual System

### 2.1 Color Tokens

界面以黑色层级为基础，只使用克莱因蓝作为主要强调色。状态色仅用于必要的系统反馈。

```css
:root {
  /* Background hierarchy */
  --color-black: #000000;
  --color-bg: #050505;
  --color-surface-1: #0b0b0d;
  --color-surface-2: #121216;
  --color-surface-3: #1a1a20;

  /* International Klein Blue-inspired accent */
  --color-accent: #002fa7;
  --color-accent-bright: #1748d4;
  --color-accent-soft: rgba(0, 47, 167, 0.18);
  --color-accent-line: rgba(23, 72, 212, 0.55);

  /* Text */
  --color-text: #f2f2f4;
  --color-text-secondary: #a0a0aa;
  --color-text-disabled: #5b5b64;

  /* Structure */
  --color-line: #28282f;
  --color-grid: rgba(255, 255, 255, 0.08);

  /* Feedback only — never decorative */
  --color-success: #3ddc97;
  --color-warning: #ffb020;
  --color-error: #ff4d5e;
}
```

#### 色彩规则

1. 克莱因蓝只用于可操作元素、当前选择、关键数值和焦点。
2. 单个视图内蓝色面积建议不超过总面积的 15%。
3. 普通正文不使用蓝色，避免降低阅读清晰度。
4. 成功、警告和错误色只表达真实状态，不作为装饰色。
5. 3D 场景的对象颜色可以独立，但应用外壳仍遵循单一强调色规则。

### 2.2 Typography

#### 字体角色

- UI 与正文：`Inter`, `Arial`, `Microsoft YaHei`, sans-serif
- 参数、坐标、时间和代码：`JetBrains Mono`, `Consolas`, monospace
- 不使用装饰性衬线字体

#### 字号层级

| Token | Size | 用途 |
|---|---:|---|
| `display` | 48–72 px | 页面关键标题，谨慎使用 |
| `heading-1` | 32 px | 页面标题 |
| `heading-2` | 22 px | 面板或功能标题 |
| `body` | 14–16 px | 正文与说明 |
| `ui` | 12–13 px | 按钮、标签、表格 |
| `micro` | 10–11 px | 时间、状态、技术元数据 |

技术标签使用大写英文和适度字距，例如 `SCENE / OBJECT_01 / ACTIVE`。中文用于解释，英文用于短标签和技术状态。

### 2.3 Grid and Spacing

基础间距单位为 `4px`。

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-6: 24px;
--space-8: 32px;
--space-12: 48px;
--space-16: 64px;
```

- 桌面布局采用 12 栏网格
- 工具面板宽度优先使用 280–360 px
- 内容区最大宽度为 1440 px
- 面板间距紧凑，页面章节间距宽松
- 所有数值尽量落在 4 px 网格上

### 2.4 Shape and Surface

- 默认圆角：`2px`
- 浮层最大圆角：`4px`
- 不使用大面积胶囊按钮
- 边框：`1px solid var(--color-line)`
- 阴影只用于层级分离，不制造柔软或拟物效果
- 面板通过明度、边框和网格区分，不使用彩色卡片堆叠

## 3. UI Language

### 3.1 Application Shell

推荐布局：

```text
┌─────────────────────────────────────────────────────┐
│ APP / PROJECT    STATUS           FPS / SAVE / MENU │
├──────────────┬──────────────────────────┬───────────┤
│              │                          │           │
│ PROJECT      │                          │ INSPECTOR │
│ / SCENE      │        VIEWPORT          │ / PARAMS  │
│ / DEVLOG     │                          │           │
│              │                          │           │
├──────────────┴──────────────────────────┴───────────┤
│ TIMELINE / CONSOLE / DEVELOPMENT NOTES             │
└─────────────────────────────────────────────────────┘
```

小屏设备按以下顺序折叠：

1. 保留主视口
2. 项目导航变为抽屉
3. Inspector 变为底部面板
4. Console 默认折叠

### 3.2 Component Rules

#### Button

- Primary：克莱因蓝背景，白色文字
- Secondary：透明背景，灰色边框
- Danger：仅危险操作使用红色
- Hover：提高亮度，不大幅移动
- Focus：必须显示 `2px` 蓝色焦点框

#### Panel

- 标题栏高度：32 px
- 标题使用 `micro` 字号和大写技术标签
- 可折叠面板必须显示展开状态
- 参数名称左对齐，数值右对齐

#### Node

- 输入端口位于左侧，输出端口位于右侧
- 选中节点使用蓝色边框，不改变整个节点颜色
- 连线颜色默认灰色，活动数据流使用蓝色
- 端口必须有文字或可访问标签，不能只靠颜色识别

#### Status

标准状态词：

- `DRAFT`：仅有概念
- `PROTOTYPE`：可以测试核心玩法
- `TESTING`：正在收集反馈
- `OPTIMIZING`：正在改善性能或体验
- `RELEASED`：可公开访问
- `ARCHIVED`：停止开发但保留记录

## 4. Interaction

### 操作原则

1. 用户的操作必须立即产生可见反馈。
2. 参数变化应尽可能实时更新视口。
3. 删除、覆盖和重置必须可以撤销或二次确认。
4. 技术状态需要明确显示，不依靠猜测。
5. 初学者默认只看到必要控件，高级参数逐步展开。

### Motion

- 微交互：120–180 ms
- 面板展开：180–240 ms
- 页面切换：240–320 ms
- 缓动：`cubic-bezier(0.2, 0.8, 0.2, 1)`
- 不使用无意义的循环动画
- 支持 `prefers-reduced-motion`

### 3D Viewport Controls

统一控制方式：

- 左键拖动：旋转
- 滚轮：缩放
- 右键拖动：平移
- 点击对象：选择
- `F`：聚焦选择对象（未来功能）
- `Esc`：取消选择（未来功能）

网格位于 XZ 平面，主要轴线比次级网格更亮，并随距离渐隐。

## 5. Content System

### 内容层级

```text
App
├── Profile：创作者身份与方向
├── Projects：游戏和交互项目
│   ├── Overview：概念、状态、技术
│   ├── Builds：可预览版本
│   ├── Devlog：按时间记录开发过程
│   ├── Decisions：设计与技术选择
│   └── Metrics：性能和试玩结果
├── Experiments：小型视觉或代码实验
├── Learning：课程、笔记和反思
└── Roadmap：未来功能与优先级
```

### 写作语气

- 简洁、准确、可验证
- 先写结果，再写实现过程
- 区分事实、观察和推测
- 记录失败和取舍，不只记录成功
- 每条优化说明“问题、改变、验证结果”

### 开发日志模板

```markdown
## YYYY-MM-DD / BUILD 000

**Status:** DRAFT | PROTOTYPE | TESTING | OPTIMIZING | RELEASED

### Goal

本次只解决什么问题？

### Changes

- 修改了什么：
- 没有修改什么：

### Test

- 预览地址：
- 测试设备：
- 操作步骤：
- 结果：

### Decision

为什么选择这个方案？放弃了什么方案？

### Next

下一级只增加什么？
```

### 游戏优化记录模板

```markdown
## OPT / 000 — 优化名称

- 问题：
- 假设：
- 基线数据：
- 修改变量：
- 修改后数据：
- 玩家反馈：
- 结论：保留 / 调整 / 回退
```

## 6. User Base

### Primary User — Creator / 本人

- 目标：快速制作、预览和记录游戏实验
- 需要：清楚的项目状态、参数、版本和下一步
- 常用路径：打开项目 → 运行预览 → 修改 → 测试 → 写日志
- 成功标准：能够解释每次改变，并可以恢复或比较版本

### Secondary User — Classmate / Teacher

- 目标：快速理解作业完成了什么以及如何操作
- 需要：简洁说明、明确控制方式、稳定的预览链接
- 常用路径：打开分享链接 → 操作场景 → 阅读开发说明
- 成功标准：无需口头指导即可完成基本交互

### Future User — Player / Visitor

- 目标：试玩游戏并理解开发过程
- 需要：快速进入游戏、清楚反馈、简短开发故事
- 常用路径：发现项目 → 试玩 → 查看更新与优化记录
- 成功标准：理解核心玩法，并愿意再次查看新版本

## 7. Future Content Backlog

使用下面的表格记录未来想创建的内容。每项在开始开发前必须写明用户价值和完成标准。

| ID | 内容 / 功能 | 用户 | 价值 | 优先级 | 状态 |
|---|---|---|---|---|---|
| C-001 | React Three Fiber 基础场景 | Classmate | 展示 3D 基础概念 | P0 | RELEASED |
| C-002 | 坐标与 Transform 学习页 | Creator | 理解 position、rotation、scale | P0 | NEXT |
| C-003 | 可选择的 3D 对象 | Creator | 学习事件和 React 状态 | P1 | DRAFT |
| C-004 | 星屑收集试玩页面 | Player | 体验第一个完整游戏 | P1 | PROTOTYPE |
| C-005 | 游戏优化对比记录 | Visitor | 看见迭代前后的差异 | P1 | DRAFT |
| C-006 | 节点式实验导航 | Creator | 连接项目、日志与实验 | P2 | IDEA |

优先级定义：

- `P0`：当前学习或发布的必要内容
- `P1`：完成当前阶段后立即有价值
- `P2`：有价值，但尚不影响核心体验
- `P3`：仅保存想法，暂不投入开发

## 8. Accessibility and Quality

- 正文与背景对比度至少满足 WCAG AA
- 所有可操作元素必须支持键盘焦点
- 不用颜色作为唯一状态提示
- Canvas 必须提供文本说明或可访问替代内容
- 触控目标至少为 44 × 44 px
- 桌面、平板和手机都要测试
- 公开版本不显示本地绝对路径或私人信息
- 动画保持稳定，目标帧率为 60 FPS
- 发布前执行 `npm run build` 并检查浏览器控制台

## 9. Definition of Done

一个页面或功能只有同时满足以下条件才算完成：

- [ ] 符合黑色 + 克莱因蓝视觉系统
- [ ] 使用既定间距和文字层级
- [ ] 桌面端与移动端均可操作
- [ ] 键盘焦点和状态提示清楚
- [ ] 没有无关 UI、动画或依赖
- [ ] 本地预览通过
- [ ] 生产构建通过
- [ ] Obsidian 开发日志已更新
- [ ] 未来下一步已明确

## 10. Change Log

### 0.1.0 / 2026-09-02

- 建立黑色与克莱因蓝视觉基础
- 定义技术型、模块化 UI 语言
- 建立内容架构与开发日志模板
- 建立三类核心用户画像
- 建立未来内容 backlog 和完成标准
