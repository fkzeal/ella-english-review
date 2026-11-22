/* Content lives in question-bank.json; learner data is independent of content updates. */
(function(){
  'use strict';
  const E=window.ReviewEngine,R=window.CatRewards,catalog=window.CAT_CATALOG;
  const catPreview=['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('preview')==='cats';
  const storageKey=key=>catPreview?key+'-cat-preview':key,STORE=storageKey(window.ReviewStorage.KEY);
  const store=window.ReviewStorage.create({getItem:key=>localStorage.getItem(storageKey(key)),setItem:(key,value)=>localStorage.setItem(storageKey(key),value)},E,navigator.locks,window.indexedDB);
  const cloud=window.AccountSync.create({storage:localStorage,crypto:window.crypto,fetch:(...args)=>fetch(...args),
    enabled:location.hostname==='ella-english-review.pages.dev'&&location.protocol==='https:'&&!catPreview,
    getBundle:()=>({bank,state,baseline}),
    applyBundle:async bundle=>{
      if(JSON.stringify(bundle.state)===JSON.stringify(state)&&JSON.stringify(bundle.bank)===JSON.stringify(bank)&&(bundle.baseline||baseline)===baseline)return;
      const moved=state.session?.rewardId!==bundle.state.session?.rewardId||state.session?.index!==bundle.state.session?.index;
      await commit(bundle.state,bundle.bank,bundle.baseline||baseline,{cloudWrite:true});
      if(moved&&viewKind==='quiz'){feedback=null;selected=null;render();toast('练习进度已同步，点击继续练习。');}
      else if(viewKind==='page')render();
    },
    onChange:()=>{updateAccountStatus();}});
  let baseline=JSON.stringify(window.LESSON_BANK),pendingBank=null,starting=false;
  const app=document.getElementById('app');
  const moduleNames={lv:'听力与词汇',rg:'阅读与语法',skills:'Skills 综合技能',reading:'绘本阅读',vocabulary:'词汇积累'};
  const typeNames={choice:'词汇选择',cloze:'选词填空',listening:'听力选择',reading:'阅读理解'};
  let bank=E.validateBank(window.LESSON_BANK), state=E.emptyState(),page='today',level=2,system='raz';
  let selected=null,help=false,feedback=null,showTranscript=false,storageAvailable=true;
  let toastTimer=null,viewRevision=0,viewKind='page',renderedDay=null,audioManifest=window.LESSON_AUDIO||{clips:{}};
  let catFilter='all',catCategory='all',viewerId=null,syncTimer=null,navigationEpoch=0;
  const animatedRewards=new Set();
  const uid=()=>window.crypto?.randomUUID?.()||`reward-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listening=window.ReviewAudio.create(window,audioManifest);
  function setApp(html,kind='page'){viewRevision++;viewKind=kind;renderedDay=E.day();app.innerHTML=html;}
  async function prepareAudio(nextBank){
    try{return window.ReviewAudio.validateManifest(audioManifest,nextBank);}catch(err){
      if(!/^https?:$/.test(location.protocol))throw Object.assign(new Error(err.message),{name:'AudioSyncError'});
    }
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const res=await fetch(new URL('audio-manifest.json',location.href),{cache:'no-store',signal:controller.signal});
      if(!res.ok)throw new Error('听力音频尚未同步，请稍后重试题库更新。');
      return window.ReviewAudio.validateManifest(await res.json(),nextBank);
    }catch(err){
      throw Object.assign(new Error('听力音频尚未同步，请稍后重试题库更新。'),{name:'AudioSyncError'});
    }finally{clearTimeout(timeout);}
  }
  function adoptAudio(manifest){
    if(manifest===audioManifest)return;
    listening.updateManifest(manifest);audioManifest=manifest;window.LESSON_AUDIO=manifest;
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message){document.getElementById('toast').textContent=message;document.getElementById('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>document.getElementById('toast').classList.remove('show'),4000);}
  function adopt(saved){
    if(saved){bank=saved.bank;state=saved.state;baseline=saved.baseline;}
    else {state=E.emptyState();bank=E.validateBank(window.LESSON_BANK);baseline=JSON.stringify(bank);}
    selected=null;help=false;feedback=null;showTranscript=false;stopAudio();
  }
  async function commit(next,nextBank=bank,nextBaseline=baseline,options={}) {
    if(!options.cloudWrite&&cloud.view().enabled&&state.accountId&&state.accountId!==cloud.view().account?.id)throw new Error('请重新绑定记录所属账号后继续。');
    const manifest=nextBank===bank?audioManifest:await prepareAudio(nextBank);
    try{await store.write({bank:nextBank,state:next,baseline:nextBaseline},options);}
    catch(err){
      storageAvailable=false;
      if(err.name==='ConflictError'){adopt(store.read());storageAvailable=true;render();}
      throw err;
    }
    bank=nextBank;state=next;baseline=nextBaseline;storageAvailable=true;adoptAudio(manifest);
    if(!options.cloudWrite){cloud.markDirty();updateAccountStatus();}
    if(!options.cloudWrite&&(viewKind==='page'||!next.session||next.session.index===next.session.items.length))scheduleSync();
  }
  function scheduleSync(){
    if(!cloud.view().account)return;
    clearTimeout(syncTimer);syncTimer=setTimeout(()=>run(()=>cloud.sync()),1000);
  }
  function updateAccountStatus(){
    const el=document.getElementById('account-status');if(!el)return;
    const c=cloud.view();
    el.textContent=c.account?`${c.account.name} · ${c.busy?'正在同步':c.error||c.dirty?'本机已保存，待同步':c.syncedAt?'云端已同步':'等待同步'}`:'绑定账号，带走学习进度';
    const hello=document.querySelector('.cat-hello'),album=document.querySelector('.album-tag');
    if(hello&&c.account)hello.innerHTML=`Hi, ${esc(c.account.name)}! <span aria-hidden="true">♡</span>`;
    if(album&&c.account)album.textContent=c.account.name+' 的收藏';
    const card=document.getElementById('account-card');
    if(card&&page==='library'&&viewKind==='page')card.innerHTML=cloudPanel();
  }
  function showAccountDialog(){
    const c=cloud.view(),d=document.getElementById('account-dialog');
    d.innerHTML=`<div class="eyebrow">MY LITTLE HOME</div><h2 id="account-title">${c.account?'切换云端账号':'给这台设备选一个账号'}</h2><p>复习日程、练习记录和猫咪收藏，会跟着账号一起走。</p>
      <form id="account-form"><div class="field"><label for="account-choice">使用者</label><select id="account-choice">${window.AccountSync.ACCOUNTS.map(([id,name])=>`<option value="${id}" ${c.account?.id===id?'selected':''}>${name}</option>`).join('')}</select></div>
      <p id="account-mode" class="note" aria-live="polite">正在确认账号状态…</p>
      <div class="field"><label id="account-password-label" for="account-code">登录密码</label><input id="account-code" type="password" autocomplete="current-password" maxlength="128" required aria-describedby="account-mode"></div>
      <div id="account-confirm-field" class="field" hidden><label for="account-confirm">确认密码</label><input id="account-confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="再输入一次刚设置的密码"></div>
      ${!state.accountId?'<label class="check"><input id="account-import" type="checkbox" checked> 将本机已有进度迁移到这个账号</label>':'<p class="note">切换前自动保存当前账号。不同账号的进度各自保留。</p>'}
      <p id="account-error" class="note" role="alert"></p><button type="button" id="account-retry" class="link-button" hidden>重新获取账号状态</button>
      <div class="actions"><button type="button" class="button secondary" id="account-later">稍后</button><button type="submit" class="button" disabled>绑定并同步</button></div></form>`;
    const form=d.querySelector('form'),choice=d.querySelector('#account-choice'),input=d.querySelector('#account-code');
    const confirm=d.querySelector('#account-confirm'),button=d.querySelector('[type="submit"]'),error=d.querySelector('#account-error');
    const hint=d.querySelector('#account-mode'),retry=d.querySelector('#account-retry');
    let accounts=[],needsSetup=null;
    function updateMode(){
      const account=accounts.find(a=>a.id===choice.value);
      needsSetup=account?account.needsSetup:null;
      d.querySelector('#account-confirm-field').hidden=needsSetup!==true;
      confirm.required=needsSetup===true;
      input.autocomplete=needsSetup?'new-password':'current-password';
      d.querySelector('#account-password-label').textContent=needsSetup?'设置登录密码':'登录密码';
      input.placeholder=needsSetup?'设置以后绑定这个账号要用的密码':'输入这个账号已有的密码';
      hint.textContent=needsSetup===null?'暂时无法确认账号状态，请联网重试。':needsSetup?
        '这个账号还没有绑定过设备。请设置密码，之后其他设备绑定也用这个密码。':
        '这个账号已设置密码。请输入同一个密码，绑定后无需每次输入。';
      button.textContent=needsSetup?'设置密码并绑定':'验证密码并绑定';
      button.disabled=needsSetup===null;
    }
    async function loadStatus(){
      button.disabled=true;retry.hidden=true;
      try{
        const result=await cloud.accountStatus();
        if(d.querySelector('form')!==form)return;
        accounts=result.accounts;updateMode();
      }catch(err){
        if(d.querySelector('form')!==form)return;
        accounts=[];updateMode();error.textContent=err.message;retry.hidden=false;
      }
    }
    choice.onchange=()=>{input.value='';confirm.value='';error.textContent='';updateMode();};
    retry.onclick=()=>{error.textContent='';loadStatus();};
    document.getElementById('account-later').onclick=()=>d.close();
    form.onsubmit=e=>{
      e.preventDefault();
      if(needsSetup===null||button.disabled)return;
      const id=choice.value,code=input.value.trim(),initialize=needsSetup,importLocal=d.querySelector('#account-import')?.checked??false;
      if(!code){error.textContent='请输入密码。';return;}
      if(initialize&&code!==confirm.value.trim()){error.textContent='两次输入的密码不一致，请重新确认。';return;}
      button.disabled=true;choice.disabled=true;error.textContent='';
      run(async()=>{
        try{
          const old=cloud.view().account;
          if(old&&old.id!==id&&!await cloud.sync())throw new Error('当前账号尚未同步成功，请联网后再切换。');
          await cloud.login(id,code,{importLocal,initialize});d.close();feedback=null;selected=null;render();toast('账号已绑定，学习进度已同步。');
        }catch(err){error.textContent=err.message;await loadStatus();}
        finally{button.disabled=needsSetup===null;choice.disabled=false;}
      });
    };
    d.showModal();
    loadStatus();
  }
  function clone(){return JSON.parse(JSON.stringify(state));}
  function lessonLabel(l){
    return l.system==='raz'?`RAZ ${l.level} · ${esc(l.title)}`:l.system==='ket'?`KET 词汇 · ${esc(l.title)}`:`Level ${l.level} · Lesson ${l.number} · ${esc(l.title)}`;
  }
  function starterLesson(){return bank.lessons.find(l=>l.status==='ready'&&!(bank.batches||[]).some(b=>b.items.some(i=>i.lessonId===l.id)));}
  async function syncLearning(){const next=clone();E.syncBatches(bank,next);const changed=JSON.stringify(next)!==JSON.stringify(state);if(changed)await commit(next);return changed;}
  async function refreshBank(repaint=true){
    const revision=viewRevision;
    if(pendingBank&&(!state.session||state.session.index>=state.session.items.length)){
      try{
        const incoming=pendingBank,merged=E.mergeBank(bank,incoming),next=clone();E.syncBatches(merged,next);
        await commit(next,merged,JSON.stringify(incoming));pendingBank=null;
        if(repaint&&revision===viewRevision)render();
      }catch(err){toast(err.message||'题库暂未同步，继续使用已保存的内容。');return;}
    }
    if(!/^https?:$/.test(location.protocol))return;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const res=await fetch(new URL('question-bank.json',location.href),{cache:'no-store',signal:controller.signal});
      if(!res.ok)throw new Error('题库连接未成功');
      const incoming=E.validateBank(await res.json());
      if(JSON.stringify(incoming)===baseline&&(bank.revision||0)>=(incoming.revision||0))return;
      if(state.session&&state.session.index<state.session.items.length){pendingBank=incoming;return;}
      const merged=E.mergeBank(bank,incoming),next=clone();
      E.validateState(next,merged);E.syncBatches(merged,next);
      const newBaseline=JSON.stringify(incoming);
      await commit(next,merged,newBaseline);pendingBank=null;
      if(repaint&&revision===viewRevision)render();toast('最新题库已同步，答题记录保留。');
    }catch(err){toast('在线题库暂未同步，继续使用已保存的内容。');}
    finally{clearTimeout(timeout);}
  }
  function stopAudio(){listening.stop();}
  function dateLabel(d){return new Date(d+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric'});}
  function head(label,title,description){
    return `<div class="page-head"><div><div class="eyebrow">${label}</div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="date-pill">${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</div></div>`;
  }
  const kittens=[
    {coat:'ginger',art:'assets/kittens/ginger.webp',name:'小橘猫',phrase:'喵～这题答对啦！给你一只小爪爪。'},
    {coat:'tuxedo',art:'assets/kittens/tuxedo.webp',name:'奶牛猫',phrase:'认真思考的你，超棒的！'},
    {coat:'calico',art:'assets/kittens/calico.webp',name:'三花猫',phrase:'好棒，我们又学会一点点！'},
    {coat:'gray',art:'assets/kittens/gray.webp',name:'小灰猫',phrase:'送你一颗小星星，继续加油呀！'},
    {coat:'siamese',art:'assets/kittens/siamese.webp',name:'暹罗猫',phrase:'找到答案啦！和我击个掌吧。'},
    {coat:'cream',art:'assets/kittens/cream.webp',name:'奶油猫',phrase:'为你的这个小进步，拍拍爪！'}
  ];
  function snowCat(className='',kitten=kittens[0]){
    return `<span class="snow-cat illustrated-kitten kitten-${kitten.coat} ${className}" aria-hidden="true"><img class="kitten-art" src="${kitten.art}" width="600" height="600" alt="" draggable="false"></span>`;
  }
  function encouragement(result,index){
    const wins=state.history.filter(r=>r.correct).length;
    const cat=catalog[Math.max(0,wins-1)%catalog.length];
    const kitten={...cat,coat:cat.id,phrase:['认真思考的你，超棒的！','好棒，我们又学会一点点！','找到答案啦！和我击个掌吧。'][wins%3]};
    return `<div class="cat-cheer" data-kitten="${kitten.coat}">${snowCat('cheer-cat',kitten)}<div><span class="cheer-label">${kitten.name}来给你加油啦</span><strong>${result.help?'我们一起找到答案啦！':kitten.phrase}</strong><span>${result.help?'下次试着自己想一想，慢慢来。':'把这个小发现，放进口袋里。'}</span></div><div class="snow-confetti" aria-hidden="true">${Array.from({length:16},(_,i)=>`<i style="--i:${i};--x:${(i*29)%100}%;--spin:${i%2?180:-210}deg">${i%3?'✦':'♥'}</i>`).join('')}</div></div>`;
  }
  function layoutWarning(){return (catPreview?'<div class="cat-preview-tools"><div><strong>动画试玩</strong><span>使用独立的演示进度</span></div><div><button data-action="preview-full">全对结算 +1星</button><button data-action="preview-half">答对8/10 +半星</button><button data-action="preview-low">答对7/10 无星星</button><button data-action="preview-ready">攒满三颗星</button></div><a href="./">进入正常练习 ↗</a></div>':'')+(!storageAvailable?'<div class="banner warning">记录未能保存，已保护原始数据。请到「家长题库」导出原始记录或恢复有效备份，再继续练习。</div>':'');}
  function navigate(p){navigationEpoch++;stopAudio();page=p;selected=null;help=false;feedback=null;showTranscript=false;render();window.scrollTo({top:0,behavior:'instant'});}
  function setNav(){
    const parent=!['today','collection'].includes(page);
    document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.hasAttribute('data-parent-entry')?parent:el.dataset.page===page));
    document.getElementById('parent-nav').classList.toggle('hidden',!parent);
  }
  function render(){setNav();setApp(layoutWarning()+(cloud.view().enabled?'<div class="account-strip"><button class="link-button" data-action="account" id="account-status"></button></div>':'')+({today:todayView,collection:collectionView,courses:courseView,progress:progressView,library:libraryView}[page]||todayView)());updateAccountStatus();}
  function todayView(){
    const unfinished=state.session&&state.session.index<state.session.items.length;
    const today=E.day(),active=E.activePoints(bank,state,today),due=E.duePoints(bank,state,today),units=E.dueUnits(bank,state,today);
    const availability=E.reviewAvailability(bank,state,today);
    const canContinue=active.length&&E.plan(bank,state,{today,flexible:true}).length>0;
    const points=due.length?due:active;
    const starter=starterLesson();
    const registered=Object.keys(state.batchReceipts||{}).length;
    const lessons=points.length?bank.lessons.filter(l=>points.some(p=>p.lessonId===l.id)):!registered&&starter?[starter]:[];
    const nextDue=active.map(p=>state.points[p.id]?.due).filter(Boolean).sort()[0];
    const lessonByPoint=new Map(bank.points.map(p=>[p.id,p.lessonId])),counts=new Map();
    const reasons={first:0,weak:0,interval:0};
    for(const q of units){
      const id=lessonByPoint.get(q.pointId),record=q.reviewUnit?state.units?.[E.unitKey(q)]:state.points[q.pointId];
      counts.set(id,(counts.get(id)||0)+1);
      reasons[!record?.lastDay?'first':record.missDay===record.lastDay?'weak':'interval']++;
    }
    return `<div class="home-heading">${head('LITTLE PAWS, HAPPY LEARNING',esc(cloud.view().account?.name||'Ella')+'，欢迎来到猫咪小屋。','小猫咪们已经准备好啦。今天也一起收获一个小进步吧！')}</div>`+
      `<div class="student-home"><div class="student-dashboard"><section class="hero home-welcome" aria-label="小猫欢迎与开始练习"><div class="hero-copy"><div class="winter-badge">♡ 猫咪陪伴的英语时光</div><h2>每天一点点，<br>和小猫一起学。</h2><p>慢慢想，大胆试。<br>今天也和小猫击个掌吧！</p></div><div class="winter-scene"><span class="scene-spark spark-one" aria-hidden="true">✧</span><span class="scene-spark spark-two" aria-hidden="true">♡</span><div class="cat-orbit">${snowCat()}</div><div class="cat-hello">Hi, Ella! <span aria-hidden="true">♡</span></div><div class="kitten-friends" aria-label="还有奶牛猫和三花猫陪你练习">${snowCat('friend-cat',kittens[1])}${snowCat('friend-cat',kittens[2])}</div></div><div class="welcome-actions">${unfinished?`<p class="resume-note">上次已完成 ${state.session.index} / ${state.session.items.length} 题，接着来吧。</p>`:`<div class="hero-meta"><span>🐾 每组 ${state.settings.size} 题以内</span><span>♡ 不计时，慢慢想</span></div>`}<div class="actions"><button class="button start-button" data-action="${unfinished?'resume':'start'}" ${!unfinished&&(!lessons.length||(registered&&!canContinue))?'disabled':''}>${unfinished?'继续上次练习':registered&&!availability.ready&&canContinue?'继续和小猫练习':'和小猫开始练习'} <span aria-hidden="true">→</span></button>${unfinished?'<button class="link-button" data-action="end">结束本组</button>':''}</div>${registered&&canContinue?'<p class="note">先复习到期内容，再提前练习之后的考点。想继续就继续，也可以随时停下。</p>':''}</div></section>${rewardView(false)}</div><div class="adventure-steps" aria-label="练习步骤"><span><b>01</b> 看一看，听一听</span><span><b>02</b> 选出你的答案</span><span><b>03</b> 小猫来为你加油 ♡</span></div>
      <div class="card due-courses"><div class="card-header"><h3>${due.length?'今天到期的课程':registered?'已学内容 · 自由练习':'体验练习'}</h3></div>${lessons.length?lessons.map(l=>`<div class="list-row"><span class="type-icon">↗</span><div class="grow"><strong>${lessonLabel(l)}</strong><small>${esc(l.subtitle)}</small></div>${units.length?`<span class="due-unit-count">待复习 ${counts.get(l.id)||0} 项</span>`:''}</div>`).join(''):'<p class="note">暂时没有可练习题目，请家长补充题库。</p>'}${registered?`<p class="note due-total">${units.length} 个考点待复习${!due.length&&nextDue?' · 下次 '+dateLabel(nextDue):''}</p><p class="note">${units.length?`每次最多 ${state.settings.size} 题，慢慢来；也可以提前练习之后的内容。`:'今天的到期复习已完成，点击主按钮就能继续练习明天和之后的考点。'}</p>${units.length?`<details class="due-explanation"><summary>为什么有这些复习？</summary><p class="note">首次回顾 ${reasons.first} 项 · 错题或提示后巩固 ${reasons.weak} 项 · 间隔复习 ${reasons.interval} 项</p><p class="note">已登记学习的内容，尚未在这里独立完成回顾，也会加入到期复习。${due.length} 个练习分组包含这些考点，组内各项分别安排；一个考点答对，不会推迟其他考点。</p>${['localhost','127.0.0.1'].includes(location.hostname)?'<p class="note">记录保存在当前浏览器中，本地预览与正式网址分别保存。</p>':''}</details>`:''}`:'<p class="note">尚未发布学习日期。可以先体验，体验不会代替正式学习登记。</p>'}</div></div>`;
  }
  function pointRow(p){const l=bank.lessons.find(l=>l.id===p.lessonId),sp=state.points[p.id];return `<div class="list-row"><span class="type-icon">↗</span><div class="grow"><strong>${esc(p.title)}</strong><small>${lessonLabel(l)}</small></div><span class="tag">${sp?.errors?'需要巩固':sp?.stage?'间隔复习':'首次回顾'}</span></div>`;}
  function moduleControls(l,ps){
    if(l.system==='raz')return bookControls(l,ps);
    return `<div class="checks">${E.MODULES.filter(m=>(l.system||'cambridge')==='cambridge'?['lv','rg','skills'].includes(m):ps.some(p=>p.module===m)).map(m=>{
      const available=ps.some(p=>p.module===m),info=available?E.moduleDate(bank,state,l.id,m):null;
      return `<div class="module-block module-inline"><strong>${moduleNames[m]}${!available?'（待补充）':''}</strong>${available?`<div class="module-date-row"><input type="date" id="date-${l.id}-${m}" data-date-lesson="${l.id}" data-date-module="${m}" aria-label="${moduleNames[m]}首次学习日期" value="${info.date}"></div>${info.date>E.day()?'<p class="note">等待学习日</p>':''}`:''}</div>`;
    }).join('')}</div>`;
  }
  function lessonModules(id){return [...new Set(bank.points.filter(p=>p.lessonId===id).map(p=>p.module))];}
  function bookControls(l,ps){
    const modules=[...new Set(ps.map(p=>p.module))];
    const infos=modules.map(m=>E.moduleDate(bank,state,l.id,m));
    const dates=[...new Set(infos.map(info=>info.date))].sort();
    return `<div class="checks"><div class="module-block"><div class="module-date-row"><label for="date-${l.id}-book">首次学习</label><input type="date" id="date-${l.id}-book" data-book-date="${l.id}" aria-label="绘本首次学习日期" value="${dates.length===1?dates[0]:''}"></div>${dates.length>1?'<p class="note">旧记录日期不同，请选择整本绘本的首次学习日期。</p>':dates[0]>E.day()?'<p class="note">等待学习日</p>':''}</div></div>`;
  }
  function courseView(){
    const bank=currentContent();
    const list=bank.lessons.filter(l=>(l.system||'cambridge')===system&&(system!=='cambridge'||l.level===level));
    return head('LEARNED, THEN REVIEWED','学过什么，系统自动记住。','调整首次学习日期，复习由系统根据答题表现自动安排。')+
      '<div class="filter-row">'+[['raz','RAZ 绘本'],['cambridge','猿辅导剑桥'],['ket','KET 词汇']].map(([id,name])=>`<button class="chip ${system===id?'active':''}" data-action="system" data-system="${id}">${name}</button>`).join('')+'</div>'+
      (system==='cambridge'?'<div class="filter-row">'+[1,2,3,4].map(n=>`<button class="chip ${n===level?'active':''}" data-action="level" data-level="${n}">Level ${n}</button>`).join('')+'</div>':'')+
      (list.length?`<div class="course-grid">${list.map(l=>{
        const ps=bank.points.filter(p=>p.lessonId===l.id),qs=bank.questions.filter(q=>ps.some(p=>p.id===q.pointId));
        const targets=l.learningTargets;
        const coverage=targets?`${targets.length} 个学习目标`:`${new Set(qs.map(E.unitKey)).size} 个练习分项`;
        return `<article class="card course ${l.status==='pending'?'pending':''}"><span class="tag">${lessonLabel(l)}</span><h3>${esc(l.title)}</h3><span class="muted">${esc(l.subtitle)}</span><p class="description">${l.status==='ready'?`${coverage} · ${qs.length} 道练习题`:'待补充课程材料，暂不加入复习。'}</p>${l.status==='ready'?moduleControls(l,ps):''}${targets?`<details><summary>本课学习目标</summary><ul>${targets.map(t=>`<li>${esc(t.title)}</li>`).join('')}</ul></details>`:''}<div class="bottom"><span>${l.status==='ready'?'已核对内容':'等待正文核对'}</span>${l.status==='ready'?`<button class="button secondary small" data-action="lesson-practice" data-id="${l.id}" ${!E.activePoints(bank,state).some(p=>p.lessonId===l.id)?'disabled':''}>复习本课 →</button>`:'<span>等待建库</span>'}</div></article>`;
      }).join('')}</div>`:`<div class="card empty"><h2>这个级别，还没有导入课程</h2><p>继续在对话中上传 Level ${level} 的目录和内容截图。<br>我会整理成题库更新包，接入同一个复习站。</p><button class="button secondary" data-action="nav" data-target="library">查看题库更新方式</button></div>`);
  }
  function progressView(){
    const ps=E.activePoints(bank,state),h=state.history;
    const independent=h.filter(x=>x.correct&&!x.help).length;
    return head('SMALL STEPS, REAL PROGRESS','看见每一次，重新记住。','选择题的熟练度仅反映这些练习，不代表综合英语等级。')+
      unitProgress(ps)+
      `<div class="stats"><div class="stat"><span class="number">${h.length}</span><span class="label">累计作答</span></div><div class="stat"><span class="number">${independent}</span><span class="label">独立答对</span></div><div class="stat"><span class="number">${ps.filter(p=>state.points[p.id]?.stage>=3).length}</span><span class="label">进入较长间隔的练习分组</span></div></div>
      <div class="card"><div class="card-header"><h2>分组复习安排</h2><span class="note">每组显示最早到期日期，组内各项分别安排</span></div>${ps.length?`<div class="table-wrap"><table><thead><tr><th>练习分组 / 课程</th><th>学习日期</th><th>最近作答</th><th>下次复习</th><th>累计出错</th></tr></thead><tbody>${ps.map(p=>{const sp=state.points[p.id],last=h.filter(x=>x.pointId===p.id).at(-1),l=bank.lessons.find(l=>l.id===p.lessonId);return `<tr><td><strong>${esc(p.title)}</strong><br><span class="muted">${lessonLabel(l)}</span></td><td>${state.learningDates?.[p.id]||'手动登记'}</td><td>${!last?'尚未复习':!last.correct?'<span class="weak-text">需要再练</span>':last.help?'借助提示完成':`<span class="success-text">独立完成</span>`}<br><span class="note">最低间隔阶段 ${sp?.stage||0} / 5</span></td><td>${sp?.due?dateLabel(sp.due):'今天'}${sp?.due<=E.day()?' · 到期':''}</td><td>${sp?.errors||0}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty">已有题库会按学习日期自动安排复习。</div>'}</div>
      <div class="card"><h2>最近的作答</h2>${h.length?h.slice(-12).reverse().map(x=>{const q=bank.questions.find(q=>q.id===x.questionId);return `<div class="list-row"><span class="type-icon">${x.correct?'✓':'↻'}</span><div class="grow"><strong>${esc(q.prompt)}</strong><small>${dateLabel(x.day)} · ${typeNames[q.type]} · ${x.correct?(x.help?'提示后答对':'独立答对'):'答错，需要巩固'}</small></div></div>`;}).join(''):'<div class="empty">完成第一组练习后，就能看到真实的作答记录。</div>'}</div>`;
  }
  function unitProgress(points){
    return `<div class="card"><h2>分项复习</h2><p class="note">学习目标可以有听、读等不同练习分项，分别记录表现；一个词答对不会推迟其他词。</p>${points.map(p=>{
      const groups=new Map();
      for(const q of E.availableQuestions(bank).filter(q=>q.pointId===p.id))if(!groups.has(E.unitKey(q)))groups.set(E.unitKey(q),q);
      return `<details><summary>${esc(p.title)} · ${groups.size} 项</summary>${[...groups].map(([key,q])=>{
        const u=state.units?.[key]||state.points[p.id];
        return `<div class="list-row"><div class="grow"><strong>${esc(q.prompt)}</strong><small>阶段 ${u?.stage||0} / 5 · 下次 ${esc(u?.due||'待安排')}</small></div></div>`;
      }).join('')}</details>`;
    }).join('')}</div>`;
  }
  function batchesView(){
    const batches=[...(bank.batches||[]),...(state.localBatches||[])].sort((a,b)=>b.learnedOn.localeCompare(a.learnedOn));
    return `<div class="card"><div class="card-header"><h2>历史学习批次</h2><span class="tag">${batches.length} 批</span></div><p class="note">内容更新 ${esc(bank.updated||'未标注')} · 首次学习日期可在课程进度中校正。</p>${batches.length?batches.map(x=>`<div class="list-row"><div class="grow"><strong>${esc(x.learnedOn)} · ${x.learnedOn>E.day()?'等待学习日':'学习记录'}</strong><small>${x.items.map(item=>{const l=bank.lessons.find(l=>l.id===item.lessonId);return lessonLabel(l)+(l.system==='raz'?'':' / '+item.modules.map(m=>moduleNames[m]).join('、'));}).join('<br>')}</small><small>${esc(x.note||'')}</small></div></div>`).join(''):'<div class="empty">已有题库按首次学习日期自动安排复习。</div>'}<p class="note">日程参考学习后 1、3、7、14、30 天；答错或提示后次日再练，逾期不会一次补齐所有节点。</p></div>`;
  }
  function libraryView(){
    const bank=currentContent();
    const ready=bank.lessons.filter(l=>l.status==='ready');
    return head('PARENT’S CORNER','题库，随着学习慢慢长大。','通过对话整理课程图片，形成考点与原创练习，再更新这里的静态内容。')+
      `<div class="banner">应用 ${esc(window.REVIEW_VERSION?.app||'开发版')} · 题库 r${esc(bank.revision||'旧版')} · 构建 ${esc(window.REVIEW_VERSION?.build||'未构建')}<br><span class="note">${esc(location.host||'本地单文件')} · 当前可用 ${bank.questions.length} 题 · 已停用 ${bank.archivedCount} 题（仅保留历史）</span></div>`+
      (!storageAvailable?'<div class="card"><h3>原始记录恢复</h3><p>异常原始数据未被覆盖。先下载留存，再恢复有效的完整备份。</p><button class="button secondary" data-action="export-recovery">导出原始记录 ↓</button></div>':'')+
      `<div class="library-grid"><section>${batchesView()}<div class="card"><div class="card-header"><h2>已建立的内容</h2><span class="tag">${bank.questions.length} 题</span></div><p class="note">原创变式题，不是官方题库。未核对正文的书不会生成文章理解题。</p>${ready.map(l=>`<h3 class="section-label">${lessonLabel(l)}</h3>${bank.points.filter(p=>p.lessonId===l.id).map(p=>`<details><summary>${esc(p.title)} <span class="note">· ${bank.questions.filter(q=>q.pointId===p.id).length} 题</span></summary><p>${esc(p.description)}</p><p><strong>考点依据：</strong>${esc(p.evidence)}</p>${bank.questions.filter(q=>q.pointId===p.id).map(q=>`<div class="question-preview"><span class="tag">${typeNames[q.type]}</span><p>${esc(q.prompt)}</p>${q.passage?'<p>'+esc(q.passage)+'</p>':''}${q.audioText?'<p>朗读稿：'+esc(q.audioText)+'</p>':''}<div>${q.options.map((o,i)=>`${String.fromCharCode(65+i)}. ${esc(o)}`).join('<br>')}</div><b>答案：${esc(q.options[q.answer])}</b><div>${esc(q.explanation)}</div><p class="note">${esc(q.source)}</p></div>`).join('')}</details>`).join('')}`).join('')}</div></section>
      <aside><div class="card"><h3>对话更新题库</h3><div class="step-row"><span class="step-num">1</span><div><h3>转发学习素材</h3><p>注明实际学习日期、书名／级别和正文截图；复读时只需日期与已建库书名。</p></div></div><div class="step-row"><span class="step-num">2</span><div><h3>核对考点，建立学习批次</h3><p>生成变式题，保存来源与稳定编号。</p></div></div><div class="step-row"><span class="step-num">3</span><div><h3>发布到同一个网址</h3><p>打开网页时自动同步题库，保留本地答题记录，无需妈妈导入或配置。</p></div></div><div class="library-tools" style="margin-top:20px"><button class="button" data-action="refresh-bank">检查在线题库更新 ↻</button><button class="button secondary" data-action="import-bank">备用：导入更新包 ↑</button><button class="button secondary" data-action="export-bank">导出当前题库 ↓</button></div></div>
      ${cloudView()}<div class="card"><h3>学习记录与备份</h3><p class="note">本机随时保存，绑定账号后自动同步到云端。迁移前还会保留一份本机备份。</p><div class="library-tools"><button class="button secondary" data-action="export-state">导出完整备份 ↓</button><button class="button secondary" data-action="import-state">恢复完整备份 ↑</button><button class="button secondary" data-action="export-before-bind">导出最近迁移前备份 ↓</button></div></div>
      <div class="card"><h3>每组题量</h3><div class="field"><label for="size">复习上限</label><select id="size">${[6,10,15,20].map(size=>`<option value="${size}" ${state.settings.size===size?'selected':''}>${size} 题</option>`).join('')}</select></div><p class="note">未完成的到期考点分批复习。无到期内容时可额外练习，答对不会提前推进日程。</p><div class="actions"><button class="button secondary small" data-action="test-audio">试听英文朗读 ♫</button><button class="button secondary small" data-action="test-audio" data-speed="slow">慢速试听</button></div><p class="note" style="margin-top:10px">统一英式合成朗读，句间稍作停顿。可慢速重听，听力重播不计为提示。</p></div></aside></div><input id="bank-file" type="file" accept=".json,application/json" class="hidden"><input id="state-file" type="file" accept=".json,application/json" class="hidden">`;
  }
  function cloudView(){return '<div id="account-card">'+cloudPanel()+'</div>';}
  function cloudPanel(){
    const c=cloud.view();
    if(!c.enabled)return '<div class="card"><h3>云端账号</h3><p class="note">请在正式网址绑定账号；本地预览使用本机记录。</p></div>';
    const sessions=Object.values(state.accountSessions||{});
    return `<div class="card"><h3>${c.account?esc(c.account.name)+' 的云端账号':'把进度带到其他设备'}</h3><p class="note">绑定后同步复习日程、错题、练习、星星和猫咪图鉴。每次完成练习、重新打开和恢复联网时自动同步。</p><p role="status">${c.busy?'正在同步…':c.syncedAt?'最近同步 '+esc(new Date(c.syncedAt).toLocaleString('zh-CN')):'本机记录已保留'}</p>${c.error?`<p class="banner warning">${esc(c.error)}</p>`:''}<div class="library-tools"><button class="button" data-action="account">${c.account?'切换 / 重新绑定':'绑定云端账号'}</button>${c.account?'<button class="button secondary" data-action="sync-records">立即同步 ↻</button>':''}${c.error?'<button class="button secondary" data-action="export-cloud">导出云端备份 ↓</button><button class="button secondary" data-action="resolve-account">保留作答，采用云端安排</button>':''}</div>${sessions.length?`<h4>其他设备保存的练习</h4>${sessions.map(s=>`<button class="button secondary" data-action="resume-account" data-id="${esc(s.rewardId)}">${esc(s.day)} · 已答 ${s.index}/${s.items.length} · 继续</button>`).join('')}`:''}<p class="note">离线时继续练习，联网后补传。开宝箱需联网，以便各设备使用同一份星星余额。</p></div>`;
  }
  function currentContent(){
    const questions=E.availableQuestions(bank),points=bank.points.filter(p=>questions.some(q=>q.pointId===p.id));
    const lessons=bank.lessons.filter(l=>l.status==='pending'||points.some(p=>p.lessonId===l.id));
    return {...bank,lessons,points,questions,archivedCount:bank.questions.length-questions.length};
  }
  async function start(practice=false,lessonId=null){
    if(state.session&&state.session.index<state.session.items.length){resume();return;}
    if(starting)return;
    starting=true;const revision=viewRevision;
    try{await refreshBank(false);}finally{starting=false;}
    await syncLearning();
    if(revision!==viewRevision)return;
    const active=E.activePoints(bank,state),preview=!active.length&&!Object.keys(state.batchReceipts||{}).length;
    if(preview){
      const starter=starterLesson();
      if(!starter){toast('内容将在记录的学习日期启用，请先等待学习日或补充学习批次。');return;}
      practice=true;lessonId=starter.id;
    }
    const items=E.plan(bank,state,{practice,lessonId,preview,flexible:!preview});
    if(!items.length){
      toast('暂时没有已学内容可以练习，请选择已学课程或补充学习材料。');
      return;
    }
    const next=clone();next.rewards ||= R.empty();next.session={items,index:0,results:[],hints:{},day:E.day(),practice,lessonId,preview,rewardId:uid()};await commit(next);
    if(revision!==viewRevision)return;
    selected=null;help=false;feedback=null;showTranscript=false;page='today';setNav();renderQuiz();
  }
  function resume(){selected=null;help=Boolean(state.session?.hints?.[state.session.items[state.session.index]]);feedback=null;showTranscript=Boolean(state.session?.transcriptHints?.[state.session.items[state.session.index]]);page='today';setNav();renderQuiz();}
  async function rememberHelp(checked=true,transcript=false){
    if(feedback||!state.session)return;
    const next=clone(),id=next.session.items[next.session.index];
    next.session.hints ||= {};next.session.transcriptHints ||= {};
    if(transcript)next.session.transcriptHints[id]=true;
    if(checked||next.session.transcriptHints[id])next.session.hints[id]=true;
    else delete next.session.hints[id];
    await commit(next);help=Boolean(next.session.hints[id]);
  }
  function referenceView(q,expanded=false){
    const labels={original:'教材原句',excerpt:'教材／课件词句',note:'素材要点（核对记录）',practice:'本题原创材料'};
    const references=q.references||(q.passage?[{kind:'practice',text:q.passage,source:'本题阅读材料 · 原创练习'}]:
      q.audioText?[{kind:'practice',text:q.audioText,source:'本题朗读稿 · 原创听辨'}]:[]);
    if(!references.length)return '';
    return `<details class="answer-reference"${expanded?' open':''}><summary>参考原文</summary>${references.map(r=>
      `<div class="reference-item"><span class="reference-source">${esc(labels[r.kind])} · ${esc(r.source)}</span><blockquote class="reference-text">${esc(r.text)}</blockquote></div>`).join('')}</details>`;
  }
  function errorFeedbackLink(q,lesson){
    const id=window.crypto?.randomUUID?.()||`feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url=window.ReviewErrorFeedback.url(window.REVIEW_FEEDBACK,q,lesson,bank.revision,window.REVIEW_VERSION,id);
    return url?`<a class="error-feedback-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="反馈本题错误（打开反馈表单）">反馈错误 <span aria-hidden="true">↗</span></a>`:'';
  }
  function renderQuiz(){
    const t=state.session;
    if(!t||(t.index>=t.items.length&&!feedback)){renderSummary();return;}
    const q=bank.questions.find(q=>q.id===t.items[t.index]);
    // Feedback belongs to the preceding persisted answer; the cursor already points to the next question.
    const shown=feedback?bank.questions.find(q=>q.id===feedback.questionId):q;
    const shownP=bank.points.find(p=>p.id===shown.pointId),shownL=bank.lessons.find(l=>l.id===shownP.lessonId);
    const position=feedback?t.index:t.index+1;
    let counter=0;
    const options=E.shuffle(shown.options.map((text,i)=>({text,index:i})),()=>seeded(shown.id,t.day,counter++));
    setApp(layoutWarning()+`<div class="quiz"><div class="quiz-top"><button class="link-button" data-action="pause">← 保存并稍后继续</button><span>英语练习 · ${position} / ${t.items.length}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.index/t.items.length*100}%"></div></div><div class="card question" data-question-id="${shown.id}"><div class="card-header question-header"><div class="question-heading"><span class="tag">${typeNames[shown.type]}</span><span class="note" title="${lessonLabel(shownL)}">${lessonLabel(shownL)}</span></div>${errorFeedbackLink(shown,shownL)}</div>
      ${shown.type==='listening'?`<div class="audio"><button class="button" data-action="play" data-id="${shown.id}">♫ 播放听力</button><button class="button secondary" data-action="play" data-id="${shown.id}" data-speed="slow">慢速听</button><button class="link-button" data-action="stop-audio">停止</button><span id="audio-status" role="status">可以重复听；先听，再选答案。</span></div><div class="actions"><button class="link-button" data-action="transcript">${showTranscript?'已展开听力文本':'查看听力文本（计为使用提示）'}</button><details><summary class="note">家长读题稿</summary><p class="audio-script" lang="en">${esc(shown.audioText)}</p><p class="note">家长照稿朗读，孩子不要看屏幕；这是家长辅助入口，不是权限隔离。</p></details></div>${showTranscript||feedback?`<div class="audio-script" lang="en">${esc(shown.audioText)}</div>`:''}`:''}
      ${shown.passage?`<div class="passage" lang="en">${esc(shown.passage)}</div>`:''}<h2>${esc(shown.prompt)}</h2><div class="options">${options.map((o,i)=>`<button class="option ${selected===o.index?'selected':''} ${feedback?(o.index===shown.answer?'correct':o.index===feedback.selected?'wrong':''):''}" data-action="select" data-option="${o.index}" ${feedback?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span>${feedback&&o.index===shown.answer?'<span style="margin-left:auto">✓</span>':''}</button>`).join('')}</div>
      ${feedback?`<div class="feedback ${!feedback.correct?'wrong':''}" role="status">${feedback.correct?encouragement(feedback,t.index):''}<strong>${feedback.correct?(feedback.help?'答对了，这次借助了提示':'答对了！'):'没关系，我们一起看看为什么。'}</strong><p>${esc(shown.explanation)}</p>${referenceView(shown,!feedback.correct)}</div>`:''}
      <div class="quiz-actions">${feedback?`<span class="note">看懂原因后，再继续。</span><button class="button" data-action="next">${t.index===t.items.length?'查看本组结果':'下一题 →'}</button>`:t.transcriptHints?.[shown.id]?`<span class="note">已查看听力文本，本题计为使用提示。</span><span class="note">点击选项，立即查看结果。</span>`:`<label class="check"><input type="checkbox" id="help-check" ${help?'checked':''}>这题用了提示或家长帮助</label><span class="note">点击选项，立即查看结果。</span>`}</div></div><p class="note" style="margin-top:16px">不计时，慢慢想。每个答案都会保存。</p></div>`,'quiz');
  }
  function seeded(id,d,n){let hash=2166136261;for(const c of id+d+n)hash=Math.imul(hash^c.charCodeAt(0),16777619);hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;return (hash>>>0)/4294967296;}
  function scrollAnswerReview(){
    const options=document.querySelector('.question .options'),actions=document.querySelector('.question .quiz-actions');
    if(!options?.getBoundingClientRect||!actions?.getBoundingClientRect)return;
    const viewport=window.visualViewport,height=viewport?.height||window.innerHeight,offset=viewport?.offsetTop||0;
    const inset=Math.min(24,height*.04),top=options.getBoundingClientRect().top,bottom=actions.getBoundingClientRect().bottom;
    if(top>=offset+inset&&bottom<=offset+height-inset)return;
    // Keep all options when they fit; otherwise leave the explanation and next
    // button in view without shrinking the child's reading text.
    const shift=bottom-top<=height-inset*2?top-offset-inset:bottom-offset-height+inset;
    window.scrollTo({top:Math.max(0,window.scrollY+shift),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  async function submit(){
    if(selected===null||feedback||!state.session)return;
    stopAudio();
    const revision=viewRevision;
    const next=clone(),q=next.session.items[next.session.index];
    // An older unfinished session can join the reward system when resumed.
    next.rewards ||= R.empty();next.session.rewardId ||= uid();
    const result=E.grade(bank,next,q,selected,help,E.day());
    if(!next.session.preview){
      await cloud.prepare(result,bank.questions.find(item=>item.id===q));
    }
    if(next.session.preview){
      delete next.points[result.pointId];
      for(const key of Object.keys(next.units||{}))if(key.startsWith(result.pointId+'::'))delete next.units[key];
    }
    next.session.results.push(result);next.session.index++;R.settle(next);await commit(next);
    if(next.session.index===next.session.items.length)scheduleSync();
    if(revision!==viewRevision)return;
    feedback=result;renderQuiz();
    scrollAnswerReview();
  }
  function nextQuestion(){
    stopAudio();selected=null;help=false;showTranscript=false;feedback=null;
    if(state.session.index===state.session.items.length)renderSummary();else renderQuiz();
    document.querySelector('.question, .summary')?.scrollIntoView?.({block:'start',behavior:'instant'});
  }
  function renderSummary(){
    const t=state.session;
    if(!t){render();return;}
    const total=t.results.length,ind=t.results.filter(r=>r.correct&&!r.help).length;
    const receipt=state.rewards?.settlements.find(s=>s.id===t.rewardId);
    const fresh=receipt&&!animatedRewards.has(receipt.id);
    if(receipt)animatedRewards.add(receipt.id);
    const canContinue=E.plan(bank,state,{flexible:true}).length>0;
    const message=canContinue?'还想练吗？接着复习其他考点，也可以提前练习明天和之后的内容。':'本组已保存，可以返回首页。';
    setApp(layoutWarning()+`<div class="quiz"><div class="card summary club-summary"><div class="eyebrow">A LITTLE EFFORT, A LITTLE MAGIC</div><h1>小探险完成啦！</h1><div class="summary-score"><span class="score">${t.results.filter(r=>r.correct).length}<small> / ${total}</small></span><div>题答对了<br><span class="muted">${ind} 题独立答对</span></div></div>${rewardView(true,fresh)}<p class="note">${message}</p><div class="actions summary-actions">${canContinue?'<button class="button" data-action="start">再练一组 →</button>':''}<button class="button secondary" data-action="finish">回到首页</button></div></div></div>`,'summary');
  }
  function star(fill,i,animate=false){
    const path='M25 3 31.8 17.1 47.4 19.4 36.2 30.4 38.8 46 25 38.7 11.2 46 13.8 30.4 2.6 19.4 18.2 17.1Z';
    return `<span class="club-star ${animate?'star-earned':''}" style="--delay:${i*110}ms" aria-hidden="true"><svg viewBox="0 0 50 50"><defs><linearGradient id="star-${i}"><stop offset="${fill*100}%" stop-color="#edb748"/><stop offset="${fill*100}%" stop-color="#ebe5d9"/></linearGradient></defs><path d="${path}" fill="url(#star-${i})" stroke="${fill?'#cf9c40':'#dcd3c4'}" stroke-width="1.8" stroke-linejoin="round"/></svg></span>`;
  }
  function chest(className=''){
    return `<span class="treasure-chest ${className}" aria-hidden="true"><svg viewBox="0 0 180 150"><ellipse cx="90" cy="138" rx="68" ry="9" fill="#66432d" opacity=".1"/><g class="chest-body"><path d="M28 68h124v54q0 9-9 9H37q-9 0-9-9Z" fill="#ba7650" stroke="#865a43" stroke-width="3"/><path d="M31 91h118v14H31Z" fill="#d78d5a"/><path d="M45 69h12v61H45Zm78 0h12v61h-12Z" fill="#f2c56d"/><path d="M29 119h122v10H29Z" fill="#9b6247"/></g><g class="chest-lid"><path d="M26 70V49q0-30 31-30h66q31 0 31 30v21Z" fill="#d89867" stroke="#865a43" stroke-width="3"/><path d="M43 21h13v49H43Zm81 0h13v49h-13Z" fill="#f5cf83"/><path d="M27 58h126v12H27Z" fill="#efbd63"/><path d="M61 34h58" stroke="#ebba87" stroke-width="3" stroke-linecap="round"/></g><rect x="77" y="60" width="26" height="32" rx="7" fill="#ffe3a0" stroke="#b98a43" stroke-width="2"/><path d="m90 67 2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9Z" fill="#b47e3b"/></svg></span>`;
  }
  function rewardView(summary=false,animate=false){
    const r=state.rewards||R.empty(),full=r.openings.length===100,ready=r.balance>=6&&!full;
    const progress=Math.min(6,r.balance),receipt=summary&&r.settlements.find(s=>s.id===state.session?.rewardId);
    const award=receipt?.units||0;
    const total=state.session?.items.length||state.settings.size,minimum=Math.ceil(total*4/5);
    const message=summary?(state.session?.preview?'这次是体验练习，正式练习就能攒星星。':!receipt?'这组是之前的练习，从下一组开始攒星星吧。':award===2?'全答对！收获 1 颗星星':award===1?`答对 ${receipt.correct} 题，收获半颗星星`:`继续加油，答对至少 ${minimum} 题就能收获半颗星星`):'你的星星，正在召唤新朋友';
    const remaining=(6-progress)/2;
    return `<section class="club-reward ${summary?'is-settlement':'is-compact'} ${ready?'chest-ready':''}" aria-label="星星与猫咪宝箱"><div class="reward-main"><div class="eyebrow">KITTY TREASURE</div><h2 class="reward-heading">${message}</h2><div class="star-meter" role="img" aria-label="宝箱星星进度 ${progress/2} / 3 颗">${[0,1,2].map(i=>star(Math.max(0,Math.min(1,(progress-i*2)/2)),i,animate&&award>0&&i*2<progress&&i*2+2>progress-award)).join('')}<span class="star-count">${progress/2}<small> / 3</small></span></div><p class="reward-note">${full?'100 位朋友到齐啦，星星继续记录你的努力。':ready?'三颗星星集齐啦！打开宝箱，遇见一位新朋友。':`再攒 ${remaining} 颗星星，就能邀请一只猫咪。`}${r.balance>6&&!full?`<br>共 ${r.balance/2} 颗，多出的星星会留给下个宝箱。`:''}</p>${summary?`<p class="reward-rules">全答对 +1 星 · 答对至少 ${minimum} 题 +半星</p>`:''}</div><div class="reward-chest">${chest()}<button class="button chest-button" data-action="open-chest" ${!ready||!storageAvailable?'disabled':''}>${full?'图鉴已集齐':ready?'打开猫咪宝箱 ✦':'等待星星集齐'}</button></div><button class="collection-link" data-action="nav" data-target="collection"><span>猫咪图鉴</span><strong>${r.openings.length}<small> / 100</small></strong><span aria-hidden="true">↗</span></button>${!summary&&state.session&&state.session.index===state.session.items.length?'<button class="link-button last-settlement" data-action="summary">查看上组结果 →</button>':''}</section>`;
  }
  function collectionView(){
    const unlocked=state.rewards?.openings||[],categories=[...new Set(catalog.map(c=>c.category))];
    const cats=catalog.filter(c=>(catCategory==='all'||catCategory===c.category)&&(catFilter==='all'||unlocked.some(o=>o.catId===c.id)));
    return head('MY LITTLE KITTY ALBUM','每一只猫咪，都是努力的纪念。',`已收集 ${unlocked.length} / 100 只 · 三颗星星，遇见一位新朋友`)+
      `<div class="album-banner"><div><span class="album-tag">ELLA’S COLLECTION</span><h2>猫咪图鉴</h2><p>小小爪印，一页一页填满。</p></div><div class="album-count">${unlocked.length}<small> / 100</small><div class="album-track"><span style="width:${unlocked.length}%"></span></div></div></div><div class="album-toolbar"><div class="album-tabs" aria-label="图鉴范围"><button data-action="cat-filter" data-filter="all" aria-pressed="${catFilter==='all'}">全部猫咪</button><button data-action="cat-filter" data-filter="unlocked" aria-pressed="${catFilter==='unlocked'}">已收集 ${unlocked.length}</button></div><label class="album-category">主题 <select id="cat-category"><option value="all">全部主题</option>${categories.map(c=>`<option value="${esc(c)}" ${catCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label></div>${!unlocked.length?'<p class="album-tip">朋友们正躲在剪影里。完成练习、攒满三颗星星，打开第一只宝箱吧。</p>':''}<div class="cat-grid">${cats.map(c=>{
        const opening=unlocked.find(o=>o.catId===c.id),newest=opening&&opening===unlocked.at(-1);
        return `<button class="cat-card ${opening?'unlocked':'locked'} ${newest?'newest':''}" ${opening?`data-action="view-cat" data-id="${c.id}"`:'disabled'} aria-label="${opening?`放大浏览 ${esc(c.name)}`:`第 ${c.number} 只猫咪，尚未解锁`}"><span class="cat-number">No. ${String(c.number).padStart(3,'0')}</span>${newest?'<span class="new-cat-tag">新朋友</span>':''}<img src="${opening?c.thumb:c.shadow}" alt="" width="256" height="256" loading="lazy" decoding="async"><strong>${opening?esc(c.name):'等待相遇'}</strong><span class="cat-category">${opening?esc(c.category):'未解锁 · ♡'}</span></button>`;
      }).join('')}</div>${!cats.length?'<div class="card album-empty"><h3>这个主题还没有新朋友</h3><p>攒满三颗星星，打开宝箱看看吧。</p><button class="button" data-action="nav" data-target="today">去练习 →</button></div>':''}`;
  }
  function showCat(id){
    const opening=state.rewards?.openings.find(o=>o.catId===id),cat=catalog.find(c=>c.id===id);
    if(!cat||!opening)return;
    viewerId=id;
    const dialog=document.getElementById('cat-dialog'),unlocked=state.rewards.openings;
    dialog.className='cat-dialog cat-viewer';
    dialog.innerHTML=`<button class="dialog-close" data-cat-action="close" aria-label="关闭图鉴">×</button><div class="eyebrow">${esc(cat.category)} · NO. ${String(cat.number).padStart(3,'0')}</div><img class="viewer-art" src="${cat.art}" alt="${esc(cat.name)}" width="1024" height="1024"><h2 id="cat-dialog-title">${esc(cat.name)}</h2><p>相遇于 ${new Date(opening.at).toLocaleDateString('zh-CN')}</p><div class="viewer-controls"><button class="button secondary" data-cat-action="prev" ${unlocked.length<2?'disabled':''} aria-label="上一只猫咪">←</button><span>${unlocked.indexOf(opening)+1} / ${unlocked.length}</span><button class="button secondary" data-cat-action="next" ${unlocked.length<2?'disabled':''} aria-label="下一只猫咪">→</button></div>`;
    if(!dialog.open)dialog.showModal();else dialog.querySelector('.dialog-close')?.focus?.();
  }
  async function openChest(){
    const epoch=navigationEpoch;
    let opening;
    if(cloud.view().account)opening=await cloud.open();
    else {const next=clone();opening=R.open(next,uid());await commit(next);}
    const next=state;
    // Save the draw before animation: closing or reloading cannot lose the cat.
    if(epoch!==navigationEpoch){toast('新猫咪已收进图鉴。');return;}
    if(document.querySelector('.club-summary'))renderSummary();else render();
    const cat=catalog.find(c=>c.id===opening.catId),dialog=document.getElementById('cat-dialog');
    dialog.className='cat-dialog chest-opening';
    dialog.innerHTML=`<button class="dialog-close" data-cat-action="close-reveal" aria-label="关闭，猫咪已保存到图鉴">×</button><div class="eyebrow">A NEW LITTLE FRIEND</div><h2 id="cat-dialog-title">宝箱里，藏着谁？</h2><div class="chest-stage"><div class="treasure-glow"></div><span class="reveal-spark spark-a" aria-hidden="true">✦</span><span class="reveal-spark spark-b" aria-hidden="true">✧</span>${chest('opening-chest')}<img class="reveal-cat" src="${cat.art}" width="1024" height="1024" alt="${esc(cat.name)}"></div><div class="reveal-caption"><span class="new-friend-label">NEW · 第 ${next.rewards.openings.length} 位朋友</span><h3>${esc(cat.name)}</h3><p>${esc(cat.category)} · 正在等你收藏</p></div><div class="reveal-bottom"><button class="button" data-cat-action="collect">收进猫咪图鉴 ♡</button><span class="album-destination" aria-label="猫咪图鉴">▤<small>我的图鉴</small></span></div><p class="reveal-saved">猫咪已经保存，随时可以在图鉴里找到它。</p>`;
    dialog.showModal();
  }
  async function collectCat(){
    const revision=viewRevision;
    const dialog=document.getElementById('cat-dialog'),image=dialog.querySelector('.reveal-cat'),target=dialog.querySelector('.album-destination');
    if(!dialog.open)return;
    const button=dialog.querySelector('[data-cat-action="collect"]');if(button)button.disabled=true;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if(image?.animate&&target&&!reduced){
      const a=image.getBoundingClientRect(),b=target.getBoundingClientRect();
      dialog.classList.add('collecting-cat');
      const animation=image.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${b.x+b.width/2-a.x-a.width/2}px,${b.y+b.height/2-a.y-a.height/2}px) scale(.08) rotate(12deg)`,opacity:0}],{duration:750,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
      try{await animation.finished;}catch{}
    }
    if(!dialog.open||revision!==viewRevision)return;
    dialog.close();navigate('collection');
    document.querySelector('.cat-card.newest')?.scrollIntoView?.({block:'center',behavior:'instant'});
    document.querySelector('.cat-card.newest')?.focus?.();
  }
  function simulateGroup(next,correct,total=10){
    const items=E.availableQuestions(bank).slice(0,total).map(q=>q.id);
    next.rewards ||= R.empty();
    next.session={rewardId:uid(),items,index:0,results:[],hints:{},day:E.day(),practice:true};
    for(const [i,id] of items.entries()){
      const q=bank.questions.find(q=>q.id===id),result=E.grade(bank,next,id,i<correct?q.answer:(q.answer+1)%q.options.length,false,E.day());
      next.session.results.push(result);next.session.index++;
    }
    R.settle(next);
  }
  async function previewReward(action){
    if(!catPreview)return;
    const revision=viewRevision,next=clone();
    if(action==='preview-ready'){while((next.rewards?.balance||0)<6)simulateGroup(next,10);}
    else simulateGroup(next,action==='preview-full'?10:action==='preview-half'?8:7);
    await commit(next);
    if(revision===viewRevision){page='today';setNav();renderSummary();}
  }
  async function ask(title,text){
    return new Promise(resolve=>{
      const d=document.getElementById('confirm-dialog');
      document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-text').textContent=text;
      const finish=value=>{d.close();document.getElementById('confirm-ok').onclick=null;document.getElementById('confirm-cancel').onclick=null;d.oncancel=null;resolve(value);};
      document.getElementById('confirm-ok').onclick=()=>finish(true);
      document.getElementById('confirm-cancel').onclick=()=>finish(false);
      d.oncancel=e=>{e.preventDefault();finish(false);};d.showModal();
    });
  }
  async function play(text,slow=false){
    const revision=viewRevision,manifest=await prepareAudio(bank);
    if(revision!==viewRevision)return;
    adoptAudio(manifest);
    const status=document.getElementById('audio-status');
    const tell=msg=>{if(status)status.textContent=msg;else toast(msg);};
    listening.play(text,{slow,tell});
  }
  function download(filename,value){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  // Serialize local actions; each persistent write also checks the shared revision
  // under a Web Lock, so another tab can never silently overwrite this session.
  let queue=Promise.resolve();
  function run(task,revision){
    const execute=async()=>{
      if(store.changed()){adopt(store.read());storageAvailable=true;render();toast('记录已从另一个页面同步，请再操作一次。');return;}
      if(revision!==undefined&&revision!==viewRevision)return;
      await task();
    };
    queue=queue.then(()=>cloud.view().enabled&&navigator.locks?.request?navigator.locks.request('ella-account-operation',execute):execute()).catch(err=>{toast(err.message||'操作未保存，请重试。');if(revision===undefined||revision===viewRevision)render();});
    return queue;
  }
  app.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
    const el={dataset:{...target.dataset}},revision=viewRevision;
    return run(async()=>{
    const action=el.dataset.action;
    if(action==='account')showAccountDialog();
    else if(action==='resume-account'){
      const next=clone(),session=next.accountSessions?.[el.dataset.id];if(!session)return;
      if(next.session&&next.session.index<next.session.items.length)next.accountSessions[next.session.rewardId]=next.session;
      next.session=session;delete next.accountSessions[session.rewardId];await commit(next);resume();
    }
    else if(action==='export-cloud')download(`温故-云端备份-${E.day()}.json`,await cloud.backup());
    else if(action==='export-before-bind')download(`温故-迁移前备份-${E.day()}.json`,cloud.localBackup());
    else if(action==='resolve-account'){
      if(await ask('保留作答，采用云端安排？','两边的答题历史和猫咪都会保留。冲突的日期、题量和同一组练习进度采用云端版本，本机原始版本另存备份。')){await cloud.resolve();render();}
    }
    else if(action==='nav')navigate(el.dataset.target);
    else if(action==='system'){system=el.dataset.system;render();}
    else if(action==='level'){level=Number(el.dataset.level);render();}
    else if(action==='start')await start();
    else if(action==='practice')await start(true);
    else if(action==='lesson-practice')await start(true,el.dataset.id);
    else if(action==='resume')resume();
    else if(action==='summary')renderSummary();
    else if(action==='open-chest')await openChest();
    else if(action==='cat-filter'){catFilter=el.dataset.filter;render();}
    else if(action==='view-cat')showCat(el.dataset.id);
    else if(action.startsWith('preview-'))await previewReward(action);
    else if(action==='select'){selected=Number(el.dataset.option);await submit();}
    else if(action==='submit')await submit();
    else if(action==='next')nextQuestion();
    else if(action==='pause'){feedback=null;stopAudio();render();scheduleSync();}
    else if(action==='finish'){const next=clone();next.session=null;await commit(next);feedback=null;render();await refreshBank();}
    else if(action==='end'&&await ask('结束这组练习？','已完成的作答和复习安排都会保留，未答题目不计入结果。')){const next=clone();next.session=null;await commit(next);render();await refreshBank();}
    else if(action==='transcript'){await rememberHelp(true,true);if(revision===viewRevision){showTranscript=true;renderQuiz();}}
    else if(action==='play')await play(bank.questions.find(q=>q.id===el.dataset.id).audioText,el.dataset.speed==='slow');
    else if(action==='stop-audio'){stopAudio();const status=document.getElementById('audio-status');if(status)status.textContent='已停止，可以重新播放。';}
    else if(action==='test-audio')await play(window.ReviewAudio.DEMO_TEXT,el.dataset.speed==='slow');
    else if(action==='refresh-bank'){if(location.protocol==='file:')toast('本地单文件无法联网同步；请使用部署网址或导入更新包。');else await refreshBank();}
    else if(action==='export-bank')download('温故-题库.json',bank);
    else if(action==='export-state')download(`温故-完整备份-${E.day()}.json`,{kind:'lesson-loop-backup',version:1,exportedAt:new Date().toISOString(),bank,state});
    else if(action==='sync-records')await cloud.sync();
    else if(action==='export-recovery'){
      const raw=store.recovery();
      if(!raw){toast('没有需要恢复的原始记录。');return;}
      const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');
      a.href=url;a.download=`温故-原始记录-${E.day()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    else if(action==='import-bank')document.getElementById('bank-file').click();
    else if(action==='import-state')document.getElementById('state-file').click();
    },el.dataset.action==='account'?undefined:revision);
  });
  app.addEventListener('change',event=>{
    const target=event.target,revision=viewRevision;
    const el={id:target.id,dataset:{...target.dataset},value:target.value,checked:target.checked,files:target.files};
    return run(async()=>{
    if(el.dataset.bookDate){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再修改学习日期。');render();return;}
      try{const next=clone();for(const m of lessonModules(el.dataset.bookDate))E.setModuleDate(bank,next,el.dataset.bookDate,m,el.value);await commit(next);render();toast('绘本学习日期已保存，复习计划已更新。');}catch(err){toast(err.message);render();}
    }else if(el.dataset.dateLesson){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再修改学习日期。');render();return;}
      try{const next=clone();E.setModuleDate(bank,next,el.dataset.dateLesson,el.dataset.dateModule,el.value);await commit(next);render();toast('学习日期已保存，复习计划已更新。');}catch(err){toast(err.message);render();}
    }else if(el.id==='help-check'){await rememberHelp(el.checked);if(revision===viewRevision)target.checked=help;}
    else if(el.id==='size'){const next=clone();next.settings.size=Number(el.value);await commit(next);}
    else if(el.id==='cat-category'){catCategory=el.value;render();}
    else if(el.id==='bank-file'||el.id==='state-file'){
      const file=el.files[0];if(!file)return;
      try {
        if(file.size>12*1024*1024)throw new Error('文件超过 12 MB，请使用较小的更新包。');
        const data=JSON.parse(await file.text());
        if(el.id==='bank-file'){
          if(state.session&&state.session.index<state.session.items.length)throw new Error('请先完成或结束当前练习，再更新题库。');
          const merged=E.mergeBank(bank,data),next=clone();
          E.validateState(next,merged);
          E.syncBatches(merged,next);
          if(!await ask('合并题库更新？',`合并后共有 ${merged.points.length} 个练习分组、${E.availableQuestions(merged).length} 道可用题。作答历史保留，停用题不再加入新练习。`))return;
          await commit(next,merged);render();toast('题库已更新，学习记录已保留。');
        }else{
          if(data.kind!=='lesson-loop-backup'||data.version!==1)throw new Error('请选择由本应用导出的完整备份。');
          E.validateBank(data.bank);E.validateState(data.state,data.bank);
          if(cloud.view().account){
            if(!await ask('合并这份账号备份？','保留已有作答和猫咪，补入备份里的记录；日期和题量设置以云端为准。'))return;
            await cloud.importBundle({bank:data.bank,state:data.state,baseline:JSON.stringify(data.bank)});
            stopAudio();render();toast('备份已合并并同步。');return;
          }
          if(cloud.view().enabled&&data.state.accountId)throw new Error('这是云端账号备份，请先绑定对应账号，再合并恢复。');
          if(!await ask('恢复完整备份？','这会替换当前浏览器中的题库和学习记录。建议先导出当前备份。'))return;
          const restoredBank=E.mergeBank(data.bank,(bank.revision||0)>=(data.bank.revision||0)?bank:data.bank),restoredState=data.state;
          for(const h of restoredState.history){
            h.originDeviceId ||= h.deviceId||null;h.imported=true;
            // Imported backups retain their provenance, but never replay live events.
            h.recordSource='imported';delete h.deviceId;delete h.eventId;
          }
          E.syncBatches(restoredBank,restoredState);E.validateState(restoredState,restoredBank);
          await commit(restoredState,restoredBank,baseline,{restore:true});
          stopAudio();render();toast('记录已恢复，最新发布题库保留。');
        }
      }catch(err){toast(err.message||'导入失败，现有数据没有更改。');}
      finally{target.value='';}
    }
    },revision);
  });
  document.querySelectorAll('header [data-page], #parent-nav [data-page]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();navigate('today');});
  document.getElementById('cat-dialog').addEventListener('click',event=>{
    const target=event.target.closest('[data-cat-action]');if(!target||target.disabled)return;
    const action=target.dataset.catAction;
    if(action==='collect'){collectCat().catch(err=>toast(err.message));return;}
    if(action==='close-reveal'){document.getElementById('cat-dialog').close();navigate('collection');return;}
    if(action==='close'){document.getElementById('cat-dialog').close();return;}
    if(action==='prev'||action==='next'){
      const cats=state.rewards?.openings||[],i=cats.findIndex(o=>o.catId===viewerId);
      if(cats.length)showCat(cats[(i+(action==='next'?1:-1)+cats.length)%cats.length].catId);
    }
  });
  document.getElementById('cat-dialog').addEventListener('keydown',event=>{
    if(!document.getElementById('cat-dialog').classList.contains('cat-viewer'))return;
    const cats=state.rewards?.openings||[],i=cats.findIndex(o=>o.catId===viewerId);
    if(cats.length&&(event.key==='ArrowRight'||event.key==='ArrowLeft')){event.preventDefault();showCat(cats[(i+(event.key==='ArrowRight'?1:-1)+cats.length)%cats.length].catId);}
  });
  async function boot(){
    try{
      const saved=store.read();
      if(saved){
        adopt(saved);
        const bundled=E.validateBank(window.LESSON_BANK);
        if(JSON.stringify(bundled)!==baseline||(bank.revision||0)<(bundled.revision||0)){
          if(state.session&&state.session.index<state.session.items.length)pendingBank=bundled;
          else if((bundled.revision||0)>=(bank.revision||0)){
            const merged=E.mergeBank(bank,bundled),next=clone();E.syncBatches(merged,next);
            await commit(next,merged,JSON.stringify(bundled));
          }
        }
      }
      await syncLearning();
      if(catPreview&&!saved){
        const next=clone();for(let i=0;i<3;i++)simulateGroup(next,10);
        await commit(next);
      }
    }catch(err){storageAvailable=err.name==='AudioSyncError';toast(err.message||'原始记录已保护，请先导出或恢复备份。');}
    render();
    if(storageAvailable&&cloud.view().enabled){
      if(cloud.view().account)await cloud.sync();
      else showAccountDialog();
    }
    if(catPreview&&state.session?.index===state.session?.items.length)renderSummary();
    if(storageAvailable)await refreshBank();
  }
  queue=boot();
  async function tick(){
    const changed=await syncLearning();
    if(viewKind==='page'&&(changed||renderedDay!==E.day()))render();
    await refreshBank(viewKind==='page');
    await cloud.sync();
  }
  window.addEventListener('storage',event=>{if(event.key===STORE||event.key===null)run(async()=>{});});
  window.addEventListener('online',()=>run(()=>cloud.sync()));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)run(tick);else run(()=>cloud.sync());});
  setInterval(()=>run(tick),120000);
})();
