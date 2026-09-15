<template>
  <div class="emoji-picker">
    <!-- 搜索框和分类标签 -->
    <div class="header-section">
      <div class="search-wrapper">
        <el-input
          v-model="searchQuery"
          placeholder="搜索表情（支持拼音、关键词）"
          prefix-icon="Search"
          clearable
          @focus="showSuggestions = true"
          @blur="handleBlur"
          @keyup.enter="handleSearchConfirm"
        />
        <!-- 搜索建议下拉框 -->
        <div
          v-if="showSuggestions && (searchSuggestions.length > 0 || searchHistory.length > 0)"
          class="search-suggestions"
        >
          <!-- 搜索历史 -->
          <div v-if="searchHistory.length > 0 && !searchQuery" class="suggestion-section">
            <div class="suggestion-header">
              <span>搜索历史</span>
              <el-button link size="small" @click="clearSearchHistory">清除</el-button>
            </div>
            <div class="suggestion-tags">
              <el-tag
                v-for="item in searchHistory"
                :key="item"
                class="suggestion-tag"
                @click="searchQuery = item"
              >
                {{ item }}
              </el-tag>
            </div>
          </div>
          <!-- 搜索建议 -->
          <div v-if="searchSuggestions.length > 0" class="suggestion-section">
            <div class="suggestion-header">
              <span>搜索建议</span>
            </div>
            <div
              v-for="suggestion in searchSuggestions"
              :key="suggestion"
              class="suggestion-item"
              @mousedown.prevent="searchQuery = suggestion"
            >
              <i class="el-icon-Search"></i>
              <span>{{ suggestion }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="category-tabs">
        <div 
          v-for="category in categories" 
          :key="category.id"
          class="category-tab"
          :class="{ 
            active: activeCategory === category.id,
            disabled: searchQuery && !visibleCategories.includes(category)
          }"
          :title="category.name"
          @click="scrollToCategory(category.id)"
        >
          {{ category.icon }}
        </div>
      </div>
    </div>

    <!-- 使用虚拟滚动优化性能 -->
    <el-scrollbar 
      ref="scrollbarRef"
      height="calc(100vh - 180px)" 
      class="emoji-content-container"
      @scroll="throttledHandleScroll"
    >
      <!-- 最近使用 -->
      <div class="emoji-section" v-if="recentEmojis.length && !searchQuery">
        <h3 class="section-title">最近使用</h3>
        <div class="emoji-grid">
          <div
            v-for="emoji in recentEmojis"
            :key="emoji.char"
            class="emoji-item"
            @click="handleEmojiClick(emoji)"
            @dblclick="handleEmojiDoubleClick(emoji)"
            :title="emoji.name"
          >
            {{ emoji.char }}
          </div>
        </div>
      </div>

      <!-- 所有分类的表情 -->
      <div class="emoji-content">
        <div 
          v-for="category in visibleCategories" 
          :key="category.id"
          :id="category.id"
          class="emoji-section"
          ref="categoryRefs"
        >
          <h3 class="section-title">{{ category.name }}</h3>
          <div class="emoji-grid">
            <div
              v-for="emoji in getCategoryEmojis(category.id)"
              :key="emoji.char"
              class="emoji-item"
              @click="handleEmojiClick(emoji)"
              @dblclick="handleEmojiDoubleClick(emoji)"
              :title="emoji.name"
            >
              {{ emoji.char }}
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
// 使用自定义 throttle 函数替代 lodash
type ThrottledFunction<T extends (...args: any[]) => void> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void
}

const throttle = <T extends (...args: any[]) => void>(func: T, delay: number): ThrottledFunction<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastExecTime = 0

  const throttled = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
    const currentTime = Date.now()
    
    if (currentTime - lastExecTime > delay) {
      func.apply(this, args)
      lastExecTime = currentTime
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        func.apply(this, args)
        lastExecTime = Date.now()
        timeoutId = null
      }, delay - (currentTime - lastExecTime))
    }
  } as ThrottledFunction<T>

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return throttled
}

// emoji 数据结构
interface Emoji {
  char: string
  name: string
  category: string
  pinyin?: string[]        // 拼音（全拼）
  py?: string[]            // 拼音首字母（简拼）
  keywords?: string[]      // 额外关键词/别名
}

// 常用拼音映射表（用于动态匹配）
const pinyinMap: Record<string, { full: string[], short: string[] }> = {
  '笑': { full: ['xiao'], short: ['x'] },
  '哭': { full: ['ku'], short: ['k'] },
  '爱': { full: ['ai'], short: ['a'] },
  '心': { full: ['xin'], short: ['x'] },
  '手': { full: ['shou'], short: ['s'] },
  '人': { full: ['ren'], short: ['r'] },
  '男': { full: ['nan'], short: ['n'] },
  '女': { full: ['nv'], short: ['n'] },
  '衣': { full: ['yi'], short: ['y'] },
  '服': { full: ['fu'], short: ['f'] },
  '猫': { full: ['mao'], short: ['m'] },
  '狗': { full: ['gou'], short: ['g'] },
  '食': { full: ['shi'], short: ['s'] },
  '果': { full: ['guo'], short: ['g'] },
  '车': { full: ['che'], short: ['c'] },
  '飞': { full: ['fei'], short: ['f'] },
  '机': { full: ['ji'], short: ['j'] },
  '船': { full: ['chuan'], short: ['c'] },
  '家': { full: ['jia'], short: ['j'] },
  '书': { full: ['shu'], short: ['s'] },
  '电': { full: ['dian'], short: ['d'] },
  '话': { full: ['hua'], short: ['h'] },
  '星': { full: ['xing'], short: ['x'] },
  '月': { full: ['yue'], short: ['y'] },
  '太': { full: ['tai'], short: ['t'] },
  '阳': { full: ['yang'], short: ['y'] },
  '雨': { full: ['yu'], short: ['y'] },
  '雪': { full: ['xue'], short: ['x'] },
  '花': { full: ['hua'], short: ['h'] },
  '树': { full: ['shu'], short: ['s'] },
  '山': { full: ['shan'], short: ['s'] },
  '水': { full: ['shui'], short: ['s'] },
  '火': { full: ['huo'], short: ['h'] },
  '土': { full: ['tu'], short: ['t'] },
  '金': { full: ['jin'], short: ['j'] },
  '木': { full: ['mu'], short: ['m'] },
  '左': { full: ['zuo'], short: ['z'] },
  '右': { full: ['you'], short: ['y'] },
  '上': { full: ['shang'], short: ['s'] },
  '下': { full: ['xia'], short: ['x'] },
  '大': { full: ['da'], short: ['d'] },
  '小': { full: ['xiao'], short: ['x'] },
  '中': { full: ['zhong'], short: ['z'] },
  '国': { full: ['guo'], short: ['g'] },
  '红': { full: ['hong'], short: ['h'] },
  '绿': { full: ['lv'], short: ['l'] },
  '蓝': { full: ['lan'], short: ['l'] },
  '黄': { full: ['huang'], short: ['h'] },
  '白': { full: ['bai'], short: ['b'] },
  '黑': { full: ['hei'], short: ['h'] },
  '色': { full: ['se'], short: ['s'] },
  '新': { full: ['xin'], short: ['x'] },
  '年': { full: ['nian'], short: ['n'] },
  '生': { full: ['sheng'], short: ['s'] },
  '日': { full: ['ri'], short: ['r'] },
  '快': { full: ['kuai'], short: ['k'] },
  '乐': { full: ['le'], short: ['l'] },
  '礼': { full: ['li'], short: ['l'] },
  '物': { full: ['wu'], short: ['w'] },
  '钱': { full: ['qian'], short: ['q'] },
  '糖': { full: ['tang'], short: ['t'] },
  '酒': { full: ['jiu'], short: ['j'] },
  '茶': { full: ['cha'], short: ['c'] },
  '杯': { full: ['bei'], short: ['b'] },
  '刀': { full: ['dao'], short: ['d'] },
  '剑': { full: ['jian'], short: ['j'] },
  '枪': { full: ['qiang'], short: ['q'] },
  '球': { full: ['qiu'], short: ['q'] },
  '足': { full: ['zu'], short: ['z'] },
  '面': { full: ['mian'], short: ['m'] },
  '包': { full: ['bao'], short: ['b'] },
  '米': { full: ['mi'], short: ['m'] },
  '肉': { full: ['rou'], short: ['r'] },
  '鱼': { full: ['yu'], short: ['y'] },
  '蛋': { full: ['dan'], short: ['d'] },
  '奶': { full: ['nai'], short: ['n'] },
  '瓜': { full: ['gua'], short: ['g'] },
  '菜': { full: ['cai'], short: ['c'] },
  '牛': { full: ['niu'], short: ['n'] },
  '羊': { full: ['yang'], short: ['y'] },
  '猪': { full: ['zhu'], short: ['z'] },
  '鸡': { full: ['ji'], short: ['j'] },
  '鸭': { full: ['ya'], short: ['y'] },
  '鸟': { full: ['niao'], short: ['n'] },
  '兔': { full: ['tu'], short: ['t'] },
  '熊': { full: ['xiong'], short: ['x'] },
  '狮': { full: ['shi'], short: ['s'] },
  '虎': { full: ['hu'], short: ['h'] },
  '龙': { full: ['long'], short: ['l'] },
  '蛇': { full: ['she'], short: ['s'] },
  '马': { full: ['ma'], short: ['m'] },
  '猴': { full: ['hou'], short: ['h'] },
  '象': { full: ['xiang'], short: ['x'] },
  '鼠': { full: ['shu'], short: ['s'] },
  '眼': { full: ['yan'], short: ['y'] },
  '泪': { full: ['lei'], short: ['l'] },
  '嘴': { full: ['zui'], short: ['z'] },
  '脸': { full: ['lian'], short: ['l'] },
  '头': { full: ['tou'], short: ['t'] },
  '身': { full: ['shen'], short: ['s'] },
  '体': { full: ['ti'], short: ['t'] },
  '热': { full: ['re'], short: ['r'] },
  '冷': { full: ['leng'], short: ['l'] },
  '好': { full: ['hao'], short: ['h'] },
  '坏': { full: ['huai'], short: ['h'] },
  '真': { full: ['zhen'], short: ['z'] },
  '假': { full: ['jia'], short: ['j'] },
  '开': { full: ['kai'], short: ['k'] },
  '关': { full: ['guan'], short: ['g'] },
  '进': { full: ['jin'], short: ['j'] },
  '出': { full: ['chu'], short: ['c'] },
  '来': { full: ['lai'], short: ['l'] },
  '去': { full: ['qu'], short: ['q'] },
  '回': { full: ['hui'], short: ['h'] },
  '走': { full: ['zou'], short: ['z'] },
  '跑': { full: ['pao'], short: ['p'] },
  '站': { full: ['zhan'], short: ['z'] },
  '坐': { full: ['zuo'], short: ['z'] },
  '睡': { full: ['shui'], short: ['s'] },
  '醒': { full: ['xing'], short: ['x'] },
  '想': { full: ['xiang'], short: ['x'] },
  '看': { full: ['kan'], short: ['k'] },
  '听': { full: ['ting'], short: ['t'] },
  '说': { full: ['shuo'], short: ['s'] },
  '唱': { full: ['chang'], short: ['c'] },
  '跳': { full: ['tiao'], short: ['t'] },
  '打': { full: ['da'], short: ['d'] },
  '抱': { full: ['bao'], short: ['b'] },
  '亲': { full: ['qin'], short: ['q'] },
  '摸': { full: ['mo'], short: ['m'] },
  '拍': { full: ['pai'], short: ['p'] },
  '指': { full: ['zhi'], short: ['z'] },
  '举': { full: ['ju'], short: ['j'] },
  '握': { full: ['wo'], short: ['w'] },
  '赞': { full: ['zan'], short: ['z'] },
  '拳': { full: ['quan'], short: ['q'] },
  '掌': { full: ['zhang'], short: ['z'] },
  '耶': { full: ['ye'], short: ['y'] },
  '比': { full: ['bi'], short: ['b'] },
  '划': { full: ['hua'], short: ['h'] },
  '动': { full: ['dong'], short: ['d'] },
  '作': { full: ['zuo'], short: ['z'] },
  '礼': { full: ['li'], short: ['l'] },
  '拜': { full: ['bai'], short: ['b'] },
  '祈': { full: ['qi'], short: ['q'] },
  '祷': { full: ['dao'], short: ['d'] },
  '庆': { full: ['qing'], short: ['q'] },
  '祝': { full: ['zhu'], short: ['z'] },
  '贺': { full: ['he'], short: ['h'] },
  '喜': { full: ['xi'], short: ['x'] },
  '怒': { full: ['nu'], short: ['n'] },
  '哀': { full: ['ai'], short: ['a'] },
  '惧': { full: ['ju'], short: ['j'] },
  '惊': { full: ['jing'], short: ['j'] },
  '慌': { full: ['huang'], short: ['h'] },
  '张': { full: ['zhang'], short: ['z'] },
  '害': { full: ['hai'], short: ['h'] },
  '羞': { full: ['xiu'], short: ['x'] },
  '惭': { full: ['can'], short: ['c'] },
  '愧': { full: ['kui'], short: ['k'] },
  '傲': { full: ['ao'], short: ['a'] },
  '骄': { full: ['jiao'], short: ['j'] },
  '谦': { full: ['qian'], short: ['q'] },
  '虚': { full: ['xu'], short: ['x'] },
  '疲': { full: ['pi'], short: ['p'] },
  '倦': { full: ['juan'], short: ['j'] },
  '困': { full: ['kun'], short: ['k'] },
  '惑': { full: ['huo'], short: ['h'] },
  '迷': { full: ['mi'], short: ['m'] },
  '茫': { full: ['mang'], short: ['m'] },
  '闷': { full: ['men'], short: ['m'] },
  '烦': { full: ['fan'], short: ['f'] },
  '恼': { full: ['nao'], short: ['n'] },
  '怒': { full: ['nu'], short: ['n'] },
  '气': { full: ['qi'], short: ['q'] },
  '愤': { full: ['fen'], short: ['f'] },
  '满': { full: ['man'], short: ['m'] },
  '足': { full: ['zu'], short: ['z'] },
  '失': { full: ['shi'], short: ['s'] },
  '望': { full: ['wang'], short: ['w'] },
  '沮': { full: ['ju'], short: ['j'] },
  '丧': { full: ['sang'], short: ['s'] },
  '痛': { full: ['tong'], short: ['t'] },
  '苦': { full: ['ku'], short: ['k'] },
  '悲': { full: ['bei'], short: ['b'] },
  '伤': { full: ['shang'], short: ['s'] },
  '难': { full: ['nan'], short: ['n'] },
  '过': { full: ['guo'], short: ['g'] },
  '无': { full: ['wu'], short: ['w'] },
  '奈': { full: ['nai'], short: ['n'] },
  '郁': { full: ['yu'], short: ['y'] },
  '闷': { full: ['men'], short: ['m'] },
  '急': { full: ['ji'], short: ['j'] },
  '切': { full: ['qie'], short: ['q'] },
  '焦': { full: ['jiao'], short: ['j'] },
  '虑': { full: ['lv'], short: ['l'] },
  '担': { full: ['dan'], short: ['d'] },
  '心': { full: ['xin'], short: ['x'] },
  '害': { full: ['hai'], short: ['h'] },
  '怕': { full: ['pa'], short: ['p'] },
  '恐': { full: ['kong'], short: ['k'] },
  '惧': { full: ['ju'], short: ['j'] },
  '惊': { full: ['jing'], short: ['j'] },
  '讶': { full: ['ya'], short: ['y'] },
  '意': { full: ['yi'], short: ['y'] },
  '外': { full: ['wai'], short: ['w'] },
  '震': { full: ['zhen'], short: ['z'] },
  '惊': { full: ['jing'], short: ['j'] },
  '呆': { full: ['dai'], short: ['d'] },
  '愣': { full: ['leng'], short: ['l'] },
  '傻': { full: ['sha'], short: ['s'] },
  '萌': { full: ['meng'], short: ['m'] },
  '可': { full: ['ke'], short: ['k'] },
  '怜': { full: ['lian'], short: ['l'] },
  '讨': { full: ['tao'], short: ['t'] },
  '喜': { full: ['xi'], short: ['x'] },
  '兴': { full: ['xing'], short: ['x'] },
  '奋': { full: ['fen'], short: ['f'] },
  '激': { full: ['ji'], short: ['j'] },
  '昂': { full: ['ang'], short: ['a'] },
  '扬': { full: ['yang'], short: ['y'] },
  '得': { full: ['de'], short: ['d'] },
  '瑟': { full: ['se'], short: ['s'] },
  '洋': { full: ['yang'], short: ['y'] },
  '自': { full: ['zi'], short: ['z'] },
  '信': { full: ['xin'], short: ['x'] },
  '满': { full: ['man'], short: ['m'] },
  '骄': { full: ['jiao'], short: ['j'] },
  '傲': { full: ['ao'], short: ['a'] },
  '舒': { full: ['shu'], short: ['s'] },
  '坦': { full: ['tan'], short: ['t'] },
  '安': { full: ['an'], short: ['a'] },
  '放': { full: ['fang'], short: ['f'] },
  '松': { full: ['song'], short: ['s'] },
  '惬': { full: ['qie'], short: ['q'] },
  '意': { full: ['yi'], short: ['y'] },
  '悠': { full: ['you'], short: ['y'] },
  '闲': { full: ['xian'], short: ['x'] },
  '静': { full: ['jing'], short: ['j'] },
  '宁': { full: ['ning'], short: ['n'] },
  '平': { full: ['ping'], short: ['p'] },
  '和': { full: ['he'], short: ['h'] },
  '祥': { full: ['xiang'], short: ['x'] },
  '温': { full: ['wen'], short: ['w'] },
  '馨': { full: ['xin'], short: ['x'] },
  '浪': { full: ['lang'], short: ['l'] },
  '漫': { full: ['man'], short: ['m'] },
  '甜': { full: ['tian'], short: ['t'] },
  '蜜': { full: ['mi'], short: ['m'] },
  '幸': { full: ['xing'], short: ['x'] },
  '福': { full: ['fu'], short: ['f'] },
  '美': { full: ['mei'], short: ['m'] },
  '好': { full: ['hao'], short: ['h'] },
  '赞': { full: ['zan'], short: ['z'] },
  '叹': { full: ['tan'], short: ['t'] },
  '佩': { full: ['pei'], short: ['p'] },
  '服': { full: ['fu'], short: ['f'] },
  '敬': { full: ['jing'], short: ['j'] },
  '佩': { full: ['pei'], short: ['p'] },
  '尊': { full: ['zun'], short: ['z'] },
  '崇': { full: ['chong'], short: ['c'] },
  '感': { full: ['gan'], short: ['g'] },
  '激': { full: ['ji'], short: ['j'] },
  '感': { full: ['gan'], short: ['g'] },
  '动': { full: ['dong'], short: ['d'] },
  '欣': { full: ['xin'], short: ['x'] },
  '喜': { full: ['xi'], short: ['x'] },
  '狂': { full: ['kuang'], short: ['k'] },
  '欢': { full: ['huan'], short: ['h'] },
  '欣': { full: ['xin'], short: ['x'] },
  '慰': { full: ['wei'], short: ['w'] },
  '满': { full: ['man'], short: ['m'] },
  '足': { full: ['zu'], short: ['z'] },
  '骄': { full: ['jiao'], short: ['j'] },
  '傲': { full: ['ao'], short: ['a'] },
  '自': { full: ['zi'], short: ['z'] },
  '豪': { full: ['hao'], short: ['h'] },
  '得': { full: ['de'], short: ['d'] },
  '意': { full: ['yi'], short: ['y'] },
  '跃': { full: ['yue'], short: ['y'] },
  '跃': { full: ['yue'], short: ['y'] },
  '欲': { full: ['yu'], short: ['y'] },
  '试': { full: ['shi'], short: ['s'] },
  '迫': { full: ['po'], short: ['p'] },
  '不': { full: ['bu'], short: ['b'] },
  '及': { full: ['ji'], short: ['j'] },
  '待': { full: ['dai'], short: ['d'] },
  '跃': { full: ['yue'], short: ['y'] },
  '跃': { full: ['yue'], short: ['y'] },
  '兴': { full: ['xing'], short: ['x'] },
  '冲': { full: ['chong'], short: ['c'] },
  '冲': { full: ['chong'], short: ['c'] },
  '干': { full: ['gan'], short: ['g'] },
  '劲': { full: ['jin'], short: ['j'] },
  '十': { full: ['shi'], short: ['s'] },
  '足': { full: ['zu'], short: ['z'] },
  '信': { full: ['xin'], short: ['x'] },
  '心': { full: ['xin'], short: ['x'] },
  '百': { full: ['bai'], short: ['b'] },
  '倍': { full: ['bei'], short: ['b'] },
  '鼓': { full: ['gu'], short: ['g'] },
  '舞': { full: ['wu'], short: ['w'] },
  '欢': { full: ['huan'], short: ['h'] },
  '欣': { full: ['xin'], short: ['x'] },
  '鼓': { full: ['gu'], short: ['g'] },
  '舞': { full: ['wu'], short: ['w'] },
  '雀': { full: ['que'], short: ['q'] },
  '跃': { full: ['yue'], short: ['y'] },
  '手': { full: ['shou'], short: ['s'] },
  '舞': { full: ['wu'], short: ['w'] },
  '足': { full: ['zu'], short: ['z'] },
  '蹈': { full: ['dao'], short: ['d'] },
  '眉': { full: ['mei'], short: ['m'] },
  '飞': { full: ['fei'], short: ['f'] },
  '色': { full: ['se'], short: ['s'] },
  '舞': { full: ['wu'], short: ['w'] },
  '洋': { full: ['yang'], short: ['y'] },
  '溢': { full: ['yi'], short: ['y'] },
  '喜': { full: ['xi'], short: ['x'] },
  '上': { full: ['shang'], short: ['s'] },
  '眉': { full: ['mei'], short: ['m'] },
  '梢': { full: ['shao'], short: ['s'] },
  '笑': { full: ['xiao'], short: ['x'] },
  '逐': { full: ['zhu'], short: ['z'] },
  '颜': { full: ['yan'], short: ['y'] },
  '开': { full: ['kai'], short: ['k'] },
  '哈': { full: ['ha'], short: ['h'] },
  '哈': { full: ['ha'], short: ['h'] },
  '大': { full: ['da'], short: ['d'] },
  '捧': { full: ['peng'], short: ['p'] },
  '腹': { full: ['fu'], short: ['f'] },
  '前': { full: ['qian'], short: ['q'] },
  '仰': { full: ['yang'], short: ['y'] },
  '后': { full: ['hou'], short: ['h'] },
  '合': { full: ['he'], short: ['h'] },
  '乐': { full: ['le'], short: ['l'] },
  '不': { full: ['bu'], short: ['b'] },
  '可': { full: ['ke'], short: ['k'] },
  '支': { full: ['zhi'], short: ['z'] },
  '忍': { full: ['ren'], short: ['r'] },
  '俊': { full: ['jun'], short: ['j'] },
  '不': { full: ['bu'], short: ['b'] },
  '禁': { full: ['jin'], short: ['j'] },
  '噗': { full: ['pu'], short: ['p'] },
  '嗤': { full: ['chi'], short: ['c'] },
  '以': { full: ['yi'], short: ['y'] },
  '一': { full: ['yi'], short: ['y'] },
  '为': { full: ['wei'], short: ['w'] },
  '哄': { full: ['hong'], short: ['h'] },
  '堂': { full: ['tang'], short: ['t'] },
  '大': { full: ['da'], short: ['d'] },
  '笑': { full: ['xiao'], short: ['x'] },
  '破': { full: ['po'], short: ['p'] },
  '涕': { full: ['ti'], short: ['t'] },
  '为': { full: ['wei'], short: ['w'] },
  '转': { full: ['zhuan'], short: ['z'] },
  '悲': { full: ['bei'], short: ['b'] },
  '为': { full: ['wei'], short: ['w'] },
  '欢': { full: ['huan'], short: ['h'] },
  '流': { full: ['liu'], short: ['l'] },
  '眼': { full: ['yan'], short: ['y'] },
  '泪': { full: ['lei'], short: ['l'] },
  '感': { full: ['gan'], short: ['g'] },
  '极': { full: ['ji'], short: ['j'] },
  '而': { full: ['er'], short: ['e'] },
  '泣': { full: ['qi'], short: ['q'] },
  '欣': { full: ['xin'], short: ['x'] },
  '慰': { full: ['wei'], short: ['w'] },
  '酸': { full: ['suan'], short: ['s'] },
  '鼻': { full: ['bi'], short: ['b'] },
  '热': { full: ['re'], short: ['r'] },
  '泪': { full: ['lei'], short: ['l'] },
  '盈': { full: ['ying'], short: ['y'] },
  '眶': { full: ['kuang'], short: ['k'] },
  '含': { full: ['han'], short: ['h'] },
  '泪': { full: ['lei'], short: ['l'] },
  '欲': { full: ['yu'], short: ['y'] },
  '泣': { full: ['qi'], short: ['q'] },
  '哽': { full: ['geng'], short: ['g'] },
  '咽': { full: ['yan'], short: ['y'] },
  '抽': { full: ['chou'], short: ['c'] },
  '泣': { full: ['qi'], short: ['q'] },
  '呜': { full: ['wu'], short: ['w'] },
  '呜': { full: ['wu'], short: ['w'] },
  '哇': { full: ['wa'], short: ['w'] },
  '哇': { full: ['wa'], short: ['w'] },
  '号': { full: ['hao'], short: ['h'] },
  '啕': { full: ['tao'], short: ['t'] },
  '大': { full: ['da'], short: ['d'] },
  '哭': { full: ['ku'], short: ['k'] },
  '嘶': { full: ['si'], short: ['s'] },
  '心': { full: ['xin'], short: ['x'] },
  '裂': { full: ['lie'], short: ['l'] },
  '肺': { full: ['fei'], short: ['f'] },
  '肝': { full: ['gan'], short: ['g'] },
  '肠': { full: ['chang'], short: ['c'] },
  '寸': { full: ['cun'], short: ['c'] },
  '断': { full: ['duan'], short: ['d'] },
  '欲': { full: ['yu'], short: ['y'] },
  '绝': { full: ['jue'], short: ['j'] },
  '悲': { full: ['bei'], short: ['b'] },
  '痛': { full: ['tong'], short: ['t'] },
  '欲': { full: ['yu'], short: ['y'] },
  '绝': { full: ['jue'], short: ['j'] },
  '目': { full: ['mu'], short: ['m'] },
  '瞪': { full: ['deng'], short: ['d'] },
  '口': { full: ['kou'], short: ['k'] },
  '呆': { full: ['dai'], short: ['d'] },
  '张': { full: ['zhang'], short: ['z'] },
  '口': { full: ['kou'], short: ['k'] },
  '结': { full: ['jie'], short: ['j'] },
  '舌': { full: ['she'], short: ['s'] },
  '瞪': { full: ['deng'], short: ['d'] },
  '目': { full: ['mu'], short: ['m'] },
  '舌': { full: ['she'], short: ['s'] },
  '瞠': { full: ['cheng'], short: ['c'] },
  '目': { full: ['mu'], short: ['m'] },
  '结': { full: ['jie'], short: ['j'] },
  '惊': { full: ['jing'], short: ['j'] },
  '呆': { full: ['dai'], short: ['d'] },
  '若': { full: ['ruo'], short: ['r'] },
  '木': { full: ['mu'], short: ['m'] },
  '鸡': { full: ['ji'], short: ['j'] },
  '哑': { full: ['ya'], short: ['y'] },
  '无': { full: ['wu'], short: ['w'] },
  '言': { full: ['yan'], short: ['y'] },
  '以': { full: ['yi'], short: ['y'] },
  '对': { full: ['dui'], short: ['d'] },
  '翻': { full: ['fan'], short: ['f'] },
  '白': { full: ['bai'], short: ['b'] },
  '晕': { full: ['yun'], short: ['y'] },
  '厥': { full: ['jue'], short: ['j'] },
  '过': { full: ['guo'], short: ['g'] },
  '去': { full: ['qu'], short: ['q'] },
  '晕': { full: ['yun'], short: ['y'] },
  '倒': { full: ['dao'], short: ['d'] },
  '晕': { full: ['yun'], short: ['y'] },
  '头': { full: ['tou'], short: ['t'] },
  '转': { full: ['zhuan'], short: ['z'] },
  '向': { full: ['xiang'], short: ['x'] },
  '昏': { full: ['hun'], short: ['h'] },
  '头': { full: ['tou'], short: ['t'] },
  '转': { full: ['zhuan'], short: ['z'] },
  '蒙': { full: ['meng'], short: ['m'] },
  '完': { full: ['wan'], short: ['w'] },
  '全': { full: ['quan'], short: ['q'] },
  '全': { full: ['quan'], short: ['q'] },
  '蒙': { full: ['meng'], short: ['m'] },
  '了': { full: ['le'], short: ['l'] },
  '二': { full: ['er'], short: ['e'] },
  '丈': { full: ['zhang'], short: ['z'] },
  '和': { full: ['he'], short: ['h'] },
  '尚': { full: ['shang'], short: ['s'] },
  '摸': { full: ['mo'], short: ['m'] },
  '不': { full: ['bu'], short: ['b'] },
  '着': { full: ['zhao'], short: ['z'] },
  '头': { full: ['tou'], short: ['t'] },
  '脑': { full: ['nao'], short: ['n'] },
}

const categories = [
  { id: 'smileys', name: '表情', icon: '😀' },
  { id: 'gestures', name: '手势', icon: '👋' },
  { id: 'people', name: '人物', icon: '👶' },
  { id: 'clothing', name: '服饰', icon: '👔' },
  { id: 'animals', name: '动物', icon: '🐱' },
  { id: 'food', name: '食物', icon: '🍔' },
  { id: 'activities', name: '活动', icon: '⚽' },
  { id: 'travel', name: '旅行', icon: '🚗' },
  { id: 'objects', name: '物品', icon: '💡' },
  { id: 'symbols', name: '符号', icon: '❤️' },
  { id: 'flags', name: '旗帜', icon: '🏁' }
]

const emojis: Emoji[] = [
  // 表情符号类
  { char: '😀', name: '笑脸', category: 'smileys' },
  { char: '😃', name: '大笑', category: 'smileys' },
  { char: '😄', name: '开心笑', category: 'smileys' },
  { char: '😁', name: '露齿笑', category: 'smileys' },
  { char: '😆', name: '眯眼笑', category: 'smileys' },
  { char: '😅', name: '汗颜笑', category: 'smileys' },
  { char: '😂', name: '笑哭', category: 'smileys' },
  { char: '🤣', name: '笑倒', category: 'smileys' },
  { char: '🥲', name: '带泪微笑', category: 'smileys' },
  { char: '☺️', name: '微笑', category: 'smileys' },
  { char: '😊', name: '含羞笑', category: 'smileys' },
  { char: '😇', name: '天使笑', category: 'smileys' },
  { char: '🙂', name: '微笑', category: 'smileys' },
  { char: '🙃', name: '倒脸笑', category: 'smileys' },
  { char: '😉', name: '眨眼', category: 'smileys' },
  { char: '😌', name: '放松', category: 'smileys' },
  { char: '😍', name: '爱心眼', category: 'smileys' },
  { char: '🥰', name: '带爱心笑', category: 'smileys' },
  { char: '😘', name: '飞吻', category: 'smileys' },
  { char: '😗', name: '亲吻', category: 'smileys' },
  { char: '😙', name: '眯眼亲', category: 'smileys' },
  { char: '😚', name: '闭眼亲', category: 'smileys' },
  { char: '😋', name: '美味', category: 'smileys' },
  { char: '😛', name: '吐舌', category: 'smileys' },
  { char: '😝', name: '眯眼吐舌', category: 'smileys' },
  { char: '😜', name: '眨眼吐舌', category: 'smileys' },
  { char: '🤪', name: '疯狂', category: 'smileys' },
  { char: '🤨', name: '挑眉', category: 'smileys' },
  { char: '🧐', name: '单片眼镜', category: 'smileys' },
  { char: '🤓', name: '书呆子', category: 'smileys' },
  { char: '😎', name: '墨镜笑', category: 'smileys' },
  { char: '🥸', name: '伪装', category: 'smileys' },
  { char: '🤩', name: '星星眼', category: 'smileys' },
  { char: '🥳', name: '派对', category: 'smileys' },
  { char: '😏', name: '得意', category: 'smileys' },
  { char: '😒', name: '不悦', category: 'smileys' },
  { char: '😞', name: '失望', category: 'smileys' },
  { char: '😔', name: '沮丧', category: 'smileys' },
  { char: '😟', name: '担心', category: 'smileys' },
  { char: '😕', name: '困惑', category: 'smileys' },
  { char: '🙁', name: '轻度不悦', category: 'smileys' },
  { char: '☹️', name: '不悦', category: 'smileys' },
  { char: '😣', name: '忍耐', category: 'smileys' },
  { char: '😖', name: '困扰', category: 'smileys' },
  { char: '😫', name: '疲惫', category: 'smileys' },
  { char: '😩', name: '困乏', category: 'smileys' },
  { char: '🥺', name: '恳求', category: 'smileys' },
  { char: '😢', name: '哭泣', category: 'smileys' },
  { char: '😭', name: '大哭', category: 'smileys' },
  { char: '😤', name: '生气', category: 'smileys' },
  { char: '😠', name: '愤怒', category: 'smileys' },
  { char: '😡', name: '气愤', category: 'smileys' },
  { char: '🤬', name: '咒骂', category: 'smileys' },
  { char: '🤯', name: '头爆炸', category: 'smileys' },
  { char: '😳', name: '脸红', category: 'smileys' },
  { char: '🥵', name: '发热', category: 'smileys' },
  { char: '🥶', name: '发冷', category: 'smileys' },
  { char: '😱', name: '尖叫', category: 'smileys' },
  { char: '😨', name: '害怕', category: 'smileys' },
  { char: '😰', name: '焦虑', category: 'smileys' },
  { char: '😥', name: '失望但如释重负', category: 'smileys' },
  { char: '😓', name: '冷汗', category: 'smileys' },
  { char: '🤗', name: '拥抱', category: 'smileys' },
  { char: '🤔', name: '思考', category: 'smileys' },
  { char: '🤭', name: '偷笑', category: 'smileys' },
  { char: '🤫', name: '嘘', category: 'smileys' },
  { char: '🤥', name: '说谎', category: 'smileys' },
  { char: '😶', name: '无表情', category: 'smileys' },
  { char: '😐', name: '中性脸', category: 'smileys' },
  { char: '😑', name: '无语', category: 'smileys' },
  { char: '😬', name: '扭曲', category: 'smileys' },
  { char: '🙄', name: '翻白眼', category: 'smileys' },
  { char: '😯', name: '惊讶', category: 'smileys' },
  { char: '😦', name: '皱眉', category: 'smileys' },
  { char: '😧', name: '痛苦', category: 'smileys' },
  { char: '😮', name: '张嘴', category: 'smileys' },
  { char: '😲', name: '震惊', category: 'smileys' },
  { char: '🥱', name: '打哈欠', category: 'smileys' },
  { char: '😴', name: '睡觉', category: 'smileys' },
  { char: '🤤', name: '流口水', category: 'smileys' },
  { char: '😪', name: '困倦', category: 'smileys' },
  { char: '😵', name: '晕', category: 'smileys' },
  { char: '🤐', name: '拉链嘴', category: 'smileys' },
  { char: '🥴', name: '晕眩', category: 'smileys' },
  { char: '🤢', name: '恶心', category: 'smileys' },
  { char: '🤮', name: '呕吐', category: 'smileys' },
  { char: '🤧', name: '打喷嚏', category: 'smileys' },
  { char: '😷', name: '戴口罩', category: 'smileys' },
  { char: '🤒', name: '发烧', category: 'smileys' },
  { char: '🤕', name: '受伤', category: 'smileys' },
  { char: '🤑', name: '钱眼', category: 'smileys' },
  { char: '🤠', name: '牛仔', category: 'smileys' },
  { char: '😈', name: '恶魔笑', category: 'smileys' },
  { char: '👿', name: '生气的恶魔', category: 'smileys' },
  { char: '👹', name: '食人魔', category: 'smileys' },
  { char: '👺', name: '天狗', category: 'smileys' },
  { char: '🤡', name: '小丑', category: 'smileys' },
  { char: '💩', name: '便便', category: 'smileys' },
  { char: '👻', name: '幽灵', category: 'smileys' },
  { char: '💀', name: '骷髅', category: 'smileys' },
  { char: '☠️', name: '骷髅和交叉骨', category: 'smileys' },
  { char: '👽', name: '外星人', category: 'smileys' },
  { char: '👾', name: '外星怪物', category: 'smileys' },
  { char: '🤖', name: '机器人', category: 'smileys' },
  { char: '🎃', name: '南瓜灯', category: 'smileys' },
  { char: '😺', name: '开心猫', category: 'smileys' },
  { char: '😸', name: '笑脸猫', category: 'smileys' },
  { char: '😹', name: '笑哭猫', category: 'smileys' },
  { char: '😻', name: '爱心眼猫', category: 'smileys' },
  { char: '😼', name: '得意猫', category: 'smileys' },
  { char: '😽', name: '亲吻猫', category: 'smileys' },
  { char: '🙀', name: '害怕猫', category: 'smileys' },
  { char: '😿', name: '哭泣猫', category: 'smileys' },
  { char: '😾', name: '生气猫', category: 'smileys' },

  // 手势类别
  { char: '👋', name: '挥手', category: 'gestures' },
  { char: '🤚', name: '举起手掌', category: 'gestures' },
  { char: '🖐', name: '张开手掌', category: 'gestures' },
  { char: '✋', name: '手掌', category: 'gestures' },
  { char: '🖖', name: '瓦肯手势', category: 'gestures' },
  { char: '👌', name: 'OK手势', category: 'gestures' },
  { char: '🤌', name: '捏手指', category: 'gestures' },
  { char: '🤏', name: '捏', category: 'gestures' },
  { char: '✌️', name: '胜利手势', category: 'gestures' },
  { char: '🤞', name: '交叉手指', category: 'gestures' },
  { char: '🤟', name: '我爱你手势', category: 'gestures' },
  { char: '🤘', name: '摇滚手势', category: 'gestures' },
  { char: '🤙', name: '打电话手势', category: 'gestures' },
  { char: '👈', name: '向左指', category: 'gestures' },
  { char: '👉', name: '向右指', category: 'gestures' },
  { char: '👆', name: '向上指', category: 'gestures' },
  { char: '🖕', name: '中指', category: 'gestures' },
  { char: '👇', name: '向下指', category: 'gestures' },
  { char: '☝️', name: '食指向上', category: 'gestures' },
  { char: '👍', name: '赞', category: 'gestures' },
  { char: '👎', name: '踩', category: 'gestures' },
  { char: '✊', name: '举拳', category: 'gestures' },
  { char: '👊', name: '拳头', category: 'gestures' },
  { char: '🤛', name: '左拳', category: 'gestures' },
  { char: '🤜', name: '右拳', category: 'gestures' },
  { char: '👏', name: '鼓掌', category: 'gestures' },
  { char: '🙌', name: '举双手', category: 'gestures' },
  { char: '👐', name: '张开双手', category: 'gestures' },
  { char: '🤲', name: '手心向上', category: 'gestures' },
  { char: '🤝', name: '握手', category: 'gestures' },
  { char: '🙏', name: '祈祷', category: 'gestures' },
  { char: '✍️', name: '写字', category: 'gestures' },
  { char: '💅', name: '涂指甲', category: 'gestures' },
  { char: '🤳', name: '自拍', category: 'gestures' },
  { char: '💪', name: '秀肌肉', category: 'gestures' },
  { char: '🦾', name: '机械手臂', category: 'gestures' },
  { char: '🦿', name: '机械腿', category: 'gestures' },
  { char: '🦵', name: '腿', category: 'gestures' },
  { char: '🦶', name: '脚', category: 'gestures' },
  { char: '👂', name: '耳朵', category: 'gestures' },
  { char: '🦻', name: '助听器', category: 'gestures' },
  { char: '👃', name: '鼻子', category: 'gestures' },
  { char: '🧠', name: '大脑', category: 'gestures' },
  { char: '🫀', name: '心脏', category: 'gestures' },
  { char: '🫁', name: '肺', category: 'gestures' },
  { char: '🦷', name: '牙齿', category: 'gestures' },
  { char: '🦴', name: '骨头', category: 'gestures' },
  { char: '👀', name: '眼睛', category: 'gestures' },
  { char: '👁', name: '眼球', category: 'gestures' },
  { char: '👅', name: '舌头', category: 'gestures' },
  { char: '👄', name: '嘴唇', category: 'gestures' },
  { char: '💋', name: '吻', category: 'gestures' },
  { char: '🩸', name: '血滴', category: 'gestures' },

  // 带肤色的手势变体
  { char: '👋🏻', name: '挥手-白', category: 'gestures' },
  { char: '👋🏼', name: '挥手-较白', category: 'gestures' },
  { char: '👋🏽', name: '挥手-中等', category: 'gestures' },
  { char: '👋🏾', name: '挥手-较深', category: 'gestures' },
  { char: '👋🏿', name: '挥手-深', category: 'gestures' },
  // ... 其他手势的肤色变体
  
  // 人物类
  { char: '👶', name: '婴儿', category: 'people' },
  { char: '👧', name: '女孩', category: 'people' },
  { char: '🧒', name: '儿童', category: 'people' },
  { char: '👦', name: '男孩', category: 'people' },
  { char: '👩', name: '女人', category: 'people' },
  { char: '🧑', name: '成人', category: 'people' },
  { char: '👨', name: '男人', category: 'people' },
  { char: '👩‍🦱', name: '卷发女人', category: 'people' },
  { char: '🧑‍🦱', name: '卷发人', category: 'people' },
  { char: '👨‍🦱', name: '卷发男人', category: 'people' },
  { char: '👩‍🦰', name: '红发女人', category: 'people' },
  { char: '🧑‍🦰', name: '红发人', category: 'people' },
  { char: '👨‍🦰', name: '红发男人', category: 'people' },
  { char: '👱‍♀️', name: '金发女人', category: 'people' },
  { char: '👱', name: '金发人', category: 'people' },
  { char: '👱‍♂️', name: '金发男人', category: 'people' },
  { char: '👩‍🦳', name: '白发女人', category: 'people' },
  { char: '🧑‍🦳', name: '白发人', category: 'people' },
  { char: '👨‍🦳', name: '白发男人', category: 'people' },
  { char: '👩‍🦲', name: '光头女人', category: 'people' },
  { char: '🧑‍🦲', name: '光头人', category: 'people' },
  { char: '👨‍🦲', name: '光头男人', category: 'people' },
  { char: '🧔', name: '胡子人', category: 'people' },
  { char: '👵', name: '老奶奶', category: 'people' },
  { char: '🧓', name: '老人', category: 'people' },
  { char: '👴', name: '老爷爷', category: 'people' },
  { char: '👲', name: '戴瓜皮帽的人', category: 'people' },
  { char: '👳‍♀️', name: '戴头巾的女人', category: 'people' },
  { char: '👳', name: '戴头巾的人', category: 'people' },
  { char: '👳‍♂️', name: '戴头巾的男人', category: 'people' },
  { char: '🧕', name: '戴头巾的女人', category: 'people' },
  { char: '👮‍♀️', name: '女警察', category: 'people' },
  { char: '👮', name: '警察', category: 'people' },
  { char: '👮‍♂️', name: '男警察', category: 'people' },
  { char: '👷‍♀️', name: '女建筑工人', category: 'people' },
  { char: '👷', name: '建筑工人', category: 'people' },
  { char: '👷‍♂️', name: '男建筑工人', category: 'people' },
  { char: '💂‍♀️', name: '女卫兵', category: 'people' },
  { char: '💂', name: '卫兵', category: 'people' },
  { char: '💂‍♂️', name: '男卫兵', category: 'people' },
  { char: '🕵️‍♀️', name: '女侦探', category: 'people' },
  { char: '🕵️', name: '侦探', category: 'people' },
  { char: '🕵️‍♂️', name: '男侦探', category: 'people' },
  { char: '👩‍⚕️', name: '女医生', category: 'people' },
  { char: '🧑‍⚕️', name: '医生', category: 'people' },
  { char: '👨‍⚕️', name: '男医生', category: 'people' },
  { char: '👩‍🌾', name: '女农民', category: 'people' },
  { char: '🧑‍🌾', name: '农民', category: 'people' },
  { char: '👨‍🌾', name: '男农民', category: 'people' },
  { char: '👩‍🍳', name: '女厨师', category: 'people' },
  { char: '🧑‍🍳', name: '厨师', category: 'people' },
  { char: '👨‍🍳', name: '男厨师', category: 'people' },
  { char: '👩‍🎓', name: '女学生', category: 'people' },
  { char: '🧑‍🎓', name: '学生', category: 'people' },
  { char: '👨‍🎓', name: '男学生', category: 'people' },
  { char: '👩‍🎤', name: '女歌手', category: 'people' },
  { char: '🧑‍🎤', name: '歌手', category: 'people' },
  { char: '👨‍🎤', name: '男歌手', category: 'people' },
  { char: '👩‍🏫', name: '女老师', category: 'people' },
  { char: '🧑‍🏫', name: '老师', category: 'people' },
  { char: '👨‍🏫', name: '男老师', category: 'people' },
  { char: '👩‍🏭', name: '女工厂工人', category: 'people' },
  { char: '🧑‍🏭', name: '工厂工人', category: 'people' },
  { char: '👨‍🏭', name: '男工厂工人', category: 'people' },
  { char: '👩‍💻', name: '女程序员', category: 'people' },
  { char: '🧑‍💻', name: '程序员', category: 'people' },
  { char: '👨‍💻', name: '男程序员', category: 'people' },
  { char: '👩‍💼', name: '女上班族', category: 'people' },
  { char: '🧑‍💼', name: '上班族', category: 'people' },
  { char: '👨‍💼', name: '男上班族', category: 'people' },
  { char: '👩‍🔧', name: '女技工', category: 'people' },
  { char: '🧑‍🔧', name: '技工', category: 'people' },
  { char: '👨‍🔧', name: '男技工', category: 'people' },
  { char: '👩‍🔬', name: '女科学家', category: 'people' },
  { char: '🧑‍🔬', name: '科学家', category: 'people' },
  { char: '👨‍🔬', name: '男科学家', category: 'people' },
  { char: '👩‍🎨', name: '女画家', category: 'people' },
  { char: '🧑‍🎨', name: '画家', category: 'people' },
  { char: '👨‍🎨', name: '男画家', category: 'people' },
  { char: '👩‍🚒', name: '女消防员', category: 'people' },
  { char: '🧑‍🚒', name: '消防员', category: 'people' },
  { char: '👨‍🚒', name: '男消防员', category: 'people' },
  { char: '👩‍✈️', name: '女飞行员', category: 'people' },
  { char: '🧑‍✈️', name: '飞行员', category: 'people' },
  { char: '👨‍✈️', name: '男飞行员', category: 'people' },
  { char: '👩‍🚀', name: '女宇航员', category: 'people' },
  { char: '🧑‍🚀', name: '宇航员', category: 'people' },
  { char: '👨‍🚀', name: '男宇航员', category: 'people' },
  { char: '👩‍⚖️', name: '女法官', category: 'people' },
  { char: '🧑‍⚖️', name: '法官', category: 'people' },
  { char: '👨‍⚖️', name: '男法官', category: 'people' },

  // 服饰类
  { char: '🎩', name: '礼帽', category: 'clothing' },
  { char: '🎓', name: '毕业帽', category: 'clothing' },
  { char: '👒', name: '女士帽', category: 'clothing' },
  { char: '🧢', name: '鸭舌帽', category: 'clothing' },
  { char: '⛑️', name: '救援头盔', category: 'clothing' },
  { char: '🪖', name: '军用头盔', category: 'clothing' },
  { char: '👑', name: '皇冠', category: 'clothing' },
  { char: '👝', name: '手提包', category: 'clothing' },
  { char: '👛', name: '钱包', category: 'clothing' },
  { char: '👜', name: '手袋', category: 'clothing' },
  { char: '💼', name: '公文包', category: 'clothing' },
  { char: '🎒', name: '书包', category: 'clothing' },
  { char: '🧳', name: '行李箱', category: 'clothing' },
  { char: '👓', name: '眼镜', category: 'clothing' },
  { char: '🕶️', name: '太阳镜', category: 'clothing' },
  { char: '🥽', name: '护目镜', category: 'clothing' },
  { char: '🌂', name: '折叠伞', category: 'clothing' },
  { char: '☂️', name: '雨伞', category: 'clothing' },
  { char: '🧵', name: '线', category: 'clothing' },
  { char: '🪡', name: '针', category: 'clothing' },
  { char: '🧶', name: '毛线', category: 'clothing' },
  { char: '👔', name: '领带', category: 'clothing' },
  { char: '👕', name: 'T恤', category: 'clothing' },
  { char: '👖', name: '牛仔裤', category: 'clothing' },
  { char: '🧣', name: '围巾', category: 'clothing' },
  { char: '🧤', name: '手套', category: 'clothing' },
  { char: '🧥', name: '外套', category: 'clothing' },
  { char: '🧦', name: '袜子', category: 'clothing' },
  { char: '👗', name: '连衣裙', category: 'clothing' },
  { char: '👘', name: '和服', category: 'clothing' },
  { char: '🥻', name: '纱丽', category: 'clothing' },
  { char: '🩱', name: '连体泳装', category: 'clothing' },
  { char: '🩲', name: '内裤', category: 'clothing' },
  { char: '🩳', name: '短裤', category: 'clothing' },
  { char: '👙', name: '比基尼', category: 'clothing' },
  { char: '👚', name: '女装', category: 'clothing' },
  { char: '👛', name: '钱包', category: 'clothing' },
  { char: '👜', name: '手提包', category: 'clothing' },
  { char: '👠', name: '高跟鞋', category: 'clothing' },
  { char: '👡', name: '凉鞋', category: 'clothing' },
  { char: '👢', name: '女靴', category: 'clothing' },
  { char: '👞', name: '男鞋', category: 'clothing' },
  { char: '👟', name: '运动鞋', category: 'clothing' },
  { char: '🥾', name: '登山靴', category: 'clothing' },
  { char: '🥿', name: '平底鞋', category: 'clothing' },
  { char: '🩰', name: '芭蕾舞鞋', category: 'clothing' },
  { char: '🪮', name: '折扇', category: 'clothing' },
  { char: '👒', name: '遮阳帽', category: 'clothing' },
  { char: '🎩', name: '高礼帽', category: 'clothing' },
  { char: '🎓', name: '学士帽', category: 'clothing' },
  { char: '🧢', name: '棒球帽', category: 'clothing' },
  { char: '🪖', name: '头盔', category: 'clothing' },
  { char: '⛑️', name: '急救帽', category: 'clothing' },
  { char: '📿', name: '念珠', category: 'clothing' },
  { char: '💄', name: '口红', category: 'clothing' },
  { char: '💍', name: '戒指', category: 'clothing' },
  { char: '💎', name: '宝石', category: 'clothing' },
  { char: '🔇', name: '静音', category: 'clothing' },

  // 动物类
  { char: '🐶', name: '狗', category: 'animals' },
  { char: '🐱', name: '猫', category: 'animals' },
  { char: '🐭', name: '老鼠', category: 'animals' },
  { char: '🐹', name: '仓鼠', category: 'animals' },
  { char: '🐰', name: '兔子', category: 'animals' },
  { char: '🦊', name: '狐狸', category: 'animals' },
  { char: '🐻', name: '熊', category: 'animals' },
  { char: '🐼', name: '熊猫', category: 'animals' },
  { char: '🐨', name: '考拉', category: 'animals' },
  { char: '🐯', name: '老虎', category: 'animals' },
  { char: '🦁', name: '狮子', category: 'animals' },
  { char: '🐮', name: '牛', category: 'animals' },
  { char: '🐷', name: '猪', category: 'animals' },
  { char: '🐽', name: '猪鼻子', category: 'animals' },
  { char: '🐸', name: '青蛙', category: 'animals' },
  { char: '🐵', name: '猴子', category: 'animals' },
  { char: '🙈', name: '非礼勿视', category: 'animals' },
  { char: '🙉', name: '非礼勿听', category: 'animals' },
  { char: '🙊', name: '非礼勿言', category: 'animals' },
  { char: '🐒', name: '猴', category: 'animals' },
  { char: '🦍', name: '大猩猩', category: 'animals' },
  { char: '🦧', name: '猩猩', category: 'animals' },
  { char: '🐔', name: '鸡', category: 'animals' },
  { char: '🐧', name: '企鹅', category: 'animals' },
  { char: '🐦', name: '鸟', category: 'animals' },
  { char: '🐤', name: '小鸡', category: 'animals' },
  { char: '🐣', name: '破壳小鸡', category: 'animals' },
  { char: '🐥', name: '正面小鸡', category: 'animals' },
  { char: '🦆', name: '鸭子', category: 'animals' },
  { char: '🦅', name: '鹰', category: 'animals' },
  { char: '🦉', name: '猫头鹰', category: 'animals' },
  { char: '🦇', name: '蝙蝠', category: 'animals' },
  { char: '🐺', name: '狼', category: 'animals' },
  { char: '🐗', name: '野猪', category: 'animals' },
  { char: '🐴', name: '马', category: 'animals' },
  { char: '🦄', name: '独角兽', category: 'animals' },
  { char: '🐝', name: '蜜蜂', category: 'animals' },
  { char: '🪱', name: '蠕虫', category: 'animals' },
  { char: '🐛', name: '毛毛虫', category: 'animals' },
  { char: '🦋', name: '蝴蝶', category: 'animals' },
  { char: '🐌', name: '蜗牛', category: 'animals' },
  { char: '🐞', name: '瓢虫', category: 'animals' },
  { char: '🐜', name: '蚂蚁', category: 'animals' },
  { char: '🪰', name: '苍蝇', category: 'animals' },
  { char: '🪲', name: '甲虫', category: 'animals' },
  { char: '🪳', name: '蟑螂', category: 'animals' },
  { char: '🦗', name: '蟋蟀', category: 'animals' },
  { char: '🕷', name: '蜘蛛', category: 'animals' },
  { char: '🕸', name: '蜘蛛网', category: 'animals' },
  { char: '🦂', name: '蝎子', category: 'animals' },
  { char: '🐢', name: '乌龟', category: 'animals' },
  { char: '🐍', name: '蛇', category: 'animals' },
  { char: '🦎', name: '蜥蜴', category: 'animals' },
  { char: '🦖', name: '霸王龙', category: 'animals' },
  { char: '🦕', name: '恐龙', category: 'animals' },
  { char: '🐙', name: '章鱼', category: 'animals' },
  { char: '🦑', name: '鱿鱼', category: 'animals' },
  { char: '🦐', name: '虾', category: 'animals' },
  { char: '🦞', name: '龙虾', category: 'animals' },
  { char: '🦀', name: '螃蟹', category: 'animals' },
  { char: '🐡', name: '河豚', category: 'animals' },
  { char: '🐠', name: '热带鱼', category: 'animals' },
  { char: '🐟', name: '鱼', category: 'animals' },
  { char: '🐬', name: '海豚', category: 'animals' },
  { char: '🐳', name: '喷水鲸鱼', category: 'animals' },
  { char: '🐋', name: '鲸鱼', category: 'animals' },
  { char: '🦈', name: '鲨鱼', category: 'animals' },
  { char: '🦭', name: '海豹', category: 'animals' },
  { char: '🐊', name: '鳄鱼', category: 'animals' },
  { char: '🐅', name: '老虎', category: 'animals' },
  { char: '🐆', name: '豹子', category: 'animals' },
  { char: '🦓', name: '斑马', category: 'animals' },
  { char: '🦍', name: '大猩猩', category: 'animals' },
  { char: '🦏', name: '犀牛', category: 'animals' },
  { char: '🦛', name: '河马', category: 'animals' },
  { char: '🐘', name: '大象', category: 'animals' },
  { char: '🦒', name: '长颈鹿', category: 'animals' },
  { char: '🦘', name: '袋鼠', category: 'animals' },
  { char: '🦬', name: '野牛', category: 'animals' },
  { char: '🐃', name: '水牛', category: 'animals' },
  { char: '🐂', name: '公牛', category: 'animals' },
  { char: '🐄', name: '奶牛', category: 'animals' },
  { char: '🐎', name: '赛马', category: 'animals' },
  { char: '🐖', name: '猪', category: 'animals' },
  { char: '🐏', name: '公羊', category: 'animals' },
  { char: '🐑', name: '绵羊', category: 'animals' },
  { char: '🦙', name: '羊驼', category: 'animals' },
  { char: '🐐', name: '山羊', category: 'animals' },
  { char: '🦌', name: '鹿', category: 'animals' },
  { char: '🐕', name: '狗', category: 'animals' },
  { char: '🐩', name: '贵宾犬', category: 'animals' },
  { char: '🦮', name: '导盲犬', category: 'animals' },
  { char: '🐕‍🦺', name: '服务犬', category: 'animals' },
  { char: '🐈', name: '猫', category: 'animals' },
  { char: '🐈‍⬛', name: '黑猫', category: 'animals' },
  { char: '🪶', name: '羽毛', category: 'animals' },
  { char: '🦃', name: '火鸡', category: 'animals' },
  { char: '🦚', name: '孔雀', category: 'animals' },
  { char: '🦜', name: '鹦鹉', category: 'animals' },
  { char: '🦢', name: '天鹅', category: 'animals' },
  { char: '🦩', name: '火烈鸟', category: 'animals' },
  { char: '🕊', name: '和平鸽', category: 'animals' },
  { char: '🐇', name: '兔子', category: 'animals' },
  { char: '🦝', name: '浣熊', category: 'animals' },
  { char: '🦨', name: '臭鼬', category: 'animals' },
  { char: '🦡', name: '獾', category: 'animals' },
  { char: '🦫', name: '海狸', category: 'animals' },
  { char: '🦦', name: '水獭', category: 'animals' },

  // 食物类
  { char: '🍎', name: '红苹果', category: 'food' },
  { char: '🍏', name: '青苹果', category: 'food' },
  { char: '🍐', name: '梨', category: 'food' },
  { char: '🍊', name: '橘子', category: 'food' },
  { char: '🍋', name: '柠檬', category: 'food' },
  { char: '🍌', name: '香蕉', category: 'food' },
  { char: '🍉', name: '西瓜', category: 'food' },
  { char: '🍇', name: '葡萄', category: 'food' },
  { char: '🍓', name: '草莓', category: 'food' },
  { char: '🫐', name: '蓝莓', category: 'food' },
  { char: '🍈', name: '甜瓜', category: 'food' },
  { char: '🍒', name: '樱桃', category: 'food' },
  { char: '🍑', name: '桃子', category: 'food' },
  { char: '🥭', name: '芒果', category: 'food' },
  { char: '🍍', name: '菠萝', category: 'food' },
  { char: '🥥', name: '椰子', category: 'food' },
  { char: '🥝', name: '猕猴桃', category: 'food' },
  { char: '🍅', name: '番茄', category: 'food' },
  { char: '🍆', name: '茄子', category: 'food' },
  { char: '🥑', name: '牛油果', category: 'food' },
  { char: '🥦', name: '西兰花', category: 'food' },
  { char: '🥬', name: '绿叶蔬菜', category: 'food' },
  { char: '🥒', name: '黄瓜', category: 'food' },
  { char: '🌶', name: '辣椒', category: 'food' },
  { char: '🫑', name: '青椒', category: 'food' },
  { char: '🌽', name: '玉米', category: 'food' },
  { char: '🥕', name: '胡萝卜', category: 'food' },
  { char: '🫒', name: '橄榄', category: 'food' },
  { char: '🧄', name: '大蒜', category: 'food' },
  { char: '🧅', name: '洋葱', category: 'food' },
  { char: '🥔', name: '土豆', category: 'food' },
  { char: '🍠', name: '烤红薯', category: 'food' },
  { char: '🥐', name: '牛角面包', category: 'food' },
  { char: '🥯', name: '百吉饼', category: 'food' },
  { char: '🍞', name: '面包', category: 'food' },
  { char: '🥖', name: '法棍', category: 'food' },
  { char: '🥨', name: '椒盐卷饼', category: 'food' },
  { char: '🧀', name: '奶酪', category: 'food' },
  { char: '🥚', name: '鸡蛋', category: 'food' },
  { char: '🍳', name: '煎蛋', category: 'food' },
  { char: '🧈', name: '黄油', category: 'food' },
  { char: '🥞', name: '薄饼', category: 'food' },
  { char: '🧇', name: '华夫饼', category: 'food' },
  { char: '🥓', name: '培根', category: 'food' },
  { char: '🥩', name: '肉排', category: 'food' },
  { char: '🍗', name: '鸡腿', category: 'food' },
  { char: '🍖', name: '肉', category: 'food' },
  { char: '🦴', name: '骨头', category: 'food' },
  { char: '🌭', name: '热狗', category: 'food' },
  { char: '🍔', name: '汉堡包', category: 'food' },
  { char: '🍟', name: '薯条', category: 'food' },
  { char: '🍕', name: '披萨', category: 'food' },
  { char: '🥪', name: '三明治', category: 'food' },
  { char: '🥙', name: '皮塔饼', category: 'food' },
  { char: '🧆', name: '炸丸子', category: 'food' },
  { char: '🌮', name: '墨西哥卷饼', category: 'food' },
  { char: '🌯', name: '墨西哥卷', category: 'food' },
  { char: '🫔', name: '塔玛利', category: 'food' },
  { char: '🥗', name: '沙拉', category: 'food' },
  { char: '🥘', name: '浅底锅', category: 'food' },
  { char: '🫕', name: '奶酪火锅', category: 'food' },
  { char: '🥫', name: '罐头食品', category: 'food' },
  { char: '🍝', name: '意大利面', category: 'food' },
  { char: '🍜', name: '拉面', category: 'food' },
  { char: '🍲', name: '火锅', category: 'food' },
  { char: '🍛', name: '咖喱饭', category: 'food' },
  { char: '🍣', name: '寿司', category: 'food' },
  { char: '🍱', name: '便当', category: 'food' },
  { char: '🥟', name: '饺子', category: 'food' },
  { char: '🦪', name: '生蚝', category: 'food' },
  { char: '🍤', name: '炸虾', category: 'food' },
  { char: '🍙', name: '饭团', category: 'food' },
  { char: '🍚', name: '米饭', category: 'food' },
  { char: '🍘', name: '仙贝', category: 'food' },
  { char: '🍥', name: '鱼饼', category: 'food' },
  { char: '🥠', name: '幸运饼干', category: 'food' },
  { char: '🥮', name: '月饼', category: 'food' },
  { char: '🍢', name: '关东煮', category: 'food' },
  { char: '🍡', name: '团子', category: 'food' },
  { char: '🍧', name: '刨冰', category: 'food' },
  { char: '🍨', name: '冰淇淋', category: 'food' },
  { char: '🍦', name: '圆筒冰淇淋', category: 'food' },
  { char: '🥧', name: '派', category: 'food' },
  { char: '🧁', name: '纸杯蛋糕', category: 'food' },
  { char: '🍰', name: '蛋糕', category: 'food' },
  { char: '🎂', name: '生日蛋糕', category: 'food' },
  { char: '🍮', name: '布丁', category: 'food' },
  { char: '🍭', name: '棒棒糖', category: 'food' },
  { char: '🍬', name: '糖果', category: 'food' },
  { char: '🍫', name: '巧克力', category: 'food' },
  { char: '🍿', name: '爆米花', category: 'food' },
  { char: '🍩', name: '甜甜圈', category: 'food' },
  { char: '🍪', name: '饼干', category: 'food' },
  { char: '🌰', name: '栗子', category: 'food' },
  { char: '🥜', name: '花生', category: 'food' },
  { char: '🍯', name: '蜂蜜', category: 'food' },
  { char: '🥛', name: '牛奶', category: 'food' },
  { char: '🫖', name: '茶壶', category: 'food' },
  { char: '🍵', name: '茶', category: 'food' },
  { char: '🧃', name: '果汁盒', category: 'food' },
  { char: '🥤', name: '带吸管的杯子', category: 'food' },
  { char: '🧋', name: '珍珠奶茶', category: 'food' },
  { char: '☕', name: '咖啡', category: 'food' },
  { char: '🍶', name: '清酒', category: 'food' },
  { char: '🍺', name: '啤酒', category: 'food' },
  { char: '🍻', name: '干杯', category: 'food' },
  { char: '🥂', name: '香槟', category: 'food' },
  { char: '🍷', name: '红酒', category: 'food' },
  { char: '🥃', name: '威士忌', category: 'food' },
  { char: '🍸', name: '鸡尾酒', category: 'food' },
  { char: '🍹', name: '热带饮料', category: 'food' },
  { char: '🧉', name: '马黛茶', category: 'food' },
  { char: '🍾', name: '香槟瓶', category: 'food' },
  { char: '🧊', name: '冰块', category: 'food' },
  { char: '🥄', name: '勺子', category: 'food' },
  { char: '🍴', name: '刀叉', category: 'food' },
  { char: '🍽', name: '餐具', category: 'food' },
  { char: '🥢', name: '筷子', category: 'food' },
  { char: '🧂', name: '盐', category: 'food' },

  // 活动类
  { char: '⚽️', name: '足球', category: 'activities' },
  { char: '🏀', name: '篮球', category: 'activities' },
  { char: '🏈', name: '橄榄球', category: 'activities' },
  { char: '⚾️', name: '棒球', category: 'activities' },
  { char: '🥎', name: '垒球', category: 'activities' },
  { char: '🎾', name: '网球', category: 'activities' },
  { char: '🏐', name: '排球', category: 'activities' },
  { char: '🏉', name: '橄榄球', category: 'activities' },
  { char: '🥏', name: '飞盘', category: 'activities' },
  { char: '🎱', name: '台球', category: 'activities' },
  { char: '🪀', name: '溜溜球', category: 'activities' },
  { char: '🏓', name: '乒乓球', category: 'activities' },
  { char: '🏸', name: '羽毛球', category: 'activities' },
  { char: '🏒', name: '冰球', category: 'activities' },
  { char: '🏑', name: '曲棍球', category: 'activities' },
  { char: '🥍', name: '长曲棍球', category: 'activities' },
  { char: '🏏', name: '板球', category: 'activities' },
  { char: '🪃', name: '回力镖', category: 'activities' },
  { char: '🥅', name: '球门', category: 'activities' },
  { char: '⛳️', name: '高尔夫球洞', category: 'activities' },
  { char: '🪁', name: '风筝', category: 'activities' },
  { char: '🏹', name: '弓箭', category: 'activities' },
  { char: '🎣', name: '钓鱼', category: 'activities' },
  { char: '🤿', name: '潜水', category: 'activities' },
  { char: '🥊', name: '拳击手套', category: 'activities' },
  { char: '🥋', name: '武术服', category: 'activities' },
  { char: '🎽', name: '跑步衫', category: 'activities' },
  { char: '🛹', name: '滑板', category: 'activities' },
  { char: '🛼', name: '旱冰鞋', category: 'activities' },
  { char: '🛷', name: '雪橇', category: 'activities' },
  { char: '⛸', name: '冰鞋', category: 'activities' },
  { char: '🥌', name: '冰壶', category: 'activities' },
  { char: '🎿', name: '滑雪', category: 'activities' },
  { char: '⛷', name: '滑雪者', category: 'activities' },
  { char: '🏂', name: '单板滑雪', category: 'activities' },
  { char: '🪂', name: '降落伞', category: 'activities' },
  { char: '🏋️‍♀️', name: '女举重', category: 'activities' },
  { char: '🏋️', name: '举重', category: 'activities' },
  { char: '🏋️‍♂️', name: '男举重', category: 'activities' },
  { char: '🤼‍♀️', name: '女摔跤', category: 'activities' },
  { char: '🤼', name: '摔跤', category: 'activities' },
  { char: '🤼‍♂️', name: '男摔跤', category: 'activities' },
  { char: '🤸‍♀️', name: '女体操', category: 'activities' },
  { char: '🤸', name: '体操', category: 'activities' },
  { char: '🤸‍♂️', name: '男体操', category: 'activities' },
  { char: '⛹️‍♀️', name: '女篮球', category: 'activities' },
  { char: '⛹️', name: '篮球', category: 'activities' },
  { char: '⛹️‍♂️', name: '男篮球', category: 'activities' },
  { char: '🤺', name: '击剑', category: 'activities' },
  { char: '🤾‍♀️', name: '女手球', category: 'activities' },
  { char: '🤾', name: '手球', category: 'activities' },
  { char: '🤾‍♂️', name: '男手球', category: 'activities' },
  { char: '🏌️‍♀️', name: '女高尔夫', category: 'activities' },
  { char: '🏌️', name: '高尔夫', category: 'activities' },
  { char: '🏌️‍♂️', name: '男高尔夫', category: 'activities' },
  { char: '🏇', name: '赛马', category: 'activities' },
  { char: '🧘‍♀️', name: '女瑜伽', category: 'activities' },
  { char: '🧘', name: '瑜伽', category: 'activities' },
  { char: '🧘‍♂️', name: '男瑜伽', category: 'activities' },
  { char: '🏄‍♀️', name: '女冲浪', category: 'activities' },
  { char: '🏄', name: '冲浪', category: 'activities' },
  { char: '🏄‍♂️', name: '男冲浪', category: 'activities' },
  { char: '🏊‍♀️', name: '女游泳', category: 'activities' },
  { char: '🏊', name: '游泳', category: 'activities' },
  { char: '🏊‍♂️', name: '男游泳', category: 'activities' },
  { char: '🤽‍♀️', name: '女水球', category: 'activities' },
  { char: '🤽', name: '水球', category: 'activities' },
  { char: '🤽‍♂️', name: '男水球', category: 'activities' },
  { char: '🚣‍♀️', name: '女划船', category: 'activities' },
  { char: '🚣', name: '划船', category: 'activities' },
  { char: '🚣‍♂️', name: '男划船', category: 'activities' },
  { char: '🧗‍♀️', name: '女攀岩', category: 'activities' },
  { char: '🧗', name: '攀岩', category: 'activities' },
  { char: '🧗‍♂️', name: '男攀岩', category: 'activities' },
  { char: '🚵‍♀️', name: '女山地自行车', category: 'activities' },
  { char: '🚵', name: '山地自行车', category: 'activities' },
  { char: '🚵‍♂️', name: '男山地自行车', category: 'activities' },
  { char: '🚴‍♀️', name: '女自行车', category: 'activities' },
  { char: '🚴', name: '自行车', category: 'activities' },
  { char: '🚴‍♂️', name: '男自行车', category: 'activities' },
  { char: '🏆', name: '奖杯', category: 'activities' },
  { char: '🥇', name: '金牌', category: 'activities' },
  { char: '🥈', name: '银牌', category: 'activities' },
  { char: '🥉', name: '铜牌', category: 'activities' },
  { char: '🏅', name: '运动奖牌', category: 'activities' },
  { char: '🎖', name: '军事奖章', category: 'activities' },
  { char: '🏵', name: '玫瑰花', category: 'activities' },
  { char: '🎗', name: '提醒丝带', category: 'activities' },
  { char: '🎫', name: '票', category: 'activities' },
  { char: '🎟', name: '入场券', category: 'activities' },
  { char: '🎪', name: '马戏团', category: 'activities' },
  { char: '🤹', name: '杂耍', category: 'activities' },
  { char: '🤹‍♂️', name: '男杂耍', category: 'activities' },
  { char: '🤹‍♀️', name: '女杂耍', category: 'activities' },
  { char: '🎭', name: '表演艺术', category: 'activities' },
  { char: '🩰', name: '芭蕾舞鞋', category: 'activities' },
  { char: '🎨', name: '艺术', category: 'activities' },
  { char: '🎬', name: '电影', category: 'activities' },
  { char: '🎤', name: '麦克风', category: 'activities' },
  { char: '🎧', name: '耳机', category: 'activities' },
  { char: '🎼', name: '乐谱', category: 'activities' },
  { char: '🎹', name: '钢琴', category: 'activities' },
  { char: '🥁', name: '鼓', category: 'activities' },
  { char: '🪘', name: '长鼓', category: 'activities' },
  { char: '🎷', name: '萨克斯', category: 'activities' },
  { char: '🎺', name: '小号', category: 'activities' },
  { char: '🪗', name: '手风琴', category: 'activities' },
  { char: '🎸', name: '吉他', category: 'activities' },
  { char: '🪕', name: '班卓琴', category: 'activities' },
  { char: '🎻', name: '小提琴', category: 'activities' },
  { char: '🎲', name: '骰子', category: 'activities' },
  { char: '♟', name: '国际象棋', category: 'activities' },
  { char: '🎯', name: '正中靶心', category: 'activities' },
  { char: '🎳', name: '保龄球', category: 'activities' },
  { char: '🎮', name: '游戏手柄', category: 'activities' },
  { char: '🎰', name: '老虎机', category: 'activities' },
  { char: '🧩', name: '拼图', category: 'activities' },

  // 旅行类
  { char: '🚗', name: '汽车', category: 'travel' },
  { char: '🚕', name: '出租车', category: 'travel' },
  { char: '🚙', name: 'SUV', category: 'travel' },
  { char: '🚌', name: '公交车', category: 'travel' },
  { char: '🚎', name: '无轨电车', category: 'travel' },
  { char: '🏎', name: '赛车', category: 'travel' },
  { char: '🚓', name: '警车', category: 'travel' },
  { char: '🚑', name: '救护车', category: 'travel' },
  { char: '🚒', name: '消防车', category: 'travel' },
  { char: '🚐', name: '面包车', category: 'travel' },
  { char: '🛻', name: '皮卡车', category: 'travel' },
  { char: '🚚', name: '货车', category: 'travel' },
  { char: '🚛', name: '铰接卡车', category: 'travel' },
  { char: '🚜', name: '拖拉机', category: 'travel' },
  { char: '🦯', name: '导盲杖', category: 'travel' },
  { char: '🦽', name: '手动轮椅', category: 'travel' },
  { char: '🦼', name: '电动轮椅', category: 'travel' },
  { char: '🛴', name: '滑板车', category: 'travel' },
  { char: '🚲', name: '自行车', category: 'travel' },
  { char: '🛵', name: '摩托车', category: 'travel' },
  { char: '🏍', name: '摩托', category: 'travel' },
  { char: '🛺', name: '三轮车', category: 'travel' },
  { char: '🚨', name: '警车灯', category: 'travel' },
  { char: '🚔', name: '迎面警车', category: 'travel' },
  { char: '🚍', name: '迎面公交车', category: 'travel' },
  { char: '🚘', name: '迎面汽车', category: 'travel' },
  { char: '🚖', name: '迎面出租车', category: 'travel' },
  { char: '🚡', name: '缆车', category: 'travel' },
  { char: '🚠', name: '山地缆车', category: 'travel' },
  { char: '🚟', name: '悬挂铁路', category: 'travel' },
  { char: '🚃', name: '铁路车厢', category: 'travel' },
  { char: '🚋', name: '电车车厢', category: 'travel' },
  { char: '🚞', name: '山地铁路', category: 'travel' },
  { char: '🚝', name: '单轨铁路', category: 'travel' },
  { char: '🚄', name: '高速列车', category: 'travel' },
  { char: '🚅', name: '子弹头列车', category: 'travel' },
  { char: '🚈', name: '轻轨', category: 'travel' },
  { char: '🚂', name: '蒸汽机车', category: 'travel' },
  { char: '🚆', name: '火车', category: 'travel' },
  { char: '🚇', name: '地铁', category: 'travel' },
  { char: '🚊', name: '电车', category: 'travel' },
  { char: '🚉', name: '车站', category: 'travel' },
  { char: '✈️', name: '飞机', category: 'travel' },
  { char: '🛫', name: '起飞', category: 'travel' },
  { char: '🛬', name: '降落', category: 'travel' },
  { char: '🛩', name: '小型飞机', category: 'travel' },
  { char: '💺', name: '座位', category: 'travel' },
  { char: '🛰', name: '卫星', category: 'travel' },
  { char: '🚀', name: '火箭', category: 'travel' },
  { char: '🛸', name: '飞碟', category: 'travel' },
  { char: '🚁', name: '直升机', category: 'travel' },
  { char: '🛶', name: '独木舟', category: 'travel' },
  { char: '⛵️', name: '帆船', category: 'travel' },
  { char: '🚤', name: '快艇', category: 'travel' },
  { char: '🛥', name: '摩托艇', category: 'travel' },
  { char: '🛳', name: '客轮', category: 'travel' },
  { char: '⛴', name: '渡轮', category: 'travel' },
  { char: '🚢', name: '轮船', category: 'travel' },
  { char: '⚓️', name: '锚', category: 'travel' },
  { char: '🪝', name: '钩子', category: 'travel' },
  { char: '⛽️', name: '加油站', category: 'travel' },
  { char: '🚧', name: '施工', category: 'travel' },
  { char: '🚦', name: '红绿灯', category: 'travel' },
  { char: '🚥', name: '横向红绿灯', category: 'travel' },
  { char: '🚏', name: '公交站', category: 'travel' },
  { char: '🗺', name: '世界地图', category: 'travel' },
  { char: '🗿', name: '摩艾石像', category: 'travel' },
  { char: '🗽', name: '自由女神', category: 'travel' },
  { char: '🗼', name: '东京塔', category: 'travel' },
  { char: '🏰', name: '城堡', category: 'travel' },
  { char: '🏯', name: '日本城堡', category: 'travel' },
  { char: '🏟', name: '体育场', category: 'travel' },
  { char: '🎡', name: '摩天轮', category: 'travel' },
  { char: '🎢', name: '过山车', category: 'travel' },
  { char: '🎠', name: '旋转木马', category: 'travel' },
  { char: '⛲️', name: '喷泉', category: 'travel' },
  { char: '⛱', name: '沙滩伞', category: 'travel' },
  { char: '🏖', name: '沙滩', category: 'travel' },
  { char: '🏝', name: '荒岛', category: 'travel' },
  { char: '🏜', name: '沙漠', category: 'travel' },
  { char: '🌋', name: '火山', category: 'travel' },
  { char: '⛰', name: '山', category: 'travel' },
  { char: '🏔', name: '雪山', category: 'travel' },
  { char: '🗻', name: '富士山', category: 'travel' },
  { char: '🏕', name: '露营', category: 'travel' },
  { char: '⛺️', name: '帐篷', category: 'travel' },
  { char: '🛖', name: '小屋', category: 'travel' },
  { char: '🏠', name: '房子', category: 'travel' },
  { char: '🏡', name: '带花园的房子', category: 'travel' },
  { char: '🏘', name: '房屋建筑', category: 'travel' },
  { char: '🏚', name: '废弃房屋', category: 'travel' },
  { char: '🏗', name: '建筑工地', category: 'travel' },
  { char: '🏭', name: '工厂', category: 'travel' },
  { char: '🏢', name: '办公楼', category: 'travel' },
  { char: '🏬', name: '百货商店', category: 'travel' },
  { char: '🏣', name: '日本邮局', category: 'travel' },
  { char: '🏤', name: '邮局', category: 'travel' },
  { char: '🏥', name: '医院', category: 'travel' },
  { char: '🏦', name: '银行', category: 'travel' },
  { char: '🏨', name: '酒店', category: 'travel' },
  { char: '🏪', name: '便利店', category: 'travel' },
  { char: '🏫', name: '学校', category: 'travel' },
  { char: '🏩', name: '情侣酒店', category: 'travel' },
  { char: '💒', name: '婚礼', category: 'travel' },
  { char: '🏛', name: '古典建筑', category: 'travel' },
  { char: '⛪️', name: '教堂', category: 'travel' },
  { char: '🕌', name: '清真寺', category: 'travel' },
  { char: '🕍', name: '犹太教堂', category: 'travel' },
  { char: '🛕', name: '印度教寺庙', category: 'travel' },
  { char: '🕋', name: '克尔白', category: 'travel' },
  { char: '⛩', name: '神社', category: 'travel' },
  { char: '🛤', name: '铁轨', category: 'travel' },
  { char: '🛣', name: '高速公路', category: 'travel' },
  { char: '🗾', name: '日本地图', category: 'travel' },
  { char: '🎑', name: '月见', category: 'travel' },
  { char: '🏞', name: '国家公园', category: 'travel' },
  { char: '🌅', name: '日出', category: 'travel' },
  { char: '🌄', name: '山间日出', category: 'travel' },
  { char: '🌠', name: '流星', category: 'travel' },
  { char: '🎇', name: '烟花', category: 'travel' },
  { char: '🎆', name: '焰火', category: 'travel' },
  { char: '🌇', name: '日落', category: 'travel' },
  { char: '🌆', name: '城市黄昏', category: 'travel' },
  { char: '🏙', name: '城市景观', category: 'travel' },
  { char: '🌃', name: '星空', category: 'travel' },
  { char: '🌌', name: '银河', category: 'travel' },
  { char: '🌉', name: '夜桥', category: 'travel' },
  { char: '🌁', name: '雾霾', category: 'travel' },

  // 物品类
  { char: '⌚️', name: '手表', category: 'objects' },
  { char: '📱', name: '手机', category: 'objects' },
  { char: '📲', name: '来电手机', category: 'objects' },
  { char: '💻', name: '笔记本电脑', category: 'objects' },
  { char: '⌨️', name: '键盘', category: 'objects' },
  { char: '🖥', name: '台式电脑', category: 'objects' },
  { char: '🖨', name: '打印机', category: 'objects' },
  { char: '🖱', name: '鼠标', category: 'objects' },
  { char: '🖲', name: '轨迹球', category: 'objects' },
  { char: '🕹', name: '游戏手柄', category: 'objects' },
  { char: '🗜', name: '压缩', category: 'objects' },
  { char: '💽', name: '电脑磁盘', category: 'objects' },
  { char: '💾', name: '软盘', category: 'objects' },
  { char: '💿', name: '光盘', category: 'objects' },
  { char: '📀', name: 'DVD', category: 'objects' },
  { char: '📼', name: '录像带', category: 'objects' },
  { char: '📷', name: '相机', category: 'objects' },
  { char: '📸', name: '闪光相机', category: 'objects' },
  { char: '📹', name: '摄像机', category: 'objects' },
  { char: '🎥', name: '电影摄像机', category: 'objects' },
  { char: '📽', name: '放映机', category: 'objects' },
  { char: '🎞', name: '电影胶片', category: 'objects' },
  { char: '📞', name: '电话听筒', category: 'objects' },
  { char: '☎️', name: '电话', category: 'objects' },
  { char: '📟', name: '寻呼机', category: 'objects' },
  { char: '📠', name: '传真机', category: 'objects' },
  { char: '📺', name: '电视', category: 'objects' },
  { char: '📻', name: '收音机', category: 'objects' },
  { char: '🎙', name: '录音室麦克风', category: 'objects' },
  { char: '🎚', name: '音量滑块', category: 'objects' },
  { char: '🎛', name: '控制旋钮', category: 'objects' },
  { char: '🧭', name: '指南针', category: 'objects' },
  { char: '⏱', name: '秒表', category: 'objects' },
  { char: '⏲', name: '定时器', category: 'objects' },
  { char: '⏰', name: '闹钟', category: 'objects' },
  { char: '🕰', name: '座钟', category: 'objects' },
  { char: '⌛️', name: '沙漏', category: 'objects' },
  { char: '⏳', name: '流动沙漏', category: 'objects' },
  { char: '📡', name: '卫星天线', category: 'objects' },
  { char: '🔋', name: '电池', category: 'objects' },
  { char: '🔌', name: '电源插头', category: 'objects' },
  { char: '💡', name: '灯泡', category: 'objects' },
  { char: '🔦', name: '手电筒', category: 'objects' },
  { char: '🕯', name: '蜡烛', category: 'objects' },
  { char: '🪔', name: '油灯', category: 'objects' },
  { char: '🧯', name: '灭火器', category: 'objects' },
  { char: '🛢', name: '油桶', category: 'objects' },
  { char: '💸', name: '带翅膀的钱', category: 'objects' },
  { char: '💵', name: '美元', category: 'objects' },
  { char: '💴', name: '日元', category: 'objects' },
  { char: '💶', name: '欧元', category: 'objects' },
  { char: '💷', name: '英镑', category: 'objects' },
  { char: '🪙', name: '硬币', category: 'objects' },
  { char: '💰', name: '钱袋', category: 'objects' },
  { char: '💳', name: '信用卡', category: 'objects' },
  { char: '💎', name: '宝石', category: 'objects' },
  { char: '⚖️', name: '天平', category: 'objects' },
  { char: '🪜', name: '梯子', category: 'objects' },
  { char: '🧰', name: '工具箱', category: 'objects' },
  { char: '🪛', name: '螺丝刀', category: 'objects' },
  { char: '🔧', name: '扳手', category: 'objects' },
  { char: '🔨', name: '锤子', category: 'objects' },
  { char: '⚒', name: '锤子和镐', category: 'objects' },
  { char: '🛠', name: '锤子和扳手', category: 'objects' },
  { char: '⛏', name: '镐', category: 'objects' },
  { char: '🪚', name: '木工锯', category: 'objects' },
  { char: '🔩', name: '螺母和螺栓', category: 'objects' },
  { char: '⚙️', name: '齿轮', category: 'objects' },
  { char: '🪤', name: '捕鼠器', category: 'objects' },
  { char: '🧱', name: '砖块', category: 'objects' },
  { char: '⛓', name: '锁链', category: 'objects' },
  { char: '🧲', name: '磁铁', category: 'objects' },
  { char: '🔫', name: '水枪', category: 'objects' },
  { char: '💣', name: '炸弹', category: 'objects' },
  { char: '🧨', name: '鞭炮', category: 'objects' },
  { char: '🪓', name: '斧头', category: 'objects' },
  { char: '🔪', name: '厨刀', category: 'objects' },
  { char: '🗡', name: '匕首', category: 'objects' },
  { char: '⚔️', name: '交叉剑', category: 'objects' },
  { char: '🛡', name: '盾牌', category: 'objects' },
  { char: '🚬', name: '香烟', category: 'objects' },
  { char: '⚰️', name: '棺材', category: 'objects' },
  { char: '🪦', name: '墓碑', category: 'objects' },
  { char: '⚱️', name: '骨灰盒', category: 'objects' },
  { char: '🏺', name: '陶罐', category: 'objects' },
  { char: '🔮', name: '水晶球', category: 'objects' },
  { char: '📿', name: '念珠', category: 'objects' },
  { char: '🧿', name: '纳扎尔护身符', category: 'objects' },
  { char: '💈', name: '理发店标志', category: 'objects' },
  { char: '⚗️', name: '蒸馏器', category: 'objects' },
  { char: '🔭', name: '望远镜', category: 'objects' },
  { char: '🔬', name: '显微镜', category: 'objects' },
  { char: '🕳', name: '洞', category: 'objects' },
  { char: '🩹', name: '创可贴', category: 'objects' },
  { char: '🩺', name: '听诊器', category: 'objects' },
  { char: '💊', name: '药丸', category: 'objects' },
  { char: '💉', name: '注射器', category: 'objects' },
  { char: '🩸', name: '血滴', category: 'objects' },
  { char: '🧬', name: 'DNA', category: 'objects' },
  { char: '🦠', name: '细菌', category: 'objects' },
  { char: '🧫', name: '培养皿', category: 'objects' },
  { char: '🧪', name: '试管', category: 'objects' },
  { char: '🌡', name: '温度计', category: 'objects' },
  { char: '🧹', name: '扫帚', category: 'objects' },
  { char: '🪠', name: '通管器', category: 'objects' },
  { char: '🧺', name: '篮子', category: 'objects' },
  { char: '🧻', name: '卷纸', category: 'objects' },
  { char: '🚽', name: '马桶', category: 'objects' },
  { char: '🚰', name: '饮用水', category: 'objects' },
  { char: '🚿', name: '淋浴', category: 'objects' },
  { char: '🛁', name: '浴缸', category: 'objects' },
  { char: '🛀', name: '洗澡', category: 'objects' },
  { char: '🧼', name: '肥皂', category: 'objects' },
  { char: '🪥', name: '牙刷', category: 'objects' },
  { char: '🪒', name: '剃须刀', category: 'objects' },
  { char: '🧽', name: '海绵', category: 'objects' },
  { char: '🪣', name: '水桶', category: 'objects' },
  { char: '🧴', name: '乳液瓶', category: 'objects' },
  { char: '🛎', name: '服务铃', category: 'objects' },
  { char: '🔑', name: '钥匙', category: 'objects' },
  { char: '🗝', name: '老式钥匙', category: 'objects' },
  { char: '🚪', name: '门', category: 'objects' },
  { char: '🪑', name: '椅子', category: 'objects' },
  { char: '🛋', name: '沙发和灯', category: 'objects' },
  { char: '🛏', name: '床', category: 'objects' },
  { char: '🛌', name: '睡觉', category: 'objects' },
  { char: '🧸', name: '泰迪熊', category: 'objects' },
  { char: '🪆', name: '套娃', category: 'objects' },
  { char: '🖼', name: '画框', category: 'objects' },
  { char: '🪞', name: '镜子', category: 'objects' },
  { char: '🪟', name: '窗户', category: 'objects' },
  { char: '🛍', name: '购物袋', category: 'objects' },
  { char: '🛒', name: '购物车', category: 'objects' },
  { char: '🎁', name: '礼物', category: 'objects' },
  { char: '🎈', name: '气球', category: 'objects' },
  { char: '🎏', name: '鲤鱼旗', category: 'objects' },
  { char: '🎀', name: '蝴蝶结', category: 'objects' },
  { char: '🪄', name: '魔杖', category: 'objects' },
  { char: '🪅', name: '皮纳塔', category: 'objects' },
  { char: '🎊', name: '五彩纸屑球', category: 'objects' },
  { char: '🎉', name: '派对礼炮', category: 'objects' },
  { char: '🎎', name: '日本娃娃', category: 'objects' },
  { char: '🏮', name: '红灯笼', category: 'objects' },
  { char: '🎐', name: '风铃', category: 'objects' },
  { char: '🧧', name: '红包', category: 'objects' },
  { char: '✉️', name: '信封', category: 'objects' },
  { char: '📩', name: '带箭头的信封', category: 'objects' },
  { char: '📨', name: '来信', category: 'objects' },
  { char: '📧', name: '电子邮件', category: 'objects' },
  { char: '💌', name: '情书', category: 'objects' },
  { char: '📥', name: '收件箱', category: 'objects' },
  { char: '📤', name: '发件箱', category: 'objects' },
  { char: '📦', name: '包裹', category: 'objects' },
  { char: '🏷', name: '标签', category: 'objects' },
  { char: '🪧', name: '标牌', category: 'objects' },
  { char: '📪', name: '关闭的邮箱', category: 'objects' },
  { char: '📫', name: '有信的邮箱', category: 'objects' },
  { char: '📬', name: '打开的邮箱', category: 'objects' },
  { char: '📭', name: '空邮箱', category: 'objects' },
  { char: '📮', name: '邮筒', category: 'objects' },
  { char: '📯', name: '邮号', category: 'objects' },
  { char: '📜', name: '卷轴', category: 'objects' },
  { char: '📃', name: '卷曲的页面', category: 'objects' },
  { char: '📄', name: '文件', category: 'objects' },
  { char: '📑', name: '书签标签', category: 'objects' },
  { char: '🧾', name: '收据', category: 'objects' },
  { char: '📊', name: '条形图', category: 'objects' },
  { char: '📈', name: '上升趋势图', category: 'objects' },
  { char: '📉', name: '下降趋势图', category: 'objects' },
  { char: '🗒', name: '笔记本', category: 'objects' },
  { char: '🗓', name: '日历', category: 'objects' },
  { char: '📆', name: '撕页日历', category: 'objects' },
  { char: '📅', name: '日历', category: 'objects' },
  { char: '🗑', name: '垃圾桶', category: 'objects' },
  { char: '📇', name: '卡片索引', category: 'objects' },
  { char: '🗃', name: '卡片文件盒', category: 'objects' },
  { char: '🗳', name: '投票箱', category: 'objects' },
  { char: '🗄', name: '文件柜', category: 'objects' },
  { char: '📋', name: '剪贴板', category: 'objects' },
  { char: '📁', name: '文件夹', category: 'objects' },
  { char: '📂', name: '打开的文件夹', category: 'objects' },
  { char: '🗂', name: '卡片分隔符', category: 'objects' },
  { char: '🗞', name: '卷起的报纸', category: 'objects' },
  { char: '📰', name: '报纸', category: 'objects' },
  { char: '📓', name: '笔记本', category: 'objects' },
  { char: '📔', name: '装饰封面笔记本', category: 'objects' },
  { char: '📒', name: '账本', category: 'objects' },
  { char: '📕', name: '红色书本', category: 'objects' },
  { char: '📗', name: '绿色书本', category: 'objects' },
  { char: '📘', name: '蓝色书本', category: 'objects' },
  { char: '📙', name: '橙色书本', category: 'objects' },
  { char: '📚', name: '书籍', category: 'objects' },
  { char: '📖', name: '打开的书', category: 'objects' },
  { char: '🔖', name: '书签', category: 'objects' },
  { char: '🧷', name: '安全别针', category: 'objects' },
  { char: '🔗', name: '链接', category: 'objects' },
  { char: '📎', name: '回形针', category: 'objects' },
  { char: '🖇', name: '连接的回形针', category: 'objects' },
  { char: '📐', name: '三角尺', category: 'objects' },
  { char: '📏', name: '直尺', category: 'objects' },
  { char: '🧮', name: '算盘', category: 'objects' },
  { char: '📌', name: '图钉', category: 'objects' },
  { char: '📍', name: '圆图钉', category: 'objects' },
  { char: '✂️', name: '剪刀', category: 'objects' },
  { char: '🖊', name: '圆珠笔', category: 'objects' },
  { char: '🖋', name: '钢笔', category: 'objects' },
  { char: '✒️', name: '黑色笔尖', category: 'objects' },
  { char: '🖌', name: '画笔', category: 'objects' },
  { char: '🖍', name: '蜡笔', category: 'objects' },
  { char: '📝', name: '备忘录', category: 'objects' },
  { char: '✏️', name: '铅笔', category: 'objects' },
  { char: '🔍', name: '左指放大镜', category: 'objects' },
  { char: '🔎', name: '右指放大镜', category: 'objects' },
  { char: '🔏', name: '带笔的锁', category: 'objects' },
  { char: '🔐', name: '带钥匙的锁', category: 'objects' },
  { char: '🔒', name: '锁', category: 'objects' },
  { char: '🔓', name: '开锁', category: 'objects' },

  // 符号类
  { char: '✢', name: '十字星', category: 'symbols' },
  { char: '✣', name: '四叶星', category: 'symbols' },
  { char: '✤', name: '花形星', category: 'symbols' },
  { char: '✥', name: '方形星', category: 'symbols' },
  { char: '✦', name: '黑星', category: 'symbols' },
  { char: '✧', name: '白星', category: 'symbols' },
  { char: '★', name: '实心星', category: 'symbols' },
  { char: '☆', name: '空心星', category: 'symbols' },
  { char: '✯', name: '装饰星', category: 'symbols' },
  { char: '✡︎', name: '六角星', category: 'symbols' },
  { char: '✩', name: '点缀星', category: 'symbols' },
  { char: '✪', name: '圆圈星', category: 'symbols' },
  { char: '✫', name: '闪亮星', category: 'symbols' },
  { char: '✬', name: '旋转星', category: 'symbols' },
  { char: '✭', name: '轮廓星', category: 'symbols' },
  { char: '✮', name: '阴影星', category: 'symbols' },
  { char: '✶', name: '六角星', category: 'symbols' },
  { char: '✷', name: '八角星', category: 'symbols' },
  { char: '✵', name: '小星', category: 'symbols' },
  { char: '✸', name: '花形星', category: 'symbols' },
  { char: '✹', name: '大星', category: 'symbols' },
  { char: '→', name: '右箭头', category: 'symbols' },
  { char: '⇒', name: '双线右箭头', category: 'symbols' },
  { char: '⟹', name: '粗右箭头', category: 'symbols' },
  { char: '⇨', name: '空心右箭头', category: 'symbols' },
  { char: '⇾', name: '长右箭头', category: 'symbols' },
  { char: '➾', name: '弯曲右箭头', category: 'symbols' },
  { char: '⇢', name: '细右箭头', category: 'symbols' },
  { char: '☛', name: '黑色手指', category: 'symbols' },
  { char: '☞', name: '白色手指', category: 'symbols' },
  { char: '➔', name: '三角箭头', category: 'symbols' },
  { char: '➜', name: '曲线箭头', category: 'symbols' },
  { char: '➙', name: '粗箭头', category: 'symbols' },
  { char: '➛', name: '尖头箭头', category: 'symbols' },
  { char: '➝', name: '细长箭头', category: 'symbols' },
  { char: '➞', name: '空心长箭头', category: 'symbols' },
  { char: '♠︎', name: '黑桃', category: 'symbols' },
  { char: '♣︎', name: '梅花', category: 'symbols' },
  { char: '♥︎', name: '红心', category: 'symbols' },
  { char: '♦︎', name: '方块', category: 'symbols' },
  { char: '♤', name: '空心黑桃', category: 'symbols' },
  { char: '♧', name: '空心梅花', category: 'symbols' },
  { char: '♡', name: '空心红心', category: 'symbols' },
  { char: '♢', name: '空心方块', category: 'symbols' },
  { char: '♚', name: '黑色国王', category: 'symbols' },
  { char: '♛', name: '黑色皇后', category: 'symbols' },
  { char: '♜', name: '黑色城堡', category: 'symbols' },
  { char: '♝', name: '黑色主教', category: 'symbols' },
  { char: '♞', name: '黑色骑士', category: 'symbols' },
  { char: '♟', name: '黑色兵', category: 'symbols' },
  { char: '♔', name: '白色国王', category: 'symbols' },
  { char: '♕', name: '白色皇后', category: 'symbols' },
  { char: '♖', name: '白色城堡', category: 'symbols' },
  { char: '♗', name: '白色主教', category: 'symbols' },
  { char: '♘', name: '白色骑士', category: 'symbols' },
  { char: '♙', name: '白色兵', category: 'symbols' },
  { char: '⚀', name: '骰子1', category: 'symbols' },
  { char: '⚁', name: '骰子2', category: 'symbols' },
  { char: '⚂', name: '骰子3', category: 'symbols' },
  { char: '⚃', name: '骰子4', category: 'symbols' },
  { char: '⚄', name: '骰子5', category: 'symbols' },
  { char: '⚅', name: '骰子6', category: 'symbols' },
  { char: '🂠', name: '扑克牌背面', category: 'symbols' },
  { char: '⚈', name: '黑圆', category: 'symbols' },
  { char: '⚉', name: '白圆', category: 'symbols' },
  { char: '⚆', name: '白圈黑点', category: 'symbols' },
  { char: '⚇', name: '黑圈白点', category: 'symbols' },
  { char: '𓀀', name: '埃及象形文字A', category: 'symbols' },
  { char: '𓀁', name: '埃及象形文字B', category: 'symbols' },
  { char: '𓀂', name: '埃及象形文字C', category: 'symbols' },
  { char: '𓀃', name: '埃及象形文字D', category: 'symbols' },
  { char: '𓀄', name: '埃及象形文字E', category: 'symbols' },
  { char: '𓀅', name: '埃及象形文字F', category: 'symbols' },
  { char: '𓀆', name: '埃及象形文字G', category: 'symbols' },
  { char: '𓀇', name: '埃及象形文字H', category: 'symbols' },
  { char: '𓀈', name: '埃及象形文字I', category: 'symbols' },
  { char: '𓀉', name: '埃及象形文字J', category: 'symbols' },
  { char: '𓀊', name: '埃及象形文字K', category: 'symbols' },
  { char: '𓀋', name: '埃及象形文字L', category: 'symbols' },
  { char: '𓀌', name: '埃及象形文字M', category: 'symbols' },
  { char: '𓀍', name: '埃及象形文字N', category: 'symbols' },
  { char: '𓀎', name: '埃及象形文字O', category: 'symbols' },
  { char: '𓀏', name: '埃及象形文字P', category: 'symbols' },
  { char: '𓀐', name: '埃及象形文字Q', category: 'symbols' },
  { char: '𓀑', name: '埃及象形文字R', category: 'symbols' },
  { char: '𓀒', name: '埃及象形文字S', category: 'symbols' },
  { char: '𓀓', name: '埃及象形文字T', category: 'symbols' },
  { char: '𓀔', name: '埃及象形文字U', category: 'symbols' },
  { char: '𓀕', name: '埃及象形文字V', category: 'symbols' },
  { char: '𓀖', name: '埃及象形文字W', category: 'symbols' },
  { char: '𓀗', name: '埃及象形文字X', category: 'symbols' },
  { char: '𓀘', name: '埃及象形文字Y', category: 'symbols' },
  { char: '𓀙', name: '埃及象形文字Z', category: 'symbols' },
  { char: '𓀚', name: '埃及象形文字AA', category: 'symbols' },
  { char: '𓀛', name: '埃及象形文字AB', category: 'symbols' },
  { char: '𓀜', name: '埃及象形文字AC', category: 'symbols' },
  { char: '𓀝', name: '埃及象形文字AD', category: 'symbols' },

  // 符号类 - 添加新的符号
  { char: '❤️', name: '红心', category: 'symbols' },
  { char: '🧡', name: '橙心', category: 'symbols' },
  { char: '💛', name: '黄心', category: 'symbols' },
  { char: '💚', name: '绿心', category: 'symbols' },
  { char: '💙', name: '蓝心', category: 'symbols' },
  { char: '💜', name: '紫心', category: 'symbols' },
  { char: '🖤', name: '黑心', category: 'symbols' },
  { char: '🤍', name: '白心', category: 'symbols' },
  { char: '🤎', name: '棕心', category: 'symbols' },
  { char: '💔', name: '碎心', category: 'symbols' },
  { char: '❣️', name: '心形感叹号', category: 'symbols' },
  { char: '💕', name: '双心', category: 'symbols' },
  { char: '💞', name: '旋转的心', category: 'symbols' },
  { char: '💓', name: '跳动的心', category: 'symbols' },
  { char: '💗', name: '增大的心', category: 'symbols' },
  { char: '💖', name: '闪烁的心', category: 'symbols' },
  { char: '💘', name: '箭头穿心', category: 'symbols' },
  { char: '💝', name: '心形礼物', category: 'symbols' },
  { char: '💟', name: '心形装饰', category: 'symbols' },
  { char: '☮️', name: '和平符号', category: 'symbols' },
  { char: '✝️', name: '拉丁十字架', category: 'symbols' },
  { char: '☪️', name: '星月', category: 'symbols' },
  { char: '🕉', name: '奥姆', category: 'symbols' },
  { char: '☸️', name: '法轮', category: 'symbols' },
  { char: '✡️', name: '大卫星', category: 'symbols' },
  { char: '🔯', name: '六角星', category: 'symbols' },
  { char: '🕎', name: '烛台', category: 'symbols' },
  { char: '☯️', name: '阴阳', category: 'symbols' },
  { char: '☦️', name: '东正教十字架', category: 'symbols' },
  { char: '🛐', name: '礼拜场所', category: 'symbols' },
  { char: '⛎', name: '蛇夫座', category: 'symbols' },
  { char: '♈️', name: '白羊座', category: 'symbols' },
  { char: '♉️', name: '金牛座', category: 'symbols' },
  { char: '♊️', name: '双子座', category: 'symbols' },
  { char: '♋️', name: '巨蟹座', category: 'symbols' },
  { char: '♌️', name: '狮子座', category: 'symbols' },
  { char: '♍️', name: '处女座', category: 'symbols' },
  { char: '♎️', name: '天秤座', category: 'symbols' },
  { char: '♏️', name: '天蝎座', category: 'symbols' },
  { char: '♐️', name: '射手座', category: 'symbols' },
  { char: '♑️', name: '摩羯座', category: 'symbols' },
  { char: '♒️', name: '水瓶座', category: 'symbols' },
  { char: '♓️', name: '双鱼座', category: 'symbols' },
  { char: '🆔', name: 'ID标志', category: 'symbols' },
  { char: '⚛️', name: '原子符号', category: 'symbols' },
  { char: '🉑', name: '可接受', category: 'symbols' },
  { char: '☢️', name: '辐射', category: 'symbols' },
  { char: '☣️', name: '生物危害', category: 'symbols' },
  { char: '📴', name: '手机关机', category: 'symbols' },
  { char: '📳', name: '振动模式', category: 'symbols' },
  { char: '🈶', name: '有', category: 'symbols' },
  { char: '🈚️', name: '无', category: 'symbols' },
  { char: '🈸', name: '申', category: 'symbols' },
  { char: '🈺', name: '营业', category: 'symbols' },
  { char: '🈷️', name: '月', category: 'symbols' },
  { char: '✴️', name: '八角星', category: 'symbols' },
  { char: '🆚', name: '对抗', category: 'symbols' },
  { char: '💮', name: '白花', category: 'symbols' },
  { char: '🉐', name: '得', category: 'symbols' },
  { char: '㊙️', name: '秘密', category: 'symbols' },
  { char: '㊗️', name: '祝贺', category: 'symbols' },
  { char: '🈴', name: '合格', category: 'symbols' },
  { char: '🈵', name: '满', category: 'symbols' },
  { char: '🈹', name: '折扣', category: 'symbols' },
  { char: '🈲', name: '禁止', category: 'symbols' },
  { char: '🅰️', name: 'A型血', category: 'symbols' },
  { char: '🅱️', name: 'B型血', category: 'symbols' },
  { char: '🆎', name: 'AB型血', category: 'symbols' },
  { char: '🆑', name: '清除', category: 'symbols' },
  { char: '🅾️', name: 'O型血', category: 'symbols' },
  { char: '🆘', name: 'SOS', category: 'symbols' },
  { char: '❌', name: '叉号', category: 'symbols' },
  { char: '⭕️', name: '圆圈', category: 'symbols' },
  { char: '🛑', name: '停止标志', category: 'symbols' },
  { char: '⛔️', name: '禁止通行', category: 'symbols' },
  { char: '📛', name: '名牌', category: 'symbols' },
  { char: '🚫', name: '禁止', category: 'symbols' },
  { char: '💯', name: '满分', category: 'symbols' },
  { char: '💢', name: '愤怒', category: 'symbols' },
  { char: '♨️', name: '温泉', category: 'symbols' },
  { char: '🚷', name: '禁止行人', category: 'symbols' },
  { char: '🚯', name: '禁止乱扔垃圾', category: 'symbols' },
  { char: '🚳', name: '禁止自行车', category: 'symbols' },
  { char: '🚱', name: '非饮用水', category: 'symbols' },
  { char: '🔞', name: '禁止未成年', category: 'symbols' },
  { char: '📵', name: '禁止手机', category: 'symbols' },
  { char: '🚭', name: '禁止吸烟', category: 'symbols' },
  { char: '❗️', name: '红色感叹号', category: 'symbols' },
  { char: '❕', name: '白色感叹号', category: 'symbols' },
  { char: '❓', name: '红色问号', category: 'symbols' },
  { char: '❔', name: '白色问号', category: 'symbols' },
  { char: '‼️', name: '双感叹号', category: 'symbols' },
  { char: '⁉️', name: '感叹问号', category: 'symbols' },
  { char: '🔅', name: '低亮度', category: 'symbols' },
  { char: '🔆', name: '高亮度', category: 'symbols' },
  { char: '〽️', name: '歌曲部分标记', category: 'symbols' },
  { char: '⚠️', name: '警告', category: 'symbols' },
  { char: '🚸', name: '儿童通行', category: 'symbols' },
  { char: '🔱', name: '三叉戟徽章', category: 'symbols' },
  { char: '⚜️', name: '百合花徽章', category: 'symbols' },
  { char: '🔰', name: '日本初学者标志', category: 'symbols' },
  { char: '♻️', name: '回收', category: 'symbols' },
  { char: '✅', name: '白色复选标记', category: 'symbols' },
  { char: '🈯️', name: '指示', category: 'symbols' },
  { char: '💹', name: '日元上涨', category: 'symbols' },
  { char: '❇️', name: '闪光', category: 'symbols' },
  { char: '✳️', name: '八角星', category: 'symbols' },
  { char: '❎', name: '叉号按钮', category: 'symbols' },
  { char: '🌐', name: '地球', category: 'symbols' },
  { char: '💠', name: '钻石形状', category: 'symbols' },
  { char: 'Ⓜ️', name: '地铁', category: 'symbols' },
  { char: '🌀', name: '旋涡', category: 'symbols' },
  { char: '💤', name: '睡眠符号', category: 'symbols' },
  { char: '🏧', name: 'ATM', category: 'symbols' },
  { char: '🚾', name: '洗手间', category: 'symbols' },
  { char: '♿️', name: '轮椅通道', category: 'symbols' },
  { char: '🅿️', name: '停车场', category: 'symbols' },
  { char: '🛗', name: '电梯', category: 'symbols' },
  { char: '🈳', name: '空缺', category: 'symbols' },
  { char: '🈂️', name: '服务费', category: 'symbols' },
  { char: '🛂', name: '护照检查', category: 'symbols' },
  { char: '🛃', name: '海关', category: 'symbols' },
  { char: '🛄', name: '行李认领', category: 'symbols' },
  { char: '🛅', name: '行李寄存', category: 'symbols' },
  { char: '🚹', name: '男厕', category: 'symbols' },
  { char: '🚺', name: '女厕', category: 'symbols' },
  { char: '🚼', name: '婴儿符号', category: 'symbols' },
  { char: '⚧', name: '跨性别符号', category: 'symbols' },
  { char: '🚻', name: '洗手间', category: 'symbols' },
  { char: '🚮', name: '垃圾箱', category: 'symbols' },
  { char: '🎦', name: '电影院', category: 'symbols' },
  { char: '📶', name: '信号强度', category: 'symbols' },
  { char: '🈁', name: '这里', category: 'symbols' },
  { char: '🔣', name: '符号输入', category: 'symbols' },
  { char: 'ℹ️', name: '信息', category: 'symbols' },
  { char: '🔤', name: '字母输入', category: 'symbols' },
  { char: '🔡', name: '小写输入', category: 'symbols' },
  { char: '🔠', name: '大写输入', category: 'symbols' },
  { char: '🆖', name: '不好', category: 'symbols' },
  { char: '🆗', name: '好的', category: 'symbols' },
  { char: '🆙', name: '上升', category: 'symbols' },
  { char: '🆒', name: '酷', category: 'symbols' },
  { char: '🆕', name: '新', category: 'symbols' },
  { char: '🆓', name: '免费', category: 'symbols' },
  { char: '0️⃣', name: '数字0', category: 'symbols' },
  { char: '1️⃣', name: '数字1', category: 'symbols' },
  { char: '2️⃣', name: '数字2', category: 'symbols' },
  { char: '3️⃣', name: '数字3', category: 'symbols' },
  { char: '4️⃣', name: '数字4', category: 'symbols' },
  { char: '5️⃣', name: '数字5', category: 'symbols' },
  { char: '6️⃣', name: '数字6', category: 'symbols' },
  { char: '7️⃣', name: '数字7', category: 'symbols' },
  { char: '8️⃣', name: '数字8', category: 'symbols' },
  { char: '9️⃣', name: '数字9', category: 'symbols' },
  { char: '🔟', name: '数字10', category: 'symbols' },
  { char: '🔢', name: '数字输入', category: 'symbols' },
  { char: '#️⃣', name: '井号键', category: 'symbols' },
  { char: '*️⃣', name: '星号键', category: 'symbols' },
  { char: '⏏️', name: '弹出按钮', category: 'symbols' },
  { char: '▶️', name: '播放按钮', category: 'symbols' },
  { char: '⏸', name: '暂停按钮', category: 'symbols' },
  { char: '⏯', name: '播放暂停按钮', category: 'symbols' },
  { char: '⏹', name: '停止按钮', category: 'symbols' },
  { char: '⏺', name: '录制按钮', category: 'symbols' },
  { char: '⏭', name: '下一曲按钮', category: 'symbols' },
  { char: '⏮', name: '上一曲按钮', category: 'symbols' },
  { char: '⏩', name: '快进按钮', category: 'symbols' },
  { char: '⏪', name: '快退按钮', category: 'symbols' },
  { char: '⏫', name: '快速上升按钮', category: 'symbols' },
  { char: '⏬', name: '快速下降按钮', category: 'symbols' },
  { char: '◀️', name: '反向按钮', category: 'symbols' },
  { char: '🔼', name: '上升按钮', category: 'symbols' },
  { char: '🔽', name: '下降按钮', category: 'symbols' },
  { char: '➡️', name: '向右箭头', category: 'symbols' },
  { char: '⬅️', name: '向左箭头', category: 'symbols' },
  { char: '⬆️', name: '向上箭头', category: 'symbols' },
  { char: '⬇️', name: '向下箭头', category: 'symbols' },
  { char: '↗️', name: '右上箭头', category: 'symbols' },
  { char: '↘️', name: '右下箭头', category: 'symbols' },
  { char: '↙️', name: '左下箭头', category: 'symbols' },
  { char: '↖️', name: '左上箭头', category: 'symbols' },
  { char: '↕️', name: '上下箭头', category: 'symbols' },
  { char: '↔️', name: '左右箭头', category: 'symbols' },
  { char: '↪️', name: '右弯箭头', category: 'symbols' },
  { char: '↩️', name: '左弯箭头', category: 'symbols' },
  { char: '⤴️', name: '右上弯箭头', category: 'symbols' },
  { char: '⤵️', name: '右下弯箭头', category: 'symbols' },
  { char: '🔀', name: '随机播放按钮', category: 'symbols' },
  { char: '🔁', name: '重复按钮', category: 'symbols' },
  { char: '🔂', name: '单曲循环按钮', category: 'symbols' },
  { char: '🔄', name: '逆时针箭头', category: 'symbols' },
  { char: '🔃', name: '顺时针箭头', category: 'symbols' },
  { char: '🎵', name: '音符', category: 'symbols' },
  { char: '🎶', name: '音符', category: 'symbols' },
  { char: '➕', name: '加号', category: 'symbols' },
  { char: '➖', name: '减号', category: 'symbols' },
  { char: '➗', name: '除号', category: 'symbols' },
  { char: '✖️', name: '乘号', category: 'symbols' },
  { char: '♾', name: '无限', category: 'symbols' },
  { char: '💲', name: '美元符号', category: 'symbols' },
  { char: '💱', name: '货币兑换', category: 'symbols' },
  { char: '™️', name: '商标', category: 'symbols' },
  { char: '©️', name: '版权', category: 'symbols' },
  { char: '®️', name: '注册商标', category: 'symbols' },
  { char: '〰️', name: '波浪线', category: 'symbols' },
  { char: '➰', name: '卷曲环', category: 'symbols' },
  { char: '➿', name: '双卷曲环', category: 'symbols' },
  { char: '🔚', name: '结束箭头', category: 'symbols' },
  { char: '🔙', name: '返回箭头', category: 'symbols' },
  { char: '🔛', name: '开启箭头', category: 'symbols' },
  { char: '🔝', name: '顶部箭头', category: 'symbols' },
  { char: '🔜', name: '快进箭头', category: 'symbols' },
  { char: '✔️', name: '复选标记', category: 'symbols' },
  { char: '☑️', name: '复选框', category: 'symbols' },
  { char: '🔘', name: '单选按钮', category: 'symbols' },
  { char: '🔴', name: '红色圆圈', category: 'symbols' },
  { char: '🟠', name: '橙色圆圈', category: 'symbols' },
  { char: '🟡', name: '黄色圆圈', category: 'symbols' },
  { char: '🟢', name: '绿色圆圈', category: 'symbols' },
  { char: '🔵', name: '蓝色圆圈', category: 'symbols' },
  { char: '🟣', name: '紫色圆圈', category: 'symbols' },
  { char: '⚫️', name: '黑色圆圈', category: 'symbols' },
  { char: '⚪️', name: '白色圆圈', category: 'symbols' },
  { char: '🟤', name: '棕色圆圈', category: 'symbols' },
  { char: '🔺', name: '红色三角形', category: 'symbols' },
  { char: '🔻', name: '红色倒三角', category: 'symbols' },
  { char: '🔸', name: '小橙色菱形', category: 'symbols' },
  { char: '🔹', name: '小蓝色菱形', category: 'symbols' },
  { char: '🔶', name: '大橙色菱形', category: 'symbols' },
  { char: '🔷', name: '大蓝色菱形', category: 'symbols' },
  { char: '🔳', name: '白色方形按钮', category: 'symbols' },
  { char: '🔲', name: '黑色方形按钮', category: 'symbols' },
  { char: '▪️', name: '黑色小方块', category: 'symbols' },
  { char: '▫️', name: '白色小方块', category: 'symbols' },
  { char: '◾️', name: '黑色中方块', category: 'symbols' },
  { char: '◽️', name: '白色中方块', category: 'symbols' },
  { char: '◼️', name: '黑色大方块', category: 'symbols' },
  { char: '◻️', name: '白色大方块', category: 'symbols' },
  { char: '🟥', name: '红色方块', category: 'symbols' },
  { char: '🟧', name: '橙色方块', category: 'symbols' },
  { char: '🟨', name: '黄色方块', category: 'symbols' },
  { char: '🟩', name: '绿色方块', category: 'symbols' },
  { char: '🟦', name: '蓝色方块', category: 'symbols' },
  { char: '🟪', name: '紫色方块', category: 'symbols' },
  { char: '⬛️', name: '黑色大方块', category: 'symbols' },
  { char: '⬜️', name: '白色大方块', category: 'symbols' },
  { char: '🟫', name: '棕色方块', category: 'symbols' },
  { char: '🔈', name: '扬声器低音量', category: 'symbols' },
  { char: '🔇', name: '静音扬声器', category: 'symbols' },
  { char: '🔉', name: '扬声器中音量', category: 'symbols' },
  { char: '🔊', name: '扬声器高音量', category: 'symbols' },
  { char: '🔔', name: '铃铛', category: 'symbols' },
  { char: '🔕', name: '静音铃铛', category: 'symbols' },
  { char: '📣', name: '扩音器', category: 'symbols' },
  { char: '📢', name: '大喇叭', category: 'symbols' },
  { char: '👁‍🗨', name: '眼睛在讲话泡泡中', category: 'symbols' },
  { char: '💬', name: '讲话泡泡', category: 'symbols' },
  { char: '💭', name: '思考泡泡', category: 'symbols' },
  { char: '🗯', name: '右怒气泡泡', category: 'symbols' },
  { char: '♠️', name: '黑桃', category: 'symbols' },
  { char: '♣️', name: '梅花', category: 'symbols' },
  { char: '♥️', name: '红心', category: 'symbols' },
  { char: '♦️', name: '方块', category: 'symbols' },
  { char: '🃏', name: '小丑牌', category: 'symbols' },
  { char: '🎴', name: '花札', category: 'symbols' },
  { char: '🀄️', name: '麻将牌中', category: 'symbols' },
  { char: '🕐', name: '1点钟', category: 'symbols' },
  { char: '🕑', name: '2点钟', category: 'symbols' },
  { char: '🕒', name: '3点钟', category: 'symbols' },
  { char: '🕓', name: '4点钟', category: 'symbols' },
  { char: '🕔', name: '5点钟', category: 'symbols' },
  { char: '🕕', name: '6点钟', category: 'symbols' },
  { char: '🕖', name: '7点钟', category: 'symbols' },
  { char: '🕗', name: '8点钟', category: 'symbols' },
  { char: '🕘', name: '9点钟', category: 'symbols' },
  { char: '🕙', name: '10点钟', category: 'symbols' },
  { char: '🕚', name: '11点钟', category: 'symbols' },
  { char: '🕛', name: '12点钟', category: 'symbols' },
  { char: '🕜', name: '1点30分', category: 'symbols' },
  { char: '🕝', name: '2点30分', category: 'symbols' },
  { char: '🕞', name: '3点30分', category: 'symbols' },
  { char: '🕟', name: '4点30分', category: 'symbols' },
  { char: '🕠', name: '5点30分', category: 'symbols' },
  { char: '🕡', name: '6点30分', category: 'symbols' },
  { char: '🕢', name: '7点30分', category: 'symbols' },
  { char: '🕣', name: '8点30分', category: 'symbols' },
  { char: '🕤', name: '9点30分', category: 'symbols' },
  { char: '🕥', name: '10点30分', category: 'symbols' },
  { char: '🕦', name: '11点30分', category: 'symbols' },
  { char: '🕧', name: '12点30分', category: 'symbols' },
  { char: '🏳️', name: '白旗', category: 'flags' },
  { char: '🏴', name: '黑旗', category: 'flags' },
  { char: '🏁', name: '格子旗', category: 'flags' },
  { char: '🚩', name: '三角旗', category: 'flags' },
  { char: '🏳️‍🌈', name: '彩虹旗', category: 'flags' },
  { char: '🏳️‍⚧️', name: '跨性别旗', category: 'flags' },
  { char: '🏴‍☠️', name: '海盗旗', category: 'flags' },
  { char: '🇦🇫', name: '阿富汗', category: 'flags' },
  { char: '🇦🇽', name: '奥兰群岛', category: 'flags' },
  { char: '🇦🇱', name: '阿尔巴尼亚', category: 'flags' },
  { char: '🇩🇿', name: '阿尔及利亚', category: 'flags' },
  { char: '🇦🇸', name: '美属萨摩亚', category: 'flags' },
  { char: '🇦🇩', name: '安道尔', category: 'flags' },
  { char: '🇦🇴', name: '安哥拉', category: 'flags' },
  { char: '🇦🇮', name: '安圭拉', category: 'flags' },
  { char: '🇦🇶', name: '南极洲', category: 'flags' },
  { char: '🇦🇬', name: '安提瓜和巴布达', category: 'flags' },
  { char: '🇦🇷', name: '阿根廷', category: 'flags' },
  { char: '🇦🇲', name: '亚美尼亚', category: 'flags' },
  { char: '🇦🇼', name: '阿鲁巴', category: 'flags' },
  { char: '🇦🇺', name: '澳大利亚', category: 'flags' },
  { char: '🇦🇹', name: '奥地利', category: 'flags' },
  { char: '🇦🇿', name: '阿塞拜疆', category: 'flags' },
  { char: '🇧🇸', name: '巴哈马', category: 'flags' },
  { char: '🇧🇭', name: '巴林', category: 'flags' },
  { char: '🇧🇩', name: '孟加拉国', category: 'flags' },
  { char: '🇧🇧', name: '巴巴多斯', category: 'flags' },
  { char: '🇧🇾', name: '白俄罗斯', category: 'flags' },
  { char: '🇧🇪', name: '比利时', category: 'flags' },
  { char: '🇧🇿', name: '伯利兹', category: 'flags' },
  { char: '🇧🇯', name: '贝宁', category: 'flags' },
  { char: '🇧🇲', name: '百慕大', category: 'flags' },
  { char: '🇧🇹', name: '不丹', category: 'flags' },
  { char: '🇧🇴', name: '玻利维亚', category: 'flags' },
  { char: '🇧🇦', name: '波斯尼亚和黑塞哥维那', category: 'flags' },
  { char: '🇧🇼', name: '博茨瓦纳', category: 'flags' },
  { char: '🇧🇷', name: '巴西', category: 'flags' },
  { char: '🇮🇴', name: '英属印度洋领地', category: 'flags' },
  { char: '🇻🇬', name: '英属维尔京群岛', category: 'flags' },
  { char: '🇧🇳', name: '文莱', category: 'flags' },
  { char: '🇧🇬', name: '保加利亚', category: 'flags' },
  { char: '🇧🇫', name: '布基纳法索', category: 'flags' },
  { char: '🇧🇮', name: '布隆迪', category: 'flags' },
  { char: '🇰🇭', name: '柬埔寨', category: 'flags' },
  { char: '🇨🇲', name: '喀麦隆', category: 'flags' },
  { char: '🇨🇦', name: '加拿大', category: 'flags' },
  { char: '🇮🇨', name: '加那利群岛', category: 'flags' },
  { char: '🇨🇻', name: '佛得角', category: 'flags' },
  { char: '🇧🇶', name: '加勒比荷兰', category: 'flags' },
  { char: '🇰🇾', name: '开曼群岛', category: 'flags' },
  { char: '🇨🇫', name: '中非共和国', category: 'flags' },
  { char: '🇹🇩', name: '乍得', category: 'flags' },
  { char: '🇨🇱', name: '智利', category: 'flags' },
  { char: '🇨🇳', name: '中国', category: 'flags' },
  { char: '🇨🇽', name: '圣诞岛', category: 'flags' },
  { char: '🇨🇨', name: '科科斯群岛', category: 'flags' },
  { char: '🇨🇴', name: '哥伦比亚', category: 'flags' },
  { char: '🇰🇲', name: '科摩罗', category: 'flags' },
  { char: '🇨🇬', name: '刚果共和国', category: 'flags' },
  { char: '🇨🇩', name: '刚果民主共和国', category: 'flags' },
  { char: '🇨🇰', name: '库克群岛', category: 'flags' },
  { char: '🇨🇷', name: '哥斯达黎加', category: 'flags' },
  { char: '🇨🇮', name: '科特迪瓦', category: 'flags' },
  { char: '🇭🇷', name: '克罗地亚', category: 'flags' },
  { char: '🇨🇺', name: '古巴', category: 'flags' },
  { char: '🇨🇼', name: '库拉索', category: 'flags' },
  { char: '🇨🇾', name: '塞浦路斯', category: 'flags' },
  { char: '🇨🇿', name: '捷克', category: 'flags' },
  { char: '🇩🇰', name: '丹麦', category: 'flags' },
  { char: '🇩🇯', name: '吉布提', category: 'flags' },
  { char: '🇩🇲', name: '多米尼克', category: 'flags' },
  { char: '🇩🇴', name: '多米尼加共和国', category: 'flags' },
  { char: '🇪🇨', name: '厄瓜多尔', category: 'flags' },
  { char: '🇪🇬', name: '埃及', category: 'flags' },
  { char: '🇸🇻', name: '萨尔瓦多', category: 'flags' },
  { char: '🇬🇶', name: '赤道几内亚', category: 'flags' },
  { char: '🇪🇷', name: '厄立特里亚', category: 'flags' },
  { char: '🇪🇪', name: '爱沙尼亚', category: 'flags' },
  { char: '🇪🇹', name: '埃塞俄比亚', category: 'flags' },
  { char: '🇪🇺', name: '欧盟', category: 'flags' },
  { char: '🇫🇰', name: '福克兰群岛', category: 'flags' },
  { char: '🇫🇴', name: '法罗群岛', category: 'flags' },
  { char: '🇫🇯', name: '斐济', category: 'flags' },
  { char: '🇫🇮', name: '芬兰', category: 'flags' },
  { char: '🇫🇷', name: '法国', category: 'flags' },
  { char: '🇬🇫', name: '法属圭亚那', category: 'flags' },
  { char: '🇵🇫', name: '法属波利尼西亚', category: 'flags' },
  { char: '🇹🇫', name: '法属南部领地', category: 'flags' },
  { char: '🇬🇦', name: '加蓬', category: 'flags' },
  { char: '🇬🇲', name: '冈比亚', category: 'flags' },
  { char: '🇬🇪', name: '格鲁吉亚', category: 'flags' },
  { char: '🇩🇪', name: '德国', category: 'flags' },
  { char: '🇬🇭', name: '加纳', category: 'flags' },
  { char: '🇬🇮', name: '直布罗陀', category: 'flags' },
  { char: '🇬🇷', name: '希腊', category: 'flags' },
  { char: '🇬🇱', name: '格陵兰', category: 'flags' },
  { char: '🇬🇩', name: '格林纳达', category: 'flags' },
  { char: '🇬🇵', name: '瓜德罗普', category: 'flags' },
  { char: '🇬🇺', name: '关岛', category: 'flags' },
  { char: '🇬🇹', name: '危地马拉', category: 'flags' },
  { char: '🇬🇬', name: '根西岛', category: 'flags' },
  { char: '🇬🇳', name: '几内亚', category: 'flags' },
  { char: '🇬🇼', name: '几内亚比绍', category: 'flags' },
  { char: '🇬🇾', name: '圭亚那', category: 'flags' },
  { char: '🇭🇹', name: '海地', category: 'flags' },
  { char: '🇭🇳', name: '洪都拉斯', category: 'flags' },
  { char: '🇭🇰', name: '香港', category: 'flags' },
  { char: '🇭🇺', name: '匈牙利', category: 'flags' },
  { char: '🇮🇸', name: '冰岛', category: 'flags' },
  { char: '🇮🇳', name: '印度', category: 'flags' },
  { char: '🇮🇩', name: '印度尼西亚', category: 'flags' },
  { char: '🇮🇷', name: '伊朗', category: 'flags' },
  { char: '🇮🇶', name: '伊拉克', category: 'flags' },
  { char: '🇮🇪', name: '爱尔兰', category: 'flags' },
  { char: '🇮🇲', name: '马恩岛', category: 'flags' },
  { char: '🇮🇱', name: '以色列', category: 'flags' },
  { char: '🇮🇹', name: '意大利', category: 'flags' },
  { char: '🇯🇲', name: '牙买加', category: 'flags' },
  { char: '🇯🇵', name: '日本', category: 'flags' },
  { char: '🎌', name: '交叉的日本旗', category: 'flags' },
  { char: '🇯🇪', name: '泽西岛', category: 'flags' },
  { char: '🇯🇴', name: '约旦', category: 'flags' },
  { char: '🇰🇿', name: '哈萨克斯坦', category: 'flags' },
  { char: '🇰🇪', name: '肯尼亚', category: 'flags' },
  { char: '🇰🇮', name: '基里巴斯', category: 'flags' },
  { char: '🇽🇰', name: '科索沃', category: 'flags' },
  { char: '🇰🇼', name: '科威特', category: 'flags' },
  { char: '🇰🇬', name: '吉尔吉斯斯坦', category: 'flags' },
  { char: '🇱🇦', name: '老挝', category: 'flags' },
  { char: '🇱🇻', name: '拉脱维亚', category: 'flags' },
  { char: '🇱🇧', name: '黎巴嫩', category: 'flags' },
  { char: '🇱🇸', name: '莱索托', category: 'flags' },
  { char: '🇱🇷', name: '利比里亚', category: 'flags' },
  { char: '🇱🇾', name: '利比亚', category: 'flags' },
  { char: '🇱🇮', name: '列支敦士登', category: 'flags' },
  { char: '🇱🇹', name: '立陶宛', category: 'flags' },
  { char: '🇱🇺', name: '卢森堡', category: 'flags' },
  { char: '🇲🇴', name: '澳门', category: 'flags' },
  { char: '🇲🇰', name: '北马其顿', category: 'flags' },
  { char: '🇲🇬', name: '马达加斯加', category: 'flags' },
  { char: '🇲🇼', name: '马拉维', category: 'flags' },
  { char: '🇲🇾', name: '马来西亚', category: 'flags' },
  { char: '🇲🇻', name: '马尔代夫', category: 'flags' },
  { char: '🇲🇱', name: '马里', category: 'flags' },
  { char: '🇲🇹', name: '马耳他', category: 'flags' },
  { char: '🇲🇭', name: '马绍尔群岛', category: 'flags' },
  { char: '🇲🇶', name: '马提尼克', category: 'flags' },
  { char: '🇲🇷', name: '毛里塔尼亚', category: 'flags' },
  { char: '🇲🇺', name: '毛里求斯', category: 'flags' },
  { char: '🇾🇹', name: '马约特', category: 'flags' },
  { char: '🇲🇽', name: '墨西哥', category: 'flags' },
  { char: '🇫🇲', name: '密克罗尼西亚', category: 'flags' },
  { char: '🇲🇩', name: '摩尔多瓦', category: 'flags' },
  { char: '🇲🇨', name: '摩纳哥', category: 'flags' },
  { char: '🇲🇳', name: '蒙古', category: 'flags' },
  { char: '🇲🇪', name: '黑山', category: 'flags' },
  { char: '🇲🇸', name: '蒙特塞拉特', category: 'flags' },
  { char: '🇲🇦', name: '摩洛哥', category: 'flags' },
  { char: '🇲🇿', name: '莫桑比克', category: 'flags' },
  { char: '🇲🇲', name: '缅甸', category: 'flags' },
  { char: '🇳🇦', name: '纳米比亚', category: 'flags' },
  { char: '🇳🇷', name: '瑙鲁', category: 'flags' },
  { char: '🇳🇵', name: '尼泊尔', category: 'flags' },
  { char: '🇳🇱', name: '荷兰', category: 'flags' },
  { char: '🇳🇨', name: '新喀里多尼亚', category: 'flags' },
  { char: '🇳🇿', name: '新西兰', category: 'flags' },
  { char: '🇳🇮', name: '尼加拉瓜', category: 'flags' },
  { char: '🇳🇪', name: '尼日尔', category: 'flags' },
  { char: '🇳🇬', name: '尼日利亚', category: 'flags' },
  { char: '🇳🇺', name: '纽埃', category: 'flags' },
  { char: '🇳🇫', name: '诺福克岛', category: 'flags' },
  { char: '🇰🇵', name: '朝鲜', category: 'flags' },
  { char: '🇲🇵', name: '北马里亚纳群岛', category: 'flags' },
  { char: '🇳🇴', name: '挪威', category: 'flags' },
  { char: '🇴🇲', name: '阿曼', category: 'flags' },
  { char: '🇵🇰', name: '巴基斯坦', category: 'flags' },
  { char: '🇵🇼', name: '帕劳', category: 'flags' },
  { char: '🇵🇸', name: '巴勒斯坦领土', category: 'flags' },
  { char: '🇵🇦', name: '巴拿马', category: 'flags' },
  { char: '🇵🇬', name: '巴布亚新几内亚', category: 'flags' },
  { char: '🇵🇾', name: '巴拉圭', category: 'flags' },
  { char: '🇵🇪', name: '秘鲁', category: 'flags' },
  { char: '🇵🇭', name: '菲律宾', category: 'flags' },
  { char: '🇵🇳', name: '皮特凯恩群岛', category: 'flags' },
  { char: '🇵🇱', name: '波兰', category: 'flags' },
  { char: '🇵🇹', name: '葡萄牙', category: 'flags' },
  { char: '🇵🇷', name: '波多黎各', category: 'flags' },
  { char: '🇶🇦', name: '卡塔尔', category: 'flags' },
  { char: '🇷🇪', name: '留尼汪', category: 'flags' },
  { char: '🇷🇴', name: '罗马尼亚', category: 'flags' },
  { char: '🇷🇺', name: '俄罗斯', category: 'flags' },
  { char: '🇷🇼', name: '卢旺达', category: 'flags' },
  { char: '🇼🇸', name: '萨摩亚', category: 'flags' },
  { char: '🇸🇲', name: '圣马力诺', category: 'flags' },
  { char: '🇸🇦', name: '沙特阿拉伯', category: 'flags' },
  { char: '🇸🇳', name: '塞内加尔', category: 'flags' },
  { char: '🇷🇸', name: '塞尔维亚', category: 'flags' },
  { char: '🇸🇨', name: '塞舌尔', category: 'flags' },
  { char: '🇸🇱', name: '塞拉利昂', category: 'flags' },
  { char: '🇸🇬', name: '新加坡', category: 'flags' },
  { char: '🇸🇽', name: '荷属圣马丁', category: 'flags' },
  { char: '🇸🇰', name: '斯洛伐克', category: 'flags' },
  { char: '🇸🇮', name: '斯洛文尼亚', category: 'flags' },
  { char: '🇬🇸', name: '南乔治亚和南桑威奇群岛', category: 'flags' },
  { char: '🇸🇧', name: '所罗门群岛', category: 'flags' },
  { char: '🇸🇴', name: '索马里', category: 'flags' },
  { char: '🇿🇦', name: '南非', category: 'flags' },
  { char: '🇰🇷', name: '韩国', category: 'flags' },
  { char: '🇸🇸', name: '南苏丹', category: 'flags' },
  { char: '🇪🇸', name: '西班牙', category: 'flags' },
  { char: '🇱🇰', name: '斯里兰卡', category: 'flags' },
  { char: '🇧🇱', name: '圣巴泰勒米', category: 'flags' },
  { char: '🇸🇭', name: '圣赫勒拿', category: 'flags' },
  { char: '🇰🇳', name: '圣基茨和尼维斯', category: 'flags' },
  { char: '🇱🇨', name: '圣卢西亚', category: 'flags' },
  { char: '🇵🇲', name: '圣皮埃尔和密克隆', category: 'flags' },
  { char: '🇻🇨', name: '圣文森特和格林纳丁斯', category: 'flags' },
  { char: '🇸🇩', name: '苏丹', category: 'flags' },
  { char: '🇸🇷', name: '苏里南', category: 'flags' },
  { char: '🇸🇿', name: '斯威士兰', category: 'flags' },
  { char: '🇸🇪', name: '瑞典', category: 'flags' },
  { char: '🇨🇭', name: '瑞士', category: 'flags' },
  { char: '🇸🇾', name: '叙利亚', category: 'flags' },
  { char: '🇹🇯', name: '塔吉克斯坦', category: 'flags' },
  { char: '🇹🇿', name: '坦桑尼亚', category: 'flags' },
  { char: '🇹🇭', name: '泰国', category: 'flags' },
  { char: '🇹🇱', name: '东帝汶', category: 'flags' },
  { char: '🇹🇬', name: '多哥', category: 'flags' },
  { char: '🇹🇰', name: '托克劳', category: 'flags' },
  { char: '🇹🇴', name: '汤加', category: 'flags' },
  { char: '🇹🇹', name: '特立尼达和多巴哥', category: 'flags' },
  { char: '🇹🇳', name: '突尼斯', category: 'flags' },
  { char: '🇹🇷', name: '土耳其', category: 'flags' },
  { char: '🇹🇲', name: '土库曼斯坦', category: 'flags' },
  { char: '🇹🇨', name: '特克斯和凯科斯群岛', category: 'flags' },
  { char: '🇹🇻', name: '图瓦卢', category: 'flags' },
  { char: '🇻🇮', name: '美属维尔京群岛', category: 'flags' },
  { char: '🇺🇬', name: '乌干达', category: 'flags' },
  { char: '🇺🇦', name: '乌克兰', category: 'flags' },
  { char: '🇦🇪', name: '阿联酋', category: 'flags' },
  { char: '🇬🇧', name: '英国', category: 'flags' },
  { char: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', name: '英格兰', category: 'flags' },
  { char: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', name: '苏格兰', category: 'flags' },
  { char: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', name: '威尔士', category: 'flags' },
  { char: '🇺🇳', name: '联合国', category: 'flags' },
  { char: '🇺🇸', name: '美国', category: 'flags' },
  { char: '🇺🇾', name: '乌拉圭', category: 'flags' },
  { char: '🇺🇿', name: '乌兹别克斯坦', category: 'flags' },
  { char: '🇻🇺', name: '瓦努阿图', category: 'flags' },
  { char: '🇻🇦', name: '梵蒂冈', category: 'flags' },
  { char: '🇻🇪', name: '委内瑞拉', category: 'flags' },
  { char: '🇻🇳', name: '越南', category: 'flags' },
  { char: '🇼🇫', name: '瓦利斯和富图纳', category: 'flags' },
  { char: '🇪🇭', name: '西撒哈拉', category: 'flags' },
  { char: '🇪🇭', name: '西撒哈拉', category: 'flags' },
  { char: '🇾🇪', name: '也门', category: 'flags' },
  { char: '🇿🇲', name: '赞比亚', category: 'flags' },
  { char: '🇿🇼', name: '津巴布韦', category: 'flags' },
]

const categoryRefs = ref<HTMLElement[]>([])
const activeCategory = ref('smileys')
const searchQuery = ref('')
const recentEmojis = ref<Emoji[]>([])
const showSuggestions = ref(false)
const searchHistory = ref<string[]>([])

// 从 localStorage 加载搜索历史
const loadSearchHistory = () => {
  const saved = localStorage.getItem('emojiSearchHistory')
  if (saved) {
    searchHistory.value = JSON.parse(saved)
  }
}

// 保存搜索历史到 localStorage
const saveSearchHistory = () => {
  localStorage.setItem('emojiSearchHistory', JSON.stringify(searchHistory.value))
}

// 添加搜索历史
const addSearchHistory = (query: string) => {
  if (!query || query.length < 1) return

  // 移除已存在的相同记录
  const index = searchHistory.value.indexOf(query)
  if (index > -1) {
    searchHistory.value.splice(index, 1)
  }

  // 添加到开头
  searchHistory.value.unshift(query)

  // 最多保存 10 条
  if (searchHistory.value.length > 10) {
    searchHistory.value = searchHistory.value.slice(0, 10)
  }

  saveSearchHistory()
}

// 清除搜索历史
const clearSearchHistory = () => {
  searchHistory.value = []
  localStorage.removeItem('emojiSearchHistory')
}

// 处理搜索框失焦
const handleBlur = () => {
  // 延迟关闭建议列表，让用户有时间点击
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

// 监听搜索词变化，添加到历史记录
const handleSearchConfirm = () => {
  if (searchQuery.value && searchQuery.value.length >= 1) {
    addSearchHistory(searchQuery.value)
    showSuggestions.value = false
  }
}

// 智能搜索匹配函数
const smartMatch = (emoji: Emoji, query: string): boolean => {
  if (!query) return true

  const lowerQuery = query.toLowerCase().trim()
  const lowerName = emoji.name.toLowerCase()

  // 1. 直接名称包含匹配
  if (lowerName.includes(lowerQuery)) return true

  // 2. 拼音全拼匹配 - 检查名字中每个字的拼音
  const nameChars = emoji.name.split('')
  for (const char of nameChars) {
    const pinyinInfo = pinyinMap[char]
    if (pinyinInfo) {
      // 检查全拼
      if (pinyinInfo.full.some(p => p.includes(lowerQuery))) return true
      // 检查简拼（拼音首字母）
      if (pinyinInfo.short.some(p => p === lowerQuery)) return true
    }
  }

  // 3. 简拼组合匹配（如 "wx" 匹配 "微信"）
  let shortPinyinStr = ''
  for (const char of nameChars) {
    const pinyinInfo = pinyinMap[char]
    if (pinyinInfo) {
      shortPinyinStr += pinyinInfo.short[0]
    }
  }
  if (shortPinyinStr.includes(lowerQuery)) return true

  // 4. 首字母匹配（如 "a" 匹配 "爱心" 的 "ai"）
  if (lowerQuery.length === 1) {
    for (const char of nameChars) {
      const pinyinInfo = pinyinMap[char]
      if (pinyinInfo && pinyinInfo.short.includes(lowerQuery)) return true
    }
  }

  // 5. 关键词/别名匹配
  if (emoji.keywords) {
    for (const keyword of emoji.keywords) {
      if (keyword.toLowerCase().includes(lowerQuery)) return true
    }
  }

  // 6. 表情字符本身匹配（如可以直接搜索 "😀"）
  if (emoji.char === query) return true

  // 7. 模糊匹配 - 允许输入的字符分散在名字中
  let queryIndex = 0
  for (const char of lowerName) {
    if (char === lowerQuery[queryIndex]) {
      queryIndex++
      if (queryIndex >= lowerQuery.length) return true
    }
  }

  // 8. 从 emojiKeywords 映射中匹配关键词
  for (const char of nameChars) {
    const keywords = emojiKeywords[char]
    if (keywords) {
      for (const keyword of keywords) {
        if (keyword.toLowerCase().includes(lowerQuery)) return true
      }
    }
  }

  return false
}

// 获取搜索匹配分数（用于排序）
const getMatchScore = (emoji: Emoji, query: string): number => {
  if (!query) return 0

  const lowerQuery = query.toLowerCase().trim()
  const lowerName = emoji.name.toLowerCase()

  // 完全匹配分数最高
  if (lowerName === lowerQuery) return 100

  // 开头匹配分数较高
  if (lowerName.startsWith(lowerQuery)) return 80

  // 包含匹配
  if (lowerName.includes(lowerQuery)) return 60

  // 拼音匹配
  const nameChars = emoji.name.split('')
  for (const char of nameChars) {
    const pinyinInfo = pinyinMap[char]
    if (pinyinInfo) {
      if (pinyinInfo.full.some(p => p === lowerQuery)) return 50
      if (pinyinInfo.short.some(p => p === lowerQuery)) return 40
    }
  }

  // 关键词匹配
  if (emoji.keywords?.some(k => k.toLowerCase().includes(lowerQuery))) return 30

  // 模糊匹配
  return 10
}

// emoji 关键词映射 - 为常用表情添加额外搜索关键词
const emojiKeywords: Record<string, string[]> = {
  // 表情类
  '笑': ['开心', '高兴', '愉快', '欢乐', '喜悦', '哈哈', '嘻嘻', '呵呵', '嘿嘿', '乐天', '乐观', '快乐'],
  '哭': ['伤心', '难过', '悲伤', '流泪', '眼泪', '哭泣', '呜咽', '哀', '伤', '痛苦', '心碎'],
  '爱': ['喜欢', '喜爱', '心', '爱心', '爱慕', '爱意', '热爱', '亲爱'],
  '怒': ['生气', '愤怒', '发火', '气', '恼', '怒', '愤', '冒火'],
  '羞': ['害羞', '不好意思', '腼腆', '脸红', '羞涩', '羞怯'],
  '困': ['疲倦', '瞌睡', '睡觉', '困乏', '想睡', '累了', '疲劳'],
  '惊': ['惊讶', '震惊', '吃惊', '惊吓', '吓一跳', '意想不到'],
  '汗': ['尴尬', '无语', '无奈', '汗颜', '冒汗', '冷汗'],
  '晕': ['迷糊', '头晕', '眩晕', '懵', '混乱', '迷糊'],
  '酷': ['帅气', '潇洒', '牛逼', '厉害', '强', '赞', '棒'],
  '疯': ['疯狂', '癫狂', '发疯', '神经病', '抓狂', '暴躁'],
  '怕': ['害怕', '恐惧', '畏惧', '胆怯', '担心', '恐慌'],
  '吐': ['恶心', '想吐', '呕吐', '反胃', '难受', '不适'],
  '病': ['生病', '不舒服', '发烧', '感冒', '难受', '虚弱'],
  '睡': ['睡觉', '休息', '打盹', '入睡', '安眠', '做梦'],
  '吃': ['吃东西', '食物', '美味', '好吃', '品尝', '用餐'],
  '气': ['生气', '愤怒', '气愤', '恼火', '恼怒'],
  // 动物类
  '猫': ['猫咪', '喵喵', '小猫', '宠物', '动物', '喵星人'],
  '狗': ['狗狗', '汪', '小狗', '宠物', '动物', '汪星人'],
  '猪': ['猪猪', '小猪', '动物', '肥猪'],
  '牛': ['牛牛', '黄牛', '动物', '牲畜'],
  '兔': ['兔子', '兔兔', '小兔', '动物', '可爱'],
  '虎': ['老虎', '大猫', '动物', '猛兽'],
  '龙': ['神兽', '中国龙', '动物', '传说'],
  '鸟': ['小鸟', '鸟儿', '飞禽', '动物'],
  '鱼': ['鱼儿', '小鱼', '水生动物'],
  // 食物类
  '饭': ['米饭', '主食', '吃饭', '食物'],
  '面': ['面条', '拉面', '面食', '食物'],
  '包': ['面包', '包子', '食物'],
  '蛋': ['鸡蛋', '蛋白', '食物'],
  '肉': ['肉类', '食物', '荤'],
  '果': ['水果', '果实', '苹果', '橙子', '香蕉'],
  '酒': ['喝酒', '饮料', '啤酒', '白酒', '红酒'],
  '茶': ['喝茶', '饮料', '茶水', '绿茶', '红茶'],
  '奶': ['牛奶', '饮料', '奶茶', '酸奶'],
  '糖': ['糖果', '甜食', '甜蜜'],
  // 手势类
  '赞': ['点赞', '夸奖', '表扬', '好', '棒', '优秀', '厉害', '可以', '认可'],
  '踩': ['差评', '反对', '不好', '否定'],
  '耶': ['胜利', 'yeah', '剪刀手', '开心', '拍照'],
  '拳': ['拳头', '加油', '力量', '努力'],
  '掌': ['手掌', '击掌', '掌声', '拍手'],
  '指': ['手指', '指向', '指示', '手势'],
  'OK': ['好的', '可以', '行', '没问题', '同意', '确认'],
  '拜': ['再见', '拜拜', '告别', '分手', '离开'],
  '祈': ['祈祷', '祷告', '祈求', '许愿'],
  // 物品类
  '心': ['爱心', '喜欢', '爱', '感情', '真心', '心形'],
  '星': ['星星', '五角星', '星光', '闪烁'],
  '花': ['花朵', '鲜花', '玫瑰', '美丽'],
  '礼': ['礼物', '礼品', '送礼', '赠送'],
  '钱': ['金钱', '钞票', '美元', '富有', '财富'],
  '火': ['火焰', '热情', '燃烧', '着火', '热'],
  '电': ['电力', '能量', '闪电', '雷电'],
  '锁': ['安全', '保护', '隐私', '锁定'],
  '钥': ['钥匙', '开锁', '关键'],
  '话': ['电话', '手机', '通讯', '联系'],
  '钟': ['时钟', '时间', '表', '计时'],
  '车': ['汽车', '车辆', '交通工具'],
  '飞': ['飞机', '航班', '航空', '旅行'],
  '船': ['轮船', '船只', '航海', '水运'],
  // 自然类
  '日': ['太阳', '阳光', '晴朗', '白天'],
  '月': ['月亮', '月光', '夜晚', '明月'],
  '云': ['云朵', '云彩', '天空', '阴天'],
  '雨': ['下雨', '雨天', '雨水', '降水'],
  '雪': ['下雪', '雪花', '冰雪', '寒冷'],
  '雷': ['雷电', '闪电', '雷雨', '打雷'],
  '风': ['刮风', '大风', '微风', '气流'],
  '山': ['山峰', '山脉', '高山', '丘陵'],
  '海': ['大海', '海洋', '海水', '海边'],
  '树': ['树木', '大树', '植物', '绿化'],
  // 活动类
  '足': ['足球', '踢球', '运动', '球类'],
  '篮': ['篮球', '投篮', '运动', '球类'],
  '跑': ['跑步', '奔跑', '运动', '健身'],
  '游': ['游泳', '游戏', '玩耍', '娱乐'],
  '舞': ['跳舞', '舞蹈', '舞动'],
  '唱': ['唱歌', '歌唱', 'K歌', '音乐'],
  '音': ['音乐', '音符', '歌曲', '旋律'],
  // 其他常用词
  '新': ['新年', '新春', '新的开始', '崭新'],
  '生': ['生日', '诞生', '出生', '生活'],
  '快': ['快乐', '快速', '愉快', '快递'],
  '祝': ['祝福', '祝贺', '祝愿', '庆祝'],
  '福': ['幸福', '福气', '祝福', '福字'],
  '财': ['财富', '发财', '财运', '金钱'],
  '吉': ['吉祥', '吉利', '吉祥如意'],
  '喜': ['喜欢', '喜悦', '欢喜', '喜庆'],
  '春': ['春天', '春节', '春季', '新春'],
  '夏': ['夏天', '夏季', '炎热'],
  '秋': ['秋天', '秋季', '丰收'],
  '冬': ['冬天', '冬季', '寒冷'],
}

// 添加一个计算属性来获取有搜索结果的分类
const visibleCategories = computed(() => {
  if (!searchQuery.value) return categories

  return categories.filter(category => {
    return emojis.some(emoji =>
      emoji.category === category.id && smartMatch(emoji, searchQuery.value)
    )
  })
})

// 修改 filteredEmojis 函数
const filteredEmojis = (category: string) => {
  return emojis.filter(emoji => {
    if (!searchQuery.value) return emoji.category === category
    return emoji.category === category && smartMatch(emoji, searchQuery.value)
  })
}

// 处理emoji点击
const handleEmojiClick = (emoji: Emoji) => {
  // 复制到剪贴板
  navigator.clipboard.writeText(emoji.char)
  ElMessage.success('已复制到剪贴板')

  // 更新最近使用
  updateRecentEmojis(emoji)
}

// 处理emoji双击
const handleEmojiDoubleClick = async (emoji: Emoji) => {
  try {
    // 更新最近使用
    updateRecentEmojis(emoji)
    
    // 直接复制emoji文本到剪贴板
    if (window.ztools && window.ztools.copyText) {
      window.ztools.copyText(emoji.char)
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(emoji.char)
    }
    
    // 隐藏ZTools 窗口
    if (window.ztools) {
      window.ztools.hideMainWindow()
    }
    
    // 等待窗口隐藏完成
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // 模拟按键序列：Alt+Tab切换窗口，然后Ctrl+V粘贴
    if (window.ztools && window.ztools.simulateKeyboardTap) {
      // 1. 使用Alt+Tab切换到最近使用的应用
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // 2. 模拟Ctrl+V粘贴
      window.ztools.simulateKeyboardTap('v', 'ctrl')
      
      ElMessage.success(`已发送 ${emoji.char} 到聊天窗口`)
    } else {
      // 备用方案：提示用户手动粘贴
      ElMessage.success('已复制到剪贴板，请手动粘贴')
    }
  } catch (error) {
    console.error('双击发送失败:', error)
    // 复制到剪贴板作为备用方案
    try {
      if (window.ztools && window.ztools.copyText) {
        window.ztools.copyText(emoji.char)
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(emoji.char)
      }
      ElMessage.warning('自动发送失败，已复制到剪贴板')
    } catch (clipboardError) {
      ElMessage.error('发送失败，请重试')
    }
  }
}

// 更新最近使用的emoji
const updateRecentEmojis = (emoji: Emoji) => {
  const existingIndex = recentEmojis.value.findIndex(e => e.char === emoji.char)
  if (existingIndex !== -1) {
    recentEmojis.value.splice(existingIndex, 1)
  }
  recentEmojis.value.unshift(emoji)
  if (recentEmojis.value.length > 8) {
    recentEmojis.value.pop()
  }

  // 保存到本地存储
  localStorage.setItem('recentEmojis', JSON.stringify(recentEmojis.value))
}

// 初始化最近使用的emoji
const initRecentEmojis = () => {
  const saved = localStorage.getItem('recentEmojis')
  if (saved) {
    recentEmojis.value = JSON.parse(saved)
  }
}

// 组件挂载时初始化
initRecentEmojis()

// 滚动到指定分类
const scrollToCategory = (categoryId: string) => {
  const element = document.getElementById(categoryId)
  if (element && scrollbarRef.value) {
    scrollbarRef.value.setScrollTop(element.offsetTop)
  }
}

// 优化滚动性能
const scrollbarRef = ref()

// 搜索建议列表
const searchSuggestions = computed(() => {
  if (!searchQuery.value || searchQuery.value.length < 1) return []

  const query = searchQuery.value.toLowerCase().trim()
  const suggestions = new Set<string>()

  // 从emoji名称中提取建议
  emojis.forEach(emoji => {
    if (smartMatch(emoji, query)) {
      suggestions.add(emoji.name)
    }
  })

  // 从关键词中提取建议
  emojis.forEach(emoji => {
    if (emoji.keywords) {
      emoji.keywords.forEach(keyword => {
        if (keyword.toLowerCase().includes(query)) {
          suggestions.add(keyword)
        }
      })
    }
  })

  return Array.from(suggestions).slice(0, 10)
})

// 使用计算属性缓存过滤后的表情数据
const filteredEmojiMap = computed(() => {
  const map = new Map()
  categories.forEach(category => {
    let categoryEmojis = emojis.filter(emoji => {
      if (!searchQuery.value) return emoji.category === category.id
      return emoji.category === category.id && smartMatch(emoji, searchQuery.value)
    })

    // 如果有搜索词，按匹配分数排序
    if (searchQuery.value) {
      categoryEmojis = categoryEmojis.sort((a, b) => {
        return getMatchScore(b, searchQuery.value) - getMatchScore(a, searchQuery.value)
      })
    }

    map.set(category.id, categoryEmojis)
  })
  return map
})

// 获取分类表情的方法
const getCategoryEmojis = (categoryId: string) => {
  return filteredEmojiMap.value.get(categoryId) || []
}

// 使用节流优化滚动事件处理
const handleScroll = () => {
  const scrollbar = scrollbarRef.value
  if (!scrollbar) return

  const { scrollTop } = scrollbar.wrapRef
  const scrollPosition = scrollTop + 100 // 添加偏移量以提前切换分类
  
  for (let i = categoryRefs.value.length - 1; i >= 0; i--) {
    const element = categoryRefs.value[i]
    if (element) {
      const position = element.offsetTop
      if (scrollPosition >= position) {
        activeCategory.value = categories[i].id
        break
      }
    }
  }
}

const throttledHandleScroll = throttle(handleScroll, 100)

// 监听滚动事件
onMounted(() => {
  // 初始化数据
  initRecentEmojis()
  // 加载搜索历史
  loadSearchHistory()
})

onUnmounted(() => {
  // 清理节流函数
  throttledHandleScroll.cancel()
})
</script>

<style scoped lang="scss">
.emoji-picker {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);

  // 暗黑模式适配
  html.dark & {
    background: #141414;

    .header-section {
      background: #141414;
      border-bottom-color: #414243;
    }

    :deep(.el-input__wrapper) {
      background-color: #1f2937 !important;
      box-shadow: 0 0 0 1px #4c4d4f inset !important;
    }

    :deep(.el-input__inner) {
      color: #cfd3dc;
    }

    :deep(.el-input__prefix .el-icon) {
      color: #8d9095;
    }

    .category-tab {
      background: #262727;

      &:hover {
        background: #303030;
      }

      &.active {
        background: #1e4a96;
        color: #64b5f6;
      }
    }

    .search-suggestions {
      background: #1d1e1f;
      border-color: #414243;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    }

    .suggestion-tag {
      :deep(.el-tag) {
        background-color: #262727;
        border-color: #414243;
        color: #cfd3dc;
      }
    }

    .emoji-item:hover {
      background: #262727;
    }
  }
}

.header-section {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  position: sticky;
  top: 0;
  z-index: 1;
}

.search-wrapper {
  position: relative;
}

.search-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  max-height: 300px;
  overflow-y: auto;
}

.suggestion-section {
  padding: 8px 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}

.suggestion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.suggestion-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 12px;
}

.suggestion-tag {
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);
  }

  i {
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }

  span {
    color: var(--el-text-color-primary);
    font-size: 14px;
  }
}

.emoji-content-container {
  flex: 1;
  
  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }
}

.emoji-section {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  
  &:last-child {
    border-bottom: none;
  }
}

.section-title {
  margin: 0 0 12px;
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 8px;
  padding: 8px;
  will-change: transform; // 优化动画性能
}

.emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 24px;
  cursor: pointer;
  border-radius: 4px;
  transition: transform 0.2s ease;
  will-change: transform; // 优化动画性能
  
  &:hover {
    transform: scale(1.1);
    background: var(--el-border-color-light);
  }
}

.category-tabs {
  display: flex;
  gap: 4px;  // 减小间距
  margin-top: 8px;  // 减小上边距
  overflow-x: hidden;  // 隐藏滚动条
  padding-bottom: 0;  // 移除底部内边距
}

.category-tab {
  padding: 4px 8px;  // 减小内边距使按钮更紧凑
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;  // 稍微减小字体大小
  transition: all 0.2s ease;
  
  &:hover {
    background: var(--el-border-color-light);
  }
  
  &.active {
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
  
  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style> 
