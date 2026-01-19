<!-- 本地设置 -->
<template>
  <div class="setting-type">
    <div class="set-list">
      <n-h3 prefix="bar"> 系统集成 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">开启系统音频集成</n-text>
          <n-text class="tip" :depth="3">与系统集成以显示媒体元数据，支持高清封面显示</n-text>
        </div>
        <n-switch v-model:value="settingStore.smtcOpen" class="set" :round="false" />
      </n-card>
    </div>
    <div class="set-list">
      <n-h3 prefix="bar"> Last.fm 集成 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">启用 Last.fm</n-text>
          <n-text class="tip" :depth="3">开启后可记录播放历史到 Last.fm</n-text>
        </div>
        <n-switch class="set" v-model:value="settingStore.lastfm.enabled" :round="false" />
      </n-card>
      <n-collapse-transition :show="settingStore.lastfm.enabled">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">API Key</n-text>
            <n-text class="tip" :depth="3">
              在
              <n-a href="https://www.last.fm/zh/api/account/create" target="_blank">
                Last.fm 创建应用
              </n-a>
              获取，只有「程序名称」是必要的
            </n-text>
            <n-text class="tip" :depth="3">
              如果已经创建过，则可以在
              <n-a href="https://www.last.fm/zh/api/accounts" target="_blank">
                Last.fm API 应用程序
              </n-a>
              处查看
            </n-text>
          </div>
          <n-input
            v-model:value="settingStore.lastfm.apiKey"
            placeholder="请输入 API Key"
            class="set"
            type="text"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">API Secret</n-text>
            <n-text class="tip" :depth="3">Shared Secret，用于签名验证</n-text>
          </div>
          <n-input
            v-model:value="settingStore.lastfm.apiSecret"
            placeholder="请输入 API Secret"
            class="set"
            type="password"
            show-password-on="click"
          />
        </n-card>
        <n-card v-if="!settingStore.lastfm.sessionKey" class="set-item">
          <div class="label">
            <n-text class="name">连接 Last.fm 账号</n-text>
            <n-text class="tip" :depth="3">首次使用需要授权连接</n-text>
          </div>
          <n-button
            type="primary"
            strong
            secondary
            :loading="lastfmAuthLoading"
            :disabled="!settingStore.isLastfmConfigured"
            @click="connectLastfm"
          >
            连接账号
          </n-button>
        </n-card>
        <n-card v-else class="set-item">
          <div class="label">
            <n-text class="name">已连接账号</n-text>
            <n-text class="tip" :depth="3">{{ settingStore.lastfm.username }}</n-text>
          </div>
          <n-button type="error" strong secondary @click="disconnectLastfm"> 断开连接 </n-button>
        </n-card>
        <n-card v-if="settingStore.lastfm.sessionKey" class="set-item">
          <div class="label">
            <n-text class="name">Scrobble（播放记录）</n-text>
            <n-text class="tip" :depth="3">自动记录播放历史到 Last.fm</n-text>
          </div>
          <n-switch
            class="set"
            v-model:value="settingStore.lastfm.scrobbleEnabled"
            :round="false"
          />
        </n-card>
        <n-card v-if="settingStore.lastfm.sessionKey" class="set-item">
          <div class="label">
            <n-text class="name">正在播放状态</n-text>
            <n-text class="tip" :depth="3">向 Last.fm 同步正在播放的歌曲</n-text>
          </div>
          <n-switch
            class="set"
            v-model:value="settingStore.lastfm.nowPlayingEnabled"
            :round="false"
          />
        </n-card>
      </n-collapse-transition>
    </div>
    <div v-if="isElectron" class="set-list">
      <n-h3 prefix="bar"> Discord RPC </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">启用 Discord RPC</n-text>
          <n-text class="tip" :depth="3"> 在 Discord 状态中显示正在播放的歌曲 </n-text>
        </div>
        <n-switch
          class="set"
          v-model:value="settingStore.discordRpc.enabled"
          :round="false"
          @update:value="handleDiscordEnabledUpdate"
        />
      </n-card>
      <n-collapse-transition :show="settingStore.discordRpc.enabled">
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">暂停时显示</n-text>
            <n-text class="tip" :depth="3">暂停播放时是否保留 Discord 状态</n-text>
          </div>
          <n-switch
            class="set"
            v-model:value="settingStore.discordRpc.showWhenPaused"
            :round="false"
            @update:value="handleDiscordConfigUpdate"
          />
        </n-card>
        <n-card class="set-item">
          <div class="label">
            <n-text class="name">简略状态显示</n-text>
            <n-text class="tip" :depth="3">不打开详细信息面板时，在用户名下方显示的小字</n-text>
          </div>
          <n-select
            class="set"
            v-model:value="settingStore.discordRpc.displayMode"
            :options="[
              { label: '应用名', value: 'Name' },
              { label: '歌曲名', value: 'Details' },
              { label: '歌手名', value: 'State' },
            ]"
            @update:value="handleDiscordConfigUpdate"
          />
        </n-card>
      </n-collapse-transition>
    </div>
    <div v-if="isElectron" class="set-list">
      <n-h3 prefix="bar"> WebSocket 配置 </n-h3>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">启用 WebSocket</n-text>
          <n-text class="tip" :depth="3"> 开启后可通过 WebSocket 获取状态或控制播放器 </n-text>
        </div>
        <n-switch
          class="set"
          v-model:value="socketEnabled"
          :round="false"
          @update:value="handleSocketEnabledUpdate"
        />
      </n-card>
      <n-card class="set-item">
        <div class="label">
          <n-text class="name">WebSocket 端口</n-text>
          <n-text class="tip" :depth="3"> 更改后需要测试并保存才能生效 </n-text>
        </div>
        <n-flex>
          <Transition name="fade" mode="out-in">
            <n-button
              v-if="socketPort !== socketPortSaved"
              type="primary"
              strong
              secondary
              :loading="socketTestLoading"
              @click="testSocketPort"
            >
              测试并保存
            </n-button>
          </Transition>
          <n-input-number
            v-model:value="socketPort"
            :disabled="socketEnabled"
            :show-button="false"
            :min="1"
            :max="65535"
            placeholder="请输入端口号"
            class="set"
          />
        </n-flex>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAuthToken, getAuthUrl, getSession } from "@/api/lastfm";
import { disableDiscordRpc, enableDiscordRpc, updateDiscordConfig } from "@/core/player/PlayerIpc";
import { useSettingStore } from "@/stores";
import { isElectron } from "@/utils/env";

const settingStore = useSettingStore();

const lastfmAuthLoading = ref(false);

// socket
const socketPort = ref(25885);
const socketEnabled = ref(false);
const socketTestLoading = ref(false);
const socketPortSaved = ref<number | null>(null);

/**
 * 连接 Last.fm 账号
 */
const connectLastfm = async () => {
  try {
    lastfmAuthLoading.value = true;

    // 获取认证令牌
    const tokenResponse = await getAuthToken();
    if (!tokenResponse.token) {
      throw new Error("无法获取认证令牌");
    }

    const token = tokenResponse.token;

    // 打开授权页面
    const authUrl = getAuthUrl(token);
    if (typeof window !== "undefined") {
      const authWindow = window.open(authUrl, "_blank", "width=800,height=600");

      // 轮询等待用户授权
      const checkAuth = setInterval(async () => {
        if (authWindow?.closed) {
          clearInterval(checkAuth);
          if (lastfmAuthLoading.value) {
            lastfmAuthLoading.value = false;
            window.$message.warning("授权已取消");
          }
          return;
        }
        try {
          // 尝试获取会话
          const sessionResponse = await getSession(token);

          if (sessionResponse.session) {
            clearInterval(checkAuth);
            authWindow?.close();

            // 保存会话信息
            settingStore.lastfm.sessionKey = sessionResponse.session.key;
            settingStore.lastfm.username = sessionResponse.session.name;

            window.$message.success(`已成功连接到 Last.fm 账号: ${sessionResponse.session.name}`);
            lastfmAuthLoading.value = false;
          }
        } catch (error) {
          // 用户还未授权，继续等待
        }
      }, 2000);

      // 30秒超时
      setTimeout(() => {
        clearInterval(checkAuth);
        if (lastfmAuthLoading.value) {
          lastfmAuthLoading.value = false;
          window.$message.warning("授权超时，请重试");
        }
      }, 30000);
    }
  } catch (error: any) {
    console.error("Last.fm 连接失败:", error);
    window.$message.error(`连接失败: ${error.message || "未知错误"}`);
    lastfmAuthLoading.value = false;
  }
};

/**
 * 断开 Last.fm 账号
 */
const disconnectLastfm = () => {
  window.$dialog.warning({
    title: "断开连接",
    content: "确定要断开与 Last.fm 的连接吗？",
    positiveText: "确定",
    negativeText: "取消",
    onPositiveClick: () => {
      settingStore.lastfm.sessionKey = "";
      settingStore.lastfm.username = "";
      window.$message.success("已断开与 Last.fm 的连接");
    },
  });
};

// Discord RPC
const handleDiscordEnabledUpdate = (val: boolean) => {
  if (val) {
    enableDiscordRpc();
    // 启用时同步一次配置
    handleDiscordConfigUpdate();
  } else {
    disableDiscordRpc();
  }
};

const handleDiscordConfigUpdate = () => {
  if (!settingStore.discordRpc.enabled) return;
  updateDiscordConfig({
    showWhenPaused: settingStore.discordRpc.showWhenPaused,
    displayMode: settingStore.discordRpc.displayMode,
  });
};

// 初始化 socket 配置
const initSocketConfig = async () => {
  if (!isElectron) return;
  const wsOptions = await window.api.store.get("websocket");
  const portFromStore = wsOptions?.port ?? 25885;
  socketPort.value = portFromStore;
  socketPortSaved.value = portFromStore;
  socketEnabled.value = wsOptions?.enabled ?? false;
};

// 保存 socket 配置
const saveSocketConfig = async () => {
  if (!isElectron) return;
  await window.api.store.set("websocket", {
    enabled: socketEnabled.value,
    port: socketPort.value,
  });
};

// 切换启用状态
const handleSocketEnabledUpdate = async (value: boolean) => {
  if (!isElectron) {
    socketEnabled.value = value;
    await saveSocketConfig();
    return;
  }
  if (value) {
    // 如果端口未测试通过，提示用户先测试端口
    if (socketPort.value !== socketPortSaved.value) {
      window.$message.warning("请先测试并保存端口配置后再启用 WebSocket");
      socketEnabled.value = false;
      return;
    }

    const result = await window.electron.ipcRenderer.invoke("socket-start");
    if (result?.success) {
      socketEnabled.value = true;
      await saveSocketConfig();
      window.$message.success("WebSocket 服务已启动");
    } else {
      window.$message.error(result?.message ?? "WebSocket 启动失败");
      // 回退开关状态
      socketEnabled.value = false;
    }
  } else {
    const result = await window.electron.ipcRenderer.invoke("socket-stop");
    if (result?.success) {
      socketEnabled.value = false;
      await saveSocketConfig();
      window.$message.success("WebSocket 服务已关闭");
    } else {
      window.$message.error(result?.message ?? "WebSocket 关闭失败");
      socketEnabled.value = true;
    }
  }
};

// 测试 socket 端口
const testSocketPort = async () => {
  if (!isElectron) return;
  if (!socketPort.value) {
    window.$message.error("请输入端口号");
    return;
  }
  socketTestLoading.value = true;
  try {
    const result = await window.electron.ipcRenderer.invoke("socket-test-port", socketPort.value);
    if (result?.success) {
      await saveSocketConfig();
      socketPortSaved.value = socketPort.value;
      window.$message.success("已保存 WebSocket 配置");
    } else {
      window.$message.error(result?.message ?? "该端口不可用，请更换端口");
    }
  } finally {
    socketTestLoading.value = false;
  }
};

onMounted(() => {
  initSocketConfig();
});
</script>
