(function(){
    const translations = {
      zh: {
        appTitle:"皮卡丘的音乐站",
        authorLabel:"作者：Zhenchao Jin + GPT 5.1",
        shortcutHint:"快捷键：Space 播放/暂停 · ←/→ 跳转 · ↑/↓ 音量 · N/P 切歌 · F 收藏 · L 切换歌词效果",
        shortcutPanelTitle:"快捷键说明",
        shortcutPanelDesc:"使用键盘可以更加方便地控制皮卡丘的音乐站：",
        shortcutPlayPause:"播放 / 暂停",
        shortcutSeek:"快退 / 快进 5 秒",
        shortcutVolume:"音量加 / 减",
        shortcutPrevNext:"上一首 / 下一首",
        shortcutFav:"收藏 / 取消收藏当前歌曲",
        shortcutMute:"静音 / 取消静音",
        shortcutFocusSearch:"聚焦搜索框",
        shortcutCloseModal:"提示：按 Esc 可以关闭弹窗。",
        searchTitle:"歌曲搜索",
        searchSubtitle:"支持咪咕 / 网易云 / QQ / 酷我",
        searchButton:"搜索",
        perSourceCount:"每个源加载",
        perSourceCountTail:"首结果",
        loadMore:"加载更多",
        searchStatusIdle:"尚未搜索，试试输入“林俊杰”？",
        searchStatusSearching:"正在搜索中…",
        searchStatusDone:"搜索完成。",
        searchStatusNoSource:"请至少选择一个音乐源。",
        playerTitle:"正在播放",
        playerSubtitle:"歌词动态高亮 · 炫酷霓虹",
        coverHint:"搜索并播放一首歌吧！",
        playerStatusIdle:"空闲",
        playerStatusLoading:"加载音源中…",
        playerStatusPlaying:"播放中",
        playerStatusPaused:"已暂停",
        lyricsEmpty:"暂无歌词，试着播放一首支持歌词的歌曲。",
        playlistTitle:"播放列表",
        tabResults:"搜索结果",
        tabFavorites:"我的收藏",
        tabCustomLists:"自建歌单",
        playlistInfoResults:"搜索结果列表",
        playlistInfoFavorites:"收藏列表",
        playlistInfoPlaylist:"歌单",
        newPlaylist:"新建歌单",
        footerText:"本站仅作为学习演示，音乐版权归各平台与原作者所有。",
        toastAddedFavorite:"已添加到收藏",
        toastRemovedFavorite:"已从收藏移除",
        toastAddedToPlaylist:"已添加到歌单",
        toastAlreadyInList:"该歌曲已在当前列表里~",
        toastNoMore:"已经没有更多搜索结果啦~",
        toastNeedKeyword:"请先输入搜索关键词。",
        toastSearchError:"搜索时发生了一点小错误，请稍后再试。",
        toastPlayError:"播放失败，请稍后再试。",
        toastDownloadNotReady:"当前歌曲还未加载完成，稍后再试。",
        toastPlaylistCreated:"歌单创建成功。",
        toastPlaylistEmpty:"当前歌单为空，先添加几首歌吧~",
        toastPlaymodeList:"播放模式：列表循环",
        toastPlaymodeSingle:"播放模式：单曲循环",
        toastPlaymodeShuffle:"播放模式：随机播放",
        toastNeedPlaylistSelected:"请先选择一个歌单。",
        toastNoCurrentTrack:"当前没有正在播放的歌曲。",
        sourceMigu:"咪咕",
        sourceNetease:"网易云",
        sourceQQ:"QQ音乐",
        sourceKuwo:"酷我",
        modalNewPlaylistTitle:"新建歌单",
        modalNewPlaylistDesc:"给你的歌单取一个可爱的名字吧～",
        modalConfirm:"确定",
        modalCancel:"取消",
        playmodeList:"列表循环",
        playmodeSingle:"单曲循环",
        playmodeShuffle:"随机播放"
      },
      en: {
        appTitle:"Pikachu Music Station",
        authorLabel:"Author: Zhenchao Jin + GPT 5.1",
        shortcutHint:"Shortcuts: Space Play/Pause · ←/→ Seek · ↑/↓ Volume · N/P Track · F Fav · L Lyrics FX",
        shortcutPanelTitle:"Keyboard Shortcuts",
        shortcutPanelDesc:"Control Pikachu Music Station more easily with your keyboard:",
        shortcutPlayPause:"Play / Pause",
        shortcutSeek:"Seek backward / forward 5s",
        shortcutVolume:"Volume up / down",
        shortcutPrevNext:"Previous / Next track",
        shortcutFav:"Favorite / unfavorite current track",
        shortcutMute:"Mute / unmute",
        shortcutFocusSearch:"Focus on search box",
        shortcutCloseModal:"Tip: press Esc to close dialogs.",
        searchTitle:"Search",
        searchSubtitle:"Supports Migu / Netease / QQ / Kuwo",
        searchButton:"Search",
        perSourceCount:"Per source",
        perSourceCountTail:"results",
        loadMore:"Load more",
        searchStatusIdle:"No search yet. Try typing \"JJ Lin\"?",
        searchStatusSearching:"Searching…",
        searchStatusDone:"Search completed.",
        searchStatusNoSource:"Please select at least one music source.",
        playerTitle:"Now Playing",
        playerSubtitle:"Dynamic neon lyrics visualizer",
        coverHint:"Search and play a song!",
        playerStatusIdle:"Idle",
        playerStatusLoading:"Loading audio…",
        playerStatusPlaying:"Playing",
        playerStatusPaused:"Paused",
        lyricsEmpty:"No lyrics yet. Try a song with LRC lyrics.",
        playlistTitle:"Playlists",
        tabResults:"Default",
        tabFavorites:"Favorites",
        tabCustomLists:"Playlists",
        playlistInfoResults:"Search Result List",
        playlistInfoFavorites:"Favorites List",
        playlistInfoPlaylist:"Playlist",
        newPlaylist:"Create",
        footerText:"For demo only. All music copyrights belong to original owners.",
        toastAddedFavorite:"Added to favorites",
        toastRemovedFavorite:"Removed from favorites",
        toastAddedToPlaylist:"Added to playlist",
        toastAlreadyInList:"This song is already in this list.",
        toastNoMore:"No more results to load.",
        toastNeedKeyword:"Please enter a search keyword first.",
        toastSearchError:"An error occurred while searching.",
        toastPlayError:"Playback failed. Please try again.",
        toastDownloadNotReady:"Song not fully loaded yet. Try again later.",
        toastPlaylistCreated:"Playlist created.",
        toastPlaylistEmpty:"Playlist is empty. Add some songs first.",
        toastPlaymodeList:"Play mode: list loop",
        toastPlaymodeSingle:"Play mode: single loop",
        toastPlaymodeShuffle:"Play mode: shuffle",
        toastNeedPlaylistSelected:"Please select a playlist first.",
        toastNoCurrentTrack:"No track is currently playing.",
        sourceMigu:"Migu",
        sourceNetease:"Netease",
        sourceQQ:"QQ Music",
        sourceKuwo:"Kuwo",
        modalNewPlaylistTitle:"Create Playlist",
        modalNewPlaylistDesc:"Give your playlist a cute name!",
        modalConfirm:"Confirm",
        modalCancel:"Cancel",
        playmodeList:"List loop",
        playmodeSingle:"Single loop",
        playmodeShuffle:"Shuffle"
      }
    };

    const state = {
      language:'zh',
      enabledSources:{migu:true, netease:true, qq:true, kuwo:true},
      perSourceLimit:10,
      perSourceCurrentLimit:{migu:10, netease:10, qq:10, kuwo:10},
      perSourcePage:{migu:1, netease:1, qq:1, kuwo:1},

      searchKeyword:'',
      searchResults:[],
      trackMap:new Map(),
      favorites:[],
      playlists:[],
      currentTrack:null,
      playContext:{type:'results',index:-1,playlistId:null},
      playMode:'list',
      isPlaying:false,
      lyricLines:[],
      currentLyricIndex:-1,
      searchInProgress:false,
      noMoreResults:false,
      muted:false
    };

    const dom = {};
    let audioLevel = 0;

    function $(id){return document.getElementById(id);}
    function t(k){const lang=state.language;return (translations[lang]&&translations[lang][k])||translations.zh[k]||k;}
    function showToast(msg){
      const toast=$('toast'); if(!toast)return;
      toast.textContent=msg;
      toast.classList.add('show');
      setTimeout(()=>toast.classList.remove('show'),2000);
    }
    function formatTime(sec){
      if(!isFinite(sec)||sec<0)sec=0;
      const m=Math.floor(sec/60);const s=Math.floor(sec%60);
      return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    }

    function getInterleavedSearchList(){
      const grouped={migu:[],netease:[],qq:[],kuwo:[]};
      state.searchResults.forEach(t=>{if(grouped[t.source])grouped[t.source].push(t);});
      Object.keys(grouped).forEach(k=>grouped[k].sort((a,b)=>(a.displayIndex||0)-(b.displayIndex||0)));
      const order=['migu','netease','qq','kuwo'];
      const idx={migu:0,netease:0,qq:0,kuwo:0};
      const out=[];
      let added=true;
      while(added){
        added=false;
        for(const s of order){
          const arr=grouped[s]; const i=idx[s];
          if(arr && i<arr.length){out.push(arr[i]);idx[s]++;added=true;}
        }
      }
      return out;
    }

    function setLanguage(lang){
      if(lang!=='zh' && lang!=='en') lang='zh';
      state.language=lang;
      try{localStorage.setItem('pikachu-music-lang',lang);}catch(e){}
      document.querySelectorAll('[data-i18n]').forEach(el=>{
        const key=el.dataset.i18n;
        if(key) el.textContent = t(key);
      });
      dom.searchInput.placeholder = lang==='zh'
        ? '输入歌名 / 歌手，回车搜索…'
        : 'Type song / artist, press Enter…';
      dom.playlistNameInput.placeholder = lang==='zh'
        ? '例如：通勤歌单 / 宝可梦歌单'
        : 'e.g. Commute mix / Pokemon list';
      updatePlaylistInfoLabel();
    }

    // ========== 旧的质量映射函数，暂时保留（不再使用 API 的 quality 字段） ==========
    function neteaseQualityToTag(q){
      const s = (q || '').toString().toLowerCase();
      if (/lossless|无损|flac|ape|wav|hi-?res|sq|臻品|臻音|高清臻音|spatial/.test(s)) return 'lossless';
      return 'normal';
    }
    function kuwoQualityToTag(qualityStr, urlStr, actualLevel){
      const s1=(qualityStr||'').toString().toLowerCase();
      const s2=(urlStr||'').toString().toLowerCase();
      const s3=(actualLevel||'').toString().toLowerCase();
      if (s3==='zp' || s3==='lossless') return 'lossless';
      if (/flac|lossless|无损|超高/.test(s1)) return 'lossless';
      if (s2.endsWith('.flac') || s2.includes('.flac?')) return 'lossless';
      return 'normal';
    }

    // ========== 新增：统一根据音频链接后缀判断音质 ==========
    function inferQualityFromUrl(url){
      if(!url) return {tag:null,label:''};
      let base = url.split('?')[0].toLowerCase();
      const m = base.match(/\.([a-z0-9]+)$/);
      const ext = m ? m[1] : '';
      const losslessExts = ['flac','wav','ape','alac','aiff'];
      if (losslessExts.includes(ext)) {
        return {tag:'lossless', label:'LOSSLESS'};
      }
      // 其他一律当作 320K 显示
      return {tag:'320k', label:'320K'};
    }

    // ===================== 各平台搜索 =====================

    async function searchMigu(kw,limit){
      const url=`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(kw)}&n=&num=${encodeURIComponent(limit)}&type=json`;
      let added=0;
      try{
        const res=await fetch(url);
        const json=await res.json();
        if(json.code!==200||!Array.isArray(json.data))return 0;
        for(const it of json.data){
          const n=it.n;
          const uid=`migu-${kw}-${n}-${it.title}-${it.singer}`;
          if(state.trackMap.has(uid))continue;
          const track={
            uid,source:'migu',displayIndex:n||0,keyword:kw,
            requestNum: limit,
            title:it.title||'',artist:it.singer||'',album:'',
            cover:null,audioUrl:null,lrc:null,lrcUrl:null,
            detailsLoaded:false,
            quality:null,
            qualityLabel:null
          };
          state.trackMap.set(uid,track);
          state.searchResults.push(track); added++;
        }
      }catch(e){console.error('migu',e);}
      return added;
    }

    // 网易云搜索（用 vkeys，page + num）
    async function searchNetease(kw, page, num){
      const url=`https://api.vkeys.cn/v2/music/netease?word=${encodeURIComponent(kw)}&page=${encodeURIComponent(page)}&num=${encodeURIComponent(num)}`;
      let added=0;
      try{
        const res=await fetch(url);
        const json=await res.json();
        if(json.code!==200||!Array.isArray(json.data))return 0;

        json.data.forEach((it, idx)=>{
          const songId = it.id;
          const uid=`netease-${songId}`;
          if(state.trackMap.has(uid))return;

          const track={
            uid,
            source:'netease',
            displayIndex:(Math.max(1,page)-1)*Math.max(1,num) + (idx+1),
            keyword:kw,

            songid:songId,
            title:it.song||'',
            artist:it.singer||'',
            album:it.album||'',

            cover:it.cover||null,
            audioUrl:null,
            lrc:null,
            lrcUrl:null,

            detailsLoaded:false,
            quality:null,
            qualityLabel:null
          };
          state.trackMap.set(uid,track);
          state.searchResults.push(track);
          added++;
        });

      }catch(e){console.error('netease(vkeys)',e);}
      return added;
    }

    // QQ 搜索：使用 tang 的 QQ 音乐搜索 API（只拿列表，不拿 url）
    async function searchQQ(kw, limit) {
    // 新接口：返回直接是数组（或有些情况下可能包一层 data，下面做了兼容）
    const url =
        `https://tang.api.s01s.cn/music_open_api.php` +
        `?msg=${encodeURIComponent(kw)}` +
        `&type=json`;

    let added = 0;

    try {
        const res = await fetch(url);
        const json = await res.json();

        // 兼容：既支持直接数组，也支持 { data: [...] } 这种包装
        const data = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
        if (!Array.isArray(data) || data.length === 0) return 0;

        // 按 limit 截断
        const list = data.slice(0, limit || data.length);

        list.forEach((it, idx) => {
        // 新接口里唯一标识是 song_mid
        const mid = it.song_mid;
        if (!mid) return;

        const uid = `qq-${mid}`;
        if (state.trackMap.has(uid)) return;

        const indexInList = idx + 1; // 1-based：作为 qqIndex / displayIndex

        const track = {
            uid,
            source: 'qq',

            // 用于交错显示的排序
            displayIndex: indexInList,

            // 记录检索关键词（详情再请求要用同一个 msg）
            keyword: kw,
            qqSearchKey: kw,

            // 这首在 QQ 搜索结果里的序号，用作 n（如果你后续详情接口仍需要 n）
            qqIndex: indexInList,

            // 元信息
            qqId: mid,
            songid: mid, // 保留旧字段名以防别处用到
            songMid: mid, // 可选：更语义化的字段

            title: it.song_title || '',
            artist: it.singer_name || '',
            album: '',

            cover: null, // 新接口没给封面

            // 搜索阶段没有 url 和 lrc
            audioUrl: null,
            lrc: null,
            lrcUrl: null,

            detailsLoaded: false,

            quality: null,
            qualityLabel: null,

            // 新接口返回 pay（如“付费”）
            qqQualityText: it.pay || null,
            pay: it.pay || null
        };

        state.trackMap.set(uid, track);
        state.searchResults.push(track);
        added++;
        });
    } catch (e) {
        console.error('qq search (tang)', e);
    }

    return added;
    }

    // 酷我搜索
    async function searchKuwo(kw, limit){
      const url=`https://kw-api.cenguigui.cn/?name=${encodeURIComponent(kw)}&page=1&limit=${encodeURIComponent(limit)}`;
      let added=0;
      try{
        const res=await fetch(url);
        const json=await res.json();
        if(json.code!==200 || !Array.isArray(json.data)) return 0;

        json.data.forEach((it, idx)=>{
          const uid=`kuwo-${it.rid}`;
          if(state.trackMap.has(uid))return;

          const track={
            uid,
            source:'kuwo',
            displayIndex:idx+1,
            keyword:kw,
            songid:it.rid,

            title:it.name||'',
            artist:it.artist||'',
            album:it.album||'',

            cover:it.pic||null,
            audioUrl:null,
            lrc:null,
            lrcUrl:null,
            detailsLoaded:false,
            quality:null,
            qualityLabel:null
          };

          state.trackMap.set(uid,track);
          state.searchResults.push(track);
          added++;
        });
      }catch(e){
        console.error('kuwo search',e);
      }
      return added;
    }

    // ===================== 聚合搜索 =====================

    async function searchAllSources(reset){
      if(!state.searchKeyword){showToast(t('toastNeedKeyword'));return;}
      const enabled=Object.keys(state.enabledSources).filter(k=>state.enabledSources[k]);
      if(!enabled.length){showToast(t('searchStatusNoSource'));return;}
      state.searchInProgress=true;
      dom.searchStatus.textContent=t('searchStatusSearching');

      if(reset){
        Object.keys(state.perSourceCurrentLimit)
          .forEach(k=>state.perSourceCurrentLimit[k]=state.perSourceLimit);
        Object.keys(state.perSourcePage).forEach(k=>state.perSourcePage[k]=1);

        state.searchResults=[];
        state.trackMap.clear();
        state.noMoreResults=false;
      }

      const kw=state.searchKeyword;
      const tasks=[];
      let finishedTasks = 0;
      const totalTasks = enabled.length;

      const runTask = async (s) => {
        try {
          const limit=state.perSourceCurrentLimit[s]||state.perSourceLimit;
          let added = 0;
          if(s==='migu') added = await searchMigu(kw,limit);
          else if(s==='netease') added = await searchNetease(kw, state.perSourcePage.netease || 1, state.perSourceLimit);
          else if(s==='qq') added = await searchQQ(kw,limit);
          else if(s==='kuwo') added = await searchKuwo(kw,limit);
          
          // 局部更新 UI
          dom.searchCount.textContent=state.searchResults.length.toString();
          renderMiniSearchList();
          
          if(!reset && added === 0 && finishedTasks === totalTasks - 1) {
             // 只有在所有任务都完成后才可能显示“没有更多”
             // 这里逻辑稍微复杂，暂时保持简单：只要搜到了就更新展示
          }
        } catch (e) {
          console.error(`Search failed for source ${s}:`, e);
        } finally {
          finishedTasks++;
          if (finishedTasks === totalTasks) {
            state.searchInProgress=false;
            dom.searchStatus.textContent=t('searchStatusDone');
          }
        }
      };

      // 并行启动所有任务
      enabled.forEach(s => runTask(s));
    }

    // ===================== 各平台详情 =====================

    async function fetchMiguDetails(track){
      const num = track.requestNum || state.perSourceCurrentLimit.migu || state.perSourceLimit || 20;
      const url=`https://api.xcvts.cn/api/music/migu?gm=${encodeURIComponent(track.keyword)}&n=${encodeURIComponent(track.displayIndex||1)}&num=${encodeURIComponent(num)}&type=json`;
      const res=await fetch(url);
      const j=await res.json();
      if(j.code!==200) throw new Error('migu detail');

      Object.assign(track,{
        title:j.title||track.title,
        artist:j.singer||track.artist,
        cover:j.cover||track.cover,
        audioUrl:j.music_url||track.audioUrl,
        lrcUrl:j.lrc_url||track.lrcUrl,
        pageUrl:j.link||track.pageUrl,
        detailsLoaded:true
      });

      // 根据音频链接后缀判断音质
      if (track.audioUrl) {
        const q = inferQualityFromUrl(track.audioUrl);
        track.quality = q.tag;
        track.qualityLabel = q.label;
      }

      if(track.lrcUrl && !track.lrc){
        try{
          const r=await fetch(track.lrcUrl);
          track.lrc=await r.text();
        }catch(e){}
      }
    }

    // 网易云详情：meting 拿音源 + vkeys 拿歌词
    async function fetchNeteaseDetails(track){
      const metingApi=`https://api.qijieya.cn/meting/?type=song&id=${encodeURIComponent(track.songid)}`;
      const res=await fetch(metingApi);
      const j=await res.json();
      if(!Array.isArray(j) || !j.length) throw new Error('netease meting detail empty');

      const d=j[0]||{};
      Object.assign(track,{
        title:d.name||track.title,
        artist:d.artist||track.artist,
        audioUrl:d.url||track.audioUrl,
        cover:d.pic||track.cover
      });

      // 根据音频链接后缀判断音质
      if (track.audioUrl) {
        const q = inferQualityFromUrl(track.audioUrl);
        track.quality = q.tag;
        track.qualityLabel = q.label;
      }

      const lyricApi=`https://api.vkeys.cn/v2/music/netease/lyric?id=${encodeURIComponent(track.songid)}`;
      try{
        const lr=await fetch(lyricApi);
        const lj=await lr.json();
        if(lj && lj.code===200 && lj.data){
          track.lrc = lj.data.lrc || track.lrc || null;
          track.lrcUrl = track.lrcUrl || lyricApi;
        }
      }catch(e){
        console.warn('netease(vkeys) lyric fetch failed', e);
      }

      track.detailsLoaded=true;
    }

    // QQ 详情：根据搜索时的关键词 + song_mid(mid) 拿 url + lrc（tang API）
    async function fetchQQDetails(track) {
    // 优先用搜索时用过的关键词，保证和原始排序一致
    const msg =
        (track.qqSearchKey || track.keyword || '').trim() ||
        ((track.title || '') + ' ' + (track.artist || '')).trim();

    // 新接口用 mid：优先 qqId/songMid/songid
    const mid =
        (track.qqId || track.songMid || track.songid || '').toString().trim();

    if (!mid) return;

    const url =
        `https://tang.api.s01s.cn/music_open_api.php` +
        `?msg=${encodeURIComponent(msg)}` +
        `&type=json` +
        `&mid=${encodeURIComponent(mid)}`;

    // 选择一个“最好”的播放链接（你也可以按需改优先级）
    function pickBestPlayUrl(d) {
        // lossless
        if (d.song_play_url_sq) return { url: d.song_play_url_sq, tag: 'lossless', label: 'LOSSLESS', text: `SQ ${d.kbps_sq || ''}`.trim() };
        if (d.song_play_url_pq) return { url: d.song_play_url_pq, tag: 'lossless', label: 'LOSSLESS', text: `PQ ${d.kbps_pq || ''}`.trim() };

        // other variants
        if (d.song_play_url_accom) return { url: d.song_play_url_accom, tag: 'hq', label: 'HQ', text: `ACCOM ${d.kbps_accom || ''}`.trim() };
        if (d.song_play_url_hq) return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ', text: `HQ ${d.kbps_hq || ''}`.trim() };

        if (d.song_play_url_standard) return { url: d.song_play_url_standard, tag: 'standard', label: 'STD', text: `STD ${d.kbps_standard || ''}`.trim() };
        if (d.song_play_url_fq) return { url: d.song_play_url_fq, tag: 'low', label: 'LOW', text: `FQ ${d.kbps_fq || ''}`.trim() };

        // fallback
        if (d.song_play_url) return { url: d.song_play_url, tag: null, label: null, text: null };

        return { url: null, tag: null, label: null, text: null };
    }

    try {
        const res = await fetch(url);
        const d = await res.json();

        // 基本校验：必须是对象且有 song_mid
        if (!d || typeof d !== 'object' || !d.song_mid) {
        throw new Error('qq detail error (invalid response)');
        }

        // 更新基础信息
        track.title   = d.song_title || d.song_name || track.title;
        track.artist  = d.singer_name || track.artist;
        track.album   = d.album_name || d.album_title || track.album || '';
        track.cover   = d.album_pic || d.singer_pic || track.cover;
        track.pageUrl = d.song_h5_url || track.pageUrl;

        // 播放链接（按优先级挑一个）
        const best = pickBestPlayUrl(d);
        track.audioUrl = best.url || track.audioUrl;

        // 歌词
        track.lrc = d.song_lyric || d.lyric || track.lrc;

        // 文本信息（你原来用 qqQualityText，这里塞 vip + kbps/size 等）
        track.qqQualityText =
        best.text ||
        (d.vip ? `VIP:${d.vip}` : null) ||
        track.qqQualityText;

        // quality / label：先用我们自己的选择，再用你已有 inferQualityFromUrl 兜底
        if (best.tag && best.label) {
        track.quality = best.tag;
        track.qualityLabel = best.label;
        }

        if (track.audioUrl) {
        const q = inferQualityFromUrl(track.audioUrl);
        if (q && q.label) {
            track.quality = q.tag;
            track.qualityLabel = q.label;
        }
        }

        track.detailsLoaded = true;
    } catch (e) {
        console.error('qq detail (tang)', e);
        // 失败的话不要把 detailsLoaded 置 true，下次还有机会重试
    }
    }

    async function fetchKuwoDetails(track){
      const api=`https://kw-api.cenguigui.cn/?id=${encodeURIComponent(track.songid)}&type=song&level=zp&format=json`;
      const res=await fetch(api);
      const j=await res.json();
      if(!j || j.code!==200 || !j.data) throw new Error('kuwo kw-api detail failed');

      const d=j.data;
      Object.assign(track,{
        title:d.name || track.title,
        artist:d.artist || track.artist,
        album:d.album || track.album,
        cover:d.pic || track.cover,
        audioUrl:d.url || track.audioUrl,
        lrc: d.lyric || track.lrc || null,
        lrcUrl: null,
        detailsLoaded:true
      });

      // 酷我：根据最终 url 后缀判断音质
      if (track.audioUrl) {
        const q = inferQualityFromUrl(track.audioUrl);
        track.quality = q.tag;
        track.qualityLabel = q.label;
      }
    }

    async function ensureTrackDetails(track){
      if(track.detailsLoaded && track.audioUrl && (track.lrc || !track.lrcUrl)) return;
      dom.playerStatus.textContent=t('playerStatusLoading');
      if(track.source==='migu') await fetchMiguDetails(track);
      else if(track.source==='netease') await fetchNeteaseDetails(track);
      else if(track.source==='kuwo') await fetchKuwoDetails(track);
      else await fetchQQDetails(track);
    }

    // ===================== 歌词处理 =====================

    function parseLRC(txt) {
      if (!txt) return [];
      const decodeEntities = (s) => {
        const e = document.createElement('div');
        e.innerHTML = s;
        return e.textContent || s;
      };
      const cleanTxt = decodeEntities(txt);
      const lines = cleanTxt.split(/\r?\n/);
      const out = [];

      // 匹配 [mm:ss.xx] 或 [mm:ss] 格式的时间戳
      const timeReg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d+))?\]/g;

      for (const line of lines) {
        // 1. 提取该行文字内容（去掉所有 [...] 头部/中间标签）
        const text = line.replace(/\[.*?\]/g, '').trim();
        if (!text) continue;

        // 2. 查找该行包含的所有时间戳
        let match;
        timeReg.lastIndex = 0; // 重置正则状态
        while ((match = timeReg.exec(line)) !== null) {
          const min = parseInt(match[1], 10) || 0;
          const sec = parseInt(match[2], 10) || 0;
          const msStr = match[3] || '0';
          const ms = parseInt(msStr, 10) || 0;
          // 根据毫秒位长度自动转换（支持 .3, .34, .345 等）
          const time = min * 60 + sec + ms / Math.pow(10, msStr.length);
          out.push({ time, text });
        }
      }
      // 按时间排序
      return out.sort((a, b) => a.time - b.time);
    }

    function renderLyrics() {
      const wrap = dom.lyricsOverlayInner;
      wrap.innerHTML = '';
      state.currentLyricIndex = -1;
      const arr = state.lyricLines;

      if (!arr.length) {
        const empty = document.createElement('div');
        empty.className = 'lyrics-empty';
        empty.style.fontSize = '24px';
        empty.style.opacity = '0.5';
        empty.textContent = t('lyricsEmpty');
        wrap.appendChild(empty);
        return;
      }
      arr.forEach((ln, i) => {
        const div = document.createElement('div');
        div.className = 'lyrics-line';
        div.dataset.index = i;
        div.textContent = ln.text;
        
        // 点击跳转播放
        div.addEventListener('click', () => {
          dom.audio.currentTime = ln.time;
          if (dom.audio.paused) {
            dom.audio.play().catch(e => console.error(e));
          }
          showToast('跳转到: ' + formatTime(ln.time));
        });

        wrap.appendChild(div);
      });
    }

    function updateLyricsHighlight(time){
      const lines=state.lyricLines; if(!lines.length)return;
      let idx=state.currentLyricIndex;
      if(idx<0||idx>=lines.length||time<lines[idx].time|| (idx+1<lines.length && time>=lines[idx+1].time)){
        idx=lines.findIndex((l,i)=>{
          const nxt=lines[i+1];
          if(!nxt)return time>=l.time-0.05;
          return time>=l.time-0.05 && time<nxt.time-0.05;
        });
      }
      if(idx<0||idx===state.currentLyricIndex)return;
      state.currentLyricIndex=idx;
      const wrap=dom.lyricsOverlayInner;
      wrap.querySelectorAll('.lyrics-line.active').forEach(el=>el.classList.remove('active'));
      const act=wrap.querySelector(`.lyrics-line[data-index="${idx}"]`);
      if(act){
        act.classList.add('active');
        // 全屏沉浸式居中对齐：act.offsetTop 是相对于 lyrics-overlay-inner 的
        const container = dom.lyricsOverlayScroll;
        const containerHeight = container.clientHeight;
        const actTop = act.offsetTop;
        const actHeight = act.offsetHeight;
        
        // 计算目标滚动位置，使歌词行位于容器中央
        const targetScroll = actTop - (containerHeight / 2) + (actHeight / 2);

        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }
    }

    // ===================== 收藏 / 播放 =====================

    function isFavorite(track){
      if(!track)return false;
      return state.favorites.some(x=>x.uid===track.uid);
    }
    function updateMainFavButton(){
      const tr=state.currentTrack;
      const active=isFavorite(tr);
      dom.favBtn.classList.toggle('btn-fav-active',active);
    }

    async function playTrack(track,context){
      if(!track)return;
      state.currentTrack=track;
      state.playContext=context||state.playContext;

      const applyUI=()=>{
        const titleStr = track.title || 'Unknown';
        const artistStr = track.artist || 'Unknown';
        dom.trackTitle.textContent = titleStr;
        dom.trackArtist.textContent = artistStr;

        // 全屏浮层同步
        dom.overlayTitle.textContent = titleStr;
        dom.overlayArtist.textContent = artistStr;

        const sk=track.source;
        const key=sk==='migu'?'sourceMigu':
                  sk==='netease'?'sourceNetease':
                  sk==='qq'?'sourceQQ':'sourceKuwo';
        dom.trackSourcePill.style.display='inline-flex';
        dom.trackSourcePill.className='source-pill source-'+sk;
        dom.trackSourcePill.innerHTML='';
        const dot=document.createElement('span');
        dot.className='source-dot '+sk;
        const txt=document.createElement('span');
        txt.textContent=t(key);
        dom.trackSourcePill.appendChild(dot);
        dom.trackSourcePill.appendChild(txt);

        // 显示音质：LOSSLESS 或 320K
        if (track.qualityLabel) {
          dom.trackQualityPill.style.display = 'inline-block';
          dom.trackQualityPill.textContent = track.qualityLabel;
        } else {
          dom.trackQualityPill.style.display = 'none';
        }

        const picUrl = track.cover || track.pic;
        if(picUrl){
          dom.coverImg.src=picUrl;
          dom.coverImg.style.display='block';
          dom.coverPlaceholder.style.display='none';
          dom.lyricsOverlayBg.style.backgroundImage = `url(${picUrl})`;
        }else{
          dom.coverImg.style.display='none';
          dom.coverPlaceholder.style.display='flex';
          dom.lyricsOverlayBg.style.backgroundImage = 'none';
        }
      };

      dom.playerStatus.textContent=t('playerStatusLoading');
      applyUI();

      state.lyricLines = track.lrc ? parseLRC(track.lrc) : [];
      renderLyrics();
      updateMainFavButton();

      try{
        await ensureTrackDetails(track);
        applyUI();
        state.lyricLines = track.lrc ? parseLRC(track.lrc) : [];
        renderLyrics();
        if(!track.audioUrl){showToast(t('toastPlayError'));dom.playerStatus.textContent=t('playerStatusIdle');return;}
        dom.audio.src=track.audioUrl;
        await dom.audio.play();
        state.isPlaying=true;
        dom.playBtn.textContent='⏸';
        dom.playerStatus.textContent=t('playerStatusPlaying');
      }catch(e){
        console.error(e);
        showToast(t('toastPlayError'));
        dom.playerStatus.textContent=t('playerStatusIdle');
      }

      renderMiniSearchList();
      renderPlaylistList();
    }

    function getActiveList(){
      const tp=state.playContext.type;
      if(tp==='results'){
        let list=getInterleavedSearchList();
        if(!list.length && state.searchResults.length){
          list=[...state.searchResults];
        }
        return list;
      }
      if(tp==='favorites')return state.favorites;
      if(tp==='playlist'){
        const pl=state.playlists.find(p=>p.id===state.playContext.playlistId);
        return pl?pl.tracks:[];
      }
      return getInterleavedSearchList();
    }

    function playFromList(type,index,plId){
      let list;
      if(type==='results') list=getInterleavedSearchList();
      else if(type==='favorites') list=state.favorites;
      else{
        const pl=state.playlists.find(p=>p.id===plId);
        list=pl?pl.tracks:[];
      }
      if(!list.length){
        if(type!=='results')showToast(t('toastPlaylistEmpty'));
        return;
      }
      if(index<0)index=list.length-1;
      if(index>=list.length)index=0;
      state.playContext={type,index,playlistId:plId||null};
      playTrack(list[index],state.playContext);
      switchTab('player'); // 播放时自动跳转到播放页
    }

    function playNext(direction){
      const list=getActiveList(); if(!list.length)return;
      let idx=state.playContext.index ?? -1;
      if(idx<0||idx>=list.length)idx=0;

      if(state.playMode==='single'){
        dom.audio.currentTime=0;
        dom.audio.play().catch(()=>{});
        return;
      }
      if(state.playMode==='shuffle'){
        if(list.length===1){
          idx=0;
        }else{
          let newIdx;
          do{ newIdx=Math.floor(Math.random()*list.length); }while(newIdx===idx);
          idx=newIdx;
        }
      }else{
        idx = (idx + (direction==='prev'?-1:1) + list.length) % list.length;
      }
      playFromList(state.playContext.type,idx,state.playContext.playlistId);
    }

    function togglePlayPause(){
      if(!dom.audio.src)return;
      if(state.isPlaying)dom.audio.pause();
      else dom.audio.play().catch(e=>console.error(e));
    }

    function toggleFavoriteCurrent(){
      const tr=state.currentTrack; if(!tr)return;
      const i=state.favorites.findIndex(x=>x.uid===tr.uid);
      if(i>=0){state.favorites.splice(i,1);showToast(t('toastRemovedFavorite'));}
      else{state.favorites.push(tr);showToast(t('toastAddedFavorite'));}
      updateMainFavButton();
      renderPlaylistList();
    }

    async function handleDownloadCurrent() {
      const tr = state.currentTrack;
      if (!tr || !tr.audioUrl) {
        showToast(t('toastDownloadNotReady'));
        return;
      }

      // ZTools 环境适配：使用原生另存为对话框
      if (window.ztools && typeof window.ztools.showSaveDialog === 'function' && window.ztoolsPreload) {
        try {
          // 阻止失焦隐藏：防止弹出系统对话框时窗口折叠
          if (typeof window.ztools.setHideOnBlur === 'function') {
            window.ztools.setHideOnBlur(false);
          }

          const defaultName = `${tr.artist || 'Unknown'} - ${tr.title || 'Song'}.mp3`.replace(/[\\/:*?"<>|]/g, '_');
          const savePath = await window.ztools.showSaveDialog({
            title: '另存为',
            defaultPath: defaultName,
            filters: [{ name: 'MP3 音乐', extensions: ['mp3'] }]
          });

          if (savePath) {
            dom.downloadProgressContainer.classList.add('show');
            dom.downloadBar.style.width = '0%';
            dom.downloadPercent.textContent = '0%';

            window.ztoolsPreload.downloadFile(
              tr.audioUrl,
              savePath,
              (progress) => {
                const percent = Math.round(progress * 100);
                dom.downloadBar.style.width = percent + '%';
                dom.downloadPercent.textContent = percent + '%';
              },
              () => {
                dom.downloadProgressContainer.classList.remove('show');
                showToast('下载完成！已保存到本地。');
              },
              (err) => {
                dom.downloadProgressContainer.classList.remove('show');
                showToast('下载失败: ' + err);
              }
            );
          }
        } catch (e) {
          console.error('SaveDialog Error:', e);
          window.ztoolsPreload.openExternal(tr.audioUrl);
        } finally {
          // 恢复失焦隐藏逻辑
          if (typeof window.ztools.setHideOnBlur === 'function') {
            setTimeout(() => {
              window.ztools.setHideOnBlur(true);
            }, 500);
          }
        }
      } else if (window.ztoolsPreload && typeof window.ztoolsPreload.openExternal === 'function') {
        window.ztoolsPreload.openExternal(tr.audioUrl);
        showToast('已调起外部下载');
      } else {
        window.open(tr.audioUrl, '_blank');
      }
    }

    function addCurrentToPlaylist(){
      const plId=dom.playlistSelect.value;
      if(!plId){showToast(t('toastNeedPlaylistSelected'));return;}
      const track=state.currentTrack;
      if(!track){showToast(t('toastNoCurrentTrack'));return;}
      const pl=state.playlists.find(p=>p.id===plId);
      if(!pl){showToast(t('toastNeedPlaylistSelected'));return;}
      if(pl.tracks.some(tk=>tk.uid===track.uid)){
        showToast(t('toastAlreadyInList'));
        return;
      }
      pl.tracks.push(track);
      renderPlaylistList();
      showToast(t('toastAddedToPlaylist'));
    }

    // ===================== 搜索结果 / 播放列表渲染 =====================

    function renderMiniSearchList(){
      const wrap=dom.searchMiniList;
      wrap.innerHTML='';
      const out=getInterleavedSearchList();
      const frag=document.createDocumentFragment();
      out.forEach((track,i)=>{
        const item=document.createElement('div');
        item.className='search-mini-item';
        
        const badge=document.createElement('div');
        badge.className='mini-badge'; 
        badge.textContent=(i+1 < 10 ? '0' + (i+1) : (i+1));
        
        const meta=document.createElement('div');
        meta.className='mini-meta-main';
        const tt=document.createElement('div');
        tt.className='mini-title'; tt.textContent=track.title||'Unknown';
        const ar=document.createElement('div');
        ar.className='mini-artist'; ar.textContent=track.artist||'';
        meta.appendChild(tt);meta.appendChild(ar);
        
        const right=document.createElement('div');
        right.className='mini-right';
        const src=document.createElement('div');
        src.className='mini-source source-tag ' + track.source;
        const key=track.source==='migu'?'sourceMigu':
                 track.source==='netease'?'sourceNetease':
                 track.source==='qq'?'sourceQQ':'sourceKuwo';
        src.textContent=t(key);
        right.appendChild(src);
        
        item.appendChild(badge);
        item.appendChild(meta);
        item.appendChild(right);
        
        item.addEventListener('click',()=>{
          const visible=getInterleavedSearchList();
          const idx=visible.findIndex(x=>x.uid===track.uid);
          playFromList('results',idx);
        });
        frag.appendChild(item);
      });
      wrap.appendChild(frag);
    }

    function updatePlaylistInfoLabel(){
      const tab=document.querySelector('.playlist-tab.active')?.dataset.tab||'results';
      if(tab==='results') dom.playlistInfo.textContent = t('playlistInfoResults');
      else if(tab==='favorites') dom.playlistInfo.textContent = t('playlistInfoFavorites');
      else {
        const pl=state.playlists.find(p=>p.id===dom.playlistSelect.value);
        const base=t('playlistInfoPlaylist');
        dom.playlistInfo.textContent = pl? (base+' · '+pl.name) : base;
      }
    }

    function renderPlaylistList(){
      const wrap=dom.playlistList;
      wrap.innerHTML='';
      const activeTab=document.querySelector('.playlist-tab.active')?.dataset.tab||'results';
      let list=[];
      if(activeTab==='results'){
        list=getInterleavedSearchList();
        if(!list.length && state.searchResults.length){
          list=[...state.searchResults];
        }
        dom.playlistSelectRow.style.display='none';
      }else if(activeTab==='favorites'){
        list=state.favorites;
        dom.playlistSelectRow.style.display='none';
      }else{
        dom.playlistSelectRow.style.display='flex';
        if(!state.playlists.length){
          dom.playlistSelect.innerHTML='';
          const opt=document.createElement('option');
          opt.value=''; opt.textContent=state.language==='zh'?'暂无歌单':'No playlist';
          dom.playlistSelect.appendChild(opt);
          updatePlaylistInfoLabel();
          return;
        }
        if(!dom.playlistSelect.value)dom.playlistSelect.value=state.playlists[0].id;
        const pl=state.playlists.find(p=>p.id===dom.playlistSelect.value)||state.playlists[0];
        dom.playlistSelect.value=pl.id;
        list=pl.tracks;
      }
      updatePlaylistInfoLabel();

      const frag=document.createDocumentFragment();
      list.forEach((track,idx)=>{
        const item=document.createElement('div');
        item.className='track-item';
        if(state.currentTrack && state.currentTrack.uid===track.uid) item.classList.add('playing');

        const index=document.createElement('div');
        index.className='track-index'; index.textContent=idx+1;

        const meta=document.createElement('div');
        const title=document.createElement('div');
        title.className='track-meta-title'; title.textContent=track.title||'Unknown';
        const sub=document.createElement('div');
        sub.className='track-meta-sub';
        const aSpan=document.createElement('span'); aSpan.textContent=track.artist||'';
        const sSpan=document.createElement('span');
        const dot=document.createElement('span'); dot.className='source-dot '+track.source;
        const key=track.source==='migu'?'sourceMigu':
                 track.source==='netease'?'sourceNetease':
                 track.source==='qq'?'sourceQQ':'sourceKuwo';
        const txt=document.createElement('span'); txt.textContent=t(key);
        sSpan.appendChild(dot);sSpan.appendChild(txt);
        sub.appendChild(aSpan);sub.appendChild(sSpan);
        meta.appendChild(title);meta.appendChild(sub);

        const act=document.createElement('div');
        act.className='track-actions';
        const pBtn=document.createElement('button');
        pBtn.className='btn btn-secondary btn-icon'; pBtn.textContent='▶';
        const fBtn=document.createElement('button');
        fBtn.className='btn btn-secondary btn-icon'; fBtn.textContent='❤';
        if(isFavorite(track)) fBtn.classList.add('btn-fav-active');

        act.appendChild(pBtn); act.appendChild(fBtn);

        pBtn.addEventListener('click',ev=>{
          ev.stopPropagation();
          if(activeTab==='results'){
            const visible=getInterleavedSearchList();
            const i=visible.findIndex(x=>x.uid===track.uid);
            playFromList('results',i);
          }else if(activeTab==='favorites'){
            const i=state.favorites.findIndex(x=>x.uid===track.uid);
            playFromList('favorites',i);
          }else{
            const plId=dom.playlistSelect.value;
            const pl=state.playlists.find(p=>p.id===plId);
            const i=pl?pl.tracks.findIndex(x=>x.uid===track.uid):-1;
            playFromList('playlist',i,plId);
          }
        });
        fBtn.addEventListener('click',ev=>{
          ev.stopPropagation();
          const tr = track;
          const i=state.favorites.findIndex(x=>x.uid===tr.uid);
          if(i>=0){
            state.favorites.splice(i,1);
            showToast(t('toastRemovedFavorite'));
          } else {
            state.favorites.push(tr);
            showToast(t('toastAddedFavorite'));
          }
          renderPlaylistList();
          updateMainFavButton();
        });

        item.appendChild(index);item.appendChild(meta);item.appendChild(act);
        item.addEventListener('click',()=>pBtn.click());
        frag.appendChild(item);
      });
      wrap.appendChild(frag);

      const playingEl=wrap.querySelector('.track-item.playing');
      if(playingEl){
        playingEl.scrollIntoView({block:'center',behavior:'smooth'});
      }
    }

    // ===================== 歌单弹窗 =====================

    function openPlaylistModal(){
      dom.playlistModal.classList.add('show');
      dom.playlistNameInput.value='';
      setTimeout(()=>dom.playlistNameInput.focus(),50);
    }
    function closePlaylistModal(){
      dom.playlistModal.classList.remove('show');
    }
    function createPlaylist(){
      let name=dom.playlistNameInput.value.trim();
      if(!name)name=state.language==='zh'?'未命名歌单':'Untitled Playlist';
      const id='pl-'+Date.now()+'-'+Math.random().toString(16).slice(2);
      const pl={id,name,tracks:[]};
      state.playlists.push(pl);
      const opt=document.createElement('option');
      opt.value=pl.id; opt.textContent=pl.name;
      dom.playlistSelect.appendChild(opt);
      dom.playlistSelect.value=pl.id;
      closePlaylistModal();
      renderPlaylistList();
      showToast(t('toastPlaylistCreated'));
    }

    // ===================== 搜索加载更多 =====================

    function canAutoLoadMore(){
      return !state.searchInProgress && !state.noMoreResults;
    }
    function requestMoreResults(){
      const enabled=Object.keys(state.enabledSources).filter(k=>state.enabledSources[k]);
      if(!enabled.length)return;

      enabled.forEach(src=>{
        if(src==='netease'){
          state.perSourcePage.netease = (state.perSourcePage.netease || 1) + 1;
        }else{
          state.perSourceCurrentLimit[src]=(state.perSourceCurrentLimit[src]||state.perSourceLimit)+state.perSourceLimit;
        }
      });

      searchAllSources(false);
    }

    // ===================== 背景粒子 & 水波纹 =====================

    function setupParticles(){
      const canvas=$('bg-canvas');const ctx=canvas.getContext('2d');
      function resize(){
        const dpr=window.devicePixelRatio||1;
        canvas.width=window.innerWidth*dpr;
        canvas.height=window.innerHeight*dpr;
        ctx.setTransform(dpr,0,0,dpr,0,0);
      }
      resize();window.addEventListener('resize',resize);
      const parts=[];
      const N=90;
      for(let i=0;i<N;i++){
        parts.push({
          x:Math.random()*window.innerWidth,
          y:Math.random()*window.innerHeight,
          vx:(Math.random()-0.5)*0.4,
          vy:(Math.random()-0.5)*0.4,
          r:1+Math.random()*2.5,
          baseR:1+Math.random()*2.5,
          hue:200+Math.random()*120,
          a:0.22+Math.random()*0.3
        });
      }
      let mouse={x:window.innerWidth/2,y:window.innerHeight/2};
      window.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
      function tick(){
        ctx.clearRect(0,0,window.innerWidth,window.innerHeight);
        const pulse = 1 + audioLevel * 2.2;
        for(const p of parts){
          p.x+=p.vx; p.y+=p.vy; p.hue+=0.08;
          if(p.x<-40)p.x=window.innerWidth+40;
          if(p.x>window.innerWidth+40)p.x=-40;
          if(p.y<-40)p.y=window.innerHeight+40;
          if(p.y>window.innerHeight+40)p.y=-40;
          const dx=p.x-mouse.x,dy=p.y-mouse.y;
          const dist=Math.sqrt(dx*dx+dy*dy);
          const push=Math.max(0,140-dist)/140;
          p.x+=dx*0.011*push; p.y+=dy*0.011*push;
          ctx.beginPath();
          ctx.arc(p.x,p.y,p.baseR*pulse,0,Math.PI*2);
          const light = Math.min(80, 60 + audioLevel*40);
          ctx.fillStyle=`hsla(${p.hue},70%,${light}%,${p.a})`;
          ctx.fill();
        }
        ctx.lineWidth=0.45;
        for(let i=0;i<parts.length;i++){
          for(let j=i+1;j<parts.length;j++){
            const a=parts[i],b=parts[j];
            const dx=a.x-b.x,dy=a.y-b.y;
            const d=Math.sqrt(dx*dx+dy*dy);
            if(d<100){
              const al=0.10*(1-d/100)*(0.6+audioLevel*1.5);
              ctx.beginPath();
              ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
              ctx.strokeStyle=`rgba(120,160,255,${al})`;
              ctx.stroke();
            }
          }
        }
        requestAnimationFrame(tick);
      }
      tick();
    }

    function setupRipple(){
      document.addEventListener('pointerdown',e=>{
        const target=e.target.closest('., .btn, .track-item, .search-mini-item');
        if(!target)return;
        const rect=target.getBoundingClientRect();
        const x=e.clientX-rect.left, y=e.clientY-rect.top;
        const max=Math.max(rect.width,rect.height);

        const outer=document.createElement('span');
        outer.className='ripple-circle';
        outer.style.left=x+'px'; outer.style.top=y+'px';
        outer.style.width=outer.style.height=(max*2)+'px';

        const inner=document.createElement('span');
        inner.className='ripple-circle-inner';
        inner.style.left=x+'px'; inner.style.top=y+'px';
        inner.style.width=inner.style.height=(max*1.4)+'px';

        target.appendChild(outer);
        target.appendChild(inner);
        setTimeout(()=>outer.remove(),800);
        setTimeout(()=>inner.remove(),800);
      });
    }

    // ===================== DOM / 事件绑定 =====================

    function setupDOM(){
      dom.searchInput=$('search-input');
      dom.searchBtn=$('search-btn');
      dom.limitSelect=$('limit-select');
      dom.loadMoreBtn=$('load-more-btn');
      dom.searchStatus=$('search-status');
      dom.searchCount=$('search-count');
      dom.searchMiniList=$('search-mini-list');

      dom.coverImg=$('cover-img');
      dom.coverPlaceholder=document.querySelector('.cover-placeholder');
      dom.trackTitle=$('track-title');
      dom.trackArtist=$('track-artist');
      dom.trackSourcePill=$('track-source-pill');
      dom.trackQualityPill=$('track-quality-pill');
      dom.playerStatus=$('player-status');
      dom.playBtn=$('play-btn');
      dom.prevBtn=$('prev-btn');
      dom.nextBtn=$('next-btn');
      dom.favBtn=$('fav-btn');
      dom.downloadBtn=$('download-btn');
      dom.audio=$('audio');
      dom.currentTime=$('current-time');
      dom.totalTime=$('total-time');
      dom.progressWrapper=$('progress-bar-wrapper');
      dom.progressBar=$('progress-bar');
      dom.volumeSlider=$('volume-slider');

      // 全屏歌词系统引用
      dom.lyricsOverlay = $('lyrics-overlay');
      dom.lyricsOverlayBg = $('lyrics-overlay-bg');
      dom.lyricsOverlayScroll = $('lyrics-overlay-scroll');
      dom.lyricsOverlayInner = $('lyrics-overlay-inner');
      dom.overlayTitle = $('overlay-title');
      dom.overlayArtist = $('overlay-artist');
      dom.closeLyricsBtn = $('close-lyrics-btn');
      
      // 向下兼容
      dom.lyricsInner = dom.lyricsOverlayInner;
      dom.lyricsContainer = dom.lyricsOverlayScroll;

      dom.playlistMain=document.querySelector('.playlist-main');
      dom.playlistList=$('playlist-list');
      dom.playlistInfo=$('playlist-info');
      dom.playlistSelectRow=$('playlist-select-row');
      dom.playlistSelect=$('playlist-select');
      dom.newPlaylistBtn=$('new-playlist-btn');
      dom.addCurrentBtn=$('add-current-btn');

      dom.playlistModal=$('playlist-modal');
      dom.playlistNameInput=$('playlist-name-input');
      dom.playlistConfirmBtn=$('playlist-confirm-btn');
      dom.playlistCancelBtn=$('playlist-cancel-btn');
      dom.playlistCloseBtn=$('playlist-close');

      dom.shortcutToggleBtn=$('shortcut-toggle-btn');
      dom.shortcutModal=$('shortcut-modal');
      dom.shortcutCloseBtn=$('shortcut-close');
      
      dom.toggleLyricsBtn=$('toggle-lyrics-btn');
      
      // 下载进度 UI
      dom.downloadProgressContainer = $('download-progress-container');
      dom.downloadBar = $('download-bar');
      dom.downloadPercent = $('download-percent');

      // 全屏歌词 DOM
      dom.lyricsOverlay = $('lyrics-overlay');
      dom.lyricsOverlayBg = $('lyrics-overlay-bg');
      dom.lyricsOverlayScroll = $('lyrics-overlay-scroll');
      dom.lyricsOverlayInner = $('lyrics-overlay-inner');
      dom.overlayTitle = $('overlay-title');
      dom.overlayArtist = $('overlay-artist');
      dom.closeLyricsBtn = $('close-lyrics-btn');
    }

    function setPlaymodeUI(){
      document.querySelectorAll('.playmode-btn').forEach(btn=>{
        btn.classList.toggle('active',btn.dataset.mode===state.playMode);
      });
    }

    function setupEvents(){
      document.querySelectorAll('.lang-btn').forEach(btn=>{
        btn.addEventListener('click',()=>setLanguage(btn.dataset.lang));
      });

      dom.searchBtn.addEventListener('click',()=>{
        state.searchKeyword=dom.searchInput.value.trim(); state.noMoreResults=false;
        searchAllSources(true);
      });
      dom.searchInput.addEventListener('keydown',e=>{
        if(e.key==='Enter'){
          state.searchKeyword=dom.searchInput.value.trim();
          state.noMoreResults=false;
          searchAllSources(true);
        }
      });

      document.querySelectorAll('.source-chip input').forEach(cb=>{
        cb.addEventListener('change',()=>{state.enabledSources[cb.dataset.source]=cb.checked;});
      });

      dom.limitSelect.addEventListener('change',()=>{
        state.perSourceLimit=parseInt(dom.limitSelect.value,10)||10;
      });

      dom.loadMoreBtn.addEventListener('click',()=>{
        const enabled=Object.keys(state.enabledSources).filter(k=>state.enabledSources[k]);
        if(!enabled.length){showToast(t('searchStatusNoSource'));return;}

        enabled.forEach(s=>{
          if(s==='netease'){
            state.perSourcePage.netease = (state.perSourcePage.netease || 1) + 1;
          }else{
            state.perSourceCurrentLimit[s]=(state.perSourceCurrentLimit[s]||state.perSourceLimit)+state.perSourceLimit;
          }
        });

        state.noMoreResults=false;
        searchAllSources(false);
      });

      dom.searchMiniList.addEventListener('scroll',()=>{
        if(!canAutoLoadMore())return;
        if(dom.searchMiniList.scrollTop + dom.searchMiniList.clientHeight >= dom.searchMiniList.scrollHeight-10){
          requestMoreResults();
        }
      });

      dom.playlistMain.addEventListener('scroll',()=>{
        const activeTab=document.querySelector('.playlist-tab.active')?.dataset.tab||'results';
        if(activeTab!=='results')return;
        if(!canAutoLoadMore())return;
        if(dom.playlistMain.scrollTop + dom.playlistMain.clientHeight >= dom.playlistMain.scrollHeight-10){
          requestMoreResults();
        }
      });

      dom.playBtn.addEventListener('click',togglePlayPause);
      dom.prevBtn.addEventListener('click',()=>playNext('prev'));
      dom.nextBtn.addEventListener('click',()=>playNext('next'));
      dom.favBtn.addEventListener('click',toggleFavoriteCurrent);
      dom.downloadBtn.addEventListener('click',handleDownloadCurrent);
      dom.toggleLyricsBtn.addEventListener('click',toggleLyrics);
      dom.closeLyricsBtn.addEventListener('click',toggleLyrics);
      // 初始化按钮激活状态：根据歌词层是否显示
      dom.toggleLyricsBtn.classList.toggle('btn-active', dom.lyricsOverlay.classList.contains('show'));

      dom.volumeSlider.addEventListener('input',()=>{
        dom.audio.volume=parseFloat(dom.volumeSlider.value);
      });

      dom.audio.addEventListener('timeupdate',()=>{
        const cur=dom.audio.currentTime||0, dur=dom.audio.duration||0;
        dom.currentTime.textContent=formatTime(cur);
        dom.totalTime.textContent=formatTime(dur||0);
        if(dur>0){
          const r=cur/dur;
          dom.progressBar.style.width=(r*100)+'%';
        }
        const intensity = Math.abs(Math.sin(cur * 2.3));
        audioLevel = 0.3 + 0.7 * intensity * (dom.audio.volume || 1);
        updateLyricsHighlight(cur);
      });
      dom.audio.addEventListener('play',()=>{
        state.isPlaying=true;
        dom.playBtn.textContent='⏸';
        dom.playerStatus.textContent=t('playerStatusPlaying');
      });
      dom.audio.addEventListener('pause',()=>{
        state.isPlaying=false;
        dom.playBtn.textContent='▶';
        dom.playerStatus.textContent=t('playerStatusPaused');
        audioLevel = 0;
      });
      dom.audio.addEventListener('ended',()=>{
        audioLevel = 0;
        playNext('next');
      });

      dom.progressWrapper.addEventListener('click',e=>{
        const rect=dom.progressWrapper.getBoundingClientRect();
        const r=(e.clientX-rect.left)/rect.width;
        const dur=dom.audio.duration||0;
        dom.audio.currentTime=Math.max(0,Math.min(dur,dur*r));
      });

      document.querySelectorAll('.playlist-tab').forEach(tab=>{
        tab.addEventListener('click',()=>{
          document.querySelectorAll('.playlist-tab').forEach(el=>el.classList.toggle('active',el===tab));
          const tName=tab.dataset.tab;
          if(tName==='results'){
            state.playContext.type='results';state.playContext.playlistId=null;
          }else if(tName==='favorites'){
            state.playContext.type='favorites';state.playContext.playlistId=null;
          }else{
            state.playContext.type='playlist';
            if(state.playlists.length&&!state.playContext.playlistId)state.playContext.playlistId=state.playlists[0].id;
          }
          renderPlaylistList();
          const list=getActiveList();
          if(!state.currentTrack && list.length) playFromList(state.playContext.type,0,state.playContext.playlistId);
        });
      });

      dom.newPlaylistBtn.addEventListener('click',openPlaylistModal);
      dom.playlistConfirmBtn.addEventListener('click',createPlaylist);
      dom.playlistCancelBtn.addEventListener('click',closePlaylistModal);
      dom.playlistCloseBtn.addEventListener('click',closePlaylistModal);
      dom.playlistModal.addEventListener('click',e=>{if(e.target===dom.playlistModal)closePlaylistModal();});
      dom.playlistSelect.addEventListener('change',()=>{
        state.playContext.playlistId=dom.playlistSelect.value;
        renderPlaylistList();
      });
      dom.addCurrentBtn.addEventListener('click',addCurrentToPlaylist);

      dom.shortcutToggleBtn.addEventListener('click',()=>{dom.shortcutModal.classList.add('show');});
      dom.shortcutCloseBtn.addEventListener('click',()=>{dom.shortcutModal.classList.remove('show');});
      dom.shortcutModal.addEventListener('click',e=>{if(e.target===dom.shortcutModal)dom.shortcutModal.classList.remove('show');});

      document.querySelectorAll('.playmode-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          state.playMode=btn.dataset.mode;
          setPlaymodeUI();
          if(state.playMode==='list')showToast(t('toastPlaymodeList'));
          else if(state.playMode==='single')showToast(t('toastPlaymodeSingle'));
          else showToast(t('toastPlaymodeShuffle'));
        });
      });

      document.addEventListener('keydown',e=>{
        const tag=document.activeElement.tagName.toLowerCase();
        const typing=(tag==='input'||tag==='textarea');
        const playlistOpen=dom.playlistModal.classList.contains('show');
        const shortcutOpen=dom.shortcutModal.classList.contains('show');

        if(e.key==='Escape'){
          if(playlistOpen)closePlaylistModal();
          if(shortcutOpen)dom.shortcutModal.classList.remove('show');
          return;
        }

        if(playlistOpen || shortcutOpen){
          return;
        }

        if(e.code==='Space'&&!typing){e.preventDefault();togglePlayPause();}
        if(e.key==='ArrowRight'&&!typing){dom.audio.currentTime=(dom.audio.currentTime||0)+5;}
        if(e.key==='ArrowLeft'&&!typing){dom.audio.currentTime=Math.max(0,(dom.audio.currentTime||0)-5);}
        if(e.key==='ArrowUp'&&!typing){dom.audio.volume=Math.min(1,(dom.audio.volume||0)+0.05);dom.volumeSlider.value=dom.audio.volume;}
        if(e.key==='ArrowDown'&&!typing){dom.audio.volume=Math.max(0,(dom.audio.volume||0)-0.05);dom.volumeSlider.value=dom.audio.volume;}
        if((e.key==='n'||e.key==='N')&&!typing)playNext('next');
        if((e.key==='p'||e.key==='P')&&!typing)playNext('prev');
        if((e.key==='f'||e.key==='F')&&!typing)toggleFavoriteCurrent();
        if((e.key==='m'||e.key==='M')&&!typing){
          state.muted=!state.muted;
          dom.audio.muted=state.muted;
        }
        if(e.key==='/'&&!typing){e.preventDefault();dom.searchInput.focus();dom.searchInput.select();}
      });

      // Tab 点击事件
      document.querySelectorAll('.tab-item').forEach(item => {
        item.addEventListener('click', () => {
          switchTab(item.dataset.tab);
        });
      });

      // 回到顶部按钮控制
      const btt = $('back-to-top-btn');
      btt.addEventListener('click', () => {
        const activePanel = document.querySelector('.panel.active');
        const scrollTarget = activePanel.querySelector('.search-results-mini') || 
                             activePanel.querySelector('.playlist-list') || 
                             activePanel;
        scrollTarget.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const handleScroll = (e) => {
        if(e.target.scrollTop > 300) btt.classList.add('show');
        else btt.classList.remove('show');
      };

      dom.searchMiniList.addEventListener('scroll', handleScroll);
      dom.playlistList.addEventListener('scroll', handleScroll);
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tabName);
      });
      document.querySelectorAll('.panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'panel-' + tabName);
        // 切换到 player 时，确保面板从顶部开始显示，防止跳转到下方歌词区
        if (panel.id === 'panel-player') {
          panel.scrollTop = 0;
        }
      });
      // 切换 Tab 时重置回到顶部按钮状态，直到用户在新页面滚动
      const btt = $('back-to-top-btn');
      if(btt) btt.classList.remove('show'); 
    }

    function toggleLyrics() {
      const active = dom.lyricsOverlay.classList.toggle('show');
      dom.toggleLyricsBtn.classList.toggle('btn-active', active);
      
      if(active) {
        document.body.style.overflow = 'hidden';
        // 开启时立即重置滚动位置到当前高亮句
        const cur = dom.audio.currentTime;
        state.currentLyricIndex = -1; // 强制重新计算高亮及滚动
        updateLyricsHighlight(cur);
      } else {
        document.body.style.overflow = '';
      }
      
      showToast(active ? '开启沉浸式歌词' : '已关闭歌词');
    }

    // ===================== 主题切换 =====================

    function setupTheme(){
      const saved = (() => { try{ return localStorage.getItem('pikachu-theme'); }catch(e){ return null; } })();
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved ? saved === 'dark' : prefersDark;
      applyTheme(isDark);

      const btn = document.getElementById('theme-toggle-btn');
      if(btn) btn.addEventListener('click', () => {
        const nowDark = document.body.classList.contains('dark-mode');
        applyTheme(!nowDark);
        try{ localStorage.setItem('pikachu-theme', !nowDark ? 'dark' : 'light'); }catch(e){}
      });
    }

    function applyTheme(isDark){
      document.body.classList.toggle('dark-mode', isDark);
      const btn = document.getElementById('theme-toggle-btn');
      if(btn) btn.textContent = isDark ? '☀️' : '🌙';
      if(btn) btn.title = isDark ? '切换到日间模式' : '切换到夜间模式';
    }

    // ===================== 初始化 =====================

    function init(){
      setupDOM();
      setupTheme();
      setupEvents();
      setLanguage(state.language);
      setPlaymodeUI();
      dom.audio.volume=parseFloat(dom.volumeSlider.value);

      // ZTools 生命周期钩子集成
      if (typeof window.ztools !== 'undefined') {
        window.ztools.onPluginEnter(({code, type, payload}) => {
          console.log('ZTools Plugin Enter:', code, payload);
          // 如果是从快捷指令进入，且带有关键词
          if (payload && (code === 'music_search' || type === 'regex')) {
            const keyword = typeof payload === 'string' ? payload : (payload.match ? payload.match[1] : '');
            if (keyword) {
              dom.searchInput.value = keyword;
              handleSearch();
            }
          }
        });
      }

      // 全局 Esc 关闭歌词
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.lyricsOverlay.classList.contains('active')) {
          toggleLyrics();
        }
      });
    }

    document.addEventListener('DOMContentLoaded',init);
  })();