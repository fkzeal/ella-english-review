// Scheduling regressions use the original Cambridge lesson independently of
// newly published lessons and their default enrollment dates.
const publishedBank = require('../question-bank.json');
function cambridgeBank() {
  const bank = structuredClone(publishedBank);
  bank.lessons = bank.lessons.filter(l =>
    l.id === 'l2-01' || ((!l.system || l.system === 'cambridge') && l.status === 'pending'));
  // l2-02 may have become ready in production; retain a minimal pending lesson
  // under its historical ID to exercise the original "cannot enroll" regression.
  if(!bank.lessons.some(l=>l.id==='l2-02'))bank.lessons.push({
    id:'l2-02',level:2,number:2,title:'Rules',subtitle:'规则',
    status:'pending',source:'兼容性测试：旧版尚未收到正文时的课程状态'
  });
  // This fixture represents the pre-audit bank, which had no target inventory.
  for(const l of bank.lessons)delete l.learningTargets;
  const lessons = new Set(bank.lessons.map(l => l.id));
  bank.points = bank.points.filter(p => p.lessonId === 'l2-01');
  const points = new Set(bank.points.map(p => p.id));
  bank.questions = bank.questions.filter(q => points.has(q.pointId));
  bank.batches = (bank.batches || []).filter(b => b.items.every(i => lessons.has(i.lessonId)));
  return bank;
}
module.exports = {publishedBank, cambridgeBank};
