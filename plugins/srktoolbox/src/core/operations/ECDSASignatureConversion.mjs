/**
 * @author cplussharp
 * @copyright Crown Copyright 2021
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { fromBase64, toBase64 } from "../lib/Base64.mjs";
import { fromHex, toHexFast } from "../lib/Hex.mjs";
import r from "jsrsasign";

/**
 * ECDSA Sign operation
 */
class ECDSASignatureConversion extends Operation {

    /**
     * ECDSASignatureConversion constructor
     */
    constructor() {
        super();

        this.name = "ECDSA签名格式转换";
        this.module = "Ciphers";
        this.description = "将ECDSA签名转换为十六进制、ASN.1和JSON格式。";
        this.infoURL = "https://wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm";
        this.inputType = "string";
        this.outputType = "string";
        this.args = [
            {
                name: "输入格式",
                type: "option",
                value: [
                    "自动检测",
                    "ASN.1十六进制",
                    "P1363十六进制",
                    "JSON Web签名（JWS）",
                    "原始JSON"
                ]
            },
            {
                name: "Output Format",
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
        let inputFormat = args[0];
        const outputFormat = args[1];

        // detect input format
        let inputJson;
        if (inputFormat === "自动检测") {
            try {
                inputJson = JSON.parse(input);
                if (typeof(inputJson) === "object") {
                    inputFormat = "原始JSON";
                }
            } catch {}
        }

        if (inputFormat === "自动检测") {
            const hexRegex = /^[a-f\d]{2,}$/gi;
            if (hexRegex.test(input)) {
                if (input.substring(0, 2) === "30" && r.ASN1HEX.isASN1HEX(input)) {
                    inputFormat = "ASN.1十六进制";
                } else {
                    inputFormat = "P1363十六进制";
                }
            }
        }

        let inputBase64;
        if (inputFormat === "自动检测") {
            try {
                inputBase64 = fromBase64(input, "A-Za-z0-9-_", false);
                inputFormat = "JSON Web签名（JWS）";
            } catch {}
        }

        // convert input to ASN.1 hex
        let signatureASN1Hex;
        switch (inputFormat) {
            case "自动检测":
                throw new OperationError("无法检测到签名格式");
            case "ASN.1十六进制":
                signatureASN1Hex = input;
                break;
            case "P1363十六进制":
                signatureASN1Hex = r.KJUR.crypto.ECDSA.concatSigToASN1Sig(input);
                break;
            case "JSON Web签名（JWS）":
                if (!inputBase64) inputBase64 = fromBase64(input, "A-Za-z0-9-_");
                signatureASN1Hex = r.KJUR.crypto.ECDSA.concatSigToASN1Sig(toHexFast(inputBase64));
                break;
            case "原始JSON": {
                if (!inputJson) inputJson = JSON.parse(input);
                if (!inputJson.r) {
                    throw new OperationError('签名JSON中没有"r"值');
                }
                if (!inputJson.s) {
                    throw new OperationError('签名JSON中没有"s"值');
                }
                signatureASN1Hex = r.KJUR.crypto.ECDSA.hexRSSigToASN1Sig(inputJson.r, inputJson.s);
                break;
            }
        }

        // convert ASN.1 hex to output format
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

export default ECDSASignatureConversion;
