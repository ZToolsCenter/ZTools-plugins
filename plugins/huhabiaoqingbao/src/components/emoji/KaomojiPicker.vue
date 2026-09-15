<template>
  <div class="kaomoji-picker">
    <!-- 搜索框 -->
    <div class="search-section">
      <el-input v-model="searchQuery" placeholder="搜索颜文字..." prefix-icon="Search" clearable />
    </div>

    <!-- 颜文字展示区域 -->
    <div class="kaomoji-content">
      <div v-for="(group, index) in filteredKaomojis" :key="index" class="kaomoji-group">
        <h3 class="group-title">{{ group.name }}</h3>
        <div class="kaomoji-grid">
          <div v-for="kaomoji in group.items" :key="kaomoji.text" class="kaomoji-item"
            @click="handleKaomojiClick(kaomoji)" 
            @dblclick="handleKaomojiDoubleClick(kaomoji)" 
            :title="kaomoji.description">
            {{ kaomoji.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'

interface Kaomoji {
  text: string
  description: string
}

interface KaomojiGroup {
  name: string
  items: Kaomoji[]
}

// 颜文字数据
const kaomojiGroups: KaomojiGroup[] = [
  {
    name: '问候',
    items: [
      { text: '~(=^‥^)ノ☆', description: '打招呼' },
      { text: '(｡･∀･)ﾉﾞ', description: '你好' },
      { text: '(●ゝω)ノヽ(∀＜●)', description: '击掌' },
      { text: '(｡･ω･)ﾉ', description: '再见' },
      { text: '(^_^)／', description: '挥手' },
      { text: 'ヾ(＾∇＾)', description: '欢迎' },
      { text: '(≧∀≦)ゞ', description: '欢迎光临' },
      { text: '( ´ ▽ ` )ﾉ', description: '问好' },
      { text: 'ヾ(･ω･｀＝´･ω･)ﾉ♪', description: '打招呼' },
      { text: '(｀･ω･´)ゞ', description: '敬礼' },
      { text: 'ヾ(＾-＾)ノ', description: '热情打招呼' },
      { text: '(。・ω・)ノ', description: '友好问候' },
      { text: '(^-^*)/', description: '微笑问候' },
      { text: 'ヾ(･ω･｀*)', description: '温柔招手' }
    ]
  },
  {
    name: '开心',
    items: [
      { text: '(｡◕‿◕｡)', description: '开心' },
      { text: '(◕ᴗ◕✿)', description: '甜笑' },
      { text: '(｀・ω・´)', description: '得意' },
      { text: '(●´∀｀●)', description: '灿烂' },
      { text: '(◍•ᴗ•◍)✧*。', description: '闪闪发光' },
      { text: '٩(◕‿◕｡)۶', description: '欢呼' },
      { text: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', description: '撒花' },
      { text: 'ヽ(o＾▽＾o)ノ', description: '开心舞动' },
      { text: '☆*:.｡.o(≧▽≦)o.｡.:*☆', description: '星星眼' },
      { text: '(ﾉ´ヮ`)ﾉ*: ･ﾟ', description: '开心撒花' },
      { text: '(๑>◡<๑)', description: '幸福笑' },
      { text: 'ヽ(✿ﾟ▽ﾟ)ノ', description: '欢乐舞动' },
      { text: '(●ˊ∀ˋ●)', description: '愉悦' },
      { text: '٩(◕‿◕｡)۶', description: '快乐跳跃' }
    ]
  },
  {
    name: '可爱',
    items: [
      { text: '(✿◡‿◡)', description: '温柔' },
      { text: '(◕‿◕✿)', description: '可爱' },
      { text: '(｡♥‿♥｡)', description: '爱心' },
      { text: '(◍•ᴗ•◍)❤', description: '喜欢' },
      { text: '(´･ω･`)', description: '萌萌' },
      { text: '(●´ω｀●)', description: '害羞' },
      { text: '(◕◡◕✿)', description: '甜美' },
      { text: '(｡◕‿◕｡)', description: '可爱笑' },
      { text: '(◕‿◕✿)', description: '花朵笑' }
    ]
  },
  {
    name: '爱情',
    items: [
      { text: '(♥ω♥*)', description: '恋爱' },
      { text: '(｡♥‿♥｡)', description: '爱心眼' },
      { text: '(◍•ᴗ•◍)♡', description: '喜欢' },
      { text: '(´∀｀)♡', description: '爱心' },
      { text: '(◕‿◕)♡', description: '示爱' },
      { text: '(｡•//ε//•｡)', description: '害羞' },
      { text: '(´,,•ω•,,)♡', description: '羞涩' },
      { text: '(♡´艸`)', description: '花痴' },
      { text: '(´,,•ω•,,)♡', description: '害羞爱心' }
    ]
  },
  {
    name: '调皮',
    items: [
      { text: '（￣︶￣）↗', description: '得意' },
      { text: '(￣▽￣)～', description: '哼歌' },
      { text: '(〃￣︶￣)人(￣︶￣〃)', description: '击掌' },
      { text: '(｀∀´)Ψ', description: '坏笑' },
      { text: 'ψ(｀∇´)ψ', description: '阴谋' },
      { text: '(●\'◡\'●)ﾉ♥', description: '调戏' },
      { text: '（￣ー￣）', description: '得意' },
      { text: '(∩^o^)⊃━☆', description: '魔法棒' },
      { text: '(｀▽´)-σ', description: '指点' }
    ]
  },
  {
    name: '无奈',
    items: [
      { text: '╮(╯▽╰)╭', description: '无奈' },
      { text: '╮(╯_╰)╭', description: '算了' },
      { text: '(￣▽￣*)ゞ', description: '尴尬' },
      { text: '┐(´-｀)┌', description: '随便' },
      { text: '(￣▽￣)~*', description: '轻松' },
      { text: '╮(￣▽￣)╭', description: '随意' },
      { text: '┐(￣ヮ￣)┌', description: '无所谓' },
      { text: '╮(╯-╰)╭', description: '叹气' },
      { text: '┑(￣Д ￣)┍', description: '放弃' }
    ]
  },
  {
    name: '生气',
    items: [
      { text: '(╯°□°）╯︵ ┻━┻', description: '掀桌' },
      { text: '(┙>∧<)┙へ┻━┻', description: '暴怒' },
      { text: '(〃＞目＜)', description: '愤怒' },
      { text: '(╬▔皿▔)', description: '怒火' },
      { text: '(╬ Ò﹏Ó)', description: '生气' },
      { text: '(〃＞＿＜;〃)', description: '不爽' },
      { text: '(╯‵□′)╯︵┻━┻', description: '暴走' },
      { text: '(┛◉Д◉)┛彡┻━┻', description: '狂怒' },
      { text: 'ヽ(`Д´)ﾉ', description: '咆哮' }
    ]
  },
  {
    name: '悲伤',
    items: [
      { text: '(╥﹏╥)', description: '伤心' },
      { text: '(;´Д`)', description: '难过' },
      { text: '(。﹏。)', description: '失落' },
      { text: '(´;ω;`)', description: '委屈' },
      { text: '(｡•́︿•̀｡)', description: '难受' },
      { text: '(｡ŏ﹏ŏ)', description: '忧伤' },
      { text: '(´;д;`)', description: '哭泣' },
      { text: '( ´•︵•` )', description: '伤心' },
      { text: '(｡•́︿•̀｡)', description: '难过' }
    ]
  },
  {
    name: '困倦',
    items: [
      { text: '(∪｡∪)｡｡｡zzz', description: '睡觉' },
      { text: '(－∀－) ネムネム', description: '困了' },
      { text: '(｡-ω-)zzz', description: '打瞌睡' },
      { text: '(￣o￣) zzZZzzZZ', description: '呼呼' },
      { text: '(-.-)..zzz', description: '睡着了' },
      { text: '(∪｡∪)zzz', description: '打盹' },
      { text: '(눈_눈)', description: '困意' },
      { text: '【▽】ノ', description: '晚安' },
      { text: '(ᴗ˳ᴗ)', description: '安睡' }
    ]
  },
  {
    name: '惊讶',
    items: [
      { text: '(⊙_⊙)', description: '吃惊' },
      { text: '(⊙ˍ⊙)', description: '惊讶' },
      { text: '(」゜ロ゜)」', description: '震惊' },
      { text: 'w(゜Д゜)w', description: '惊吓' },
      { text: '(´⊙ω⊙`)', description: '吓到' },
      { text: '(((( ;°Д°))))', description: '害怕' },
      { text: '(;;゜;益;゜)', description: '惊慌' },
      { text: '(°ー°〃)', description: '惊异' },
      { text: 'Σ(゜ロ゜;)', description: '震撼' }
    ]
  },
  {
    name: '战斗',
    items: [
      { text: '(ᕗ⌒∇⌒)ᕗ', description: '加油' },
      { text: '╰( ･ ᗜ ･ )➝', description: '冲啊' },
      { text: '(ง •̀_•́)ง', description: '战斗' },
      { text: '(๑•̀ㅂ•́)و✧', description: '努力' },
      { text: '(ᕑᗢᓫ∗)˒', description: '必胜' },
      { text: '୧(๑•̀⌄•́๑)૭', description: '奋斗' },
      { text: '(๑˃ᴗ˂)ﻭ', description: '加油' },
      { text: 'ᕦ(ò_óˇ)ᕤ', description: '强壮' },
      { text: '( •̀ω•́ )σ', description: '挑战' }
    ]
  },
  {
    name: '思考',
    items: [
      { text: '(´･ω･`)?', description: '疑惑' },
      { text: '(｀_´)ゞ', description: '沉思' },
      { text: '(●´ω｀●)ゞ', description: '思考中' },
      { text: '(´−｀) ﾝｰ', description: '冥想' },
      { text: '(｀_´)>', description: '专注' },
      { text: '(・∧・)', description: '认真想' },
      { text: '(｀へ´)', description: '苦恼' },
      { text: '(￣ω￣;)', description: '犹豫' }
    ]
  },
  {
    name: '吃饭',
    items: [
      { text: '(っ˘ڡ˘ς)', description: '好吃' },
      { text: '( ˘▽˘)っ♨', description: '热饮' },
      { text: '(´ڡ`♡)', description: '美味' },
      { text: '(๑´ڡ`๑)', description: '享受' },
      { text: '( ˊᵕˋ )♡.°⑅', description: '甜点' },
      { text: '(๑°ㅁ°๑)ﾉ', description: '我要吃' },
      { text: '(´～｀)', description: '咀嚼' },
      { text: '(๑╹ڡ╹)╭ ～ ♡', description: '分享食物' }
    ]
  },
  {
    name: '运动',
    items: [
      { text: '୧( ⁼̴̶̤̀ω⁼̴̶̤́ )૭', description: '加油' },
      { text: 'ᕙ( ˘ω˘ )ᕗ', description: '锻炼' },
      { text: '٩( ᐛ )و', description: '冲刺' },
      { text: '(ﾉ≧∀≦)ﾉ', description: '跳跃' },
      { text: '(งᐛ)ว', description: '健身' },
      { text: 'ᕦ(ò_óˇ)ᕤ', description: '举重' },
      { text: '┌(┌^o^)┐', description: '跑步' },
      { text: '╭( ๐_๐)╮', description: '瑜伽' }
    ]
  },
  {
    name: '工作',
    items: [
      { text: '(｀_´)ゞ', description: '认真工作' },
      { text: '(⌐■_■)', description: '专业' },
      { text: '(￣^￣)ゞ', description: '明白了' },
      { text: '(｀･ω･´)ゞ', description: '报告' },
      { text: '(●\'◡\'●)ﾉ', description: '完成' },
      { text: '(｀_´)>', description: '执行' },
      { text: '(￣ー￣)ゞ', description: '了解' },
      { text: '(・∧・)ゞ', description: '汇报' }
    ]
  },
  {
    name: '音乐',
    items: [
      { text: '♪(´▽｀)', description: '哼歌' },
      { text: '♪(^∇^*)', description: '唱歌' },
      { text: 'ヾ(´〇｀)ﾉ♪♪♪', description: '跳舞' },
      { text: '(｢･ω･)｢', description: '律动' },
      { text: '♪♬((d⌒ω⌒b))♬♪', description: '音乐' },
      { text: '(´△｀)♪', description: '演奏' },
      { text: '(๑˃́ꇴ˂̀๑)', description: '节奏' },
      { text: '♪(o^∇^o)ﾉ', description: '欢唱' }
    ]
  },
  {
    name: '未分类',
    items: [
      { text: '(*ﾟ∀ﾟ*)', description: '未分类' },
      { text: '(ﾟ∀ﾟ)', description: '未分类' },
      { text: '(`3´)', description: '未分类' },
      { text: '(ゝ∀･)', description: '未分类' },
      { text: '(ﾟ∀。)', description: '未分类' },
      { text: 'ξ( ✿＞◡❛)', description: '未分类' },
      { text: '｡:.ﾟヽ(*´∀`)ﾉﾟ.:｡', description: '未分类' },
      { text: '(´・ω・`)', description: '未分类' },
      { text: '(つд⊂)', description: '未分类' },
      { text: '(д) ﾟﾟ', description: '未分类' },
      { text: '╮(╯_╰)╭', description: '未分类' },
      { text: '(́◉◞౪◟◉‵)', description: '未分类' },
      { text: '(σ′▽‵)′▽‵)σ', description: '未分类' },
      { text: '。･ﾟ･(つд`ﾟ)･ﾟ･', description: '未分类' },
      { text: '(`・ω・´)', description: '未分类' },
      { text: '(／‵Д′)／~ ╧╧', description: '未分类' },
      { text: 'ლ(・´ｪ`・ლ)', description: '未分类' },
      { text: '=͟͟͞͞( •̀д•́)', description: '未分类' },
      { text: 'σ ﾟ∀ ﾟ) ﾟ∀ﾟ)σ', description: '未分类' },
      { text: '(◔⊖◔)つ', description: '未分类' },
      { text: '(́=◞౪◟=‵)', description: '未分类' },
      { text: '(´◓Д◔`)', description: '未分类' },
      { text: '(´⊙ω⊙`)', description: '未分类' },
      { text: '(*´･д･)?', description: '未分类' },
      { text: '(´▽`ʃ♡ƪ)"', description: '未分类' },
      { text: '_(:3 ⌒ﾞ)_', description: '未分类' },
      { text: '( ﾟ∀ﾟ)o彡ﾟ', description: '未分类' },
      { text: '(´;ω;`)', description: '未分类' },
      { text: 'ﾚ(ﾟ∀ﾟ;)ﾍ=З=З=З', description: '未分类' },
      { text: '(●´ω｀●)ゞ', description: '未分类' },
      { text: 'ε≡(ノ´＿ゝ｀）ノ', description: '未分类' },
      { text: '(≧∀≦)ゞ', description: '未分类' },
      { text: '( 3ω3)', description: '未分类' },
      { text: '(●б人<●)', description: '未分类' },
      { text: 'σ(´∀｀*)', description: '未分类' },
      { text: '(*´з｀*)', description: '未分类' },
      { text: '(›´ω`‹ )', description: '未分类' },
      { text: '(´・ω・)つ旦', description: '未分类' },
      { text: '( ´∀｀)つt[ ]', description: '未分类' },
      { text: '( ×ω× )', description: '未分类' },
      { text: '(´～`)', description: '未分类' },
      { text: '(・∀・)つ⑩', description: '未分类' },
      { text: '(｡•ㅅ•｡)♡', description: '未分类' },
      { text: 'ρ(・ω・、)', description: '未分类' },
      { text: '(∩^o^)⊃━☆ﾟ.*･｡', description: '未分类' },
      { text: '..._〆(°▽°*)', description: '未分类' },
      { text: '|Д`)ノ⌒●～*', description: '未分类' },
      { text: '∑(ι´Дン)ノ', description: '未分类' },
      { text: 'ε≡ﾍ( ´∀`)ﾉ', description: '未分类' },
      { text: 'ヾ(●゜▽゜●)♡', description: '未分类' },
      { text: '(ﾟω´)', description: '未分类' },
      { text: '(・`ω´・)', description: '未分类' },
      { text: '(ง๑ •̀_•́)ง', description: '未分类' },
      { text: '( ˘•ω•˘ )◞⁽˙³˙⁾', description: '未分类' },
      { text: '(・ε・)', description: '未分类' },
      { text: '(=´ω`=)', description: '未分类' },
      { text: ',,Ծ‸Ծ,,', description: '未分类' },
      { text: '(*ﾟーﾟ)', description: '未分类' },
      { text: '＼(●´ϖ`●)／', description: '未分类' },
      { text: 'ᕦ(ò_óˇ)ᕤ', description: '未分类' },
      { text: '( ´Д`)y━･~~', description: '未分类' },
      { text: '(っ´ω`c)', description: '未分类' },
      { text: 'ʅ（´◔౪◔）ʃ', description: '未分类' },
      { text: '(•ㅂ•)/', description: '未分类' },
      { text: '(≖ᴗ≖๑)', description: '未分类' },
      { text: '(*´д`)', description: '未分类' },
      { text: '||Φ|(|´|Д|`|)|Φ||', description: '未分类' },
      { text: '(✘﹏✘ა)', description: '未分类' },
      { text: '(　˙灬˙　)', description: '未分类' },
      { text: '(＊゜ー゜)b', description: '未分类' },
      { text: 'Zz(´-ω-`*)', description: '未分类' },
      { text: '( *´◒`*)', description: '未分类' },
      { text: 'ฅ(๑*д*๑)ฅ!!', description: '未分类' },
      { text: '( ¤̴̶̷̤́ ‧̫̮ ¤̴̶̷̤̀ )', description: '未分类' },
      { text: '（´-`）.｡oO', description: '未分类' },
      { text: 'ლ( • ̀ω•́ )っ', description: '未分类' },
      { text: '(´-ω-｀)', description: '未分类' },
      { text: '(っ●ω●)っ', description: '未分类' },
      { text: '( *¯ ³¯*)♡ㄘゅ', description: '未分类' },
      { text: '(｡・ω・｡)', description: '未分类' },
      { text: '٩(๑´3｀๑)۶', description: '未分类' },
      { text: '< (￣︶￣)>', description: '未分类' },
      { text: '( •́ὤ•̀)', description: '未分类' },
      { text: '(´∩ω∩｀)', description: '未分类' },
      { text: '(●⁰౪⁰●)', description: '未分类' },
      { text: '(づ′▽`)づ', description: '未分类' },
      { text: 'ヾ(*´∀ ˋ*)ﾉ', description: '未分类' },
      { text: 'ヽ( ^ω^ ゞ )', description: '未分类' },
      { text: '(・ω・)', description: '未分类' },
      { text: '(ﾟдﾟ)', description: '未分类' },
      { text: 'ಥ_ಥ', description: '未分类' },
      { text: '(´･ω･`)', description: '未分类' },
      { text: 'ヽ(￣■￣)ゝ', description: '未分类' },
      { text: '(・∀・)', description: '未分类' },
      { text: '[̲̅$̲̅(̲̅ ͡° ͜ʖ ͡°̲̅)̲̅$̲̅]', description: '未分类' },
      { text: '٩(•ิ˓̭ •ิ )ง', description: '未分类' },
      { text: '(*´Д`)つ))´∀`)', description: '未分类' },
      { text: '(^u^)', description: '未分类' },
      { text: '(*´ω`)人(´ω`*)', description: '未分类' },
      { text: 'd(`･∀･)b', description: '未分类' },
      { text: '(,,・ω・,,)', description: '未分类' },
      { text: '(｡A｡)', description: '未分类' },
      { text: '(^y^)', description: '未分类' },
      { text: 'd(d＇∀＇)', description: '未分类' },
      { text: '(ﾉ>ω<)ﾉ', description: '未分类' },
      { text: '(^_っ^)', description: '未分类' },
      { text: '(*´∀`)~♥', description: '未分类' },
      { text: '_(:3 」∠ )_', description: '未分类' },
      { text: 'ヾ(；ﾟ(OO)ﾟ)ﾉ', description: '未分类' },
      { text: 'ლ｜＾Д＾ლ｜', description: '未分类' },
      { text: '(｡◕∀◕｡)', description: '未分类' },
      { text: 'ヽ(́◕◞౪◟◕‵)ﾉ', description: '未分类' },
      { text: '(ﾟ3ﾟ)～♪', description: '未分类' },
      { text: 'ヽ(✿ﾟ▽ﾟ)ノ', description: '未分类' },
      { text: 'థ౪థ', description: '未分类' },
      { text: '(✪ω✪)', description: '未分类' },
      { text: '(⁰▿⁰)', description: '未分类' },
      { text: 'ლ(╹◡╹ლ)', description: '未分类' },
      { text: '･*･:≡(　ε:)', description: '未分类' },
      { text: '(๑´ڡ`๑)', description: '未分类' },
      { text: '(๑´ㅂ`๑)', description: '未分类' },
      { text: 'ε٩(๑> ₃ <)۶з', description: '未分类' },
      { text: '(∂ω∂)', description: '未分类' },
      { text: 'ヽ(・×・´)ゞ', description: '未分类' },
      { text: '☆⌒(*^-゜)v', description: '未分类' },
      { text: '(灬ºωº灬)', description: '未分类' },
      { text: '(๑• . •๑)', description: '未分类' },
      { text: '(o´罒`o)', description: '未分类' },
      { text: '(´///☁///`)', description: '未分类' },
      { text: '( ^ω^)', description: '未分类' },
      { text: '(❛◡❛✿)', description: '未分类' },
      { text: '(ㅅ˘ㅂ˘)', description: '未分类' },
      { text: '♥(´∀` )人', description: '未分类' },
      { text: '٩(｡・ω・｡)﻿و', description: '未分类' },
      { text: '(*ˇωˇ*人)', description: '未分类' },
      { text: '(๑ơ ₃ ơ)♥', description: '未分类' },
      { text: '☆^(ｏ´Ф∇Ф)o', description: '未分类' },
      { text: '(๑´ㅁ`)', description: '未分类' },
      { text: '(^ρ^)/', description: '未分类' },
      { text: '(,,ﾟДﾟ)', description: '未分类' },
      { text: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', description: '未分类' },
      { text: 'o(☆Ф∇Ф☆)o', description: '未分类' },
      { text: '( • ̀ω•́ )', description: '未分类' },
      { text: '( ﾒ∀・)', description: '未分类' },
      { text: '(￫ܫ￩)', description: '未分类' },
      { text: '✧◝(⁰▿⁰)◜✧', description: '未分类' },
      { text: '(( へ(へ´∀`)へ', description: '未分类' },
      { text: '(๑•̀ㅂ•́)و✧', description: '未分类' },
      { text: '( శ 3ੜ)～♥', description: '未分类' },
      { text: '(♛‿♛)', description: '未分类' },
      { text: '( ♥д♥)', description: '未分类' },
      { text: 'ヽ(㊤V㊤*)ﾉ', description: '未分类' },
      { text: '(●｀ 艸 ´)', description: '未分类' },
      { text: '(♡˙︶˙♡)', description: '未分类' },
      { text: '(๑¯∀¯๑)', description: '未分类' },
      { text: 'Σ>―(〃°ω°〃)♡→', description: '未分类' },
      { text: 'ヾ(´ε`ヾ)', description: '未分类' },
      { text: '٩(๑•̀ω•́๑)۶', description: '未分类' },
      { text: '(((o(*ﾟ▽ﾟ*)o)))', description: '未分类' },
      { text: '(▰˘◡˘▰)', description: '未分类' },
      { text: 'ヽ(●´ε｀●)ノ', description: '未分类' },
      { text: 'ヽ( ° ▽°)ノ', description: '未分类' },
      { text: '(　ﾟ∀ﾟ) ﾉ♡', description: '未分类' },
      { text: '(ゝ∀･)⌒☆', description: '未分类' },
      { text: '(́순◞౪◟순‵)', description: '未分类' },
      { text: '(╯°▽°)╯ ┻━┻', description: '未分类' },
      { text: '(•‾⌣‾•)', description: '未分类' },
      { text: '(*´д`)~♥', description: '未分类' },
      { text: 'ε(*´･∀･｀)зﾞ', description: '未分类' },
      { text: '✧*｡٩(ˊᗜˋ*)و✧*｡', description: '未分类' },
      { text: '(੭ु´ ᐜ `)੭ु⁾⁾', description: '未分类' },
      { text: '⁽⁽ ◟(∗ ˊωˋ ∗)◞ ⁾⁾', description: '未分类' },
      { text: '*ଘ(੭*ˊᵕˋ)੭* ੈ✩‧₊˚', description: '未分类' },
      { text: '＼＼\\٩( \'ω\' )و //／／', description: '未分类' },
      { text: 'ヾ(´︶`*)ﾉ♬', description: '未分类' },
      { text: '(σﾟ∀ﾟ)σ..:*☆', description: '未分类' },
      { text: '(⁎⁍̴̛ᴗ⁍̴̛⁎)‼', description: '未分类' },
      { text: '(❀╹◡╹)', description: '未分类' },
      { text: '（๑ • ‿ • ๑ ）', description: '未分类' },
      { text: '⁽⁽ଘ( ˙꒳˙ )ଓ⁾⁾', description: '未分类' },
      { text: '(๑•̀ω•́)ノ', description: '未分类' },
      { text: '(๑ ^ ₃•๑)', description: '未分类' },
      { text: '⁽⁽٩(๑˃̶͈̀ ᗨ ˂̶͈́)۶⁾⁾', description: '未分类' },
      { text: '(ﾟ皿ﾟﾒ)', description: '未分类' },
      { text: '(ﾒ ﾟ皿ﾟ)ﾒ', description: '未分类' },
      { text: '(#`Д´)ﾉ', description: '未分类' },
      { text: '(#`皿´)', description: '未分类' },
      { text: '(-`ェ´-╬)', description: '未分类' },
      { text: '(`д´)', description: '未分类' },
      { text: '(╬ﾟдﾟ)', description: '未分类' },
      { text: 'ヽ(#`Д´)ﾉ', description: '未分类' },
      { text: '(╬☉д⊙)', description: '未分类' },
      { text: '⊙谷⊙', description: '未分类' },
      { text: 'ヽ(`Д´)ノ', description: '未分类' },
      { text: '(╬ﾟдﾟ)▄︻┻┳═一', description: '未分类' },
      { text: '٩(ŏ﹏ŏ、)۶', description: '未分类' },
      { text: '(╬ﾟ ◣ ﾟ)', description: '未分类' },
      { text: '(☄◣ω◢)☄', description: '未分类' },
      { text: '(ಠ益ಠ)', description: '未分类' },
      { text: '(ﾒﾟДﾟ)ﾒ', description: '未分类' },
      { text: '(#ﾟ⊿`)凸', description: '未分类' },
      { text: '(`へ´≠)', description: '未分类' },
      { text: '(*≥▽≤)ツ┏━┓', description: '未分类' },
      { text: '(๑•ૅω•´๑)', description: '未分类' },
      { text: '눈言눈', description: '未分类' },
      { text: '(╯•̀ὤ•́)╯', description: '未分类' },
      { text: '(； ･`д･´)', description: '未分类' },
      { text: '•_ゝ•', description: '未分类' },
      { text: '( ･᷄ὢ･᷅ )', description: '未分类' },
      { text: '(༼•̀ɷ•́༽)', description: '未分类' },
      { text: '(╬ﾟдﾟ)╭∩╮', description: '未分类' },
      { text: '٩(◦`꒳´◦)۶', description: '未分类' },
      { text: '(ノ▼Д▼)ノ', description: '未分类' },
      { text: '(ꐦ°᷄д°᷅)', description: '未分类' },
      { text: '(〃∀〃)', description: '未分类' },
      { text: 'σ`∀´)σ', description: '未分类' },
      { text: '(¦3[▓▓]', description: '未分类' },
      { text: '(శωశ)', description: '未分类' },
      { text: '(◔౪◔)', description: '未分类' },
      { text: '☝( ◠‿◠ )☝', description: '未分类' },
      { text: '(´≖◞౪◟≖)', description: '未分类' },
      { text: '(<ゝω・) 綺羅星☆', description: '未分类' },
      { text: 'm9(＾Д＾)ﾌﾟｷﾞｬｰ', description: '未分类' },
      { text: '( σ՞ਊ ՞)σ', description: '未分类' },
      { text: 'ლ(́◕◞౪◟◕‵ლ)', description: '未分类' },
      { text: '(◕ܫ◕)', description: '未分类' },
      { text: '(´ΘωΘ`)', description: '未分类' },
      { text: '( ิ◕㉨◕ ิ)', description: '未分类' },
      { text: '_(¦3」∠)_', description: '未分类' },
      { text: '( ～\'ω\')～', description: '未分类' },
      { text: '(　′∀`)σ≡σ☆))Д′)', description: '未分类' },
      { text: '(́提◞౪◟供‵)', description: '未分类' },
      { text: '(꒪ͦᴗ̵̍꒪ͦ )', description: '未分类' },
      { text: '(｢･ω･)｢', description: '未分类' },
      { text: '(❁´ω`❁)*✲ﾟ*', description: '未分类' },
      { text: '=└(┐卍^o^)卍', description: '未分类' },
      { text: 'ヾ(*ΦωΦ)ツ', description: '未分类' },
      { text: '◝(　ﾟ∀ ﾟ )◟', description: '未分类' },
      { text: '◥(ฅº￦ºฅ)◤', description: '未分类' },
      { text: 'ᕕ ( ᐛ ) ᕗ', description: '未分类' },
      { text: '(//´/◒/`//)', description: '未分类' },
      { text: '( ´థ౪థ）σ', description: '未分类' },
      { text: '(◍•ᴗ•◍)ゝ', description: '未分类' },
      { text: '(☞ﾟ∀ﾟ)ﾟ∀ﾟ)☞', description: '未分类' },
      { text: '₍₍◝(･\'ω\'･)◟⁾⁾', description: '未分类' },
      { text: '(╯⊙ ⊱ ⊙╰ )', description: '未分类' },
      { text: '(΄◞ิ౪◟ิ‵)', description: '未分类' },
      { text: '(´◓ｑ◔｀)', description: '未分类' },
      { text: 'ಠ౪ಠ', description: '未分类' },
      { text: 'ૢ(⁎❝᷀ົཽω ❝᷀ົཽ⁎)✧', description: '未分类' },
      { text: 'ヾ(⌒(ﾉｼ\'ω\')ﾉｼ', description: '未分类' },
      { text: 'ლ（╹ε╹ლ）', description: '未分类' },
      { text: '( ΄◞ิ .̫.̫ ◟ิ‵)', description: '未分类' },
      { text: '(☝ ՞ਊ ՞）☝', description: '未分类' },
      { text: '( ε:)⌒ﾞ(.ω.)⌒ﾞ(:3 )', description: '未分类' },
      { text: 'ψ(｀∇´)ψ', description: '未分类' },
      { text: '( ͡o ͜ʖ ͡o)', description: '未分类' },
      { text: '(๑╹◡╹๑)', description: '未分类' },
      { text: '(͡ ͡° ͜ つ ͡͡°)', description: '未分类' },
      { text: 'ᕙ(˵ ಠ ਊ ಠ ˵)ᕗ', description: '未分类' },
      { text: '∠( ᐛ 」∠)_', description: '未分类' },
      { text: '⎝(◕u◕)⎠', description: '未分类' },
      { text: 'ﾚ(ﾟ∀ﾟ;)ﾍ　ﾍ( ﾟ∀ﾟ;)ﾉ', description: '未分类' },
      { text: '⎝( OωO)⎠', description: '未分类' },
      { text: '(*°ω°*ฅ)*', description: '未分类' },
      { text: '(╯✧∇✧)╯', description: '未分类' },
      { text: '⸜(* ॑꒳ ॑* )⸝', description: '未分类' },
      { text: '⁄(⁄ ⁄•⁄ω⁄•⁄ ⁄)⁄', description: '未分类' },
      { text: '(〒︿〒)', description: '未分类' },
      { text: '(つ´ω`)つ', description: '未分类' },
      { text: '｡ﾟヽ(ﾟ´Д`)ﾉﾟ｡', description: '未分类' },
      { text: '⊂彡☆))д`)', description: '未分类' },
      { text: 'ヾ(;ﾟ;Д;ﾟ;)ﾉﾞ', description: '未分类' },
      { text: 'இдஇ', description: '未分类' },
      { text: '(´Ａ｀。)', description: '未分类' },
      { text: '(´;ω;`)ヾ(･∀･`)', description: '未分类' },
      { text: '｡ﾟ(ﾟ´ω`ﾟ)ﾟ｡', description: '未分类' },
      { text: '(╥﹏╥)', description: '未分类' },
      { text: ':;(∩´﹏`∩);:', description: '未分类' },
      { text: 'ΩДΩ', description: '未分类' },
      { text: '(☍﹏⁰)', description: '未分类' },
      { text: '( ´•̥̥̥ω•̥̥̥` )', description: '未分类' },
      { text: '(;´༎ຶД༎ຶ`)', description: '未分类' },
      { text: '( ´•̥×•̥` )', description: '未分类' },
      { text: '(☍﹏⁰。)', description: '未分类' },
      { text: '༼ ༎ຶ ෴ ༎ຶ༽', description: '未分类' },
      { text: '(ﾟд⊙)', description: '未分类' },
      { text: '(☉д⊙)', description: '未分类' },
      { text: 'Σ(*ﾟдﾟﾉ)ﾉ', description: '未分类' },
      { text: '(((ﾟДﾟ;)))', description: '未分类' },
      { text: '(((ﾟдﾟ)))', description: '未分类' },
      { text: '(ﾟдﾟ≡ﾟдﾟ)', description: '未分类' },
      { text: '(|||ﾟдﾟ)', description: '未分类' },
      { text: 'Σ( ° △ °)', description: '未分类' },
      { text: 'Σ(ﾟДﾟ；≡；ﾟдﾟ)', description: '未分类' },
      { text: '( ºΔº )', description: '未分类' },
      { text: 'Σ(;ﾟдﾟ)', description: '未分类' },
      { text: '(●▼●;)', description: '未分类' },
      { text: '┌|◎o◎|┘', description: '未分类' },
      { text: 'ε=ε=ヾ(;ﾟдﾟ)/', description: '未分类' },
      { text: '(⁰⊖⁰)', description: '未分类' },
      { text: '(°ﾛ°٥)', description: '未分类' },
      { text: '＼(●o○;)ノ', description: '未分类' },
      { text: 'Σヽ(ﾟД ﾟ; )ﾉ', description: '未分类' },
      { text: 'Σ(°Д°;', description: '未分类' },
      { text: '∑(￣□￣;)', description: '未分类' },
      { text: '∑(✘Д✘๑ )', description: '未分类' },
      { text: 'δ△δ', description: '未分类' },
      { text: '( ºωº )', description: '未分类' },
      { text: 'ㅇㅅㅇ', description: '未分类' },
      { text: '(┛`д´)┛', description: '未分类' },
      { text: '( ╯\' - \')╯ ┻━┻', description: '未分类' },
      { text: '(╯°Д°)╯ ┻━┻', description: '未分类' },
      { text: '(╯°O°)╯┻━┻', description: '未分类' },
      { text: '┳━┳ノ( OωOノ)', description: '未分类' },
      { text: '┳━┳ノ( \' - \'ノ)', description: '未分类' },
      { text: '┬─┬ ノ( \' - \'ノ)', description: '未分类' },
      { text: '（ ´☣///_ゝ///☣｀）', description: '未分类' },
      { text: '(*´艸`*)', description: '未分类' },
      { text: '(ﾉ∀`*)', description: '未分类' },
      { text: '(´,,•ω•,,)♡', description: '未分类' },
      { text: '(◕ H ◕)', description: '未分类' },
      { text: '( ´･ω)', description: '未分类' },
      { text: '(,,Ծ 3 Ծ,,)', description: '未分类' },
      { text: '|柱|ωﾟ)---c<` дﾟ)!', description: '未分类' },
      { text: '|柱|ω・`)', description: '未分类' },
      { text: '(´ﾟдﾟ`)', description: '未分类' },
      { text: '( ˘•ω•˘ )', description: '未分类' },
      { text: '( ˘･з･)', description: '未分类' },
      { text: '(｡ŏ_ŏ)', description: '未分类' },
      { text: '(눈‸눈)', description: '未分类' },
      { text: '(｡>﹏<)哈啾', description: '未分类' },
      { text: '(◜◔。◔◝)', description: '未分类' },
      { text: '(　´・◡・｀)', description: '未分类' },
      { text: '(ㆀ˘･з･˘)', description: '未分类' },
      { text: 'ヾ(◎´・ω・｀)ノ', description: '未分类' },
      { text: '(´c_`)', description: '未分类' },
      { text: 'Σ(｀L_｀ )', description: '未分类' },
      { text: '-//(ǒ.ǒ)//-', description: '未分类' },
      { text: '(´,_ゝ`)', description: '未分类' },
      { text: '(´_ゝ`)', description: '未分类' },
      { text: '-`д´-', description: '未分类' },
      { text: '(๑•́ ₃ •̀๑)', description: '未分类' },
      { text: '_(┐「ε:)_', description: '未分类' },
      { text: '(´-ι_-｀)', description: '未分类' },
      { text: '＿ﾉ乙(､ﾝ､)＿', description: '未分类' },
      { text: '(ﾟ⊿ﾟ)', description: '未分类' },
      { text: '(　◜◡‾)', description: '未分类' },
      { text: '(´･_･`)', description: '未分类' },
      { text: '(ㆆᴗㆆ)', description: '未分类' },
      { text: '(‾◡◝　)', description: '未分类' },
      { text: '┐(´д`)┌', description: '未分类' },
      { text: '( º﹃º )', description: '未分类' },
      { text: '(◞‸◟)', description: '未分类' },
      { text: '(´σ-`)', description: '未分类' },
      { text: '(ヾﾉ･ω･`)', description: '未分类' },
      { text: 'ლ(´•д• ̀ლ', description: '未分类' },
      { text: 'ლ(◉◞౪◟◉ )ლ', description: '未分类' },
      { text: '_(┐「﹃ﾟ｡)_', description: '未分类' },
      { text: 'ლ(╯⊙ε⊙ლ╰)', description: '未分类' },
      { text: '╮(′～‵〞)╭', description: '未分类' },
      { text: '( ´ﾟДﾟ`)', description: '未分类' },
      { text: '(≖＿≖)✧', description: '未分类' },
      { text: '(｡-_-｡)', description: '未分类' },
      { text: 'ƪ(•̃͡ε•̃͡)∫', description: '未分类' },
      { text: '(ノ〠_〠)', description: '未分类' },
      { text: '¯\_(ツ)_/¯', description: '未分类' },
      { text: '( ¯•ω•¯ )', description: '未分类' },
      { text: '( •́ _ •̀)？', description: '未分类' },
      { text: '(=m=)', description: '未分类' },
      { text: '(･ω´･ )', description: '未分类' },
      { text: '(;ﾟдﾟ)', description: '未分类' },
      { text: '( ◕‿‿◕ )', description: '未分类' },
      { text: 'ಠ_ಠ', description: '未分类' },
      { text: '(ΦωΦ)', description: '未分类' },
      { text: '◑▂◐', description: '未分类' },
      { text: '(΄ಢ◞౪◟ಢ‵)◉◞౪◟◉)', description: '未分类' },
      { text: '(✺ω✺)', description: '未分类' },
      { text: '(´◉‿◉｀)', description: '未分类' },
      { text: '( ͡ʘ ͜ʖ ͡ʘ)', description: '未分类' },
      { text: '(̿▀̿ ̿Ĺ̯̿̿▀̿ ̿)̄', description: '未分类' },
      { text: '･ิ≖ ω ≖･ิ✧', description: '未分类' },
      { text: 'ㅍ_ㅍ', description: '未分类' },
      { text: '༼ ºل͟º ༽', description: '未分类' },
      { text: '(๑•ั็ω•็ั๑)', description: '未分类' },
      { text: '(o´・ω・`)σ)Д`)', description: '未分类' },
      { text: '(╭☞•́⍛•̀)╭☞', description: '未分类' },
      { text: '( ﾟДﾟ)σ', description: '未分类' },
      { text: '(´・Å・`)', description: '未分类' },
      { text: 'ﾟÅﾟ)', description: '未分类' },
      { text: 'Σ(ﾟωﾟ)', description: '未分类' },
      { text: 'Σ(ﾟдﾟ)', description: '未分类' },
      { text: '(゜皿。)', description: '未分类' },
      { text: '( ˘•ω•˘ ).oOஇ', description: '未分类' },
      { text: 'Σ(lliдﾟﾉ)ﾉ', description: '未分类' },
      { text: '( ͡° ͜ʖ ͡ °)', description: '未分类' },
      { text: '( ͡° ͜ʖ ͡°)', description: '未分类' },
      { text: '<(_ _)>', description: '未分类' },
      { text: '(′゜ω。‵)', description: '未分类' },
      { text: 'm(｡≧ｴ≦｡)m', description: '未分类' },
      { text: '(シ_ _)シ', description: '未分类' },
      { text: '(っ・Д・)っ', description: '未分类' },
      { text: '( ￣ 3￣)y▂ξ', description: '未分类' },
      { text: '(◓Д◒)✄╰⋃╯', description: '未分类' },
      { text: '´-ω-)b', description: '未分类' },
      { text: '(`┌_┐´)', description: '未分类' },
      { text: 'ԅ(¯﹃¯ԅ)', description: '未分类' },
      { text: '（´◔​∀◔`)', description: '未分类' },
      { text: '(//´◜◞⊜◟◝｀////)', description: '未分类' },
      { text: '(/ ↀ3ↀ)/q(﹌ω﹌ )', description: '未分类' },
      { text: 'ლ(•ω •ლ)', description: '未分类' },
      { text: '(´-ωก`)', description: '未分类' },
      { text: '┏┛學校┗┓λλλλλ', description: '未分类' },
      { text: '(　ᐛ)パァ', description: '未分类' },
      { text: '( ･ิω･ิ)', description: '未分类' },
      { text: '༼ つ◕_◕ ༽つ', description: '未分类' },
      { text: '（¯﹃¯）', description: '未分类' },
      { text: 'ᕙ༼ຈل͜ຈ༽ᕗ', description: '未分类' },
      { text: 'ლ(ﾟдﾟლ)', description: '未分类' },
      { text: '╮(╯∀╰)╭', description: '未分类' },
      { text: '(ゝ∀･)b', description: '未分类' },
      { text: '(｡･㉨･｡)', description: '未分类' },
      { text: '( ‘д‘⊂彡☆))Д´)', description: '未分类' },
      { text: '魔貫光殺砲(ﾟДﾟ)σ━00000000000━●', description: '未分类' },
      { text: '( ´･･)ﾉ(._.`)', description: '未分类' },
      { text: 'Σ Σ Σ (」○ ω○ )／', description: '未分类' },
      { text: '๛ก(ｰ̀ωｰ́ก)', description: '未分类' },
      { text: '龜派氣功(ﾟДﾟ)< ============O))', description: '未分类' },
      { text: '＼(・ω・＼)SAN値！(／・ω・)／ピンチ！', description: '未分类' },
      { text: '(」・ω・)」SAN値！(／・ω・)／ピンチ！', description: '未分类' },
      { text: '─=≡Σ((( つ•̀ω•́)=c＜一ω<))', description: '未分类' },
      { text: '༼ つ ◕_◕ ༽つ', description: '未分类' },
      { text: 'ヽ(゜▽゜ )－C<(/;◇;)/~', description: '未分类' },
      { text: '๛ก（ーωーก）', description: '未分类' },
      { text: '( ՞ټ՞)', description: '未分类' },
      { text: '（´◔ ₃ ◔`)', description: '未分类' },
      { text: '(╭￣3￣)╭♡', description: '未分类' },
      { text: '╭∩╮( ͡⚆ ͜ʖ ͡⚆)╭∩╮', description: '未分类' },
      { text: 'ᕕ༼ ͠ຈ Ĺ̯ ͠ຈ ༽┌∩┐', description: '未分类' },
      { text: '(◉３◉)', description: '未分类' },
      { text: '(´;;◉;⊖;◉;;｀)', description: '未分类' },
      { text: '_:(´□`」 ∠):_', description: '未分类' },
      { text: '_(√ ζ ε:)_', description: '未分类' },
      { text: '_(°ω°｣ ∠)', description: '未分类' },
      { text: 'ヽ(=^･ω･^=)丿', description: '未分类' },
      { text: '( Φ ω Φ )', description: '未分类' },
      { text: '0(:3　)～ (\'､3_ヽ)_', description: '未分类' },
      { text: '(=´ᴥ`)', description: '未分类' },
      { text: 'Φ౪Φ', description: '未分类' },
      { text: 'ฅ●ω●ฅ', description: '未分类' },
      { text: '┌(┌^o^)┐', description: '未分类' },
      { text: '(￣ε(#￣)☆', description: '未分类' },
      { text: '(❍ᴥ❍ʋ)', description: '未分类' },
      { text: '(•ө•)', description: '未分类' },
      { text: '( ఠൠఠ )ﾉ', description: '未分类' },
      { text: '(o･e･)', description: '未分类' },
      { text: 'ก็ʕ•͡ᴥ•ʔ ก้', description: '未分类' },
      { text: '( ﾟ Χ ﾟ)', description: '未分类' },
      { text: '(:◎)≡', description: '未分类' },
      { text: '(･8･)', description: '未分类' },
      { text: '( ˊ̱˂˃ˋ̱ )', description: '未分类' },
      { text: '(=^-ω-^=)', description: '未分类' },
      { text: '⧸⎩⎠⎞͏(・∀・)⎛͏⎝⎭⧹', description: '未分类' },
      { text: '(°ཀ°)', description: '未分类' },
      { text: '⋉(● ∸ ●)⋊', description: '未分类' },
      { text: '(ﾟ々｡)', description: '未分类' },
      { text: '_(´ཀ`」 ∠)_', description: '未分类' },
      { text: '(✧≖‿ゝ≖)', description: '未分类' },
      { text: '_(┐ ◟;ﾟдﾟ)ノ', description: '未分类' },
      { text: '◑ω◐', description: '未分类' },
      { text: '／/( ◕‿‿◕ )＼', description: '未分类' },
      { text: '( ಠ ͜ʖರೃ)', description: '未分类' },
      { text: '┏( .-. ┏ ) ┓', description: '未分类' },
      { text: '(っ﹏-) .｡o', description: '未分类' },
      { text: 'öㅅö', description: '未分类' },
      { text: '┏(_д_┏)┓))', description: '未分类' },
      { text: '(￣(エ)￣)', description: '未分类' },
      { text: '(●｀･(ｴ)･´●)', description: '未分类' },
      { text: '┏((＝￣(ｴ)￣=))┛', description: '未分类' },
      { text: '(ó㉨ò)', description: '未分类' },
      { text: '<*)) >>=<', description: '未分类' },
      { text: '≧〔゜゜〕≦', description: '未分类' },
      { text: '(:3[___]=', description: '未分类' },
      { text: '(:3[__]4', description: '未分类' },
      { text: '(ﾒ3[____]', description: '未分类' },
      { text: '((└(:3」┌)┘))', description: '未分类' },
      { text: '( ´(00)`)', description: '未分类' },
      { text: '(｡í _ ì｡)', description: '未分类' },
      { text: '( ☉_☉)≡☞o────★°', description: '未分类' },
      { text: 'O-(///￣皿￣)☞ ─═≡☆゜★█▇▆▅▄▃▂＿　', description: '未分类' },
      { text: '美樹沙耶香 川▮ ㅂ ▮リ', description: '未分类' },
      { text: '（ﾟДﾟ）σ弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌弌⊃', description: '未分类' },
      { text: '─=≡Σ(((っﾟДﾟ)っ', description: '未分类' },
      { text: '(；´ﾟωﾟ｀人)', description: '未分类' },
      { text: '(੭ ᐕ)੭？', description: '未分类' },
      { text: '٩(♡ε♡ )۶', description: '未分类' },
      { text: '(´∀｀)♡', description: '未分类' },
      { text: '(༎ຶ⌑༎ຶ)', description: '未分类' },
      { text: '(꒦໊ྀʚ꒦໊ི )', description: '未分类' },
      { text: '(ꈨຶꎁꈨຶ)۶"', description: '未分类' },
      { text: '(´-_ゝ-`)', description: '未分类' },
      { text: '*｡٩(ˊωˋ*)و✧*｡', description: '未分类' },
      { text: '（)´д`(）', description: '未分类' },
      { text: '(´-εヾ )', description: '未分类' },
      { text: '₍₍ ᕕ(´ ω` )ᕗ⁾⁾', description: '未分类' },
      { text: '༼つ ் ▽ ் ༽つ', description: '未分类' },
      { text: '⊂(・﹏・⊂)', description: '未分类' },
      { text: '◟(ꉺᴗꉺ๑)◝', description: '未分类' },
      { text: '⁽⁽◝( •ω• )◜⁾⁾', description: '未分类' },
      { text: '₍₍ ◝(　ﾟ∀ ﾟ )◟ ⁾⁾♪', description: '未分类' },
      { text: '♪┌| ﾟ皿ﾟ|┘♪', description: '未分类' },
      { text: '~(‾▾‾~)', description: '未分类' },
      { text: 'ƪ(˘⌣˘)ʃ', description: '未分类' },
      { text: '( ˘ ³˘)♥', description: '未分类' },
      { text: 'ʕ˶\'༥\'˶ʔ', description: '未分类' },
      { text: 'ʕ⸝⸝⸝˙Ⱉ˙ʔ', description: '未分类' },
      { text: '(՞˶･･˶՞)', description: '未分类' },
      { text: '( ˶ ❛ ꁞ ❛ ˶ )', description: '未分类' },
      { text: '▼・ᴥ・▼', description: '未分类' },
      { text: '⌓‿⌓', description: '未分类' },
      { text: '(⸝⸝•̀֊•́⸝⸝)', description: '未分类' },
      { text: '( ✌︎\'ω\')✌︎', description: '未分类' },
      { text: '(˶‾᷄ ⁻̫ ‾᷅˵)', description: '未分类' },
      { text: '(՞˶･֊･˶՞)', description: '未分类' },
      { text: 'ϵ( \'Θ\' )϶', description: '未分类' },
      { text: '٩(๑❛ᴗ❛๑)۶', description: '未分类' },
      { text: 'ʕ´• ᴥ•̥`ʔ', description: '未分类' },
      { text: '(」・ω・)」うー！(／・ω・)／にゃー！', description: '未分类' },
      { text: '─=≡Σ((( つ•̀ω•́)つ', description: '未分类' },
      { text: 'ｷﾀ━━━━(ﾟ∀ﾟ)━━━━!!', description: '未分类' },
      { text: 'il||li _|￣|○ヽ(･ω･｀)', description: '未分类' },
      { text: '( ´∀`);y=ｰ(ﾟдﾟ)･∵. ﾀｰﾝ', description: '未分类' },
      { text: '(´･д･｀)ﾊ(･д･｀*)', description: '未分类' },
      { text: '("￣▽￣)-o█ █o-(￣▽￣")/', description: '未分类' },
      { text: '(｡´∀｀)ﾉ―⊂ZZZ⊃', description: '未分类' },
      { text: '(・∀・)ノ三G[__]ｺ', description: '未分类' },
      { text: '⊂(°Д°⊂⌒｀つ≡≡≡(´⌒;;;≡≡≡', description: '未分类' },
      { text: '( ・・)つ―{}@{}@{}-', description: '未分类' },
      { text: '(ノ・＿・)ノ凹 ┣凹━凹━凹┫', description: '未分类' },
      { text: '( ´-ω ･)▄︻┻┳══━', description: '未分类' },
      { text: '。･ﾟ･(つд`ﾟ)つ⑩))Д´)', description: '未分类' },
      { text: 'ヽ(∀ﾟ )人(ﾟ∀ﾟ)人( ﾟ∀)人(∀ﾟ )人(ﾟ∀ﾟ)人( ﾟ∀)ﾉ', description: '未分类' },
      { text: '(　ﾟ∀ﾟ)つ≡≡≡♡♡♡)`ν゜)ｸﾞｼｬ', description: '未分类' },
      { text: '(ㄏ￣▽￣)ㄏ ㄟ(￣▽￣ㄟ)', description: '未分类' },
      { text: '♡(*´∀｀*)人(*´∀｀*)♡', description: '未分类' },
      { text: '。゜+.(人-ω◕)゜+.゜', description: '未分类' },
      { text: '━(ﾟ∀ﾟ)━( ﾟ∀)━( ﾟ)━( )━( )━(ﾟ)━(∀ﾟ)━(ﾟ∀ﾟ)━', description: '未分类' },
      { text: '◢▆▅▄▃ 溫╰(〞︶〝) ╯馨 ▃▄▅▆◣', description: '未分类' },
      { text: '....ˊˋ------｡:.ﾟ_ヽ(_´∀`_)ﾉ_.:｡((浮水', description: '未分类' },
      { text: '╮/(＞▽<)人(>▽＜)╭', description: '未分类' },
      { text: '₍₍ ◝(\'ω\'◝) ⁾⁾ ₍₍ (◟\'ω\')◟ ⁾⁾', description: '未分类' },
      { text: '(╯‵□′)╯︵┴─┴', description: '未分类' },
      { text: '◢▆▅▄▃崩╰(〒皿〒)╯潰▃▄▅▇◣', description: '未分类' },
      { text: '（ ´ﾟ,_」ﾟ）ﾊﾞｶｼﾞｬﾈｰﾉ', description: '未分类' },
      { text: '╯-____-)╯~═╩════╩═', description: '未分类' },
      { text: '(╯ŏ益ŏ)╯︵(ヽo□o)ヽ', description: '未分类' },
      { text: '(╬▼дﾟ)▄︻┻┳═一', description: '未分类' },
      { text: '●｀ε´●)爻(●｀ε´● )', description: '未分类' },
      { text: '(┐「ε:)_三┌(.ω.)┐三_(:3 」∠)_', description: '未分类' },
      { text: '‹‹\( ˙▿˙　)/››‹‹\(　˙▿˙ )/››', description: '未分类' },
      { text: '‹‹\(´ω` )/››‹‹\( 　´)/››‹‹\( ´ω`)/››', description: '未分类' },
      { text: '・゜・(PД`q｡)・゜・', description: '未分类' },
      { text: '(ｏﾟﾛﾟ)┌┛Σ(ﾉ´*ω*`)ﾉ', description: '未分类' },
      { text: '｡･ﾟ･(ﾉД`)ヽ(ﾟДﾟ )秀秀', description: '未分类' },
      { text: 'L(　；ω；)┘三└(；ω；　)」', description: '未分类' },
      { text: '(;◉∀◉)オッ(∀◉)◉ハッ(;∀)◉◉ヨｫー!!!', description: '未分类' },
      { text: '(　◞≼☸≽◟ ._ゝ◞≼☸≽◟)', description: '未分类' },
      { text: '(;´д｀).｡ｏO(・・・・)', description: '未分类' },
      { text: '(σ回ω・)σ←↑→↓←↑', description: '未分类' },
      { text: '|////|　( 　)ﾉ　|////|(自動門', description: '未分类' },
      { text: '(=ﾟДﾟ=) ▄︻┻┳━ ·.`.`.`.', description: '未分类' },
      { text: '(:3っ)へ ヽ(´Д｀●ヽ)', description: '未分类' },
      { text: '(´д((☆ミPia!⊂▼(ｏ ‵－′ｏ)▼つPia!彡★))∀`)', description: '未分类' },
      { text: 'd(・ω・d) 微分！(∫・ω・)∫ 積分！∂(・ω・∂) 偏微分！(∮・ω・)∮ 沿閉曲線的積分！(∬・ω・)∬ 重積分！∇(・ω・∇)梯度！∇・(・ω・∇・)散度！∇×(・ω・∇×)旋度！Δ(・ω・Δ)拉普拉斯！', description: '未分类' },
      { text: '~(～o￣▽￣)～o.....o～(＿△＿o～)~..', description: '未分类' },
      { text: '( ￣□￣)/ 敬禮!! <(￣ㄧ￣ ) <(￣ㄧ￣ )', description: '未分类' },
      { text: 'ξ( ✿＞◡❛)▄︻▇▇〓▄︻┻┳═一', description: '未分类' },
      { text: '(´>∀)人(´・ω・)ﾉヽ(・ε・*)人(-д-`)', description: '未分类' },
      { text: ': ♡｡ﾟ.(*♡´◡` 人´◡` ♡*)ﾟ♡ °・', description: '未分类' },
      { text: '(〃￣ω￣)人(￣︶￣〃)', description: '未分类' },
      { text: 'どこ━━━━(゜∀゜三゜∀゜)━━━━!!??', description: '未分类' },
      { text: '#ﾟÅﾟ）⊂彡☆))ﾟДﾟ)･∵', description: '未分类' },
      { text: '（つ> _◕）つ︻╦̵̵͇̿̿̿̿╤───', description: '未分类' },
      { text: 'ヽ(゜▽゜　)－C<(/;◇;)/~[拖走]', description: '未分类' },
      { text: '( ￣□￣)σ 論破!! ︴≡║██言彈██》', description: '未分类' },
      { text: 'ヾ(:3ﾉｼヾ)ﾉｼ 三[____]', description: '未分类' },
      { text: '(#‵)3′)▂▂▂▃▄▅～～～嗡嗡嗡嗡嗡', description: '未分类' }
    ]
  }
]

const searchQuery = ref('')

// 过滤后的颜文字数据
const filteredKaomojis = computed(() => {
  if (!searchQuery.value) return kaomojiGroups

  return kaomojiGroups.map(group => ({
    name: group.name,
    items: group.items.filter(kaomoji =>
      kaomoji.description.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      kaomoji.text.includes(searchQuery.value)
    )
  })).filter(group => group.items.length > 0)
})

// 处理颜文字点击
const handleKaomojiClick = (kaomoji: Kaomoji) => {
  navigator.clipboard.writeText(kaomoji.text)
  ElMessage.success('已复制到剪贴板')
}

// 处理颜文字双击
const handleKaomojiDoubleClick = async (kaomoji: Kaomoji) => {
  try {
    // 直接复制颜文字文本到剪贴板
    if (window.ztools && window.ztools.copyText) {
      window.ztools.copyText(kaomoji.text)
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(kaomoji.text)
    }
    
    // 隐藏ZTools 窗口
    if (window.ztools) {
      window.ztools.hideMainWindow()
    }
    
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // 模拟按键序列：Alt+Tab切换窗口，然后Ctrl+V粘贴
    if (window.ztools && window.ztools.simulateKeyboardTap) {
      window.ztools.simulateKeyboardTap('tab', 'alt')
      await new Promise(resolve => setTimeout(resolve, 300))
      window.ztools.simulateKeyboardTap('v', 'ctrl')
      ElMessage.success(`已发送 ${kaomoji.text} 到聊天窗口`)
    }
  } catch (error) {
    console.error('双击发送颜文字失败:', error)
    ElMessage.error('发送失败，请重试')
  }
}
</script>

<style scoped lang="scss">
.kaomoji-picker {
  width: 100%;
  min-height: 100vh;
  background: var(--el-bg-color);
  padding: 16px;
  box-sizing: border-box;

  .search-section {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--el-bg-color);
    padding: 16px;
    margin: -16px -16px 16px -16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);

    .el-input {
      max-width: 600px;
    }
  }

  .kaomoji-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .kaomoji-group {
    .group-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      margin-bottom: 16px;
      padding: 0 8px;
    }

    .kaomoji-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      padding: 8px;

      .kaomoji-item {
        background: var(--el-bg-color-page);
        padding: 12px;
        border-radius: 8px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        border: 1px solid var(--el-border-color-lighter);
        font-size: 14px;

        &:hover {
          background: var(--el-color-primary-light-9);
          transform: translateY(-2px);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
        }
      }
    }
  }

  .kaomoji-item {
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    display: block !important;
  }

  // 暗黑模式适配
  html.dark & {
    background: #141414;

    .search-section {
      background: #141414;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);

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
    }

    .kaomoji-group {
      .kaomoji-grid .kaomoji-item {
        background: #1f2937;
        border-color: #414243;

        &:hover {
          background: #303030;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
        }
      }
    }
  }

  @media screen and (max-width: 768px) {
    padding: 12px;

    .kaomoji-group {
      .kaomoji-grid {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
      }
    }
  }
}
</style>