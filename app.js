/* Content lives in question-bank.json; learner data is independent of content updates. */
(function(){
  'use strict';
  const E=window.ReviewEngine,STORE=window.ReviewStorage.KEY;
  const store=window.ReviewStorage.create({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},E,navigator.locks,window.indexedDB);
  let baseline=JSON.stringify(window.LESSON_BANK),pendingBank=null,starting=false;
  const app=document.getElementById('app');
  const moduleNames={lv:'听力与词汇',rg:'阅读与语法',skills:'Skills 综合技能',reading:'绘本阅读',vocabulary:'词汇积累'};
  const typeNames={choice:'词汇选择',cloze:'选词填空',listening:'听力选择',reading:'阅读理解'};
  let bank=E.validateBank(window.LESSON_BANK), state=E.emptyState(),page='today',level=2,system='cambridge';
  let selected=null,help=false,feedback=null,showTranscript=false,storageAvailable=true;
  let toastTimer=null,audioTimer=null,playing=false,audioTicket=0;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message){document.getElementById('toast').textContent=message;document.getElementById('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>document.getElementById('toast').classList.remove('show'),4000);}
  function adopt(saved){
    if(saved){bank=saved.bank;state=saved.state;baseline=saved.baseline;}
    else {state=E.emptyState();bank=E.validateBank(window.LESSON_BANK);baseline=JSON.stringify(bank);}
    selected=null;help=false;feedback=null;showTranscript=false;stopAudio();
  }
  async function commit(next,nextBank=bank,nextBaseline=baseline,options={}) {
    try{await store.write({bank:nextBank,state:next,baseline:nextBaseline},options);}
    catch(err){
      storageAvailable=false;
      if(err.name==='ConflictError'){adopt(store.read());storageAvailable=true;render();}
      throw err;
    }
    bank=nextBank;state=next;baseline=nextBaseline;storageAvailable=true;
  }
  function clone(){return JSON.parse(JSON.stringify(state));}
  function lessonLabel(l){
    return l.system==='raz'?`RAZ ${l.level} · ${esc(l.title)}`:l.system==='ket'?`KET 词汇 · ${esc(l.title)}`:`Level ${l.level} · Lesson ${l.number} · ${esc(l.title)}`;
  }
  function starterLesson(){return bank.lessons.find(l=>l.status==='ready'&&!(bank.batches||[]).some(b=>b.items.some(i=>i.lessonId===l.id)));}
  async function syncLearning(){const next=clone();E.syncBatches(bank,next);const changed=JSON.stringify(next)!==JSON.stringify(state);if(changed)await commit(next);return changed;}
  async function refreshBank(repaint=true){
    if(pendingBank&&(!state.session||state.session.index>=state.session.items.length)){
      const incoming=pendingBank,merged=E.mergeBank(bank,incoming),next=clone();E.syncBatches(merged,next);
      await commit(next,merged,JSON.stringify(incoming));pendingBank=null;
      if(repaint)render();
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
      if(repaint)render();toast('最新题库已同步，答题记录保留。');
    }catch(err){toast('在线题库暂未同步，继续使用已保存的内容。');}
    finally{clearTimeout(timeout);}
  }
  function stopAudio(){audioTicket++;clearTimeout(audioTimer);playing=false;if(window.speechSynthesis)window.speechSynthesis.cancel();}
  function dateLabel(d){return new Date(d+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric'});}
  function head(label,title,description){
    return `<div class="page-head"><div><div class="eyebrow">${label}</div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="date-pill">${new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</div></div>`;
  }
  function layoutWarning(){return !storageAvailable?'<div class="banner warning">记录未能保存，已保护原始数据。请到「家长题库」导出原始记录或恢复有效备份，再继续练习。</div>':'';}
  function navigate(p){stopAudio();page=p;selected=null;help=false;feedback=null;showTranscript=false;render();window.scrollTo({top:0,behavior:'instant'});}
  function setNav(){
    document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.hasAttribute('data-parent-entry')?page!=='today':el.dataset.page===page));
    document.getElementById('parent-nav').classList.toggle('hidden',page==='today');
  }
  function render(){setNav();app.innerHTML=layoutWarning()+({today:todayView,courses:courseView,progress:progressView,library:libraryView}[page]||todayView)();}
  function todayView(){
    if(state.session && state.session.index<state.session.items.length)return sessionLanding();
    const active=E.activePoints(bank,state),due=E.duePoints(bank,state);
    const points=due.length?due:active;
    const starter=starterLesson();
    const registered=Object.keys(state.batchReceipts||{}).length;
    const lessons=points.length?bank.lessons.filter(l=>points.some(p=>p.lessonId===l.id)):!registered&&starter?[starter]:[];
    const nextDue=active.map(p=>state.points[p.id]?.due).filter(Boolean).sort()[0];
    return head('LET’S PRACTICE','今天，来练几道英语题吧。','选一个答案，就能马上知道对不对。')+
      `<div class="student-home"><div class="hero"><div class="hero-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" width="150" height="150" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M26 12a11 11 0 1 0 1 9"/><path d="M19 12h7V5"/></svg></div><div class="eyebrow">YOUR ENGLISH PRACTICE</div><h2>准备好了吗？</h2><p>每次 ${state.settings.size} 题以内。慢慢想，选答案，看解析。</p><div class="hero-meta"><span>词汇选择 · 选词填空 · 听力 · 阅读</span></div><button class="button start-button" data-action="start" ${!lessons.length?'disabled':''}>开始练习 <span aria-hidden="true">→</span></button></div>
      <div class="card"><div class="card-header"><h3>${due.length?'今天到期的课程':registered?'已学内容 · 可额外练习':'体验练习'}</h3></div>${lessons.length?lessons.map(l=>`<div class="list-row"><span class="type-icon">↗</span><div class="grow"><strong>${lessonLabel(l)}</strong><small>${esc(l.subtitle)}</small></div></div>`).join(''):'<p class="note">暂时没有可练习题目，请家长补充题库。</p>'}${registered?`<p class="note">自动安排 · ${due.length} 个考点到期${!due.length&&nextDue?' · 下次 '+dateLabel(nextDue):''}</p>`:'<p class="note">尚未发布学习日期。可以先体验，体验不会代替正式学习登记。</p>'}<p class="note" style="margin-top:14px">看题 → 选答案 → 看对错 → 下一题</p></div></div>`;
  }
  function pointRow(p){const l=bank.lessons.find(l=>l.id===p.lessonId),sp=state.points[p.id];return `<div class="list-row"><span class="type-icon">↗</span><div class="grow"><strong>${esc(p.title)}</strong><small>${lessonLabel(l)}</small></div><span class="tag">${sp?.errors?'需要巩固':sp?.stage?'间隔复习':'首次回顾'}</span></div>`;}
  function sessionLanding(){const t=state.session;return head('KEEP GOING','上次的练习，等你继续。',`已经完成 ${t.index} / ${t.items.length} 题。`)+`<div class="card quiz"><h2>还有 ${t.items.length-t.index} 题</h2><p class="muted">从上次停下的地方，接着练。</p><div class="actions"><button class="button start-button" data-action="resume">开始练习 →</button><button class="button secondary" data-action="end">结束本组</button></div></div>`;}
  function moduleControls(l,ps){
    if(l.system==='raz')return bookControls(l,ps);
    return `<div class="checks">${E.MODULES.filter(m=>(l.system||'cambridge')==='cambridge'?['lv','rg','skills'].includes(m):ps.some(p=>p.module===m)).map(m=>{
      const available=ps.some(p=>p.module===m),info=available?E.moduleDate(bank,state,l.id,m):null;
      const repeats=(state.localBatches||[]).filter(b=>b.items.some(i=>i.lessonId===l.id&&i.modules.includes(m)));
      return `<div class="module-block"><strong>${moduleNames[m]}${!available?'（待补充）':''}</strong>${available?`<div class="module-date-row"><label for="date-${l.id}-${m}">学习日期</label><input type="date" id="date-${l.id}-${m}" data-date-lesson="${l.id}" data-date-module="${m}" aria-label="${moduleNames[m]}学习日期" value="${info.date}"></div><p class="note">${info.source==='manual'?'家长已修改':info.source==='batch'?'来自发布的学习批次':'默认：题库生成日期的前一天，可修改'}${info.date>E.day()?' · 等待学习日':''}</p><details class="repeat-controls"><summary>记录复读${repeats.length?' · '+repeats.length+' 次':''}</summary><div class="module-date-row"><input type="date" data-repeat-date value="${E.day()}" max="${E.day()}" min="${info.date}" aria-label="${moduleNames[m]}复读日期"><button class="button secondary small" data-action="record-repeat" data-id="${l.id}" data-module="${m}">记录复读</button></div>${repeats.map(b=>`<span class="tag">${esc(b.learnedOn)}</span>`).join('')}</details>`:''}</div>`;
    }).join('')}</div>`;
  }
  function lessonModules(id){return [...new Set(bank.points.filter(p=>p.lessonId===id).map(p=>p.module))];}
  function bookControls(l,ps){
    const modules=[...new Set(ps.map(p=>p.module))];
    const infos=modules.map(m=>E.moduleDate(bank,state,l.id,m));
    const dates=[...new Set(infos.map(info=>info.date))].sort();
    const repeats=[...new Set((state.localBatches||[]).filter(b=>b.items.some(i=>i.lessonId===l.id)).map(b=>b.learnedOn))].sort();
    const note=dates.length>1?'已有记录的学习日期不同，选择日期后统一整本绘本；原答题记录保留。':infos.every(info=>info.source==='default')?'默认：题库生成日期的前一天，可修改':infos.some(info=>info.source==='manual')?'家长已修改':'来自发布的学习批次';
    return `<div class="checks"><div class="module-block"><div class="module-date-row"><label for="date-${l.id}-book">学习日期</label><input type="date" id="date-${l.id}-book" data-book-date="${l.id}" aria-label="绘本学习日期" value="${dates.length===1?dates[0]:''}"></div><p class="note">${note}${dates.length===1&&dates[0]>E.day()?' · 等待学习日':''}</p><details class="repeat-controls"><summary>记录复读${repeats.length?' · '+repeats.length+' 次':''}</summary><div class="module-date-row"><input type="date" data-repeat-date value="${E.day()}" max="${E.day()}" min="${dates.at(-1)}" aria-label="绘本复读日期"><button class="button secondary small" data-action="record-book-repeat" data-id="${l.id}">记录复读</button></div>${repeats.map(date=>`<span class="tag">${esc(date)}</span>`).join('')}</details></div></div>`;
  }
  function courseView(){
    const bank=currentContent();
    const list=bank.lessons.filter(l=>(l.system||'cambridge')===system&&(system!=='cambridge'||l.level===level));
    return head('LEARNED, THEN REVIEWED','学过什么，系统自动记住。',system==='raz'?'已有绘本题库按学习日期自动安排复习，可修改日期或记录复读。':'已有课程题库按各模块的学习日期自动安排复习，可修改日期或记录复读。')+
      '<div class="filter-row">'+[['cambridge','猿辅导剑桥'],['raz','RAZ 绘本'],['ket','KET 词汇']].map(([id,name])=>`<button class="chip ${system===id?'active':''}" data-action="system" data-system="${id}">${name}</button>`).join('')+'</div>'+
      (system==='cambridge'?'<div class="filter-row">'+[1,2,3,4].map(n=>`<button class="chip ${n===level?'active':''}" data-action="level" data-level="${n}">Level ${n}</button>`).join('')+'</div>':'')+
      `<div class="banner">${system==='raz'?'每本绘本统一修改学习日期，选择后自动保存。未提供日期时默认使用绘本题库生成日期的前一天。':'每个模块都可修改学习日期，选择后自动保存。未提供日期时默认使用该模块题库生成日期的前一天。'}后续发布不会每天挪动。已答记录保留，未答日程随日期调整。</div>`+
      (list.length?`<div class="course-grid">${list.map(l=>{
        const ps=bank.points.filter(p=>p.lessonId===l.id),qs=bank.questions.filter(q=>ps.some(p=>p.id===q.pointId));
        return `<article class="card course ${l.status==='pending'?'pending':''}"><span class="tag">${lessonLabel(l)}</span><h3>${esc(l.title)}</h3><span class="muted">${esc(l.subtitle)}</span><p class="description">${l.status==='ready'?`${ps.length} 个考点 · ${qs.length} 道变式题<br>${l.system==='raz'?'整本绘本统一记录学习日期。':'各模块独立记录学习日期。'}`:'待补充课程材料，暂不加入复习。'}</p>${l.status==='ready'?moduleControls(l,ps):''}<div class="bottom"><span>${l.status==='ready'?'已核对考点':'等待正文核对'}</span>${l.status==='ready'?`<button class="button secondary small" data-action="lesson-practice" data-id="${l.id}" ${!E.activePoints(bank,state).some(p=>p.lessonId===l.id)?'disabled':''}>复习本课 →</button>`:'<span>等待建库</span>'}</div></article>`;
      }).join('')}</div>`:`<div class="card empty"><h2>这个级别，还没有导入课程</h2><p>继续在对话中上传 Level ${level} 的目录和内容截图。<br>我会整理成题库更新包，接入同一个复习站。</p><button class="button secondary" data-action="nav" data-target="library">查看题库更新方式</button></div>`);
  }
  function progressView(){
    const ps=E.activePoints(bank,state),h=state.history;
    const independent=h.filter(x=>x.correct&&!x.help).length;
    return head('SMALL STEPS, REAL PROGRESS','看见每一次，重新记住。','选择题的熟练度仅反映这些练习，不代表综合英语等级。')+
      unitProgress(ps)+
      `<div class="stats"><div class="stat"><span class="number">${h.length}</span><span class="label">累计作答</span></div><div class="stat"><span class="number">${independent}</span><span class="label">独立答对</span></div><div class="stat"><span class="number">${ps.filter(p=>state.points[p.id]?.stage>=3).length}</span><span class="label">进入较长间隔的考点</span></div></div>
      <div class="card"><div class="card-header"><h2>考点复习安排</h2><span class="note">日期按当前设备计算</span></div>${ps.length?`<div class="table-wrap"><table><thead><tr><th>考点 / 课程</th><th>学习日期</th><th>当前表现</th><th>下次复习</th><th>累计出错</th></tr></thead><tbody>${ps.map(p=>{const sp=state.points[p.id],last=h.filter(x=>x.pointId===p.id).at(-1),l=bank.lessons.find(l=>l.id===p.lessonId);return `<tr><td><strong>${esc(p.title)}</strong><br><span class="muted">${lessonLabel(l)}</span></td><td>${state.learningDates?.[p.id]||'手动登记'}</td><td>${!last?'尚未复习':!last.correct?'<span class="weak-text">需要再练</span>':last.help?'借助提示完成':`<span class="success-text">独立完成</span>`}<br><span class="note">间隔阶段 ${sp?.stage||0} / 5</span></td><td>${sp?.due?dateLabel(sp.due):'今天'}${sp?.due<=E.day()?' · 到期':''}</td><td>${sp?.errors||0}</td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty">发布带日期的学习批次后，这里会自动出现复习安排。</div>'}</div>
      <div class="card"><h2>最近的作答</h2>${h.length?h.slice(-12).reverse().map(x=>{const q=bank.questions.find(q=>q.id===x.questionId);return `<div class="list-row"><span class="type-icon">${x.correct?'✓':'↻'}</span><div class="grow"><strong>${esc(q.prompt)}</strong><small>${dateLabel(x.day)} · ${typeNames[q.type]} · ${x.correct?(x.help?'提示后答对':'独立答对'):'答错，需要巩固'}</small></div></div>`;}).join(''):'<div class="empty">完成第一组练习后，就能看到真实的作答记录。</div>'}</div>`;
  }
  function unitProgress(points){
    return `<div class="card"><h2>分项复习</h2><p class="note">星期词、活动词组等分别安排；一个词答对不会推迟其他词。旧版综合熟练度保留在历史中，新分项从短间隔开始确认。</p>${points.map(p=>{
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
    return `<div class="card"><div class="card-header"><h2>学习批次与复读记录</h2><span class="tag">${batches.length} 批</span></div><p class="note">内容更新 ${esc(bank.updated||'未标注')} · 学习日期可在课程进度中校正。复读题库不重复。</p>${batches.length?batches.map(x=>`<div class="list-row"><div class="grow"><strong>${esc(x.learnedOn)} · ${x.learnedOn>E.day()?'等待学习日':'学习记录'}</strong><small>${x.items.map(item=>{const l=bank.lessons.find(l=>l.id===item.lessonId);return lessonLabel(l)+(l.system==='raz'?'':' / '+item.modules.map(m=>moduleNames[m]).join('、'));}).join('<br>')}</small><small>${esc(x.note||'')}</small></div></div>`).join(''):'<div class="empty">没有发布的学习批次。<br>已建库内容按默认日期自动安排，可到课程进度修改日期或记录复读。</div>'}<p class="note">日程参考学习后 1、3、7、14、30 天；答错或提示后次日再练，逾期不会一次补齐所有节点。</p></div>`;
  }
  function libraryView(){
    const bank=currentContent();
    const ready=bank.lessons.filter(l=>l.status==='ready');
    return head('PARENT’S CORNER','题库，随着学习慢慢长大。','通过对话整理课程图片，形成考点与原创练习，再更新这里的静态内容。')+
      `<div class="banner">应用 ${esc(window.REVIEW_VERSION?.app||'开发版')} · 题库 r${esc(bank.revision||'旧版')} · 构建 ${esc(window.REVIEW_VERSION?.build||'未构建')}<br><span class="note">${esc(location.host||'本地单文件')} · 当前可用 ${bank.questions.length} 题 · 已停用 ${bank.archivedCount} 题（仅保留历史）</span></div>`+
      (!storageAvailable?'<div class="card"><h3>原始记录恢复</h3><p>异常原始数据未被覆盖。先下载留存，再恢复有效的完整备份。</p><button class="button secondary" data-action="export-recovery">导出原始记录 ↓</button></div>':'')+
      `<div class="library-grid"><section>${batchesView()}<div class="card"><div class="card-header"><h2>已建立的内容</h2><span class="tag">${bank.questions.length} 题</span></div><p class="note">原创变式题，不是官方题库。未核对正文的书不会生成文章理解题。</p>${ready.map(l=>`<h3 class="section-label">${lessonLabel(l)}</h3>${bank.points.filter(p=>p.lessonId===l.id).map(p=>`<details><summary>${esc(p.title)} <span class="note">· ${bank.questions.filter(q=>q.pointId===p.id).length} 题</span></summary><p>${esc(p.description)}</p><p><strong>考点依据：</strong>${esc(p.evidence)}</p>${bank.questions.filter(q=>q.pointId===p.id).map(q=>`<div class="question-preview"><span class="tag">${typeNames[q.type]}</span><p>${esc(q.prompt)}</p>${q.passage?'<p>'+esc(q.passage)+'</p>':''}${q.audioText?'<p>朗读稿：'+esc(q.audioText)+'</p>':''}<div>${q.options.map((o,i)=>`${String.fromCharCode(65+i)}. ${esc(o)}`).join('<br>')}</div><b>答案：${esc(q.options[q.answer])}</b><div>${esc(q.explanation)}</div><p class="note">${esc(q.source)}</p></div>`).join('')}</details>`).join('')}`).join('')}</div></section>
      <aside><div class="card"><h3>对话更新题库</h3><div class="step-row"><span class="step-num">1</span><div><h3>转发学习素材</h3><p>注明实际学习日期、书名／级别和正文截图；复读时只需日期与已建库书名。</p></div></div><div class="step-row"><span class="step-num">2</span><div><h3>核对考点，建立学习批次</h3><p>生成变式题，保存来源与稳定编号。</p></div></div><div class="step-row"><span class="step-num">3</span><div><h3>发布到同一个网址</h3><p>打开网页时自动同步题库，保留本地答题记录，无需妈妈导入或配置。</p></div></div><div class="library-tools" style="margin-top:20px"><button class="button" data-action="refresh-bank">检查在线题库更新 ↻</button><button class="button secondary" data-action="import-bank">备用：导入更新包 ↑</button><button class="button secondary" data-action="export-bank">导出当前题库 ↓</button></div></div>
      <div class="card"><h3>学习记录与备份</h3><p class="note">第一版保存于当前浏览器，不自动跨设备同步。换设备前导出完整备份。</p><div class="library-tools"><button class="button secondary" data-action="export-state">导出完整备份 ↓</button><button class="button secondary" data-action="import-state">恢复完整备份 ↑</button></div></div>
      <div class="card"><h3>每组题量</h3><div class="field"><label for="size">复习上限</label><select id="size"><option value="6" ${state.settings.size===6?'selected':''}>6 题 · 轻松一点</option><option value="8" ${state.settings.size===8?'selected':''}>8 题 · 标准练习</option><option value="10" ${state.settings.size===10?'selected':''}>10 题 · 多练一点</option></select></div><p class="note">未完成的到期考点分批复习。无到期内容时可额外练习，答对不会提前推进日程。</p><button class="button secondary small" data-action="test-audio">试听英文朗读 ♫</button><p class="note" style="margin-top:10px">听力使用设备的英文朗读声音，未使用真人录音。无法朗读时支持家长读题。</p></div></aside></div><input id="bank-file" type="file" accept=".json,application/json" class="hidden"><input id="state-file" type="file" accept=".json,application/json" class="hidden">`;
  }
  function currentContent(){
    const questions=E.availableQuestions(bank),points=bank.points.filter(p=>questions.some(q=>q.pointId===p.id));
    return {...bank,points,questions,archivedCount:bank.questions.length-questions.length};
  }
  async function start(practice=false,lessonId=null){
    if(state.session&&state.session.index<state.session.items.length){resume();return;}
    if(starting)return;
    starting=true;
    try{await refreshBank(false);}finally{starting=false;}
    await syncLearning();
    const active=E.activePoints(bank,state),preview=!active.length&&!Object.keys(state.batchReceipts||{}).length;
    if(preview){
      const starter=starterLesson();
      if(!starter){toast('内容将在记录的学习日期启用，请先等待学习日或补充学习批次。');return;}
      practice=true;lessonId=starter.id;
    }
    else if(!E.duePoints(bank,state).length)practice=true;
    const items=E.plan(bank,state,{practice,lessonId,preview});
    if(!items.length){toast('暂时没有可复习内容，请检查学习日期或补充题库。');return;}
    const next=clone();next.session={items,index:0,results:[],hints:{},day:E.day(),practice,lessonId,preview};await commit(next);
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
    app.innerHTML=layoutWarning()+`<div class="quiz"><div class="quiz-top"><button class="link-button" data-action="pause">← 保存并稍后继续</button><span>英语练习 · ${position} / ${t.items.length}</span></div><div class="progress-track"><div class="progress-fill" style="width:${t.index/t.items.length*100}%"></div></div><div class="card question" data-question-id="${shown.id}"><div class="card-header"><span class="tag">${typeNames[shown.type]}</span><span class="note">${lessonLabel(shownL)}</span></div><span class="note">${esc(shownP.title)}</span>
      ${shown.type==='listening'?`<div class="audio"><button class="button" data-action="play" data-id="${shown.id}">♫ 播放听力</button><span id="audio-status" role="status">可以重复听；先听，再选答案。</span></div><div class="actions"><button class="link-button" data-action="transcript">${showTranscript?'已展开听力文本':'查看听力文本（计为使用提示）'}</button><details><summary class="note">家长读题稿</summary><p class="audio-script" lang="en">${esc(shown.audioText)}</p><p class="note">家长照稿朗读，孩子不要看屏幕；这是家长辅助入口，不是权限隔离。</p></details></div>${showTranscript||feedback?`<div class="audio-script" lang="en">${esc(shown.audioText)}</div>`:''}`:''}
      ${shown.passage?`<div class="passage" lang="en">${esc(shown.passage)}</div>`:''}<h2>${esc(shown.prompt)}</h2><div class="options">${options.map((o,i)=>`<button class="option ${selected===o.index?'selected':''} ${feedback?(o.index===shown.answer?'correct':o.index===feedback.selected?'wrong':''):''}" data-action="select" data-option="${o.index}" ${feedback?'disabled':''}><span class="letter">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span>${feedback&&o.index===shown.answer?'<span style="margin-left:auto">✓</span>':''}</button>`).join('')}</div>
      ${feedback?`<div class="feedback ${!feedback.correct?'wrong':''}" role="status"><strong>${feedback.correct?(feedback.help?'答对了，这次借助了提示':'答对了！'):'选错了，我们看看为什么。'}</strong><p>${esc(shown.explanation)}</p></div>`:''}
      <div class="quiz-actions">${feedback?`<span class="note">看懂原因后，再继续。</span><button class="button" data-action="next">${t.index===t.items.length?'查看本组结果':'下一题 →'}</button>`:t.transcriptHints?.[shown.id]?`<span class="note">已查看听力文本，本题计为使用提示。</span><span class="note">点击选项，立即查看结果。</span>`:`<label class="check"><input type="checkbox" id="help-check" ${help?'checked':''}>这题用了提示或家长帮助</label><span class="note">点击选项，立即查看结果。</span>`}</div></div><p class="note" style="margin-top:16px">不计时，慢慢想。每个答案都会保存。</p></div>`;
  }
  function seeded(id,d,n){let hash=2166136261;for(const c of id+d+n)hash=Math.imul(hash^c.charCodeAt(0),16777619);hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;return (hash>>>0)/4294967296;}
  async function submit(){
    if(selected===null||feedback||!state.session)return;
    stopAudio();
    const next=clone(),q=next.session.items[next.session.index];
    const result=E.grade(bank,next,q,selected,help,E.day());
    if(next.session.preview){
      delete next.points[result.pointId];
      for(const key of Object.keys(next.units||{}))if(key.startsWith(result.pointId+'::'))delete next.units[key];
    }
    next.session.results.push(result);next.session.index++;await commit(next);feedback=result;renderQuiz();
  }
  function nextQuestion(){stopAudio();selected=null;help=false;showTranscript=false;feedback=null;if(state.session.index===state.session.items.length)renderSummary();else renderQuiz();}
  function renderSummary(){
    const t=state.session;
    if(!t){render();return;}
    const total=t.results.length,ind=t.results.filter(r=>r.correct&&!r.help).length;
    app.innerHTML=layoutWarning()+`<div class="quiz"><div class="card summary"><div class="eyebrow">ONE SMALL STEP DONE</div><h1>这一小组，完成了。</h1><div class="score">${t.results.filter(r=>r.correct).length}<span class="muted" style="font-size:24px"> / ${total}</span></div><p class="muted">答对题数 · ${ind} 题独立答对</p><p>每练一次，都更熟悉一点。</p><div class="actions" style="justify-content:center;margin-top:25px"><button class="button" data-action="start">再练一组 →</button><button class="button secondary" data-action="finish">回到今日复习</button></div></div></div>`;
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
  function play(text){
    stopAudio();
    const status=document.getElementById('audio-status');
    const tell=msg=>{if(status)status.textContent=msg;else toast(msg);};
    if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){tell('设备不支持英文朗读，请让家长读题，或查看文本提示。');return;}
    const utter=new SpeechSynthesisUtterance(text);utter.lang='en-GB';utter.rate=.85;
    const voices=speechSynthesis.getVoices(),english=voices.find(v=>v.lang==='en-GB')||voices.find(v=>v.lang.startsWith('en'));
    if(english)utter.voice=english;
    const ticket=audioTicket;playing=true;
    utter.onstart=()=>{if(ticket===audioTicket)tell('正在播放英文…');};
    utter.onend=()=>{if(ticket===audioTicket){clearTimeout(audioTimer);playing=false;tell('播放结束，可以再听一次。');}};
    utter.onerror=()=>{if(ticket===audioTicket){clearTimeout(audioTimer);playing=false;tell('朗读未成功，请使用家长读题稿，或查看文本提示。');}};
    speechSynthesis.speak(utter);
    audioTimer=setTimeout(()=>{if(ticket===audioTicket&&playing){stopAudio();tell('朗读未完成，请使用家长读题稿或文本提示。');}},45000);
  }
  function download(filename,value){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  // Serialize local actions; each persistent write also checks the shared revision
  // under a Web Lock, so another tab can never silently overwrite this session.
  let queue=Promise.resolve();
  function run(task){
    queue=queue.then(async()=>{
      if(store.changed()){adopt(store.read());storageAvailable=true;render();toast('记录已从另一个页面同步，请再操作一次。');return;}
      await task();
    }).catch(err=>{toast(err.message||'操作未保存，请重试。');render();});
    return queue;
  }
  app.addEventListener('click',event=>run(async()=>{
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
    const action=el.dataset.action;
    if(action==='nav')navigate(el.dataset.target);
    else if(action==='system'){system=el.dataset.system;render();}
    else if(action==='record-book-repeat'){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再记录复读。');return;}
      const date=el.closest('.module-block').querySelector('[data-repeat-date]').value;
      try{const next=clone();E.addBookRepeat(bank,next,el.dataset.id,date);await commit(next);render();toast('绘本复读已记录，原题库和答题记录保留。');}catch(err){toast(err.message);}
    }
    else if(action==='record-repeat'){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再记录复读。');return;}
      const date=el.closest('.module-block').querySelector('[data-repeat-date]').value;
      try{const next=clone();E.addRepeat(bank,next,el.dataset.id,el.dataset.module,date);await commit(next);render();toast('复读已记录，原题库和答题记录保留。');}catch(err){toast(err.message);}
    }
    else if(action==='level'){level=Number(el.dataset.level);render();}
    else if(action==='start')await start();
    else if(action==='practice')await start(true);
    else if(action==='lesson-practice')await start(true,el.dataset.id);
    else if(action==='resume')resume();
    else if(action==='select'){selected=Number(el.dataset.option);await submit();}
    else if(action==='submit')await submit();
    else if(action==='next')nextQuestion();
    else if(action==='pause'){feedback=null;stopAudio();render();}
    else if(action==='finish'){const next=clone();next.session=null;await commit(next);feedback=null;render();await refreshBank();}
    else if(action==='end'&&await ask('结束这组练习？','已完成的作答和复习安排都会保留，未答题目不计入结果。')){const next=clone();next.session=null;await commit(next);render();await refreshBank();}
    else if(action==='transcript'){await rememberHelp(true,true);showTranscript=true;renderQuiz();}
    else if(action==='play')play(bank.questions.find(q=>q.id===el.dataset.id).audioText);
    else if(action==='test-audio')play('Hello! Let us review English together. I always go swimming on Tuesdays.');
    else if(action==='refresh-bank'){if(location.protocol==='file:')toast('本地单文件无法联网同步；请使用部署网址或导入更新包。');else await refreshBank();}
    else if(action==='export-bank')download('温故-题库.json',bank);
    else if(action==='export-state')download(`温故-完整备份-${E.day()}.json`,{kind:'lesson-loop-backup',version:1,exportedAt:new Date().toISOString(),bank,state});
    else if(action==='export-recovery'){
      const raw=store.recovery();
      if(!raw){toast('没有需要恢复的原始记录。');return;}
      const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');
      a.href=url;a.download=`温故-原始记录-${E.day()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    else if(action==='import-bank')document.getElementById('bank-file').click();
    else if(action==='import-state')document.getElementById('state-file').click();
  }));
  app.addEventListener('change',event=>run(async()=>{
    const el=event.target;
    if(el.dataset.bookDate){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再修改学习日期。');render();return;}
      try{const next=clone();for(const m of lessonModules(el.dataset.bookDate))E.setModuleDate(bank,next,el.dataset.bookDate,m,el.value);await commit(next);render();toast('绘本学习日期已保存，复习计划已更新。');}catch(err){toast(err.message);render();}
    }else if(el.dataset.dateLesson){
      if(state.session&&state.session.index<state.session.items.length){toast('请先完成或结束当前练习，再修改学习日期。');render();return;}
      try{const next=clone();E.setModuleDate(bank,next,el.dataset.dateLesson,el.dataset.dateModule,el.value);await commit(next);render();toast('学习日期已保存，复习计划已更新。');}catch(err){toast(err.message);render();}
    }else if(el.id==='help-check'){await rememberHelp(el.checked);el.checked=help;}
    else if(el.id==='size'){const next=clone();next.settings.size=Number(el.value);await commit(next);}
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
          if(!await ask('合并题库更新？',`合并后共有 ${merged.points.length} 个考点、${E.availableQuestions(merged).length} 道可用题。作答历史保留，停用题不再加入新练习。`))return;
          await commit(next,merged);render();toast('题库已更新，学习记录已保留。');
        }else{
          if(data.kind!=='lesson-loop-backup'||data.version!==1)throw new Error('请选择由本应用导出的完整备份。');
          E.validateBank(data.bank);E.validateState(data.state,data.bank);
          if(!await ask('恢复完整备份？','这会替换当前浏览器中的题库和学习记录。建议先导出当前备份。'))return;
          const restoredBank=E.mergeBank(data.bank,(bank.revision||0)>=(data.bank.revision||0)?bank:data.bank),restoredState=data.state;
          E.syncBatches(restoredBank,restoredState);E.validateState(restoredState,restoredBank);
          await commit(restoredState,restoredBank,baseline,{restore:true});
          stopAudio();render();toast('记录已恢复，最新发布题库保留。');
        }
      }catch(err){toast(err.message||'导入失败，现有数据没有更改。');}
      finally{el.value='';}
    }
  }));
  document.querySelectorAll('header [data-page], #parent-nav [data-page]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();navigate('today');});
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
    }catch(err){storageAvailable=false;toast(err.message||'原始记录已保护，请先导出或恢复备份。');}
    render();
    if(storageAvailable)await refreshBank();
  }
  queue=boot();
  async function tick(){
    const changed=await syncLearning();if(changed&&!state.session)render();await refreshBank();
  }
  window.addEventListener('storage',event=>{if(event.key===STORE||event.key===null)run(async()=>{});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)run(tick);});
  setInterval(()=>run(tick),120000);
})();
