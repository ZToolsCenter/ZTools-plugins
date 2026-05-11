import {httpsRequest} from './http';
import dayjs from 'dayjs';

const URL = preload.url.URL;
/**
 * 发送企业微信机器人消息
 * @param {string} url Webhook URL
 * @param {object} data 消息内容 { title: string, content: string }
 */
export const sendWecomMessage = async (url, data) => {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify({
        msgtype: 'text',
        text: {
            content: `${data.title}\n${data.content}`
        }
    });

    try {
        const response = await httpsRequest(options, postData, true);
        if (response.errcode !== 0) {
            console.log(response)
            throw new Error(response.errmsg || '发送失败');
        }
        return response;
    } catch (error) {
        console.error('企业微信消息发送失败:', error);
        throw error;
    }
};

/**console
 * 发送飞书机器人消息
 * @param url
 * @param data
 * @returns {Promise<unknown>}
 */
export const sendFeishuMessage = async (url, data) => {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify({
        msg_type: 'text',
        content: {
            text: `${data.title}\n${data.content}`
        }
    });

    try {
        const response = await httpsRequest(options, postData, true);
        if (response.StatusCode !== 0) {
            throw new Error(response.errmsg || '发送失败');
        }
        return response;
    } catch (error) {
        console.error('飞书发送失败:', error);
        throw error;
    }
};


/**
 * 发送钉钉机器人消息
 * @param {string} url Webhook URL
 * @param {object} data 消息内容 { title: string, content: string }
 */
export const sendDingTalkMessage = async (url, data) => {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify({
        msgtype: 'text',
        text: {
            content: `${data.title}\n${data.content}`
        }
    });

    try {
        const response = await httpsRequest(options, postData, true);
        if (response.errcode !== 0) {
            throw new Error(response.errmsg || '发送失败');
        }
        return response;
    } catch (error) {
        console.error('钉钉消息发送失败:', error);
        throw error;
    }
};

/**
 * 发送 Server酱 消息
 * @param {string} url Server酱推送 URL
 * @param {object} data 消息内容 { title: string, content: string }
 */
export const sendServerChanMessage = async (url, data) => {


    url = `https://sctapi.ftqq.com/${url}.send`

    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify({
        title: data.title,
        desp: data.content
    });

    try {
        const response = await httpsRequest(options, postData, true);
        if (response.code !== 0) {
            throw new Error(response.message || '发送失败');
        }
        return response;
    } catch (error) {
        console.error('Server酱消息发送失败:', error);
        throw error;
    }
};

/**
 * 发送 AnPush 消息
 * @param {string} url AnPush URL
 * @param {object} data 消息内容 { title: string, content: string }
 */
export const sendAnPushMessage = async (url, data) => {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify({
        title: data.title,
        content: data.content
    });

    try {
        const response = await httpsRequest(options, postData, true);
        if (response.code !== 200) {
            throw new Error(response.message || '发送失败');
        }
        return response;
    } catch (error) {
        console.error('AnPush消息发送失败:', error);
        throw error;
    }
};

/**
 * 发送自定义 URL 消息
 * @param {string} url 自定义推送 URL
 * @param {object} data 消息内容 { title: string, content: string }
 */
export const sendCustomMessage = async (url, data) => {
    const urlObj = new URL(url);
    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const postData = JSON.stringify(data);

    try {
        let ext = {is_https: false}
        // 判断是否使用https
        if (url.startsWith('https')) {
            ext.is_https = true
        }
        return await httpsRequest(options, postData, true, ext);
    } catch (error) {
        console.error('自定义消息发送失败:', error);
        throw error;
    }
};

/**
 * 验证通知渠道
 * @param {string} type 通知类型
 * @param {string} url 推送 URL
 * @returns {Promise<boolean>}
 */
export const validateNotification = async (type, url) => {
    const testData = {
        title: '测试消息',
        content: ' 这是一条测试消息，用于验证推送渠道是否可用。' + "\n\n" + dayjs().format('YYYY-MM-DD HH:mm:ss')
    };

    try {
        await sendNotification(type, url, testData);
        return true;
    } catch (error) {
        console.error('验证失败:', error);
        throw error;
    }
};


export const sendNotification = async (type, url, data) => {
    data.title = "【域名助手】" + data.title;
    switch (type) {
        case 'wechat':
            await sendWecomMessage(url, data);
            break;
        case 'dingtalk':
            await sendDingTalkMessage(url, data);
            break;
        case 'serverChan':
            await sendServerChanMessage(url, data);
            break;
        case 'anPush':
            await sendAnPushMessage(url, data);
            break;
        case 'custom':
            await sendCustomMessage(url, data);
            break;
        case 'feishu':
            await sendFeishuMessage(url, data);
            break;
        default:
            throw new Error('不支持的通知类型');
    }
}
