'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('feedback confirms eventual Base reads without writing again and fails closed on timeout',()=>{
  const python=spawnSync('python3',['-c',`
import importlib.util, pathlib, tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('feedback', 'scripts/feedback-maintenance.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
stale=[{'record_id':'test-record','处理状态':['待核查'],'修复说明':None}]
fresh=[{'record_id':'test-record','处理状态':['需补充素材'],'修复说明':'verified note'}]
with tempfile.TemporaryDirectory() as folder:
    root=pathlib.Path(folder)
    with patch.object(module,'fetch_records',side_effect=[stale,stale,fresh]) as read, patch.object(module.time,'sleep') as wait, patch.object(module,'command') as write:
        module.confirm_updates({},root,{'test-record':{}},'需补充素材','verified note')
        assert read.call_count==3 and wait.call_count==2
        assert not write.called
        assert (root/'after-retry-2').is_dir()
with tempfile.TemporaryDirectory() as folder:
    with patch.object(module,'fetch_records',return_value=stale) as read, patch.object(module.time,'sleep'), patch.object(module,'command') as write:
        try: module.confirm_updates({},pathlib.Path(folder),{'test-record':{}},'需补充素材','verified note')
        except ValueError: pass
        else: raise AssertionError('Unconfirmed writes must fail closed')
        assert read.call_count==5 and not write.called
print('eventual read / timeout / read-only retry PASS')
`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);
  assert.match(python.stdout,/PASS/);
});
