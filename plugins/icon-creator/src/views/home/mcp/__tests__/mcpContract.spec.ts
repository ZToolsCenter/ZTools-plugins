import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { McpCanvasOverview, McpEditorGateway, McpObjectSummary } from '../mcpGatewayTypes'
import { dispatchMcpOperation, listOperationNames } from '../mcpOperations'
import { createMockGateway } from './mockGateway'

/**
 * MCP 操作契约测试（表驱动，覆盖 OPERATIONS 注册表全部操作）。
 *
 * 每个操作断言两条契约：
 * 1. 合法最小入参：统一用 { operation, args: {...} } 嵌套形态传入，
 *    断言 ok=true 且参数被正确展开、路由到对应网关方法——
 *    历史上调度器曾不展开嵌套 args，导致所有带参操作误报“缺少参数”，本表防止回归；
 * 2. 非法入参：断言 ok=false 且 message 携带 handler 校验抛出的可读中文错误片段。
 *    无参数校验的操作（纯查询/无入参）通过注入网关异常覆盖失败路径，
 *    断言调度器把异常包装为“操作 X 失败”的结构化错误而不向外抛。
 *
 * 会读取网关方法返回值的操作（delete_objects 读 listObjects().length、
 * get_object 校验 getObjectSummary 结果等）通过 validOverrides 注入特定返回值；
 * 其余未配置方法由 createMockGateway 自动补齐为返回 undefined 的 vi.fn。
 */

/** 网关异常注入时统一抛出的错误文案，用于断言错误被透传进响应 message。 */
const GATEWAY_ERROR = '模拟网关异常'

/**
 * 构造测试用对象摘要。
 * @param overrides 覆盖的摘要字段（如 id/name/masked）
 * @returns 完整的 McpObjectSummary
 */
function makeSummary(overrides: Partial<McpObjectSummary> = {}): McpObjectSummary {
  return {
    id: 'obj-1',
    name: '示例对象',
    type: 'rectangle',
    visible: true,
    locked: false,
    left: 10,
    top: 20,
    // 中心点 (10,20) + 显示尺寸 100×80 推得的 angle=0 包围盒左上角
    bboxLeft: -40,
    bboxTop: -20,
    width: 100,
    height: 80,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    opacity: 1,
    fill: '#ff0000',
    stroke: null,
    strokeWidth: 0,
    shadow: null,
    masked: false,
    zIndex: 0,
    ...overrides
  }
}

/**
 * 构造测试用画布概览。
 * @param overrides 覆盖的概览字段
 * @returns 完整的 McpCanvasOverview
 */
function makeOverview(overrides: Partial<McpCanvasOverview> = {}): McpCanvasOverview {
  return {
    canvasWidth: 512,
    canvasHeight: 512,
    canvasBg: '#ffffff',
    zoom: 1,
    showPixelGrid: false,
    snapToPixelGrid: false,
    pixelGridSize: 8,
    keylineTemplate: 'none',
    activeArtboardId: 'ab-1',
    artboardCount: 1,
    objectCount: 1,
    selectionCount: 0,
    canUndo: true,
    canRedo: false,
    historyLength: 1,
    historyIndex: 1,
    activeObjectIds: [],
    ...overrides
  }
}

/**
 * 按方法名从网关上取回 mock 实例（显式 overrides 与自动补齐的方法共享同一实例），
 * 供断言“网关方法收到预期实参”使用。
 */
function readGatewayMock(gateway: McpEditorGateway, method: string): Mock {
  return (gateway as unknown as Record<string, Mock>)[method]
}

/** 非法入参用例定义。 */
interface InvalidCase {
  /** 嵌套形态的 args 字段（配合 operation 名组装请求；缺省为空 args） */
  args?: Record<string, unknown>
  /** 期望 message 包含的中文错误片段；缺省时断言调度器的“操作 X 失败”包装文案 */
  fragment?: string
  /** 注入网关异常的方法名：该 handler 无参数校验，让网关方法抛错以覆盖失败路径 */
  throwMethod?: string
}

/** 单个操作的契约用例：合法最小入参 + 非法入参两组断言。 */
interface OperationContract {
  /** 合法最小入参的 args 字段（嵌套形态；缺省为空 args） */
  validArgs?: Record<string, unknown>
  /** 合法用例需要显式覆盖的网关方法（提供返回值或 Promise），缺省全部走自动补齐 */
  validOverrides?: () => Partial<McpEditorGateway>
  /** 断言该网关方法被恰好调用一次且收到预期实参（toEqual 语义，undefined 字段可省略） */
  expectCall?: { method: string; args: unknown[] }
  /** 断言成功响应的 data（toEqual 语义；缺省不断言 data） */
  expectData?: unknown
  /** 非法入参用例（至少一个） */
  invalid: InvalidCase[]
}

/**
 * 全操作契约用例表：键名必须与 OPERATIONS 注册表一一对应
 * （末尾有双向覆盖守卫，注册表新增操作而未补用例时测试变红）。
 */
const OPERATION_CONTRACTS: Record<string, OperationContract> = {
  /* ── 查询 ── */
  get_overview: {
    validOverrides: () => ({ getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'getOverview', args: [] },
    expectData: makeOverview(),
    invalid: [{ throwMethod: 'getOverview' }]
  },
  list_objects: {
    validOverrides: () => ({ listObjects: vi.fn(() => [makeSummary()]) }),
    expectCall: { method: 'listObjects', args: [] },
    expectData: { objects: [makeSummary()] },
    invalid: [{ throwMethod: 'listObjects' }]
  },
  get_object: {
    validArgs: { objectId: 'obj-1' },
    // getObjectSummary 必须返回摘要对象（auto-mock 的 undefined 会触发“未找到对象”分支）
    validOverrides: () => ({ getObjectSummary: vi.fn(() => makeSummary({ id: 'obj-1' })) }),
    expectCall: { method: 'getObjectSummary', args: ['obj-1'] },
    expectData: makeSummary({ id: 'obj-1' }),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      // 未找到用例：auto-mock 返回 undefined 等价于网关查不到对象
      { args: { objectId: 'ghost' }, fragment: '未找到对象: ghost' }
    ]
  },
  find_objects: {
    // 按命名前缀一次召回一组条形（lbar-* 三条）：mock 额外混入 1 个不相关对象验证过滤
    validArgs: { name: 'lbar-' },
    validOverrides: () => ({
      listObjects: vi.fn(() => [
        makeSummary({ id: 'obj-1', name: 'lbar-left' }),
        makeSummary({ id: 'obj-2', name: 'lbar-mid' }),
        makeSummary({ id: 'obj-3', name: 'lbar-right' }),
        makeSummary({ id: 'obj-4', name: '背景' })
      ])
    }),
    expectCall: { method: 'listObjects', args: [] },
    expectData: {
      objects: [
        makeSummary({ id: 'obj-1', name: 'lbar-left' }),
        makeSummary({ id: 'obj-2', name: 'lbar-mid' }),
        makeSummary({ id: 'obj-3', name: 'lbar-right' })
      ],
      count: 3
    },
    invalid: [
      { args: {}, fragment: '至少提供 name/type/fill 之一' },
      { args: { name: 'lbar-', nameMatch: 'contains' }, fragment: 'nameMatch 必须是 prefix 或 exact' }
    ]
  },
  get_selection: {
    validOverrides: () => ({
      getSelectionIds: vi.fn(() => ['obj-1']),
      getActiveObjectProps: vi.fn(() => ({ fill: '#ff0000' }))
    }),
    expectData: { ids: ['obj-1'], props: { fill: '#ff0000' } },
    invalid: [{ throwMethod: 'getSelectionIds' }]
  },
  get_selection_svg: {
    // getSelectionSvg 直接被 .then 链式调用，auto-mock 的 undefined 会抛 TypeError，必须注入 Promise
    validOverrides: () => ({ getSelectionSvg: vi.fn(() => Promise.resolve('<svg>选中</svg>')) }),
    expectData: { svg: '<svg>选中</svg>' },
    invalid: [{ throwMethod: 'getSelectionSvg' }]
  },
  list_artboards: {
    validOverrides: () => ({
      listArtboards: vi.fn(() => [{ id: 'ab-1', name: '画板 1', width: 512, height: 512, objectCount: 1, active: true }])
    }),
    expectData: { artboards: [{ id: 'ab-1', name: '画板 1', width: 512, height: 512, objectCount: 1, active: true }] },
    invalid: [{ throwMethod: 'listArtboards' }]
  },
  list_history: {
    validOverrides: () => ({ listHistory: vi.fn(() => [{ index: 0, description: '初始状态', timestamp: 1000 }]) }),
    expectData: { history: [{ index: 0, description: '初始状态', timestamp: 1000 }] },
    invalid: [{ throwMethod: 'listHistory' }]
  },
  list_swatches: {
    validOverrides: () => ({ listSwatches: vi.fn(() => ({ swatches: [{ name: 'brand', color: '#ff0000' }] })) }),
    expectData: { swatches: [{ name: 'brand', color: '#ff0000' }] },
    invalid: [{ throwMethod: 'listSwatches' }]
  },
  list_snapshots: {
    validOverrides: () => ({
      listSnapshots: vi.fn(() => ({ snapshots: [{ name: '快照A', createdAt: 1000, objectCount: 1 }] }))
    }),
    expectData: { snapshots: [{ name: '快照A', createdAt: 1000, objectCount: 1 }] },
    invalid: [{ throwMethod: 'listSnapshots' }]
  },

  /* ── 色板 ── */
  add_swatch: {
    validArgs: { name: 'brand', color: '#ff0000' },
    validOverrides: () => ({ addSwatch: vi.fn(() => ({ swatches: [{ name: 'brand', color: '#ff0000' }] })) }),
    expectCall: { method: 'addSwatch', args: ['brand', '#ff0000'] },
    invalid: [
      { args: {}, fragment: '缺少 name 参数' },
      { args: { name: 'brand' }, fragment: '缺少 color 参数' },
      { args: { name: 'brand', color: '红色' }, fragment: 'color 非法' }
    ]
  },
  remove_swatch: {
    validArgs: { name: 'brand' },
    validOverrides: () => ({ removeSwatch: vi.fn(() => ({ swatches: [] })) }),
    expectCall: { method: 'removeSwatch', args: ['brand'] },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },

  /* ── 画布设置 ── */
  resize_canvas: {
    validArgs: { width: 800, height: 600 },
    validOverrides: () => ({
      resizeCanvas: vi.fn(),
      getOverview: vi.fn(() => makeOverview({ canvasWidth: 800, canvasHeight: 600 }))
    }),
    expectCall: { method: 'resizeCanvas', args: [800, 600] },
    expectData: makeOverview({ canvasWidth: 800, canvasHeight: 600 }),
    invalid: [
      { args: {}, fragment: '至少提供 width 或 height 之一' },
      { args: { width: 5000 }, fragment: 'width 取值范围 1-4096' }
    ]
  },
  set_canvas_background: {
    validArgs: { color: '#00ff00' },
    validOverrides: () => ({ setCanvasBackground: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'setCanvasBackground', args: ['#00ff00'] },
    invalid: [{ args: {}, fragment: '缺少 color 参数' }]
  },
  set_pixel_grid: {
    validArgs: { visible: true, snap: true, size: 16 },
    validOverrides: () => ({ setPixelGrid: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'setPixelGrid', args: [{ visible: true, snap: true, size: 16 }] },
    invalid: [
      { args: {}, fragment: '至少提供 visible / snap / size 之一' },
      // 非布尔值应被视为缺失，三个键都缺失时同样报“至少提供”
      { args: { visible: 'yes' }, fragment: '至少提供 visible / snap / size 之一' }
    ]
  },
  set_keyline: {
    validArgs: { template: 'material', margin: 16 },
    validOverrides: () => ({ setKeyline: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'setKeyline', args: [{ template: 'material', margin: 16 }] },
    invalid: [{ args: {}, fragment: '至少提供 template 或 margin 之一' }]
  },
  list_guides: {
    validOverrides: () => ({
      listGuides: vi.fn(() => ({ guides: [{ id: 'guide-1', orientation: 'horizontal' as const, position: 100 }] }))
    }),
    expectData: { guides: [{ id: 'guide-1', orientation: 'horizontal', position: 100 }] },
    invalid: [{ throwMethod: 'listGuides' }]
  },
  set_guides: {
    validArgs: {
      guides: [
        { orientation: 'horizontal', position: 64 },
        { orientation: 'vertical', position: -20 }
      ]
    },
    validOverrides: () => ({
      setGuides: vi.fn(() => ({
        guides: [
          { id: 'guide-1', orientation: 'horizontal' as const, position: 64 },
          { id: 'guide-2', orientation: 'vertical' as const, position: 0 }
        ]
      }))
    }),
    expectCall: {
      method: 'setGuides',
      args: [[
        { orientation: 'horizontal', position: 64 },
        { orientation: 'vertical', position: -20 }
      ]]
    },
    expectData: {
      guides: [
        { id: 'guide-1', orientation: 'horizontal', position: 64 },
        { id: 'guide-2', orientation: 'vertical', position: 0 }
      ]
    },
    invalid: [
      { args: {}, fragment: '缺少 guides 参数' },
      { args: { guides: 'x' }, fragment: 'guides 必须是数组' },
      { args: { guides: [{ orientation: 'diagonal', position: 10 }] }, fragment: 'orientation 必须是 horizontal 或 vertical' },
      { args: { guides: [{ orientation: 'horizontal', position: 'x' }] }, fragment: 'position 必须是数字' }
    ]
  },
  clear_guides: {
    validOverrides: () => ({ clearGuides: vi.fn(() => ({ guides: [] })) }),
    expectData: { guides: [] },
    invalid: [{ throwMethod: 'clearGuides' }]
  },
  replace_color: {
    validArgs: { from: '#ff0000', to: 'rgb(0, 255, 0)' },
    validOverrides: () => ({
      replaceColor: vi.fn(() => ({ replacedObjects: 3, replacedSlots: 4, from: '#ff0000', to: '#00ff00' }))
    }),
    expectCall: { method: 'replaceColor', args: ['#ff0000', 'rgb(0, 255, 0)'] },
    expectData: { replacedObjects: 3, replacedSlots: 4, from: '#ff0000', to: '#00ff00' },
    invalid: [
      { args: {}, fragment: '缺少 from 参数' },
      { args: { from: '#f00' }, fragment: '缺少 to 参数' },
      { args: { from: '红色', to: '#00ff00' }, fragment: 'from 非法' },
      { args: { from: '#f00', to: 'none' }, fragment: 'to 非法' }
    ]
  },

  /* ── 组件/符号（Symbol）── */
  define_symbol: {
    validArgs: { name: '箭头', objectIds: ['obj-1', 'obj-2'] },
    validOverrides: () => ({
      defineSymbol: vi.fn(() => ({ id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 2, instanceCount: 0 }))
    }),
    expectCall: { method: 'defineSymbol', args: ['箭头', ['obj-1', 'obj-2']] },
    expectData: { id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 2, instanceCount: 0 },
    invalid: [
      { args: { objectIds: ['obj-1'] }, fragment: '缺少 name 参数' },
      { args: { name: '箭头' }, fragment: '缺少 objectIds 参数' },
      { args: { name: '箭头', objectIds: 'obj-1' }, fragment: '缺少 objectIds 参数' }
    ]
  },
  list_symbols: {
    validOverrides: () => ({
      listSymbols: vi.fn(() => ({
        symbols: [{ id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 2, instanceCount: 3 }]
      }))
    }),
    expectData: {
      symbols: [{ id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 2, instanceCount: 3 }]
    },
    invalid: [{ throwMethod: 'listSymbols' }]
  },
  insert_symbol_instance: {
    validArgs: { symbolId: 'symbol-1', x: 128, y: 64, anchor: 'top-left' },
    validOverrides: () => ({
      insertSymbolInstance: vi.fn(() =>
        Promise.resolve({ objectId: 'obj-inst-1', symbolId: 'symbol-1', symbolInstanceId: 'symbol-instance-1' })
      )
    }),
    expectCall: {
      method: 'insertSymbolInstance',
      args: ['symbol-1', { x: 128, y: 64, anchor: 'top-left' }]
    },
    expectData: { objectId: 'obj-inst-1', symbolId: 'symbol-1', symbolInstanceId: 'symbol-instance-1' },
    invalid: [
      { args: {}, fragment: '缺少 symbolId 参数' },
      { args: { symbolId: 'symbol-1', anchor: 'bottom' }, fragment: 'anchor 必须是 center 或 top-left' }
    ]
  },
  update_symbol: {
    validArgs: { symbolId: 'symbol-1', objectIds: ['obj-3'] },
    validOverrides: () => ({
      updateSymbol: vi.fn(() =>
        Promise.resolve({ id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 1, instanceCount: 2 })
      )
    }),
    expectCall: { method: 'updateSymbol', args: ['symbol-1', ['obj-3']] },
    expectData: { id: 'symbol-1', name: '箭头', createdAt: 1700000000000, objectCount: 1, instanceCount: 2 },
    invalid: [
      { args: { objectIds: ['obj-3'] }, fragment: '缺少 symbolId 参数' },
      { args: { symbolId: 'symbol-1' }, fragment: '缺少 objectIds 参数' }
    ]
  },
  detach_symbol_instance: {
    validArgs: { objectId: 'obj-inst-1' },
    validOverrides: () => ({
      detachSymbolInstance: vi.fn(() =>
        Promise.resolve(makeSummary({ id: 'obj-inst-1', name: '箭头 实例' }))
      )
    }),
    expectCall: { method: 'detachSymbolInstance', args: ['obj-inst-1'] },
    expectData: makeSummary({ id: 'obj-inst-1', name: '箭头 实例' }),
    invalid: [{ args: {}, fragment: '缺少 objectId 参数' }]
  },

  /* ── 添加对象 ── */
  add_shape: {
    // 样式字段（fill/cornerRadius/opacity/shadow）原样透传到 addShape settings，解析在网关层完成
    validArgs: {
      shape: 'circle',
      x: 10,
      y: 20,
      width: 64,
      height: 64,
      anchor: 'top-left',
      fill: '#ff0000',
      cornerRadius: 8,
      opacity: 0.5,
      shadow: { color: '#000000', blur: 4, offsetX: 1, offsetY: 2 }
    },
    validOverrides: () => ({ addShape: vi.fn(() => 'obj-new') }),
    expectCall: {
      method: 'addShape',
      args: ['circle', {
        x: 10,
        y: 20,
        width: 64,
        height: 64,
        anchor: 'top-left',
        fill: '#ff0000',
        cornerRadius: 8,
        opacity: 0.5,
        shadow: { color: '#000000', blur: 4, offsetX: 1, offsetY: 2 }
      }]
    },
    expectData: { objectId: 'obj-new' },
    invalid: [
      { args: {}, fragment: '缺少 shape 参数' },
      { args: { shape: 'circle', anchor: 'bottom' }, fragment: 'anchor 必须是 center 或 top-left' }
    ]
  },
  add_text: {
    validArgs: { text: '标题', preset: 'title', x: 5, y: 6, fontSize: 32, fill: '#333333' },
    validOverrides: () => ({ addText: vi.fn(() => 'obj-text') }),
    expectCall: { method: 'addText', args: [{ text: '标题', preset: 'title', x: 5, y: 6, fontSize: 32, fill: '#333333' }] },
    expectData: { objectId: 'obj-text' },
    invalid: [{ throwMethod: 'addText' }]
  },
  insert_svg: {
    validArgs: { svg: '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', name: 'logo', x: 1, y: 2, scale: 2, anchor: 'top-left' },
    validOverrides: () => ({ insertSvg: vi.fn(() => Promise.resolve({ objectId: 'obj-svg' })) }),
    expectCall: {
      method: 'insertSvg',
      args: ['<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', { name: 'logo', x: 1, y: 2, scale: 2, anchor: 'top-left' }]
    },
    expectData: { objectId: 'obj-svg' },
    invalid: [
      { args: {}, fragment: '缺少 svg 参数' },
      { args: { svg: '<svg/>', scale: 0 }, fragment: 'scale 必须大于 0' },
      { args: { svg: '<svg/>', anchor: 'bottom' }, fragment: 'anchor 必须是 center 或 top-left' }
    ]
  },
  insert_iconify_icon: {
    validArgs: { iconName: 'mdi:home', x: 3, y: 4 },
    validOverrides: () => ({ insertIconifyIcon: vi.fn(() => Promise.resolve('obj-icon')) }),
    expectCall: { method: 'insertIconifyIcon', args: ['mdi:home', { x: 3, y: 4 }] },
    expectData: { objectId: 'obj-icon' },
    invalid: [{ args: {}, fragment: '缺少 iconName 参数' }]
  },
  insert_icon_template: {
    validArgs: { templateId: 'app-icon-rounded-square' },
    validOverrides: () => ({ insertIconTemplate: vi.fn(() => Promise.resolve('obj-tpl')) }),
    expectCall: { method: 'insertIconTemplate', args: ['app-icon-rounded-square'] },
    expectData: { objectId: 'obj-tpl' },
    invalid: [{ args: {}, fragment: '缺少 templateId 参数' }]
  },
  apply_icon_template: {
    validArgs: { templateId: 'app-icon-rounded-square' },
    validOverrides: () => ({
      applyIconTemplateAsDocument: vi.fn(() => Promise.resolve()),
      getOverview: vi.fn(() => makeOverview())
    }),
    expectCall: { method: 'applyIconTemplateAsDocument', args: ['app-icon-rounded-square'] },
    expectData: makeOverview(),
    invalid: [{ args: {}, fragment: '缺少 templateId 参数' }]
  },
  create_objects: {
    // 条目样式字段原样透传（不解析），语义与 set_object_props 一致、由网关层统一应用
    validArgs: {
      items: [
        { shape: 'circle', x: 1, name: '圆', anchor: 'top-left', fill: '#ff0000', cornerRadius: 8, opacity: 0.5 },
        { svg: '<svg/>', scale: 0.5, stroke: 'swatch:主色', strokeWidth: 2 },
        { text: '文字', shadow: { color: '#000000', blur: 4, offsetX: 1, offsetY: 2 } }
      ],
      group: true,
      groupName: '组'
    },
    validOverrides: () => ({
      createObjects: vi.fn(() => Promise.resolve({ objectIds: ['obj-1', 'obj-2', 'obj-3'], groupId: 'grp-1' }))
    }),
    // 条目字段被逐项归一化后透传（样式字段原样保留，undefined 字段在 toEqual 语义下可省略）
    expectCall: {
      method: 'createObjects',
      args: [
        [
          { shape: 'circle', x: 1, name: '圆', anchor: 'top-left', fill: '#ff0000', cornerRadius: 8, opacity: 0.5 },
          { svg: '<svg/>', scale: 0.5, stroke: 'swatch:主色', strokeWidth: 2 },
          { text: '文字', shadow: { color: '#000000', blur: 4, offsetX: 1, offsetY: 2 } }
        ],
        { group: true, groupName: '组' }
      ]
    },
    expectData: { objectIds: ['obj-1', 'obj-2', 'obj-3'], groupId: 'grp-1' },
    invalid: [
      { args: {}, fragment: '缺少 items 参数' },
      // 数组内含非对象条目被过滤为空，同样视为缺少 items
      { args: { items: ['circle'] }, fragment: '缺少 items 参数' },
      { args: { items: [{ shape: 'circle', anchor: 'bottom' }] }, fragment: 'anchor 必须是 center 或 top-left' }
    ]
  },

  /* ── 选区 ── */
  select_objects: {
    validArgs: { objectIds: ['obj-1', 'obj-2'], mode: 'point' },
    validOverrides: () => ({ selectObjects: vi.fn(), getSelectionIds: vi.fn(() => ['obj-1', 'obj-2']) }),
    expectCall: { method: 'selectObjects', args: [['obj-1', 'obj-2'], 'point'] },
    expectData: { selectedIds: ['obj-1', 'obj-2'] },
    invalid: [{ throwMethod: 'selectObjects' }]
  },
  select_all: {
    validOverrides: () => ({ selectAll: vi.fn(), getSelectionIds: vi.fn(() => ['obj-1']) }),
    expectData: { selectedIds: ['obj-1'] },
    invalid: [{ throwMethod: 'selectAll' }]
  },

  /* ── 对象操作 ── */
  set_object_props: {
    validArgs: { objectId: 'obj-1', props: { fill: '#00ff00', opacity: 0.5 } },
    validOverrides: () => ({
      setObjectProps: vi.fn(),
      getObjectSummary: vi.fn(() => makeSummary({ fill: '#00ff00' }))
    }),
    expectCall: { method: 'setObjectProps', args: ['obj-1', { fill: '#00ff00', opacity: 0.5 }] },
    expectData: makeSummary({ fill: '#00ff00' }),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      { args: { objectId: 'obj-1', props: {} }, fragment: '缺少 props 参数' }
    ]
  },
  update_text: {
    // 全字段合法用例：调度层逐字段解析后透传给网关（数值/枚举/布尔形态均覆盖）
    validArgs: {
      objectId: 'obj-text',
      text: '新文案',
      fontSize: 32,
      fontFamily: 'Microsoft YaHei',
      fontWeight: 'bold',
      fontStyle: 'italic',
      charSpacing: 100,
      lineHeight: 1.5,
      textAlign: 'center',
      underline: true,
      linethrough: false
    },
    validOverrides: () => ({ updateText: vi.fn(() => Promise.resolve(makeSummary({ id: 'obj-text', type: 'textbox' }))) }),
    expectCall: {
      method: 'updateText',
      args: ['obj-text', {
        text: '新文案',
        fontSize: 32,
        fontFamily: 'Microsoft YaHei',
        fontWeight: 'bold',
        fontStyle: 'italic',
        charSpacing: 100,
        lineHeight: 1.5,
        textAlign: 'center',
        underline: true,
        linethrough: false
      }]
    },
    expectData: makeSummary({ id: 'obj-text', type: 'textbox' }),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      // 一个更新字段都没给：请求体为空
      { args: { objectId: 'obj-text' }, fragment: '至少提供 text/fontSize' },
      // 数值字段越界
      { args: { objectId: 'obj-text', fontSize: 501 }, fragment: 'fontSize 取值范围 6-500' },
      { args: { objectId: 'obj-text', charSpacing: 900 }, fragment: 'charSpacing 取值范围 -200-800' },
      { args: { objectId: 'obj-text', lineHeight: 4 }, fragment: 'lineHeight 取值范围 0.5-3' },
      // 字重：仅接受 normal/bold 或 100-900 数字
      { args: { objectId: 'obj-text', fontWeight: 'heavy' }, fragment: 'fontWeight 必须是 normal/bold 或 100-900 的数字' },
      { args: { objectId: 'obj-text', fontWeight: 50 }, fragment: 'fontWeight 数字取值范围 100-900' },
      // 枚举字段非法值
      { args: { objectId: 'obj-text', fontStyle: 'oblique' }, fragment: 'fontStyle 必须是 normal 或 italic' },
      { args: { objectId: 'obj-text', textAlign: 'top' }, fragment: 'textAlign 必须是 left/center/right/justify 之一' },
      // 目标校验（非文本对象）由网关层抛错，这里覆盖异常透传路径
      { args: { objectId: 'obj-text', text: '文案' }, throwMethod: 'updateText' }
    ]
  },
  move_layer: {
    validArgs: { objectId: 'obj-1', direction: 'up' },
    validOverrides: () => ({ moveLayer: vi.fn() }),
    expectCall: { method: 'moveLayer', args: ['obj-1', 'up'] },
    expectData: { objectId: 'obj-1', direction: 'up' },
    invalid: [{ args: { objectId: 'obj-1', direction: 'sideways' }, fragment: 'direction 必须是 up/down/top/bottom 之一' }]
  },
  set_object_visible: {
    validArgs: { objectId: 'obj-1', visible: false },
    validOverrides: () => ({ setObjectVisible: vi.fn() }),
    expectCall: { method: 'setObjectVisible', args: ['obj-1', false] },
    expectData: { objectId: 'obj-1', visible: false },
    invalid: [{ args: { objectId: 'obj-1' }, fragment: '缺少 visible 参数' }]
  },
  set_object_locked: {
    validArgs: { objectId: 'obj-1', locked: true },
    validOverrides: () => ({ setObjectLocked: vi.fn() }),
    expectCall: { method: 'setObjectLocked', args: ['obj-1', true] },
    expectData: { objectId: 'obj-1', locked: true },
    invalid: [{ args: { objectId: 'obj-1' }, fragment: '缺少 locked 参数' }]
  },
  duplicate_objects: {
    validArgs: { objectIds: ['obj-1', 'obj-2'] },
    validOverrides: () => ({ duplicateObjects: vi.fn(() => Promise.resolve(['obj-3', 'obj-4'])) }),
    expectCall: { method: 'duplicateObjects', args: [['obj-1', 'obj-2']] },
    expectData: { objectIds: ['obj-3', 'obj-4'] },
    invalid: [{ throwMethod: 'duplicateObjects' }]
  },
  delete_objects: {
    validArgs: { objectIds: ['obj-1'] },
    // handler 读取 listObjects().length 统计剩余对象，auto-mock 的 undefined 会抛 TypeError，必须注入数组
    validOverrides: () => ({ deleteObjects: vi.fn(), listObjects: vi.fn(() => []) }),
    expectCall: { method: 'deleteObjects', args: [['obj-1']] },
    expectData: { objectCount: 0 },
    invalid: [{ throwMethod: 'deleteObjects' }]
  },
  flip_object: {
    validArgs: { objectId: 'obj-1', axis: 'x' },
    validOverrides: () => ({ flipObject: vi.fn() }),
    expectCall: { method: 'flipObject', args: ['obj-1', 'x'] },
    expectData: { objectId: 'obj-1', axis: 'x' },
    invalid: [{ args: { objectId: 'obj-1', axis: 'z' }, fragment: 'axis 必须是 x 或 y' }]
  },
  group_objects: {
    validArgs: { objectIds: ['obj-1', 'obj-2'] },
    validOverrides: () => ({ groupObjects: vi.fn(), getSelectionIds: vi.fn(() => ['grp-1']) }),
    expectCall: { method: 'groupObjects', args: [['obj-1', 'obj-2']] },
    expectData: { selectedIds: ['grp-1'] },
    invalid: [{ throwMethod: 'groupObjects' }]
  },
  ungroup_object: {
    validArgs: { objectId: 'grp-1' },
    validOverrides: () => ({ ungroupObject: vi.fn(), getSelectionIds: vi.fn(() => ['obj-1', 'obj-2']) }),
    expectCall: { method: 'ungroupObject', args: ['grp-1'] },
    expectData: { selectedIds: ['obj-1', 'obj-2'] },
    invalid: [{ throwMethod: 'ungroupObject' }]
  },
  set_object_name: {
    validArgs: { objectId: 'obj-1', name: '新图层名' },
    // setObjectName 返回摘要时 handler 才成功，auto-mock 的 undefined 会触发“未找到对象”分支
    validOverrides: () => ({ setObjectName: vi.fn(() => makeSummary({ name: '新图层名' })) }),
    expectCall: { method: 'setObjectName', args: ['obj-1', '新图层名'] },
    expectData: makeSummary({ name: '新图层名' }),
    invalid: [
      { args: { objectId: 'obj-1' }, fragment: '缺少 name 参数' },
      { args: { objectId: 'obj-1', name: '改名' }, fragment: '未找到对象: obj-1' }
    ]
  },
  align_objects: {
    validArgs: { mode: 'center', objectIds: ['obj-1', 'obj-2'] },
    validOverrides: () => ({ alignObjects: vi.fn(() => ['obj-1', 'obj-2']) }),
    expectCall: { method: 'alignObjects', args: [['obj-1', 'obj-2'], 'center'] },
    expectData: { objectIds: ['obj-1', 'obj-2'], mode: 'center' },
    invalid: [{ args: { mode: 'diagonal' }, fragment: 'mode 必须是 left/center/right/top/middle/bottom 之一' }]
  },
  distribute_objects: {
    validArgs: { axis: 'y', mode: 'edge', objectIds: ['obj-1', 'obj-2'] },
    validOverrides: () => ({ distributeObjects: vi.fn(() => ['obj-1', 'obj-2']) }),
    expectCall: { method: 'distributeObjects', args: [['obj-1', 'obj-2'], 'y', 'edge'] },
    expectData: { objectIds: ['obj-1', 'obj-2'], axis: 'y', mode: 'edge' },
    invalid: [
      { args: { axis: 'z' }, fragment: 'axis 必须是 x 或 y' },
      { args: { axis: 'x', mode: 'diagonal' }, fragment: 'mode 必须是 edge 或 center' }
    ]
  },
  batch_set_props: {
    // 形态 A：objectIds + props 同值批量（形态 B 的合法用例见下方独立 describe）
    validArgs: { objectIds: ['obj-1', 'obj-2'], props: { opacity: 0.5 } },
    validOverrides: () => ({
      batchSetObjectsProps: vi.fn(() => [makeSummary({ opacity: 0.5 }), makeSummary({ id: 'obj-2', opacity: 0.5 })])
    }),
    expectCall: { method: 'batchSetObjectsProps', args: [['obj-1', 'obj-2'], { opacity: 0.5 }] },
    expectData: {
      results: [makeSummary({ opacity: 0.5 }), makeSummary({ id: 'obj-2', opacity: 0.5 })]
    },
    invalid: [
      { args: {}, fragment: '缺少 objectIds 参数' },
      { args: { objectIds: [] }, fragment: '缺少 objectIds 参数' },
      { args: { objectIds: ['obj-1'] }, fragment: '缺少 props 参数' },
      // 双形态互斥：items 与 objectIds/props 同时提供时报错
      {
        args: { objectIds: ['obj-1'], props: { opacity: 0.5 }, items: [{ objectId: 'obj-1', props: { opacity: 0.5 } }] },
        fragment: '只能二选一'
      },
      // 形态 B 的 items 结构校验
      { args: { items: [] }, fragment: 'items 必须是非空对象数组' },
      { args: { items: 'obj-1' }, fragment: 'items 必须是非空对象数组' },
      { args: { items: [{ props: { opacity: 0.5 } }] }, fragment: 'items[0] 缺少 objectId 参数' },
      { args: { items: [{ objectId: 'obj-1' }] }, fragment: 'items[0] 缺少 props 参数' },
      { args: { items: [{ objectId: 'obj-1', props: {} }] }, fragment: 'items[0] 缺少 props 参数' }
    ]
  },

  /* ── 样式预设 ── */
  save_style_preset: {
    validArgs: { name: '我的预设', style: { fill: '#ff0000' } },
    validOverrides: () => ({ saveStylePreset: vi.fn(() => ({ presets: [] })) }),
    expectCall: { method: 'saveStylePreset', args: ['我的预设', { fill: '#ff0000' }] },
    invalid: [
      { args: {}, fragment: '缺少 name 参数' },
      { args: { name: '我的预设' }, fragment: '缺少 style 参数' }
    ]
  },
  remove_style_preset: {
    validArgs: { name: '我的预设' },
    validOverrides: () => ({ removeStylePreset: vi.fn(() => ({ presets: [] })) }),
    expectCall: { method: 'removeStylePreset', args: ['我的预设'] },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },
  list_style_presets: {
    validOverrides: () => ({
      listStylePresets: vi.fn(() => ({
        presets: [{ name: 'flat-fill', source: 'builtin' as const, style: { fill: '#000000' } }]
      }))
    }),
    expectData: { presets: [{ name: 'flat-fill', source: 'builtin', style: { fill: '#000000' } }] },
    invalid: [{ throwMethod: 'listStylePresets' }]
  },
  apply_style_preset: {
    validArgs: { name: 'flat-fill', objectIds: ['obj-1'] },
    validOverrides: () => ({
      applyStylePreset: vi.fn(() => ({
        name: 'flat-fill',
        source: 'builtin' as const,
        objectIds: ['obj-1'],
        results: []
      }))
    }),
    expectCall: { method: 'applyStylePreset', args: ['flat-fill', ['obj-1']] },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },

  /* ── 文字转曲 / 布尔运算 / 蒙版裁切 ── */
  outline_text: {
    validArgs: { objectId: 'obj-text' },
    validOverrides: () => ({ outlineText: vi.fn(() => Promise.resolve({ objectId: 'obj-path' })) }),
    expectCall: { method: 'outlineText', args: ['obj-text'] },
    expectData: { objectId: 'obj-path' },
    invalid: [{ throwMethod: 'outlineText' }]
  },
  boolean_ops: {
    // 布尔类型参数为 type（与调度键 operation 同名会导致嵌套合并时覆盖调度名，操作无法路由）
    validArgs: { type: 'union', objectIds: ['obj-1', 'obj-2'], subtractDirection: 'reverse' },
    validOverrides: () => ({
      booleanOps: vi.fn(() => Promise.resolve({ objectId: 'obj-bool', operation: 'union' as const }))
    }),
    expectCall: { method: 'booleanOps', args: [['obj-1', 'obj-2'], 'union', 'reverse'] },
    invalid: [
      { args: { objectIds: ['obj-1', 'obj-2'] }, fragment: '缺少 type 参数' },
      { args: { type: 'union', subtractDirection: 'sideways' }, fragment: 'subtractDirection 必须是 forward 或 reverse' },
      { args: { type: 'union', objectIds: ['obj-1', 'obj-2'] }, throwMethod: 'booleanOps' }
    ]
  },
  mask_objects: {
    validArgs: { objectId: 'obj-1', maskId: 'obj-2', removeMaskObject: true },
    validOverrides: () => ({
      maskObjects: vi.fn(() => Promise.resolve({ objectId: 'obj-1', clipPathId: 'obj-2' }))
    }),
    expectCall: { method: 'maskObjects', args: ['obj-1', 'obj-2', true] },
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      { args: { objectId: 'obj-1' }, fragment: '缺少 maskId 参数' }
    ]
  },
  unmask_object: {
    validArgs: { objectId: 'obj-1' },
    validOverrides: () => ({ unmaskObject: vi.fn(() => Promise.resolve(makeSummary({ masked: false }))) }),
    expectCall: { method: 'unmaskObject', args: ['obj-1'] },
    expectData: makeSummary({ masked: false }),
    invalid: [{ args: {}, fragment: '缺少 objectId 参数' }]
  },
  apply_image_filter: {
    // 滤镜条目在调度层归一化：enabled 缺省补 true，参数与混合模式原样透传给网关
    validArgs: {
      objectId: 'obj-1',
      filters: [
        { type: 'grayscale' },
        { type: 'blur', strength: 0.4 },
        { type: 'brightness', brightness: 0.2, enabled: false }
      ],
      blendMode: 'multiply'
    },
    validOverrides: () => ({ applyImageFilter: vi.fn(() => Promise.resolve(makeSummary())) }),
    expectCall: {
      method: 'applyImageFilter',
      args: [
        'obj-1',
        [
          { type: 'grayscale', enabled: true },
          { type: 'blur', enabled: true, strength: 0.4 },
          { type: 'brightness', enabled: false, brightness: 0.2 }
        ],
        'multiply'
      ]
    },
    expectData: makeSummary(),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      { args: { objectId: 'obj-1' }, fragment: '至少提供 filters 或 blendMode 参数' },
      { args: { objectId: 'obj-1', filters: 'blur' }, fragment: 'filters 必须是滤镜设置对象数组' },
      { args: { objectId: 'obj-1', filters: [{}] }, fragment: 'filters[0].type 必须是' },
      { args: { objectId: 'obj-1', filters: [{ type: 'vignette' }] }, fragment: 'filters[0].type 必须是' },
      { args: { objectId: 'obj-1', filters: 'blur', blendMode: 'wrap' }, fragment: 'blendMode 必须是' }
    ]
  },

  crop_image: {
    validArgs: { objectId: 'obj-1', left: 10, top: 5, width: 100, height: 80 },
    validOverrides: () => ({ cropImage: vi.fn(() => Promise.resolve(makeSummary())) }),
    expectCall: { method: 'cropImage', args: ['obj-1', { left: 10, top: 5, width: 100, height: 80 }] },
    expectData: makeSummary(),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      { args: { objectId: 'obj-1', left: 10 }, fragment: '缺少 left/top/width/height 参数' },
      // 非数字坐标同样被解析为缺失（optionalNumber 收敛 undefined）
      { args: { objectId: 'obj-1', left: 'x', top: 5, width: 100, height: 80 }, fragment: '缺少 left/top/width/height 参数' },
      { args: { objectId: 'obj-1', left: 10, top: 5, width: 100, height: 80 }, throwMethod: 'cropImage' }
    ]
  },
  set_pattern_fill: {
    validArgs: { objectId: 'obj-1', source: 'data:image/png;base64,AAAA', repeat: 'repeat-y', scale: 2 },
    validOverrides: () => ({ setPatternFill: vi.fn(() => Promise.resolve(makeSummary())) }),
    expectCall: {
      method: 'setPatternFill',
      args: ['obj-1', { source: 'data:image/png;base64,AAAA', repeat: 'repeat-y', scale: 2 }]
    },
    expectData: makeSummary(),
    invalid: [
      { args: {}, fragment: '缺少 objectId 参数' },
      { args: { objectId: 'obj-1' }, fragment: '缺少 source 参数' },
      { args: { objectId: 'obj-1', source: 'ftp://example.com/tile.png' }, fragment: 'source 必须是 dataURL 图片' },
      { args: { objectId: 'obj-1', source: 'data:image/png;base64,AAAA', repeat: 'mirror' }, fragment: 'repeat 必须是 repeat/repeat-x/repeat-y/no-repeat 之一' },
      { args: { objectId: 'obj-1', source: 'data:image/png;base64,AAAA', scale: -2 }, fragment: 'scale 必须是大于 0 的数字' },
      { args: { objectId: 'obj-1', source: 'data:image/png;base64,AAAA' }, throwMethod: 'setPatternFill' }
    ]
  },

  /* ── 历史与快照 ── */
  undo: {
    validOverrides: () => ({ undo: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'undo', args: [] },
    expectData: makeOverview(),
    invalid: [{ throwMethod: 'undo' }]
  },
  redo: {
    validOverrides: () => ({ redo: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'redo', args: [] },
    expectData: makeOverview(),
    invalid: [{ throwMethod: 'redo' }]
  },
  jump_to_history: {
    validArgs: { index: 2 },
    validOverrides: () => ({ jumpToHistory: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'jumpToHistory', args: [2] },
    expectData: makeOverview(),
    invalid: [
      { args: {}, fragment: '缺少有效的 index 参数' },
      { args: { index: -1 }, fragment: '缺少有效的 index 参数' }
    ]
  },
  save_snapshot: {
    validArgs: { name: '快照A' },
    validOverrides: () => ({ saveSnapshot: vi.fn(() => ({ name: '快照A', objectCount: 3, createdAt: 1000 })) }),
    expectCall: { method: 'saveSnapshot', args: ['快照A'] },
    expectData: { name: '快照A', objectCount: 3, createdAt: 1000 },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },
  restore_snapshot: {
    validArgs: { name: '快照A' },
    validOverrides: () => ({
      restoreSnapshot: vi.fn(() => Promise.resolve({ name: '快照A', backupName: '__backup__-1', objectCount: 3 }))
    }),
    expectCall: { method: 'restoreSnapshot', args: ['快照A'] },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },
  delete_snapshot: {
    validArgs: { name: '快照A' },
    validOverrides: () => ({ deleteSnapshot: vi.fn(() => ({ snapshots: [] })) }),
    expectCall: { method: 'deleteSnapshot', args: ['快照A'] },
    invalid: [{ args: {}, fragment: '缺少 name 参数' }]
  },

  /* ── 工程文档 ── */
  new_document: {
    validOverrides: () => ({ newDocument: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'newDocument', args: [] },
    expectData: makeOverview(),
    invalid: [{ throwMethod: 'newDocument' }]
  },
  save_project: {
    validOverrides: () => ({ saveProject: vi.fn(() => '已保存到 D:/project.iconproj') }),
    expectData: { message: '已保存到 D:/project.iconproj' },
    invalid: [{ throwMethod: 'saveProject' }]
  },
  get_project_json: {
    validOverrides: () => ({ getProjectJson: vi.fn(() => '{"objects":[]}') }),
    expectData: { json: '{"objects":[]}' },
    invalid: [{ throwMethod: 'getProjectJson' }]
  },
  load_project_json: {
    validArgs: { json: '{"objects":[]}' },
    validOverrides: () => ({ loadProjectJson: vi.fn(() => Promise.resolve()), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'loadProjectJson', args: ['{"objects":[]}'] },
    expectData: makeOverview(),
    invalid: [{ args: {}, fragment: '缺少 json 参数' }]
  },

  /* ── 画板 ── */
  switch_artboard: {
    validArgs: { artboardId: 'ab-2' },
    validOverrides: () => ({ switchArtboard: vi.fn(() => Promise.resolve()), listArtboards: vi.fn(() => []) }),
    expectCall: { method: 'switchArtboard', args: ['ab-2'] },
    expectData: { artboards: [] },
    invalid: [{ args: {}, fragment: '缺少 artboardId 参数' }]
  },
  add_artboard: {
    validOverrides: () => ({ addArtboard: vi.fn(() => Promise.resolve('ab-new')) }),
    expectData: { artboardId: 'ab-new' },
    invalid: [{ throwMethod: 'addArtboard' }]
  },
  delete_artboard: {
    validArgs: { artboardId: 'ab-2' },
    validOverrides: () => ({ deleteArtboard: vi.fn(() => Promise.resolve()), listArtboards: vi.fn(() => []) }),
    expectCall: { method: 'deleteArtboard', args: ['ab-2'] },
    expectData: { artboards: [] },
    invalid: [{ args: {}, fragment: '缺少 artboardId 参数' }]
  },
  rename_artboard: {
    validArgs: { artboardId: 'ab-2', name: '新画板名' },
    validOverrides: () => ({ renameArtboard: vi.fn(), listArtboards: vi.fn(() => []) }),
    expectCall: { method: 'renameArtboard', args: ['ab-2', '新画板名'] },
    expectData: { artboards: [] },
    invalid: [
      { args: {}, fragment: '缺少 artboardId 参数' },
      { args: { artboardId: 'ab-2' }, fragment: '缺少 name 参数' }
    ]
  },

  /* ── 导出 ── */
  export_svg_text: {
    validArgs: { includeBackground: true, artboardId: 'ab-1' },
    validOverrides: () => ({ exportSvgText: vi.fn(() => Promise.resolve('<svg>整页</svg>')) }),
    expectCall: { method: 'exportSvgText', args: [{ includeBackground: true, artboardId: 'ab-1' }] },
    expectData: { svg: '<svg>整页</svg>' },
    invalid: [{ throwMethod: 'exportSvgText' }]
  },
  export_png_data_url: {
    validArgs: { size: 512, transparentBackground: true, format: 'webp', quality: 0.8, artboardId: 'ab-1' },
    validOverrides: () => ({ exportPngDataUrl: vi.fn(() => Promise.resolve('data:image/webp;base64,AA==')) }),
    expectCall: {
      method: 'exportPngDataUrl',
      args: [{ size: 512, transparentBackground: true, format: 'webp', quality: 0.8, artboardId: 'ab-1' }]
    },
    expectData: { dataUrl: 'data:image/webp;base64,AA==' },
    invalid: [
      { args: { format: 'jpg' }, fragment: 'format 必须是 png 或 webp' },
      { args: { quality: 2 }, fragment: 'quality 取值范围 0-1' }
    ]
  },
  get_canvas_thumbnail: {
    // outputPath 形态：走文件落盘管线返回 filePath（不返回 dataUrl，节省 token）
    validArgs: { size: 256, outputPath: 'D:\\icons\\thumb.png', artboardId: 'ab-1' },
    validOverrides: () => ({
      getCanvasThumbnail: vi.fn(() => Promise.resolve({ width: 256, height: 256, filePath: 'D:\\icons\\thumb.png' }))
    }),
    expectCall: {
      method: 'getCanvasThumbnail',
      args: [{ size: 256, outputPath: 'D:\\icons\\thumb.png', artboardId: 'ab-1' }]
    },
    expectData: { width: 256, height: 256, filePath: 'D:\\icons\\thumb.png' },
    invalid: [
      { args: { size: 10 }, fragment: 'size 取值范围 32-512' },
      { args: { outputPath: 'shots/t.png' }, fragment: 'outputPath 必须是绝对文件路径' }
    ]
  },
  export_svg_file: {
    validArgs: { fileName: 'icon', includeBackground: true, outputDir: 'D:\\exports', artboardId: 'ab-1' },
    validOverrides: () => ({ exportSvgFile: vi.fn(() => Promise.resolve('D:\\exports\\icon.svg')) }),
    expectCall: {
      method: 'exportSvgFile',
      args: [{ fileName: 'icon', includeBackground: true, outputDir: 'D:\\exports', artboardId: 'ab-1' }]
    },
    expectData: { filePath: 'D:\\exports\\icon.svg' },
    invalid: [{ args: { outputDir: 'exports' }, fragment: 'outputDir 必须是绝对目录路径' }]
  },
  export_png_file: {
    validArgs: {
      size: 256,
      fileName: 'icon',
      transparentBackground: true,
      format: 'png',
      quality: 0.9,
      outputDir: 'D:\\exports',
      artboardId: 'ab-1'
    },
    validOverrides: () => ({ exportPngFile: vi.fn(() => Promise.resolve('D:\\exports\\icon.png')) }),
    expectCall: {
      method: 'exportPngFile',
      args: [{
        size: 256,
        fileName: 'icon',
        transparentBackground: true,
        format: 'png',
        quality: 0.9,
        outputDir: 'D:\\exports',
        artboardId: 'ab-1'
      }]
    },
    expectData: { filePath: 'D:\\exports\\icon.png' },
    invalid: [
      { args: { format: 'gif' }, fragment: 'format 必须是 png 或 webp' },
      { args: { quality: 5 }, fragment: 'quality 取值范围 0-1' }
    ]
  },
  export_size_set: {
    // 指定预设时 sizes 可省略（使用内置尺寸集）
    validArgs: { preset: 'favicon', fileNamePrefix: 'app-icon', transparentBackground: true, outputDir: 'D:\\exports' },
    validOverrides: () => ({
      exportSizeSet: vi.fn(() =>
        Promise.resolve({ files: [{ size: 16, filePath: 'D:\\exports\\app-icon-16.png' }], outputDir: 'D:\\exports' })
      )
    }),
    expectCall: {
      method: 'exportSizeSet',
      args: [{ preset: 'favicon', fileNamePrefix: 'app-icon', transparentBackground: true, outputDir: 'D:\\exports' }]
    },
    expectData: {
      files: [{ size: 16, filePath: 'D:\\exports\\app-icon-16.png' }],
      outputDir: 'D:\\exports'
    },
    invalid: [
      { args: { preset: 'custom' }, fragment: 'preset=custom 时必须提供 sizes' },
      { args: { preset: 'bogus' }, fragment: 'preset 必须是 favicon/pwa/android/ios/electron/custom 之一' }
    ]
  },
  export_icon_container: {
    validArgs: { format: 'ico', sizes: [16, 32], fileName: 'app', outputDir: 'D:\\exports' },
    validOverrides: () => ({
      exportIconContainer: vi.fn(() => Promise.resolve({ filePath: 'D:\\exports\\app.ico', sizes: [16, 32] }))
    }),
    expectCall: {
      method: 'exportIconContainer',
      args: [{ format: 'ico', sizes: [16, 32], fileName: 'app', outputDir: 'D:\\exports' }]
    },
    expectData: { filePath: 'D:\\exports\\app.ico', sizes: [16, 32] },
    invalid: [
      { args: {}, fragment: '缺少 format 参数' },
      { args: { format: 'png' }, fragment: '缺少 format 参数' }
    ]
  },

  /* ── 视图 ── */
  set_viewport: {
    validArgs: { zoom: 2 },
    validOverrides: () => ({ setViewport: vi.fn(), getOverview: vi.fn(() => makeOverview()) }),
    expectCall: { method: 'setViewport', args: [{ zoom: 2 }] },
    expectData: makeOverview(),
    invalid: [
      { args: {}, fragment: '至少提供 zoom 或 fit=true 之一' },
      { args: { zoom: 50 }, fragment: 'zoom 取值范围 0.05-20' }
    ]
  }
}

describe('MCP 操作契约（表驱动）', () => {
  for (const [operation, contract] of Object.entries(OPERATION_CONTRACTS)) {
    describe(operation, () => {
      it('合法最小入参（嵌套 args）→ ok=true 且参数正确展开到网关方法', async () => {
        const gateway = createMockGateway(contract.validOverrides?.() ?? {})
        const response = await dispatchMcpOperation(() => gateway, {
          operation,
          args: contract.validArgs ?? {}
        })

        expect(response.ok).toBe(true)
        if (contract.expectCall) {
          const methodMock = readGatewayMock(gateway, contract.expectCall.method)
          expect(methodMock).toHaveBeenCalledTimes(1)
          expect(methodMock).toHaveBeenCalledWith(...contract.expectCall.args)
        }
        if (contract.expectData !== undefined) {
          expect(response.data).toEqual(contract.expectData)
        }
      })

      contract.invalid.forEach((invalid, index) => {
        it(`非法入参 #${index + 1} → ok=false 且携带可读中文错误`, async () => {
          const overrides: Record<string, unknown> = {}
          if (invalid.throwMethod) {
            overrides[invalid.throwMethod] = vi.fn(() => {
              throw new Error(GATEWAY_ERROR)
            })
          }
          const gateway = createMockGateway(overrides as Partial<McpEditorGateway>)
          const response = await dispatchMcpOperation(() => gateway, {
            operation,
            args: invalid.args ?? {}
          })

          expect(response.ok).toBe(false)
          expect(response.message).toContain(invalid.fragment ?? `操作 ${operation} 失败`)
          if (invalid.throwMethod) {
            expect(response.message).toContain(GATEWAY_ERROR)
          }
        })
      })
    })
  }

  it('契约用例表覆盖注册表全部操作（双向集合相等，缺操作即红）', () => {
    const registered = listOperationNames().map((item) => item.name)
    const covered = Object.keys(OPERATION_CONTRACTS)
    const diff = [
      ...registered.filter((name) => !covered.includes(name)).map((name) => `注册表有而用例表缺: ${name}`),
      ...covered.filter((name) => !registered.includes(name)).map((name) => `用例表有而注册表缺: ${name}`)
    ]
    expect(diff, `契约用例表与操作注册表不一致：\n${diff.join('\n')}`).toEqual([])
  })
})

describe('嵌套 args 合并语义', () => {
  it('嵌套 args 与顶层平铺字段互补合并（非同名字段同时生效）', async () => {
    const addShape = vi.fn(() => 'obj-merge')
    const response = await dispatchMcpOperation(() => createMockGateway({ addShape }), {
      operation: 'add_shape',
      x: 5,
      y: 6,
      args: { shape: 'circle', width: 32 }
    })

    expect(response.ok).toBe(true)
    // 顶层 x/y 与嵌套 shape/width 合并后一起传给网关（height 缺省为 undefined）
    expect(addShape).toHaveBeenCalledWith('circle', { x: 5, y: 6, width: 32 })
  })

  it('同名字段冲突时嵌套 args 优先于顶层', async () => {
    const resizeCanvas = vi.fn()
    const response = await dispatchMcpOperation(() => createMockGateway({ resizeCanvas }), {
      operation: 'resize_canvas',
      width: 100,
      args: { width: 200, height: 300 }
    })

    expect(response.ok).toBe(true)
    expect(resizeCanvas).toHaveBeenCalledWith(200, 300)
  })

  it('args 为原始值或 null 时被忽略，退回顶层平铺形态', async () => {
    for (const badArgs of ['circle', 123, null]) {
      const addShape = vi.fn(() => 'obj-flat')
      const response = await dispatchMcpOperation(() => createMockGateway({ addShape }), {
        operation: 'add_shape',
        shape: 'square',
        args: badArgs
      })

      expect(response.ok).toBe(true)
      expect(addShape).toHaveBeenCalledWith('square', { x: undefined, y: undefined, width: undefined, height: undefined })
    }
  })
})

describe('关键默认值与展开语义', () => {
  it('add_text 省略 text 时使用默认文案“文字”', async () => {
    const addText = vi.fn(() => 'obj-text')
    const response = await dispatchMcpOperation(() => createMockGateway({ addText }), {
      operation: 'add_text',
      args: {}
    })

    expect(response.ok).toBe(true)
    expect(response.data).toEqual({ objectId: 'obj-text' })
    expect(addText).toHaveBeenCalledWith({ text: '文字' })
  })

  it('select_objects 省略 objectIds 时以空数组与默认 mode 调用网关', async () => {
    const selectObjects = vi.fn()
    const response = await dispatchMcpOperation(() => createMockGateway({ selectObjects }), {
      operation: 'select_objects',
      args: {}
    })

    expect(response.ok).toBe(true)
    expect(selectObjects).toHaveBeenCalledWith([], 'shape')
  })

  it('duplicate_objects 省略 objectIds 时以 undefined 调用网关（复制当前选中）', async () => {
    const duplicateObjects = vi.fn(() => Promise.resolve(['obj-copy']))
    const response = await dispatchMcpOperation(() => createMockGateway({ duplicateObjects }), {
      operation: 'duplicate_objects',
      args: {}
    })

    expect(response.ok).toBe(true)
    expect(duplicateObjects).toHaveBeenCalledWith(undefined)
    expect(response.data).toEqual({ objectIds: ['obj-copy'] })
  })

  it('get_canvas_thumbnail 省略 outputPath 时保持 dataUrl 返回（向后兼容）', async () => {
    const getCanvasThumbnail = vi.fn(() => Promise.resolve({ dataUrl: 'data:image/png;base64,AA==', width: 256, height: 256 }))
    const response = await dispatchMcpOperation(() => createMockGateway({ getCanvasThumbnail }), {
      operation: 'get_canvas_thumbnail',
      args: { size: 256 }
    })

    expect(response.ok).toBe(true)
    // outputPath 缺省透传为 undefined（toEqual 视为等价于省略），结果仍是 dataUrl 形态
    expect(getCanvasThumbnail).toHaveBeenCalledWith({ size: 256 })
    expect(response.data).toEqual({ dataUrl: 'data:image/png;base64,AA==', width: 256, height: 256 })
  })

  it('export_size_set 提供 sizes 时覆盖预设尺寸并透传给网关', async () => {
    const exportSizeSet = vi.fn(() =>
      Promise.resolve({ files: [{ size: 64, filePath: 'D:\\exports\\icon-64.png' }], outputDir: 'D:\\exports' })
    )
    const response = await dispatchMcpOperation(() => createMockGateway({ exportSizeSet }), {
      operation: 'export_size_set',
      args: { preset: 'android', sizes: [64, 128] }
    })

    expect(response.ok).toBe(true)
    expect(exportSizeSet).toHaveBeenCalledWith({ preset: 'android', sizes: [64, 128] })
  })
})

describe('find_objects 过滤语义', () => {
  /** 三个条形 + 一个渐变填充矩形 + 一个 path，用于验证各条件的组合与排除关系。 */
  function findObjectsMock() {
    return vi.fn(() => [
      makeSummary({ id: 'obj-1', name: 'lbar-left', type: 'rectangle', fill: '#FF0000' }),
      makeSummary({ id: 'obj-2', name: 'lbar-right', type: 'rectangle', fill: null }),
      makeSummary({
        id: 'obj-3',
        name: '装饰',
        type: 'rectangle',
        fill: { type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: 1, y2: 0 }, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }
      }),
      makeSummary({ id: 'obj-4', name: '背景', type: 'path', fill: '#ff0000' })
    ])
  }

  it('nameMatch=exact 时只全等召回，前缀命中不再参与', async () => {
    const listObjects = findObjectsMock()
    const response = await dispatchMcpOperation(() => createMockGateway({ listObjects }), {
      operation: 'find_objects',
      args: { name: 'lbar-left', nameMatch: 'exact' }
    })

    expect(response.ok).toBe(true)
    expect(response.data).toEqual({
      objects: [makeSummary({ id: 'obj-1', name: 'lbar-left', type: 'rectangle', fill: '#FF0000' })],
      count: 1
    })
  })

  it('type 与 fill 组合过滤：fill 忽略大小写，渐变填充与无填充对象不参与', async () => {
    const listObjects = findObjectsMock()
    const response = await dispatchMcpOperation(() => createMockGateway({ listObjects }), {
      operation: 'find_objects',
      args: { type: 'rectangle', fill: '#ff0000' }
    })

    expect(response.ok).toBe(true)
    // obj-2 无填充、obj-3 为渐变摘要、obj-4 类型不符，均被排除
    expect(response.data).toEqual({
      objects: [makeSummary({ id: 'obj-1', name: 'lbar-left', type: 'rectangle', fill: '#FF0000' })],
      count: 1
    })
  })

  it('空结果不是错误：count=0 且 message 携带匹配条件说明', async () => {
    const listObjects = vi.fn(() => [makeSummary({ id: 'obj-1', name: '背景' })])
    const response = await dispatchMcpOperation(() => createMockGateway({ listObjects }), {
      operation: 'find_objects',
      args: { name: 'lbar-' }
    })

    expect(response.ok).toBe(true)
    expect(response.data).toEqual({
      objects: [],
      count: 0,
      message: '未找到匹配对象（条件：name 前缀 "lbar-"）'
    })
  })
})

describe('创建样式透传与批量属性双形态', () => {
  it('insert_svg 携带样式字段时原样透传到 insertSvg settings', async () => {
    const insertSvg = vi.fn(() => Promise.resolve({ objectId: 'obj-svg' }))
    const response = await dispatchMcpOperation(() => createMockGateway({ insertSvg }), {
      operation: 'insert_svg',
      args: { svg: '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', fill: '#ff0000', strokeWidth: 2 }
    })

    expect(response.ok).toBe(true)
    expect(insertSvg).toHaveBeenCalledWith(
      '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
      // 定位/缩放字段缺省为 undefined（toEqual 语义可省略），样式字段原样保留
      { fill: '#ff0000', strokeWidth: 2 }
    )
  })

  it('batch_set_props items 逐对象条目 → 整批透传给 batchSetObjectsPropsItems', async () => {
    const batchSetObjectsPropsItems = vi.fn(() => [makeSummary({ left: 10, top: 20 }), makeSummary({ id: 'obj-2', left: 30, top: 40 })])
    const response = await dispatchMcpOperation(() => createMockGateway({ batchSetObjectsPropsItems }), {
      operation: 'batch_set_props',
      args: {
        items: [
          { objectId: 'obj-1', props: { left: 10, top: 20 } },
          { objectId: 'obj-2', props: { left: 30, top: 40, opacity: 0.5 } }
        ]
      }
    })

    expect(response.ok).toBe(true)
    // 逐条目 objectId/props 原样映射（每对象各自属性），顺序与 items 一致
    expect(batchSetObjectsPropsItems).toHaveBeenCalledWith([
      { objectId: 'obj-1', props: { left: 10, top: 20 } },
      { objectId: 'obj-2', props: { left: 30, top: 40, opacity: 0.5 } }
    ])
    expect(response.data).toEqual({
      results: [makeSummary({ left: 10, top: 20 }), makeSummary({ id: 'obj-2', left: 30, top: 40 })]
    })
  })

  it('create_objects 条目 fill 为 null 时与缺失同义（不写入新对象）', async () => {
    const createObjects = vi.fn(() => Promise.resolve({ objectIds: ['obj-1'] }))
    const response = await dispatchMcpOperation(() => createMockGateway({ createObjects }), {
      operation: 'create_objects',
      args: { items: [{ shape: 'circle', fill: null }] }
    })

    expect(response.ok).toBe(true)
    expect(createObjects).toHaveBeenCalledWith(
      [{ shape: 'circle' }],
      { group: false, groupName: undefined }
    )
  })
})
