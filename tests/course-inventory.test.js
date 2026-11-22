'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');

test('reviewed materials awaiting source integration remain visible on later full scans',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ella-material-integration-'));
  try{
    const token='existing-reviewed-image',documentId='RhNgdppuWoKp6kxjE24cOwjfnwh';
    const entry={status:'pending-integration',lessonId:'scholastic-real-animal',
      candidatePath:'private/candidate.patch.json',note:'True source system is not supported.'};
    fs.writeFileSync(path.join(dir,'ledger.json'),JSON.stringify({version:1,
      documentUrl:'https://dcar.feishu.cn/docx/'+documentId,media:{[token]:entry},runs:[]}));
    const snapshot=path.join(dir,'document.json');
    fs.writeFileSync(snapshot,JSON.stringify({ok:true,data:{document:{document_id:documentId,revision_id:60,
      content:'<title>Materials</title><img token="'+token+'" id="known-block"/>'}}}));
    const before=fs.readFileSync(path.join(dir,'ledger.json'),'utf8');
    const r=spawnSync('python3',['scripts/course-import.py','scan','--state',dir,'--snapshot',snapshot],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const scan=JSON.parse(fs.readFileSync(path.join(dir,'scan.json')));
    assert.equal(scan.newImages.length,0);
    assert.equal(scan.knownImages,1);
    assert.deepEqual(scan.unresolvedImages,[{fileToken:token,...entry}]);
    assert.equal(fs.readFileSync(path.join(dir,'ledger.json'),'utf8'),before);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
