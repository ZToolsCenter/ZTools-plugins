<script setup>
import {getRealThemeMode} from "@/utils/theme";
import {ref} from "vue";
import {goScore} from "@/utils/tool";
import {GithubOutlined, StarOutlined} from '@ant-design/icons-vue';

const zanshang = ref(false);
const activeKey = ref('1');

const donationList = ref([
    {username: '木偶', channel: '微信', amount: 6.66, time: "2025-02-28 13:09:33"},
    {username: 'Ziu', channel: 'utools', amount: 8, time: "2025-02-27 15:41:40"},
    {username: '吖唔咪', channel: 'utools', amount: 8, time: "2025-02-22 18:08:58"},
    {username: 'linkFly', channel: 'utools', amount: 32, time: "2025-01-08 23:20:27"},
    {username: '二丫讲梵', channel: 'utools', amount: 8, time: "2024-12-12 15:23:58"},
    {username: 'red', channel: 'utools', amount: 2, time: "2024-12-07 12:08:27"},
    {username: 'Yahocen', channel: 'utools', amount: 8, time: "2024-11-29 14:13:55"},
    {username: 'xiaou', channel: 'utools', amount: 16, time: "2024-11-26 16:27:38"},
    {username: '佚名', channel: '微信', amount: 8.88, time: "2025-01-06 17:08"},
    {username: '沐风', channel: '微信', amount: 5.12, time: "2024-12-26 15:50"},
    {username: 'A.逍遥🌈', channel: '微信', amount: 8.88, time: "2024-12-11 11:14"},
    {username: '将才路由不成功', channel: '微信', amount: 1.66, time: "2024-12-04 10:24"},
    {username: '二丫讲梵', channel: '微信', amount: 10.24, time: "2024-11-18 19:23"},
    {username: '落雨不悔', channel: '微信', amount: 10.24, time: "2024-11-18 12:05"},
]);

const columns = [
    {
        title: '用户名',
        dataIndex: 'username',
        key: 'username',
    },
    {
        title: '渠道',
        dataIndex: 'channel',
        key: 'channel',
    },
    {
        title: '金额(元)',
        dataIndex: 'amount',
        key: 'amount',
    },
    {
        title: '时间',
        dataIndex: 'time',
        key: 'time',
        defaultSortOrder: 'descend',
        sorter: (a, b) => new Date(a.time) - new Date(b.time),
    },
];

// 按时间排序
donationList.value.sort((a, b) => new Date(b.time) - new Date(a.time));

defineExpose({
    openZanshang: () => {
        zanshang.value = true;
    }
})

const goUrl = (url) => {
    utools.shellOpenExternal(url)
}
</script>

<template>
    <a-modal :footer="null" v-model:open="zanshang" title="感谢支持！🤝" width="800px">
        <a-tabs v-model:activeKey="activeKey">
            <!-- 赞赏模块 -->
            <a-tab-pane key="1" tab="赞赏支持">
                <a-flex align="center" :gap="16">
                    <img
                        style="width: 200px; margin: 0 auto"
                        :src="getRealThemeMode() === 'dark' ? 'img/black_code.jpg' : 'img/white_code.jpg'"
                        alt=""
                    >
                    <div>
                        <div style="height: 10px;"></div>
                        <p>
                            如果您觉得插件对您有帮助，可以通过以下方式赞赏，您的支持是我继续开发的动力！
                        </p>
                        <p>
                            本插件承诺永久免费，但是您的赞赏是我继续开发的动力！
                        </p>
                        <a-flex justify="center" align="center">
                            <a-button @click="goScore('域名助手')">去插件页面赞赏</a-button>
                        </a-flex>
                    </div>
                </a-flex>
            </a-tab-pane>

            <!-- 赞赏榜单 -->
            <a-tab-pane key="2" tab="赞赏榜单">
                <div class="donation-list">
                    <p class="thank-text">感谢以下小伙伴的支持，你们的鼓励是我前进的动力！ </p>
                    <a-table 
                        :columns="columns" 
                        :data-source="donationList" 
                        :pagination="{ 
                            pageSize: 10,
                            showTotal: (total) => `共 ${total} 条记录`
                        }"
                    />
                </div>
            </a-tab-pane>

            <!-- 开源信息 -->
            <a-tab-pane key="3" tab="开源共建">
                <div class="opensource-container">
                    <h3>🌟 欢迎参与共建</h3>
                    <p>本项目已开源，欢迎 Star 和贡献代码！</p>
                    <a-flex justify="center" align="center" :gap="16">
                        <a-button type="primary" @click="goUrl('https://github.com/imxiny/domain-helper')" target="_blank">
                            <template #icon>
                                <GithubOutlined/>
                            </template>
                            访问 GitHub
                        </a-button>
                        <a-button @click="goUrl('https://github.com/imxiny/domain-helper/stargazers')" target="_blank">
                            <template #icon>
                                <StarOutlined/>
                            </template>
                            Star 支持
                        </a-button>
                    </a-flex>
                </div>
            </a-tab-pane>
        </a-tabs>
    </a-modal>
</template>

<style scoped lang="scss">
.opensource-container {
    padding: 20px;
    text-align: center;

    h3 {
        margin-bottom: 16px;
    }

    p {
        margin-bottom: 24px;
    }
}

.donation-list {
    .thank-text {
        text-align: center;
        margin-bottom: 16px;
        font-size: 18px;
        font-weight: bold;
        background: linear-gradient(
            to right,
            #ff0000,
            #ff7f00,
            #ffff00,
            #00ff00,
            #00ffff,
            #0000ff,
            #8b00ff
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        background-size: 200% auto;
        animation: rainbow 5s linear infinite;
    }
}

@keyframes rainbow {
    0% {
        background-position: 0% center;
    }
    100% {
        background-position: 200% center;
    }
}
</style>