/**
 * @author cplussharp
 * @copyright Crown Copyright 2021
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { fromHex } from "../lib/Hex.mjs";
import { toBase64 } from "../lib/Base64.mjs";
import r from "jsrsasign";

/**
 * ECDSA Sign operation
 */
class ECDSASign extends Operation {

    /**
     * ECDSASign constructor
     */
    constructor() {
        super();

        this.name = "ECDSA签名";
        this.module = "Ciphers";
        this.description = "使用PEM编码的EC密钥对明文文本进行签名。";
        this.infoURL = "https://wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "ECDSA私钥(PEM)",
                type: "text",
                value: "-----BEGIN EC PRIVATE KEY-----"
            },
            {
                name: "消息摘要算法",
                type: "option",
                value: [
                    "SHA-256",
                    "SHA-384",
                    "SHA-512",
                    "SHA-1",
                    "MD5"
                ]
            },
            {
                name: "输出格式",
                type: "option",
                value: [
                    "ASN.1十六进制",
                    "P1363十六进制",
                    "JSON Web签名（JWS）",
                    "原始JSON"
                ]
            }
        ];
    }

    /**
     * @param {string} input
     * @param {Object[]} args
     * @returns {string}
     */
    run(input, args) {
        const [keyPem, mdAlgo, outputFormat] = args;

        if (keyPem.replace("-----BEGIN EC PRIVATE KEY-----", "").length === 0) {
            throw new OperationError("请输入私钥。");
        }

        const internalAlgorithmName = mdAlgo.replace("-", "") + "withECDSA";
        const sig = new r.KJUR.crypto.Signature({ alg: internalAlgorithmName });
        const key = r.KEYUTIL.getKey(keyPem);
        if (key.type !== "EC") {
            throw new OperationError("提供的密钥不是EC密钥。");
        }
        if (!key.isPrivate) {
            throw new OperationError("提供的密钥不是私钥");
        }
        sig.init(key);
        const signatureASN1Hex = sig.signString(input);

        let result;
        switch (outputFormat) {
            case "ASN.1十六进制":
                result = signatureASN1Hex;
                break;
            case "P1363十六进制":
                result = r.KJUR.crypto.ECDSA.asn1SigToConcatSig(signatureASN1Hex);
                break;
            case "JSON Web签名（JWS）":
                result = r.KJUR.crypto.ECDSA.asn1SigToConcatSig(signatureASN1Hex);
                result = toBase64(fromHex(result), "A-Za-z0-9-_");  // base64url
                break;
            case "原始JSON": {
                const signatureRS = r.KJUR.crypto.ECDSA.parseSigHexInHexRS(signatureASN1Hex);
                result = JSON.stringify(signatureRS);
                break;
            }
        }

        return result;
    }
}

export default ECDSASign;
