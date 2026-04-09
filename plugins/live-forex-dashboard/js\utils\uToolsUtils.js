(function (define) {
    define(['jquery'], function ($) {
        return (function () {

            let utils = {};

            /*==== [ Common API ] ====================================================================================*/

            /**
             * 复制文本
             * @param content 文本内容
             */
            function copy(content) {
                try {
                    utools.copyText(content);
                } catch (e) {
                    showError("复制操作");
                }
            }

            /**
             * 显示 uTools API 调取失败信息
             * @param content 提示内容
             */
            function showError(content) {
                console.error(content, "uTools API 操作失败！");
            }

            // 方法暴露
            $.extend(utils, {
                copy: copy,
                showError: showError
            });


            /*==== [ DB API ] ========================================================================================*/

            /**
             * 获取本地数据
             * @param {string} key 数据关键字
             * @param {Object} defaultVal 默认返回值
             * @returns {Object} 返回数据
             */
            function get(key, defaultVal = undefined) {
                try {
                    let d = utools.db.get(key);
                    if (d && d.data) return d.data;
                } catch (e) {
                    showError("数据[获取]操作");
                }
                return defaultVal;
            }

            /**
             * 保存本地数据
             * @param {string} key 数据关键字
             * @param {Object} data 数据值
             * @param {boolean} isCover 保存方式（true:覆盖保存，false:增量保存_默认值）。
             * [覆盖保存]将清除原有的数据，仅保存传入值的字段。
             * [增量保存]将在原有的数据上增加字段，或改变原有字段的值。
             * @returns {*} 返回回调数据
             */
            function save(key, data, isCover = false) {
                try {
                    let oldData = utools.db.get(key);
                    if (oldData) {
                        //更新
                        let saveData = (isCover ? data : $.extend(true, oldData.data, data)); //默认增量保存；isCover为true时 覆盖更新。
                        utools.db.put({_id: key, data: saveData, _rev: oldData._rev});
                        //更新操作uTools DB API官方文档：每次更新时都要传入完整的文档数据，无法对单个字段进行更新。
                    } else {
                        //创建
                        utools.db.put({_id: key, data: data,});
                    }
                    //获取，回显
                    return uToolsUtils.db.get(key);
                } catch (e) {
                    showError("数据[保存]操作");
                }
            }

            /**
             * 删除本地数据
             * @param {string} key 数据关键字
             */
            function del(key) {
                try {
                    utools.db.remove(key);
                } catch (e) {
                    showError("数据[删除]操作");
                }
            }

            // 方法暴露
            $.extend(utils, {
                db: {
                    get: get,
                    save: save,
                    del: del,
                }
            });


            /*==== [ 模拟操作 API ] ====================================================================================*/

            /**
             * 【模拟】粘贴
             */
            function paste() {
                try {
                    if (utools.isWindows() || utools.isLinux()) {
                        // windows linux 模拟粘贴
                        utools.simulateKeyboardTap('v', 'ctrl')
                    } else if (utools.isMacOs()) {
                        // macos 模拟粘贴
                        utools.simulateKeyboardTap('v', 'command')
                    }
                } catch (e) {
                    showError("模拟[粘贴]操作");
                }
            }

            /**
             * 【模拟】关闭窗口
             */
            function closeWindow() {
                try {
                    if (utools.isWindows()) {
                        //windows模拟：Alt + F4
                        utools.simulateKeyboardTap('F4', 'Alt')
                    } else if (utools.isLinux()) {

                    } else if (utools.isMacOs()) {

                    }
                } catch (e) {
                    showError("模拟[关闭窗口]操作");
                }
            }

            // 方法暴露
            $.extend(utils, {
                simulate: {
                    paste: paste,
                    closeWindow: closeWindow
                }
            });


            /*==== [ 窗口 API ] =======================================================================================*/

            /**
             * 是否深色模式
             * @returns Boolean 是否深色模式
             */
            function isDarkColors() {
                try {
                    return utools.isDarkColors();
                } catch (e) {
                    showError("窗口[是否深色模式]");
                }
            }

            /**
             * 隐藏当前窗口，并将焦点回归到前面的活动窗口
             */
            function hide() {
                try {
                    if (_global.isDetach) {
                        //窗口已分离
                        closeWindow();
                    } else {
                        utools.hideMainWindow();
                    }
                } catch (e) {
                    showError("窗口[隐藏]");
                }
            }


            /**
             * 创建浏览器窗口
             * @param {String} url 相对路径的 html 文件
             * @param {Object} options 与 <a href='https://www.electronjs.org/docs/api/browser-window#new-browserwindowoptions'>Electron API new BrowserWindow</a> 参数一样，注意：preload 需配置相对位置
             * @param {Function} [callback=undefined] 加载完成时回调
             * @return {*} 返回 uTools API 构建的 <a href='https://www.electronjs.org/docs/api/browser-window'>BrowserWindow</a> 对象。 保留了大部分实例方法
             */
            function createBrowserWindow(url, options, callback = undefined) {
                return utools.createBrowserWindow(url, options, callback);
            }


            // 方法暴露
            $.extend(utils, {
                window: {
                    createBrowserWindow: createBrowserWindow,
                    isDarkColors: isDarkColors,
                    hide: hide
                }
            });


            /*==== [ 环境 API ] =======================================================================================*/

            /**
             * 是开发环境
             */
            function isDev() {
                return utools.isDev();
            }

            /**
             * 是MacOS环境
             */
            function isMacOS() {
                return utools.isMacOS();
            }

            /**
             * 是Windows环境
             */
            function isWindows() {
                return utools.isWindows();
            }

            /**
             * 是Linux环境
             */
            function isLinux() {
                return utools.isLinux();
            }

            // 方法暴露
            $.extend(utils, {
                environment: {
                    isDev: isDev,
                    isMacOS: isMacOS,
                    isWindows: isWindows,
                    isLinux: isLinux
                }
            });


            /*==== [ 浏览器 API ] =======================================================================================*/

            /**
             * 前往
             * @param {String} url
             * @param {Object} [headers=undefined] 请求头（可选）
             * @param {number} [timeout=undefined] 超时（可选） 默认 60000 ms
             * @return {*} 返回ubrowser对象，可做链式操作，<a href='https://u.tools/docs/developer/ubrowser.html#api-%E5%88%97%E8%A1%A8'>具体文档</a>。
             */
            function goto(url, headers = undefined, timeout = undefined) {
                return utools.ubrowser.goto(url, headers, timeout);
            }

            /**
             * 打开浏览器
             * @param url 链接地址
             */
            function open(url) {
                // 浏览器打开
                utools.shellOpenExternal(url);
            }


            // 方法暴露
            $.extend(utils, {
                browser: {
                    goto: goto,
                    open: open
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
        window.uToolsUtils = factory(window.jQuery);
    }
}));
