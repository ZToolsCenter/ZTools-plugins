import {SSHPushStrategy} from './SSHPushStrategy.js';
import {QiniuPushStrategy} from "./QiniuPushStrategy.js";
import {AliPushStrategy} from "@/service/PushPlatform/AliPushStrategy";

export class PushServiceFactory {
    static getService(platform) {
        switch (platform) {
            case 'ssh':
                return new SSHPushStrategy();
            case 'qiniu':
                return new QiniuPushStrategy();
            case "ali":
            case "ALI_OSS":
                return new AliPushStrategy();
            default:
                throw new Error(`不支持的平台类型: ${platform}`);
        }
    }
}