class NewStudentGuidance {
    constructor() {
        this.guidanceCard = document.getElementById('guidance');
        this.guidanceCard_bg = document.getElementById('guidanceCard_bg');



        // 获取所有questionCard
        this.questionCards = document.querySelectorAll('.questionCard');


        this.progress = 0;
        this.init();

        if(window.settings.userGuide === false){
            this.showGuidanceCard();
        }

        this.status = 'close';

    }

    showGuidanceCard() {
        this.status = 'show';
        this.guidanceCard_bg.style.display = 'block';
        this.questionCards[0].style.display = 'block';

        document.getElementById('progressBar').innerText = `1 / ${this.questionCards.length-1}`;
    }

    closeGuidanceCard() {

        this.guidanceCard_bg.style.display = 'none';
        settings.updateConfig('userGuide', true);
        this.status = 'close';
    }

    init() {
        // 添加各种鼠标事件监听
        const events = ['click', 'mousedown', 'mouseup'];

        events.forEach(eventType => {
            this.guidanceCard_bg.addEventListener(eventType, this.handleMouseEvent.bind(this));
        });

        document.getElementById('endBtn').addEventListener('click', () => {
            this.closeGuidanceCard();
        });

        document.getElementById('guidanceCard_close').addEventListener('click', () => {
            this.closeGuidanceCard();
        });

    }

    // 统一处理所有鼠标事件
    handleMouseEvent(e) {


        e.stopPropagation();
        e.preventDefault();

        // console.log(e.target);

        // 如果不是click事件，则不处理
        if (e.type !== 'click') {
            return;
        }


        if (e.target.classList.contains('wrongAnswer')) {
            e.target.classList.add('wrong');
        } else if (e.target.classList.contains('rightAnswer')) {
            e.target.classList.add('right');

            const interval = setInterval(() => {

                let progressThreshold = 200;

                this.progress++;
                // 背景色进度条
                e.target.style.background = `linear-gradient(to right, rgba(62, 255, 65, 0.13) ${this.progress / progressThreshold * 100}%, rgba(255, 255, 255, 1) ${this.progress / progressThreshold * 100 + 1}%, #fff ${this.progress / progressThreshold * 100}%)`;

                // 强制设置为.answerItem:hover .selectionExample
                const selectionExample = e.target.querySelector('.selectionExample');
                if (selectionExample) {
                    selectionExample.style.display = 'block';
                }

                if (this.progress >= progressThreshold) {

                    // 隐藏当前questionCard，显示下一个questionCard
                    // 找到当前显示的questionCard
                    const currentCard = Array.from(this.questionCards).find(card =>
                        card.style.display === 'block');

                    if (currentCard) {
                        // 隐藏当前卡片
                        currentCard.style.display = 'none';

                        // 找到当前卡片的索引
                        const currentIndex = Array.from(this.questionCards).indexOf(currentCard);
                        const nextIndex = currentIndex + 1;

                        // 如果有下一个卡片，显示它
                        if (nextIndex < this.questionCards.length) {
                            this.questionCards[nextIndex].style.display = 'block';

                            document.getElementById('progressBar').innerText = `${nextIndex + 1} / ${this.questionCards.length-1}`;


                            if(nextIndex === this.questionCards.length-1){
                                document.getElementById('progressBar').style.display = 'none';
                            }



                        } else {
                            // 如果是最后一个问题卡片，完成引导流程
                            this.guidanceCard_bg.style.display = 'none';
                            // 可以在这里添加引导完成后的其他操作
                        }
                    }

                    this.progress = 0;

                    clearInterval(interval);
                }
            }, 1);
        } else if (e.target.classList.contains('startGuidanceBtn')) {
            // 隐藏0号questionCard
            this.questionCards[0].style.display = 'none';
            // 显示1号questionCard
            this.questionCards[1].style.display = 'block';
            document.getElementById('progressBar').innerText = `2 / ${this.questionCards.length-1}`;

        }




        return false;
    }







}




export default NewStudentGuidance;
