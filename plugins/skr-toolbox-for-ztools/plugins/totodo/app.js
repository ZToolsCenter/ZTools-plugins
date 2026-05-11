// 简易农历算法 (支持 1900-2100 年)
const lunarInfo = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5d0,0x14573,0x052d0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04bd7,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0];

function getLunar(date) {
    let year = date.getFullYear();
    let month = date.getMonth();
    let day = date.getDate();

    if (year < 1900 || year > 2100) return '';

    let i, leap = 0, temp = 0;
    let offset = (Date.UTC(year, month, day) - Date.UTC(1900, 0, 31)) / 86400000;

    for (i = 1900; i < 2100 && offset > 0; i++) {
        temp = getYearDays(i);
        offset -= temp;
    }

    if (offset < 0) {
        offset += temp;
        i--;
    }

    year = i;
    leap = getLeapMonth(year);
    let isLeap = false;

    for (i = 1; i < 13 && offset > 0; i++) {
        if (leap > 0 && i == (leap + 1) && !isLeap) {
            --i;
            isLeap = true;
            temp = getLeapDays(year);
        } else {
            temp = getMonthDays(year, i);
        }

        if (isLeap && i == (leap + 1)) isLeap = false;

        offset -= temp;
    }

    if (offset == 0 && leap > 0 && i == leap + 1) {
        if (isLeap) isLeap = false;
        else {
            isLeap = true;
            --i;
        }
    }

    if (offset < 0) {
        offset += temp;
        --i;
    }

    month = i;
    day = offset + 1;

    const lunarMonthName = (isLeap ? "闰" : "") + ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"][month - 1] + "月";
    const lunarDayName = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"][day - 1];

    // 优先返回节日，其次节气（暂未实现节气），最后返回日子
    if (day === 1) return lunarMonthName;
    return lunarDayName;
}

function getYearDays(y) {
    let i, sum = 348;
    for (i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
    return (sum + getLeapDays(y));
}

function getLeapDays(y) {
    if (getLeapMonth(y)) return ((lunarInfo[y - 1900] & 0x10000) ? 30 : 29);
    else return (0);
}

function getLeapMonth(y) {
    return (lunarInfo[y - 1900] & 0xf);
}

function getMonthDays(y, m) {
    return ((lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29);
}

// ---------------------------------------------------------

const { createApp, ref, computed, onMounted, toRaw } = Vue;

createApp({
    setup() {
        const currentDate = ref(new Date());
        const selectedDate = ref(new Date());
        const isDrawerOpen = ref(false); 
        const isLeftDrawerOpen = ref(false); // New: Left drawer state
        const isWorkdayMode = ref(true); // Default to Workday mode
        const isSelectionMode = ref(false); // New: Selection mode state
        const reportSelectedDates = ref(new Set()); // Dates selected for report
        const showReportModal = ref(false); // New: Modal state
        const reportPrompt = ref(''); // New: User prompt
        const newTodoText = ref('');
        const allTodos = ref({}); // Map: 'YYYY-MM-DD' -> { _id, _rev, data: [] }
        const todoInput = ref(null);

        const weekdays = computed(() => {
            if (isWorkdayMode.value) {
                return ['一', '二', '三', '四', '五'];
            }
            return ['日', '一', '二', '三', '四', '五', '六'];
        });

        // Helper: Format date to YYYY-MM-DD
        const formatDateKey = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const currentYear = computed(() => currentDate.value.getFullYear());
        const currentMonth = computed(() => currentDate.value.getMonth());

        const calendarDays = computed(() => {
            const year = currentYear.value;
            const month = currentMonth.value;
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            
            const days = [];
            
            // Previous month days
            const firstDayOfWeek = firstDay.getDay(); 
            const prevLastDay = new Date(year, month, 0).getDate();
            
            for (let i = firstDayOfWeek - 1; i >= 0; i--) {
                const d = new Date(year, month - 1, prevLastDay - i);
                days.push({
                    day: prevLastDay - i,
                    date: d,
                    isCurrentMonth: false,
                    lunar: getLunar(d)
                });
            }
            
            // Current month days
            for (let i = 1; i <= lastDay.getDate(); i++) {
                const d = new Date(year, month, i);
                days.push({
                    day: i,
                    date: d,
                    isCurrentMonth: true,
                    lunar: getLunar(d)
                });
            }
            
            // Next month days
            const remaining = 42 - days.length; 
            for (let i = 1; i <= remaining; i++) {
                const d = new Date(year, month + 1, i);
                days.push({
                    day: i,
                    date: d,
                    isCurrentMonth: false,
                    lunar: getLunar(d)
                });
            }

            // Only keep rows that have current month days
            const rows = [];
            for (let i = 0; i < days.length; i += 7) {
                let row = days.slice(i, i + 7);
                
                // Filter if workday mode
                if (isWorkdayMode.value) {
                    // 0 is Sunday, 6 is Saturday
                    row = row.filter(d => {
                        const dayOfWeek = d.date.getDay();
                        return dayOfWeek !== 0 && dayOfWeek !== 6;
                    });
                }
                
                // Only add row if it has days (and logic about current month)
                // Logic: Check if the original full row had current month days
                // If we filter out weekends, we still use the row if it contains days we want to show.
                // But wait, the previous logic was: "rows.push(...row)" which flattens it.
                // If we filter, we should ensure the grid CSS matches the column count.
                
                // Actually, if we filter weekends, the 'row' array will have 5 items instead of 7.
                // We need to push these 5 items.
                
                const originalRow = days.slice(i, i + 7);
                const hasCurrentMonth = originalRow.some(d => d.isCurrentMonth);
                
                if (hasCurrentMonth) {
                    rows.push(...row);
                }
            }
            
            return rows;
        });

        const selectedDateStr = computed(() => formatDateKey(selectedDate.value));

        const currentTodos = computed(() => {
            const key = selectedDateStr.value;
            return allTodos.value[key]?.data || [];
        });

        const uncompletedCount = computed(() => {
            return currentTodos.value.filter(t => !t.done).length;
        });
        
        // Computed property for tree view in left drawer
        const allTodosTree = computed(() => {
            // Convert map to sorted array
            const dates = Object.keys(allTodos.value).sort();
            return dates.map(dateKey => {
                const doc = allTodos.value[dateKey];
                if (!doc || !doc.data || doc.data.length === 0) return null;
                
                // Parse date for display title
                const [y, m, d] = dateKey.split('-');
                
                return {
                    dateKey,
                    title: `${y}年${parseInt(m)}月${parseInt(d)}日`,
                    todos: doc.data
                };
            }).filter(item => item !== null);
        });

        // Methods
        const isToday = (date) => {
            const today = new Date();
            return date.getDate() === today.getDate() &&
                   date.getMonth() === today.getMonth() &&
                   date.getFullYear() === today.getFullYear();
        };

        const isSelected = (date) => {
            return formatDateKey(date) === selectedDateStr.value;
        };

        const selectDate = (date) => {
            selectedDate.value = date;
            isDrawerOpen.value = true; 
            setTimeout(() => {
                if (todoInput.value) todoInput.value.focus();
            }, 0);
        };

        const closeDrawer = () => {
            isDrawerOpen.value = false;
        };

        const toggleLeftDrawer = () => {
            isLeftDrawerOpen.value = !isLeftDrawerOpen.value;
        };
        
        const closeLeftDrawer = () => {
            isLeftDrawerOpen.value = false;
        };
        
        const toggleWorkdayMode = () => {
            isWorkdayMode.value = !isWorkdayMode.value;
        };

        const toggleSelectionMode = () => {
            isSelectionMode.value = !isSelectionMode.value;
            reportSelectedDates.value.clear();
            if (isSelectionMode.value) {
                // Close drawers when entering selection mode
                closeDrawer();
                closeLeftDrawer();
            }
        };

        const isDateSelectedForReport = (date) => {
            return reportSelectedDates.value.has(formatDateKey(date));
        };

        const toggleDateSelection = (date) => {
            const key = formatDateKey(date);
            if (reportSelectedDates.value.has(key)) {
                reportSelectedDates.value.delete(key);
            } else {
                reportSelectedDates.value.add(key);
            }
        };

        const handleDayClick = (date) => {
            if (isSelectionMode.value) {
                toggleDateSelection(date);
            } else {
                selectDate(date);
            }
        };

        const closeReportModal = () => {
            showReportModal.value = false;
            reportPrompt.value = '';
        };

        const generateReport = () => {
            if (reportSelectedDates.value.size === 0) {
                if (typeof utools !== 'undefined') {
                    utools.showNotification('请先选择日期');
                } else {
                    alert('请先选择日期');
                }
                return;
            }
            showReportModal.value = true;
        };

        const confirmGenerateReport = async () => {
            closeReportModal();
            
            // 1. Collect data
            const dates = Array.from(reportSelectedDates.value).sort();
            const reportData = [];
            
            dates.forEach(dateKey => {
                const doc = allTodos.value[dateKey];
                if (doc && doc.data && doc.data.length > 0) {
                    reportData.push({
                        date: dateKey,
                        todos: doc.data
                    });
                }
            });

            if (reportData.length === 0) {
                if (typeof utools !== 'undefined') {
                    utools.showNotification('选中的日期没有待办事项');
                }
                return;
            }

            // 2. Select save location
            if (typeof utools !== 'undefined') {
                const savePaths = utools.showOpenDialog({
                    title: '选择保存位置',
                    properties: ['openDirectory']
                });

                if (!savePaths || savePaths.length === 0) return;
                
                const saveDir = savePaths[0];
                const fileName = `待办周报_${dates[0]}_${dates[dates.length - 1]}.md`;
                const filePath = window.preload.pathJoin(saveDir, fileName);

                // 3. Prepare AI Prompt
                const userRequirement = reportPrompt.value || "请总结待办事项完成情况，并给出改进建议。";
                const systemPrompt = "你是一个智能助手，帮助用户总结待办事项周报。请根据用户提供的数据，生成一份详细的周报，包含整体表现、完成率、未完成任务分析及建议。请务必包含一个 Mermaid 流程图（graph TD）来展示任务状态或流程。请使用Markdown格式输出。";
                
                const dataContext = {
                    requirement: userRequirement,
                    date_range: `${dates[0]} 至 ${dates[dates.length - 1]}`,
                    todos: reportData
                };

                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(dataContext) }
                ];

                // 4. Call uTools AI
                try {
                    utools.showNotification('AI 正在生成报告，请稍候...');
                    
                    // First, try to get available models
                    const models = await utools.allAiModels();
                    if (!models || models.length === 0) {
                        throw new Error('未找到可用的 AI 模型，请在 uTools 设置中配置 AI 模型');
                    }
                    
                    // Use the first available model if not specified, or let uTools handle default
                    // Note: utools.ai optional model param.
                    
                    const aiResponse = await utools.ai({ 
                        messages: messages
                        // model: models[0].id // Optional: specify model if needed
                    });
                    
                    const aiContent = aiResponse ? aiResponse.content : '';

                    if (!aiContent) {
                        throw new Error('AI 未返回内容');
                    }

                    let content = `# AI 智能总结报告\n\n`;
                    content += `> 生成时间：${new Date().toLocaleString()}\n`;
                    content += `> **用户要求**：${userRequirement}\n\n`;
                    content += `## 🤖 AI 分析\n\n`;
                    content += aiContent;
                    content += `\n\n---\n\n`;
                    content += `## 📝 原始数据\n`;
                    content += `\`\`\`json\n${JSON.stringify(dataContext, null, 2)}\n\`\`\`\n`;

                    // 5. Save File
                    const result = window.preload.saveFile(filePath, content);
                    if (result.success) {
                        utools.showNotification(`AI 报告已生成: ${filePath}`);
                        utools.shellShowItemInFolder(filePath);
                        toggleSelectionMode(); // Exit selection mode
                    } else {
                        utools.showNotification(`保存失败: ${result.error}`);
                    }

                } catch (e) {
                    console.error('AI generation failed:', e);
                    const errorMsg = e.message || '未知错误';
                    utools.showNotification(`生成失败: ${errorMsg}`);
                    if (errorMsg.includes('未找到可用的 AI 模型')) {
                        utools.redirectAiModelsSetting();
                    }
                }
            }
        };

        const jumpToDate = (dateKey) => {
            const [y, m, d] = dateKey.split('-').map(Number);
            const newDate = new Date(y, m - 1, d);
            currentDate.value = new Date(y, m - 1, 1); // Switch calendar view to that month
            selectedDate.value = newDate;
            isDrawerOpen.value = true; // Open right drawer to show details
            isLeftDrawerOpen.value = false; // Close left drawer
        };

        const prevMonth = () => {
            currentDate.value = new Date(currentYear.value, currentMonth.value - 1, 1);
        };

        const nextMonth = () => {
            currentDate.value = new Date(currentYear.value, currentMonth.value + 1, 1);
        };

        const goToToday = () => {
            const today = new Date();
            currentDate.value = today;
            selectedDate.value = today;
        };

        const formatDate = (date) => {
            return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
        };

        const getTodosForDate = (date) => {
            const key = formatDateKey(date);
            return allTodos.value[key]?.data || [];
        };

        const loadAllTodos = () => {
            if (typeof utools === 'undefined') return;
            
            try {
                const docs = utools.db.allDocs('todo/');
                const map = {};
                docs.forEach(doc => {
                    const dateKey = doc._id.replace('todo/', '');
                    map[dateKey] = doc;
                });
                allTodos.value = map;
            } catch (e) {
                console.error('Failed to load todos:', e);
            }
        };

        const saveTodos = () => {
            if (typeof utools === 'undefined') return;
            const key = selectedDateStr.value;
            saveTodosByKey(key);
        };

        const saveTodosByKey = (key) => {
            if (typeof utools === 'undefined') return;
            
            const id = `todo/${key}`;
            const doc = allTodos.value[key];
            
            if (!doc) return; 

            const rawDoc = toRaw(doc);
            
            const result = utools.db.put(rawDoc);
            if (result.ok) {
                doc._rev = result.rev;
            } else {
                console.error('Save failed', result);
                loadAllTodos();
            }
        };

        const saveTodoStatus = (date) => {
            const key = formatDateKey(date);
            saveTodosByKey(key);
        };
        
        // Save todo status from left drawer tree view (by date string)
        const saveTodoStatusByDateKey = (dateKey) => {
            saveTodosByKey(dateKey);
        };

        const toggleTodoAndSave = (todo, date) => {
            todo.done = !todo.done;
            saveTodoStatus(date);
        };

        const addTodoItem = (text, date) => {
            if (!text) return;
            const key = formatDateKey(date);
            
            if (!allTodos.value[key]) {
                allTodos.value[key] = {
                    _id: `todo/${key}`,
                    data: []
                };
            }

            allTodos.value[key].data.push({
                text: text,
                done: false,
                created: Date.now()
            });

            saveTodosByKey(key);
        };

        const addTodo = () => {
            const text = newTodoText.value.trim();
            if (!text) return;

            addTodoItem(text, selectedDate.value);
            newTodoText.value = '';
        };

        const deleteTodo = (index) => {
            const key = selectedDateStr.value;
            if (allTodos.value[key]) {
                allTodos.value[key].data.splice(index, 1);
                saveTodos();
            }
        };

        onMounted(() => {
            loadAllTodos();
            
            if (typeof utools !== 'undefined') {
                utools.onPluginEnter(({ code, type, payload }) => {
                    console.log('Plugin Enter', code, type, payload);
                    
                    if (code === 'add_from_selection' && (type === 'over' || type === 'regex')) {
                        const today = new Date();
                        // payload is the text content when type is 'over' or 'regex' (simple match)
                        // Actually for 'over', payload is the text string.
                        addTodoItem(payload, today);
                        
                        // Switch view to today to show the new item
                        currentDate.value = today;
                        selectedDate.value = today;
                        
                        utools.showNotification('已添加待办事项：' + (payload.length > 20 ? payload.slice(0, 20) + '...' : payload));
                    }
                    
                    loadAllTodos();
                    // Always ensure we are at least looking at relevant data, 
                    // but if user manually navigated, maybe don't reset?
                    // For now, keep existing behavior or the specific behavior for text add.
                    if (code === 'totodo') {
                        goToToday();
                    }
                });
            }
        });

        return {
            currentDate,
            selectedDate,
            isDrawerOpen,
            isLeftDrawerOpen, 
            isWorkdayMode, 
            isSelectionMode, 
            showReportModal, // Export
            reportPrompt, // Export
            currentYear,
            currentMonth,
            weekdays,
            calendarDays,
            selectedDateStr,
            currentTodos,
            uncompletedCount,
            allTodosTree, 
            newTodoText,
            todoInput,
            
            prevMonth,
            nextMonth,
            goToToday,
            toggleWorkdayMode, 
            toggleSelectionMode, 
            generateReport, 
            confirmGenerateReport, // Export
            closeReportModal, // Export
            handleDayClick, 
            isDateSelectedForReport, 
            isToday,
            isSelected,
            selectDate,
            closeDrawer,
            toggleLeftDrawer, 
            closeLeftDrawer, 
            jumpToDate, 
            formatDate,
            getTodosForDate,
            addTodo,
            saveTodos,
            saveTodoStatus,
            saveTodoStatusByDateKey, 
            toggleTodoAndSave, // Export
            deleteTodo
        };
    }
}).mount('#app');