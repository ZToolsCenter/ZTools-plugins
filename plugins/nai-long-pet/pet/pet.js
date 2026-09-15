var TOTAL = 122;
var LO = 1;
var HI = 15;
var ACT_LO = 20;
var ACT_HI = 122;
var DELAY = 50;

var images = [];
for (var i = 1; i <= TOTAL; i++) {
  var img = new Image();
  img.src = "../image/" + i + "fomat.png";
  images.push(img);
}

var audioFiles = ["1.mp3", "2.mp3"];

var currentFrame = 1;
var direction = 1;
var acting = false;
var phase = 0;
var waitCount = 0;
var currentAudio = null;

var petImg = document.getElementById("pet");

function tick() {
  petImg.src = images[currentFrame - 1].src;

  if (!acting) {
    if (waitCount > 0) {
      waitCount--;
    } else {
      var nxt = currentFrame + direction;
      if (nxt > HI) {
        direction = -1;
        waitCount = Math.floor(Math.random() * 201) + 100;
      } else if (nxt < LO) {
        direction = 1;
        waitCount = Math.floor(Math.random() * 201) + 100;
      } else {
        currentFrame = nxt;
      }
    }
  } else {
    if (phase === 0) {
      if (currentFrame < ACT_HI) {
        currentFrame++;
      } else {
        if (currentAudio && !currentAudio.paused && !currentAudio.ended) {
          phase = 1;
          direction = -1;
        } else {
          stopActing();
        }
      }
    } else {
      if (currentFrame <= ACT_LO) {
        direction = 1;
      } else if (currentFrame >= ACT_HI) {
        direction = -1;
      }
      currentFrame += direction;
      if (!currentAudio || currentAudio.ended) {
        stopActing();
      }
    }
  }

  setTimeout(tick, DELAY);
}

function stopActing() {
  acting = false;
  phase = 0;
  waitCount = 0;
  if (currentFrame > HI) {
    currentFrame = HI;
    direction = -1;
  }
}

function playRandomAudio() {
  var file = audioFiles[Math.floor(Math.random() * audioFiles.length)];
  var audio = new Audio("../music/" + file);
  currentAudio = audio;
  acting = true;
  phase = 0;
  audio.play().catch(function () {});
}

var isDragging = false;
var dragActive = false;
var lastX = 0;
var lastY = 0;
var dpr = window.devicePixelRatio || 1;

petImg.addEventListener("mousedown", function (e) {
  if (e.button === 0) {
    isDragging = true;
    dragActive = false;
    lastX = e.screenX;
    lastY = e.screenY;
  }
});

document.addEventListener("mousemove", function (e) {
  if (!isDragging) return;
  var dx = e.screenX - lastX;
  var dy = e.screenY - lastY;
  lastX = e.screenX;
  lastY = e.screenY;
  if (!dragActive) {
    if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    dragActive = true;
  }
  window.moveBy(Math.round(dx * dpr), Math.round(dy * dpr));
});

document.addEventListener("mouseup", function (e) {
  if (e.button === 0) {
    if (!dragActive && !acting) {
      playRandomAudio();
    }
    isDragging = false;
  }
});

document.addEventListener("contextmenu", function (e) {
  e.preventDefault();
  window.close();
});

tick();
