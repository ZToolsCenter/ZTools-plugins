export interface GitmojiItem {
  label: string
  emoji: string
  code: string
  commitType: string
  description: string
  keywords: string[]
  featured: boolean
}

export const gitmojis: GitmojiItem[] = [
  {
    label: '新增',
    emoji: '✨',
    code: ':sparkles:',
    commitType: 'feat',
    description: '引入新功能',
    keywords: ['feature', 'new', '新增', '功能'],
    featured: true
  },
  {
    label: '修复',
    emoji: '🐛',
    code: ':bug:',
    commitType: 'fix',
    description: '修复缺陷或异常行为',
    keywords: ['bug', 'fix', '修复', '缺陷'],
    featured: true
  },
  {
    label: '热修复',
    emoji: '🚑️',
    code: ':ambulance:',
    commitType: 'fix',
    description: '紧急修复生产或关键问题',
    keywords: ['hotfix', 'critical', '紧急', '生产'],
    featured: true
  },
  {
    label: '优化',
    emoji: '⚡️',
    code: ':zap:',
    commitType: 'perf',
    description: '提升性能或响应速度',
    keywords: ['performance', 'perf', '优化', '性能'],
    featured: true
  },
  {
    label: '文档',
    emoji: '📝',
    code: ':memo:',
    commitType: 'docs',
    description: '新增或更新文档',
    keywords: ['docs', 'documentation', '文档'],
    featured: true
  },
  {
    label: '样式/UI',
    emoji: '💄',
    code: ':lipstick:',
    commitType: 'style',
    description: '更新界面、样式或视觉资源',
    keywords: ['ui', 'style', 'css', '样式', '界面'],
    featured: true
  },
  {
    label: '重构',
    emoji: '♻️',
    code: ':recycle:',
    commitType: 'refactor',
    description: '重构代码但不改变外部行为',
    keywords: ['refactor', '重构'],
    featured: true
  },
  {
    label: '测试',
    emoji: '✅',
    code: ':white_check_mark:',
    commitType: 'test',
    description: '新增、更新或通过测试',
    keywords: ['test', 'tests', '测试'],
    featured: true
  },
  {
    label: '配置',
    emoji: '🔧',
    code: ':wrench:',
    commitType: 'chore',
    description: '新增或更新配置文件',
    keywords: ['config', 'configuration', '配置'],
    featured: true
  },
  {
    label: '构建',
    emoji: '👷',
    code: ':construction_worker:',
    commitType: 'build',
    description: '新增或更新构建系统',
    keywords: ['build', '构建'],
    featured: true
  },
  {
    label: 'CI',
    emoji: '💚',
    code: ':green_heart:',
    commitType: 'ci',
    description: '修复或更新 CI 构建',
    keywords: ['ci', 'build', 'pipeline', '流水线'],
    featured: true
  },
  {
    label: '依赖升级',
    emoji: '⬆️',
    code: ':arrow_up:',
    commitType: 'chore',
    description: '升级依赖版本',
    keywords: ['dependency', 'dependencies', 'upgrade', '依赖', '升级'],
    featured: true
  },
  {
    label: '依赖降级',
    emoji: '⬇️',
    code: ':arrow_down:',
    commitType: 'chore',
    description: '降级依赖版本',
    keywords: ['dependency', 'dependencies', 'downgrade', '依赖', '降级'],
    featured: true
  },
  {
    label: '删除代码',
    emoji: '🔥',
    code: ':fire:',
    commitType: 'chore',
    description: '删除代码或文件',
    keywords: ['remove', 'delete', '删除'],
    featured: true
  },
  {
    label: '移动/重命名',
    emoji: '🚚',
    code: ':truck:',
    commitType: 'chore',
    description: '移动或重命名文件、路径、路由',
    keywords: ['move', 'rename', '移动', '重命名'],
    featured: true
  },
  {
    label: '破坏性变更',
    emoji: '💥',
    code: ':boom:',
    commitType: 'feat',
    description: '引入不兼容或破坏性变更',
    keywords: ['breaking', 'change', '破坏性', '不兼容'],
    featured: true
  },
  {
    label: '安全',
    emoji: '🔒️',
    code: ':lock:',
    commitType: 'fix',
    description: '修复安全或隐私问题',
    keywords: ['security', 'privacy', '安全', '隐私'],
    featured: true
  },
  {
    label: '类型',
    emoji: '🏷️',
    code: ':label:',
    commitType: 'types',
    description: '新增或更新类型定义',
    keywords: ['type', 'types', 'typescript', 'flow', '类型'],
    featured: true
  },
  {
    label: '国际化',
    emoji: '🌐',
    code: ':globe_with_meridians:',
    commitType: 'feat',
    description: '国际化或本地化相关更新',
    keywords: ['i18n', 'localization', 'locale', '国际化', '本地化'],
    featured: true
  },
  {
    label: '可访问性',
    emoji: '♿️',
    code: ':wheelchair:',
    commitType: 'a11y',
    description: '改善无障碍访问体验',
    keywords: ['accessibility', 'a11y', '无障碍', '可访问性'],
    featured: true
  },
  {
    label: '数据库',
    emoji: '🗃️',
    code: ':card_file_box:',
    commitType: 'db',
    description: '数据库相关变更',
    keywords: ['database', 'db', 'migration', '数据库'],
    featured: true
  },
  {
    label: '日志',
    emoji: '🔊',
    code: ':loud_sound:',
    commitType: 'chore',
    description: '新增或更新日志',
    keywords: ['log', 'logging', '日志'],
    featured: true
  },
  {
    label: '回滚',
    emoji: '⏪️',
    code: ':rewind:',
    commitType: 'revert',
    description: '回滚之前的变更',
    keywords: ['revert', 'rollback', '回滚'],
    featured: true
  },
  {
    label: '发布版本',
    emoji: '🔖',
    code: ':bookmark:',
    commitType: 'release',
    description: '发布或版本标签',
    keywords: ['release', 'version', 'tag', '发布', '版本'],
    featured: true
  },
  {
    label: '代码结构',
    emoji: '🎨',
    code: ':art:',
    commitType: 'refactor',
    description: '改善代码结构或格式',
    keywords: ['format', 'structure', '结构', '格式'],
    featured: false
  },
  {
    label: '部署',
    emoji: '🚀',
    code: ':rocket:',
    commitType: 'deploy',
    description: '部署相关变更',
    keywords: ['deploy', 'deployment', '部署'],
    featured: false
  },
  {
    label: '初始提交',
    emoji: '🎉',
    code: ':tada:',
    commitType: 'init',
    description: '初始化项目',
    keywords: ['initial', 'init', '初始化'],
    featured: false
  },
  {
    label: '密钥',
    emoji: '🔐',
    code: ':closed_lock_with_key:',
    commitType: 'chore',
    description: '新增或更新密钥相关内容',
    keywords: ['secret', 'secrets', 'key', '密钥'],
    featured: false
  },
  {
    label: 'Lint',
    emoji: '🚨',
    code: ':rotating_light:',
    commitType: 'lint',
    description: '修复编译器或 linter 警告',
    keywords: ['lint', 'warning', 'compiler', '警告'],
    featured: false
  },
  {
    label: '进行中',
    emoji: '🚧',
    code: ':construction:',
    commitType: 'wip',
    description: '进行中的工作',
    keywords: ['wip', 'work in progress', '进行中'],
    featured: false
  },
  {
    label: '锁定依赖',
    emoji: '📌',
    code: ':pushpin:',
    commitType: 'chore',
    description: '锁定依赖到指定版本',
    keywords: ['pin', 'dependency', '依赖', '锁定'],
    featured: false
  },
  {
    label: '分析统计',
    emoji: '📈',
    code: ':chart_with_upwards_trend:',
    commitType: 'chore',
    description: '新增或更新分析、埋点、追踪代码',
    keywords: ['analytics', 'tracking', '统计', '埋点'],
    featured: false
  },
  {
    label: '添加依赖',
    emoji: '➕',
    code: ':heavy_plus_sign:',
    commitType: 'chore',
    description: '新增依赖',
    keywords: ['add dependency', 'dependency', '依赖', '添加'],
    featured: false
  },
  {
    label: '移除依赖',
    emoji: '➖',
    code: ':heavy_minus_sign:',
    commitType: 'chore',
    description: '移除依赖',
    keywords: ['remove dependency', 'dependency', '依赖', '移除'],
    featured: false
  },
  {
    label: '开发脚本',
    emoji: '🔨',
    code: ':hammer:',
    commitType: 'chore',
    description: '新增或更新开发脚本',
    keywords: ['script', 'dev', 'tooling', '脚本'],
    featured: false
  },
  {
    label: '拼写',
    emoji: '✏️',
    code: ':pencil2:',
    commitType: 'docs',
    description: '修正拼写或文字错误',
    keywords: ['typo', 'spelling', '拼写', '错字'],
    featured: false
  },
  {
    label: '待改进代码',
    emoji: '💩',
    code: ':poop:',
    commitType: 'chore',
    description: '提交需要后续改进的代码',
    keywords: ['bad code', 'improve', '待改进'],
    featured: false
  },
  {
    label: '合并分支',
    emoji: '🔀',
    code: ':twisted_rightwards_arrows:',
    commitType: 'merge',
    description: '合并分支',
    keywords: ['merge', 'branch', '合并'],
    featured: false
  },
  {
    label: '编译产物',
    emoji: '📦️',
    code: ':package:',
    commitType: 'build',
    description: '新增或更新编译产物、包文件',
    keywords: ['package', 'compiled', 'dist', '产物'],
    featured: false
  },
  {
    label: '外部 API',
    emoji: '👽️',
    code: ':alien:',
    commitType: 'fix',
    description: '适配外部 API 变更',
    keywords: ['api', 'external', '第三方', '外部'],
    featured: false
  },
  {
    label: '许可证',
    emoji: '📄',
    code: ':page_facing_up:',
    commitType: 'docs',
    description: '新增或更新许可证',
    keywords: ['license', '许可证'],
    featured: false
  },
  {
    label: '资源',
    emoji: '🍱',
    code: ':bento:',
    commitType: 'chore',
    description: '新增或更新资源文件',
    keywords: ['asset', 'assets', 'resource', '资源'],
    featured: false
  },
  {
    label: '评审修改',
    emoji: '👌',
    code: ':ok_hand:',
    commitType: 'refactor',
    description: '根据代码评审意见更新代码',
    keywords: ['review', 'code review', '评审'],
    featured: false
  },
  {
    label: '源码注释',
    emoji: '💡',
    code: ':bulb:',
    commitType: 'docs',
    description: '新增或更新源码注释',
    keywords: ['comment', 'comments', '注释'],
    featured: false
  },
  {
    label: '文本内容',
    emoji: '💬',
    code: ':speech_balloon:',
    commitType: 'docs',
    description: '新增或更新文案、文本常量',
    keywords: ['text', 'copy', 'literal', '文案', '文本'],
    featured: false
  },
  {
    label: '移除日志',
    emoji: '🔇',
    code: ':mute:',
    commitType: 'chore',
    description: '移除日志',
    keywords: ['log', 'logging', 'remove log', '日志'],
    featured: false
  },
  {
    label: '贡献者',
    emoji: '👥',
    code: ':busts_in_silhouette:',
    commitType: 'docs',
    description: '新增或更新贡献者信息',
    keywords: ['contributor', 'contributors', '贡献者'],
    featured: false
  },
  {
    label: '用户体验',
    emoji: '🚸',
    code: ':children_crossing:',
    commitType: 'ux',
    description: '改善用户体验或可用性',
    keywords: ['ux', 'usability', '用户体验', '可用性'],
    featured: false
  },
  {
    label: '架构',
    emoji: '🏗️',
    code: ':building_construction:',
    commitType: 'refactor',
    description: '架构层面的调整',
    keywords: ['architecture', '架构'],
    featured: false
  },
  {
    label: '响应式',
    emoji: '📱',
    code: ':iphone:',
    commitType: 'style',
    description: '响应式设计相关更新',
    keywords: ['responsive', 'mobile', '响应式', '移动端'],
    featured: false
  },
  {
    label: 'Mock',
    emoji: '🤡',
    code: ':clown_face:',
    commitType: 'test',
    description: 'Mock 数据或测试替身',
    keywords: ['mock', 'stub', 'fake'],
    featured: false
  },
  {
    label: '彩蛋',
    emoji: '🥚',
    code: ':egg:',
    commitType: 'feat',
    description: '新增或更新彩蛋',
    keywords: ['easter egg', '彩蛋'],
    featured: false
  },
  {
    label: 'Git Ignore',
    emoji: '🙈',
    code: ':see_no_evil:',
    commitType: 'chore',
    description: '新增或更新 .gitignore',
    keywords: ['gitignore', 'ignore', '忽略'],
    featured: false
  },
  {
    label: '快照',
    emoji: '📸',
    code: ':camera_flash:',
    commitType: 'test',
    description: '新增或更新测试快照',
    keywords: ['snapshot', 'snapshots', '快照'],
    featured: false
  },
  {
    label: '实验',
    emoji: '⚗️',
    code: ':alembic:',
    commitType: 'experiment',
    description: '实验性变更',
    keywords: ['experiment', 'experimental', '实验'],
    featured: false
  },
  {
    label: 'SEO',
    emoji: '🔍️',
    code: ':mag:',
    commitType: 'seo',
    description: '改善 SEO',
    keywords: ['seo', 'search', '搜索优化'],
    featured: false
  },
  {
    label: '种子数据',
    emoji: '🌱',
    code: ':seedling:',
    commitType: 'db',
    description: '新增或更新种子文件',
    keywords: ['seed', 'seeding', 'fixture', '种子数据'],
    featured: false
  },
  {
    label: '功能开关',
    emoji: '🚩',
    code: ':triangular_flag_on_post:',
    commitType: 'feat',
    description: '新增、更新或移除功能开关',
    keywords: ['feature flag', 'flag', '功能开关'],
    featured: false
  },
  {
    label: '错误兜底',
    emoji: '🥅',
    code: ':goal_net:',
    commitType: 'fix',
    description: '捕获或处理错误',
    keywords: ['error', 'catch', '错误', '异常'],
    featured: false
  },
  {
    label: '动画',
    emoji: '💫',
    code: ':dizzy:',
    commitType: 'style',
    description: '新增或更新动画与过渡',
    keywords: ['animation', 'transition', '动画'],
    featured: false
  },
  {
    label: '废弃',
    emoji: '🗑️',
    code: ':wastebasket:',
    commitType: 'chore',
    description: '废弃需要后续清理的代码',
    keywords: ['deprecate', 'deprecated', '废弃'],
    featured: false
  },
  {
    label: '授权权限',
    emoji: '🛂',
    code: ':passport_control:',
    commitType: 'fix',
    description: '授权、角色或权限相关代码',
    keywords: ['auth', 'authorization', 'permission', '权限', '授权'],
    featured: false
  },
  {
    label: '轻微修复',
    emoji: '🩹',
    code: ':adhesive_bandage:',
    commitType: 'fix',
    description: '非关键问题的小修复',
    keywords: ['minor fix', 'simple fix', '轻微', '小修'],
    featured: false
  },
  {
    label: '数据探索',
    emoji: '🧐',
    code: ':monocle_face:',
    commitType: 'chore',
    description: '数据探索或检查',
    keywords: ['data', 'inspection', 'explore', '数据探索'],
    featured: false
  },
  {
    label: '死代码',
    emoji: '⚰️',
    code: ':coffin:',
    commitType: 'chore',
    description: '移除死代码',
    keywords: ['dead code', 'remove', '死代码'],
    featured: false
  },
  {
    label: '失败测试',
    emoji: '🧪',
    code: ':test_tube:',
    commitType: 'test',
    description: '新增失败测试',
    keywords: ['failing test', 'test', '失败测试'],
    featured: false
  },
  {
    label: '业务逻辑',
    emoji: '👔',
    code: ':necktie:',
    commitType: 'feat',
    description: '新增或更新业务逻辑',
    keywords: ['business', 'logic', '业务'],
    featured: false
  },
  {
    label: '健康检查',
    emoji: '🩺',
    code: ':stethoscope:',
    commitType: 'chore',
    description: '新增或更新健康检查',
    keywords: ['healthcheck', 'health', '健康检查'],
    featured: false
  },
  {
    label: '基础设施',
    emoji: '🧱',
    code: ':bricks:',
    commitType: 'infra',
    description: '基础设施相关变更',
    keywords: ['infrastructure', 'infra', '基础设施'],
    featured: false
  },
  {
    label: '开发体验',
    emoji: '🧑‍💻',
    code: ':technologist:',
    commitType: 'chore',
    description: '改善开发者体验',
    keywords: ['developer experience', 'dx', '开发体验'],
    featured: false
  },
  {
    label: '资金相关',
    emoji: '💸',
    code: ':money_with_wings:',
    commitType: 'chore',
    description: '赞助或资金相关基础设施',
    keywords: ['sponsor', 'money', 'funding', '资金', '赞助'],
    featured: false
  },
  {
    label: '并发',
    emoji: '🧵',
    code: ':thread:',
    commitType: 'feat',
    description: '多线程或并发相关代码',
    keywords: ['thread', 'concurrency', '并发', '多线程'],
    featured: false
  },
  {
    label: '校验',
    emoji: '🦺',
    code: ':safety_vest:',
    commitType: 'fix',
    description: '新增或更新校验逻辑',
    keywords: ['validation', 'validate', '校验', '验证'],
    featured: false
  },
  {
    label: '离线支持',
    emoji: '✈️',
    code: ':airplane:',
    commitType: 'feat',
    description: '改善离线支持',
    keywords: ['offline', '离线'],
    featured: false
  },
  {
    label: '向后兼容',
    emoji: '🦖',
    code: ':t-rex:',
    commitType: 'fix',
    description: '新增向后兼容代码',
    keywords: ['backward compatibility', 'compatibility', '兼容'],
    featured: false
  }
]
