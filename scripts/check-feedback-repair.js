/* Verify repair identity and dates before publishing a reviewed candidate bank. */
const fs=require('node:fs'),assert=require('node:assert/strict'),E=require('../engine');
function check(base,candidate,repairs){
  E.validateBank(base);E.validateBank(candidate);
  assert.equal(candidate.mode,'snapshot');
  assert(candidate.revision>base.revision,'修复必须递增题库版本');
  E.mergeBank(base,candidate); // Reject in-place changes to published evaluation content.
  const byId=new Map(candidate.questions.map(q=>[q.id,q])),oldById=new Map(base.questions.map(q=>[q.id,q]));
  for(const lesson of base.lessons){
    const next=candidate.lessons.find(l=>l.id===lesson.id);
    assert(next,`课程 ${lesson.id} 不能删除`);
    assert.deepEqual(next.moduleGeneratedOn,lesson.moduleGeneratedOn,'修复不能移动课程生成日期');
  }
  for(const batch of base.batches||[])assert.deepEqual(candidate.batches.find(b=>b.id===batch.id),batch,'修复不能改变学习批次');
  for(const q of base.questions)assert(byId.has(q.id),`旧题 ${q.id} 必须保留历史`);
  assert(repairs?.length,'必须提供反馈修复映射');
  for(const repair of repairs){
    assert(repair.recordIds?.length,'修复必须关联反馈记录');
    const old=oldById.get(repair.oldQuestionId),next=byId.get(repair.newQuestionId);
    assert(old&&next,'修复映射题号不存在');
    assert.notEqual(next.active,false,'修复题必须启用');
    assert.equal(next.pointId,old.pointId,'修复继续归属原练习分组');
    if(next.id!==old.id){
      assert(!oldById.has(next.id),'替换题必须使用全新编号');
      assert.equal(byId.get(old.id).active,false,'错误旧题必须停用');
      const {active:retiredActive,...retired}=byId.get(old.id),{active:originalActive,...original}=old;
      assert.deepEqual(retired,original,'退役旧题必须保留原始内容');
      assert(next.reviewUnit&&!base.questions.some(q=>q.pointId===next.pointId&&q.reviewUnit===next.reviewUnit),'修正评价内容必须使用新复习单元');
    }else{
      assert.notDeepEqual(next,old,'同号修复应有解析或参考素材变更');
    }
    assert(next.references?.length,'修复题必须保留核对依据');
  }
  return {revision:candidate.revision,repairs:repairs.length};
}
if(require.main===module){
  const [base,candidate,receipt]=process.argv.slice(2);
  if(!base||!candidate||!receipt)throw Error('用法：node scripts/check-feedback-repair.js BASE CANDIDATE RECEIPT');
  console.log(JSON.stringify(check(...[base,candidate].map(p=>JSON.parse(fs.readFileSync(p))),JSON.parse(fs.readFileSync(receipt)).repairs)));
}
module.exports={check};
