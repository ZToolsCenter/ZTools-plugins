<script setup>
import Likeplugin from "@/components/Likeplugin.vue";
import SslApply from "@/components/SslApply.vue";
import SslPush from "@/components/SslPush.vue";
import SslDetail from "@/components/SslDetail.vue";
import {useThemeStore} from '@/stroes/themeStore.js';
import {getUnreadCount} from "@/utils/notification";
import {monitorSSL} from "@/utils/sslMonitor";
import {getSomeSsl} from "@/utils/tool";
import {CommentOutlined, GiftOutlined, MenuFoldOutlined, MenuUnfoldOutlined} from '@ant-design/icons-vue';
import {theme} from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import {computed, getCurrentInstance, onMounted, onUnmounted, reactive, ref, watch} from "vue";
import {useRoute, useRouter} from 'vue-router';
import {getRealThemeMode, getThemeMode} from "./utils/theme";

const router = useRouter();
const route = useRoute();
const themeStore = useThemeStore();
const colorPrimary = computed(() => themeStore.themeColor);
const config = computed(() => themeStore.config);
const myTheme = reactive({
    token: {
        colorPrimary: colorPrimary,
    },
    algorithm: getRealThemeMode() === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm
})

const renderThemeMode = () => {
    myTheme.algorithm = getRealThemeMode() === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm
}

watch(
    () => themeStore.showMode,
    () => {
        renderThemeMode()
    }
);

const expiredWarn = () => {
    const days = 10;
    const sslList = getSomeSsl(days);
    if (sslList.length > 0) {
        const sslNames = sslList.map(item => item.subdomain).join("、");
        const msg = `您的以下证书有效期已不足${days}天，敬请关注: ${sslNames}`;
        utools.showNotification(msg, "域名助手")
    }
}

const unreadCount = ref(0);

const updateUnreadCount = () => {
    unreadCount.value = getUnreadCount();
};

let timer = null;

utools.onPluginEnter(({type, payload}) => {
    renderThemeMode()
    expiredWarn()
    updateUnreadCount()
    // 需要将monitorssl 每隔一天 调用一次
    setTimeout(() => {
        monitorSSL(() => {
            updateUnreadCount()
        }, () => {
            updateUnreadCount()
        })
    }, 1000);
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    timer = setInterval(() => {
        monitorSSL(() => {
            updateUnreadCount()
        }, () => {
            updateUnreadCount()
        })
    }, 1000 * 60 * 60 * 24);
});

window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change", (e) => {
    if (getThemeMode() === "auto") {
        renderThemeMode();
    }
});

const {useToken} = theme;
const {token} = useToken();

// 当前路由名称
const currentRoute = computed(() => route.name);

// 过滤出要显示在菜单中的路由
const menuItems = computed(() => {
    return router.options.routes.filter(route => !route.meta?.hidden && route.meta?.title);
});
// console.log(config.value);

// 使用计算属性只读，不需要 setter
const isExpanded = computed(() => config.value.menuExpand);

const {proxy} = getCurrentInstance();
const toggleExpand = () => {
    // 直接通过 store 更新状态
    themeStore.updateConfig({
        menuExpand: !isExpanded.value
    });
    // 触发菜单折叠事件
    proxy.$eventBus.emit('menu-collapse-change', !isExpanded.value);
}

// 添加 watch 来监视配置变化
watch(() => config.value.menuExpand, (newVal) => {
    console.log('配置发生变化:', newVal);
});
const openSSL = () => {
    // 打开证书管理
    router.push({name: 'SslRecords'});
}

const feedback = () => {
    utools.fetchUserServerTemporaryToken().then((ret) => {
        utools.shellOpenExternal('https://feedback.esion.xyz/#/auth?type=utools&pluginId=1863098983146651648&accessToken=' + ret.token);
    }).catch(e => {
        utools.showNotification('请先登录');
    });
}
const likePlugin = ref(null);
const doLike = () => {
    likePlugin.value.openZanshang();
}
window.updateUnreadCount = updateUnreadCount;
onMounted(() => {
    proxy.$eventBus.on('notification-updated', updateUnreadCount);
});

onUnmounted(() => {
    proxy.$eventBus.off('notification-updated', updateUnreadCount);
});

</script>

<template>
    <a-config-provider :theme="myTheme" :locale="zhCN">
        <div class="app-container">
            <!-- 左侧菜单 -->
            <div class="side-menu" :class="{ expanded: isExpanded }">
                <div class="menu-items">
                    <div v-for="item in menuItems" :key="item.name" class="menu-item"
                         :class="{ active: currentRoute === item.name }" @click="router.push({ name: item.name })">
                        <a-tooltip :title="!isExpanded ? item.meta.title : ''" placement="right">
                            <div class="icon-wrapper">
                                <a-badge v-if="item.name === 'Notifications'"
                                         :count="item.name === 'Notifications' ? unreadCount : 0"
                                         :offset="isExpanded ? [8, -4] : [0, 0]"
                                         :class="{ 'badge-collapsed': !isExpanded }"
                                >
                                    <component style="font-size: 16px;" :is="item.meta.icon"/>
                                </a-badge>
                                <component v-else :is="item.meta.icon"/>
                            </div>
                        </a-tooltip>
                        <span class="menu-title" :class="{ 'title-expanded': isExpanded }">{{ item.meta.title }}</span>
                    </div>
                    <!--                    增加其它菜单 触发click事件-->
                    <!-- <div class="menu-item" @click="feedback">
                        <a-tooltip title="意见反馈" placement="right">
                            <div class="icon-wrapper">
                                <CommentOutlined/>
                            </div>
                        </a-tooltip>
                        <span class="menu-title" :class="{ 'title-expanded': isExpanded }">意见反馈</span>
                    </div>
                    <div class="menu-item" @click="doLike()">
                        <a-tooltip title="开源共建" placement="right">
                            <div class="icon-wrapper">
                                <GiftOutlined/>
                            </div>
                        </a-tooltip>
                        <span class="menu-title" :class="{ 'title-expanded': isExpanded }">开源共建</span>
                    </div> -->
                </div>
                <div class="expand-button" @click="toggleExpand">
                    <MenuFoldOutlined v-if="isExpanded"/>
                    <MenuUnfoldOutlined v-else/>
                </div>
            </div>

            <!-- 主内容区 -->
            <div class="main-content" :class="{ 'content-expanded': isExpanded }">
                <router-view></router-view>
                <!-- 证书申请 -->
                <SslApply @openapi="openSSL"/>
                <!-- 证书推送 -->
                <SslPush/>
                <!-- 证书详情 -->
                <SslDetail/>
                <Likeplugin ref="likePlugin"/>
            </div>

        </div>
    </a-config-provider>
</template>

<style scoped lang="scss">
.app-container {
    position: relative;
    min-height: 100vh;
    background: v-bind('token.colorBgContainer');
    display: flex;
}

.side-menu {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 48px;
    background: v-bind('token.colorBgContainer');
    border-right: 1px solid v-bind('token.colorBorderSecondary');
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 100;

    &.expanded {
        width: 130px;
    }

    .menu-items {
        padding: 8px;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;

        &::-webkit-scrollbar {
            display: none;
        }
    }

    .menu-item {
        display: flex;
        align-items: center;
        height: 40px;
        margin-bottom: 4px;
        border-radius: 6px;
        cursor: pointer;
        color: v-bind('token.colorTextSecondary');
        //transition: all 0.3s;
        white-space: nowrap;
        overflow: hidden;

        .icon-wrapper {
            position: relative;
            min-width: 32px;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            font-size: 16px !important;
            flex-shrink: 0;

            :deep(.ant-badge-count) {
                z-index: 10;
                min-width: 15px;
                height: 15px;
                padding: 0 4px;
                font-size: 12px;
                line-height: 16px;
                transition: all 0.3s;
            }

            :deep(.ant-badge) {
                color: inherit !important;
            }

            :deep(.badge-collapsed .ant-badge-count) {
                transform: scale(0.8) translate(4px, -4px);
                transform-origin: right top;
            }
        }

        .menu-title {
            margin-left: 12px;
            font-size: 14px;
            max-width: 0;
            opacity: 0;
            overflow: hidden;
            white-space: nowrap;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

            &.title-expanded {
                max-width: 100px;
                opacity: 1;
            }
        }

        &:hover {
            color: v-bind('token.colorPrimary');
            font-weight: 600;

            .icon-wrapper {
                background: v-bind('token.colorBgTextHover');
            }
        }

        &.active {
            color: v-bind('token.colorPrimary');
            font-weight: 600;

            .icon-wrapper {
                background: v-bind('token.colorPrimaryBg');
            }
        }
    }

    .expand-button {
        height: 48px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        color: v-bind('token.colorTextSecondary');
        border-top: 1px solid v-bind('token.colorBorderSecondary');
        font-size: 16px;

        &:hover {
            color: v-bind('token.colorPrimary');
            background: v-bind('token.colorBgTextHover');
        }
    }
}

.main-content {
    margin-left: 48px;
    flex: 1;
    transition: margin-left 0.3s ease;

    box-sizing: border-box;

    &.content-expanded {
        margin-left: 130px;
    }
}

.side-menu:not(.expanded) {
    .icon-wrapper {
        :deep(.ant-badge-count) {
            right: -2px !important;
            top: 0 !important;
            transform: scale(0.8);
        }
    }
}


</style>

<style lang="scss">
html body {
    ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    ::-webkit-scrollbar-thumb {
        background-color: v-bind('token.colorBorder') !important;
        border-radius: 10px !important;
        border: 1px solid v-bind('token.colorBorder') !important;
    }

    ::-webkit-scrollbar-thumb:hover {
        background-color: v-bind('token.colorPrimary') !important;
        border: 1px solid v-bind('token.colorPrimary') !important;
    }

    ::-webkit-scrollbar-track {
        background-color: transparent;
    }

    ::-webkit-scrollbar-track:hover {
        background-color: transparent;
    }

    /*边角，即两个滚动条的交汇处*/
    ::-webkit-scrollbar-corner {
        background-color: transparent;
    }

    /*滚动条的轨道*/
    ::-webkit-scrollbar-track {
        background-color: transparent;
    }

    ::-webkit-scrollbar-track-piece {
        background-color: transparent;
    }
}
</style>
