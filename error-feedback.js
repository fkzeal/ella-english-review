(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReviewErrorFeedback=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function url(config,q,lesson,revision,version,feedbackId){
    if(!config?.formUrl)return '';
    const link=new URL(config.formUrl);
    if(link.protocol!=='https:')throw new Error('反馈表单必须使用 HTTPS。');
    const course=lesson.system==='raz'?`RAZ ${lesson.level} · ${lesson.title}`:
      lesson.system==='ket'?`KET · ${lesson.title}`:`Level ${lesson.level} · Lesson ${lesson.number} · ${lesson.title}`;
    const content=[q.prompt,q.passage&&`阅读材料：${q.passage}`,q.audioText&&`听力文本：${q.audioText}`,
      ...q.options.map((text,i)=>`${String.fromCharCode(65+i)}. ${text}`),
      `题库答案：${q.options[q.answer]}`,`解析：${q.explanation}`].filter(Boolean).join('\n');
    const fields={'反馈编号':feedbackId,'题目编号':q.id,'课程':course,'题目内容':content,
      '题库版本':revision||1,'应用版本':version?.app||'开发版'};
    for(const [name,value] of Object.entries(fields))link.searchParams.set(`prefill_${name}`,String(value));
    return link.href;
  }
  return {url};
});
