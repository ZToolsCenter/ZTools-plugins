import type {
  McpEditorGateway,
  McpEditorGatewayProvider,
  McpGatewayController
} from './mcpGatewayTypes'
import { dispatchMcpOperation, listOperationNames } from './mcpOperations'

/**
 * 工具在 plugin.json 中声明的名称。
 * 宿主最终对外暴露的 MCP 工具名为 `<plugin-name>_command_dispatcher`，
 * 该名称需要是小写 snake_case（宿主安装校验规则）。
 */
export const MCP_TOOL_NAME = 'command_dispatcher'

/**
 * 创建 MCP 网关控制器：
 * - 编辑器运行时通过 attach/detach 绑定或解绑能力实现；
 * - 工具注册到 window.ztools.registerTool，由 ZTools 内置 MCP 服务对外暴露；
 * - 同一页面多次挂载（keep-alive / 路由重入）时注册只执行一次。
 */
export function createMcpGatewayController(): McpGatewayController {
  let gateway: McpEditorGateway | null = null
  let registered = false

  const provider: McpEditorGatewayProvider = () => gateway

  function registerToolOnce(): void {
    if (registered) return
    if (typeof window === 'undefined' || typeof window.ztools?.registerTool !== 'function') return
    try {
      window.ztools.registerTool(MCP_TOOL_NAME, async (input: unknown) => {
        return await dispatchMcpOperation(provider, input)
      })
      registered = true
    } catch (error) {
      // 注册失败不打断页面加载：宿主未就绪（如纯浏览器开发模式）时静默降级，
      // 下一次 attach 会重新尝试注册。
      console.warn('[icon-creator mcp] 工具注册失败:', error)
    }
  }

  return {
    attach(nextGateway) {
      gateway = nextGateway
      registerToolOnce()
    },
    detach() {
      gateway = null
    },
    isRegistered() {
      return registered
    }
  }
}

/**
 * 生成 plugin.json 的 tools 声明片段。
 * 构建期不自动改写 plugin.json（人工维护声明与实现一致性更直观），
 * 此函数供文档与开发者核对操作清单使用。
 */
export function describeMcpTool(): {
  name: string
  description: string
  operations: Array<{ name: string; description: string }>
} {
  return {
    name: MCP_TOOL_NAME,
    description: '图标创建工具编辑器操作入口。通过 operation 参数路由到具体编辑能力（查询画布、增删改对象、图层、历史、画板、导出 SVG/PNG 等）。',
    operations: listOperationNames()
  }
}
