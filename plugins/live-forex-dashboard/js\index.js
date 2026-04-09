$(function () {
    let RATES = [];
    let RATES_TIME = 0;
    let hbInfoList = [];
    let hbCodeList = getPersistentValue('hbCodeList', ['CNY']);
    let editHBInfo = getPersistentValue('editHBInfo', {code: 'CNY', name: '中国人民币', money: 1, rate: 0});
    let digit = getPersistentValue('digit', 2);
    let ifShowAbandon = getPersistentValue('ifShowAbandon', false);
    $("#digit").val(digit);
    $("#showAbandon").prop("checked", ifShowAbandon);

    // 读取上次是黑暗 或uTools是黑暗
    let isNight = getPersistentValue('isNight', false) || uToolsUtils.window.isDarkColors();
    if (isNight) {
        $("#darkMode").prop("checked", true);
        $('html,body').addClass("night");
    }

    layui.use(['form', 'layer', 'table', 'soulTable'], function () {
        const form = layui.form, layer = layui.layer, table = layui.table, soulTable = layui.soulTable;

        loadSelect();

        function loadSelect() {
            $.getJSON("./file/hbInfo.json", {}, function (json) {
                // 赋值全局变量
                hbInfoList = ifShowAbandon ? json : json.filter(d => !d.name.includes('废弃'));

                // 渲染货币下拉框
                let $hbList = $("#hbList");
                $hbList.empty();
                $hbList.append('<option value="">选择货币</option>');

                if (hbCodeList.length === hbInfoList.length) {
                    $hbList.append('<option value="999" data-state="1">==== 移除全部 ====</option>');
                } else $hbList.append('<option value="999" data-state="0">==== 添加全部 ====</option>');

                hbInfoList.forEach(d => {
                    $hbList.append([
                        `<option value="${d.code}">`,
                        `${d.name}（${d.code}）`,
                        `</option>`
                    ].join('\n'));
                });

                // 刷新汇率，并加载表格
                refreshRates(loadTable);

                // 渲染全部表单
                form.render();
            });
        }


        table.render({
            elem: '#tableList1'
            , id: 'tableList1'
            , cols: getCols(1)
            , data: [{
                flag: `./img/svgs/flags/${editHBInfo.code.toLowerCase()}.svg`,
                name: editHBInfo.name,
                code: editHBInfo.code,
                rate: utils.objToFloat(RATES[editHBInfo.code]),
                money: editHBInfo.money
            }]
        });

        table.render({
            elem: '#tableList'
            , id: 'tableList'
            , height: 'full-200'
            , cols: getCols(0)
            , data: [{
                flag: `./img/svgs/flags/${editHBInfo.code.toLowerCase()}.svg`,
                name: editHBInfo.name,
                code: editHBInfo.code,
                rate: utils.objToFloat(RATES[editHBInfo.code]),
                money: editHBInfo.money
            }]
            , rowDrag: {
                /*trigger: 'row',*/
                done: function (obj) {
                    // 完成时（松开时）触发
                    // 如果拖动前和拖动后无变化，则不会触发此方法
                    // console.log(obj.row) // 当前行数据
                    // console.log(obj.cache) // 改动后全表数据
                    // console.log(obj.oldIndex) // 原来的数据索引
                    // console.log(obj.newIndex) // 改动后数据索引

                    hbCodeList = obj.cache.map(d => d.code);
                    // 保存数据
                    saveDB();
                }
            }
            , done: function () {
                //开启拖动排序
                soulTable.render(this);
            }
        });


        // 刷新汇率
        $(".refresh-rate").click(function () {
            refreshRates(loadTable);
        })


        // select 下拉选择监听
        form.on('select(hbList)', function (data) {
            let elem = data.elem; // 获得 select 原始 DOM 对象
            let hb999 = $(elem).find("option[value=999]");

            let hbCode = $(elem).val();
            if (utils.objIsExist(hbCode)) {
                if (hbCode === "999") {
                    // 选中特殊项
                    let state = $(hb999).attr("data-state");
                    if (state === '1') {
                        // 现在要移出
                        hbCodeList = ['CNY'];
                        editHBInfo = {code: 'CNY', name: '中国人民币', money: 1, rate: utils.objToFloat(RATES['CNY'])}
                        hb999.attr("data-state", "0").text("==== 添加全部 ====");
                    } else {
                        // 现在要添加
                        hbCodeList = hbInfoList.map(d => d.code);
                        hb999.attr("data-state", "1").text("==== 移除全部 ====");
                    }
                    form.render($(elem));
                } else {
                    let hbInfo = hbInfoList.find(d => d.code === hbCode);
                    if (!hbInfo) {
                        layer.msg(`${hbCode} 未找到该货币信息!`, {icon: 5, anim: 'slideUp'});
                        return;
                    }

                    let rate = utils.objToFloat(RATES[hbCode]);
                    if (rate <= 0) {
                        layer.msg(`${hbCode} 未找到该货币汇率信息!`, {icon: 5, anim: 'slideUp'});
                        return;
                    }

                    // 选中常规项
                    if (hbCodeList.includes(hbCode)) {
                        // 货币已参与计算
                        layer.msg('货币已参与计算!', {icon: 1, anim: 'slideUp'});

                        // 已参与计算的货币，再次选择 将替换顶部计算货币
                        $.extend(editHBInfo, {code: hbInfo.code, name: hbInfo.name, rate: rate});

                    } else hbCodeList.push(hbCode);

                    // 所有货币全部添加
                    if (hbCodeList.length === hbInfoList.length) {
                        hb999.attr("data-state", "1").text("==== 移除全部 ====");
                        form.render($(elem));
                    }

                }
                loadTable();
            }
        });

        // 下拉渲染元素点击事件
        $(document).on('click', '#divHbList .layui-form-select .layui-select-title input', function () {
            let aa = $(this).parents('.layui-form-select').hasClass('layui-form-selected')
            if (aa) $(this).select();
        })

        // checkbox 是否显示'废弃'货币
        form.on('checkbox(showAbandon)', function (data) {
            ifShowAbandon = data.elem.checked;
            if (!ifShowAbandon) {
                // 移除'废弃'条目
                let newDataList = table.cache["tableList"].filter(d => !d.name.includes('废弃'));
                table.cache["tableList"] = newDataList;
                table.renderData("tableList");
                // 更新货币code变量
                hbCodeList = newDataList.map(d => d.code);
            }
            loadSelect();
            saveDB();
        });

        // checkbox 深色模式
        form.on('checkbox(darkMode)', function (data) {
            if (data.elem.checked) {
                // 启动深色模式
                isNight = true;
                uToolsUtils.db.save('isNight', true, true);
                $('html,body').addClass("night");
            } else {
                // 关闭深色模式
                isNight = false;
                uToolsUtils.db.save('isNight', false, true);
                $('html,body').removeClass("night");
            }
        });

        // input 数字框后缀监听
        form.on('input-affix(digit)', function (data) {
            digit = Math.min(utils.objToNumber($(data.elem).val()), 20);
            loadTable();
        });
        // 数字框输入监听
        $("#digit").change(function () {
            digit = Math.min(utils.objToNumber($(this).val()), 20)
            loadTable();
        })

        // 单元格编辑事件
        table.on('edit(tableList)', function (obj) {
            edit(obj);
        });
        table.on('edit(tableList1)', function (obj) {
            edit(obj);
        });

        // 更换基准货币
        function edit(obj) {
            let value = obj.value // 得到修改后的值
            let data = obj.data // 得到所在行所有键值

            // 记录编辑内容
            $.extend(editHBInfo, {
                code: data.code,
                name: data.name,
                money: utils.objToFloat(value),
                rate: utils.objToFloat(RATES[data.code])
            });

            // 选中下拉
            let $hbList = $("#hbList");
            $hbList.val(data.code);
            form.render($hbList);

            // 重新计算并渲染
            loadTable();

            // 清除历史汇率缓存
            $("#allHistoryRatesList").val('[]');
        }

        // 单元格获取焦点事件
        $(document).on('focus', '.layui-table-body table.layui-table td[data-field="money"] input.layui-table-edit', function (event) {
            let val = $(this).val();
            $(this).val(utils.math.round(val, 6));
            $(this).select();
        });

        // 单元格工具事件
        table.on('tool(tableList)', function (obj) {
            let data = obj.data; // 得到当前行数据
            let layEvent = obj.event;   // 获得元素对应的 lay-event 属性值

            if (layEvent === 'del') {
                let btn = $(obj.tr).find("a[lay-event='del']");

                /* ==== [ 彩蛋：拟人化提示 ] ==== */
                if (hbCodeList.length <= 1) {
                    let delIdx1 = _temp.delIdx1 = _temp.delIdx1 || 0;
                    _temp.delIdx1++;

                    if (0 <= delIdx1 && delIdx1 < 20) {
                        let tipsList = ['留一个~', '留一个嘛，好不好~', '就一个嘛，拜托啦~', '一个就行啦，求求你啦~', '总得留一个吧，行不行嘛~', '我可不妥协哦，哼~', '我！不！妥！协！我说真的哦~', '不！妥！协！坚持到底~', '不！妥！协！绝不让步~', '不！就是不！', '不！'];
                        let tips = tipsList[Math.min(delIdx1, tipsList.length - 1)];
                        layer.tips(tips, btn, {tips: [4, '#ff5722']});
                        return;
                    } else if (20 <= delIdx1 && delIdx1 < 30) {
                        btn.addClass('spin-element');   // 疯狂旋转中...
                        layer.tips((delIdx1 <= 25 ? '我生气啦!' : '我真的生气啦!'), btn, {tips: [4, '#ff5722']});
                        return;
                    } else if (30 <= delIdx1 && delIdx1 < 40) {
                        let tipsList = ['再点我就走了！', '再点我就走了！', '我真的走了！', '我不骗你的！', '我数三声！', '3~', '2~', '你这样会失去我的...😢', '好吧...😔', '唔呜呜呜...😭'];
                        let tips = tipsList[Math.min((delIdx1 - 30), tipsList.length - 1)];
                        layer.tips(tips, btn, {tips: [4, '#ff5722']});
                        return;
                    } else if (40 === delIdx1) {
                        // 开始惩罚
                        let timeOut = 3000; // 基础时间
                        let layTipsIdx = layer.tips('祝你幸福！🌟', btn, {tips: [4, '#ff5722'], time: timeOut});
                        // btn.removeClass('spin-element');
                        btn.fadeOut(timeOut);
                        setTimeout(function () {
                            $(`#layui-layer${layTipsIdx}`).fadeOut(timeOut - 1000); // 滞后1s开始，要与btn隐藏同步消失。
                        }, 1000);

                        // 留下遗憾
                        let btnParent = btn.parent();
                        btnParent.append('<span class="lastMsg" style="display: none; width: 100%;">感觉...</span>');


                        // 感觉...
                        setTimeout(function () {
                            btnParent.find('.lastMsg:eq(0)').fadeIn(1000);
                            setTimeout(function () {
                                btnParent.find('.lastMsg:eq(0)').fadeOut(1000);
                            }, 2000);
                        }, timeOut + 1000); // 基础后1s开始

                        // 再也不会快乐了...
                        setTimeout(function () {
                            btnParent.append('<marquee class="lastMsg" loop="1" scrollamount="5" style="display: none; width: 100%;">再也不会快乐了...</marquee>');
                            btnParent.find('.lastMsg:eq(1)').fadeIn(1000);
                            setTimeout(function () {
                                btnParent.find('.lastMsg:eq(1)').fadeOut(1000);
                            }, 2000);
                        }, timeOut + 4000); // 基础后4s开始

                        return;
                    }
                    return;
                }

                if (data.code === editHBInfo.code) {
                    // 全局临时变量
                    let delIdx2 = _temp.delIdx2 = _temp.delIdx2 || 0;
                    _temp.delIdx2++;

                    let tipsList = ['不可以移除正在计算的货币哦~', '不可以哦~'];
                    let tips = tipsList[Math.min(delIdx2++, tipsList.length - 1)];
                    layer.tips(tips, btn, {tips: [4, '#ff5722'], time: 5000});
                    return;
                }

                let del = btn.attr("data-del");
                if (utils.objToBoolean(del)) {
                    obj.del(); // 删除对应行（tr）的 DOM 结构，并更新缓存
                    hbCodeList = hbCodeList.filter(item => item !== data.code);
                    layer.closeAll('tips');

                    // 更新货币下拉
                    let hb999 = $("#hbList option[value=999]");
                    hb999.attr("data-state", "0").text("==== 添加全部 ====");
                    form.render($("#hbList"));

                    // 保存数据
                    saveDB();

                    // 检查彩蛋
                    let delIdx1 = _temp.delIdx1 = _temp.delIdx1 || 0;
                    if (delIdx1 >= 40 && hbCodeList.length === 1) {
                        // 找到仅剩的那个del按钮，彩蛋已死心，按钮变灰，不再调皮
                        let uniqueDel = $("#tableList").next().find('table.layui-table td[data-field="__operation__"] a[lay-event="del"]');
                        uniqueDel.addClass('eggs-off').removeClass('layui-border-red');
                    }
                } else {
                    btn.text("确定");
                    btn.attr("data-del", true);
                    layer.tips('再点一次~', btn, {tips: [4, '#ff5722']});
                    setTimeout(() => {
                        btn.text("移除");
                        btn.attr("data-del", false);
                    }, 3000);
                }
            }
        });
        table.on('tool(tableList1)', function (obj) {
            let data = obj.data; // 得到当前行数据
            let layEvent = obj.event;   // 获得元素对应的 lay-event 属性值
            if (layEvent === 'trend') {
                // 查看汇率历史
                openTrend();
            }
        });

        // 触发排序事件
        table.on('sort(tableList)', function (obj) {
            hbCodeList = table.cache["tableList"].map(d => d.code);
            // 保存数据
            saveDB();
        });

        /**
         * 加载渲染表格
         * @param {number} money 计算指定金额
         */
        function loadTable(money = undefined) {
            if (money) editHBInfo.money = utils.objToFloat(money);

            let data = [];
            // 根据hbCodeList组成所有参与计算的货币信息
            hbCodeList.forEach(hbCode => {
                const hbInfo = hbInfoList.find((item) => item.code === hbCode);
                const rate = utils.objToFloat(RATES[hbInfo.code])
                // 检查货币信息及汇率信息是否正常
                if (!hbInfo || !rate) return false;

                // 折算金额（编辑中的货币不进行计算）
                const resMoney = editHBInfo.code === hbCode ? editHBInfo.money : computeMoney(hbInfo.code);

                // 生成表格数据
                data.push({
                    flag: `./img/svgs/flags/${hbInfo.code.toLowerCase()}.svg`,
                    name: hbInfo.name,
                    code: hbInfo.code,
                    rate: rate,
                    money: resMoney
                })
            });

            // 还原表格排序
            let tableSort = table.getOptions("tableList").initSort;
            if (utils.objIsExist(tableSort)) {
                // console.log(tableSort);
                let field = tableSort.field;
                let type = tableSort.type;

                data.sort(function (a, b) {
                    if (type === 'asc') return a[field] - b[field]; else return b[field] - a[field];
                })
            }

            // 表格赋值
            table.cache['tableList1'] = [data.find((item) => item.code === editHBInfo.code)];
            table.cache['tableList'] = data;

            // 渲染表格
            table.renderData('tableList1');
            table.renderData('tableList');

            // 保存数据
            saveDB();
        }

        /**
         * 刷新汇率
         * @param {function} [callback=undefined] 回调函数
         */
        function refreshRates(callback = undefined) {
            // 初始化临时参数
            _temp.refreshRates = _temp.refreshRates || {timestamp: 0}

            // 先用db数据计算渲染，等ajax回来之后刷新
            let ratesInfo = getPersistentValue('ratesInfo');
            if (ratesInfo) {
                RATES = ratesInfo.rates;
                RATES_TIME = ratesInfo.timestamp;
                $("#rateTimeStr").text(utils.date.tsToDatetime(RATES_TIME, "yyyy/MM/dd HH:mm"));
                editHBInfo.rate = utils.objToFloat(RATES[editHBInfo.code]);
                if (typeof callback === "function") callback();
                // 50s内不请求ajax（接口1min刷新一次汇率信息）
                if (Math.abs(_temp.refreshRates.timestamp - Date.now()) <= 50 * 1000) {
                    // 汇率信息50s以内，跳过下面的更新
                    playConfetti();
                    return;
                }
            }


            // 刷新按钮
            let that = $(".refresh-rate .layui-icon");
            // 已是加载图标，说明ajax正在请求中，避免连点重复请求，检查有load图标则跳过请求
            if (that.hasClass('layui-icon-loading')) return;
            // 动作反馈
            $(that).addClass('layui-icon-loading');


            // 开始请求
            $.ajax({
                url: 'https://www.xe.com/api/protected/midmarket-converter/',
                type: 'get',
                dataType: 'json',
                beforeSend: function (xhr) {
                    xhr.setRequestHeader('Authorization', 'Basic bG9kZXN0YXI6cHVnc25heA==');
                },
                success: function (res) {
                    // console.log(res);
                    _temp.refreshRates.timestamp = Date.now();

                    // 保存旧的汇率信息（预防断网）
                    setPersistentValue('ratesInfo', res);

                    // 动作反馈
                    playConfetti();
                    $(that).addClass('layui-icon-ok');
                    setTimeout(function () {
                        $(that).removeClass('layui-icon-loading').removeClass('layui-icon-ok');
                    }, 3000);

                    // 数据提取
                    RATES = res.rates;
                    RATES_TIME = res.timestamp;
                    $("#rateTimeStr").text(utils.date.tsToDatetime(RATES_TIME, "yyyy/MM/dd HH:mm"));
                    editHBInfo.rate = utils.objToFloat(RATES[editHBInfo.code]);
                    if (typeof callback === "function") callback();
                },
                error: function (xhr, msg, ex) {
                    // 有三个参数：XMLHttpRequest 对象、错误信息、（可选）捕获的异常对象。
                    console.error(msg, ex);
                    $(that).removeClass('layui-icon-loading');
                    layer.msg('实时汇率信息获取失败！', {icon: 5, time: 5000});
                },
                complete: function (xhr, ts) {
                    // 请求完成后回调函数 (请求成功或失败之后均调用)。
                    // 参数： XMLHttpRequest 对象和一个描述请求类型的字符串。
                }

                // 更多参数Doc:https://www.w3school.com.cn/jquery/ajax_ajax.asp
            });

        }

        /**
         * 按汇率计算金额
         * @param hbCode 货币代码
         * @return {number} 返回按汇率计算好的金额
         */
        function computeMoney(hbCode) {
            let rate = utils.objToFloat(RATES[hbCode])
            return utils.objToFloat(editHBInfo.money / editHBInfo.rate * rate);
        }

        /**
         * 获得数据表列
         * @param type 哪个表
         * @return {Array} [[]]
         */
        function getCols(type) {
            let cols = [[
                {type: 'numbers', title: '序号', width: 60}
                , {
                    field: 'flag', title: '国旗标识', width: 90, align: 'center', templet: function (d) {
                        return `<img src="./img/svgs/flags/${(d.code)?.toLowerCase()}.svg"  alt="${d.code}" class="flag" onerror="errorImg(this)">`
                    }
                }
                , {
                    field: 'name', title: '国家名称', templet: function (d) {
                        // 查看介绍
                        return [
                            `<a href="javascript:showIntro('${d.code}', '${d.name}');" title="货币介绍">`,
                            d.name,
                            '<i class="layui-icon layui-icon-read" style="font-size: 14px;color: #1e9fff;"></i>',
                            '</a>'
                        ].join('\n');
                    }
                }
                , {
                    field: 'code', title: '代码', width: 80, align: 'center', templet: function (d) {
                        return `<code>${d.code}</code>`;
                    }
                }
                , {
                    field: 'code', title: '符号', width: 80, align: 'center', templet: function (d) {
                        try {
                            let hbStr = (0.00).toLocaleString("zh-CN", {
                                style: "currency",
                                currency: d.code,
                                minimumFractionDigits: 0,
                                maximumFractionDigits: digit
                            });
                            return `${hbStr.replace(/\d+/, '')}`;
                        } catch (ex) {
                        }

                        return '<span style="color: #aaa;" title="未知符号">无</span>';
                    }
                }
                , {field: 'rate', title: '实时汇率', minWidth: 130, sort: true, hide: true}
                , {
                    field: 'money', title: '折算金额', minWidth: 130, sort: true, edit: 'text', templet: function (d) {
                        try {
                            return d.money.toLocaleString("zh-CN", {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: digit
                            });
                        } catch (e) {
                        }
                        return d.money?.toFixed(20);
                    }
                }
                , {field: '__operation__', title: '操作', width: 80, align: 'center', templet: "#toolEvent"}
            ]];

            if (type === 1) {
                cols[0].find(d => d.title === '实时汇率').sort = false;
                cols[0].find(d => d.title === '折算金额').sort = false;
                cols[0].find(d => d.title === '操作').templet = "#toolOpenTrend";
            }

            return cols;
        }

        /**
         * 保存数据
         */
        function saveDB() {
            setPersistentValue('digit', digit);
            setPersistentValue('hbCodeList', hbCodeList);
            setPersistentValue('editHBInfo', editHBInfo);
            setPersistentValue('ifShowAbandon', ifShowAbandon);
        }

        // 键盘监听
        document.addEventListener('keydown', function (event) {
            // 监听 Ctrl+F、F3 快捷键
            if (event.ctrlKey && event.key.toLowerCase() === 'f' || event.key === 'F3') {
                $('#divHbList .layui-form-select .layui-select-title input').click().select()
            }

        });

        // 赞赏
        $("#btnShang").click(function () {
            const zansangPicSrc = "./img/zanshang.png";
            // 弹赞赏码
            layShowPic(zansangPicSrc, {id: 'zanShang', shade: 0.05, area: ['15rem', '15rem']});
            // 播放彩带
            playConfetti({
                origin: {x: 0.5, y: 0.5}   //从哪里开始发射五彩纸屑，xy比例值（0~1）。
            });
        })

        /*将方法暴露到外部*/
        // 保存数据
        _global.func.saveDB = saveDB;
        // 加载表格
        _global.func.loadTable = loadTable;

    });
});

/**
 * 打开趋势列表
 */
function openTrend() {
    layer.open({
        type: 2, // page 层类型
        area: ['95%', '90%'],
        title: false, // 不显示标题栏
        shade: 0.6, // 遮罩透明度
        closeBtn: 0, // 不显示关闭图标
        shadeClose: true, // 点击遮罩区域，关闭弹层
        anim: 0, // 0-6 的动画形式，-1 不开启
        content: './trend.html',
        success: function (layero) {
            // 设定关闭按钮位置
            $(layero).find(".layui-layer-setwin:eq(0)").css({"right": "30px", "top": "30px"});
            // 弹层的最外层元素的 jQuery 对象
            const iframe = $(layero).find("iframe")[0];
            // 深色模式
            if ($("#darkMode").prop("checked")) {
                $(iframe).contents().find('html,body').addClass("night");
            } else {
                $(iframe).contents().find('html,body').removeClass("night");
            }
            // 将 utools 挂载到 iframe 的 window 对象里，这样 iframe 就也能使用 utools 能力了。
            $(iframe).contentWindow.utools = utools;
        }
    });
}

/**
 * 加载失败图片的处理方法
 * @param img 图片元素this
 */
function errorImg(img) {        //地址错误时，设置默认图片
    let alt = $(img).attr("alt");
    $(img).after(`<span title="国旗未能加载">${alt}</span>`)
    $(img).remove();
}


/**
 * 查看货币介绍
 * @param hbCode 货币编码
 * @param hbName 货币名称
 */
function showIntro(hbCode, hbName) {
    const introCacheKey = `intro_cache_${_global.pluginVersion || 'unknown'}_${hbCode}`;
    let url = `./file/hbIntro/${hbCode}.md`;
    let cachedData = getPersistentValue(introCacheKey);

    if (cachedData && cachedData.htmlContent) {
        openIntroLayer(cachedData.htmlContent);
        return;
    }

    $.ajax({
        url: url,
        type: 'get',
        dataType: 'text',
        success: function (text) {
            text = text + "\n > 资料截止：`2024-08-15`";
            let converter = new showdown.Converter();
            let html = converter.makeHtml(text);
            setPersistentValue(introCacheKey, {
                pluginVersion: _global.pluginVersion || 'unknown',
                mdContent: text,
                htmlContent: html
            });
            openIntroLayer(html);
        },
        error: function (xhr) {
            if (xhr.status === 404) layer.msg('暂无介绍', {icon: 5}); else layer.msg('介绍无法获取', {icon: 2});
        }

        // 更多参数Doc:https://www.w3school.com.cn/jquery/ajax_ajax.asp
    });

    function openIntroLayer(html) {
        layer.closeAll();
        let img = `<img src="./img/svgs/flags/${(hbCode)?.toLowerCase()}.svg" alt="${hbCode}" class="flag" onerror="errorImg(this)">`;
        let title = `${img}　${hbName}(${hbCode})　　—— 货币介绍`;

        let width = $(window).width();
        width = width * (width <= 1300 ? 0.8 : 0.5);
        let height = $(window).height() * 0.8;

        layer.open({
            type: 1,
            maxWidth: width,
            maxHeight: height,
            title: title,
            shadeClose: true, // 点击遮罩区域，关闭弹层
            anim: 2, // 0-6 的动画形式，-1 不开启
            content: `<div class="native-style marker" style="margin: 20px;">${html}</div>`
        });
    }
}

$(function () {
    function utoolsReady() {
        if (typeof utools === 'undefined') {
            setTimeout(utoolsReady, 50);
            return;
        }
        
        // 获取插件版本
        _global.pluginVersion = 'unknown';
        $.ajax({
            url: './plugin.json',
            type: 'get',
            async: false,
            dataType: 'json',
            success: function(data) {
                if (data && data.version) {
                    _global.pluginVersion = data.version;
                }
            },
            error: function(xhr) {
                console.error('无法加载 plugin.json，缓存功能可能受限', xhr);
            }
        });

        /*【uTools窗口初始化】*/
        try {
            /*每当插件从后台进入到前台时，uTools 将会主动调用这个方法。*/
            //Like:https://u.tools/docs/developer/api.html#%E4%BA%8B%E4%BB%B6
            utools.onPluginEnter(({code, type, payload}) => {
                //code：plugin.json 配置的 feature.code
                //type：plugin.json 配置的 feature.cmd.type，可以为 "text"、"img"、 "files"、 "regex"、 "over"、"window"
                //payload：feature.cmd.type 对应匹配的数据
                console.log('用户进入插件', code, type, payload)
                if (type === "regex") {
                    _global.func.loadTable(parseFloat(payload));
                }
            });

            utools.onPluginDetach(() => {
                _global.isDetach = true;
                console.log('插件被分离')
            })

        } catch (e) {
            // 使用 console.error 替代 uToolsUtils.showError
            console.error(e);
        }

    }

    utoolsReady();
});

/**
 * 播放彩带
 * @param {Object} [option={}] 自定义配置
 */
function playConfetti(option = {}) {
    setTimeout(() => {
        let width = $(document).width();
        let height = $(document).height();
        let $btn = $(".refresh-rate .layui-icon");
        let btnOffset = $btn.offset();
        let top = btnOffset.top;
        let left = btnOffset.left;

        // 计算坐标比例
        let y = top / height;
        let x = left / width;
        // 播放彩带
        confetti($.extend({
            particleCount: 100, //要发射的五彩纸屑数量。数量越多越有趣……但要冷静，这里面涉及很多数学知识。
            spread: 360, //五彩纸屑可以偏离中心多远，以度为单位。45 表示五彩纸屑将以定义的angle正负 22.5 度发射。
            origin: {x: x, y: y},   //从哪里开始发射五彩纸屑。如果您愿意，可以随意从屏幕外发射。
            startVelocity: 30,  //五彩纸屑开始飘动的速度，以像素为单位。
            ticks: 40,  //五彩纸屑移动的次数。这是抽象的……但如果五彩纸屑消失得太快，你可以尝试一下。
            gravity: 0 //粒子被拉下的速度。1 表示全重力，0.5 表示半重力，等等，但没有限制。如果您愿意，甚至可以让粒子上升。
        }, option));
    }, 50);
}

function readLocalValue(key) {
    try {
        let raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) return undefined;
        return JSON.parse(raw);
    } catch (e) {
        try {
            return localStorage.getItem(key);
        } catch (localError) {
            return undefined;
        }
    }
}

function getPersistentValue(key, defaultVal = undefined) {
    let data = uToolsUtils.db.get(key);
    if (data !== undefined) return data;

    data = readLocalValue(key);
    if (data !== undefined) {
        try {
            uToolsUtils.db.save(key, data, true);
        } catch (e) {
            // ignore migration errors
        }
        return data;
    }

    return defaultVal;
}

function setPersistentValue(key, value) {
    try {
        uToolsUtils.db.save(key, value, true);
    } catch (e) {
        // ignore db write errors
    }

    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // ignore local fallback errors
    }

    return value;
}


/**
 * 基于layer.open预览图片
 * @param {string} src 图片地址
 * @param {Object} [option={}] 自定义配置
 */
function layShowPic(src, option = {}) {
    const lay1 = layer.open($.extend({
        type: 1, // page 层类型
        title: false,
        btn: false,
        closeBtn: 0,
        shade: 0.6, // 遮罩透明度
        shadeClose: true, // 点击遮罩区域，关闭弹层
        area: ['80%', '80%'],
        success: function (layero) {
            $(layero[0]).find('.layui-layer-content').css("background-color","transparent !important");
            $(layero[0]).css({
                // 去掉layer.open的背景及边框阴影
                "background-color": "transparent",
                "box-shadow": "none",
                "border-radius": "1rem",
                // 设置背景
                "background-image": `url('${src}')`,
                "background-size": "contain",
                "background-repeat": "no-repeat",
                "background-position": "center"
            }).click(function () {
                layer.close(lay1);  //点击则关闭
            });
        }
    }, option))
}
