/** 模板定义：用于一键插入常见图表骨架 */
export interface DiagramTemplate {
  /** 唯一标识 */
  id: string
  /** 展示名称 */
  label: string
  /** Mermaid 图表类型 */
  type: string
  /** 模板代码 */
  code: string
}

/** 内置模板集合，覆盖 Mermaid 常用图表 */
export const TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flowchart',
    label: '流程图',
    type: 'flowchart',
    code: `flowchart TD
    A([开始]) --> B{条件判断}
    B -- 满足 --> C[处理逻辑]
    B -- 不满足 --> D[提示信息]
    C --> E([结束])
    D --> E

    classDef ok fill:#e8f7ec,stroke:#4caf50
    classDef warn fill:#fdecec,stroke:#e57373
    class E ok
    class D warn
`
  },
  {
    id: 'sequence',
    label: '时序图',
    type: 'sequence',
    code: `sequenceDiagram
    autonumber
    participant U as 用户
    participant S as 服务端
    participant D as 数据库

    U->>S: 提交请求
    S->>D: 查询数据
    D-->>S: 返回结果
    S-->>U: 响应数据
    Note over U,S: 全链路完成
`
  },
  {
    id: 'class',
    label: '类图',
    type: 'class',
    code: `classDiagram
    class Animal {
      +String name
      +int age
      +eat() void
    }
    class Dog {
      +bark() void
    }
    class Cat {
      +purr() void
    }
    Animal <|-- Dog
    Animal <|-- Cat
`
  },
  {
    id: 'state',
    label: '状态图',
    type: 'state',
    code: `stateDiagram-v2
    [*] --> 待支付
    待支付 --> 已支付: 付款
    待支付 --> 已取消: 超时
    已支付 --> 已发货: 出库
    已发货 --> [*]
    已取消 --> [*]
`
  },
  {
    id: 'er',
    label: 'ER 图',
    type: 'er',
    code: `erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : includes

    USER {
      string id
      string name
    }
    ORDER {
      string id
      datetime createdAt
    }
`
  },
  {
    id: 'gantt',
    label: '甘特图',
    type: 'gantt',
    code: `gantt
    title 项目排期
    dateFormat YYYY-MM-DD
    axisFormat %m-%d

    section 设计
    需求梳理      :a1, 2024-01-01, 5d
    原型设计      :a2, after a1, 4d

    section 开发
    接口开发      :b1, after a2, 7d
    前端开发      :b2, after a2, 8d

    section 验收
    联调测试      :c1, after b2, 4d
`
  },
  {
    id: 'pie',
    label: '饼图',
    type: 'pie',
    code: `pie title 流量来源占比
    "搜索引擎" : 45
    "直接访问" : 30
    "社交媒体" : 18
    "其他" : 7
`
  },
  {
    id: 'mindmap',
    label: '思维导图',
    type: 'mindmap',
    code: `mindmap
  root((产品规划))
    用户体验
       onboarding
       帮助中心
    功能模块
      编辑器
      预览
      导出
    技术选型
      渲染引擎
      存储方案
`
  },
  {
    id: 'timeline',
    label: '时间线',
    type: 'timeline',
    code: `timeline
    title 版本演进
    section 起步
      2023 Q1 : 立项
              : 技术预研
    section 成长
      2023 Q3 : 首个版本
              : 用户反馈
    section 完善
      2024 Q1 : 性能优化
`
  },
  {
    id: 'gitgraph',
    label: 'Git 图',
    type: 'gitgraph',
    code: `gitGraph
    commit id: "init"
    commit id: "feat: 编辑器"
    branch develop
    commit id: "feat: 预览"
    checkout main
    commit id: "fix: 样式"
    merge develop
    commit id: "release v1.0"
`
  },
  {
    id: 'quadrant',
    label: '象限图',
    type: 'quadrant',
    code: `quadrantChart
    title 需求优先级
    x-axis 低收益 --> 高收益
    y-axis 低成本 --> 高成本
    quadrant-1 立即做
    quadrant-2 计划做
    quadrant-3 不做
    quadrant-4 可选做
    登录优化: [0.7, 0.3]
    导出功能: [0.8, 0.5]
    主题美化: [0.4, 0.2]
`
  },
  {
    id: 'c4',
    label: 'C4 架构',
    type: 'c4',
    code: `C4Context
    title 系统上下文
    Person(user, "用户", "使用图表工具")
    System(studio, "图表工作室", "编辑与导出")
    System_Ext(browser, "浏览器内核", "负责渲染")

    Rel(user, studio, "使用")
    Rel(studio, browser, "依赖")
`
  }
]

/** 初始文档内容 */
export const DEFAULT_DOC = TEMPLATES[0].code

/** 图表类型识别规则（按顺序匹配） */
const TYPE_RULES: Array<{ type: string; pattern: RegExp }> = [
  { type: 'flowchart', pattern: /^\s*(flowchart|graph)\b/m },
  { type: 'sequence', pattern: /^\s*sequenceDiagram\b/m },
  { type: 'class', pattern: /^\s*classDiagram\b/m },
  { type: 'state', pattern: /^\s*stateDiagram(-v2)?\b/m },
  { type: 'er', pattern: /^\s*erDiagram\b/m },
  { type: 'gantt', pattern: /^\s*gantt\b/m },
  { type: 'pie', pattern: /^\s*pie\b/m },
  { type: 'journey', pattern: /^\s*journey\b/m },
  { type: 'mindmap', pattern: /^\s*mindmap\b/m },
  { type: 'timeline', pattern: /^\s*timeline\b/m },
  { type: 'gitgraph', pattern: /^\s*gitGraph\b/m },
  { type: 'quadrant', pattern: /^\s*quadrantChart\b/m },
  { type: 'xychart', pattern: /^\s*xychart(-beta)?\b/m },
  { type: 'requirement', pattern: /^\s*requirementDiagram\b/m },
  { type: 'c4', pattern: /^\s*C4(Context|Container|Component|Dynamic|Deployment)\b/m },
  { type: 'sankey', pattern: /^\s*sankey(-beta)?\b/m },
  { type: 'block', pattern: /^\s*block(-beta)?\b/m },
  { type: 'architecture', pattern: /^\s*architecture(-beta)?\b/m },
  { type: 'packet', pattern: /^\s*packet(-beta)?\b/m },
  { type: 'kanban', pattern: /^\s*kanban\b/m }
]

/** 图表类型的中文名称 */
export const TYPE_LABELS: Record<string, string> = {
  flowchart: '流程图',
  sequence: '时序图',
  class: '类图',
  state: '状态图',
  er: 'ER 图',
  gantt: '甘特图',
  pie: '饼图',
  journey: '用户旅程',
  mindmap: '思维导图',
  timeline: '时间线',
  gitgraph: 'Git 图',
  quadrant: '象限图',
  xychart: 'XY 图',
  requirement: '需求图',
  c4: 'C4 架构',
  sankey: '桑基图',
  block: '块图',
  architecture: '架构图',
  packet: '数据包图',
  kanban: '看板',
  unknown: '未知'
}

/**
 * 识别 Mermaid 代码对应的图表类型。
 * @param code Mermaid 源码
 * @returns 规范化类型标识
 */
export function detectType(code: string): string {
  const source = String(code || '')
  for (const rule of TYPE_RULES) {
    if (rule.pattern.test(source)) return rule.type
  }
  return 'unknown'
}
