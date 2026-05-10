/**
 * @author j433866 [j433866@gmail.com]
 * @copyright Crown Copyright 2019
 * @license Apache-2.0
 *
 * Modified by Raka-loah@github for zh-CN i18n
 */

import Operation from "../Operation.mjs";
import OperationError from "../errors/OperationError.mjs";
import { isImage } from "../lib/FileType.mjs";
import { toBase64 } from "../lib/Base64.mjs";
import { Jimp, JimpMime, PNGFilterType } from "jimp";

/**
 * Convert Image Format operation
 */
class ConvertImageFormat extends Operation {
    /**
     * ConvertImageFormat constructor
     */
    constructor() {
        super();

        this.name = "图像格式转换";
        this.module = "Image";
        this.description =
            "转换图像格式。支持的格式：<br><ul><li>Joint Photographic Experts Group (JPEG)</li><li>Portable Network Graphics (PNG)</li><li>Bitmap (BMP)</li><li>Tagged Image File Format (TIFF)</li></ul><br>注意：支持将GIF文件转换成其它格式，不支持转换成GIF。";
        this.infoURL = "https://wikipedia.org/wiki/Image_file_formats";
        this.inputType = "ArrayBuffer";
        this.outputType = "ArrayBuffer";
        this.presentType = "html";
        this.args = [
            {
                name: "输出格式",
                type: "option",
                value: ["JPEG", "PNG", "BMP", "TIFF"],
            },
            {
                name: "JPEG质量",
                type: "number",
                value: 80,
                min: 1,
                max: 100,
            },
            {
                name: "PNG过滤类型",
                type: "option",
                value: ["Auto", "None", "Sub", "Up", "Average", "Paeth"],
            },
            {
                name: "PNG Deflate等级",
                type: "number",
                value: 9,
                min: 0,
                max: 9,
            },
        ];
    }

    /**
     * @param {ArrayBuffer} input
     * @param {Object[]} args
     * @returns {byteArray}
     */
    async run(input, args) {
        const [format, jpegQuality, pngFilterType, pngDeflateLevel] = args;
        const formatMap = {
            JPEG: JimpMime.jpeg,
            PNG: JimpMime.png,
            BMP: JimpMime.bmp,
            TIFF: JimpMime.tiff,
        };

        const pngFilterMap = {
            Auto: PNGFilterType.AUTO,
            None: PNGFilterType.NONE,
            Sub: PNGFilterType.SUB,
            Up: PNGFilterType.UP,
            Average: PNGFilterType.AVERAGE,
            Paeth: PNGFilterType.PATH,
        };

        const mime = formatMap[format];

        if (!isImage(input)) {
            throw new OperationError("无效的文件格式。");
        }
        let image;
        try {
            image = await Jimp.read(input);
        } catch (err) {
            throw new OperationError(`打开图像文件出错：(${err})`);
        }
        try {
            let buffer;
            switch (mime) {
                case JimpMime.jpeg:
                    buffer = await image.getBuffer(mime, {
                        quality: jpegQuality,
                    });
                    break;
                case JimpMime.png:
                    buffer = await image.getBuffer(mime, {
                        filterType: pngFilterMap[pngFilterType],
                        deflateLevel: pngDeflateLevel,
                    });
                    break;
                default:
                    buffer = await image.getBuffer(mime);
                    break;
            }

            return buffer.buffer;
        } catch (err) {
            throw new OperationError(`转换图像格式出错：(${err})`);
        }
    }

    /**
     * Displays the converted image using HTML for web apps
     *
     * @param {ArrayBuffer} data
     * @returns {html}
     */
    present(data) {
        if (!data.byteLength) return "";
        const dataArray = new Uint8Array(data);

        const type = isImage(dataArray);
        if (!type) {
            throw new OperationError("无效的文件类型。");
        }

        return `<img src="data:${type};base64,${toBase64(dataArray)}">`;
    }
}

export default ConvertImageFormat;
