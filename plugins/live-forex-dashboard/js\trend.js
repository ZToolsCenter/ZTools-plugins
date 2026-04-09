$(function () {
    let hbInfoList = [];
    let hbCodeList = top.uToolsUtils.db.get('hbCodeList', ['CNY']);
    const editHBInfo = top.uToolsUtils.db.get('editHBInfo', {code: 'CNY', name: '中国人民币', money: 1, rate: 0});
    const editHBName = editHBInfo.name;
    const editHBCode = editHBInfo.code;
    const editHBMoney = editHBInfo.money;
    const editHBRate = editHBInfo.rate;
    const ifShowAbandon = top.uToolsUtils.db.get('ifShowAbandon', false);
    $.ajaxSettings.async = false;   // 同步ajax
    // 读取上次是黑暗 或uTools是黑暗
    let isNight = uToolsUtils.db.get('isNight', false);
    if (isNight || uToolsUtils.window.isDarkColors()) {
        $("#darkMode").prop("checked", true);
        $('html,body').addClass("night");
    }


    let allHistoryRatesList = JSON.parse(top.$("#allHistoryRatesList").val());

    layui.use(['layer'], function () {
        // 加载货币信息
        layer.load(0);
        loadInfo().then(() => {
            layer.closeAll('loading'); // 关闭所有的加载层
            renderingList();
        });


        // 单元格获取焦点事件
        $(document).on('click', '#trend-list .layui-row:not(:first-child)', function (event) {
            let hbCode = $(this).attr("data-hbCode");

            // 请求最新历史汇率
            getHistoryRatesInfo(editHBCode, hbCode).then(ratesInfo => {
                console.log(ratesInfo)
                const {hbName, period, ratesList, lastRates, datetime} = ratesInfo;
                const {increaseRate, xAxisData, yAxisData} = filterRatesList(ratesList);

                let chartId = `chart${hbCode}Popup`;
                let bigChartHtml = `
                    <div class="chart-title-box">
                        <!-- title -->
                        <div class="chart-title">
                            <span class="text">${editHBCode} 兑 ${hbCode} 图表</span>
                            <span class="increase-rate ${(increaseRate >= 0 ? 'up' : 'down')}">${increaseRate >= 0 ? '+' : ''}${utils.math.round(increaseRate, 2)}%</span>
                            <span class="year">(${period})</span>
                            <div class="chart-title-right">
                                <span class="ratio">1 ${editHBCode} = ${utils.math.round(lastRates, 6)} ${hbCode}</span>
                                <span class="update-time">${utils.date.format(datetime, 'yyyy年MM月dd日 HH:mm UTC')}</span>
                            </div>
                        </div>
                        <!-- subtitle -->
                        <div class="chart-subtitle">
                            <span class="text">将 ${editHBName} 转换为 ${hbName}</span>
                        </div>
                        <!-- period-box -->
                        <div class="period-box" data-chartId="${chartId}" data-hbCode="${hbCode}">
                            <span>12H</span>
                            <span>1D</span>
                            <span>1W</span>
                            <span>1M</span>
                            <span class="selected">1Y</span>
                            <span>2Y</span>
                            <span>5Y</span>
                            <span>10Y</span>
                        </div>
                    </div>`;

                bigChartHtml += `<div class="chart" id="${chartId}" style="width: 100%; height: calc(90% - 80px);"></div>`;
                // 在此处输入 layer 的任意代码
                layer.open({
                    type: 1,
                    area: ['100%', '90%'],
                    title: false, // 不显示标题栏
                    // closeBtn: 0,
                    shade: 0.6, // 遮罩透明度
                    shadeClose: true, // 点击遮罩区域，关闭弹层
                    anim: 0, // 0-6 的动画形式，-1 不开启
                    scrollbar: false,   // 浏览器滚动条已暂时屏蔽，关闭弹层后自动恢复
                    content: bigChartHtml,
                    success: function (layero, index, that) {
                        // 设定关闭按钮位置
                        $(layero).find(".layui-layer-setwin:eq(0)").css({"right": "30px", "top": "30px"});
                        // 渲染大图
                        loadBigChart(chartId, xAxisData, yAxisData);
                    }
                });
            });
        });

        $(document).on('click', '.period-box', 'span', function (event) {
            const span = $(event.target);
            const hbCode = $(span).parent('.period-box').attr("data-hbCode");
            const chartId = $(span).parent('.period-box').attr("data-chartId");
            const periodStr = $(span).text();

            $(span).parent('.period-box').find('span').removeClass('selected');
            $(span).addClass('selected');

            // 请求最新历史汇率
            getHistoryRatesInfo(editHBCode, hbCode, periodStr).then(ratesInfo => {
                const {ratesList, lastRates, datetime} = ratesInfo;

                const {increaseRate, xAxisData, yAxisData} = filterRatesList(ratesList, periodStr);
                console.log(xAxisData, yAxisData)

                // 更改页面参数
                $(".chart-title-box .chart-title .year").text(`(${periodStr})`);
                $(".chart-title-box .chart-title .chart-title-right .ratio").text(`1 ${editHBCode} = ${utils.math.round(lastRates, 6)} ${hbCode}`);
                $(".chart-title-box .chart-title .chart-title-right .update-time").text(`${utils.date.format(datetime, 'yyyy年MM月dd日 HH:mm UTC')}`);

                const elemIncreaseRate = $(".chart-title-box .chart-title .increase-rate");
                if (increaseRate >= 0) {
                    elemIncreaseRate.removeClass('down').addClass('up');
                    elemIncreaseRate.text(`+${utils.math.round(increaseRate, 2)}%`);
                } else {
                    elemIncreaseRate.removeClass('up').addClass('down');
                    elemIncreaseRate.text(`${utils.math.round(increaseRate, 2)}%`);
                }

                // 渲染大图
                loadBigChart(chartId, xAxisData, yAxisData);
            });
        });

        /**渲染列表*/
        function renderingList() {
            $("#trend-list").empty();
            hbCodeList.forEach((hbCode, idx) => {
                const isEditHB = (hbCode === editHBCode);  // 当前循环是基准货币
                const hbInfo = hbInfoList.find((item) => item.code === hbCode);
                const hbName = hbInfo.name;
                const chartId = `chart${hbCode}`;
                const rowId = `row${hbCode}`;


                if (isEditHB) {
                    // 是基准货币，直接输出第一行
                    let row = `
                        <div class="layui-row" id="${rowId}" data-hbCode="${hbCode}">
                            <!-- 国旗、货币名称 -->
                            <div class="layui-col-xs3">
                                <img src="./img/svgs/flags/${hbCode}.svg" alt="${hbCode}" class="flag">
                                <span class="name">${hbName}</span>
                            </div>
                            <!-- 金额 -->
                            <div class="layui-col-xs3">1</div>
                            <!-- 变动（24小时） -->
                            <div class="layui-col-xs3"></div>
                            <!-- 图标（24小时） -->
                            <div class="layui-col-xs3">
                                <div class="chart" id="${chartId}"></div>
                            </div>
                        </div>`;

                    // 将基准货币置入列表内部开头
                    $("#trend-list").prepend(row);
                }
                // 不是基准货币
                else {
                    console.log(allHistoryRatesList)
                    // 从记录中查找当前货币
                    const ratesInfo = allHistoryRatesList.find(item => item.from === editHBCode && item.to === hbCode && item.isLongTerm === false);

                    // 列表仅用12H的数据
                    const ratesList_12H = filterRatesList(ratesInfo.ratesList, '12H');
                    console.log('12H结果', ratesList_12H);
                    const chartData = ratesList_12H.dataList || [];
                    const lastData = chartData[chartData.length - 1] || {};
                    // 拆分结果
                    const lastRates = lastData.rates || 0;
                    const increaseRate = ratesList_12H.increaseRate || 0;
                    const xAxisData = ratesList_12H.xAxisData || [];
                    const yAxisData = ratesList_12H.yAxisData || [];

                    let row = `
                        <div class="layui-row" id="${rowId}" data-hbCode="${hbCode}" style="margin-left: -2100px;">
                            <!-- 国旗、货币名称 -->
                            <div class="layui-col-xs3">
                                <img src="./img/svgs/flags/${hbCode}.svg" alt="${hbCode}" class="flag">
                                <span class="name">${hbName}</span>
                            </div>
                            <!-- 金额 -->
                            <div class="layui-col-xs3">
                                ${utils.math.round(lastRates, 6)}  
                            </div>
                            <!-- 变动（24小时） -->
                            <div class="layui-col-xs3">
                                <span class="increase-rate ${increaseRate >= 0 ? 'up' : 'down'}" title="${increaseRate}%">${increaseRate >= 0 ? '+' : ''}${utils.math.round(increaseRate, 4)}%</span> 
                            </div>
                            <!-- 图标（24小时） -->
                            <div class="layui-col-xs3">
                                <div class="chart" id="${chartId}" style="width:170px; height:50px; margin-top: 15px;"></div>
                            </div>
                        </div>`;

                    // 将货币置入列表内部结尾
                    $("#trend-list").append(row);

                    // 逐条延迟加载
                    setTimeout(function () {
                        // 动画入场
                        $(`#${rowId}`).animate({'margin-left': '0'}, 200, 'linear', function () {
                                // 渲染列表chart
                                loadChart(chartId, xAxisData, yAxisData);
                            }
                        );
                    }, (100 * idx));

                }
            });
        }

        async function loadInfo() {
            return new Promise((resolve, reject) => {
                // 加载货币信息（同步加载）
                $.ajaxSettings.async = false;
                $.getJSON("./file/hbInfo.json", {}, (json) => {
                    hbInfoList = json;
                });
                $.ajaxSettings.async = true;


                // 异步获取所有选中货币的历史汇率
                hbCodeList.forEach(hbCode => {
                    getHistoryRatesInfo(editHBCode, hbCode).then(() => {
                        if (allHistoryRatesList.length >= hbCodeList.length) {
                            resolve(); // 解决Promise
                        }
                    })
                });

            });
        }

        /**
         * 获取历史汇率
         * @param {string} from from货币（editHBCode）
         * @param {string} to to货币（hbCode）
         * @param {string} period 时段
         * @return Promise<>
         */
        function getHistoryRatesInfo(from, to, period = '1Y') {
            return new Promise((resolve, reject) => {
                // 规整时段参数
                period = ['12H', '1D', '1W', '1M', '1Y', '2Y', '5Y', '10Y'].includes(period) ? period : '1Y';

                // 整理汇率数据
                let ratesInfo = {};
                // 2Y 5Y 10Y 为长期数据
                const isLongTerm = ['2Y', '5Y', '10Y'].includes(period);
                const hbInfo = hbInfoList.find((item) => item.code === to);
                const hbCode = hbInfo.code;
                const hbName = hbInfo.name;

                // 检查变量缓存是否存在符合条件的数据，有就返回，反正重新请求接口查询历史汇率数据
                const ratesData = allHistoryRatesList.find(item => item.from === editHBCode && item.to === hbCode && item.isLongTerm === isLongTerm);
                if (utils.objIsExist(ratesData)) {
                    resolve(ratesData);
                    return;
                }

                // 请求参数
                const ajaxData = {fromCurrency: from, toCurrency: to, crypto: true};
                // 是否需要isExtended属性
                if (isLongTerm) ajaxData.isExtended = true;

                // 开始请求
                $.ajax({
                    url: 'https://www.xe.com/api/protected/charting-rates/',
                    data: ajaxData,
                    type: 'get',
                    dataType: 'json',
                    beforeSend: function (xhr) {
                        xhr.setRequestHeader('Authorization', 'Basic bG9kZXN0YXI6cHVnc25heA==');
                    },
                    success: function (res) {
                        // 整理汇率数据
                        const ratesList = finishingRatesList(res);
                        console.log('汇率整理结果', ratesList);

                        // 将获取到的汇率信息全部存起来
                        const xAxisData = ratesList.map(d => d.datetime);
                        const yAxisData = ratesList.map(d => d.rates);
                        const lastRates = (ratesList[ratesList.length - 1] || {}).rates || 0;
                        const datetime = new Date(res.timestamp);
                        ratesInfo = {
                            from: from, // 基础货币
                            to: to,     // 目标货币
                            hbName: hbName, // 目标货币名称
                            period: period, // 数据周期（1Y、10Y）
                            isLongTerm: isLongTerm, // 是否长期数据（10Y）
                            ratesList: ratesList,   // 汇率列表
                            lastRates: lastRates,   // 最新汇率
                            xAxisData: xAxisData,   // x轴数据
                            yAxisData: yAxisData,   // y轴数据
                            datetime: datetime      // 数据刷新时间
                        };
                        pushAllHistoryRatesList(ratesInfo);

                        // 解决
                        resolve(ratesInfo);
                    },
                    error: function (xhr, msg, ex) {
                        // 有三个参数：XMLHttpRequest 对象、错误信息、（可选）捕获的异常对象。
                        console.error(msg, ex);
                        layer.msg('实时汇率信息获取失败！', {icon: 5, time: 5000});
                    },
                    complete: function (xhr, ts) {
                        // 请求完成后回调函数 (请求成功或失败之后均调用)。
                        // 参数： XMLHttpRequest 对象和一个描述请求类型的字符串。
                    }

                    // 更多参数Doc:https://www.w3school.com.cn/jquery/ajax_ajax.asp
                });
            });


            /**
             * 整理汇率数据列表
             * @param res 接口数据源
             */
            function finishingRatesList(res) {
                let resList = [];

                /* resList = [
                    {datetime: new Date(), rates: 0.7}
                ] */

                const batchList = res.batchList;

                /*[
                    {
                        "startTime": 1731211800000, // 批次开始时间
                        "interval": 600000,         // 步进时间
                        "rates": [
                            0.6267745147374685,     // 第一个为汇率差值，可能用于计算汇率涨跌百分比的
                            0.7660764540655727,     // 从第二个开始，减去第一个差值后 成为真正的汇率数据
                            0.766076063944055,
                            ....
                        ]
                    },{
                        "startTime": 1731380460000,
                        "interval": 60000,
                        "rates": [
                            0.9793130399071855,
                            1.1176104046100674,
                            1.117616827832844,
                        ]
                    }
                ]*/

                batchList.forEach((batch) => {
                    // startTime：批次开始时间
                    // interval：时间步进值
                    // rates：汇率列表
                    const {startTime, interval, rates} = batch;

                    let diff = 0;   // 差值
                    rates.forEach((rate, idx) => {
                        // 每一组的第一个值是汇率偏差，可能用于计算涨跌百分比的。需要将其记下，后续还原实际汇率要用的。
                        // 另外，记录是按照固定的步进时间推动的，每组的第一个偏差值，不占步进值。所以在计算时间的时候，需要将步进值减1.
                        if (idx === 0) {
                            diff = rate;
                            return;
                        }

                        const datetime = new Date(startTime + interval * (idx - 1));    // 将步进值减1
                        resList.push({
                            // datetime: utils.date.tsToDatetime(datetime),
                            datetime: utils.date.format(datetime, "yyyy/MM/dd HH:mm"),
                            rates: (rate - diff)
                        });
                    })
                });

                return resList;
            }

        }


        /**
         * 过滤时段数据
         * @param {Array} parsedData 数据列表
         * @param {string} period 时段
         * @return {*|*[]}
         */
        function filterRatesList(parsedData, period = '1Y') {
            const now = new Date();
            let duration;

            switch (period) {
                case '12H':
                    duration = 12 * 60 * 60 * 1000;
                    break;
                case '1D':
                    duration = 24 * 60 * 60 * 1000;
                    break;
                case '1W':
                    duration = 7 * 24 * 60 * 60 * 1000;
                    break;
                case '1M':
                    duration = 30 * 24 * 60 * 60 * 1000;
                    break;
                case '1Y':
                    duration = 365 * 24 * 60 * 60 * 1000;
                    break;
                case '2Y':
                    duration = 2 * 365 * 24 * 60 * 60 * 1000;
                    break;
                case '5Y':
                    duration = 5 * 365 * 24 * 60 * 60 * 1000;
                    break;
                case '10Y':
                    duration = 10 * 365 * 24 * 60 * 60 * 1000;
                    break;
                default:
                    return [];
            }

            // 筛选相应时段的数据
            let dataList = [];
            if (utils.objIsExist(parsedData)) {
                dataList = parsedData.filter(item => {
                    return now - new Date(item.datetime) <= duration;
                });
            }

            // 计算涨幅百分比：
            // 1、获取时间段第一个汇率，设为汇率A（最旧汇率）
            // 2、获取时间段最后一个汇率，设为汇率B（最新汇率）
            // 3、涨幅百分比计算公式为：((汇率B - 汇率A) / 汇率A) × 100
            let increaseRate = 0;
            if (utils.objIsExist(dataList) && dataList.length >= 2) {
                let first = dataList[0];
                let last = dataList[dataList.length - 1];
                increaseRate = ((last.rates - first.rates) / first.rates) * 100;
            }

            // 提取chart数据
            const xAxisData = dataList.map(d => d.datetime);
            const yAxisData = dataList.map(d => d.rates);

            // 返回结果
            return {dataList: dataList, increaseRate: increaseRate, xAxisData: xAxisData, yAxisData: yAxisData};
        }

    });


    function pushAllHistoryRatesList(data) {
        allHistoryRatesList.push(data);
        top.$("#allHistoryRatesList").val(JSON.stringify(allHistoryRatesList));
    }
});

/**
 * 渲染 Echarts 大图
 * @param {String} eleId 绑定原始id
 * @param {Array} xAxisData X轴数据
 * @param {Array} yAxisData Y轴数据
 */
function loadBigChart(eleId, xAxisData, yAxisData) {
    // 渲染大图，自定义Echarts参数
    loadChart(eleId, xAxisData, yAxisData, {
        grid: {left: '80px', right: '90px', top: '10px', bottom: '80px'},
        xAxis: {show: true},
        yAxis: {show: true},
        dataZoom: [{type: 'inside'}, {
            type: 'slider',
            labelFormatter: function (value, valueStr) {
                const f = valueStr.split(' ')[0];
                const l = valueStr.split(' ')[1];
                return f + '\n' + l;
            }
        }]
    });
}

/**
 * 渲染 Echarts
 * @param {String} eleId 绑定原始id
 * @param {Array} xAxisData X轴数据
 * @param {Array} yAxisData Y轴数据
 * @param {Object} op 自定义Echarts参数
 */
function loadChart(eleId, xAxisData, yAxisData, op = {}) {
    // console.log(xAxisData, yAxisData)

    // 基于准备好的dom，初始化echarts实例
    let myChart = echarts.init(document.getElementById(eleId));

    // 指定图表的配置项和数据
    let option = {
        tooltip: {
            trigger: 'axis',
            formatter: (params) => {
                if (utils.objIsExist(params)) {
                    let name = params[0].name;
                    let value = params[0].value;

                    // 自定义样式
                    let content = '';
                    content += '<div style="';
                    content += 'font-family: \'黑体\', \'SimSun\', Arial, sans-serif;';
                    content += 'font-weight: bolder;';
                    content += 'text-align: center;';
                    content += 'border-radius: 5px;';
                    content += '">';
                    // name
                    content += '<span class="layui-badge layui-bg-cyan">';
                    content += name;
                    content += '</span>';
                    content += '<br>';
                    // value
                    content += '<span>';
                    content += value;
                    content += '</span>';
                    content += '</div>';

                    return content;
                }
            }
        },
        grid: {
            left: 3,
            right: 0,
            top: 3,
            bottom: 0
        },
        xAxis: {
            show: false,
            type: 'category',
            // 坐标轴刻度标签的相关设置
            axisLabel: {
                formatter: function (value, index) {
                    let dateObj = utils.date.objToDatetime(value);
                    let dateStr = utils.date.format(dateObj, 'yyyy/MM/dd \n HH:mm:ss')
                    return dateStr;
                }
            },
            data: xAxisData
        },
        yAxis: {
            show: false,
            type: 'value',
            min: 'dataMin', //取最小值为最小刻度
            max: 'dataMax', //取最大值为最大刻度
            // 坐标轴刻度标签的相关设置
            axisLabel: {
                formatter: function (value, index) {
                    return value.toFixed(4);    // y坐标保留2位小数
                }
            }
        },
        series: [
            {
                data: yAxisData,
                type: 'line',
                smooth: true
            }
        ]
    };

    // 合并参数配置
    $.extend(true, option, op);

    // console.log(JSON.stringify(option))

    // 使用刚指定的配置项和数据显示图表。
    myChart.setOption(option);
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
 * 按汇率计算金额
 * @param hbCode 货币代码
 * @return {number} 返回按汇率计算好的金额
 */
function computeMoney(from, to, from_rate) {
    let rate = utils.objToFloat(to)
    return utils.objToFloat(from / from_rate * rate);
}
