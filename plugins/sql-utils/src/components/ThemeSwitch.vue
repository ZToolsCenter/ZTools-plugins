<template>
  <label class="switch">
    <input id="input" type="checkbox" :checked="isDark" @change="toggleTheme" />
    <div class="slider round">
      <div class="sun-moon">
        <svg id="moon-dot-1" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="moon-dot-2" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="moon-dot-3" class="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="light-ray-1" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="light-ray-2" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="light-ray-3" class="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-1" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-2" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-3" class="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-4" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-5" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
        <svg id="cloud-6" class="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"></circle></svg>
      </div>
      <div class="stars">
        <svg id="star-1" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
        <svg id="star-2" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
        <svg id="star-3" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
        <svg id="star-4" class="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z"></path></svg>
      </div>
    </div>
  </label>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAppStore } from '@/store'

const store = useAppStore()
const isDark = ref(false)

function toggleTheme() {
  isDark.value = !isDark.value
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  store.updateIsDarkTheme(isDark.value)
}

onMounted(() => {
  const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)').matches
  const savedTheme = localStorage.getItem('theme')
  isDark.value = savedTheme ? savedTheme === 'dark' : prefersDarkScheme
  store.updateIsDarkTheme(isDark.value)
})
</script>

<style scoped>
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 23px;
}

.switch #input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #2196f3;
  -webkit-transition: 0.4s;
  z-index: 0;
  overflow: hidden;
  box-shadow: 0 0 25px rgba(220, 230, 255, 0.35),
  0 0 50px rgba(200, 215, 255, 0.2),
  0 0 75px rgba(180, 200, 255, 0.1) !important;
  transition: box-shadow 0.6s ease-in-out;
}

.sun-moon {
  position: absolute;
  content: "";
  height: 17px;
  width: 17px;
  left: 3px;
  bottom: 3px;
  background-color: yellow;
  -webkit-transition: 0.4s;
  transition: 0.4s;
}

#input:checked + .slider {
  background-color: black;
}

#input:focus + .slider {
  box-shadow: 0 0 1px #2196f3;
}

#input:checked + .slider .sun-moon {
  -webkit-transform: translateX(26px);
  -ms-transform: translateX(26px);
  transform: translateX(26px);
  background-color: white;
  -webkit-animation: rotate-center 0.6s ease-in-out both;
  animation: rotate-center 0.6s ease-in-out both;
  box-shadow: 0 0 12px rgba(255, 215, 0, 0.8);
}

.moon-dot {
  opacity: 0;
  transition: 0.4s;
  fill: gray;
}

#input:checked + .slider .sun-moon .moon-dot {
  opacity: 1;
}

.slider.round {
  border-radius: 23px;
}

.slider.round .sun-moon {
  border-radius: 50%;
}

#moon-dot-1 { left: 7px; top: 2px; position: absolute; width: 4px; height: 4px; z-index: 4; }
#moon-dot-2 { left: 1px; top: 7px; position: absolute; width: 7px; height: 7px; z-index: 4; }
#moon-dot-3 { left: 11px; top: 12px; position: absolute; width: 2px; height: 2px; z-index: 4; }

#light-ray-1 { left: -5px; top: -5px; position: absolute; width: 29px; height: 29px; z-index: -1; fill: white; opacity: 10%; }
#light-ray-2 { left: -34px; top: -34px; position: absolute; width: 37px; height: 37px; z-index: -1; fill: white; opacity: 10%; }
#light-ray-3 { left: -12px; top: -12px; position: absolute; width: 40px; height: 40px; z-index: -1; fill: white; opacity: 10%; }

.cloud-light { position: absolute; fill: #eee; animation-name: cloud-move; animation-duration: 6s; animation-iteration-count: infinite; }
.cloud-dark { position: absolute; fill: #ccc; animation-name: cloud-move; animation-duration: 6s; animation-iteration-count: infinite; animation-delay: 1s; }

#cloud-1 { left: 20px; top: 10px; width: 27px; }
#cloud-2 { left: 29px; top: 7px; width: 13px; }
#cloud-3 { left: 12px; top: 16px; width: 20px; }
#cloud-4 { left: 24px; top: 12px; width: 27px; }
#cloud-5 { left: 32px; top: 9px; width: 13px; }
#cloud-6 { left: 15px; top: 17px; width: 20px; }

@keyframes cloud-move {
  0% { transform: translateX(0px); }
  40% { transform: translateX(4px); }
  80% { transform: translateX(-4px); }
  100% { transform: translateX(0px); }
}

.stars { transform: translateY(-21px); opacity: 0; transition: 0.4s; }

.star { fill: white; position: absolute; -webkit-transition: 0.4s; transition: 0.4s; animation-name: star-twinkle; animation-duration: 2s; animation-iteration-count: infinite; }

#input:checked + .slider .stars { -webkit-transform: translateY(0); -ms-transform: translateY(0); transform: translateY(0); opacity: 1; }

#star-1 { width: 13px; top: 1px; left: 2px; animation-delay: 0.3s; }
#star-2 { width: 4px; top: 11px; left: 2px; }
#star-3 { width: 8px; top: 13px; left: 7px; animation-delay: 0.6s; }
#star-4 { width: 12px; top: 0; left: 12px; animation-delay: 1.3s; }

@keyframes star-twinkle {
  0% { transform: scale(1); }
  40% { transform: scale(1.2); }
  80% { transform: scale(0.8); }
  100% { transform: scale(1); }
}
</style>
