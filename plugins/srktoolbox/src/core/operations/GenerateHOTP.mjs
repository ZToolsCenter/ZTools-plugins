/**
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2017
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import * as OTPAuth from "otpauth";

/**
 * Generate HOTP operation
 */
class GenerateHOTP extends Operation {
    /**
     *
     */
    constructor() {
        super();

        this.name = "生成HOTP";
        this.module = "Default";
        this.description = "基于HMAC的一次性密码算法（英语：HMAC-based One-time Password algorithm，HOTP）是一种基于散列消息验证码（HMAC）的一次性密码（OTP）算法，同时也是开放验证提案的基础（OATH）。HOTP在2005年由IETF发布在RFC 4226标准文档中。<br><br>在输入框输入secret，或者留空来生成一个随机值。";
        this.infoURL = "https://wikipedia.org/wiki/HMAC-based_One-time_Password_algorithm";
        this.inputType = "ArrayBuffer";
        this.outputType = "string";
        this.args = [
            {
                "name": "名称",
                "type": "string",
                "value": ""
            },
            {
                "name": "动态码长度",
                "type": "number",
                "value": 6
            },
            {
                "name": "计数器",
                "type": "number",
                "value": 0
            }
        ];
    }

    /**
     *
     */
    run(input, args) {
        const secretStr = new TextDecoder("utf-8").decode(input).trim();
        const secret = secretStr ? secretStr.toUpperCase().replace(/\s+/g, "") : "";

        const hotp = new OTPAuth.HOTP({
            issuer: "",
            label: args[0],
            algorithm: "SHA1",
            digits: args[1],
            counter: args[2],
            secret: OTPAuth.Secret.fromBase32(secret)
        });

        const uri = hotp.toString();
        const code = hotp.generate();

        return `URI： ${uri}\n\n动态码： ${code}`;
    }
}

export default GenerateHOTP;
