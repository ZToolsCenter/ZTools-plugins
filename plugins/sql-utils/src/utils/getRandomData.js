/*生成随机数据工具类*/
import * as commonConsts from "@/utils/commonConsts";
import areaData from '@/utils/area.json';

const validAreaCodes = [];
for (const province of areaData) {
    if (Array.isArray(province.city)) {
        for (const city of province.city) {
            if (Array.isArray(city.area)) {
                for (const district of city.area) {
                    if (district.code && district.name !== '市辖区' && district.name !== '县') {
                        validAreaCodes.push(district.code);
                    }
                }
            }
        }
    }
}


/**
 * 获取随机姓名
 * @returns {string}
 */
export function getPersonName() {
    const randomSurname = commonConsts.surnames[Math.floor(Math.random() * commonConsts.surnames.length)];
    const nameLength = Math.random() < 0.5 ? 1 : 2; // 随机决定名字是一个字还是两个字
    let randomGivenName = '';
    for (let i = 0; i < nameLength; i++) {
        randomGivenName += commonConsts.givenNames[Math.floor(Math.random() * commonConsts.givenNames.length)];
    }
    return randomSurname + randomGivenName;
}


/**
 * 获取随机邮箱
 * @returns {string}
 */
export function getEmail() {
    // 定义常见的邮箱域名
    // 生成随机的用户名部分，这里简单地生成 8 位的随机字符串
    let username = '';
    for (let i = 0; i < 8; i++) {
        username += commonConsts.lowerCaseLetterAndNumber.charAt(Math.floor(Math.random() * commonConsts.lowerCaseLetterAndNumber.length));
    }
    // 随机选取一个域名
    const domain = commonConsts.emailDomains[Math.floor(Math.random() * commonConsts.emailDomains.length)];
    // 组合成完整的邮箱地址
    return `${username}@${domain}`;
}


/**
 * 获取随机中国手机号
 * @returns {string}
 */
export function getChineseMobile() {
    // 手机号码的前三位，一般代表运营商，以下是一些常见的号段
    const prefix = commonConsts.phoneNumberPrefixes[Math.floor(Math.random() * commonConsts.phoneNumberPrefixes.length)];
    // 生成后 8 位随机数字
    let suffix = '';
    for (let i = 0; i < 8; i++) {
        suffix += Math.floor(Math.random() * 10);
    }
    // 组合成完整的手机号码
    return prefix + suffix;
}


/**
 * 获取随机身份证号
 * @returns {string}
 */
export function getIdCard() {
    const areaCode = validAreaCodes[Math.floor(Math.random() * validAreaCodes.length)];

    const year = Math.floor(Math.random() * (2020 - 1950 + 1) + 1950);
    const month = ('0' + Math.floor(Math.random() * 12 + 1)).slice(-2);
    const day = ('0' + Math.floor(Math.random() * 28 + 1)).slice(-2);
    const birthDate = `${year}${month}${day}`;

    const sequenceCode = Math.floor(Math.random() * 1000).toString().padStart(3, '0');

    let idCardNumber = areaCode + birthDate + sequenceCode;

    let weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
        sum += parseInt(idCardNumber.charAt(i)) * weights[i];
    }
    let mod = sum % 11;
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    idCardNumber += checkCodes[mod];

    return idCardNumber;
}


let _cachedImgUrls = null

async function loadImgUrls() {
    if (_cachedImgUrls) return _cachedImgUrls
    const module = await import('@/utils/imgUrls.json')
    _cachedImgUrls = module.default
    return _cachedImgUrls
}

export function getImageUrl() {
    if (_cachedImgUrls) {
        return _cachedImgUrls[Math.floor(Math.random() * _cachedImgUrls.length)]
    }
    loadImgUrls()
    return ''
}

export async function getImageUrlAsync() {
    const urls = await loadImgUrls()
    return urls[Math.floor(Math.random() * urls.length)]
}


/**
 * 获取随机头像url
 * @returns {string}
 */
export function getAvatarUrl() {
    const avatarStyle = commonConsts.avatarStyles[Math.floor(Math.random() * commonConsts.avatarStyles.length)];
    return `https://api.dicebear.com/9.x/${avatarStyle}/svg?seed=` + getStr(getNumber(4, 16), true, true, true, false);
}


/**
 * 获取指定范围内的随机整数
 * @param min
 * @param max
 * @returns {*}
 */
export function getNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 获取指定范围内的随机小数
 * @param min
 * @param max
 * @param decimalPlaces
 * @returns {number}
 */
export function getDecimal(min, max, decimalPlaces) {
    // 生成指定范围内的随机小数
    const randomNum = Math.random() * (max - min) + min;
    // 使用 toFixed 方法保留指定的小数位数
    return parseFloat(randomNum.toFixed(decimalPlaces));
}

/**
 * 获取随机字符串
 * @param length 随机字符串长度
 * @param digit 是否包含数字
 * @param upperLetter 是否包含大写
 * @param lowerLetter 是否包含小写
 * @param punctuation 是否包含标点符号
 * @returns {string}
 */
export function getStr(length, digit, upperLetter, lowerLetter, punctuation, punctuationChars) {
    if (!length) {
        return '请配置字符长度';
    }
    if (!digit && !upperLetter && !lowerLetter && !punctuation) {
        return '请配置字符源';
    }

    let characters = '';
    let guaranteedChars = [];

    if (digit) {
        characters += commonConsts.digit;
        guaranteedChars.push(commonConsts.digit.charAt(Math.floor(Math.random() * commonConsts.digit.length)));
    }
    if (upperLetter) {
        characters += commonConsts.upperLetter;
        guaranteedChars.push(commonConsts.upperLetter.charAt(Math.floor(Math.random() * commonConsts.upperLetter.length)));
    }
    if (lowerLetter) {
        characters += commonConsts.lowerLetter;
        guaranteedChars.push(commonConsts.lowerLetter.charAt(Math.floor(Math.random() * commonConsts.lowerLetter.length)));
    }
    if (punctuation) {
        const puncSource = punctuationChars || commonConsts.punctuation;
        characters += puncSource;
        guaranteedChars.push(puncSource.charAt(Math.floor(Math.random() * puncSource.length)));
    }

    if (guaranteedChars.length > length) {
        length = guaranteedChars.length;
    }

    let result = guaranteedChars.join('');
    for (let i = result.length; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    let arr = result.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
}

/**
 * 根据配置数组的方式获取随机字符串
 * @param length 随机字符串长度
 * @param strSource 字符源数组：['digit', 'upperLetter', 'lowerLetter', 'punctuation']
 * @returns {string}
 */
export function getStrByArrConfig(length, strSource, punctuationChars) {
    if (strSource.length === 0) {
        return '请配置字符源';
    }
    return getStr(length,
        strSource.includes('digit'),
        strSource.includes('upperLetter'),
        strSource.includes('lowerLetter'),
        strSource.includes('punctuation'),
        punctuationChars)
}

/**
 * 根据给定的前缀、初始值、步骤、日期格式、分隔符、序号长度和索引生成编码
 * @param {string} prefix - 代码的前缀
 * @param {number} initVal - 代码的初始值
 * @param {number} step - 增加代码的步长值
 * @param {string} dateFormat - 日期格式，如 'yyyyMM' 或 'yyyyMMdd'，空字符串表示无日期
 * @param {string} delimiter - 分隔符，如 '-'、'_'、'/'、'.'，空字符串表示无分隔符
 * @param {number} sequenceLength - 序号长度，不足时前面补0
 * @param {number} curVal - 用来计算当前值
 * @returns {string} - 生成的代码
 */
export function getCode(prefix, initVal, step, dateFormat = '', delimiter = '', sequenceLength = 1, curVal) {
    // 计算当前序号值
    const currentVal = initVal + curVal * step;

    // 格式化序号，前面补0到指定长度
    const formattedSequence = currentVal.toString().padStart(sequenceLength, '0');

    // 生成日期部分（如果指定了日期格式）
    let datePart = '';
    if (dateFormat) {
        const now = new Date();
        if (dateFormat === 'yyyyMM') {
            datePart = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0');
        } else if (dateFormat === 'yyyyMMdd') {
            datePart = now.getFullYear().toString() +
                      (now.getMonth() + 1).toString().padStart(2, '0') +
                      now.getDate().toString().padStart(2, '0');
        }
    }

    // 构建编码各部分
    const parts = [];

    // 添加前缀
    if (prefix) {
        parts.push(prefix);
    }

    // 添加日期部分
    if (datePart) {
        parts.push(datePart);
    }

    // 添加序号部分
    parts.push(formattedSequence);

    // 使用分隔符连接各部分（如果有分隔符）
    let result;
    if (delimiter) {
        result = parts.join(delimiter);
    } else {
        // 无分隔符时，直接拼接各部分
        result = parts.join('');
    }

    return result;
}

/**
 * 获取随机省份
 * @returns {*}
 */
export function getProvince() {
    const provinces = areaData;
    return provinces[Math.floor(Math.random() * provinces.length)].name;
}


/**
 * 获取随机城市
 * @param province
 * @returns {*}
 */
export function getCity() {
    const provinces = areaData;
    let randomCity;
    while (!randomCity) {
        const randomProvince = provinces[Math.floor(Math.random() * provinces.length)];
        if (Array.isArray(randomProvince.city)) {
            const cities = randomProvince.city.filter(city => city.name !== '市辖区' && city.name !== '县');
            if (cities.length > 0) {
                randomCity = cities[Math.floor(Math.random() * cities.length)].name;
            }
        }
    }
    return randomCity;
}

/**
 * 获取随机区县
 * @param city
 * @returns {*}
 */
export function getArea() {
    const provinces = areaData;
    let randomArea;
    while (!randomArea) {
        const randomProvince = provinces[Math.floor(Math.random() * provinces.length)];
        if (Array.isArray(randomProvince.city)) {
            const cities = randomProvince.city.filter(city => city.name !== '市辖区');
            if (cities.length > 0) {
                const randomCity = cities[Math.floor(Math.random() * cities.length)];
                if (Array.isArray(randomCity.area)) {
                    const districts = randomCity.area.filter(district => district.name !== '市辖区');
                    if (districts.length > 0) {
                        randomArea = districts[Math.floor(Math.random() * districts.length)].name;
                    }
                }
            }
        }
    }
    return randomArea;
}

/**
 * 获取随机位置上下文
 * @returns {{province: string, city: string, area: string, address: string}}
 */
export function getLocationContext() {
    try {
        // 生成省市区
        const getRandom = arr => arr[Math.floor(Math.random() * arr.length)];
        // while处理，防止有的省份没有城市或者城市没有区县
        let province;
        do {
            province = getRandom(areaData);
        } while (province.city == null || province.city.length === 0);
        let city;
        do {
            city = getRandom(province.city);
        } while (city.area.length === 0);
        let area;
        do {
            area = getRandom(city.area);
        } while (area.length === 0);

        // 生成街道和详细地址
        const addressType = getRandom(Object.keys(commonConsts.addressGenerators));
        const road = `${area.name === '市辖区' ? '' : area.name}${getRandom(commonConsts.addressConfig.roadNames)}`;
        const detail = commonConsts.addressGenerators[addressType]();
        const cityName = city.name === '市辖区' || city.name === '县' ? province.name : city.name;
        const addressCityPart = city.name === '市辖区' || city.name === '县' ? '' : city.name;
        const address = `${province.name}${addressCityPart}${road}${detail}`;

        return {
            province: province.name,
            city: cityName,
            area: area.name,
            address
        };
    } catch (e) {
        console.error('生成位置上下文失败：', e);
        return {
            province: '',
            city: '',
            area: '',
            address: '地址生成失败'
        };
    }
}

/**
 * 获取随机地址
 * @returns {string}
 */
export function getAddress() {
    return getLocationContext().address;
}

/**
 * 获取随机中文段落
 * @returns {string}
 */
export function getChineseParagrap(minLength, maxLength) {
    const chineseChars = commonConsts.chineseChars;

    // 生成指定范围内的随机长度
    const paragraphLength = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;

    let paragraph = '';
    for (let i = 0; i < paragraphLength; i++) {
        // 随机选择一个中文字符
        const randomIndex = Math.floor(Math.random() * chineseChars.length);
        paragraph += chineseChars[randomIndex];
    }

    return paragraph;
}

/**
 * 获取统一社会信用代码
 * @returns {string}
 */
export function getCreditCode() {
    // 统一社会信用代码的字符集，排除了 I、O、Z、S、V
    const charset = commonConsts.creditCodeChars;
    let creditCode = '';

    // 生成前 17 位随机字符
    for (let i = 0; i < 17; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        creditCode += charset[randomIndex];
    }

    // 计算校验码
    const weight = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
    let sum = 0;
    for (let i = 0; i < 17; i++) {
        const charValue = charset.indexOf(creditCode[i]);
        sum += charValue * weight[i];
    }
    const remainder = sum % 31;
    const checkCode = charset[(31 - remainder) % 31];

    // 拼接校验码到前 17 位后面
    creditCode += checkCode;

    return creditCode;
}

/**
 * 获取随机UUID
 * @returns {string}
 */
export function getUUID(uppercase = false, delimiter = false) {
    let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });

    if (uppercase) {
        uuid = uuid.toUpperCase();
    }

    if (!delimiter) {
        uuid = uuid.replace(/-/g, '');
    }

    return uuid;
}

/**
 * 获取随机枚举值
 * @param enumValues
 */
export function getEnumValue(enumValues) {
    if (!enumValues) {
        return '请配置枚举值';
    }
    const values = enumValues.split(',');
    return values[Math.floor(Math.random() * values.length)].trim();
}

/**
 * 获取分布式ID（SnowFlake算法）
 * @returns {string} - 分布式ID
 */
export function getDistributedId() {
    // 常量定义，与ID生成器_V2.html保持一致
    const sequenceBits = 7n;
    const WORKER_ID_LEFT_SHIFT = sequenceBits;
    const WORKER_ID_FULL_LEFT_SHIFT = 15n;
    const workerIdBits = 16n;
    const TIMESTAMP_LEFT_SHIFT = sequenceBits + workerIdBits; // 23n

    // 生成器类
    class SnowFlakeGeneratorV2 {
        constructor(workId, baseTimestamp) {
            this.workId = BigInt(workId);
            this.baseTimestamp = baseTimestamp.getTime();
            this.lastTimestamp = -1;
            this.sequence = 0n;
            this.sequenceMask = ~(-1n << sequenceBits); // 127n
        }

        next() {
            let nowTimestamp = Date.now();

            if (nowTimestamp < this.lastTimestamp) {
                throw new Error(`系统时钟向后移动。拒绝为 ${this.lastTimestamp - nowTimestamp} 毫秒生成id`);
            }

            if (this.lastTimestamp === nowTimestamp) {
                this.sequence = (this.sequence + 1n) & this.sequenceMask;
                if (this.sequence === 0n) {
                    nowTimestamp = this.tilNextMillis(this.lastTimestamp);
                }
            } else {
                this.sequence = 0n;
            }

            this.lastTimestamp = nowTimestamp;

            const timestampDiff = BigInt(nowTimestamp - this.baseTimestamp);
            const id = (timestampDiff << TIMESTAMP_LEFT_SHIFT) | this.workId | this.sequence;

            return id.toString();
        }

        tilNextMillis(lastTimestamp) {
            let timestamp = Date.now();
            while (timestamp <= lastTimestamp) {
                timestamp = Date.now();
            }
            return timestamp;
        }
    }

    // 获取或创建生成器实例（单例模式）
    const generatorKey = 'distributed_id_generator';
    let generator;

    try {
        // 尝试从全局变量获取已存在的生成器实例
        if (typeof window !== 'undefined' && window[generatorKey]) {
            generator = window[generatorKey];
        } else {
            // 创建新的生成器实例
            // 基准时间固定为2018-01-01T00:00:00
            const baseTimestamp = new Date('2018-01-01T00:00:00');

            // 尝试从localStorage获取或生成Work ID
            let storedWorkId;
            const workIdKey = 'distributed_id_work_id';

            try {
                // 尝试从localStorage获取已存储的Work ID
                const storedValue = localStorage.getItem(workIdKey);
                if (storedValue) {
                    storedWorkId = parseInt(storedValue, 10);
                } else {
                    // 如果没有存储的Work ID，生成一个新的并存储
                    // 使用时间戳和随机数生成一个相对固定的Work ID
                    const now = new Date();
                    const seed = now.getFullYear() + now.getMonth() + now.getDate() +
                                 Math.floor(Math.random() * 1000);
                    storedWorkId = seed & 0xFFFF; // 限制在16位内
                    localStorage.setItem(workIdKey, storedWorkId.toString());
                }
            } catch (error) {
                // 如果localStorage不可用，使用随机Work ID
                storedWorkId = Math.floor(Math.random() * 0xFFFF);
            }

            // 从Work ID中提取thirdOctet和fourthOctet
            const thirdOctet = (storedWorkId >> 7) & 0xFF; // 取高8位作为第三段
            const fourthOctet = storedWorkId & 0x7F; // 取低7位作为第四段

            // 计算Work ID，与Java代码逻辑一致
            const tempId = BigInt(fourthOctet) << WORKER_ID_LEFT_SHIFT;
            const highBits = BigInt(thirdOctet) << WORKER_ID_FULL_LEFT_SHIFT;
            const workId = (highBits | tempId).valueOf();

            // 创建生成器实例
            generator = new SnowFlakeGeneratorV2(workId, baseTimestamp);

            // 将生成器实例存储到全局变量中
            if (typeof window !== 'undefined') {
                window[generatorKey] = generator;
            }
        }
    } catch (error) {
        // 如果获取全局变量失败，创建临时生成器
        const baseTimestamp = new Date('2018-01-01T00:00:00');
        const workId = Math.floor(Math.random() * 0xFFFF);
        generator = new SnowFlakeGeneratorV2(workId, baseTimestamp);
    }

    // 生成ID
    return generator.next();
}
