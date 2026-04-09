(function (define) {
    define(['jquery'], function ($) {
        return (function () {

            let utils = {};

            /*==== [ 基础工具 ] =======================================================================================*/

            /**
             * 检查对象是否为空
             * @param obj 判断对象
             * @returns {boolean}
             */
            function objIsNull(obj) {
                if (obj === undefined || obj === null) {
                    return true;

                } else if (obj instanceof Date) {
                    return isNaN(obj.getTime());

                } else if (obj instanceof Array) {
                    return obj.length === 0;

                } else if (obj instanceof Set || obj instanceof Map) {
                    return obj.size === 0;

                } else if (obj instanceof WeakSet || obj instanceof WeakMap) {
                    // WeakSet 和 WeakMap不能直接检查size，我们只能假设它们不为空
                    return false;

                } else if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'function' || typeof obj === 'bigint') {
                    // 能检查出来类型，就说明它们不为空。0不算空，false不算空，function(){}不算空，BigInt(0)也不算空
                    // 如有特例，可独立if分支做特殊判断
                    return false;

                } else if (obj instanceof Object) {
                    return Object.keys(obj).length === 0;

                } else {
                    return String(obj).trim() === '';
                }
            }

            /**
             * 检查对象是否存在
             * @param obj 判断对象
             * @return {boolean}
             */
            function objIsExist(obj) {
                return !objIsNull(obj);
            }

            /**
             * 判断obj是否为数字（整数或小数浮点）
             * @param obj 判断值
             * @returns {boolean}
             */
            function objIsNumber(obj) {
                return objIsExist(obj) && !isNaN(obj) && isFinite(obj);
            }

            /**
             *
             * obj转number
             * @param obj 转换值
             * @returns {number}
             */
            function objToNumber(obj) {
                if (typeof obj === 'string') obj = obj.replace(/,/g, '');   //将千分位的逗号去除
                return objIsNumber(obj) ? Number(obj) : 0;
            }

            /**
             * obj转Float
             * @param obj 转换值
             * @returns {number}
             */
            function objToFloat(obj) {
                if (typeof obj === 'string') {
                    // 将千分位的逗号去除
                    obj = obj.replace(/,/g, '');
                    // 百分比转换
                    if (obj.endsWith('%')) {
                        let number = obj.substring(0, obj.length - 1)
                        return (objIsNumber(number) ? parseFloat(number) : 0) / 100;
                    }
                }
                return objIsNumber(obj) ? parseFloat(obj) : 0;
            }

            /**
             * obj转Boolean
             * @param obj
             * @return {boolean}
             */
            function objToBoolean(obj) {
                return objIsExist(obj) && (obj === true || obj === 'true');
            }

            // 方法暴露
            $.extend(utils, {
                objIsNull: objIsNull,
                objIsExist: objIsExist,
                objIsNumber: objIsNumber,
                objToNumber: objToNumber,
                objToFloat: objToFloat,
                objToBoolean: objToBoolean
            });


            /*==== [ 获得基本数据 ] ====*/

            /**
             * 获得一个UUID
             * @return {string}
             */
            function getUUID() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            /**
             * 获得一个UUID（无短横杠）
             * @return {string}
             */
            function getUUID2() {
                return getUUID().replace(/-/ig, '');
            }

            // 方法暴露
            $.extend(utils, {
                getUUID: getUUID,
                getUUID2: getUUID2
            });

            /*==== [ 文本工具 ] =======================================================================================*/

            /**
             * 检查文本是否[全是]英文
             * @param txt 文本
             * @returns {boolean}
             */
            function isEnglishAll(txt) {
                let res = /^[a-zA-Z]+$/gi;
                return res.test(txt);
            }

            /**
             * 检查文本是否[包含]英文
             * @param txt 文本
             * @returns {boolean}
             */
            function isEnglishContain(txt) {
                let res = /[a-zA-Z]+/gi;
                return res.test(txt);
            }

            /**
             * 检查文本是否[全是]中文
             * @param txt 文本
             * @returns {boolean}
             */
            function isChineseAll(txt) {
                let res = /^[\u4e00-\u9fa5䶮]+$/gi;
                return res.test(txt);
            }

            /**
             * 检查文本是否[字母]开头
             * @param str
             * @return {boolean}
             */
            function isAlphabetStart(str) {
                return /^[A-Za-z]/.test(str);
            }

            /**
             * 检查文本是否[包含]中文
             * @param txt 文本
             * @returns {boolean}
             */
            function isChineseContain(txt) {
                let res = /[\u4e00-\u9fa5䶮]+/gi;
                return res.test(txt);
            }

            /**
             * 移除[文本开始]的指定字符
             * @param content 原文本
             * @param str 要移除的指定字符
             * @returns {*} 返回移除后的结果
             */
            function trimStart(content, str) {
                let re = new RegExp("^" + str);
                return content.replace(re, ""); //移除开头的指定字符
            }

            /**
             * 移除[文本结束]的指定字符
             * @param content 原文本
             * @param str 要移除的指定字符
             * @returns {*} 返回移除后的结果
             */
            function trimEnd(content, str) {
                let re = new RegExp(str + "$");
                return content.replace(re, ""); //移除末尾的指定字符
            }

            // 方法暴露
            $.extend(utils, {
                str: {
                    isEnglishAll: isEnglishAll,
                    isEnglishContain: isEnglishContain,
                    isChineseAll: isChineseAll,
                    isChineseContain: isChineseContain,
                    isAlphabetStart: isAlphabetStart,
                    trimStart: trimStart,
                    trimEnd: trimEnd
                }
            });


            /*==== [ 命名工具 ] =======================================================================================*/

            /**
             * 将任意格式的字符串转化为单词数组
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {string[]}
             */
            function toWords(name) {
                // 如果是数组，直接返回
                if (name instanceof Array) return name;
                // 不是数组，按 下划线_、短横杠-、空格 分割后返回数组
                return name.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim().split(/\s+/);
            }

            /**
             * 转化为小驼峰格式:
             * iAmSuperman
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toCamelCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map((word, i) => i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join('');
            }

            /**
             * 转化为大驼峰格式:
             * IAmSuperman
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toPascalCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map(word => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('');
            }

            /**
             * 转化为短横杠格式:
             * i-am-superman
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toKebabCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map(word => word.toLowerCase()).join('-');
            }

            /**
             * 转化为下划线格式:
             * i_am_superman
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toSnakeCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map(word => word.toLowerCase()).join('_');
            }

            /**
             * 转化为空格格式:
             * i am superman
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toSpaceCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map(word => word.toLowerCase()).join(' ');
            }

            /**
             * 转化为下划线常量格式:
             * I_AM_SUPERMAN
             * @param {string|Array} name 支持数组和分隔符 <br\>
             * (大写驼峰、下划线_、短横杠-、空格 )
             * @return {*}
             */
            function toConstantCase(name) {
                if (objIsNull(name)) return "";
                return toWords(name).map(word => word.toUpperCase()).join('_');
            }

            /**
             * 首字母小写
             * @param str
             * @return {string}
             */
            function lowercaseFirstLetter(str) {
                if (objIsNull(str)) return "";
                return str.charAt(0).toLowerCase() + str.slice(1);
            }

            /**
             * 首字母大写
             * @param str
             * @return {string}
             */
            function uppercaseFirstLetter(str) {
                if (objIsNull(str)) return "";
                return str.charAt(0).toUpperCase() + str.slice(1);
            }

            // 方法暴露
            $.extend(utils, {
                name: {
                    toCamelCase: toCamelCase,
                    toPascalCase: toPascalCase,
                    toKebabCase: toKebabCase,
                    toSnakeCase: toSnakeCase,
                    toSpaceCase: toSpaceCase,
                    toConstantCase: toConstantCase,
                    lowercaseFirstLetter: lowercaseFirstLetter,
                    uppercaseFirstLetter: uppercaseFirstLetter
                }
            });


            /*==== [ 文件工具 ] =======================================================================================*/

            /**
             * 获取文件后缀
             * @param {string} fileName 文件名（可包含路径）
             * @returns {string|*} 返回的后缀名（不带 . ）
             */
            function getFileExt(fileName) {
                if (objIsNull(fileName)) {
                    return '';
                }

                const lastDotIndex = fileName.lastIndexOf('.');
                if (lastDotIndex === -1) {
                    return '';
                }

                return fileName.slice(lastDotIndex + 1);
            }

            // 方法暴露
            $.extend(utils, {
                file: {
                    getFileExt: getFileExt
                }
            });


            /*==== [ Json工具 ] =======================================================================================*/

            /**
             *
             * 读取json文件
             * @param {string} jsonPath json文件地址
             * @return {{}}
             */
            function readJsonFile(jsonPath) {
                if (objIsNull(jsonPath)) throw new Error('文件地址无效，它必须是一个不为空的值。');

                try {
                    let res = {};
                    $.ajax({
                        url: jsonPath,
                        type: "GET",
                        dataType: "json",
                        async: false,
                        success: function (data) {
                            res = data;
                        }
                        , error: function (XMLHttpRequest, textStatus, errorThrown) {
                            console.error(errorThrown);
                        }
                    });
                    return res;
                } catch (error) {
                    // 处理错误
                    console.error('读取JSON文件时出错', error);
                    throw error;
                }
            }

            /**
             * 根据条件查询json列表中 [filed]字段符合[value] 的一个项
             *
             * @param {Array} data 完整的数据源
             * @param {string} filed 筛选的字段
             * @param {string|Object} value 筛选的值
             * @return {Object|*}
             */
            function findObj(data, filed, value) {
                return data.find((item) => item[filed] === value) || {};
            }

            /**
             * 根据条件查询json列表中 [filed]字段符合[value] 的多个项
             *
             * @param {Array} data 完整的数据源
             * @param {string} filed 筛选的字段
             * @param {string|Object} value 筛选的值
             * @return {Array|*}
             */
            function findList(data, filed, value) {
                return data.filter((item) => item[filed] === value);
            }

            /**
             * 根条件筛选json列表中 [filed]字段包含[value] 的多个项
             *
             * @param {Array} data 完整的数据源
             * @param {string} filed 筛选的字段
             * @param {string|Object} value 筛选的值
             * @return {Array|*}
             */
            function findListByIncludes(data, filed, value) {
                return data.filter((item) => item[filed].includes(value));
            }

            /**
             * 根据条件筛选json列表中 [filed]字段以[value]开头 的多个项
             *
             * @param {Array} data 完整的数据源
             * @param {string} filed 筛选的字段
             * @param {string|Object} value 筛选的值
             * @return {Array|*}
             */
            function findListByStartsWith(data, filed, value) {
                return data.filter((item) => item[filed].startsWith(value));
            }

            /**
             * 根条件筛选json列表中 [filed]字段以[value]结尾 的多个项
             *
             * @param {Array} data 完整的数据源
             * @param {string} filed 筛选的字段
             * @param {string|Object} value 筛选的值
             * @return {Array|*}
             */
            function findListByEndsWith(data, filed, value) {
                return data.filter((item) => item[filed].endsWith(value));
            }

            /**
             * 根据指定的key，向键值对数据中写入新的值，如果key不存在则新增
             * @param {Array} dataArr 键值对数据
             * @param {string} key 要写入的数据对应的key
             * @param {Object} value 要写入的键值对数值
             */
            function setFieldTbRow(dataArr, key, value) {
                let foundData = dataArr.find(data => data.key === key);
                if (foundData) {
                    Object.assign(foundData, value);
                } else {
                    foundData = {key, ...value};
                    dataArr.push(foundData);
                }
            }

            /**
             * 深克隆
             * @param {Object} obj 克隆对象
             * @return {{}|*|unknown[]|Date}
             */
            function deepClone(obj) {
                if (obj === null || typeof obj !== 'object') {
                    return obj;
                }

                if (obj instanceof Date) {
                    return new Date(obj.getTime());
                }

                if (obj instanceof Array) {
                    return obj.map(deepClone);
                }

                if (obj instanceof Object) {
                    let cloned = {};
                    for (let key in obj) {
                        if (obj.hasOwnProperty(key)) {
                            cloned[key] = deepClone(obj[key]);
                        }
                    }
                    return cloned;
                }
            }


            /**
             * 创建一个排序函数
             * @param {string} field 要排序的字段名
             * @param {boolean} reverse 是否倒序
             * @param {function} primer 排序字段的数据类型转换函数(例如:parseInt或String)
             * @return {function} 用于数组排序的函数
             */
            function sortBy(field, reverse, primer) {
                const _reverse = reverse ? -1 : 1; // 根据 reverse 参数确定升序还是降序
                return (a, b) => {
                    let valueA = a[field];
                    let valueB = b[field];
                    if (primer) {
                        valueA = primer(valueA);
                        valueB = primer(valueB);
                    }

                    // 如果 `valueA` 小于 `valueB`，意味着 `valueA` 应该在 `valueB` 的前面，因此返回一个负数（`-1` 或者 `-1 * _reverse`）。这样做是为了根据排序顺序来调整元素的位置。
                    if (valueA < valueB) {
                        return _reverse * -1;
                    }

                    // 如果 `valueA` 大于 `valueB`，意味着 `valueA` 应该在 `valueB` 的后面，因此返回一个正数（`1` 或者 `1 * _reverse`）。这同样是为了根据排序顺序来调整元素的位置。
                    if (valueA > valueB) {
                        return _reverse * 1;
                    }

                    // 如果以上条件都不满足，即 valueA 等于 valueB，则返回 0，表示两个元素相等在排序中位置不变
                    return 0;
                };

                /**
                 * 【调用示例】
                 * let obj = [
                 *     {b: '3', c: 'c'},
                 *     {b: '1', c: 'a'},
                 *     {b: '2', c: 'b'}
                 * ];

                 * 1、数字排序
                 * obj.sort(sortBy('b', false, parseInt));
                 * console.log(obj);

                 * 2、字符串排序
                 * obj.sort(sortBy('c', false, String));
                 * console.log(obj);
                 */
            }


            // 方法暴露
            $.extend(utils, {
                json: {
                    readJsonFile: readJsonFile,
                    findObj: findObj,
                    findList: findList,
                    findListByIncludes: findListByIncludes,
                    findListByStartsWith: findListByStartsWith,
                    findListByEndsWith: findListByEndsWith,
                    setFieldTbRow: setFieldTbRow,
                    deepClone: deepClone,
                    sortBy: sortBy
                }
            });


            /*==== [ Array工具 ] =======================================================================================*/

            /**
             * a与b的交集
             * @param {Array} a 数组a
             * @param {Array} b 数组b
             * @return {any[]}
             */
            function intersect(a, b) {
                return a.filter(function (v) {
                    return b.indexOf(v) > -1
                });
            }

            /**
             * a与b的差集
             * @param {Array} a 数组a
             * @param {Array} b 数组b
             * @return {any[]}
             */
            function minus(a, b) {
                return a.filter(function (v) {
                    return b.indexOf(v) === -1
                });
            }

            /**
             * a与b的补集
             * @param {Array} a 数组a
             * @param {Array} b 数组b
             * @return {any[]}
             */
            function complement(a, b) {
                return a.filter(function (v) {
                    return !(b.indexOf(v) > -1)
                }).concat(b.filter(function (v) {
                    return !(a.indexOf(v) > -1)
                }));
            }

            /**
             * a与b的并集
             * @param {Array} a 数组a
             * @param {Array} b 数组b
             * @return {any[]}
             */
            function union(a, b) {
                return a.concat(b.filter(function (v) {
                    return !(a.indexOf(v) > -1)
                }));
            }

            /**
             * 数组去重
             * @param {Array} arr 原数组
             * @return {any[]} 返回去重后的数组结果
             */
            function unique(arr) {
                return [...new Set(arr)];   //方式一
                // return Array.from(new Set(arr));  //方式二
            }

            /**
             * 数组倒转
             * @param {Array} arr 原数组
             * @return {any[]} 返回倒转后的数组结果
             */
            function inverted(arr) {
                //数组长度
                let len = arr.length;

                //倒转后的新数组
                return $.map(arr, function (v, i) {
                    return arr[len - 1 - i];
                });
            }

            // 方法暴露
            $.extend(utils, {
                array: {
                    intersect: intersect,
                    minus: minus,
                    complement: complement,
                    union: union,
                    unique: unique,
                    inverted: inverted
                }
            });


            /*==== [ 数学运算工具 ] ====================================================================================*/

            /**
             * 四舍五入
             * @param {number} decimal 数值
             * @param {number} digit 保留小数位（digit大于0，四舍五入小数位；digit小于0，四舍五入整数位）
             * @returns {number} 返回四舍五入之后的值
             */
            function round(decimal, digit) {
                decimal = objToFloat(decimal)
                digit = objToNumber(digit)
                if (digit < 0) {
                    //digit为负数：向左（整数部分）四舍五入

                    //1、按照digit位数，将digit为1的转为10，digit为2的转为100，digit为3的转为1000……的操作
                    let bs = ("100000000000000000000000").substr(0, Math.abs(digit) + 1);
                    //2、先将decimal除以bs，将小数点往左移对应位数。
                    let res = (decimal / bs);
                    //3、然后再做0小数的四舍五入。
                    let vv = Math.pow(10, 0);
                    res = (Math.round(res * vv) / vv);
                    //4、最终再乘以bs将小数位往右移对应位数，以此还原原值的单位。
                    res *= bs;
                    //返回结果
                    return res;
                } else {
                    //digit为正数：向右（小数部分）四舍五入。属正常操作
                    let vv = Math.pow(10, digit);
                    vv = (Math.round(decimal * vv) / vv)

                    return vv;
                }
            }

            /**
             * 和运算
             * @param {Array} numArr 数字数组
             * @param {number} [digit=undefined] 保留小数位（digit大于0，四舍五入小数位；digit小于0，四舍五入整数位）
             * @returns {number} 返回和
             */
            function jiafa(numArr, digit = undefined) {
                if (!Array.isArray(numArr)) throw new Error("请传入数组类型参数");

                let sum = 0;
                numArr.forEach((num) => {
                    sum += objToFloat(num);
                })

                // 有小数点要求
                if (objIsExist(digit)) return round(sum, digit);

                return sum;
            }

            /**
             * 差运算
             * @param {Array} numArr 数字数组
             * @param {number} [digit=undefined] 保留小数位（digit大于0，四舍五入小数位；digit小于0，四舍五入整数位）
             * @returns {number} 返回差
             */
            function jianfa(numArr, digit = undefined) {
                if (!Array.isArray(numArr)) throw new Error("请传入数组类型参数");

                let diff = 0;
                numArr.forEach((num) => {
                    diff -= objToFloat(num);
                })

                // 有小数点要求
                if (objIsExist(digit)) return round(diff, digit);

                return diff;
            }

            /**
             * 积运算
             * @param {Array} numArr 数字数组
             * @param {number} [digit=undefined] 保留小数位（digit大于0，四舍五入小数位；digit小于0，四舍五入整数位）
             * @returns {number} 返回积
             */
            function chengfa(numArr, digit = undefined) {
                if (!Array.isArray(numArr)) throw new Error("请传入数组类型参数");

                // 数组为空 或 数组中包含0，直接返回0
                if (numArr.length === 0 || numArr.includes(0)) return 0;

                // 数组只有1个值，直接返回这个值
                if (numArr.length === 1) return numArr[0];

                // 开始计算
                let product = numArr.shift();   // 将第一个值摘取
                numArr.forEach((num) => {
                    product *= objToFloat(num);
                })

                // 有小数点要求
                if (objIsExist(digit)) return round(product, digit);

                return product;
            }

            /**
             * 商运算
             * @param {Array} numArr 数字数组
             * @param {number} [digit=undefined] 保留小数位（digit大于0，四舍五入小数位；digit小于0，四舍五入整数位）
             * @returns {number} 返回商
             */
            function chufa(numArr, digit = undefined) {
                if (!Array.isArray(numArr)) throw new Error("请传入数组类型参数");

                // 数组为空 或 数组中包含0，直接返回0
                if (numArr.length === 0 || numArr.includes(0)) return 0;

                // 数组只有1个值，直接返回这个值
                if (numArr.length === 1) return numArr[0];

                // 开始计算
                let quotient = numArr.shift();   // 将第一个值摘取
                numArr.forEach((num) => {
                    quotient /= objToFloat(num);
                })

                // 有小数点要求
                if (objIsExist(digit)) return round(quotient, digit);

                return quotient;
            }

            // 方法暴露
            $.extend(utils, {
                math: {
                    round: round,
                    jiafa: jiafa,
                    jianfa: jianfa,
                    chengfa: chengfa,
                    chufa: chufa
                }
            });


            /*==== [ Url工具 ] ================================================================================================*/

            /**
             * 获取url信息
             * @param {number} idx 要获取的url下标
             * @returns {string|string[]} idx下标为空则返回地址数组
             */
            function getUrlInfo(idx) {
                let urlPath = window.location.pathname; //获取当前页面地址
                let urlPathArr = urlPath.split('/');    //···/trade/m2/g1/list  #···/trade/m2/g1/t1ZYKS/list
                if (objIsNumber(idx) && urlPathArr.length > idx) {
                    return urlPathArr[objToNumber(idx)];
                }
                return urlPathArr;
            }

            /**
             * 分解url信息到Json
             * @param {string} [url=""] 指定的url地址（默认为当前页面地址）
             * @return {{}}
             */
            function getUrlInfoToJson(url = "") {
                // url = 'http://localhost:8080/trade/m5/g1/t1/list?dataListId=4028af8180a6e3b00180a6e7502f0005&month=7#top';
                if (objIsNull(url)) url = window.location.href;
                let a = $('<a>', {href: url});

                let urlInfo = {};
                /**完整url*/
                urlInfo.href = a.prop('href');  // http://localhost:8080/trade/m5/g1/t1/list?month=7#top
                /**主机头（协议+域名/ip+端口号）*/
                urlInfo.origin = a.prop('origin');  // http://localhost:8080
                /**协议（http/https）*/
                urlInfo.protocol = a.prop('protocol');  // http
                /**域名/ip+端口号（localhost:8080）*/
                urlInfo.host = a.prop('host');          // localhost:8080
                /**域名/ip（localhost）*/
                urlInfo.hostname = a.prop('hostname');  // localhost
                /**端口号（8080）*/
                urlInfo.port = a.prop('port');          // 8080
                /**uri路径（/main/index）*/
                urlInfo.pathname = a.prop('pathname');  // /trade/m5/g1/t1/list
                /**url参数（?id=）*/
                urlInfo.search = a.prop('search');  // ?dataListId=4028af8180a6e3b00180a6e7502f0005&month=7
                /**锚点（#top）*/
                urlInfo.hash = a.prop('hash');  // #top

                //拓展属性（参数键值对）
                urlInfo.searchJson = getUrlSearchToJson(urlInfo.search);

                return urlInfo;
            }

            /**
             * 获得url中的路径及文件名
             * @param {string} [url=""] 指定的url地址
             * @return {*}
             */
            function getUrlPathname(url = "") {
                return getUrlInfoToJson(url).pathname;
            }

            /**
             * 获取地址栏的参数数组
             * @param {string} [url=""] 指定url，函数将从url中提取?后面的条件参数（默认直接从当前页面的url中提取条件参数）
             * @returns {null|*}
             */
            function getUrlSearchToJson(url = "") {
                //结果预声明
                let resJson = {};
                //默认使用当前地址的条件参数
                let search = window.location.search;
                //有传入地址就分析传入地址的参数
                if (objIsExist(url)) {
                    let regExpExecArray = /\?.*/gi.exec(url);
                    if (regExpExecArray != null) search = regExpExecArray[0];
                }

                //参数组数组
                let paramsArr = search.split(/[?&]/).filter(s => $.trim(s).length > 0);
                if (paramsArr != null && paramsArr.length > 0) {
                    //遍历参数组
                    for (let i = 0; i < paramsArr.length; i++) {
                        let param = paramsArr[i];
                        //参数键值对 Key:Value
                        let paramKV = param.split("=");
                        //组成Json
                        resJson[paramKV[0]] = paramKV[1];
                    }
                }
                // 将参数数组进行返回
                return resJson;
            }

            /**
             * 根据参数名称获取参数值
             * @param {string} name 参数名称
             * @returns {null|*}
             */
            function getUrlSearchValue(name) {
                let paramsArray = getUrlSearchToJson();
                return paramsArray[name];
            }

            /**
             * 将键值对转为url参数
             * @param {string} url 原url地址
             * @param {Object} paramJson json键值对参数
             * @returns {*}
             */
            function getUrlBySearchJson(url, paramJson) {
                if (objIsExist(url) && url.indexOf('javascript') === -1 && objIsExist(paramJson)) {
                    //提取传入url的参数键值对
                    let urlSearchJson = getUrlSearchToJson(url);

                    //将传入参数的键值对 合并到url的参数键值对（同名属性会被传入的键值对覆盖）
                    $.extend(true, urlSearchJson, paramJson);

                    //提取传入url的路径地址 + 综合Search条件
                    return getUrlPathname(url) + getUrlSearchByJson(urlSearchJson);
                }
                return url;
            }

            /**
             * 将Json转为url的search参数
             * @param {Object} paramJson json键值对参数
             * @return {string}
             */
            function getUrlSearchByJson(paramJson) {
                let search = "";
                Object.keys(paramJson).forEach((key) => {
                    let val = paramJson[key];
                    if (objIsExist(val)) {
                        search += (search.indexOf("?") === -1 ? "?" : "&") + key + "=" + val;
                    }
                });
                return search;
            }

            /**
             * 获得脚本文件src后面的参数信息
             * @param {string} [fileName=""] 脚本文件名（也可以是路径，不传入 则获取全部js的参数）
             * @return {{}}
             */
            function getScriptParam(fileName = "") {
                let res = {};
                let script = document.getElementsByTagName("script");
                $.each(script, function (idx, js) {
                    let src = js.src;

                    //检查是否仅收集指定文件的参数（指定文件为空则收集全部js参数）
                    if (objIsExist(fileName) && !src.includes(fileName)) return;

                    if (src.includes('?')) {
                        let temp = src.split('?')[1];
                        temp = temp.split('&');
                        temp.forEach((keyval) => {
                            let key = keyval.split('=')[0];
                            let val = keyval.split('=')[1];
                            res[key] = val;
                        })
                    }
                })

                return res;
            }


            // 方法暴露
            $.extend(utils, {
                url: {
                    getUrlInfo: getUrlInfo,
                    getUrlInfoToJson: getUrlInfoToJson,
                    getUrlPathname: getUrlPathname,
                    getUrlSearchToJson: getUrlSearchToJson,
                    getUrlSearchValue: getUrlSearchValue,
                    getUrlBySearchJson: getUrlBySearchJson,
                    getUrlSearchByJson: getUrlSearchByJson,
                    getScriptParam: getScriptParam
                }
            });


            /*==== [ 时间工具 ] =======================================================================================*/

            /**
             * 检查对象是否为Date类型
             * @param {Object} obj 检查对象
             * @param {boolean} [fuzzy=false] 是否开启模糊检查（模糊检查：符合日期格式的字符串也算Date类型）
             * @return {boolean}
             */
            function objIsDate(obj, fuzzy = false) {
                if (!fuzzy) return obj instanceof Date;
                else if (typeof obj === "string") {
                    return (strIsDatetime(obj) || strIsDate(obj) || strIsTime(obj));
                }
                return false;
            }

            /**
             * 检查字符串是否是DateTime格式
             * @param {string} str 要检查的字符串
             * @return {boolean} 符合的格式：<br/>
             * &emsp; yyyy/MM/dd HH:mm:ss.fff <br/>
             * &emsp; yyyy-MM-dd HH:mm:ss.fff <br/>
             * &emsp; yyyy年MM月dd日 HH:mm:ss.fff <br/>
             * &emsp; yyyy年MM月dd号 HH:mm:ss.fff <br/>
             * &emsp; 其中月、日、时可为单字匹配 <br/>
             * &emsp; 例：1997/1/1 1:00:00 <br/>
             * &emsp; '日/号'、秒、毫秒 为可选匹配 <br/>
             * &emsp; 例：1997年1月1 1:00 <br/>
             */
            function strIsDatetime(str) {
                if (typeof str === "string") {
                    let regDatetime = /^(?:\d{4}\/(0[1-9]|1[0-2]|[1-9])\/(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])|\d{4}-(0[1-9]|1[0-2]|[1-9])-(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])日|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])号|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9]))\s+(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,3})?)?$/;
                    return regDatetime.test(str)
                }
                return false;
            }

            /**
             * 检查字符串是否是Date格式
             * @param {string} str 要检查的字符串
             * @return {boolean} 符合的格式：<br/>
             * <i>见 <a href>strIsDatetime</a> 方法说明文档</i>
             */
            function strIsDate(str) {
                if (typeof str === "string") {
                    let regDate = /^(?:\d{4}\/(0[1-9]|1[0-2]|[1-9])\/(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])|\d{4}-(0[1-9]|1[0-2]|[1-9])-(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])日|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9])号|\d{4}年(0[1-9]|1[0-2]|[1-9])月(0[1-9]|[1-2][0-9]|3[0-1]|[1-9]))$/;
                    return regDate.test(str)
                }
                return false;
            }

            /**
             * 检查字符串是否是Time格式
             * @param {string} str 要检查的字符串
             * @return {boolean} 符合的格式：<br/>
             * <i>见 <a href>strIsDatetime</a> 方法说明文档</i>
             */
            function strIsTime(str) {
                if (typeof str === "string") {
                    let regTime = /^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d{1,3})?)?$/;
                    return regTime.test(str)
                }
                return false;
            }


            /**
             * obj转Datetime
             * @param {Object} obj 转换对象
             * @return {Date}
             */
            function objToDatetime(obj) {
                if (obj instanceof Date) {
                    return obj;
                } else if (strIsDatetime(obj)) {
                    return new Date(Date.parse(obj));
                } else if (strIsDate(obj)) {
                    let _str = obj + ' 00:00:00.000'
                    return new Date(Date.parse(_str));
                } else if (strIsTime(obj)) {
                    let _str = getNowDatetime("yyyy/MM/dd ") + obj
                    return new Date(Date.parse(_str));
                }
                return new Date();
            }

            /**
             * obj转时间戳
             * @param {Object} datetime Date对象或标准的时间格式字符串
             * @return {number}
             */
            function objToTimestamp(datetime) {
                if (datetime instanceof Date) {
                    return datetime.getTime();
                } else if (objIsDate(datetime, true)) {
                    let dt = objToDatetime(datetime);
                    return dt.getTime();
                }
                return 0;
            }

            /**
             * 将毫秒转化为持续时间
             * @param {number} millis 毫秒
             * @returns {Object} 输出持续时间字符串
             */
            function msToDuration(millis) {
                let days = Math.floor(millis / (24 * 60 * 60 * 1000));
                let daysMillis = millis % (24 * 60 * 60 * 1000);
                days = Math.max(days, 0);

                let hours = Math.floor(daysMillis / (60 * 60 * 1000));
                let hoursMillis = daysMillis % (60 * 60 * 1000);
                hours = Math.max(hours, 0);

                let minutes = Math.floor(hoursMillis / (60 * 1000));
                let minutesMillis = hoursMillis % (60 * 1000);
                minutes = Math.max(minutes, 0);

                let seconds = Math.floor(minutesMillis / 1000);
                seconds = Math.max(seconds, 0);

                let millisecond = minutesMillis % 1000;
                millisecond = Math.max(millisecond, 0);


                let formatStr = "";
                if (days > 0) formatStr += days + "天 ";
                if (hours > 0 || days > 0) formatStr += hours + "小时 ";
                if (minutes > 0 || hours > 0) formatStr += minutes + "分钟 ";
                if (seconds > 0 || minutes > 0) formatStr += seconds + "秒 ";
                if (millisecond > 0) formatStr += millisecond + "毫秒 ";
                formatStr = formatStr.trim();

                console.log(days + "天 " + hours + "小时 " + minutes + "分钟 " + seconds + "秒 " + millisecond + "毫秒");

                return {
                    days: days,
                    hours: hours,
                    minutes: minutes,
                    seconds: seconds,
                    milliseconds: millisecond,
                    formatStr: formatStr
                };
            }

            /**
             * 时间戳转Date
             * @param {number} timestamp 时间戳
             * @param {?|number|string} [fmt=undefined] 日期格式
             * @return {Date} 时间对象
             */
            function tsToDatetime(timestamp, fmt = undefined) {
                let datetime = new Date(0o001, 0o1, 0o1, 0o0, 0o0, 0o0, 0o0);

                if (objIsExist(timestamp) && objIsNumber(timestamp)) {
                    // 10位时间戳（不含毫秒）
                    if (timestamp.toString().length === 10) datetime = new Date(timestamp * 1000);
                    // 13位时间戳（含毫秒）
                    else if (timestamp.toString().length === 13) datetime = new Date(timestamp);
                }

                return (objIsNull(fmt) ? datetime : format(datetime, fmt));
            }


            /**
             * 获得当前时间戳
             * @return {number} 时间戳
             */
            function getNowTimestamp() {
                return new Date().getTime();
            }

            /**
             * 获取当前时间
             * @param {?|number|string} [fmt=undefined] 日期格式: <br/>
             * &emsp; 不传默认返回原始Date对象 <br/>
             * &emsp; 1:返回日期短横杠格式 <br/>
             * &emsp; 2:返回日期正斜杠格式 <br/>
             * &emsp; 3:返回汉字年月日时分秒格式 <br/>
             * &emsp; 4:返回无分隔符带毫秒格式 <br/>
             * &emsp; 或:直接传入自定义格式 <br/>
             * &emsp; <i>自定义格式见 <a href>format</a> 方法说明文档</i>
             * @returns {Date|string} 返回时间值
             */
            function getNowDatetime(fmt = undefined) {
                // 日期对象分解（示例。老版本使用过，此处暂做示例用）
                let yy = new Date().getFullYear()
                let mm = new Date().getMonth() + 1
                let dd = new Date().getDate()
                let hh = new Date().getHours()
                let mf = new Date().getMinutes() < 10 ? '0' + new Date().getMinutes() : new Date().getMinutes()
                let ss = new Date().getSeconds() < 10 ? '0' + new Date().getSeconds() : new Date().getSeconds()
                let ms = new Date().getMilliseconds()

                return (objIsNull(fmt) ? new Date() : format(new Date(), fmt));
            }

            /**
             * 格式化输入的日期时间
             * @param {Date|String} datetime 被格式化的日期时间 <br/>
             * &emsp; 支持符合时间格式的字符串
             * @param {?|Number|String} [fmt=undefined] 日期格式:<br/>
             * &emsp; 不传默认返回原始Date对象 <br/>
             * &emsp; 1:返回日期短横杠格式 <br/>
             * &emsp; 2:返回日期正斜杠格式 <br/>
             * &emsp; 3:返回汉字年月日时分秒格式 <br/>
             * &emsp; 4:返回无分隔符带毫秒格式 <br/>
             * &emsp; 自定义格式: <br/>
             * &emsp; yyyy-MM-dd HH:mm:ss.f w W q Q<br/>
             * &emsp; yyyy:长年份(2023); yy:短年份(23)<br/>
             * &emsp; h:12小时制; H:24小时制; f:毫秒;<br/>
             * &emsp; w:短星期(周一); W:长星期(星期一);<br/>
             * &emsp; q:数字季度(1); Q:文字季度(一季度);<br/>
             */
            function format(datetime, fmt = undefined) {
                try {
                    let newDatetime;
                    if (typeof datetime === "string") {
                        newDatetime = new Date(Date.parse(datetime.replace(/[-,//]/g, "/")));
                    } else if (datetime instanceof Date) {
                        newDatetime = datetime;
                    }
                    // 传入时间符合判断，继续进行格式化
                    if (objIsExist(newDatetime)) {
                        // 没有传入格式，直接返回日期对象
                        if (objIsNull(fmt)) return newDatetime;

                        // 开始格式化
                        let week = newDatetime.getDay();
                        let quarter = Math.floor((newDatetime.getMonth() + 3) / 3);
                        let weeks1 = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
                        let weeks2 = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
                        let quarters = ["一季度", "二季度", "三季度", "四季度"];
                        let o = {
                            "M+": newDatetime.getMonth() + 1, //月份
                            "d+": newDatetime.getDate(), //日
                            "h+": newDatetime.getHours() % 12 === 0 ? 12 : newDatetime.getHours() % 12, //小时
                            "H+": newDatetime.getHours(), //小时
                            "m+": newDatetime.getMinutes(), //分
                            "s+": newDatetime.getSeconds(), //秒
                            "f": newDatetime.getMilliseconds(), //毫秒
                            "w+": weeks1[week], //周几
                            "W+": weeks2[week], //星期几
                            "q": quarter, //数字季度
                            "Q": quarters[quarter - 1] //文字季度
                        };


                        // 默认格式列表
                        let fmtArr = [""]
                        fmtArr.push("yyyy-MM-dd HH:mm:ss");
                        fmtArr.push("yyyy/MM/dd HH:mm:ss");
                        fmtArr.push("yyyy年MM月dd日 HH时mm分ss秒");
                        fmtArr.push("yyyyMMddHHmmssf");

                        // 选择格式化模板
                        let fmtStr = (typeof fmt === "number" && 0 < fmt && fmt < fmtArr.length ? fmtArr[fmt] : fmt);

                        //年份部分的格式匹配
                        if (/(y+)/.test(fmtStr)) {
                            fmtStr = fmtStr.replace(RegExp.$1, (newDatetime.getFullYear() + "").substr(4 - RegExp.$1.length));
                        }
                        //其他部分的格式匹配
                        for (let k in o) {
                            if (new RegExp("(" + k + ")").test(fmtStr)) {
                                fmtStr = fmtStr.replace(RegExp.$1, (RegExp.$1.length === 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
                            }
                        }
                        return fmtStr;
                    }
                } catch (e) {
                    console.error(e);
                }
                return datetime;
            }


            // 方法暴露
            $.extend(utils, {
                objIsDate: objIsDate,   //检查对象是否为Date类型
                date: {
                    objIsDate: objIsDate,   //检查对象是否为Date类型
                    strIsDatetime: strIsDatetime,   //检查字符串是否是DateTime格式
                    strIsDate: strIsDate,   //检查字符串是否是Date格式
                    strIsTime: strIsTime,   //检查字符串是否是Time格式

                    objToDatetime: objToDatetime,   //obj转Datetime
                    objToTimestamp: objToTimestamp,  //obj转时间戳
                    msToDuration: msToDuration,     //将毫秒转化为持续时间
                    tsToDatetime: tsToDatetime,     //时间戳转Date

                    getNowTimestamp: getNowTimestamp,   //获得当前时间戳
                    getNowDatetime: getNowDatetime,  //获取当前时间
                    format: format,     //格式化输入的日期时间
                }
            });


            /*==== [ Cookie相关 ] =====================================================================================*/

            /**
             * 设置给定密钥的cookie值。 <br/>
             * 这是为ABP创建的一个简单实现。 <br/>
             * 如果需要，请使用完整的cookie库。 <br/>
             * @param {string} key 关键字
             * @param {string} value 值
             * @param {Date} expireDate 过期日期（可选）。 <br/> (如果未指定，cookie将在会话结束时过期。)
             * @param {string} path 路径（可选）
             * @param {string} domain 域（可选）
             * @param {any} attributes 属性（可选）
             */
            function setCookieValue(key, value, expireDate = undefined, path = undefined, domain = undefined, attributes = undefined) {
                let cookieValue = encodeURIComponent(key) + '=';

                if (value) {
                    cookieValue = cookieValue + encodeURIComponent(value);
                }

                if (expireDate) {
                    cookieValue = cookieValue + "; expires=" + expireDate.toUTCString();
                }

                if (path) {
                    cookieValue = cookieValue + "; path=" + path;
                }

                if (domain) {
                    cookieValue = cookieValue + "; domain=" + domain;
                }

                for (let name in attributes) {
                    if (!attributes[name]) {
                        continue;
                    }

                    cookieValue += '; ' + name;
                    if (attributes[name] === true) {
                        continue;
                    }

                    cookieValue += '=' + attributes[name].split(';')[0];
                }

                document.cookie = cookieValue;
            }

            /**
             * 获取具有给定密钥的cookie。 <br/>
             * 这是为ABP创建的一个简单实现。 <br/>
             * 如果需要，请使用完整的cookie库。 <br/>
             * @param {string} key 关键字
             * @returns {string|null} Cookie值或空值
             */
            function getCookieValue(key) {
                let equalities = document.cookie.split('; ');
                for (let i = 0; i < equalities.length; i++) {
                    if (!equalities[i]) {
                        continue;
                    }

                    let splitted = equalities[i].split('=');
                    if (splitted.length !== 2) {
                        continue;
                    }

                    if (decodeURIComponent(splitted[0]) === key) {
                        return decodeURIComponent(splitted[1] || '');
                    }
                }

                return null;
            }

            /**
             * 删除给定密钥的cookie。 <br/>
             * 这是为ABP创建的一个简单实现。 <br/>
             * 如果需要，请使用完整的cookie库。 <br/>
             * @param {string} key 关键字
             * @param {string} path 路径（可选）
             */
            function deleteCookie(key, path) {
                let cookieValue = encodeURIComponent(key) + '=';

                cookieValue = cookieValue + "; expires=" + (new Date(new Date().getTime() - 86400000)).toUTCString();

                if (path) {
                    cookieValue = cookieValue + "; path=" + path;
                }

                document.cookie = cookieValue;
            }


            // 方法暴露
            $.extend(utils, {
                cookie: {
                    setCookieValue: setCookieValue,
                    getCookieValue: getCookieValue,
                    deleteCookie: deleteCookie
                }
            });


            /*==== [ 动作行为 ] =======================================================================================*/

            /**进入全屏*/
            function enterFullScreen(element) {
                let requestMethod = element.requestFullScreen || //W3C
                    element.webkitRequestFullScreen ||    //Chrome等
                    element.mozRequestFullScreen || //FireFox
                    element.msRequestFullScreen; //IE11
                if (requestMethod) {
                    requestMethod.call(element);
                } else if (typeof window.ActiveXObject !== "undefined") {//for Internet Explorer
                    let wscript = new ActiveXObject("WScript.Shell");
                    if (wscript !== null) {
                        wscript.SendKeys("{F11}");
                    }
                }
            }

            /**退出全屏*/
            function exitFullScreen() {
                // 判断各种浏览器，找到正确的方法
                let exitMethod = document.exitFullscreen || //W3C
                    document.mozCancelFullScreen || //Chrome等
                    document.webkitExitFullscreen || //FireFox
                    document.webkitExitFullscreen; //IE11
                if (exitMethod) {
                    exitMethod.call(document);
                } else if (typeof window.ActiveXObject !== "undefined") {//for Internet Explorer
                    let wscript = new ActiveXObject("WScript.Shell");
                    if (wscript !== null) {
                        wscript.SendKeys("{F11}");
                    }
                }
            }

            /**判断是否为全屏模式*/
            function isFullscreen() {
                return document.fullscreenElement ||
                    document.msFullscreenElement ||
                    document.mozFullScreenElement ||
                    document.webkitFullscreenElement || false;
            }

            // 方法暴露
            $.extend(utils, {
                act: {
                    enterFullScreen: enterFullScreen,
                    exitFullScreen: exitFullScreen,
                    isFullscreen: isFullscreen
                }
            });


            /*==== [ 控件事件绑定 ] =======================================================================================*/

            /**
             * 绑定鼠标右键点击事件
             * @param {string} elemName 元素名称，按jq选择器规则写
             * @param {function} leftClickEvent 左键事件
             * @param {function} rightClickEvent 右键事件
             * @param {function} middleClickEvent 中键事件
             * @param {function} behindClickEvent 后侧键事件
             * @param {function} frontClickEvent 前侧键事件
             */
            function mouseClick(elemName, leftClickEvent, rightClickEvent, middleClickEvent, behindClickEvent, frontClickEvent) {
                $(elemName).on('mousedown', function (e) {
                    if (e.which === 1 && leftClickEvent) {
                        //左键
                        leftClickEvent();
                    } else if (e.which === 2 && middleClickEvent) {
                        //中键
                        middleClickEvent();
                    } else if (e.which === 3 && rightClickEvent) {
                        //右键
                        rightClickEvent();
                    } else if (e.which === 4 && behindClickEvent) {
                        //后侧键
                        behindClickEvent();
                    } else if (e.which === 5 && frontClickEvent) {
                        //前侧键
                        frontClickEvent();
                    } else {
                        console.log(e.which);
                    }
                })
            }

            /**
             * 绑定鼠标点击事件
             * @param {string} elemName 元素名称，按jq选择器规则写
             * @param {number} which 按键标识（1:左键；2:中键；3:右键；4:鼠标后侧键；5:鼠标前侧键）
             * @param {function} event 具体要执行的事件（也可直接传入匿名函数）
             * @param {*} eventParameter event事件所需的参数（可选）
             */
            function mouseClickSpecify(elemName, which, event, eventParameter) {
                $(elemName).on('mousedown', function (e) {
                    if (e.which === which) {
                        event(eventParameter);
                    }
                });
            }


            // 方法暴露
            $.extend(utils, {
                bind: {
                    mouseClick: mouseClick,
                    mouseClickSpecify: mouseClickSpecify
                }
            });


            /*==== [ 颜色相关 ] =======================================================================================*/

            /*
            //【colorGradients 方法调用示例】
            //主题配置
            let themeArr = [
                //第一套配色
                {
                    theme: 1,
                    colorList: [
                        //logo位背景色
                        {
                            elem: ".sideMenu .logoName",
                            prop: "background-color",
                            color: "#1485d9"
                        }
                        //顶部导航栏背景色
                        , {
                            elem: ".container .funcHeader",
                            prop: "background-color",
                            color: "#39b6fe"
                        }
                    ]
                }
                //第二套配色
                , {
                    theme: 2,
                    colorList: [
                        //logo位背景色
                        {
                            elem: ".sideMenu .logoName",    //元素
                            prop: "background-color",   //变色属性
                            color: "#ba701b"    //颜色编码
                        }
                        //顶部导航栏背景色
                        , {
                            elem: ".container .funcHeader", //元素
                            prop: "background-color",   //变色属性
                            color: "#f78400"    //颜色编码
                        }
                    ]
                }
            ];
            //遍历渐变
            $.each(themeArr, function (idx, theme) {
                setTimeout(function () {
                    let colorList2 = themeArr[((idx + 1) >= themeArr.length ? 0 : (idx + 1))].colorList;
                    $.each(theme.colorList, function (i, cI1) {
                        utils.color.colorGradients(cI1.elem, cI1.prop, cI1.color, colorList2[i].color);
                    })
                }, (idx + 1) * 1000);
            })
            */

            /**
             * 颜色渐变
             * @param elem 元素
             * @param prop 颜色属性（css颜色属性，例：color、background-color、border-color等）
             * @param color1 颜色1
             * @param color2 颜色2
             * @param mills 变色所需时间（单位：ms）[变色时间需是变色速度的三倍以上，默认为600ms]（可选）
             * @param speed 变色速度（单位：ms）[默认为200ms]（可选）
             */
            function colorGradients(elem, prop, color1, color2, mills, speed) {
                //控制参数的正确性
                if (isNaN(mills) || mills <= 0) mills = 600;
                if (isNaN(speed) || speed <= 0) speed = 200;
                //控制 mills 至少为 speed 的三倍
                if (mills < (speed * 3)) mills = (speed * 3);

                let queueList = _getColorGradientsQueue(color1, color2, mills, speed);
                queueList.forEach((queue, i) => {
                    setTimeout(function () {
                        let rgb = "rgb(" + queue[0] + "," + queue[1] + "," + queue[2] + ")";
                        $(elem).css(prop, rgb);
                    }, (i + 1) * speed);
                })
            }

            /**
             * 获取颜色渐变队列
             * @param color1 颜色1
             * @param color2 颜色2
             * @param mills 变色所需时间（单位：ms）[变色时间需是变色速度的三倍以上，默认为600ms]（可选）
             * @param speed 变色速度（单位：ms）[默认为200ms]（可选）
             * @returns {[]} 返回颜色过渡数组
             */
            function _getColorGradientsQueue(color1, color2, mills, speed) {
                let count = mills / speed;  //变色时间需大于600ms
                let data1 = _colorToRGB(color1);
                let data2 = _colorToRGB(color2);
                let red = data1[0], green = data1[1], blue = data1[2];
                let r = (data2[0] - data1[0]) / count,
                    g = (data2[1] - data1[1]) / count,
                    b = (data2[2] - data1[2]) / count;

                let queue = [];
                for (let i = 1; i < count + 1; i++) {
                    queue.push([
                        parseInt(red + r * i + 0.5),
                        parseInt(green + g * i + 0.5),
                        parseInt(blue + b * i + 0.5)
                    ]);
                }
                return queue;
            }

            /**
             * 将输入的颜色字符串转换成十进制数组
             * @param color 传入的参数color格式可以是："#1ba3e1"、"#f0e"、"rgb(200,50,100)"、"rgb(20%,80%,50%)"这四种格式。
             * @returns {[number, number, number]}  返回的是rgb三个数值组成的数组。
             */
            function _colorToRGB(color) {
                let rgb = [];
                let re = RegExp;
                if (/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.test(color)) {
                    //#rrggbb
                    rgb = [parseInt(re.$1, 16), parseInt(re.$2, 16), parseInt(re.$3, 16)];
                } else if (/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.test(color)) {
                    //#rgb
                    rgb = [parseInt(re.$1 + re.$1, 16), parseInt(re.$2 + re.$2, 16), parseInt(re.$3 + re.$3, 16)];
                } else if (/^rgb(.*),(.*),(.*)$/i.test(color)) {
                    //rgb(n,n,n) or rgb(n%,n%,n%)
                    if (re.$1.indexOf("%") > -1) {
                        rgb = [parseInt(parseFloat(re.$1, 10) * 2.55),
                            parseInt(parseFloat(re.$2, 10) * 2.55),
                            parseInt(parseFloat(re.$3, 10) * 2.55)];
                    } else {
                        rgb = [parseInt(re.$1), parseInt(re.$2), parseInt(re.$3)];
                    }
                }

                //验证rgb的合法范围
                if (rgb[0] < 0 || 255 < rgb[0]) rgb[0] = -1;
                if (rgb[1] < 0 || 255 < rgb[1]) rgb[1] = -1;
                if (rgb[2] < 0 || 255 < rgb[2]) rgb[2] = -1;


                return rgb;
            }

            // 方法暴露
            $.extend(utils, {
                color: {
                    colorGradients: colorGradients
                }
            });


            /*==== [ 效果相关 ] =======================================================================================*/

            /**
             * 控件闪烁
             * @param {element} element 元素
             * @param {Object} [config={}] 配置
             * @param {function} [callback=undefined] 闪烁完之后的回调
             */
            function elemTwinkle(element, config = {}, callback = undefined) {
                /*实现控件为空，直接退出*/
                if (element == undefined || element == null || element.length <= 0 || element == "") {
                    return;
                }

                /*配置项*/
                let options = {
                    /*【基础配置】*/
                    // 实现变色的css属性，一般可以使用背景色属性:background-color,文本色属性:color,阴影:box-shadow。
                    cssAttribute: 'background-color',
                    // 颜色1:显（如果是box-shadow: 0 0 20px 10px #eee;）
                    color1: 'rgba(255, 0, 0, 0.8)',
                    // 颜色2:隐（如果是box-shadow: 0 0 20px 10px #eee;）
                    color2: 'rgba(255, 0, 0, 0.1)',

                    /*【闪烁配置】*/
                    // 闪烁次数
                    twinkleCount: 3,
                    // 显示时长
                    twinkleShowTime: 800,
                    // 隐藏间隔
                    twinkleHideTime: 500,

                    /*【layui.tips配置】*/
                    // 是否显示tips
                    isShowTips: true,
                    // tips文本
                    tipsText: "这是示例文本",
                    // tips配置
                    tipsConfig: {
                        tips: [4, '#3595CC'],
                        time: 4000
                    },

                    /*【功能配置】*/
                    // 是否开启鼠标侵入（鼠标移入闪动元素后即刻停止闪烁）
                    isMouseInvasion: true,
                    // 鼠标入侵的方式（鼠标移入:mouseover，鼠标移出:mouseout，鼠标单击:click）
                    mouseInvasionMode: "mouseover"
                }
                /*配置项更新*/
                $.extend(options, config);

                /*为元素设置过渡效果*/
                let tranTime = Math.min(options.twinkleShowTime, options.twinkleHideTime, 3000) / 1000;   // 过渡时长
                $(element).css({
                    "-webkit-transition": `${tranTime}s`,
                    "-moz-transition": `${tranTime}s`,
                    "-ms-transition": `${tranTime}s`,
                    "transition": `${tranTime}s`
                });

                /*开始处理闪烁*/
                // 闪烁计数器
                let twinkleIdx = 0;
                // 延迟累加器
                let delayTime = 0;
                // 闪烁队列
                let twinkleQueue = [];
                // 原颜色
                let originalColor = $(element).css(options.cssAttribute);
                do {
                    // color1:显
                    twinkleQueue.push(setTimeout(function () {
                        $(element).css(options.cssAttribute, options.color1);
                    }, delayTime));
                    delayTime = delayTime + options.twinkleShowTime;

                    // color2:隐
                    twinkleQueue.push(setTimeout(function () {
                        $(element).css(options.cssAttribute, options.color2);
                    }, delayTime));
                    delayTime = delayTime + options.twinkleHideTime;
                } while (++twinkleIdx < options.twinkleCount)

                // 闪烁结束，还原显示
                twinkleQueue.push(setTimeout(function () {
                    $(element).css(options.cssAttribute, originalColor);
                    if (callback && typeof (callback) === "function") callback();
                }, delayTime - options.twinkleHideTime));


                // 显示tips
                let twinkleTips = 0;
                if (options.isShowTips) {
                    twinkleTips = layer.tips(options.tipsText, element, options.tipsConfig);
                }
                // 鼠标侵入中断闪烁
                if (options.isMouseInvasion) {
                    $(element).bind(options.mouseInvasionMode, function () {
                        $.each(twinkleQueue, function (idx, arr) {
                            clearTimeout(arr);
                        });
                        $(element).stop();
                        $(element).css(options.cssAttribute, originalColor);
                        // 关闭tips层
                        layer.close(twinkleTips);

                        // 取消鼠标侵入动作
                        $(element).unbind(options.mouseInvasionMode)

                        // 执行回调
                        if (callback && typeof (callback) === "function") callback();
                    });
                }

                /*
                * 调用示例：
                *
                    elemTwinkle($(".demo"), {
                        // 闪烁样式
                        cssAttribute: "box-shadow",
                        // 颜色1:显
                        color1: '0 0 10px 2px rgba(255, 87, 34, 0.5)',
                        // 颜色2:隐
                        color2: '0 0 10px 2px rgba(255, 87, 34, 0.1)',

                        // 更换提示
                        tipsText: "鼠标移入 停止闪烁并执行回调",
                        // tips配置
                        tipsConfig: {
                            tips: [2, '#666'],
                            time: 4000
                        },

                        // 闪烁次数
                        twinkleCount: 30,
                        // 显示时长（呼吸效果）
                        twinkleShowTime: 1500,
                        // 隐藏间隔（呼吸效果）
                        twinkleHideTime: 3000,
                    }, function () {
                        layer.msg("闪烁回调")
                    });
                * */
            }


            // 方法暴露
            $.extend(utils, {
                effect: {
                    elemTwinkle: elemTwinkle
                }
            });


            /*==== [ ajax 相关 ] ===================================================================================*/

            /**
             * ajax请求
             * @param config
             */
            function ajaxTools(config) {
                //创建xhr对象实例
                const xhr = new XMLHttpRequest();
                const sync = config.sync !== undefined ? config.sync : true;
                const type = config.type !== undefined ? config.type : 'GET';
                const isGetRequest = type.toUpperCase() === 'GET';
                const isPOSTRequest = type.toUpperCase() === 'POST';
                const dataType = typeof config.data;
                let url = config.url;

                if (isGetRequest) {
                    if (dataType !== 'undefined') {
                        if (dataType === 'string') {
                            url += '?' + config.data;
                        } else if (dataType === 'object') {
                            const params = new URLSearchParams(config.data).toString();
                            url += '?' + params;
                        }
                    }
                    // 建立连接
                    xhr.open('GET', url, sync);
                } else if (isPOSTRequest) {
                    // 先建立连接，再设定请求头
                    xhr.open('POST', config.url, sync);
                    if (config.data instanceof FormData) {
                        // 无需为FormData设置content-type;浏览器处理它。
                    } else if (dataType === "object") {
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        config.data = JSON.stringify(config.data);
                    } else if (dataType === 'string') {
                        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                    }
                }

                //添加请求头
                addHeaders(xhr, config.header);

                // 监听状态变化
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            const response = JSON.parse(xhr.responseText);
                            if (typeof config.success === 'function') {
                                config.success(response);
                            }
                        } else {
                            if (typeof config.error === 'function') {
                                config.error(xhr.status, xhr.statusText);
                            }
                        }
                    }
                };

                // 正式发送请求
                if (isGetRequest) {
                    xhr.send();
                } else if (isPOSTRequest) {
                    xhr.send(config.data);
                }

                /**添加请求头*/
                function addHeaders(xhr, headers) {
                    if (typeof headers === 'object') {
                        Object.keys(headers).forEach(key => {
                            if (typeof key === 'string' && key.length > 0)
                                xhr.setRequestHeader(key, headers[key]);
                        });
                    }
                }


                /** GET 示例 */
                /* ajaxTools({
                    url: 'https://apii.lolimi.cn/api/4o/gpt4o',
                    type: 'GET',    // 请求方式（默认GET）
                    sync: false,    // 异步请求（默认true）
                    header: {
                        "": ""
                    },  // 请求头
                    data: {
                        "key": "nGnO1ya6FttteSAfQPKgeY157M",
                        "msg": "斐济元",
                        "sx": "你是一个银行家，请用专业的角度和口吻回答我的问题。",
                        "json": "text"
                    },  // 请求体
                    success: function (response) {
                        console.log(response);
                    },
                    error: function (status, statusText) {
                        console.log(status, statusText);
                    }
                }); */


                /** POST 示例*/
                /*ajaxTools({
                    url: 'https://apii.lolimi.cn/api/c4o/c?key=nGnO1ya6FttteSAfQPKgeY157M&type=json',
                    type: 'POST',
                    data: [{
                        "role": "user",
                        "content": "你是一个银行家，请用专业的角度和口吻告诉我 “斐济元” 这个货币的详细信息"
                    }],
                    success: function (response) {
                        console.log(response);
                    },
                    error: function (status, statusText) {
                        console.log(status, statusText);
                    }
                });*/

            }


            // 方法暴露
            $.extend(utils, {
                ajax: {
                    ajaxTools: ajaxTools
                }
            });


            /*==== [ chatGPT 相关 ] ===================================================================================*/

            /**
             * chatGPT单次询问
             * @param options 配置项{msg:'提问内容', rs:'人物设定', type:'返回数据类型 json/text'}
             * @param success 询问成功回调
             * @param error 询问失败回调
             */
            function gpt_4o(options, success, error = undefined) {
                ajaxTools({
                    url: 'https://apii.lolimi.cn/api/4o/gpt4o',
                    data: {
                        "key": "nGnO1ya6FttteSAfQPKgeY157M",
                        "msg": options.msg,
                        "sx": options.rs,
                        "type": options.type
                    },
                    success: function (response) {
                        if (typeof success === "function") success(response);
                    },
                    error: function (status, statusText) {
                        if (typeof error === "function") error(status, statusText);
                    }
                });
            }


            // 方法暴露
            $.extend(utils, {
                chatGPT: {
                    gpt_4o: gpt_4o
                }
            });


            //……

            return utils;
        })();
    });
}(typeof define === 'function' && define.amd ? define : function (deps, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory(require('jquery'));
    } else {
        window.utils = factory(window.jQuery);
    }
}));
