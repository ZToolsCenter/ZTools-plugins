<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { pickPath, START_TYPES, type NssmConfig } from '../api'
import { confirmAndRun } from '../run'

const props = defineProps<{
  mode: 'install' | 'edit'
  nssmPath: string
  name: string
  initial: NssmConfig
  startMode: string
}>()
const emit = defineEmits<{ (e: 'saved'): void; (e: 'close'): void }>()

const isEdit = computed(() => props.mode === 'edit')

// ==================== 表单数据 ====================
const name = ref(props.name)
const application = ref(str(props.initial.AppApplication))
const parameters = ref(str(props.initial.AppParameters))
const appDirectory = ref(str(props.initial.AppDirectory))
const startType = ref(
  props.startMode === 'Manual' ? 'manual' : props.startMode === 'Disabled' ? 'disabled' : 'auto'
)

const stdout = ref(str(props.initial.AppStdout))
const stderr = ref(str(props.initial.AppStderr))
const rotate = ref(str(props.initial.AppRotateFiles) === '1')
const rotateOnline = ref(str(props.initial.AppRotateOnline) === '1')
const rotateMb = ref(props.initial.AppRotateBytes ? Number(props.initial.AppRotateBytes) / 1048576 : 10)

const exitCode = ref(props.initial.AppExit && /^\d+$/.test(str(props.initial.AppExit)) ? str(props.initial.AppExit) : '')
const exitAction = ref(/^(Restart|Ignore|Exit)$/.test(str(props.initial.AppExit)) ? str(props.initial.AppExit) : '')
const restartDelay = ref(props.initial.AppRestartDelay ? Number(props.initial.AppRestartDelay) : undefined)
const throttle = ref(props.initial.AppThrottle ? Number(props.initial.AppThrottle) : undefined)
const priority = ref(str(props.initial.AppPriority))
const stopSkips = ref<number[]>([])
const environment = ref(Array.isArray(props.initial.AppEnvironment) ? props.initial.AppEnvironment.join('\n') : '')
const startAfterInstall = ref(true)

const stopSkipSum = computed(() => stopSkips.value.reduce((a, b) => a + b, 0))

function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join('\n')
  return (v ?? '') as string
}

// ==================== 浏览选择 ====================
function browse(kind: 'application' | 'appDirectory' | 'stdout' | 'stderr') {
  if (kind === 'appDirectory') {
    const p = pickPath('folder', '选择启动目录')
    if (p) appDirectory.value = p
    return
  }
  const filters =
    kind === 'application'
      ? [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd'] }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: '日志文件', extensions: ['log', 'txt'] }, { name: '所有文件', extensions: ['*'] }]
  const p = pickPath('file', kind === 'application' ? '选择程序' : '选择日志文件', filters)
  if (!p) return
  if (kind === 'application') application.value = p
  else if (kind === 'stdout') stdout.value = p
  else stderr.value = p
}

// ==================== 保存 ====================
async function save() {
  if (!props.nssmPath) {
    ElMessage.error('nssm 路径未配置')
    return
  }
  if (!name.value.trim()) {
    ElMessage.warning('请填写服务名')
    return
  }
  if (!isEdit.value && !application.value.trim()) {
    ElMessage.warning('请填写程序路径')
    return
  }
  const payload = {
    mode: props.mode,
    nssmPath: props.nssmPath,
    name: name.value.trim(),
    application: application.value.trim(),
    parameters: parameters.value.trim(),
    appDirectory: appDirectory.value.trim(),
    startType: startType.value,
    stdout: stdout.value.trim(),
    stderr: stderr.value.trim(),
    rotate: rotate.value,
    rotateOnline: rotateOnline.value,
    rotateBytes: rotate.value && rotateMb.value ? Math.round(rotateMb.value * 1048576) : 0,
    exitCode: exitCode.value,
    exitAction: exitAction.value,
    restartDelay: restartDelay.value ?? '',
    throttle: throttle.value ?? '',
    priority: priority.value,
    stopSkip: stopSkipSum.value,
    environment: environment.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  }
  const ops = window.services.buildNssmOps(payload)
  if (props.mode === 'install' && startAfterInstall.value) {
    ops.push("& '" + props.nssmPath.replace(/'/g, "''") + "' start '" + name.value.trim().replace(/'/g, "''") + "'")
  }
  const outcome = await confirmAndRun(
    props.mode === 'install' ? `安装服务 ${name.value}` : `保存服务 ${name.value} 配置`,
    ops
  )
  // 取消：留在表单里，允许修改后重试
  if (outcome === 'canceled') return
  if (outcome === 'success' && isEdit.value) {
    // nssm set 本质写注册表，运行中的服务不热加载参数
    try {
      await ElMessageBox.confirm('参数已写入注册表。运行中的服务需重启才能生效，立即重启？', '保存成功', {
        confirmButtonText: '立即重启',
        cancelButtonText: '稍后手动重启',
        type: 'success'
      })
      await window.services.runCommands(window.services.buildServiceActionOps(name.value.trim(), 'restart'))
    } catch (e) {
      /* 稍后重启 */
    }
  }
  // 执行过（成败都）关闭编辑窗，列表由父组件刷新
  emit('saved')
}

const priorities = [
  { value: 'NORMAL_PRIORITY_CLASS', label: '正常' },
  { value: 'ABOVE_NORMAL_PRIORITY_CLASS', label: '高于正常' },
  { value: 'HIGH_PRIORITY_CLASS', label: '高' },
  { value: 'BELOW_NORMAL_PRIORITY_CLASS', label: '低于正常' },
  { value: 'IDLE_PRIORITY_CLASS', label: '低' },
  { value: 'REALTIME_PRIORITY_CLASS', label: '实时（慎用，可能饿死系统进程）' }
]

const stopSkipOptions = [
  { value: 1, label: '控制台事件 (Ctrl+C)' },
  { value: 2, label: '窗口消息' },
  { value: 4, label: '等待线程自然退出' },
  { value: 8, label: '最终强杀进程' }
]
</script>

<template>
  <el-dialog
    :model-value="true"
    :title="isEdit ? `编辑 nssm 服务：${name}` : '安装 nssm 服务'"
    width="90%"
    top="3vh"
    :close-on-click-modal="false"
    :lock-scroll="false"
    @close="emit('close')"
  >
    <el-tabs>
      <el-tab-pane label="基础">
        <el-form label-width="110px" label-position="right" size="small">
          <el-form-item label="服务名">
            <el-input v-model="name" :disabled="isEdit" placeholder="系统内唯一，如 my-app" />
            <p class="tip">注册后通过服务名引用（sc / nssm / services.msc 均使用它），注册后不可改。</p>
          </el-form-item>
          <el-form-item label="程序路径">
            <el-input v-model="application" placeholder="例如 D:\app\server.exe 或 C:\Java\bin\java.exe">
              <template #append>
                <el-button @click="browse('application')">浏览</el-button>
              </template>
            </el-input>
            <p class="tip">nssm 会以服务方式拉起它。普通程序（jar/node/python 等）没有服务协议，正是由 nssm 托管后才成为合法服务。</p>
          </el-form-item>
          <el-form-item label="启动参数">
            <el-input v-model="parameters" placeholder="例如 -jar app.jar --port 8080" />
            <p class="tip">原样追加在程序路径之后的命令行参数。</p>
          </el-form-item>
          <el-form-item label="启动目录">
            <el-input v-model="appDirectory" placeholder="例如 D:\app">
              <template #append>
                <el-button @click="browse('appDirectory')">浏览</el-button>
              </template>
            </el-input>
            <p class="tip">程序的工作目录。相对路径读写、日志输出、配置加载都基于它，建议必填。</p>
          </el-form-item>
          <el-form-item label="启动类型">
            <el-select v-model="startType" style="width: 200px">
              <el-option v-for="t in START_TYPES" :key="t.value" :label="t.label" :value="t.value" />
            </el-select>
            <p class="tip">自动=开机启动；自动(延迟)=开机后延迟启动，减轻开机压力；手动=仅按需启动；禁用=不允许启动。</p>
          </el-form-item>
          <el-form-item v-if="!isEdit" label="安装后启动">
            <el-switch v-model="startAfterInstall" />
            <p class="tip">安装完成（写注册表 + 注册服务）后立即 nssm start。</p>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="日志">
        <el-form label-width="110px" label-position="right" size="small">
          <el-form-item label="stdout 日志">
            <el-input v-model="stdout" placeholder="例如 D:\app\logs\out.log">
              <template #append>
                <el-button @click="browse('stdout')">浏览</el-button>
              </template>
            </el-input>
            <p class="tip">程序控制台标准输出重定向到该文件（目录需已存在）。这是查看服务化程序输出的主要途径。</p>
          </el-form-item>
          <el-form-item label="stderr 日志">
            <el-input v-model="stderr" placeholder="例如 D:\app\logs\err.log">
              <template #append>
                <el-button @click="browse('stderr')">浏览</el-button>
              </template>
            </el-input>
            <p class="tip">标准错误输出重定向文件，报错信息通常在这里。</p>
          </el-form-item>
          <el-form-item label="日志轮转">
            <el-switch v-model="rotate" />
            <template v-if="rotate">
              <div style="width: 100%">
                <el-checkbox v-model="rotateOnline">运行中在线轮转</el-checkbox>
                <el-input-number v-model="rotateMb" :min="1" size="small" style="width: 120px" />
                <span> MB 后切割</span>
                <p class="tip">
                  轮转 = 日志到达大小后归档为 .old 再开新文件，防止日志无限膨胀。
                  在线轮转无需停止服务（Windows Vista+ 生效）。留空大小则按天轮转。
                </p>
              </div>
            </template>
            <p v-else class="tip">开启后日志文件不会无限增长（归档为 .old）。</p>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="高级">
        <el-form label-width="110px" label-position="right" size="small">
          <el-form-item label="退出动作">
            <div style="display: flex; gap: 8px; width: 100%">
              <el-input v-model="exitCode" placeholder="退出码，如 0" style="width: 140px" />
              <el-select v-model="exitAction" placeholder="动作" style="width: 160px">
                <el-option label="Restart 重启" value="Restart" />
                <el-option label="Ignore 忽略" value="Ignore" />
                <el-option label="Exit 停止服务" value="Exit" />
              </el-select>
            </div>
            <p class="tip">
              程序以指定退出码退出时 nssm 的处理动作。例如「0 + Ignore」表示正常退出后不重启服务。
              不填则使用默认动作（重启）。
            </p>
          </el-form-item>
          <el-form-item label="重启延迟">
            <el-input-number v-model="restartDelay" :min="0" :step="1000" style="width: 160px" />
            <span style="margin-left: 6px">毫秒</span>
            <p class="tip">程序退出后，nssm 重启它之前额外等待的时间。给上游服务（数据库等）留恢复时间用。</p>
          </el-form-item>
          <el-form-item label="崩溃节流">
            <el-input-number v-model="throttle" :min="0" :step="500" style="width: 160px" />
            <span style="margin-left: 6px">毫秒</span>
            <p class="tip">
              程序启动后在该时间内就退出，视为崩溃：nssm 放慢重启节奏（每 1500ms 一次默认），避免陷入疯狂重启循环。默认 1500 即可。
            </p>
          </el-form-item>
          <el-form-item label="进程优先级">
            <el-select v-model="priority" placeholder="默认（正常）" clearable style="width: 220px">
              <el-option v-for="p in priorities" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
            <p class="tip">服务进程的 CPU 调度优先级，一般保持默认。</p>
          </el-form-item>
          <el-form-item label="停止方式">
            <el-checkbox-group v-model="stopSkips">
              <el-checkbox v-for="o in stopSkipOptions" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
            </el-checkbox-group>
            <p class="tip">
              nssm 停止服务的顺序：控制台 → 窗口消息 → 等线程退出 → 强杀。
              勾选 = 跳过该步骤。全勾 8 会导致服务永远停不掉，慎用；通常留空。
            </p>
          </el-form-item>
          <el-form-item label="环境变量">
            <el-input
              v-model="environment"
              type="textarea"
              :rows="3"
              placeholder="KEY=VALUE，每行一个"
            />
            <p class="tip">传给服务进程的环境变量。注意：保存会整体覆盖该服务已有的环境变量列表。</p>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" @click="save">{{ isEdit ? '保存' : '安装' }}</el-button>
    </template>
  </el-dialog>
</template>
