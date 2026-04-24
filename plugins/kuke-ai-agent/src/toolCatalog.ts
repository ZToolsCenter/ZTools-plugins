import type { ToolDefinition } from './types'

export const toolCategories = [
  {
    id: 'environment' as const,
    label: '环境与联网工具',
    description: '执行命令、抓取网页、联网搜索，帮助 Agent 探测外部环境。',
  },
  {
    id: 'file' as const,
    label: '文件工具',
    description: '读、写、改、删、检索本地文件与 Jupyter notebook，覆盖日常代码与文档工作。',
  },
  {
    id: 'task' as const,
    label: '任务与计划',
    description: '让模型显式规划步骤并实时更新进度，用于复杂多步任务。',
  },
  {
    id: 'memory' as const,
    label: '记忆工具',
    description: '持久化存储跨会话的关键信息、用户偏好和上下文记忆。',
  },
]

export const toolCatalog: ToolDefinition[] = [
  {
    name: 'BashTool',
    label: 'BashTool',
    purpose: '执行 Shell 命令',
    summary: '跑构建/测试/脚本/后台 dev server',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '执行',
    riskLabel: '高风险',
    description: '在本地终端执行 Shell 命令。支持 description（一句话说明用途）、timeout（毫秒，默认 120000，最大 600000）。如果是 dev server、watcher、长构建这类长时间运行的命令，必须把 runInBackground 设为 true —— 会立刻返回 bashId，之后用 BashOutputTool 拉取输出、用 KillShellTool 终止。单次 stdout/stderr 超过 40KB 或 400 行会被自动截断（保留首 80 + 末 320 行），如需完整输出请写到文件再用 FileReadTool 分页读。调用前必须评估 riskLevel：只读查询 low，修改项目文件/安装包 medium，删除、影响系统配置、不可逆操作 high。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 Shell 命令' },
        cwd: { type: 'string', description: '命令执行的工作目录，默认当前 workspace' },
        description: { type: 'string', description: '一句话说明这次命令要做什么（便于回溯/调试）' },
        timeout: { type: 'number', description: '同步模式的超时（毫秒），默认 120000，最大 600000' },
        runInBackground: { type: 'boolean', description: '是否后台运行：dev server / watch / 长跑命令必须传 true，返回 bashId' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=只读查询；medium=安装依赖/修改项目文件；high=删除、修改系统配置、不可逆操作',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['command', 'riskLevel', 'riskReason'],
    },
    legacyNames: ['execCommand'],
  },
  {
    name: 'BashOutputTool',
    label: 'BashOutputTool',
    purpose: '拉取后台 Bash 输出',
    summary: '读取 runInBackground 的 stdout/stderr',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '读取',
    riskLabel: '低风险',
    description: '读取 runInBackground=true 的 BashTool 自上次拉取以来新增的 stdout / stderr，以及当前进程状态（running / completed / exited / killed）。可选用正则 filter 过滤行。后台任务期间应定期轮询直到 status !== running 或得到想要的输出。',
    parameters: {
      type: 'object',
      properties: {
        bashId: { type: 'string', description: 'BashTool(runInBackground=true) 返回的 bashId' },
        filter: { type: 'string', description: '可选正则，仅保留匹配此正则的行' },
      },
      required: ['bashId'],
    },
  },
  {
    name: 'KillShellTool',
    label: 'KillShellTool',
    purpose: '终止后台 Bash',
    summary: '杀掉 runInBackground 启动的进程',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '终止',
    riskLabel: '中风险',
    description: '终止一个由 BashTool(runInBackground=true) 启动、现在仍在运行的后台进程。先发 SIGTERM，500ms 后仍未退出则 SIGKILL。',
    parameters: {
      type: 'object',
      properties: {
        bashId: { type: 'string', description: '要终止的后台进程 bashId' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: '一般为 low 或 medium',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['bashId', 'riskLevel', 'riskReason'],
    },
  },
  {
    name: 'GetWorkspaceRootTool',
    label: 'GetWorkspaceRootTool',
    purpose: '查询当前工作目录',
    summary: '确认后续工具的默认 cwd',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '读取',
    riskLabel: '低风险',
    description: '返回本插件进程当前的 cwd。BashTool / GlobTool / GrepTool / FileReadTool 等在未显式传 cwd/path 时会以此为基准。开始工作前可以先调它确认自己站在哪个目录。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'SetWorkspaceRootTool',
    label: 'SetWorkspaceRootTool',
    purpose: '切换默认工作目录',
    summary: '把进程 cwd 切到目标目录，后续工具按新 cwd 解析相对路径',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '配置',
    riskLabel: '中风险',
    description: '修改本插件进程的 cwd。切换后，所有未显式传 cwd/path 的 BashTool / GlobTool / GrepTool / FileRead/Edit/Write/Delete 调用都会以新 cwd 为基准解析相对路径。不会修改用户设置里持久化的 workspaceRoot，下次重启回到用户配置值。切换到系统目录、磁盘根、用户不熟悉的目录时必须 high 风险并说明原因。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标目录的绝对路径' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=用户已知项目目录；medium=首次进入的目录；high=系统目录/磁盘根/不熟悉位置',
        },
        riskReason: { type: 'string', description: '一句话说明为什么切到这里' },
      },
      required: ['path', 'riskLevel', 'riskReason'],
    },
  },
  {
    name: 'WebFetchTool',
    label: 'WebFetchTool',
    purpose: '抓取并按 prompt 摘要网页',
    summary: '已知网址时读取页面、可选 LLM 摘要',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '联网',
    riskLabel: '中风险',
    description: '抓取指定 URL 的网页正文（自动 HTML→纯文本、截断到 50000 字符）。如果同时提供 prompt，会用当前会话的 LLM 按 prompt 对页面做一次摘要/问答，返回 analysis 字段。禁止访问本地或内网地址。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的完整网页地址' },
        prompt: { type: 'string', description: '可选：用自然语言描述你要从这个页面里获得什么，LLM 会据此做摘要/回答' },
      },
      required: ['url'],
    },
  },
  {
    name: 'WebSearchTool',
    label: 'WebSearchTool',
    purpose: '联网搜索（Tavily）',
    summary: '不知道网址时先搜，支持域名过滤',
    category: 'environment',
    categoryLabel: '环境与联网工具',
    capabilityLabel: '联网',
    riskLabel: '中风险',
    description: '使用 Tavily 做联网搜索。支持 allowedDomains / blockedDomains 过滤（域名支持 *.example.com 通配）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或问题' },
        count: { type: 'number', description: '返回结果数量，默认 5，上限 10' },
        allowedDomains: {
          type: 'array',
          items: { type: 'string' },
          description: '仅保留命中这些域名的结果（支持 *.example.com）',
        },
        blockedDomains: {
          type: 'array',
          items: { type: 'string' },
          description: '过滤掉命中这些域名的结果（支持 *.example.com）',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'FileReadTool',
    label: 'FileReadTool',
    purpose: '读取文件内容（带行号）',
    summary: '看代码/配置/文档，支持 offset/limit 分页',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '只读',
    riskLabel: '低风险',
    description: '读取本地文件内容。默认返回前 2000 行（cat -n 格式，含行号）。大文件请用 offset/limit 分页读，超长行会被截断为 2000 字符。图片自动转 dataURL；.ipynb 以 cell 边界平铺；PDF 不直接解析（请先用 BashTool 的 pdftotext 转换）。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '文件绝对路径或相对路径' },
        offset: { type: 'number', description: '起始行（0-based），默认 0' },
        limit: { type: 'number', description: '最多返回多少行，默认 2000' },
      },
      required: ['filePath'],
    },
    legacyNames: ['readFile'],
  },
  {
    name: 'FileEditTool',
    label: 'FileEditTool',
    purpose: '按补丁方式编辑文件',
    summary: '精准替换已有文件中的片段',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '编辑',
    riskLabel: '中风险',
    description: '基于查找替换或 edits 补丁列表精确修改文件。建议在修改前先用 FileReadTool 读取最新内容，避免用过时片段替换。old_string/new_string 等价于 oldText/newText 和 search/replace。默认单次替换必须唯一命中，命中多处需显式 replaceAll=true。调用前必须评估 riskLevel：改临时/测试文件 low，改项目源码 medium，改系统配置/关键数据 high。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '目标文件路径' },
        old_string: { type: 'string', description: '要替换的原始文本（别名：oldText / search）' },
        new_string: { type: 'string', description: '替换后的文本（别名：newText / replace）' },
        replaceAll: { type: 'boolean', description: '是否替换所有匹配，默认 false（多处匹配会报错以防误改）' },
        edits: {
          type: 'array',
          description: '批量补丁：每项含 old_string/new_string（或 oldText/newText / search/replace）与可选 replaceAll',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              oldText: { type: 'string' },
              newText: { type: 'string' },
              search: { type: 'string' },
              replace: { type: 'string' },
              replaceAll: { type: 'boolean' },
            },
          },
        },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=临时/测试文件；medium=项目源码；high=系统配置/关键数据',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['filePath', 'riskLevel', 'riskReason'],
    },
  },
  {
    name: 'FileWriteTool',
    label: 'FileWriteTool',
    purpose: '直接写入整个文件',
    summary: '新建文件或整体重写',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '写入',
    riskLabel: '高风险',
    description: '将完整文本写入目标文件。若文件已存在，建议先 FileReadTool 读一遍当前内容，或者改用 FileEditTool 做局部替换（更安全、diff 更清晰）。调用前必须评估 riskLevel：新建临时文件 low，整体重写项目源码 medium，覆盖系统配置/破坏数据 high。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '目标文件路径' },
        content: { type: 'string', description: '要写入的完整文件内容' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=新建临时文件；medium=整体重写项目源码；high=覆盖配置/破坏数据',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['filePath', 'content', 'riskLevel', 'riskReason'],
    },
    legacyNames: ['writeFile'],
  },
  {
    name: 'FileDeleteTool',
    label: 'FileDeleteTool',
    purpose: '删除文件或目录',
    summary: '删除前自动快照，可通过消息回滚恢复',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '删除',
    riskLabel: '高风险',
    description: '删除指定的文件或目录（目录需 recursive=true）。本工具会在删除前自动保存快照，用户可通过"回滚到此处"恢复。**删文件/目录务必使用本工具，不要用 BashTool 的 rm / rmdir / del / Remove-Item 等命令**，否则无法回滚。',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: '要删除的文件或目录的绝对路径' },
        recursive: { type: 'boolean', description: '目标是目录时必须传 true 才能删除，默认 false' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=临时产物；medium=项目文件；high=系统配置/不可逆数据',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['filePath', 'riskLevel', 'riskReason'],
    },
  },
  {
    name: 'NotebookEditTool',
    label: 'NotebookEditTool',
    purpose: '编辑 Jupyter Notebook cell',
    summary: '替换 / 插入 / 删除 .ipynb 单元格',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '编辑',
    riskLabel: '中风险',
    description: '对 .ipynb notebook 的单元格进行原子级修改：editMode=replace（替换单元格源码和/或类型）、insert（在指定 cellId 之后插入新 cell，无 cellId 时插到开头）、delete（删除单元格）。替换/插入时必须传 newSource；插入必须指定 cellType（code | markdown）。修改前会自动快照以支持回滚。',
    parameters: {
      type: 'object',
      properties: {
        notebookPath: { type: 'string', description: '.ipynb 文件的绝对路径' },
        cellId: { type: 'string', description: '要操作的 cell 的 id（或十进制索引字符串）；insert 可省略以插到开头' },
        cellType: { type: 'string', enum: ['code', 'markdown'], description: 'insert 必填；replace 时可用于同时改类型' },
        editMode: { type: 'string', enum: ['replace', 'insert', 'delete'], description: '编辑模式，默认 replace' },
        newSource: { type: 'string', description: 'replace / insert 时写入的 cell 源码（markdown 也是字符串）' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'low=临时 notebook；medium=项目 notebook；high=关键实验',
        },
        riskReason: { type: 'string', description: '风险评估的简短说明（一句话）' },
      },
      required: ['notebookPath', 'riskLevel', 'riskReason'],
    },
  },
  {
    name: 'GlobTool',
    label: 'GlobTool',
    purpose: '按路径模式查找文件',
    summary: '结果按最近修改时间降序',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '检索',
    riskLabel: '低风险',
    description: '按 glob 模式查找文件或目录，返回按 mtime 降序排序的列表（最新改动的排最上）。用来快速定位"最近改过的相关文件"。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 路径模式，如 **/*.ts、src/**/*.vue' },
        path: { type: 'string', description: '搜索起始目录，可选' },
        includeDirectories: { type: 'boolean', description: '是否同时返回目录，默认 false' },
        limit: { type: 'number', description: '最多返回多少条，默认 200' },
      },
      required: ['pattern'],
    },
    legacyNames: ['readDir'],
  },
  {
    name: 'GrepTool',
    label: 'GrepTool',
    purpose: '在代码中搜索内容',
    summary: '支持三种输出模式、上下文、类型过滤、multiline',
    category: 'file',
    categoryLabel: '文件工具',
    capabilityLabel: '检索',
    riskLabel: '低风险',
    description: '在目录或单个文件中按正则搜索。三种 outputMode：files_with_matches（默认，只返回命中的文件路径，最省 token，适合先定位）、content（返回匹配行 + 可选上下文，适合要看现场）、count（每文件匹配次数，估量级）。支持 type（js/ts/py/vue/go 等快捷分类）、glob（文件名过滤）、multiline（跨行匹配，用 [\\s\\S] 语义）、beforeContext/afterContext/context、caseSensitive、headLimit+offset 分页。pattern 默认按正则处理（isRegex=true）。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则或字面量字符串' },
        path: { type: 'string', description: '搜索起点目录或单个文件，可选' },
        glob: { type: 'string', description: '文件名 glob 过滤，如 *.ts、src/**/*.vue' },
        type: { type: 'string', description: '按文件类型过滤：js / ts / py / vue / go / rust / md / json / yaml 等，可用逗号分隔多个' },
        outputMode: {
          type: 'string',
          enum: ['files_with_matches', 'content', 'count'],
          description: '默认 files_with_matches',
        },
        isRegex: { type: 'boolean', description: '是否把 pattern 当正则处理，默认 true' },
        caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
        multiline: { type: 'boolean', description: '跨行匹配（. 匹配换行），默认 false' },
        beforeContext: { type: 'number', description: 'content 模式下每个匹配前附带几行上下文' },
        afterContext: { type: 'number', description: 'content 模式下每个匹配后附带几行上下文' },
        context: { type: 'number', description: 'beforeContext 和 afterContext 的统一简写' },
        showLineNumbers: { type: 'boolean', description: 'content 模式是否显示行号，默认 true' },
        headLimit: { type: 'number', description: '最多返回多少条结果，默认 250' },
        offset: { type: 'number', description: '从第几条开始返回（分页），默认 0' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'TodoWriteTool',
    label: 'TodoWriteTool',
    purpose: '维护当前会话的任务计划',
    summary: '拆分复杂任务、实时更新进度',
    category: 'task',
    categoryLabel: '任务与计划',
    capabilityLabel: '规划',
    riskLabel: '低风险',
    description: '把当前任务拆成步骤清单并维护进度。每次调用会完整替换当前会话的 todos。每一项包含：content（祈使句，例如"修复登录校验 bug"）、activeForm（进行时，例如"修复登录校验 bug 中"）、status（pending / in_progress / completed）。同一时间只允许一个 in_progress。复杂多步任务（≥3 步）开工前就要先列 todo；每完成一步立即调用本工具把对应项从 in_progress 切到 completed，并把下一步切到 in_progress。',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: '完整的任务列表（替换式）',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '任务内容（祈使句）' },
              activeForm: { type: 'string', description: '任务进行时描述' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: '任务状态',
              },
            },
            required: ['content', 'activeForm', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'listMemoryBlocks',
    label: 'listMemoryBlocks',
    purpose: '列出所有记忆块',
    summary: '查看当前所有记忆块的概要信息',
    category: 'memory',
    categoryLabel: '记忆工具',
    capabilityLabel: '读取',
    riskLabel: '低风险',
    description: '列出当前系统中所有记忆块，返回每个记忆块的 label、description、字符数、是否只读等概要信息。不返回完整的 value 内容。用于了解已有哪些记忆块。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getMemoryBlock',
    label: 'getMemoryBlock',
    purpose: '读取单个记忆块内容',
    summary: '获取指定记忆块的完整内容',
    category: 'memory',
    categoryLabel: '记忆工具',
    capabilityLabel: '读取',
    riskLabel: '低风险',
    description: '根据 label 获取指定记忆块的完整内容，包括 value、description、字符统计、更新时间等。只读操作，不会修改任何数据。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '记忆块的标签名称' },
      },
      required: ['label'],
    },
  },
  {
    name: 'setMemoryBlock',
    label: 'setMemoryBlock',
    purpose: '创建或更新记忆块',
    summary: '创建新记忆块或覆盖更新已有记忆块',
    category: 'memory',
    categoryLabel: '记忆工具',
    capabilityLabel: '写入',
    riskLabel: '中风险',
    description: '创建新记忆块或完全覆盖更新已有记忆块。传入 label（唯一标识）、description（用途说明）、value（记忆内容）、可选的 chars_limit（最大字符数，默认 5000）和 read_only（是否只读）。如果 label 已存在且为只读，会返回错误。用于保存重要的上下文信息、用户偏好、项目约定等需要持久化的内容。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '记忆块的唯一标签（用于后续读取/修改/删除）' },
        description: { type: 'string', description: '记忆块的用途说明，帮助理解这个记忆块存储了什么' },
        value: { type: 'string', description: '记忆块的完整内容' },
        chars_limit: { type: 'number', description: '最大字符数限制，默认 5000' },
        read_only: { type: 'boolean', description: '是否只读，只读记忆块无法被修改或删除' },
      },
      required: ['label', 'value'],
    },
  },
  {
    name: 'replaceMemoryBlockText',
    label: 'replaceMemoryBlockText',
    purpose: '局部修改记忆块内容',
    summary: '对记忆块进行局部字符串替换',
    category: 'memory',
    categoryLabel: '记忆工具',
    capabilityLabel: '编辑',
    riskLabel: '中风险',
    description: '对指定记忆块的 value 进行局部字符串替换（查找 oldText，替换为 newText）。只会替换找到的第一个匹配项。如果记忆块是只读的，会返回错误。与其用 setMemoryBlock 整体覆盖，不如用这个做精准修改。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '要修改的记忆块的标签' },
        oldText: { type: 'string', description: '要查找并替换的原始文本（必须是精确匹配）' },
        newText: { type: 'string', description: '替换后的新文本' },
      },
      required: ['label', 'oldText', 'newText'],
    },
  },
  {
    name: 'deleteMemoryBlock',
    label: 'deleteMemoryBlock',
    purpose: '删除记忆块',
    summary: '删除指定的记忆块',
    category: 'memory',
    categoryLabel: '记忆工具',
    capabilityLabel: '删除',
    riskLabel: '高风险',
    description: '删除指定的记忆块。只读记忆块无法被删除。如果 label 不存在会返回错误。删除操作不可恢复。',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '要删除的记忆块的标签' },
      },
      required: ['label'],
    },
  },
]

export const toolCatalogMap = new Map<string, ToolDefinition>()
toolCatalog.forEach((tool) => {
  toolCatalogMap.set(tool.name, tool)
  ;(tool.legacyNames ?? []).forEach((legacyName) => {
    toolCatalogMap.set(legacyName, tool)
  })
})

export const getDefaultEnabledToolNames = () => toolCatalog.map((tool) => tool.name)

export const normalizeEnabledToolNames = (value: unknown) => {
  const availableToolNames = new Set(toolCatalog.map((tool) => tool.name))
  if (!Array.isArray(value)) {
    return getDefaultEnabledToolNames()
  }

  const normalized = Array.from(
    new Set(
      value
        .map((item) => String(item))
        .map((name) => toolCatalogMap.get(name)?.name ?? '')
        .filter((name) => availableToolNames.has(name)),
    ),
  )

  return normalized.length ? normalized : getDefaultEnabledToolNames()
}

export const FILE_MUTATING_TOOLS = new Set(['FileEditTool', 'FileWriteTool', 'FileDeleteTool', 'writeFile', 'NotebookEditTool'])
export const MUTATING_TOOL_NAMES = new Set(['BashTool', 'execCommand', 'FileEditTool', 'FileWriteTool', 'FileDeleteTool', 'writeFile', 'NotebookEditTool', 'KillShellTool', 'SetWorkspaceRootTool'])
