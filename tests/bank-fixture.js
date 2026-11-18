// Scheduling regressions use the original Cambridge lesson independently of
// newly published lessons and their default enrollment dates.
const publishedBank = require('../question-bank.json');
function cambridgeBank() {
  const bank = structuredClone(publishedBank);
  bank.lessons = bank.lessons.filter(l => !l.system || l.system === 'cambridge');
  // This fixture represents the pre-audit bank, which had no target inventory.
  for(const l of bank.lessons)delete l.learningTargets;
  const lessons = new Set(bank.lessons.map(l => l.id));
  bank.points = bank.points.filter(p => lessons.has(p.lessonId));
  const points = new Set(bank.points.map(p => p.id));
  bank.questions = bank.questions.filter(q => points.has(q.pointId));
  bank.batches = (bank.batches || []).filter(b => b.items.every(i => lessons.has(i.lessonId)));
  return bank;
}
module.exports = {publishedBank, cambridgeBank};
