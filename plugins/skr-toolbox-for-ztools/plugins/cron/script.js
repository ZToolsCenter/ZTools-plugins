// Custom Cron Parser for calculating next execution times
class SimpleCronParser {
    constructor(cronExpression, version = 'quartz') {
        this.expression = cronExpression.trim();
        this.parts = this.expression.split(/\s+/);
        this.version = version;

        // Validate field count based on version
        if (version === 'linux' && this.parts.length !== 5) {
            throw new Error('Linux cron requires 5 fields');
        } else if (version === 'spring' && this.parts.length !== 6) {
            throw new Error('Spring cron requires 6 fields');
        } else if (version === 'quartz' && (this.parts.length < 6 || this.parts.length > 7)) {
            throw new Error('Quartz cron requires 6-7 fields');
        }

        // Map fields based on version
        if (version === 'linux') {
            // Linux: minute hour day month day-of-week
            this.seconds = '0'; // Always 0 for Linux
            this.minutes = this.parts[0];
            this.hours = this.parts[1];
            this.dayOfMonth = this.parts[2];
            this.month = this.parts[3];
            this.dayOfWeek = this.parts[4];
            this.year = '*';
        } else if (version === 'spring') {
            // Spring: second minute hour day month day-of-week
            this.seconds = this.parts[0];
            this.minutes = this.parts[1];
            this.hours = this.parts[2];
            this.dayOfMonth = this.parts[3];
            this.month = this.parts[4];
            this.dayOfWeek = this.parts[5];
            this.year = '*';
        } else {
            // Quartz: second minute hour day month day-of-week [year]
            this.seconds = this.parts[0];
            this.minutes = this.parts[1];
            this.hours = this.parts[2];
            this.dayOfMonth = this.parts[3];
            this.month = this.parts[4];
            this.dayOfWeek = this.parts[5];
            this.year = this.parts.length === 7 ? this.parts[6] : '*';
        }
    }

    getNextExecutions(count = 3, startDate = new Date()) {
        const results = [];
        let current = new Date(startDate);
        current.setMilliseconds(0);

        // Move to next second to start searching
        current.setSeconds(current.getSeconds() + 1);

        let attempts = 0;
        const maxAttempts = 100000; // Increased to handle complex expressions

        while (results.length < count && attempts < maxAttempts) {
            if (this.matches(current)) {
                results.push(new Date(current));
                current.setSeconds(current.getSeconds() + 1);
            } else {
                // Increment by the smallest unit that doesn't match
                this.incrementToNextMatch(current);
            }
            attempts++;
        }

        return results;
    }

    matches(date) {
        return this.matchesPart(this.seconds, date.getSeconds(), 0, 59) &&
            this.matchesPart(this.minutes, date.getMinutes(), 0, 59) &&
            this.matchesPart(this.hours, date.getHours(), 0, 23) &&
            this.matchesDayOfMonth(date) &&
            this.matchesPart(this.month, date.getMonth() + 1, 1, 12) &&
            this.matchesDayOfWeek(date) &&
            this.matchesYear(date);
    }

    matchesPart(part, value, min, max) {
        if (part === '*' || part === '?') return true;

        // Handle comma-separated values
        if (part.includes(',')) {
            return part.split(',').some(p => this.matchesPart(p.trim(), value, min, max));
        }

        // Handle ranges (e.g., 1-5)
        if (part.includes('-') && !part.includes('/')) {
            const [start, end] = part.split('-').map(Number);
            return value >= start && value <= end;
        }

        // Handle step values (e.g., */5 or 0/5)
        if (part.includes('/')) {
            const [base, step] = part.split('/');
            const stepNum = Number(step);
            if (base === '*') {
                return value % stepNum === 0;
            } else {
                const baseNum = Number(base);
                return value >= baseNum && (value - baseNum) % stepNum === 0;
            }
        }

        // Handle single value
        return Number(part) === value;
    }

    matchesDayOfMonth(date) {
        const part = this.dayOfMonth;
        if (part === '?' || part === '*') return true;

        const day = date.getDate();

        // Handle 'L' (last day of month)
        if (part === 'L') {
            const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            return day === lastDay;
        }

        // Handle 'W' (nearest weekday)
        if (part.includes('W')) {
            // Simplified: just check the day number
            const targetDay = Number(part.replace('W', ''));
            return day === targetDay;
        }

        return this.matchesPart(part, day, 1, 31);
    }

    matchesDayOfWeek(date) {
        const part = this.dayOfWeek;
        if (part === '?' || part === '*') return true;

        let dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

        // Convert to cron format (1 = Sunday, 7 = Saturday)
        dayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;

        // Handle 'L' (last occurrence of day in month)
        if (part.includes('L')) {
            const targetDay = Number(part.replace('L', ''));
            return dayOfWeek === targetDay;
        }

        // Handle '#' (nth occurrence of day in month)
        if (part.includes('#')) {
            const [day, week] = part.split('#').map(Number);
            return dayOfWeek === day;
        }

        return this.matchesPart(part, dayOfWeek, 1, 7);
    }

    matchesYear(date) {
        if (this.year === '*' || this.year === '') return true;
        return this.matchesPart(this.year, date.getFullYear(), 2020, 2099);
    }

    incrementToNextMatch(date) {
        // Intelligent increment strategy to skip to next possible match
        // This dramatically improves performance for expressions with specific days/months/years

        // Try incrementing by different units in order of efficiency
        if (!this.matchesYear(date)) {
            // Skip to next year
            date.setFullYear(date.getFullYear() + 1);
            date.setMonth(0);
            date.setDate(1);
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);
            return;
        }

        if (!this.matchesPart(this.month, date.getMonth() + 1, 1, 12)) {
            // Skip to next month
            date.setMonth(date.getMonth() + 1);
            date.setDate(1);
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);
            return;
        }

        if (!this.matchesDayOfMonth(date) || !this.matchesDayOfWeek(date)) {
            // Skip to next day
            date.setDate(date.getDate() + 1);
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);
            return;
        }

        if (!this.matchesPart(this.hours, date.getHours(), 0, 23)) {
            // Skip to next hour
            date.setHours(date.getHours() + 1);
            date.setMinutes(0);
            date.setSeconds(0);
            return;
        }

        if (!this.matchesPart(this.minutes, date.getMinutes(), 0, 59)) {
            // Skip to next minute
            date.setMinutes(date.getMinutes() + 1);
            date.setSeconds(0);
            return;
        }

        // If we get here, just increment by 1 second
        date.setSeconds(date.getSeconds() + 1);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Flag to prevent circular updates
    let isUpdatingFromCron = false;
    let isGeneratingCron = false;

    // Current cron version
    let currentVersion = 'quartz';

    // --- Initialization ---
    initCheckboxes();
    setupEventListeners();
    setupFieldMenu();
    updateVersionInfo();
    updateFieldVisibility();
    generateCron(); // Initial generation

    // --- Checkbox Generation ---
    function initCheckboxes() {
        createCheckboxes('sec_checkboxes', 0, 59);
        createCheckboxes('min_checkboxes', 0, 59);
        createCheckboxes('hour_checkboxes', 0, 23);
        createCheckboxes('day_checkboxes', 1, 31);
        createCheckboxes('month_checkboxes', 1, 12);
        createCheckboxes('week_checkboxes', 1, 7); // 1=SUN, 7=SAT (Standard Cron)
        // Year is usually a range, specific years are less common but we can add a few
        createCheckboxes('year_checkboxes', 2023, 2033);
    }

    function createCheckboxes(containerId, start, end) {
        const container = document.getElementById(containerId);
        if (!container) return;

        for (let i = start; i <= end; i++) {
            const div = document.createElement('div');
            div.className = 'checkbox-item';

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = i;
            input.id = `${containerId}_${i}`;

            const label = document.createElement('label');
            label.htmlFor = `${containerId}_${i}`;
            label.textContent = i < 10 ? '0' + i : i;

            div.appendChild(input);
            div.appendChild(label);
            container.appendChild(div);
        }
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        // Version selector
        const versionSelector = document.getElementById('cronVersion');
        versionSelector.addEventListener('change', (e) => {
            currentVersion = e.target.value;
            updateVersionInfo();
            updateFieldVisibility();
            generateCron();
        });

        // Listen to cronResult input for manual editing
        const cronResultInput = document.getElementById('cronResult');
        cronResultInput.addEventListener('input', () => {
            if (!isGeneratingCron) {
                parseCronExpression(cronResultInput.value);
                // Also update validation and next runs
                updateHumanReadable(cronResultInput.value);
            }
        });

        // Listen to all other input changes (excluding cronResult)
        const inputs = document.querySelectorAll('input:not(#cronResult)');
        inputs.forEach(input => {
            input.addEventListener('change', generateCron);
            input.addEventListener('input', generateCron); // For text/number inputs
        });

        // Copy Button
        document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
        document.getElementById('resetBtn').addEventListener('click', resetForm);
    }

    // --- Field Menu Handling ---
    function setupFieldMenu() {
        const buttons = document.querySelectorAll('.field-menu-btn');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                if (button.style.display === 'none') return;
                const targetId = button.getAttribute('data-target');
                setActiveField(targetId);
            });
        });
    }

    function setActiveField(targetId) {
        const pane = document.getElementById(targetId);
        const button = document.querySelector(`.field-menu-btn[data-target="${targetId}"]`);
        if (!pane || !button || button.style.display === 'none') return;

        document.querySelectorAll('.field-menu-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.field-pane').forEach(p => p.classList.remove('active'));

        button.classList.add('active');
        pane.classList.add('active');
    }

    function activateFirstAvailableField() {
        const firstVisibleButton = Array.from(document.querySelectorAll('.field-menu-btn'))
            .find(btn => btn.style.display !== 'none');
        if (!firstVisibleButton) return;
        setActiveField(firstVisibleButton.getAttribute('data-target'));
    }

    function setFieldVisibility(fieldName, shouldShow) {
        const button = document.querySelector(`.field-menu-btn[data-field="${fieldName}"]`);
        const pane = document.getElementById(`pane_${fieldName}`);
        if (!button || !pane) return;

        button.style.display = shouldShow ? 'block' : 'none';
        pane.dataset.available = shouldShow ? 'true' : 'false';

        if (!shouldShow) {
            button.classList.remove('active');
            pane.classList.remove('active');
        }
    }

    // --- Version Management ---
    function updateVersionInfo() {
        const infoText = document.querySelector('.info-text');
        const versionFormats = {
            'linux': '格式：分 时 日 月 周',
            'spring': '格式：秒 分 时 日 月 周',
            'quartz': '格式：秒 分 时 日 月 周 年'
        };
        infoText.textContent = versionFormats[currentVersion];
    }

    function updateFieldVisibility() {
        const showSeconds = currentVersion !== 'linux';
        const showYear = currentVersion === 'quartz';

        setFieldVisibility('seconds', showSeconds);
        setFieldVisibility('year', showYear);

        activateFirstAvailableField();
    }

    // --- Cron Generation Logic ---
    function parseCronExpression(expression) {
        isUpdatingFromCron = true;

        const parts = expression.trim().split(/\s+/);

        // Validate field count based on version
        const expectedFieldCount = {
            'linux': 5,
            'spring': 6,
            'quartz': [6, 7]
        };

        const expected = expectedFieldCount[currentVersion];
        const isValid = Array.isArray(expected)
            ? parts.length >= expected[0] && parts.length <= expected[1]
            : parts.length === expected;

        if (!isValid) {
            isUpdatingFromCron = false;
            return;
        }

        try {
            if (currentVersion === 'linux') {
                // Linux: minute hour day month day-of-week
                setCronPart('minutes', parts[0]);
                setCronPart('hours', parts[1]);
                setCronPart('dayOfMonth', parts[2]);
                setCronPart('month', parts[3]);
                setCronPart('dayOfWeek', parts[4]);
                // Set seconds to 0
                const secEvery = document.getElementById('sec_every');
                if (secEvery) secEvery.checked = true;
                // Set year to unspecified
                const yearUnspecified = document.getElementById('year_unspecified');
                if (yearUnspecified) yearUnspecified.checked = true;
            } else if (currentVersion === 'spring') {
                // Spring: second minute hour day month day-of-week
                setCronPart('seconds', parts[0]);
                setCronPart('minutes', parts[1]);
                setCronPart('hours', parts[2]);
                setCronPart('dayOfMonth', parts[3]);
                setCronPart('month', parts[4]);
                setCronPart('dayOfWeek', parts[5]);
                // Set year to unspecified
                const yearUnspecified = document.getElementById('year_unspecified');
                if (yearUnspecified) yearUnspecified.checked = true;
            } else {
                // Quartz: second minute hour day month day-of-week [year]
                setCronPart('seconds', parts[0]);
                setCronPart('minutes', parts[1]);
                setCronPart('hours', parts[2]);
                setCronPart('dayOfMonth', parts[3]);
                setCronPart('month', parts[4]);
                setCronPart('dayOfWeek', parts[5]);

                if (parts.length >= 7) {
                    setCronPart('year', parts[6]);
                } else {
                    // If year is missing, set to unspecified (empty)
                    const yearUnspecified = document.getElementById('year_unspecified');
                    if (yearUnspecified) yearUnspecified.checked = true;
                }
            }
        } catch (e) {
            console.error("Error parsing cron:", e);
        } finally {
            isUpdatingFromCron = false;
        }
    }

    function setCronPart(name, value) {
        const prefix = getPrefix(name);

        // Reset checkboxes
        const checkboxContainer = document.getElementById(`${prefix}_checkboxes`);
        if (checkboxContainer) {
            checkboxContainer.querySelectorAll('input').forEach(cb => cb.checked = false);
        }

        if (value === '*') {
            document.getElementById(`${prefix}_every`).checked = true;
        } else if (value === '?') {
            const el = document.getElementById(`${prefix}_unspecified`);
            if (el) el.checked = true;
        } else if (value === 'L' && name === 'dayOfMonth') {
            document.getElementById('day_last').checked = true;
        } else if (value.includes('-')) {
            document.getElementById(`${prefix}_cycle`).checked = true;
            const [start, end] = value.split('-');
            document.getElementById(`${prefix}_cycle_start`).value = start;
            document.getElementById(`${prefix}_cycle_end`).value = end;
        } else if (value.includes('/')) {
            document.getElementById(`${prefix}_start`).checked = true;
            const [start, step] = value.split('/');
            document.getElementById(`${prefix}_start_val`).value = start;
            document.getElementById(`${prefix}_start_step`).value = step;
        } else if (value.includes('W')) {
            document.getElementById('day_work').checked = true;
            document.getElementById('day_work_val').value = parseInt(value);
        } else if (value.includes('L') && name === 'dayOfWeek') {
            document.getElementById('week_last').checked = true;
            document.getElementById('week_last_val').value = parseInt(value);
        } else if (value.includes('#')) {
            document.getElementById('week_nth').checked = true;
            const [day, week] = value.split('#');
            document.getElementById('week_nth_day').value = day;
            document.getElementById('week_nth_val').value = week;
        } else if (value.includes(',')) {
            document.getElementById(`${prefix}_specific`).checked = true;
            value.split(',').forEach(val => {
                const cb = document.getElementById(`${prefix}_checkboxes_${val}`);
                if (cb) cb.checked = true;
            });
        } else if (!isNaN(value)) {
            // Single value is treated as specific
            document.getElementById(`${prefix}_specific`).checked = true;
            const cb = document.getElementById(`${prefix}_checkboxes_${value}`);
            if (cb) cb.checked = true;
        }
    }

    // --- Cron Generation Logic ---
    function generateCron() {
        if (isUpdatingFromCron) return; // Prevent circular updates

        isGeneratingCron = true;

        const seconds = getCronPart('seconds', 0, 59);
        const minutes = getCronPart('minutes', 0, 59);
        const hours = getCronPart('hours', 0, 23);
        const dayOfMonth = getCronPart('dayOfMonth', 1, 31);
        const month = getCronPart('month', 1, 12);
        const dayOfWeek = getCronPart('dayOfWeek', 1, 7);
        const year = getCronPart('year', 2023, 2099);

        let finalDayOfMonth = dayOfMonth;
        let finalDayOfWeek = dayOfWeek;

        // Handle Day of Month vs Day of Week conflict for Spring/Quartz
        // Linux uses * for both which is valid
        if (currentVersion !== 'linux') {
            // In Quartz/Spring cron, if one is specified, the other must be '?'
            if (finalDayOfMonth !== '?' && finalDayOfWeek !== '?') {
                const dayMode = document.querySelector('input[name="dayOfMonth"]:checked').value;
                const weekMode = document.querySelector('input[name="dayOfWeek"]:checked').value;

                if (weekMode === '?') {
                    finalDayOfWeek = '?';
                } else if (dayMode === '?') {
                    finalDayOfMonth = '?';
                } else {
                    // Both have values. This is tricky. 
                    // If both are '*', make Day of Week '?'
                    if (finalDayOfMonth === '*' && finalDayOfWeek === '*') {
                        finalDayOfWeek = '?';
                    } else {
                        // If one is specific and other is *, make the * one ?
                        if (finalDayOfMonth !== '*' && finalDayOfWeek === '*') {
                            finalDayOfWeek = '?';
                        } else if (finalDayOfMonth === '*' && finalDayOfWeek !== '*') {
                            finalDayOfMonth = '?';
                        }
                    }
                }
            }
        }

        // Generate cron expression based on version
        let cron;
        if (currentVersion === 'linux') {
            // Linux: minute hour day month day-of-week
            cron = `${minutes} ${hours} ${finalDayOfMonth} ${month} ${finalDayOfWeek}`;
        } else if (currentVersion === 'spring') {
            // Spring: second minute hour day month day-of-week
            cron = `${seconds} ${minutes} ${hours} ${finalDayOfMonth} ${month} ${finalDayOfWeek}`;
        } else {
            // Quartz: second minute hour day month day-of-week [year]
            cron = `${seconds} ${minutes} ${hours} ${finalDayOfMonth} ${month} ${finalDayOfWeek}`;
            if (year && year !== '') {
                cron += ` ${year}`;
            }
        }

        document.getElementById('cronResult').value = cron;
        updateHumanReadable(cron);

        isGeneratingCron = false;
    }

    function getCronPart(name, min, max) {
        const prefix = getPrefix(name);
        const type = document.querySelector(`input[name="${name}"]:checked`).value;

        switch (type) {
            case 'every':
                return '*';
            case '?':
                return '?';
            case 'unspecified': // For year
                return '';
            case 'cycle':
                const start = document.getElementById(`${prefix}_cycle_start`).value;
                const end = document.getElementById(`${prefix}_cycle_end`).value;
                return `${start}-${end}`;
            case 'start':
                const startVal = document.getElementById(`${prefix}_start_val`).value;
                const step = document.getElementById(`${prefix}_start_step`).value;
                return `${startVal}/${step}`;
            case 'work':
                const workDay = document.getElementById('day_work_val').value;
                return `${workDay}W`;
            case 'last':
                if (name === 'dayOfMonth') return 'L';
                if (name === 'dayOfWeek') {
                    const lastDay = document.getElementById('week_last_val').value;
                    return `${lastDay}L`;
                }
                return '*';
            case 'nth':
                const nthWeek = document.getElementById('week_nth_val').value;
                const nthDay = document.getElementById('week_nth_day').value;
                return `${nthDay}#${nthWeek}`;
            case 'specific':
                const checkboxes = document.querySelectorAll(`#${prefix}_checkboxes input:checked`);
                if (checkboxes.length === 0) return '*'; // Fallback
                const values = Array.from(checkboxes).map(cb => cb.value).sort((a, b) => a - b);
                return values.join(',');
            default:
                return '*';
        }
    }

    function getPrefix(name) {
        const map = {
            'seconds': 'sec',
            'minutes': 'min',
            'hours': 'hour',
            'dayOfMonth': 'day',
            'month': 'month',
            'dayOfWeek': 'week',
            'year': 'year'
        };
        return map[name] || name;
    }

    // --- Utilities ---
    function copyToClipboard() {
        const copyText = document.getElementById("cronResult");
        copyText.select();
        copyText.setSelectionRange(0, 99999); // For mobile devices

        // Use ztools API if available, otherwise fallback
        if (window.ztools) {
            window.ztools.copyText(copyText.value);
            window.ztools.showNotification('Cron 表达式已复制');
        } else {
            navigator.clipboard.writeText(copyText.value).then(() => {
                // alert('Copied: ' + copyText.value);
            });
        }
    }

    function updateHumanReadable(cron) {
        const humanReadableEl = document.getElementById('humanReadable');

        if (!cron || cron.trim() === '') {
            humanReadableEl.innerHTML = '<span style="color: #999;">请输入 Cron 表达式</span>';
            return;
        }

        try {
            // Parse the cron expression using our custom parser with version
            const parser = new SimpleCronParser(cron, currentVersion);

            // Get next 3 execution times
            const nextRuns = parser.getNextExecutions(3);

            if (nextRuns.length === 0) {
                humanReadableEl.innerHTML = '<span style="color: #f44336; font-weight: 500;">无效表达式</span>';
                return;
            }

            // Display next execution times
            humanReadableEl.innerHTML = `
                <div style="color: #4CAF50; font-weight: 500; margin-bottom: 8px;">下次执行时间：</div>
                ${nextRuns.map((time, index) => `
                    <div style="padding: 4px 0; color: #666;">
                        ${index + 1}. ${time.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })}
                    </div>
                `).join('')}
            `;
        } catch (error) {
            // Invalid cron expression
            humanReadableEl.innerHTML = '<span style="color: #f44336; font-weight: 500;">无效表达式</span>';
        }
    }

    function resetForm() {
        const versionSelector = document.getElementById('cronVersion');
        versionSelector.value = 'quartz';
        currentVersion = 'quartz';

        document.querySelectorAll('input').forEach(input => {
            if (input.type === 'radio' || input.type === 'checkbox') {
                input.checked = input.defaultChecked;
            } else if (input.type === 'number' || input.type === 'text') {
                input.value = input.defaultValue;
            }
        });

        updateVersionInfo();
        updateFieldVisibility();
        generateCron();
    }

    // --- Validation & Next Runs ---
    function updateValidationAndNextRuns(cron) {
        const validationEl = document.getElementById('cronValidation');
        const nextEl = document.getElementById('cronNextRuns');
        validationEl.textContent = '';
        validationEl.style.color = '';
        nextEl.innerHTML = '';

        if (!cron || cron.trim() === '') return;

        // Try to find cron parser library exposed by CDN
        const lib = window.cronParser || window.parser || window.cronParser;
        if (!lib) {
            validationEl.textContent = '无法加载 cron 解析库';
            validationEl.style.color = 'orange';
            return;
        }

        try {
            // parseExpression supports expressions with seconds as well
            const interval = lib.parseExpression(cron);
            const runs = [];
            for (let i = 0; i < 3; i++) {
                const next = interval.next();
                // some versions return an object with toDate(), some a Date
                const dateObj = (next && typeof next.toDate === 'function') ? next.toDate() : next;
                runs.push(new Date(dateObj).toLocaleString('zh-CN'));
            }

            // Show next runs
            runs.forEach(r => {
                const div = document.createElement('div');
                div.textContent = r;
                nextEl.appendChild(div);
            });
        } catch (e) {
            validationEl.textContent = '无效表达式';
            validationEl.style.color = 'red';
            nextEl.innerHTML = '';
        }
    }
});