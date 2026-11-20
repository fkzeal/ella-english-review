(function (root, factory) {
  const engine = factory(typeof module === 'object' && module.exports ? require('./rewards') : root.CatRewards);
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.ReviewEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (rewards) {
  'use strict';
  const INTERVALS = [1,3,7,14,30];
  const MODULES = ['lv','rg','skills','reading','vocabulary'];
  const TYPES = ['choice','cloze','listening','reading'];
  function day(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function validDay(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T12:00:00`);
    return !Number.isNaN(d.getTime()) && day(d) === s;
  }
  function plusDay(s, n) {
    const d = new Date(`${s}T12:00:00`);
    d.setDate(d.getDate()+n);
    return day(d);
  }
  function emptyState() {
    return {version:1, learned:{}, points:{}, history:[], session:null, settings:{size:6},batchReceipts:{},paused:{},learningDates:{},moduleDates:{},defaultDates:{},localBatches:[]};
  }
  function validateBankShape(b) {
    const fail = s => { throw new Error(`题库格式错误：${s}`); };
    if (!b || b.version !== 1 || !Array.isArray(b.lessons) || !Array.isArray(b.points) || !Array.isArray(b.questions)) fail('需要 version=1 和 lessons / points / questions 数组');
    if(b.revision!==undefined&&(!Number.isSafeInteger(b.revision)||b.revision<1))fail('题库版本无效');
    if(b.mode!==undefined&&!['snapshot','patch'].includes(b.mode))fail('题库更新模式无效');
    if (b.questions.length > 10000 || b.points.length > 3000 || b.lessons.length > 1000) fail('内容超出第一版容量');
    if(b.batches!==undefined&&(!Array.isArray(b.batches)||b.batches.length>10000))fail('学习批次无效');
    const sets = {};
    for (const key of ['lessons','points','questions',...(b.batches!==undefined?['batches']:[])]) {
      sets[key] = new Set();
      for (const item of b[key]) {
        if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || item.id in Object.prototype || sets[key].has(item.id)) fail(`${key} 存在无效或重复 ID`);
        sets[key].add(item.id);
      }
    }
    return sets;
  }
  function validateBank(b) {
    const sets=validateBankShape(b),fail=s=>{throw new Error(`题库格式错误：${s}`);};
    const text = (s,min=1,max=5000) => typeof s === 'string' && s.length >= min && s.length <= max;
    for (const l of b.lessons) {
      if (!(l.system==='raz'?/^[A-Z]{1,2}$/.test(l.level):l.system==='ket'?text(l.level):[1,2,3,4].includes(l.level)) || !Number.isInteger(l.number) || l.number < 1 || !text(l.title) || !text(l.subtitle,0) || !text(l.source) || !['ready','pending'].includes(l.status)) fail(`课程 ${l.id} 信息不完整`);
      if(l.system&&!['cambridge','raz','ket'].includes(l.system))fail(`课程 ${l.id} 类型无效`);
      if(l.generatedOn!==undefined&&!validDay(l.generatedOn))fail(`课程 ${l.id} 生成日期无效`);
      if(l.moduleGeneratedOn!==undefined&&(!l.moduleGeneratedOn||typeof l.moduleGeneratedOn!=='object'||Array.isArray(l.moduleGeneratedOn)||Object.entries(l.moduleGeneratedOn).some(([m,d])=>!MODULES.includes(m)||!validDay(d))))fail(`课程 ${l.id} 模块生成日期无效`);
    }
    for (const p of b.points) {
      if (!sets.lessons.has(p.lessonId) || !MODULES.includes(p.module) || !text(p.title) || !text(p.description) || !text(p.evidence)) fail(`考点 ${p.id} 引用或来源不完整`);
      if (b.lessons.find(l=>l.id===p.lessonId).status !== 'ready') fail(`考点 ${p.id} 不能属于待补充课程`);
    }
    for (const q of b.questions) {
      if(q.active!==undefined&&typeof q.active!=='boolean')fail(`题目 ${q.id} 启用标记无效`);
      if(q.reviewUnit!==undefined&&(!q.reviewUnit||!/^[a-zA-Z0-9_-]{1,80}$/.test(q.reviewUnit)))fail(`题目 ${q.id} 复习单元无效`);
      if (!sets.points.has(q.pointId) || !TYPES.includes(q.type) || !text(q.prompt) || !text(q.explanation) || !text(q.source)) fail(`题目 ${q.id} 信息不完整`);
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 5 || q.options.some(x=>!text(x,1,500)) || new Set(q.options).size !== q.options.length) fail(`题目 ${q.id} 选项无效`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) fail(`题目 ${q.id} 答案无效`);
      if(q.type === 'listening' && !text(q.audioText)) fail(`听力题 ${q.id} 缺少朗读稿`);
      if(q.type === 'reading' && !text(q.passage)) fail(`阅读题 ${q.id} 缺少文章`);
      if(q.references!==undefined&&(!Array.isArray(q.references)||!q.references.length||q.references.length>6||
        q.references.some(r=>!r||!['original','excerpt','note','practice'].includes(r.kind)||!text(r.text,1,5000)||!text(r.source,1,500))))
        fail(`题目 ${q.id} 参考素材无效`);
    }
    for (const p of b.points) if (!b.questions.some(q=>q.pointId===p.id)) fail(`考点 ${p.id} 没有可用题目`);
    for(const l of b.lessons)if(l.learningTargets!==undefined){
      if(!Array.isArray(l.learningTargets)||!l.learningTargets.length)fail(`课程 ${l.id} 学习目标无效`);
      const history=b.questions.filter(q=>b.points.find(p=>p.id===q.pointId).lessonId===l.id);
      const active=history.filter(q=>q.active!==false),questions=active.length?active:history;
      const ids=new Set(),covered=new Set();
      for(const t of l.learningTargets){
        if(!t||!text(t.id)||ids.has(t.id)||!text(t.title)||!text(t.evidence)||!Array.isArray(t.questionIds)||!t.questionIds.length)fail(`课程 ${l.id} 学习目标信息不完整`);
        ids.add(t.id);
        for(const id of t.questionIds){
          if(!questions.some(q=>q.id===id)||covered.has(id))fail(`课程 ${l.id} 学习目标题目重复或引用错误`);
          covered.add(id);
        }
      }
      // A wholly retired course keeps its original targets for historical backups.
      // Current courses still require exact coverage of their active questions.
      if(active.length&&covered.size!==active.length)fail(`课程 ${l.id} 存在未归入学习目标的题目`);
    }
    if(b.batches!==undefined){
      if(!Array.isArray(b.batches)||b.batches.length>10000)fail('学习批次无效');
      const ids=new Set();
      for(const batch of b.batches){
        if(!batch||typeof batch.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(batch.id)||batch.id in Object.prototype||ids.has(batch.id)||!validDay(batch.learnedOn)||!Array.isArray(batch.items)||!batch.items.length)fail('学习批次编号、日期或内容无效');
        ids.add(batch.id);
        for(const item of batch.items){
          const l=b.lessons.find(l=>l.id===item.lessonId);
          if(!l||l.status!=='ready'||!Array.isArray(item.modules)||!item.modules.length||new Set(item.modules).size!==item.modules.length||item.modules.some(m=>!MODULES.includes(m)||!b.points.some(p=>p.lessonId===l.id&&p.module===m)))fail(`批次 ${batch.id} 引用未建库内容`);
        }
      }
    }
    return b;
  }
  function validateState(s,b) {
    if (!s || s.version !== 1 || typeof s.learned !== 'object' || !s.learned || Array.isArray(s.learned) || typeof s.points !== 'object' || !s.points || Array.isArray(s.points) || !Array.isArray(s.history) || !s.settings || ![6,8,10,15,20].includes(s.settings.size)) throw new Error('学习记录格式不正确');
    for(const key of ['batchReceipts','paused','learningDates','moduleDates','defaultDates'])if(s[key]!==undefined&&(!s[key]||typeof s[key]!=='object'||Array.isArray(s[key])))throw new Error('学习批次状态不正确');
    const keys=new Set(b.points.map(p=>moduleKey(p.lessonId,p.module)));
    for(const key of ['moduleDates','defaultDates'])if(Object.entries(s[key]||{}).some(([k,d])=>!keys.has(k)||!validDay(d)))throw new Error('模块学习日期不正确');
    if(s.localBatches!==undefined)validateBank({...b,batches:s.localBatches});
    if(Object.values(s.batchReceipts||{}).some(v=>typeof v!=='string')||Object.entries(s.paused||{}).some(([id,v])=>!b.points.some(p=>p.id===id)||typeof v!=='boolean')||Object.entries(s.learningDates||{}).some(([id,v])=>!b.points.some(p=>p.id===id)||!validDay(v)))throw new Error('学习批次状态引用不正确');
    if (s.history.length > 100000) throw new Error('学习记录过大');
    for(const [id,modules] of Object.entries(s.learned)) {
      if(!b.lessons.some(l=>l.id===id) || !Array.isArray(modules) || modules.some(m=>!MODULES.includes(m)) || new Set(modules).size!==modules.length) throw new Error('学习模块引用不正确');
    }
    for(const [id,p] of Object.entries(s.points)) {
      if(!b.points.some(x=>x.id===id) || !Number.isInteger(p.stage) || p.stage<0 || p.stage>5 || !validDay(p.due) || (p.lastDay!==null&&!validDay(p.lastDay)) || (p.missDay!==null&&!validDay(p.missDay)) || !Number.isInteger(p.errors) || p.errors<0) throw new Error('考点复习记录不正确');
    }
    if(s.units!==undefined){
      if(!s.units||typeof s.units!=='object'||Array.isArray(s.units))throw new Error('复习单元记录不正确');
      const keys=new Set(b.questions.map(unitKey));
      for(const [key,u] of Object.entries(s.units))if(!keys.has(key)||!u||!Number.isInteger(u.stage)||u.stage<0||u.stage>5||!validDay(u.due)||(u.lastDay!==null&&!validDay(u.lastDay))||(u.missDay!==null&&!validDay(u.missDay))||!Number.isInteger(u.errors)||u.errors<0)throw new Error('复习单元记录不正确');
    }
    for (const h of s.history) {
      const q=b.questions.find(q=>q.id===h.questionId);
      if(!q || q.pointId!==h.pointId || !validDay(h.day) || typeof h.correct!=='boolean' || typeof h.help!=='boolean' || !Number.isInteger(h.selected) || h.selected<0 || h.selected>=q.options.length) throw new Error('作答历史不正确');
    }
    if(s.session) {
      const t=s.session;
      if(t.hints!==undefined&&(!t.hints||typeof t.hints!=='object'||Array.isArray(t.hints)||Object.entries(t.hints).some(([id,v])=>!t.items.includes(id)||v!==true)))throw new Error('练习提示记录不正确');
      if(t.transcriptHints!==undefined&&(!t.transcriptHints||typeof t.transcriptHints!=='object'||Array.isArray(t.transcriptHints)||Object.entries(t.transcriptHints).some(([id,v])=>!t.items.includes(id)||v!==true||!t.hints?.[id]||b.questions.find(q=>q.id===id)?.type!=='listening')))throw new Error('听力文本提示记录不正确');
      if(!Array.isArray(t.items)||!t.items.length||t.items.some(id=>!b.questions.some(q=>q.id===id))||new Set(t.items).size!==t.items.length||!Number.isInteger(t.index)||t.index<0||t.index>t.items.length||!validDay(t.day)||!Array.isArray(t.results)||t.results.length!==t.index) throw new Error('进行中的练习不正确');
      if(t.results.some((r,i)=>!r||r.questionId!==t.items[i]||typeof r.correct!=='boolean'||typeof r.help!=='boolean'||!Number.isInteger(r.selected)||r.selected<0||r.selected>=b.questions.find(q=>q.id===r.questionId).options.length)) throw new Error('练习结果不正确');
    }
    // Preserve old records while moving the retired 8-question choice to 10.
    rewards.validate(s);
    if(s.settings.size===8)s.settings.size=10;
    return s;
  }
  function availableQuestions(b){return b.questions.filter(q=>q.active!==false);}
  function activePoints(b,s,today=day()) { return b.points.filter(p=>availableQuestions(b).some(q=>q.pointId===p.id)&&(s.learned[p.lessonId]||[]).includes(p.module)&&!s.paused?.[p.id]&&(!s.learningDates?.[p.id]||s.learningDates[p.id]<=today)); }
  function duePoints(b,s,today=day()) { return activePoints(b,s,today).filter(p=>!s.points[p.id] || s.points[p.id].due<=today); }
  function dueUnits(b,s,today=day()){
    const points=new Set(duePoints(b,s,today).map(p=>p.id)),units=new Map();
    for(const q of availableQuestions(b)){
      if(!points.has(q.pointId)||(q.reviewUnit&&s.units?.[unitKey(q)]?.due>today))continue;
      if(!units.has(unitKey(q)))units.set(unitKey(q),q);
    }
    return [...units.values()];
  }
  function setLearned(b,s,id,module,on,today=day()) {
    const l=b.lessons.find(l=>l.id===id);
    if(!l || l.status!=='ready' || !MODULES.includes(module)) throw new Error('该课程尚无可用考点');
    const available=b.points.some(p=>p.lessonId===id&&p.module===module);
    if(!available) throw new Error('该模块尚未建立题库');
    let modules=s.learned[id]||[];
    s.learned[id]=on?[...new Set([...modules,module])]:modules.filter(m=>m!==module);
    s.paused ||= {};
    for(const p of b.points.filter(p=>p.lessonId===id&&p.module===module))s.paused[p.id]=!on;
    if(on) for(const p of b.points.filter(p=>p.lessonId===id&&p.module===module)) {
      if(!s.points[p.id]) s.points[p.id]={stage:0,due:today,lastDay:null,missDay:null,errors:0};
    }
  }
  function moduleKey(id,module){return `${id}--${module}`;}
  function moduleDate(b,s,id,module,today=day()){
    const key=moduleKey(id,module);
    if(s.moduleDates?.[key])return {date:s.moduleDates[key],source:'manual'};
    const first=(b.batches||[]).filter(batch=>batch.items.some(i=>i.lessonId===id&&i.modules.includes(module))).sort((a,c)=>a.learnedOn.localeCompare(c.learnedOn))[0];
    if(first)return {date:first.learnedOn,source:'batch'};
    const lesson=b.lessons.find(l=>l.id===id);
    const generated=lesson?.moduleGeneratedOn?.[module]||lesson?.generatedOn||b.updated;
    return {date:s.defaultDates?.[key]||plusDay(validDay(generated)?generated:today,-1),source:'default'};
  }
  function learningEvents(b,s,today=day()){
    const events=[],first=new Map();
    const canonical=[...(b.batches||[])].sort((a,c)=>a.learnedOn.localeCompare(c.learnedOn)||a.id.localeCompare(c.id));
    for(const batch of canonical)for(const item of batch.items)for(const m of item.modules){
      const key=moduleKey(item.lessonId,m),isFirst=!first.has(key);first.set(key,true);
      events.push({...batch,id:`${batch.id}--${key}`,learnedOn:isFirst&&s.moduleDates?.[key]?s.moduleDates[key]:batch.learnedOn,items:[{lessonId:item.lessonId,modules:[m]}]});
    }
    for(const l of b.lessons.filter(l=>l.status==='ready'))for(const m of new Set(b.points.filter(p=>p.lessonId===l.id).map(p=>p.module))){
      const key=moduleKey(l.id,m);
      if(!first.has(key)){
        const info=moduleDate(b,s,l.id,m,today);
        if(info.source==='default'){s.defaultDates ||= {};s.defaultDates[key]=info.date;}
        events.push({id:`default--${key}`,learnedOn:info.date,items:[{lessonId:l.id,modules:[m]}],note:'默认日期，可在课程进度修改'});
      }
    }
    return [...events,...(s.localBatches||[])];
  }
  function setModuleDate(b,s,id,module,date,today=day()){
    if(!validDay(date))throw new Error('请选择有效的学习日期');
    if(!b.points.some(p=>p.lessonId===id&&p.module===module))throw new Error('该模块尚未建库');
    const published=(b.batches||[]).filter(x=>x.items.some(i=>i.lessonId===id&&i.modules.includes(module))).sort((a,c)=>a.learnedOn.localeCompare(c.learnedOn));
    const repeats=[...published.slice(1),...(s.localBatches||[]).filter(x=>x.items.some(i=>i.lessonId===id&&i.modules.includes(module)))];
    if(repeats.some(x=>x.learnedOn<date))throw new Error('首次学习日期不能晚于已有复读日期，请先核对日期。');
    s.moduleDates ||= {};s.moduleDates[moduleKey(id,module)]=date;
    syncBatches(b,s,today);
    if(date>today)for(const p of b.points.filter(p=>p.lessonId===id&&p.module===module))if(s.points[p.id].due<plusDay(date,1))s.points[p.id].due=plusDay(date,1);
  }
  function addRepeat(b,s,id,module,date,today=day()){
    if(!validDay(date)||date>today)throw new Error('复读日期不能晚于今天');
    if(date<moduleDate(b,s,id,module,today).date)throw new Error('复读日期不能早于首次学习日期');
    if(!b.points.some(p=>p.lessonId===id&&p.module===module))throw new Error('该模块尚未建库');
    s.localBatches ||= [];
    if(s.localBatches.some(x=>x.learnedOn===date&&x.items.some(i=>i.lessonId===id&&i.modules.includes(module))))return;
    s.localBatches.push({id:`local-${Date.now()}-${s.localBatches.length}`,learnedOn:date,items:[{lessonId:id,modules:[module]}],note:'家长记录复读'});
    syncBatches(b,s,today);
  }
  // Published learning events are content; receipts and performance belong to the learner.
  function addBookRepeat(b,s,id,date,today=day()){
    if(b.lessons.find(l=>l.id===id)?.system!=='raz')throw new Error('该课程不是 RAZ 绘本');
    const modules=[...new Set(b.points.filter(p=>p.lessonId===id).map(p=>p.module))];
    if(!modules.length)throw new Error('该绘本尚未建库');
    if(!validDay(date)||date>today)throw new Error('复读日期不能晚于今天');
    for(const m of modules)if(date<moduleDate(b,s,id,m,today).date)throw new Error('复读日期不能早于首次学习日期');
    const missing=modules.filter(m=>!(s.localBatches||[]).some(x=>x.learnedOn===date&&x.items.some(i=>i.lessonId===id&&i.modules.includes(m))));
    if(!missing.length)return;
    s.localBatches ||= [];
    s.localBatches.push({id:`local-${Date.now()}-${s.localBatches.length}`,learnedOn:date,items:[{lessonId:id,modules:missing}],note:'家长记录绘本复读'});
    syncBatches(b,s,today);
  }
  // Reconciliation is idempotent and never overwrites an answered point's performance.
  function syncBatches(b,s,today=day()){
    // Old unchecked modules must not suppress automatically enrolled content.
    // Keep the legacy field readable by old backups, but retire its pause flags.
    s.batchReceipts ||= {};s.paused = {};s.learningDates ||= {};
    const all=learningEvents(b,s,today);
    const events=all.filter(x=>x.learnedOn<=today).sort((a,c)=>a.learnedOn.localeCompare(c.learnedOn)||a.id.localeCompare(c.id));
    const dates=new Map(b.points.map(p=>[p.id,moduleDate(b,s,p.lessonId,p.module,today).date]));
    for(const batch of events){
      for(const item of batch.items){
        for(const p of b.points.filter(p=>p.lessonId===item.lessonId&&item.modules.includes(p.module))){
          if(dates.get(p.id)>today||batch.learnedOn<dates.get(p.id))continue;
          s.learned[p.lessonId]=[...new Set([...(s.learned[p.lessonId]||[]),p.module])];
          // Repeated reading brings the next check closer, without pretending it was answered.
          const check=plusDay(batch.learnedOn,1),point=s.points[p.id];
          if(point?.lastDay&&batch.learnedOn>point.lastDay&&check<point.due)point.due=check;
          // A sibling's recent answer must not hide an older unit's repeat.
          // Taking only an earlier due date also repairs old missed receipts idempotently.
          for(const [key,unit] of Object.entries(s.units||{}))if(key.startsWith(p.id+'::')&&unit.lastDay&&batch.learnedOn>unit.lastDay&&check<unit.due)unit.due=check;
        }
      }
      s.batchReceipts[batch.id]=JSON.stringify({learnedOn:batch.learnedOn,items:batch.items});
    }
    for(const [id,date] of dates){
      const dateChanged=s.learningDates[id]!==date;
      s.learningDates[id]=date;
      const due=plusDay(date,1);
      if(!s.points[id]||s.points[id].lastDay===null){
        const old=s.points[id];
        s.points[id]={stage:0,due,lastDay:null,missDay:null,errors:old?.errors||0};
      }
      if(date>today&&s.points[id].due<due)s.points[id].due=due;
      for(const [key,unit] of Object.entries(s.units||{}))if(key.startsWith(id+'::')&&((dateChanged&&unit.lastDay===null)||(date>today&&unit.due<due)))unit.due=due;
    }
    syncUnits(b,s,today);
    return s;
  }
  function unitKey(q){return `${q.pointId}::${q.reviewUnit||'all'}`;}
  function syncUnits(b,s,today=day()){
    s.units ||= {};
    for(const q of availableQuestions(b).filter(q=>q.reviewUnit)){
      const key=unitKey(q);
      if(!s.units[key]){
        // Older broad scores cannot establish mastery of an individual word.
        const old=s.points[q.pointId],anchor=s.learningDates?.[q.pointId];
        s.units[key]={stage:0,due:anchor>today?plusDay(anchor,1):old?.lastDay?today:old?.due||today,lastDay:null,missDay:null,errors:0};
      }
    }
    for(const p of b.points){
      const units=[...new Set(availableQuestions(b).filter(q=>q.pointId===p.id&&q.reviewUnit).map(unitKey))].map(key=>s.units[key]);
      if(!units.length||!s.points[p.id])continue;
      const old=s.points[p.id];
      s.points[p.id]={...old,stage:Math.min(...units.map(u=>u.stage)),due:units.map(u=>u.due).sort()[0],
        lastDay:units.map(u=>u.lastDay).filter(Boolean).sort().at(-1)||old.lastDay,
        missDay:units.map(u=>u.missDay).filter(Boolean).sort().at(-1)||old.missDay};
    }
  }
  function shuffle(a,rng=Math.random) {
    a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a;
  }
  function plan(b,s,{today=day(),size=s.settings.size,practice=false,lessonId=null,preview=false,rng=Math.random}={}) {
    let points=preview&&practice?b.points:practice?activePoints(b,s,today):duePoints(b,s,today);
    if(lessonId) points=points.filter(p=>p.lessonId===lessonId);
    points=shuffle(points,rng);
    const candidates=new Map(points.map(p=>[p.id,shuffle(availableQuestions(b).filter(q=>q.pointId===p.id&&(practice||!q.reviewUnit||!s.units?.[unitKey(q)]||s.units[unitKey(q)].due<=today)),rng).sort((a,c)=>{
      const ha=s.history.filter(h=>h.questionId===a.id),hc=s.history.filter(h=>h.questionId===c.id);
      const ua=s.units?.[unitKey(a)],uc=s.units?.[unitKey(c)];
      const weak=u=>u?.missDay&&u.missDay===u.lastDay?0:1;
      return weak(ua)-weak(uc)||(ua?.due||today).localeCompare(uc?.due||today)||ha.length-hc.length || (ha.at(-1)?.day||'').localeCompare(hc.at(-1)?.day||'');
    })]));
    // Rank groups by the units actually eligible today, not historical aggregate
    // errors. A recovered word must not hide another still-weak word in its group.
    const record=p=>{
      const q=candidates.get(p.id)[0];
      return q&&(s.units?.[unitKey(q)]||s.points[p.id]);
    };
    const weak=u=>u?.missDay&&u.missDay===u.lastDay&&u.due<=today?0:1;
    points=points.filter(p=>candidates.get(p.id).length).sort((a,c)=>{
      const ua=record(a),uc=record(c);
      return weak(ua)-weak(uc)||(ua?.due||today).localeCompare(uc?.due||today);
    });
    const groups=new Map();
    for(const p of points){if(!groups.has(p.lessonId))groups.set(p.lessonId,[]);groups.get(p.lessonId).push(p);}
    // Least recently practised lessons get the next turn when there are more
    // lessons than slots. Within each lesson, weak and overdue units come first.
    const pointLessons=new Map(b.points.map(p=>[p.id,p.lessonId])),lastPractised=new Map();
    s.history.forEach((h,index)=>lastPractised.set(pointLessons.get(h.pointId),index));
    const lastPractice=id=>lastPractised.get(id)??-1;
    const queues=[...groups].sort(([a],[c])=>lastPractice(a)-lastPractice(c)).map(([,ps])=>ps);
    points=[];
    while(queues.some(g=>g.length))for(const g of queues)if(g.length)points.push(g.shift());
    const items=[];
    const usedUnits=new Set();
    while(items.length<size) {
      let added=false;
      for(const p of points) {
        const q=candidates.get(p.id).find(q=>!items.includes(q.id)&&(!q.reviewUnit||!usedUnits.has(unitKey(q))));
        if(q){items.push(q.id);usedUnits.add(unitKey(q));added=true;}
        if(items.length>=size) break;
      }
      if(!added) break;
    }
    return items;
  }
  function grade(b,s,id,selected,help=false,today=day()) {
    const q=b.questions.find(q=>q.id===id);
    if(!q||!Number.isInteger(selected)||selected<0||selected>=q.options.length) throw new Error('答案无效');
    help=Boolean(help||s.session?.hints?.[id]);
    const correct=selected===q.answer;
    if(q.reviewUnit)syncUnits(b,s,today);
    const p=(q.reviewUnit?s.units[unitKey(q)]:s.points[q.pointId])||{stage:0,due:today,lastDay:null,missDay:null,errors:0};
    const already=p.lastDay===today;
    if(!correct) {p.stage=0;p.errors++;p.due=plusDay(today,1);p.missDay=today;}
    else if(help){p.stage=0;p.due=plusDay(today,1);p.missDay=today;}
      else if(!already&&p.missDay!==today&&p.due<=today){
      p.stage=Math.min(5,p.stage+1);
      const anchor=p.missDay?null:s.learningDates?.[q.pointId];
      // Scheduled checkpoints are learning day + 1, 3, 7, 14, 30.
      // On-time answers keep this calendar; overdue/missed answers get a new anchor.
      const expected=anchor&&p.stage<=5?plusDay(anchor,INTERVALS[p.stage-1]):null;
      if(expected===today&&p.stage<5)p.due=plusDay(anchor,INTERVALS[p.stage]);
      else p.due=plusDay(today,INTERVALS[anchor?Math.min(4,p.stage):p.stage-1]);
    }
    p.lastDay=today;
    if(q.reviewUnit){
      s.units[unitKey(q)]=p;
      s.points[q.pointId] ||= {...p,errors:0};
      if(!correct)s.points[q.pointId].errors++;
      syncUnits(b,s,today);
    }else s.points[q.pointId]=p;
    const result={questionId:id,pointId:q.pointId,selected,correct,help,day:today};
    s.history.push(result);
    return result;
  }
  function mergeBank(current, incoming) {
    if(incoming?.mode==='patch')validateBankShape(incoming);
    else validateBank(incoming);
    if(incoming.revision&&current.revision&&incoming.revision<current.revision)throw new Error('题库版本较旧，已保留当前题库。');
    const merged={...current,...incoming,version:1,updated:incoming.updated||current.updated};
    for(const k of ['lessons','points','questions','batches']){
      const m=new Map((current[k]||[]).map(x=>[x.id,k==='questions'&&incoming.mode==='snapshot'?{...x,active:false}:x]));
      (incoming[k]||[]).forEach(x=>{
        const old=(current[k]||[]).find(v=>v.id===x.id);
        const fields=k==='questions'?['pointId','type','prompt','options','answer','audioText','passage']:k==='points'?['lessonId','module']:[];
        if(old&&fields.some(f=>JSON.stringify(old[f])!==JSON.stringify(x[f])))throw new Error(`已发布编号 ${x.id} 的内容不能替换，请使用新编号。`);
        if(k==='questions'&&old?.reviewUnit&&old.reviewUnit!==x.reviewUnit)throw new Error(`复习单元 ${x.id} 不能替换，请使用新编号。`);
        m.set(x.id,x);
      });
      merged[k]=[...m.values()];
    }
    return validateBank(merged);
  }
  return {INTERVALS,MODULES,TYPES,day,validDay,plusDay,emptyState,validateBank,validateState,availableQuestions,activePoints,duePoints,dueUnits,setLearned,moduleKey,moduleDate,setModuleDate,addRepeat,addBookRepeat,syncBatches,syncUnits,unitKey,shuffle,plan,grade,mergeBank};
});
