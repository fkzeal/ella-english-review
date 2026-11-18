// Run only when intentionally rebuilding the initial content, not on normal updates.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source='对话上传的 IMG_5134–5137；原创变式练习，非官方原题';
const lessons=[
  {id:'l2-01',level:2,number:1,title:'My week',subtitle:'我的一周',status:'ready',source:'IMG_5130、IMG_5135–5137；仅覆盖可见内容'},
  ...[
    ['Rules','规则'],["Let's be safe!",'注意安全'],['A trip in the count…','原截图标题截断，待补充'],
    ['My day','我的一天'],['Look after the Ear…','原截图标题截断，待补充'],['A costume party','化装舞会'],
    ["It's party time!",'派对时间'],['People who help us','帮助我们的人']
  ].map((x,i)=>({id:`l2-${String(i+2).padStart(2,'0')}`,level:2,number:i+2,title:x[0],subtitle:x[1],status:'pending',source:'IMG_5130；目前仅确认目录，未建立考点'}))
];
const points=[
  {id:'l2-01-days',lessonId:'l2-01',module:'lv',title:'星期与顺序',description:'识别星期名称，理解一周中的先后顺序。',evidence:'IMG_5137 中周历列出 Mon.–Sun.；顺序题为基于周历的原创练习。'},
  {id:'l2-01-activities',lessonId:'l2-01',module:'lv',title:'活动表达',description:'理解 go swimming、play the piano、read books。',evidence:'IMG_5137 中游泳、钢琴及书本图标；活动词组为对应图意的变式练习。'},
  {id:'l2-01-frequency',lessonId:'l2-01',module:'rg',title:'always 与 never',description:'结合情境理解“总是”和“从不”，选出正确表达。',evidence:'IMG_5136：It always cleans its face. But it never washes its face in the water.'},
  {id:'l2-01-listen',lessonId:'l2-01',module:'skills',title:'听懂活动与星期',description:'听简短句子，辨认谁在哪天做什么。',evidence:'IMG_5137：I always go swimming on Tuesdays. 基于已确认句型的原创听力。'},
  {id:'l2-01-read',lessonId:'l2-01',module:'skills',title:'读懂一周安排',description:'读短文或周计划，寻找明确信息并概括主要内容。',evidence:'IMG_5137 周历与 Let’s read；短文为原创变式，不是课程原文。'}
];
const questions=[];
function add(point,type,prompt,options,answer,explanation,extra={}) {
  questions.push({id:`${point}-q${String(questions.filter(q=>q.pointId===point).length+1).padStart(2,'0')}`,pointId:point,type,prompt,options,answer,explanation,source,...extra});
}
const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
for(let i=0;i<7;i++) add('l2-01-days','choice',`“${['星期一','星期二','星期三','星期四','星期五','星期六','星期日'][i]}”对应哪个英文单词？`,[days[i],days[(i+2)%7],days[(i+4)%7]],0,`${days[i]} 表示${['星期一','星期二','星期三','星期四','星期五','星期六','星期日'][i]}。`);
for(let i=0;i<5;i++) add('l2-01-days','cloze',`${days[i]}, _____, ${days[i+2]}`, [days[(i+3)%7],days[i+1],days[(i+4)%7]],1,`${days[i]} 后一天是 ${days[i+1]}，再后一天是 ${days[i+2]}。`);
for(const [en,zh,others] of [
  ['go swimming','去游泳',['play the piano','read books']],
  ['play the piano','弹钢琴',['read books','go swimming']],
  ['read books','读书',['go swimming','play the piano']]
]) {
  add('l2-01-activities','choice',`哪个短语表示“${zh}”？`,[...others,en],2,`${en} 表示“${zh}”。`);
  add('l2-01-activities','choice',`“${en}”是什么意思？`,[zh,...(['去游泳','弹钢琴','读书'].filter(x=>x!==zh))],0,`${en} 表示“${zh}”。`);
}
for(const [name,activity,zh] of [['I','go swimming','游泳'],['I','read books','读书'],['I','play the piano','弹钢琴']]) {
  add('l2-01-frequency','cloze',`我每个星期二都${zh}。选词：\n${name} _____ ${activity} on Tuesdays.`,['never','always'],1,'每次都做，用 always（总是）。never 表示从不。');
  add('l2-01-frequency','cloze',`我从不在星期一${zh}。选词：\n${name} _____ ${activity} on Mondays.`,['always','never'],1,'从不做，用 never。');
}
add('l2-01-frequency','choice','It always cleans its face. 这句话里的 always 是什么意思？',['偶尔','从不','总是'],2,'always 的意思是“总是”。句意：它总是清洁自己的脸。');
add('l2-01-frequency','choice','It never washes its face in the water. 这句话里的 never 是什么意思？',['总是','从不','有时'],1,'never 的意思是“从不”。');
for(const [name,activity,date,answer,options] of [
  ['Tom','go swimming','Tuesdays',1,['Mondays','Tuesdays','Fridays']],
  ['Anna','read books','Fridays',2,['Sundays','Wednesdays','Fridays']],
  ['Ben','play the piano','Wednesdays',0,['Wednesdays','Mondays','Saturdays']],
  ['Lucy','go swimming','Sundays',1,['Saturdays','Sundays','Thursdays']],
  ['Sam','read books','Mondays',0,['Mondays','Fridays','Tuesdays']],
  ['Amy','play the piano','Saturdays',2,['Wednesdays','Sundays','Saturdays']]
]) add('l2-01-listen','listening',`听一听：${name} 在哪天进行这项活动？`,options,answer,`录音说 on ${date}，所以选 ${date}。`,{audioText:`Hi, I'm ${name}. I always ${activity} on ${date}.`});
add('l2-01-listen','listening','听一听：说话的人每周二做什么？',['read books','play the piano','go swimming'],2,'录音说 I always go swimming on Tuesdays. 每周二去游泳。',{audioText:'I always go swimming on Tuesdays.'});
add('l2-01-listen','listening','听一听：说话的人从不在星期一做什么？',['go swimming','read books','play the piano'],0,'录音中的 never go swimming 表示从不去游泳。',{audioText:'I never go swimming on Mondays.'});
for(const [name,d1,d2] of [['Anna','Tuesdays','Fridays'],['Ben','Wednesdays','Sundays'],['Lucy','Saturdays','Mondays']]) {
  const passage=`Hi, I'm ${name}. I always go swimming on ${d1}. I read books on ${d2}. I never play the piano on ${d1}.`;
  add('l2-01-read','reading',`${name} 在哪天读书？`,[d1,d2,'Thursdays'],1,`短文中 I read books on ${d2}. 给出了答案。`,{passage});
  add('l2-01-read','reading',`${name} 在 ${d1} 做什么？`,['play the piano','read books','go swimming'],2,`I always go swimming on ${d1}. 表示这天去游泳。`,{passage});
  add('l2-01-read','reading','这段短文主要介绍什么？',['一周的活动安排','怎样清洁脸','一本书的故事'],0,'短文介绍不同星期做什么，主要讲一周的活动安排。',{passage});
}
const bank={version:1,updated:'2026-11-16',lessons,points,questions};
require('../engine.js').validateBank(bank);
fs.writeFileSync(path.join(root,'question-bank.json'),JSON.stringify(bank,null,2)+'\n');
fs.writeFileSync(path.join(root,'bank.js'),'window.LESSON_BANK = '+JSON.stringify(bank,null,2)+';\n');
console.log(`Seed bank: ${lessons.length} lessons, ${points.length} points, ${questions.length} questions`);
