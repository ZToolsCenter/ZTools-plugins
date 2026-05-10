/**
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2024
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import Utils from "../Utils.mjs";
import {toJA4S} from "../lib/JA4.mjs";

/**
 * JA4Server Fingerprint operation
 */
class JA4ServerFingerprint extends Operation {

    /**
     * JA4ServerFingerprint constructor
     */
    constructor() {
        super();

        this.name = "JA4S指纹";
        this.module = "Crypto";
        this.description = "生成用于辨识TLS服务器或会话的JA4服务器指纹（JA4S），通过将Server Hello中的值合并后进行哈希计算得出。<br><br>输入：TLS或QUIC Server Hello数据包十六进制流。";
        this.infoURL = "https://medium.com/foxio/ja4-network-fingerprinting-9376fe9ca637";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "输入格式",
                type: "option",
                value: ["十六进制", "Base64", "原始"]
            },
            {
                name: "输出格式",
                type: "option",
                value: ["JA4S", "JA4S原始", "全部"]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [inputFormat, outputFormat] = args;
        input = Utils.convertToByteArray(input, inputFormat);
        const ja4s = toJA4S(new Uint8Array(input));

        // Output
        switch (outputFormat) {
            case "JA4S":
                return ja4s.JA4S;
            case "JA4S原始":
                return ja4s.JA4S_r;
            case "全部":
            default:
                return `JA4S:   ${ja4s.JA4S}\nJA4S_r: ${ja4s.JA4S_r}`;
        }
    }

}

export default JA4ServerFingerprint;
