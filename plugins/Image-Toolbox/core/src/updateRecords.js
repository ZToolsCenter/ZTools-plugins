export const updateRecords = [
  {
    version: '2.2',
    date: '2026-06-23',
    changes: {
      added: [
        { text: '新增 ZTools 客户端，可按 ZTools 插件规范独立加载图片工具箱', platforms: ['ztools'] },
        { text: '新增图形工具，支持绘制矩形、圆形、星星、心形、梯形、直线、箭头等多种图形', platforms: null },
        { text: '图形工具支持自定义填充色、边框色、边框宽度，拖拽绘制即可创建图形', platforms: null },
        { text: '图形工具组新增属性面板入口，支持在预设栏和属性面板同步切换图形', platforms: null },
        { text: '图形属性栏支持分别设置填充不透明度和描边不透明度', platforms: null }
      ],
      fixed: [
        { text: '修复马赛克图层旋转后马赛克范围不准确的问题', platforms: null },
        { text: '修复马赛克图层拉伸后马赛克块大小被错误拉伸或压缩的问题', platforms: null },
        { text: '修复星形、心形、梯形、箭头等图形绘制偏移、畸形或显示不准确的问题', platforms: null },
        { text: '修复直线和箭头在水平或垂直拖拽时可能无法创建的问题', platforms: null }
      ],
      improved: [
        { text: '优化图形工具组选型窗口，改用 SVG 缩略图显示真实图形效果', platforms: null },
        { text: '优化图形预设栏颜色，合并填充色和边框色为一套样式预设并改为上图案下文字布局', platforms: null },
        { text: '图形颜色预设会同时应用填充不透明度和描边不透明度', platforms: null },
        { text: '优化橡皮擦工具，拖动过程中实时显示擦除效果', platforms: null }
      ],
      adjusted: [
        { text: '图形工具将仅描边预设调整为首位并作为默认样式', platforms: null }
      ],
      removed: []
    }
  },
  {
    version: '2.1.1',
    date: '2026-06-15',
    changes: {
      added: [
        { text: '马赛克工具新增自由选区模式，支持非矩形区域马赛克/模糊', platforms: null }
      ],
      fixed: [
        { text: '修复橡皮擦擦除画笔图层后，图层名称被错误重置为马赛克的问题', platforms: null }
      ],
      improved: [
        { text: '优化马赛克画笔模式，鼠标悬停/涂抹时显示画笔位置，涂抹过程中实时显示马赛克效果', platforms: null },
        { text: '优化图层默认名称展示，文字/画笔/马赛克图层会按内容和预设生成更清晰的名称', platforms: null }
      ],
      adjusted: [
        { text: '马赛克图层改为动态重算，移动图层时会根据新的下方内容重新生成效果', platforms: null },
        { text: '马赛克工具默认预设调整为矩形 + 中马赛克', platforms: null }
      ],
      removed: []
    }
  },
  {
    version: '2.1',
    date: '2026-06-13',
    changes: {
      added: [
        { text: '新增画笔工具，支持自由涂鸦、颜色预设和粗细调整', platforms: null },
        { text: '新增橡皮擦工具，支持大小预设和撤销/重做', platforms: null },
        { text: '新增非矩形裁剪工具', platforms: null },
        { text: '文字字体列表支持读取并显示用户系统中已安装的字体', platforms: ['utools'] },
        { text: '移动/框选预设栏新增旋转0°/90/180/270与左右/前后翻转快捷操作', platforms: null }
      ],
      fixed: [],
      improved: [
        { text: '优化了裁剪工具的使用体验', platforms: null },
        { text: '字体列表按用户实际使用频率自动排序', platforms: ['utools'] }
      ],
      adjusted: [],
      removed: []
    }
  },
  {
    version: '2.0',
    date: '2026-06-12',
    changes: {
      added: [
        { text: '右侧面板新增切换状态，可切换tab布局或上下布局', platforms: null },
        { text: '新增"预设栏"和"状态栏"位置切换功能', platforms: null },
        { text: '新增属性/图层面板位置切换，可将侧栏移到左侧', platforms: null }
      ],
      fixed: [
        { text: '修复首次裁剪后再次剪切时，裁剪框被上一轮裁剪范围裁掉的问题', platforms: null },
        { text: '修复第二次裁剪被错误重置为原图范围、未基于首次裁剪继续裁剪的问题', platforms: null },
        { text: '修复旋转裁剪框后应用剪切仍按未旋转矩形生效的问题', platforms: null },
        { text: '修复裁剪后马赛克拖选框被错误裁掉、不能显示到图像外的问题', platforms: null }
      ],
      improved: [],
      adjusted: [
        { text: '将深色浅色切换调整到了"设置"页面', platforms: null },
        { text: '将"选项栏"与"属性栏"合并', platforms: null },
        { text: '原"选项栏"调整为"预设栏"', platforms: null }
      ],
      removed: [
        { text: '移除了"剪切"工具属性的异常参数', platforms: null }
      ]
    }
  },
  {
    version: '1.0',
    date: '2026-06-10',
    changes: {
      added: [
        { text: '发布了第一个可用版本，支持图片导入、马赛克、裁切、文字标注和导出', platforms: null },
        { text: '搭建五区编辑器布局：工具栏、选项栏、画布区、属性/图层面板和状态栏', platforms: null }
      ],
      fixed: [],
      improved: [],
      adjusted: [],
      removed: []
    }
  }
];

export const updateCategories = [
  { key: 'added', title: '新增' },
  { key: 'fixed', title: '修复' },
  { key: 'improved', title: '优化' },
  { key: 'adjusted', title: '调整' },
  { key: 'removed', title: '去除' }
];

/**
 * 平台常量
 * null: 所有平台通用
 * ['utools']: 仅 uTools
 * ['ztools']: 仅 ZTools
 * ['utools', 'ztools']: uTools 和 ZTools
 */
export const PLATFORMS = {
  ALL: null,           // 所有平台
  UTOOLS: 'utools',    // uTools 专用
  ZTOOLS: 'ztools',    // ZTools 专用
  LOCAL: 'local',      // 本地环境
};
