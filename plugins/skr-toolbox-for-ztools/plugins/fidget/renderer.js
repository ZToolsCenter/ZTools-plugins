// renderer.js
window.utools = { ...window.ztools }
const snail = document.getElementById('snail-img');
const ghostSnail = document.getElementById('ghost-snail-img'); // 获取虚影蜗牛元素
const countdownTimer = document.getElementById('countdown-timer'); // 新增：获取倒计时元素
// 核心改动：获取事件护盾元素
const eventShield = document.getElementById('event-shield');

const snailWidth = 48; // 图片宽度
const snailHeight = 48; // 图片高度

const imageScale = 1; // 图片缩放比例

// 初始化蜗牛位置为屏幕中心 (如果utools提供了起始点，会被更新)
let snailX = window.innerWidth / 2;
let snailY = window.innerHeight / 2;
let currentAngle = 0; // 蜗牛当前朝向角度

// 雪碧图动画配置
const frameHeight = 48; // 雪碧图中每一帧的高度
const frameCount = 4; // 雪碧图中的帧数
let currentFrame = 0;
let currentDirection = 'right';
let frameUpdateCounter = 0;
const frameUpdateThreshold = 5;

// 拖动功能变量
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

// Ctrl+Drag 新功能变量
let isCtrlDragging = false;
let ctrlDragStartX = 0;
let ctrlDragStartY = 0;
let calculatedCrawlTimeMs = 0;
let wheelAdjustedTimeMs = 0; // 新增：滚轮调整的时间
let lastCtrlDragPosition = { x: 0, y: 0 }; // 新增：存储最后鼠标位置
const PIXELS_PER_MINUTE = 300 / 2; // 用户已调整：500px 对应 10 分钟 (即 150px/分钟)
const MS_PER_MINUTE = 60 * 1000;

// 自动爬行变量
let isAutoCrawling = false;
let autoCrawlStartTime = 0;
let autoCrawlDurationMs = 0;
let autoCrawlAngle = 0;
let isIdleAfterAutoCrawl = false;
let autoCrawlStartX = 0; // 本次自动爬行的实际起点X
let autoCrawlStartY = 0; // 本次自动爬行的实际起点Y


// 虚影蜗牛固定显示状态
let showFixedGhost = false;
let ghostSnailFixedX = 0;
let ghostSnailFixedY = 0;
let ghostSnailFixedAngle = 0;

// Canvas for line drawing
const lineCanvas = document.getElementById('lineCanvas');
const lineCtx = lineCanvas.getContext('2d');

// 移动模式与速度参数 (constantSpeed 现在仅用于普通鼠标跟随)
const movementMode = 'constant';
const easingFactor = 0.02;
const constantSpeed = 0.2; // 普通鼠标跟随时的速度
const rotationSpeed = 4;


// 初始化Canvas大小
function resizeCanvas() {
  lineCanvas.width = window.innerWidth;
  lineCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// 用于倒计时显示的格式化函数
function formatTime(milliseconds) {
  if (milliseconds < 0) milliseconds = 0;
  // 向上取整，确保最后1秒能完整显示
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let parts = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || totalSeconds === 0) parts.push(`${seconds}秒`);

  return parts.join('');
}


function normalizeAngle(angle) {
  angle = angle % 360;
  if (angle > 180) angle -= 360;
  if (angle < -180) angle += 360;
  return angle;
}

function getDirectionImage(angle) {
  if (angle > -45 && angle <= 45) return 'right';
  if (angle > 45 && angle <= 135) return 'bottom';
  if (angle > -135 && angle <= -45) return 'top';
  return 'left';
}

function updateGhostSnail(x, y, angle) {
  if (!ghostSnail) return;
  // 将元素的左上角放置在鼠标指针位置
  ghostSnail.style.left = `${x}px`;
  ghostSnail.style.top = `${y}px`;

  const ghostDirection = getDirectionImage(angle);
  ghostSnail.style.backgroundImage = `url(images/${ghostDirection}.png)`;
  ghostSnail.style.backgroundPositionY = '0px';

  // 使用 transform 将元素向左和向上移动自身宽高的一半，从而实现中心对齐
  ghostSnail.style.transform = `translate(-50%, -50%) scale(${imageScale})`;
}

// 新的、更清晰的时间格式化函数，用于路径预览
function formatCrawlTimeForDisplay(totalMinutes) {
  if (totalMinutes <= 0) return "0秒";

  const totalSeconds = Math.round(totalMinutes * 60);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}天${hours}小时`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}


function drawLineAndTicks(startX, startY, endX, endY, totalMinutes) {
  lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
  lineCtx.beginPath();
  lineCtx.moveTo(startX, startY);
  lineCtx.lineTo(endX, endY);
  lineCtx.strokeStyle = 'rgba(0,0,0,0.6)';
  lineCtx.lineWidth = 2;
  lineCtx.setLineDash([5, 5]);
  lineCtx.stroke();
  lineCtx.setLineDash([]);

  const distance = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
  // 当距离或时间为零时，提前退出，避免无效计算
  if (distance === 0 && totalMinutes <= 0) return;

  const unitX = distance > 0 ? (endX - startX) / distance : 0;
  const unitY = distance > 0 ? (endY - startY) / distance : 0;

  // 动态调整刻度间隔的逻辑保持不变
  let tickIntervalMinutes;
  if (totalMinutes < 20) {
    tickIntervalMinutes = 1;
  } else if (totalMinutes < 120) {
    tickIntervalMinutes = 10;
  } else if (totalMinutes < 600) {
    tickIntervalMinutes = 30;
  } else {
    tickIntervalMinutes = 60;
  }

  const numTicks = Math.floor(totalMinutes / tickIntervalMinutes);

  // 重新计算刻度位置
  // 只有在线条长度和总时间都大于0时才绘制刻度
  if (distance > 0 && totalMinutes > 0) {
    for (let i = 1; i <= numTicks; i++) {
      const minutesForThisTick = i * tickIntervalMinutes;
      // 计算当前刻度时间占总时间的比例
      const timeProportion = minutesForThisTick / totalMinutes;
      // 根据时间比例和总线条长度，计算出刻度的物理位置
      const tickDist = timeProportion * distance;

      const tickX = startX + unitX * tickDist;
      const tickY = startY + unitY * tickDist;
      const perpX = -unitY;
      const perpY = unitX;
      const tickLength = 6;
      lineCtx.beginPath();
      lineCtx.moveTo(tickX - perpX * tickLength, tickY - perpY * tickLength);
      lineCtx.lineTo(tickX + perpX * tickLength, tickY + perpY * tickLength);
      lineCtx.strokeStyle = 'rgba(0,0,0,0.8)';
      lineCtx.lineWidth = 1.5;
      lineCtx.stroke();
      lineCtx.fillStyle = 'black';
      lineCtx.font = 'bold 10px Arial';
      lineCtx.textAlign = 'center';

      const label = tickIntervalMinutes < 60 ?
        `${i * tickIntervalMinutes}m` :
        `${(i * tickIntervalMinutes) / 60}h`;

      lineCtx.fillText(label, tickX + perpX * (tickLength + 5), tickY + perpY * (tickLength + 5) + 3);
    }
  }

  if (totalMinutes > 0 || distance > 0) {
    lineCtx.fillStyle = 'rgba(0,0,0,0.9)';
    lineCtx.font = 'bold 13px Arial';
    lineCtx.textAlign = 'left';

    let timeText = `爬行: ${formatCrawlTimeForDisplay(totalMinutes)}`;

    let textX = endX + 15;
    let textY = endY - 15;
    const textMetrics = lineCtx.measureText(timeText);
    if (textX + textMetrics.width + 5 > lineCanvas.width) textX = endX - textMetrics.width - 15;
    if (textY - 13 < 5) textY = endY + 20;
    if (textY + 5 > lineCanvas.height) textY = lineCanvas.height - 5;
    if (textX < 5) textX = 5;
    lineCtx.fillText(timeText, textX, textY);
  }
}

// 一个集中的函数，用于更新Ctrl+拖动时的状态
function updateCtrlDragState() {
  if (!isCtrlDragging) return;

  const currentMouseX = lastCtrlDragPosition.x;
  const currentMouseY = lastCtrlDragPosition.y;

  const deltaXFromStart = currentMouseX - ctrlDragStartX;
  const deltaYFromStart = currentMouseY - ctrlDragStartY;
  const distanceFromStart = Math.sqrt(deltaXFromStart * deltaXFromStart + deltaYFromStart * deltaYFromStart);

  const distanceBasedMinutes = distanceFromStart / PIXELS_PER_MINUTE;
  const distanceBasedTimeMs = distanceBasedMinutes * MS_PER_MINUTE;

  calculatedCrawlTimeMs = distanceBasedTimeMs + wheelAdjustedTimeMs;

  // 确保总时间不为负数
  if (calculatedCrawlTimeMs < 0) {
    // 如果滚轮减少的时间超过了距离代表的时间，将总时间钳制在0
    calculatedCrawlTimeMs = 0;
    // 同时，修正滚轮调整值，防止其无限减小
    wheelAdjustedTimeMs = -distanceBasedTimeMs;
  }

  const totalMinutes = calculatedCrawlTimeMs / MS_PER_MINUTE;

  drawLineAndTicks(ctrlDragStartX, ctrlDragStartY, currentMouseX, currentMouseY, totalMinutes);

  if (ghostSnail) {
    if (ghostSnail.style.display === 'none') ghostSnail.style.display = 'block';
    const ghostAngle = Math.atan2(deltaYFromStart, deltaXFromStart) * (180 / Math.PI);
    updateGhostSnail(currentMouseX, currentMouseY, ghostAngle);
  }
}


function animate() {
  let animateSpriteThisFrame = false;

  let currentMouseX = window.innerWidth / 2;
  let currentMouseY = window.innerHeight / 2;
  if (typeof utools !== 'undefined' && utools.getCursorScreenPoint) {
    const cursorPos = utools.getCursorScreenPoint();
    currentMouseX = cursorPos.x;
    currentMouseY = cursorPos.y;
  }

  if (isAutoCrawling) {
    const elapsedTime = Date.now() - autoCrawlStartTime;
    if (elapsedTime < autoCrawlDurationMs) {
      // 使用插值计算确保准时到达
      const progress = Math.min(elapsedTime / autoCrawlDurationMs, 1.0); // 进度限制在0到1

      const totalDeltaX = ghostSnailFixedX - autoCrawlStartX;
      const totalDeltaY = ghostSnailFixedY - autoCrawlStartY;

      snailX = autoCrawlStartX + totalDeltaX * progress;
      snailY = autoCrawlStartY + totalDeltaY * progress;

      currentAngle = autoCrawlAngle;
      animateSpriteThisFrame = true;

      // 更新倒计时
      if (countdownTimer) {
        if (countdownTimer.style.display === 'none') countdownTimer.style.display = 'block';
        const remainingMs = autoCrawlDurationMs - elapsedTime;
        countdownTimer.textContent = formatTime(remainingMs);
      }

    } else { // 时间到
      // 精确设置到目标点
      snailX = ghostSnailFixedX;
      snailY = ghostSnailFixedY;

      isAutoCrawling = false;
      isIdleAfterAutoCrawl = true;
      animateSpriteThisFrame = false;
      showFixedGhost = false; // 自动爬行结束，隐藏固定的虚影

      // 隐藏倒计时
      if (countdownTimer) countdownTimer.style.display = 'none';
    }
  } else if (isCtrlDragging) {
    animateSpriteThisFrame = false;
  } else if (isDragging) {
    animateSpriteThisFrame = false;
  } else if (isIdleAfterAutoCrawl) {
    animateSpriteThisFrame = false;
  } else {
    const dx = currentMouseX - snailX;
    const dy = currentMouseY - snailY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 1) {
      animateSpriteThisFrame = true;
      let targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (movementMode === 'constant') {
        const unitX = dx / distance;
        const unitY = dy / distance;
        snailX += unitX * constantSpeed; // 普通跟随使用 constantSpeed
        snailY += unitY * constantSpeed; // 普通跟随使用 constantSpeed
        let angleDifference = normalizeAngle(targetAngle - currentAngle);
        if (Math.abs(angleDifference) <= rotationSpeed) {
          currentAngle = targetAngle;
        } else {
          currentAngle += (angleDifference > 0 ? rotationSpeed : -rotationSpeed);
        }
        currentAngle = normalizeAngle(currentAngle);
      } else if (movementMode === 'easing') {
        snailX += dx * easingFactor;
        snailY += dy * easingFactor;
        currentAngle = targetAngle;
      }
    } else {
      animateSpriteThisFrame = false;
    }
  }

  const newDirection = getDirectionImage(currentAngle);
  if (newDirection !== currentDirection) {
    currentDirection = newDirection;
    snail.style.backgroundImage = `url(images/${currentDirection}.png)`;
  }

  if (animateSpriteThisFrame) {
    frameUpdateCounter++;
    if (frameUpdateCounter >= frameUpdateThreshold) {
      currentFrame = (currentFrame + 1) % frameCount;
      snail.style.backgroundPositionY = `${-currentFrame * frameHeight * imageScale}px`;
      frameUpdateCounter = 0;
    }
  } else {
    currentFrame = 0;
    snail.style.backgroundPositionY = '0px';
  }

  snail.style.left = snailX - (snailWidth * imageScale) / 2 + 'px';
  snail.style.top = snailY - (frameHeight * imageScale) / 2 + 'px';
  snail.style.transform = `scale(${imageScale})`;

  // 更新倒计时的位置
  if (countdownTimer && countdownTimer.style.display !== 'none') {
    // 将计时器放在蜗牛图片的正上方
    const timerTopOffset = 5; // 向上偏移的像素值
    countdownTimer.style.left = snailX + 'px';
    countdownTimer.style.top = snailY - (frameHeight * imageScale / 2) - timerTopOffset + 'px';
  }


  if (ghostSnail) {
    if (showFixedGhost) {
      if (ghostSnail.style.display === 'none') {
        ghostSnail.style.display = 'block';
      }
      updateGhostSnail(ghostSnailFixedX, ghostSnailFixedY, ghostSnailFixedAngle);
    } else if (!isCtrlDragging) {
      if (ghostSnail.style.display !== 'none') {
        ghostSnail.style.display = 'none';
      }
    }
  }
  requestAnimationFrame(animate);
}

function initializeSnailStyles(element) {
  if (!element) return;
  element.style.width = `${snailWidth * imageScale}px`;
  element.style.height = `${frameHeight * imageScale}px`;
  element.style.backgroundSize = `${snailWidth * imageScale}px ${frameCount * frameHeight * imageScale}px`;
  element.style.overflow = 'hidden';
  element.style.backgroundPositionX = '0px';
}

initializeSnailStyles(snail);
initializeSnailStyles(ghostSnail);
if (ghostSnail) {
  ghostSnail.style.backgroundImage = `url(images/${currentDirection}.png)`;
}

snail.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    // 确保在任何拖动开始时都隐藏计时器
    if (countdownTimer) countdownTimer.style.display = 'none';

    showFixedGhost = false;
    if (ghostSnail && ghostSnail.style.display !== 'none') {
      ghostSnail.style.display = 'none';
    }
    if (e.ctrlKey) {
      // 激活事件护盾
      if (eventShield) eventShield.style.display = 'block';
      isCtrlDragging = true;
      isDragging = false;
      isAutoCrawling = false;
      isIdleAfterAutoCrawl = false;
      ctrlDragStartX = snailX;
      ctrlDragStartY = snailY;
      calculatedCrawlTimeMs = 0;
      wheelAdjustedTimeMs = 0; // 重置滚轮调整的时间
      lastCtrlDragPosition = { x: e.clientX, y: e.clientY }; // 记录初始鼠标位置
      lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      if (ghostSnail) {
        ghostSnail.style.display = 'block';
        updateCtrlDragState(); // 立即更新一次状态以显示初始线条
      }
    } else {
      isDragging = true;
      isCtrlDragging = false;
      isAutoCrawling = false;
      isIdleAfterAutoCrawl = false;
      lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
      const rect = snail.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
    }
    e.preventDefault();
  }
});

// 将事件监听器绑定到 window 对象
window.addEventListener('mousemove', (e) => {
  if (isCtrlDragging) {
    // 只更新位置并调用状态更新函数
    lastCtrlDragPosition = { x: e.clientX, y: e.clientY };
    updateCtrlDragState();
    e.preventDefault();
  } else if (isDragging) {
    snailX = e.clientX - dragOffsetX + (snailWidth * imageScale) / 2;
    snailY = e.clientY - dragOffsetY + (frameHeight * imageScale) / 2;
    e.preventDefault();
  }
});

// 将事件监听器绑定到 window 对象
window.addEventListener('wheel', (e) => {
  if (isCtrlDragging) {
    e.preventDefault(); // 阻止页面因滚轮而滚动

    // 按住Shift键可进行更大幅度的时间调整
    const timeStep = e.shiftKey ? 10 * 60 * 1000 : 30 * 1000; // Shift: 10分钟, 正常: 30秒

    if (e.deltaY < 0) {
      // 向上滚动，增加时间
      wheelAdjustedTimeMs += timeStep;
    } else {
      // 向下滚动，减少时间
      wheelAdjustedTimeMs -= timeStep;
    }

    updateCtrlDragState(); // 更新UI显示
  }
}, { passive: false }); // 设置 passive: false 以允许 preventDefault

// 将事件监听器绑定到 window 对象
window.addEventListener('mouseup', (e) => {
  // 隐藏事件护盾
  if (eventShield) eventShield.style.display = 'none';
  if (isCtrlDragging) {
    isCtrlDragging = false;
    lineCtx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
    if (calculatedCrawlTimeMs > 500) { // 设置一个小的阈值，避免微小抖动触发
      const dragEndX = lastCtrlDragPosition.x; // 使用最后记录的位置
      const dragEndY = lastCtrlDragPosition.y;
      const deltaX = dragEndX - ctrlDragStartX;
      const deltaY = dragEndY - ctrlDragStartY;

      isAutoCrawling = true;
      autoCrawlStartTime = Date.now();
      autoCrawlDurationMs = calculatedCrawlTimeMs;
      autoCrawlAngle = (deltaX === 0 && deltaY === 0) ? currentAngle : Math.atan2(deltaY, deltaX) * (180 / Math.PI);


      // 记录自动爬行的起点
      autoCrawlStartX = snailX; // 使用当前蜗牛位置作为起点
      autoCrawlStartY = snailY;

      ghostSnailFixedX = dragEndX; // 目标点是鼠标最后的位置
      ghostSnailFixedY = dragEndY;
      ghostSnailFixedAngle = autoCrawlAngle; // 虚影朝向目标方向
      showFixedGhost = true;

      // 在开始爬行时显示计时器
      if (countdownTimer) countdownTimer.style.display = 'block';

    } else {
      isIdleAfterAutoCrawl = false;
      showFixedGhost = false;
      if (ghostSnail) ghostSnail.style.display = 'none';
    }
    calculatedCrawlTimeMs = 0;
    wheelAdjustedTimeMs = 0;
  }
  if (isDragging) {
    isDragging = false;
  }
});

// 双击蜗牛，关闭窗口
snail.addEventListener('dblclick', (e) => {
  window.close();
});

snail.style.left = snailX - (snailWidth * imageScale) / 2 + 'px';
snail.style.top = snailY - (frameHeight * imageScale) / 2 + 'px';
snail.style.backgroundImage = `url(images/${currentDirection}.png)`;

animate();
