/**
 * @author devcydo [devcydo@gmail.com]
 * @author Ma Bingyao [mabingyao@gmail.com]
 * @author n1474335 [n1474335@gmail.com]
 * @copyright Crown Copyright 2024
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import Utils from "../Utils.mjs";
import {encrypt} from "../lib/XXTEA.mjs";

/**
 * XXTEA Encrypt operation
 */
class XXTEAEncrypt extends Operation {

    /**
     * XXTEAEncrypt constructor
     */
    constructor() {
        super();

        this.name = "XXTEA加密";
        this.module = "Ciphers";
        this.description = "纠正后的Block TEA（通常被称为XXTEA）是一种设计用于纠正原始Block TEA中弱点的分组密码。XXTEA操作于可变长度的块，其大小为32位的整数倍（最小64位）。完整的循环次数取决于块的大小，但至少有6次（对于小块大小则上升到32次）。原始的Block TEA对块中的每个字应用XTEA循环函数,并与其最左侧的邻居进行加法组合。解密过程中扩散率较慢被立即利用来破解该密码。纠正后的Block TEA使用了一个更复杂的循环函数，在处理块中的每个字时利用了两个直接邻居。";
        this.infoURL = "https://wikipedia.org/wiki/XXTEA";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.args = [
            {
                "name": "密钥",
                "type": "toggleString",
                "value": "",
                "toggleValues": ["十六进制", "UTF8", "Latin1", "Base64"]
            },
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const key = new Uint8Array(Utils.convertToByteArray(args[0].string, args[0].option));
        return encrypt(new Uint8Array(input), key).buffer;
    }

}

export default XXTEAEncrypt;
