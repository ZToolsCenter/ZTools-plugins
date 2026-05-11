/**
 * @author cplussharp
 * @copyright Crown Copyright 2023
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import r from "jsrsasign";
import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";

/**
 * Public Key from Certificate operation
 */
class PubKeyFromCert extends Operation {

    /**
     * PubKeyFromCert constructor
     */
    constructor() {
        super();

        this.name = "从证书提取公钥";
        this.module = "PublicKey";
        this.description = "从证书中提取公钥。";
        this.infoURL = "https://en.wikipedia.org/wiki/X.509";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [];
        this.checks = [];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        let output = "";
        let match;
        const regex = /-----BEGIN CERTIFICATE-----/g;
        while ((match = regex.exec(input)) !== null) {
            // find corresponding end tag
            const indexBase64 = match.index + match[0].length;
            const footer = "-----END CERTIFICATE-----";
            const indexFooter = input.indexOf(footer, indexBase64);
            if (indexFooter === -1) {
                throw new OperationError(`未找到PEM footer '${footer}'`);
            }

            const certPem = input.substring(match.index, indexFooter + footer.length);
            const cert = new r.X509();
            cert.readCertPEM(certPem);
            let pubKey;
            try {
                pubKey = cert.getPublicKey();
            } catch {
                throw new OperationError("不支持的公钥类型");
            }
            const pubKeyPem = r.KEYUTIL.getPEM(pubKey);

            // PEM ends with '\n', so a new key always starts on a new line
            output += pubKeyPem;
        }
        return output;
    }
}

export default PubKeyFromCert;
