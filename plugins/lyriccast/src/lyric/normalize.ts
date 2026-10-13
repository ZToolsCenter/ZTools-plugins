/**
 * 文本规范化:标题/歌手比较与缓存键共用的"最彻底"一层。
 *
 * 目标:让同一首歌的两种写法(简繁、全半角、&/and、Pt./Part、罗马/阿拉伯数字、
 * 假名长音符)归一到同一字符串,同时不让不同歌名意外相撞。规则:
 * - NFKC(全角→半角、兼容组合);小写;
 * - "&" ↔ "and"、Pt./Part、独立 token 的罗马数字↔阿拉伯数字(在去空白前按 token 替换,
 *   避免 "Live" 里的字母被拆散或 "I Do" 与 "IDO" 之外产生歧义 —— 两侧用同一规则,一致即安全);
 * - 去标点/空白,保留 CJK、字母、数字;
 * - 繁体→简体(内置小映射表,覆盖常见歌名用字);
 * - 片假名长音符「ー」、中点「・」删除(两侧一致删除即等价)。
 */

/**
 * 繁→简映射:每两个字符一对(繁体, 简体)。手工挑选常见歌名/歌手名用字,
 * 不求全(生僻字两侧多半写法一致,不影响比较)。
 */
const TRAD_TO_SIMP_PAIRS =
  '愛爱礙碍罷罢備备筆笔畢毕邊边變变標标錶表別别賓宾補补財财參参慘惨燦灿蒼苍層层纏缠嘗尝長长償偿廠厂車车徹彻塵尘誠诚遲迟馳驰沖冲醜丑櫥橱礎处傳传創创錘锤辭辞從从叢丛湊凑竄窜錯错達达帶带貸贷單单擔担彈弹誕诞當当黨党檔档導导燈灯鄧邓敵敌滌涤締缔點点電电墊垫釣钓調调疊叠釘钉動动凍冻棟栋鬥斗獨独讀读賭赌鍍镀隊队對对頓顿奪夺訛讹島岛濤涛發发罰罚閥阀範范販贩廢废墳坟奮奋憤愤豐丰風风馮冯縫缝膚肤婦妇復复該该蓋盖幹干剛刚岡冈鋼钢個个給给鞏巩溝沟構构購购夠够顱颅顧顾關关觀观館馆慣惯廣广歸归龜龟規规貴贵滾滚國国過过駭骇漢汉號号鶴鹤賀贺橫横轟轰紅红後后護护滬沪華华劃划畫画話话懷怀壞坏歡欢環环換换喚唤黃黄揮挥輝辉毀毁會会賄贿穢秽闊阔貨货禍祸擊击機机積积饑饥譏讥極极級级擠挤幾几計计記记際际劑剂濟济繼继價价駕驾殲歼纖纤鹽盐儉俭檢检見见艦舰劍剑鍵键濺溅將将薑姜漿浆驕骄膠胶澆浇嬌娇攪搅階阶節节潔洁結结誡诫屆届進进盡尽勁劲驚惊經经靜静競竞舊旧劇剧據据懼惧捲卷覺觉訣诀軍军駿骏開开凱凯顆颗殼壳課课懇恳墾垦摳抠庫库褲裤塊块寬宽礦矿虧亏擴扩臘腊來来蘭兰攔拦欄栏爛烂撈捞勞劳澇涝樂乐類类淚泪籬篱離离裡里禮礼麗丽厲厉勵励曆历歷历釐厘聯联連连憐怜簾帘練练糧粮兩两諒谅輛辆療疗遼辽獵猎臨临鄰邻鱗鳞靈灵嶺岭鈴铃劉刘瀏浏龍龙樓楼婁娄蘆芦盧卢爐炉擄掳滷卤錄录陸陆驢驴亂乱論论羅罗蘿萝駱骆媽妈馬马罵骂嗎吗買买賣卖邁迈麥麦脈脉滿满謾谩貓猫門门們们夢梦彌弥謎谜謐谧綿绵緬缅廟庙滅灭憫悯鳴鸣謀谋畝亩難难撓挠腦脑鬧闹內内擬拟膩腻釀酿鳥鸟聶聂寧宁濃浓農农諾诺歐欧毆殴嘔呕盤盘龐庞賠赔噴喷騙骗飄飘頻频貧贫蘋苹憑凭評评潑泼鋪铺僕仆樸朴譜谱齊齐騎骑豈岂氣气棄弃啟启訖讫牽牵鉛铅淺浅槍枪嗆呛牆墙搶抢橋桥僑侨竅窍竊窃欽钦寢寝輕轻傾倾慶庆瓊琼窮穷區区驅驱軀躯趨趋權权勸劝卻却鵲鹊讓让擾扰熱热認认韌韧榮荣絨绒軟软銳锐灑洒賽赛傘伞喪丧騷骚澀涩殺杀紗纱篩筛曬晒刪删陝陕贍赡燒烧紹绍設设攝摄審审腎肾繩绳勝胜聖圣屍尸時时識识實实蝕蚀駛驶勢势適适釋释視视試试壽寿獸兽樞枢書书屬属術术樹树帥帅雙双誰谁稅税順顺說说碩硕絲丝鬆松蘇苏訴诉雖虽隨随歲岁孫孙損损縮缩瑣琐鎖锁臺台態态攤摊談谈曇昙嘆叹湯汤燙烫討讨騰腾題题體体條条鐵铁廳厅聽听統统頭头圖图塗涂團团蛻蜕脫脱馱驮窪洼彎弯灣湾萬万網网韋韦違违圍围為为維维偉伟偽伪衛卫謂谓溫温聞闻穩稳問问渦涡烏乌無无務务霧雾犧牺習习戲戏細细蝦虾峽峡俠侠嚇吓轄辖鮮鲜鹹咸顯显險险現现縣县憲宪線线鄉乡響响項项蕭萧銷销曉晓嘯啸協协脅胁諧谐寫写瀉泻興兴銹锈繡绣虛虚須须許许續续軒轩懸悬選选學学詢询尋寻訓训訊讯遜逊壓压鴉鸦啞哑亞亚嚴严巖岩顏颜陽阳養养樣样癢痒謠谣搖摇堯尧藥药爺爷葉叶頁页業业醫医儀仪義义億亿憶忆議议異异譯译陰阴蔭荫應应纓缨櫻樱鷹鹰贏赢穎颖憂忧優优猶犹誘诱輿舆魚鱼嶼屿語语譽誉預预馭驭鴛鸳淵渊園园員员圓圆緣缘遠远願愿約约躍跃鑰钥嶽岳粵粤雲云韻韵雜杂災灾載载讚赞臟脏鑿凿棗枣責责擇择則则澤泽賊贼贈赠詐诈齋斋債债戰战張张漲涨帳账脹胀趙赵蟄蛰這这針针偵侦診诊陣阵爭争幀帧證证織织職职執执紙纸摯挚擲掷幟帜質质鐘钟種种眾众謅诌週周驟骤燭烛築筑鑄铸專专賺赚準准濁浊茲兹資资漬渍蹤踪綜综總总鄒邹詛诅組组鑽钻'

const TRAD_TO_SIMP: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (let i = 0; i < TRAD_TO_SIMP_PAIRS.length; i += 2) {
    const trad = TRAD_TO_SIMP_PAIRS[i] as string
    const simp = TRAD_TO_SIMP_PAIRS[i + 1] as string
    if (trad && simp && trad !== simp) map.set(trad, simp)
  }
  return map
})()

/** 罗马数字(独立 token)→ 阿拉伯数字;仅 1~12,歌名里的 Part/Track 序号足够 */
const ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9',
  x: '10', xi: '11', xii: '12'
}

/**
 * token 级等价替换(在去空白之前,按空白分词后逐词处理):
 * "&"→"and"、Pt./Part 统一、罗马数字→阿拉伯数字。
 * 两侧查询词与候选名走同一函数,替换单向且确定,不会引入不对称。
 */
function replaceEquivalentTokens(text: string): string {
  let out = text.replace(/\s*&\s*/g, ' and ')
  out = out.replace(/\b(?:pt|part)\.?\s*(?=\d|[ivxIVX]\b)/g, 'part ')
  out = out
    .split(/\s+/)
    .map((token) => {
      const lower = token.toLowerCase().replace(/\.+$/, '')
      return ROMAN_TO_ARABIC[lower] ?? token
    })
    .join(' ')
  return out
}

/** 是否以 CJK 字符为主(简繁/日文汉字/假名都算宽字符) */
export function isCjkMajor(text: string): boolean {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) ?? []).length
  const latin = (text.match(/[a-z0-9]/g) ?? []).length
  if (cjk + latin === 0) return cjk > 0
  return cjk > latin
}

/**
 * 深度规范化:简繁/全半角/token 等价/去标点空白后的小写串。
 * 用于标题/歌手比较与(阶段 2 起)缓存键。
 */
export function normalizeText(raw: string): string {
  const nfkc = (raw || '').normalize('NFKC')
  const tokenized = replaceEquivalentTokens(nfkc)
  const lowered = tokenized.toLowerCase()
  let out = ''
  for (const ch of lowered) {
    const simp = TRAD_TO_SIMP.get(ch)
    out += simp ?? ch
  }
  // 假名长音符/中点删除;再去掉除 CJK、字母、数字以外的全部字符
  return out
    .replace(/[ー・]/g, '')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-z0-9]/gu, '')
    .trim()
}

/** 统计规范化文本的 CJK/拉丁字符占比(歌词语言校验用) */
export function scriptRatio(text: string): { cjk: number; latin: number } {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return { cjk, latin }
}
