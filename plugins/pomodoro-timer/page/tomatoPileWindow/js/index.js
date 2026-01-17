if (!utools.isDev()) {
    console.log = console.info = console.error = console.warn = () => { };
}


// 引入Matter库中的模块
const { Engine,  Runner, Bodies, World, Body, Mouse, MouseConstraint } = Matter;

// const display = utools.getPrimaryDisplay()
// console.log(display)
// let taskbarHeight = display.workArea.y;

// let taskbar = utools.isMacOs() ? 2 : -40;
let n=5;


// var canvas_height = window.innerHeight + taskbar
// var canvas_width = window.innerWidth




const display = utools.getDisplayNearestPoint({x:window.screenX+5,y:window.screenY+5})
// console.log(display)

var canvas_height =  utools.isMacOs() ? display.bounds.height-28 : display.workArea.height
var canvas_width =display.bounds.width


canvas_height = Math.ceil(canvas_height / n) * n;
canvas_width = Math.ceil(canvas_width / n) * n;

console.log(canvas_height);
console.log(canvas_width);

// 正常和休眠时的时间步长（单位：毫秒）
const normalDelta = 1000 / 60;  // 约等于 60 FPS
const sleepingDelta = 1000 / 30;  // 低频率更新，约 10 FPS
// 定义当前的时间步长
let currentDelta = normalDelta;


// 创建引擎
const engine = Engine.create({
    gravity: { y: 3 },
    // positionIterations: 0 , // 增加位置迭代次数
    enableSleeping: true,

});



// 创建一个新的渲染器类
class newRender {
    constructor(options) {
        // options：width, height, engine ,rows, columns, canvas
        this.options = options;
        this.engine = options.engine;
        this.width = options.width || 600;
        this.height = options.height || 400;
        this.rows = options.rows || 8;
        this.cols = options.cols || 8;
        this.rowHeight = this.height / this.rows;
        this.colWidth = this.width / this.cols;

        this.dirtySet = new Set();
        this.prevDirtySet = new Set();
        this.areaStatus = {};

        this.container = document.createElement('div');
        this.container.style.display = 'grid';
        this.container.style.gridTemplateColumns = `repeat(${this.cols}, 1fr)`;
        this.container.style.gridTemplateRows = `repeat(${this.rows}, 1fr)`;
        this.container.style.width = this.width + 'px';
        this.container.style.height = this.height + 'px';
        this.container.id = 'container';
        document.body.appendChild(this.container);

        this.canvasList = this.createCanvasList();
        this.areaList = this.calculateAreaList();




    }

    createCanvasList() {
        const canvasList = {};
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const key = row + ',' + col;
                const canvas = document.createElement('canvas');
                canvas.width = this.colWidth;
                canvas.height = this.rowHeight;
                this.container.appendChild(canvas);
                canvasList[key] = canvas;
            }
        }
        return canvasList;
    }

    calculateAreaList() {
        const areaList = {};
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const key = row + ',' + col;
                areaList[key] = {
                    x: col * this.colWidth,
                    y: row * this.rowHeight,
                };
            }
        }
        return areaList;
    }

    markDirtyArea(body) {
        if (body.isSleeping) return;

        const bodyBounds = body.bounds;

        const startRow = Math.floor(bodyBounds.min.y / this.rowHeight);
        const endRow = Math.floor(bodyBounds.max.y / this.rowHeight);
        const startCol = Math.floor(bodyBounds.min.x / this.colWidth);
        const endCol = Math.floor(bodyBounds.max.x / this.colWidth);

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
                    const key = row + ',' + col;
                    this.dirtySet.add(key);
                }
            }
        }
    }

    render() {
        // 遍历所有非休眠物体，标记与它们相交的区域
        Matter.Composite.allBodies(this.engine.world).forEach(body => {
            if (!body.isSleeping) {
                this.markDirtyArea(body);
            }
        });

        // 遍历所有区域，更新区域状态并执行重绘操作
        for (const key in this.canvasList) {
            const canvas = this.canvasList[key];
            const context = canvas.getContext('2d');

            if (this.dirtySet.has(key)) {
                // 区域状态发生变化，需要重绘
                context.clearRect(0, 0, this.colWidth, this.rowHeight);

                const [row, col] = key.split(',').map(Number);
                const x = col * this.colWidth;
                const y = row * this.rowHeight;

                const bodies = [];
                Matter.Composite.allBodies(this.engine.world).forEach(body => {
                    if (body.render.sprite && body.render.sprite.texture) {
                        if (this.isBodyInArea(body, x, y, this.colWidth, this.rowHeight)) {
                            bodies.push(body);
                            this.drawBody(body, context, x, y);
                        }
                    }
                });

                this.areaStatus[key] = {
                    dirty: true,
                    bodies: bodies
                };
            } else if (this.areaStatus[key] && this.areaStatus[key].dirty) {
                // 区域状态未发生变化，但之前标记为需要重绘
                context.clearRect(0, 0, this.colWidth, this.rowHeight);

                this.areaStatus[key].bodies.forEach(body => {
                    const [row, col] = key.split(',').map(Number);
                    const x = col * this.colWidth;
                    const y = row * this.rowHeight;
                    this.drawBody(body, context, x, y);
                });

                this.areaStatus[key].dirty = false;
            }
        }

        // 更新上一次渲染时的脏区域集合
        this.prevDirtySet = new Set(this.dirtySet);

        // 清空当前的脏区域集合
        this.dirtySet.clear();
    }

    isBodyInArea(body, x, y, width, height) {
        return body.bounds.min.x-5 <= x + width &&
            body.bounds.max.x +5 >= x &&
            body.bounds.min.y-5 <= y + height &&
            body.bounds.max.y+5 >= y;
    }

    drawBody(body, context, offsetX, offsetY) {
        const x = body.position.x - offsetX;
        const y = body.position.y - offsetY;
        const angle = body.angle;
        const radius = body.circleRadius +2;

        if (body.progress == undefined) {
            console.error("body.progress is undefined",body.progress,body)
            return;
        }


        try {
            context.save();
            context.translate(x, y);
            context.rotate(angle);
            context.drawImage(picList[body.progress], -radius, -radius, radius * 2, radius * 2);
            context.restore();
        } catch (error) {
            console.log(error,"\n----\n----",picList[body.progress],body.progress);

        }

    }

    clearAllCanvases() {
        for (const key in this.canvasList) {
            const canvas = this.canvasList[key];
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, this.colWidth, this.rowHeight);
        }
    }

    // 绘制所有画布，不考虑物体是否休眠
    drawAllCanvases() {
        // 遍历所有区域，执行重绘操作
        for (const key in this.canvasList) {
            const canvas = this.canvasList[key];
            const context = canvas.getContext('2d');

            context.clearRect(0, 0, this.colWidth, this.rowHeight);

            const [row, col] = key.split(',').map(Number);
            const x = col * this.colWidth;
            const y = row * this.rowHeight;

            Matter.Composite.allBodies(this.engine.world).forEach(body => {
                if (body.render.sprite && body.render.sprite.texture) {
                    if (this.isBodyInArea(body, x, y, this.colWidth, this.rowHeight)) {
                        this.drawBody(body, context, x, y);
                    }
                }
            });
        }
    }
}

const newRender_ = new newRender(
    {
        width: canvas_width,
        height: canvas_height,
        engine: engine,
        rows: n,
        cols: n,
    }
);


const tomatoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="62" height="64" viewBox="0 0 62 64" >
    <path  $1  $2  stroke-width="2" d="M9.69903 16.5441L9.69904 16.5441C15.1386 12.256 22.5749 10.6165 30.6556 12.4278M9.69903 16.5441L30.7346 12.426C30.7107 12.4323 30.6778 12.4327 30.6556 12.4278M9.69903 16.5441C4.2573 20.8339 1 27.6285 1 35.7515C1 43.9993 4.36443 50.6793 9.83871 55.2638C15.2783 59.8194 22.6914 62.2221 30.7333 62.2221C38.7752 62.2221 46.1883 59.8194 51.628 55.2638C57.1023 50.6793 60.4666 43.9993 60.4666 35.7515C60.4666 27.6617 57.3425 20.6846 51.9525 16.2866C46.5415 11.8713 39.0599 10.2308 30.7347 12.426L9.69903 16.5441ZM30.6556 12.4278L30.4369 13.4035L30.6555 12.4278C30.6556 12.4278 30.6556 12.4278 30.6556 12.4278Z"/>
    <path  fill="#5DA500" id="tomatoLeaf" d="M31.0474 1.00026C31.636 4.90104 31.8717 6.55014 31.8867 8.48668L31.8865 8.89762C31.8781 9.83113 31.8152 10.5905 31.7151 11.2467C34.5308 9.66679 34.8669 7.5131 35.7324 4.99981C37.6643 7.60137 36.4576 10.859 35.4329 12.3428C35.1387 12.7688 34.7977 13.1233 34.4314 13.4181C34.7668 13.4652 35.098 13.4887 35.4241 13.4887C39.6895 13.4887 42.2085 9.77536 42.2324 9.73419C42.5641 9.16257 43.8946 7.76555 44.5204 7.23419C44.5204 8.73419 44.7694 9.87697 44.5204 10.5153C42.3877 15.9773 39.0597 17.1233 36.6437 17.1233C36.0822 17.1233 35.5362 17.0614 35.0161 16.9581C36.4905 18.12 37.4278 17.9542 38.1284 17.6562L38.3626 17.5493L38.6755 17.3975C38.8745 17.3043 39.0563 17.2347 39.2324 17.2347C40.2324 18.2347 35.2324 21.7342 31.2324 19.2342L30.4885 18.7756L29.7987 18.3639C29.1628 17.9918 28.6845 17.7348 28.3247 17.5586C27.0183 18.3405 25.7647 18.7344 24.5776 18.7344C20.6047 18.7344 18.8904 17.2721 18.7414 17.0183L18.7324 16.9996C18.4533 16.1525 17.2324 16.4691 17.2324 14.9877L17.4182 14.9948C18.4611 15.0693 20.3625 15.7056 24.5776 15.6861C25.0433 15.6861 25.5249 15.5851 25.9921 15.428C23.1052 14.9081 21.1457 12.0502 19.7315 10.2342C18.8587 9.1136 17.2328 5.99981 18.2324 4.99981C19.0738 6.96298 21.2321 8.23419 23.7321 9.73419C25.1318 10.574 26.8496 12.4058 29.2133 12.2901L29.2535 12.2734L29.5722 12.1711C30.2006 8.71139 29.7927 4.69908 29.1862 1.19631C29.5 0.49941 30.5 0.5 31.0474 1.00026Z" />
    <path fill-rule="evenodd" clip-rule="evenodd" d="M52.8847 31.3993C52.8763 31.2761 52.8485 31.1549 52.8023 31.0403C52.6977 30.7801 52.5035 30.5659 52.2549 30.4361C52.0063 30.3064 51.7195 30.2698 51.4462 30.3329C51.1729 30.3959 50.9312 30.5545 50.7645 30.78C50.5978 31.0056 50.5172 31.2832 50.5371 31.563C50.9728 37.8083 47.9206 43.6182 42.9417 46.0203C42.3565 46.3028 42.1124 47.0081 42.3933 47.5913C42.4604 47.7305 42.5543 47.8551 42.6696 47.958C42.7849 48.0609 42.9193 48.14 43.0652 48.191C43.2111 48.2419 43.3656 48.2636 43.5198 48.2548C43.6741 48.246 43.8251 48.207 43.9643 48.1398C46.9705 46.6893 49.3967 44.2606 50.9809 41.1159C52.4645 38.1712 53.1228 34.8113 52.8847 31.3993ZM39.074 49.8862C38.892 49.9616 38.697 50.0004 38.5 50.0004C38.303 50.0004 38.108 49.9616 37.926 49.8862C37.744 49.8108 37.5786 49.7004 37.4393 49.5611C37.3001 49.4218 37.1896 49.2564 37.1142 49.0744C37.0388 48.8924 37 48.6974 37 48.5004C37 48.3034 37.0388 48.1084 37.1142 47.9264C37.1896 47.7444 37.3001 47.579 37.4393 47.4398C37.5786 47.3005 37.744 47.19 37.926 47.1146C38.108 47.0392 38.303 47.0004 38.5 47.0004C38.697 47.0004 38.892 47.0392 39.074 47.1146C39.256 47.19 39.4214 47.3005 39.5607 47.4398C39.6999 47.579 39.8104 47.7444 39.8858 47.9264C39.9612 48.1084 40 48.3034 40 48.5004C40 48.6974 39.9612 48.8924 39.8858 49.0744C39.8104 49.2564 39.6999 49.4218 39.5607 49.5611C39.4214 49.7004 39.256 49.8108 39.074 49.8862Z" fill="white" style="fill:white;fill-opacity:0.3;"/>

    </svg>
`;


// 预定义全局对象 picList
var picList = {};

async function processSvgAndStore(progress, svgString = tomatoSvg) {
    return new Promise((resolve) => {
        // 检查 picList 中是否存在该 progress 的条目
        if (picList[progress]) {
            resolve();
            return;
        }
        let updatedSvgString = svgString.replace('$1', `fill="${getGradientColor(["#7ABE6F", "#FFD12C", "#FC5E3C"], [0, 0.5, 1], progress)}"`);
        updatedSvgString = updatedSvgString.replace('$2', `stroke="${getGradientColor(["#0D9D00", "#EEAF50", "#FFBE5D"], [0, 0.5, 1], progress)}"`);


        // 创建离屏 canvas 并渲染处理后的 SVG
        const offscreenCanvas = document.createElement('canvas');
        const offscreenCtx = offscreenCanvas.getContext('2d');

        const svgImage = new Image();
        svgImage.onload = () => {
            console.log("RENDERing...: ",progress);
            offscreenCanvas.width = svgImage.width;
            offscreenCanvas.height = svgImage.height;
            offscreenCtx.drawImage(svgImage, 0, 0);
            // 保存到 picList 中
            picList[progress] = offscreenCanvas;
            resolve();
        };


        svgImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(updatedSvgString);
    });
}



// 监听引擎更新事件
Matter.Events.on(engine, 'beforeUpdate', function (event) {
    // console.time("Update")
    let allBodies = Matter.Composite.allBodies(engine.world);
    let allSleeping = allBodies.every(body => body.isSleeping);

    if (!allSleeping) {
        currentDelta = normalDelta;
        // Matter.Render.world(render);

        allBodies.forEach(body => {
            // if (!body.isSleeping) {
            //     newRender_.getCell(body);
            //     // console.log(body)
            // }
        });

        // newRender_.render();
    } else {
        // 如果所有物体都在休眠状态，降低更新频率
        currentDelta = sleepingDelta;
    }
    runner.delta = currentDelta;
});

Matter.Events.on(engine, 'afterUpdate', function () {
    Matter.Sleeping.update(engine.world.bodies, {
        timeScale: engine.timing.timeScale,
        // velocityThreshold: 0,  // 较低的速度阈值，使得物体在较快速度下也能休眠
        // angularVelocityThreshold: 0,  // 较低的角速度阈值
        // minMotion: 0,  // 设置一个适中的最小运动量阈值
        motionSleepThreshold: 4  // 物体在60帧内运动较小则休眠
    });
    newRender_.render();
    // console.timeEnd("Update")
});





const wallWidth = 180;
const halfWallWidth = wallWidth / 2;
// 添加边界
const ground = Bodies.rectangle(canvas_width / 2, canvas_height + halfWallWidth , canvas_width, wallWidth, { isStatic: true, restitution: 1, frictionStatic: 1, render: { visible: false } });
const leftWall = Bodies.rectangle(-halfWallWidth, canvas_height / 2, wallWidth, canvas_height, { isStatic: true, restitution: 1, render: { visible: true } });
const rightWall = Bodies.rectangle(canvas_width + halfWallWidth, canvas_height / 2, wallWidth, canvas_height, { isStatic: true, restitution: 1, render: { visible: true } });
const ceiling = Bodies.rectangle(canvas_width / 2, -halfWallWidth, canvas_width, wallWidth, { isStatic: true, restitution: 1, render: { visible: true } });
World.add(engine.world, [ground, leftWall, rightWall, ceiling]);



async function tomataFalling(x, y, progress, size = 22) {
    console.log("tomataFalling",x,y,progress,size)

    size = parseInt(size * (0.4 * progress + 0.5), 10);
    x = parseInt(x, 10) + size+4;
    y = parseInt(y, 10) + size + 8;
    // console.log(x, y, size)
    const scale = 1;
    const tomato = Bodies.circle(x, y, size, {
        restitution: 0.3,
        friction: 0.1,
        frictionStatic: 0.1,
        frictionAir: 0.02,
        angularVelocity: 0.4,
        // mass: mass,
        render: {
            visible: false,
            fillStyle: 'blue',
            opacity: 0.8,
            sprite: {
                texture: "pic/tomato.svg",
                xScale: scale,
                yScale: scale,

            }
        }
    });

    // 设置随机初始速度和角速度
    const randomVelocity = {
        x: (Math.random() - 0.5), // x 方向速度在 -2 到 2 之间
        y: 0
    };
    Body.setVelocity(tomato, randomVelocity);

    const randomAngularVelocity = (Math.random() - 0.5) * 0.1; // 角速度在 -0.05 到 0.05 之间
    Body.setAngularVelocity(tomato, randomAngularVelocity);





    await processSvgAndStore(progress).then((canvas) => {

        tomato.progress = progress;
        if (progress == undefined){
            console.error("progress is undefined",progress,x,y)
            return;
        }

        // 在这里使用处理后的 canvas
    });



    console.time("addTomato")

    World.add(engine.world, tomato);
        // 立即更新物理引擎
    // Engine.update(engine);
    console.timeEnd("addTomato")
    console.log("tomatoFalling",x,y,progress,size)
}

// const addTomato = document.getElementById("tomato")
// console.log(addTomato)

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function totalTomatoNum(data) {
    // 获取屏幕宽度
    const screenWidth = window.innerWidth;
    const screenTop = window.screenTop // 屏幕顶部 + 50px
    // console.log(data)

    // 遍历 data 对象
    for (const [progress, count] of Object.entries(data)) {
        for (let i = 0; i < count; i++) {
            // 随机生成 x 和 y 坐标
            const x = Math.random() * screenWidth/n-20;
            const y = screenTop +20; // 在屏幕顶部 + 50px 范围内生成 y 坐标

            // 调用 tomataFalling 函数
            tomataFalling(x, y, parseFloat(progress));

            // 添加随机延迟，延迟时间范围为 100 到 1000 毫秒之间
            const delay = 80;
            await sleep(delay);
        }
    }
}


let isRunning = null;
var reflashFlag = 0;






function frame() {
    if (!isRunning) return;
    if (reflashFlag++ > 100){
        // newRender_.clearAllCanvases();
        newRender_.drawAllCanvases();
        reflashFlag = 0;
    }
    const point = utools.getCursorScreenPoint();
    let bodies = Matter.Composite.allBodies(engine.world);
    bodies.forEach(body => {
        const dx = body.position.x - point.x;
        const dy = body.position.y - point.y;
        const maxDistance = 210;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const forceMagnitude = 0.0000015 * body.mass * (maxDistance - distance);
        if (distance < maxDistance) { // 只对200像素范围内的物体施力
            // console.log(distance)
            const force = {
                x: forceMagnitude * dx,
                y: forceMagnitude * dy
            };
            Body.applyForce(body, body.position, force);
        }
    });
}


// 创建运行器
const runner = Runner.create({
    // delta: 1000 / 1,
    isFixed: true,
});


// 运行引擎和渲染器
resumeRunner();



// 暂停 runner
function pauseRunner() {
    if (isRunning) {
        Runner.stop(runner);
        clearInterval(isRunning);
        isRunning = null;
    }
}

// 恢复 runner
function resumeRunner() {
    if (!isRunning) {
        Runner.run(runner, engine);
        isRunning = setInterval(frame, 1000/60);
    }
}
