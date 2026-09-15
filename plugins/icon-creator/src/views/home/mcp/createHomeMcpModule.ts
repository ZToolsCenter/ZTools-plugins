import type { EditorModule } from '../editor/runtime/editorTypes'
import type { McpEditorGatewayOptions } from './createMcpEditorGateway'
import { createMcpEditorGateway } from './createMcpEditorGateway'
import { createMcpGatewayController } from './mcpGatewayController'
import type { McpGatewayController } from './mcpGatewayTypes'

/**
 * 运行时注入的依赖集合：全部为编辑器运行时已有的函数/ref 访问器，
 * 本模块只负责组装，不出现新的编辑器逻辑。
 */
export type CreateHomeMcpModuleOptions = McpEditorGatewayOptions

export interface CreateHomeMcpModuleResult {
  controller: McpGatewayController
  module: EditorModule
}

/**
 * 创建 MCP 网关生命周期模块：
 * - onDocumentReady 时组装编辑器能力并挂载（工具此前未注册成功也会在此重试）；
 * - onDispose 时解绑能力引用，避免热重载/页面关闭后残留过期闭包。
 * 工具向宿主注册只需成功一次；编辑器未就绪期间调用统一返回友好错误。
 */
export function createHomeMcpModule(options: CreateHomeMcpModuleOptions): CreateHomeMcpModuleResult {
  const controller = createMcpGatewayController()

  const module: EditorModule = {
    name: 'home-mcp-gateway',
    onDocumentReady() {
      controller.attach(createMcpEditorGateway(options))
    },
    onDispose() {
      controller.detach()
    }
  }

  return { controller, module }
}
