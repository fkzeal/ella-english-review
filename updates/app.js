'use strict';
const labels={framework:'框架已就绪',published:'题库已上线','no-change':'共享题库无新增',partial:'部分完成',failed:'执行受阻'};
const changes={sample:'既有题 · 示例',added:'新增题',fixed:'修正题',optimized:'优化题',derived:'衍生题'};
const sectionNames={materials:'新素材',questions:'新增题',fixes:'题目纠错',optimizations:'考点优化',derivatives:'错题衍生'};
let reports=[],current,filter='all';
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function renderQuestions(){
  const container=document.querySelector('#questions');container.replaceChildren();
  const visible=current.questions.filter(q=>filter==='all'||q.change===filter);
  document.querySelector('#question-count').textContent=`(${visible.length})`;
  if(!visible.length){container.append(el('div',current.status==='framework'?'这一类还没有真实更新。当前题目仅用于展示页面框架。':'这一轮没有此类题目变化。读取失败或未完成的事项见上方维护状态。','empty'));return;}
  visible.forEach((q,i)=>{
    const card=el('article',undefined,'card');card.style.animationDelay=`${i*35}ms`;
    const meta=el('div',undefined,'card-meta');meta.append(el('span',q.lesson,'course'),el('span',changes[q.change],'tag'));
    card.append(meta,el('p',q.target,'target'),el('h3',q.prompt));
    for(const field of ['passage','audioText'])if(q[field])card.append(el('p',q[field],'material'));
    if(q.options)q.options.forEach((option,index)=>{const row=el('div',undefined,'option');row.append(el('span',String.fromCharCode(65+index),'option-letter'),el('span',option));card.append(row);});
    card.append(el('p',q.change==='sample'?'已发布的旧题，用于预览；不计入今日新增。':q.reason,'reason'));
    const details=el('details');details.append(el('summary','查看答案与依据'));
    const answer=Array.isArray(q.answer)?q.answer.join(' / '):Number.isInteger(q.answer)&&q.options?`${String.fromCharCode(65+q.answer)} · ${q.options[q.answer]}`:String(q.answer);
    details.append(el('p',`答案：${answer}`,'answer'),el('p',q.explanation,'explanation'));
    for(const ref of q.references||[]){const quote=el('blockquote',ref.text,'reference');quote.append(el('small',ref.source));details.append(quote);}
    card.append(details,el('p',`${q.id} · ${q.type} · ${q.reviewUnit}`,'question-id'));container.append(card);
  });
}
function renderReport(){
  document.querySelector('#status').textContent=labels[current.status];
  document.querySelector('#summary').textContent=current.summary;
  document.querySelector('#revision').textContent=`题库 r${current.bankRevision}`;
  const legacyCount=Number(current.sections.derivatives.value);
  document.querySelector('#derivative-note').hidden=!(legacyCount>0&&!current.questions.some(q=>q.change==='derived'));
  const overview=document.querySelector('#overview');overview.replaceChildren();
  for(const [key,name] of Object.entries(sectionNames)){const info=current.sections[key];const metric=el('div',undefined,'metric');metric.append(el('h3',name),el('strong',info.value),el('p',info.note));overview.append(metric);}
  document.querySelector('#updated-at').textContent=`记录于 ${new Date(current.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`;
  const todos=document.querySelector('#todos');todos.replaceChildren(...current.todos.map(t=>el('li',t)));
  document.querySelector('#follow-up').hidden=!current.todos.length;
  filter='all';document.querySelectorAll('#filters button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter==='all')));renderQuestions();
}
document.querySelector('#filters').addEventListener('click',event=>{const button=event.target.closest('button');if(!button||!current)return;filter=button.dataset.filter;document.querySelectorAll('#filters button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderQuestions();});
document.querySelector('#report-date').addEventListener('change',event=>{current=reports.find(r=>r.runId===event.target.value);renderReport();});
(async()=>{
  try{
    const response=await fetch('reports.json',{cache:'no-store'});if(!response.ok)throw new Error('read failed');
    const data=await response.json();if(data.version!==1||!data.reports?.length)throw new Error('empty archive');
    reports=data.reports;
    const select=document.querySelector('#report-date');select.replaceChildren(...reports.map(r=>{const option=el('option',`${r.date} · ${labels[r.status]}`);option.value=r.runId;return option;}));
    current=reports.find(r=>r.runId===new URLSearchParams(location.search).get('run'))||reports[0];select.value=current.runId;select.disabled=false;renderReport();
  }catch(error){document.querySelector('#status').textContent='暂时无法读取';document.querySelector('#summary').textContent='每日记录暂时无法加载，请稍后刷新。这里不会把读取失败显示成“没有新增”。';document.querySelector('#questions').append(el('p','请稍后再试。','empty'));}
})();
