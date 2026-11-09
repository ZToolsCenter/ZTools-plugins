# Pasteboard Pro 格式保真：主链接入范围审批

**状态：待范围审批。** 此前授权仅覆盖插件目录。完整 V2 需要宿主拥有可信服务；Windows 托管执行入口涉及插件仓库根目录。以下 A、B 可分别批准；本文件本身不授权实施、提交、推送或发布。当前没有进行宿主或 CI 写入。

## A. 宿主主链接入

**仓库：** `/Users/harris/Desktop/ZTools`。**计划开发分支：** `codex/paste-format-v2-service`。**计划隔离工作区：** `/Users/harris/Desktop/ZTools/.worktrees/paste-format-v2-service`。

只读上游基线为 `76addc6a03940006b5c208e125737d7d4ce953e9`；本地 `main`/`origin/main` 的 `b185` 落后 140 个提交，`9b15` 是本地 security 分支上的历史快照。批准后先安全 fetch 并核对远端、精确 SHA、分支/工作区是否已存在及现有改动；从核实的 pin 新建上述独立开发分支和工作区。目标被占用、pin 不匹配或工作区不安全时停止并报告；不搬入 security 分支的整支改动，不清理或覆盖其他工作。

拟涉及的文件组与职责：

- 新增宿主主进程 `src/main/core/clipboard-v2/` 下的 service、单 monitor hub、当前策略 authority、私有 store、独占 lease、恢复与 GC、planner/publisher，以及 scope view/bootstrap 和队列状态；模块按职责拆分。具体文件名以实施前核对为准。
- 新增受限 IPC、sender/install generation/frame/session 与 capability grant 校验、严格 schema 和 typed error；仅向插件暴露脱敏 view 与 opaque handle。安全核心及其依赖必须进入宿主可信构建链，不从可写插件 runtime 加载。
- 在审计后的现有 `src/main/managers/clipboardManager.ts`、`src/main/core/native/index.ts`、宿主 preload/IPC 注册和 app 生命周期入口做必要薄接线；确切入口以 `76addc` 检出后的 import graph 为准。hub 统一扇出监听信号，不另建独立监听。
- 新增 macOS/Windows adapter、受监督 native helper 与对应原生构建配置；必要时调整宿主原生源码、依赖锁、构建和打包配置。平台具体路径及依赖版本待检出审计，不能依赖预编译二进制推断能力。
- 新增宿主拥有的权限、隐私及保留策略 UI 和用户配置；先审计宿主 UI、文案、图标与 asset 的来源和构建链。可写插件 UI 不能授予宿主安全权限或作为当前策略权威。确切 UI 文件待审计，不以插件设置页代替宿主授权。
- 补充相应单元、集成、故障注入和打包测试，以及按原方案需要的插件 adapter 接线；测试和 feature flags 按平台独立 gate。涉及的插件代码仍在 `plugin/pasteboard-pro` 开发工作区内，保留已有修改。

宿主实施先处理可信 owner、授权、存储和平台边界，再接真实 adapter 与统一回贴。阶段交付仅表示依赖顺序；[技术方案](TECHNICAL_PLAN.md) 的 G0–G4、Windows 10/11 首期必选、G3 独立 crypto wire 与六方向验收均不缩减。[实施 ADR](IMPLEMENTATION_ADR.md) 的限定设计复审已通过，不是实施授权或运行验收；运行能力仅在各自门禁通过后声明。

## B. 插件仓库根 Windows 原生探针 workflow

**仓库及开发分支：** `/Users/harris/Desktop/ZTools-plugins`，`plugin/pasteboard-pro`。**拟新增唯一根文件：** `.github/workflows/paste-format-native.yml`。

在该分支现有开发工作区先核对 HEAD、目标路径和状态；只新增该 workflow，不修改其他根 workflow、其他插件或已有 dirty 文件。已有同名文件或分支/工作区不符则停止并报告。此选择保持 workflow 与插件当前开发分支收敛；不另建会遗漏当前未提交插件改动的孤立副本，也不在测试分支开发。必要的插件内脚本/证据仍在原先插件目录授权范围内。

workflow 设计为显式受控触发，使用 Windows 托管 runner 构建并运行项目现有 **105 + 15** 原生探针，保存版本、源码/二进制指纹、日志与结果；必须先核对现有脚本、权限、依赖和 runner 对应架构，不能把配置文件创建视为执行成功。托管 runner 的结果不能替代 Windows 10/11 客户端真实应用矩阵、系统存储故障和设备验收。当前没有 Windows 环境，相关结果保持未运行；不因此降低原目标。

## 两项范围共同边界

- 不改无关 security 功能、其他插件或已有 dirty 工作；不触碰旧账户数据，不自动读取系统 general clipboard、自动发键或外发私有数据。
- 不提交、推送、合并、发布或部署。后续需要这些动作时仍单独遵循提交及发布授权流程。
- 批准 A 不隐含批准 B，批准 B 不隐含批准 A；任一范围外的新路径或不可安全完成的操作先报告。
- A/B 均不自动开启 V2 生产 flags，不将 ADR、CI 或局部探针通过称为 G0–G4 验收。实际平台能力、Windows 10/11 客户端、六方向同步及 G3 crypto 仍需独立证据。

请分别选择是否批准 **A 宿主主链接入范围** 与 **B 插件仓库根 Windows workflow 范围**。当前仅提供可审阅计划，尚无宿主或 CI 写入。
