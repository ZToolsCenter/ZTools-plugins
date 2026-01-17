
// 日历类
class GitHubCalendar {
    constructor(elementId, endDate, numCols) {
        this.element = document.getElementById(elementId);
        this.endDate = new Date(endDate);
        this.numCols = numCols;
        this.days = numCols * 7;

        // Adjust start date to the previous Sunday
        this.startDate = new Date(this.endDate);
        this.startDate.setDate(this.endDate.getDate() - this.days + 1);
        while (this.startDate.getDay() !== 0) {
            this.startDate.setDate(this.startDate.getDate() - 1);
        }

        // Adjust end date to the next Saturday
        while (this.endDate.getDay() !== 6) {
            this.endDate.setDate(this.endDate.getDate() + 1);
        }

        this.data = {};
        this.initCalendar();
        // console.log(this.startDate, this.endDate);
    }

    initCalendar() {
        this.element.innerHTML = ''; // Clear any existing content
        const calendar = document.createElement('div');
        calendar.className = 'calendar';
        calendar.style.display = 'grid';
        calendar.style.gridTemplateColumns = `26px repeat(${this.numCols+1}, 1fr)`;
        // 获取第二列的宽度
        // calendar.style.gridTemplateRows = 'repeat(8, auto)';

        // Create weekday labels
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        weekdays.forEach((day, index) => {
            const dayLabel = document.createElement('div');
            dayLabel.className = 'week-label';
            dayLabel.innerText = day;
            dayLabel.style.gridRowStart = index + 2;
            dayLabel.style.gridColumnStart = 1;
            calendar.appendChild(dayLabel);
        });

        // Create month labels and cells
        let currentDate = new Date(this.startDate);
        let firstDayOfWeek = currentDate.getDay();

        for (let i = 0; i <= Math.ceil((this.endDate - this.startDate) / (1000 * 60 * 60 * 24)); i++) {
            const col = Math.floor((i + firstDayOfWeek) / 7) + 2;
            const row = ((i + firstDayOfWeek) % 7) + 2;

            if (currentDate.getDate() === 1) {
                const monthName = currentDate.toLocaleString('default', { month: 'short' });
                const monthLabel = document.createElement('div');
                monthLabel.className = 'month-label';
                monthLabel.innerText = monthName;
                monthLabel.style.gridRowStart = 1;
                monthLabel.style.gridColumnStart = col;
                calendar.appendChild(monthLabel);
            }

            const cell = document.createElement('div');
            cell.className = 'day-cell';
            cell.dataset.date = `${currentDate.toISOString().split('T')[0]}`;
            cell.dataset.tips = `${currentDate.toISOString().split('T')[0]}`;

            cell.style.gridRowStart = row;
            cell.style.gridColumnStart = col;

            // Move to the next day
            currentDate.setDate(currentDate.getDate() + 1);
            calendar.appendChild(cell);
        }

        this.element.appendChild(calendar);

        // 获取第二列的宽度
        const secondColWidth = calendar.children[9].offsetWidth;
        console.log(secondColWidth);
        calendar.style.gridTemplateRows = `14px repeat(7, ${secondColWidth}px)`;
    }

    setData(data) {
        this.data = data;
        this.updateCells();
    }

    updateCells() {
        const cells = this.element.getElementsByClassName('day-cell');
        for (let cell of cells) {
            const date = cell.dataset.date;
            const count = this.data[date]?.count || 0;
            const totalDuration = this.data[date]?.totalDuration || 0;
            cell.style.backgroundColor = this.getColor(count);
            cell.dataset.tips = count == 0 ?date:`${date}\n🍅 × ${count}\n🕒 ${Math.floor(totalDuration/36000000 || 0)}小时`;
        }
    }

    getColor(count) {
        if (count >= 10) return '#9E3500';
        if (count >= 7) return '#F8630C';
        if (count >= 4) return '#FEAD7E';
        if (count >= 1) return '#F5DBCC';
        return 'var(--day-cell-color)';
    }
}



