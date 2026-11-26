"""Local account end-to-end checks. Run through webapp-testing with_server.py."""
import json
import os
import urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = "https://ella-english-review.pages.dev"
LOCAL = "http://127.0.0.1:4187"
with urllib.request.urlopen(LOCAL + "/__test__/bootstrap") as response:
    fixture = json.load(response)
os.makedirs("/tmp/ella-cloud-evidence", exist_ok=True)

with sync_playwright() as p:
    for engine, account in [(p.chromium, "ella"), (p.webkit, "dad")]:
        if os.environ.get("ELLA_BROWSER") and os.environ["ELLA_BROWSER"] != engine.name:
            continue
        browser = engine.launch(headless=True)
        errors = []
        offline = [False]

        def context(seed=False):
            ctx = browser.new_context(viewport={"width": 1024, "height": 900})
            def intercept(route):
                if offline[0] and "/api/" in route.request.url:
                    route.abort()
                else:
                    response = route.fetch(url=route.request.url.replace(BASE, LOCAL))
                    route.fulfill(response=response)
            ctx.route(BASE + "/**", intercept)
            if seed:
                ctx.add_init_script("if(!localStorage.getItem('lesson-loop-data-v1'))localStorage.setItem('lesson-loop-data-v1'," + json.dumps(json.dumps(fixture["seed"])) + ");")
                ctx.add_init_script("""(()=>{
                  if(localStorage.getItem('fixture-quota-seeded'))return;
                  const b=JSON.parse(localStorage.getItem('lesson-loop-data-v1'));
                  b.bank.revision-=1;b.baseline=JSON.stringify(b.bank);
                  localStorage.setItem('lesson-loop-data-v1',JSON.stringify(b));
                  localStorage.setItem('fixture-quota-seeded','true');
                  for(let n=0;n<32;n++){
                    try{localStorage.setItem('ella-account-v1-conflict-prefill-'+n,JSON.stringify(b));}
                    catch(e){window.__legacyQuotaReached=e.name==='QuotaExceededError';break;}
                  }
                  window.__legacyQuotaBytes=Object.keys(localStorage).reduce((n,k)=>n+2*(k.length+localStorage.getItem(k).length),0);
                })();""")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            return ctx, page

        def saved(page):
            return page.evaluate("JSON.parse(localStorage.getItem('lesson-loop-data-v1')).state")

        def bind(page, id, import_local=True):
            expect(page.locator("#account-dialog")).to_be_visible()
            expect(page.locator("#account-form [type=submit]")).to_be_enabled()
            page.locator("#account-choice").select_option(id)
            page.locator("#account-code").fill(fixture["codes"][id])
            if page.locator("#account-confirm").is_visible():
                expect(page.locator("#account-mode")).to_contain_text("还没有绑定过设备")
                page.locator("#account-confirm").fill("not-the-same-password")
                page.locator("#account-form [type=submit]").click()
                expect(page.locator("#account-error")).to_contain_text("两次输入的密码不一致")
                page.locator("#account-confirm").fill(fixture["codes"][id])
            else:
                expect(page.locator("#account-mode")).to_contain_text("已设置密码")
            if not import_local and page.locator("#account-import").count():
                page.locator("#account-import").uncheck()
            page.locator("#account-form [type=submit]").click()
            expect(page.locator("#account-dialog")).not_to_be_visible(timeout=15000)
            assert saved(page)["accountId"] == id

        first, page = context(seed=True)
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        assert page.evaluate("window.__legacyQuotaReached===true")
        legacy_bytes=page.evaluate("window.__legacyQuotaBytes")
        assert page.evaluate("()=>Object.keys(localStorage).every(k=>!k.startsWith('ella-account-v1-conflict-prefill-'))")
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=f"/tmp/ella-cloud-evidence/{engine.name}-binding.png")
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        bind(page, account)
        assert len(saved(page)["history"]) == 6
        assert len(saved(page)["rewards"]["openings"]) == 1
        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.locator("#account-dialog")).not_to_be_visible()
        assert len(saved(page)["history"]) == 6
        page.set_viewport_size({"width": 1024, "height": 900})
        page.screenshot(path=f"/tmp/ella-cloud-evidence/{engine.name}-home.png")
        page.locator('[data-action="start"]').click()
        offline[0] = True
        qid = page.locator("[data-question-id]").get_attribute("data-question-id")
        answer = next(q["answer"] for q in fixture["seed"]["bank"]["questions"] if q["id"] == qid)
        page.locator(f'[data-action="select"][data-option="{answer}"]').click()
        expect(page.locator('[data-action="next"]')).to_be_visible()
        page.locator('[data-action="pause"]').click()
        assert len(saved(page)["history"]) == 7
        page.locator('[data-parent-entry]').click()
        page.locator('[data-action="sync-records"]').click()
        expect(page.locator("#account-card .warning")).to_be_visible(timeout=15000)
        assert len(saved(page)["history"]) == 7
        offline[0] = False
        page.evaluate("window.dispatchEvent(new Event('online'))")
        page.locator('[data-action="sync-records"]').click()
        expect(page.locator('#account-status')).to_contain_text("云端已同步", timeout=15000)

        second, other = context()
        other.goto(BASE)
        other.wait_for_load_state("networkidle")
        bind(other, account, import_local=False)
        assert len(saved(other)["history"]) == 7
        assert saved(other)["session"]["index"] == 1
        assert len(saved(other)["rewards"]["openings"]) == 1
        other.locator('[data-action="resume"]').click()
        while True:
            qid = other.locator("[data-question-id]").get_attribute("data-question-id")
            answer = next(q["answer"] for q in fixture["seed"]["bank"]["questions"] if q["id"] == qid)
            other.locator(f'[data-action="select"][data-option="{answer}"]').click()
            expect(other.locator('[data-action="next"]')).to_be_visible()
            final = "结果" in other.locator('[data-action="next"]').inner_text()
            other.locator('[data-action="next"]').click()
            if final:
                break
            other.wait_for_function("(old)=>{const q=document.querySelector('[data-question-id]');return q&&q.dataset.questionId!==old}",arg=qid)
        expect(other.locator(".club-summary")).to_be_visible()
        other.locator('[data-action="open-chest"]').click()
        expect(other.locator("#cat-dialog")).to_be_visible(timeout=15000)
        assert len(saved(other)["rewards"]["openings"]) == 2
        other.locator('[data-cat-action="close-reveal"]').click()
        other.locator('[data-parent-entry]').click()
        other.locator('[data-action="account"]').first.click()
        test_account = "test-1" if account == "ella" else "test-2"
        bind(other, test_account)
        assert len(saved(other)["history"]) == 0
        assert len(saved(other).get("rewards", {}).get("openings", [])) == 0
        other.locator('[data-action="account"]').first.click()
        bind(other, account)
        assert len(saved(other)["history"]) >= 7
        assert len(saved(other)["rewards"]["openings"]) == 2
        if account == "ella":
            with urllib.request.urlopen(LOCAL + "/__test__/practice") as response:
                publication = json.load(response)
            other.locator('[data-action="sync-records"]').click()
            expect(other.locator('#account-status')).to_contain_text("云端已同步", timeout=15000)
            private_id = publication["questionIds"][0]
            other.wait_for_function("(id)=>JSON.parse(localStorage.getItem('lesson-loop-data-v1')).bank.questions.some(q=>q.id===id)",arg=private_id)
            other.reload()
            other.wait_for_load_state("networkidle")
            private_bank = other.evaluate("JSON.parse(localStorage.getItem('lesson-loop-data-v1')).bank")
            assert any(q["id"] == private_id and q.get("active") is not False for q in private_bank["questions"])
            target = next(t for l in private_bank["lessons"] if l["id"] == "l2-02" for t in l["learningTargets"] if t["id"] == "comic")
            assert private_id in target["questionIds"]
            assert private_id not in [q["id"] for q in fixture["seed"]["bank"]["questions"]]
        # Reproduce the old full-snapshot localStorage layout, then repeatedly
        # switch every supported account in one device without clearing storage.
        other.evaluate("""()=>{
          const bundle=JSON.parse(localStorage.getItem('lesson-loop-data-v1'));
          const id=bundle.state.accountId;
          localStorage.setItem('ella-account-v1-backup-'+id,JSON.stringify(bundle));
          localStorage.setItem('ella-account-v1-last-backup',JSON.stringify(bundle));
        }""")
        expected={}
        if other.locator('[data-parent-entry]').is_visible():
            other.locator('[data-parent-entry]').click()
        for cycle in range(3):
            for id in ["ella","dad","mom","test-1","test-2","test-3"]:
                other.locator('[data-action="account"]').first.click()
                bind(other,id,import_local=False)
                snapshot=saved(other)
                owned_bank=other.evaluate("JSON.parse(localStorage.getItem('lesson-loop-data-v1')).bank")
                assert all(not q.get("practiceFor") or q["practiceFor"]==id for q in owned_bank["questions"])
                stable={key:snapshot.get(key) for key in ["history","rewards","settings","moduleDates","session"]}
                # Fresh accounts may omit optional empty fields until their
                # first merge; compare records, not absent-vs-empty containers.
                stable["rewards"]=stable["rewards"] or {"version":1,"balance":0,"settlements":[],"openings":[]}
                stable["moduleDates"]=stable["moduleDates"] or {}
                if id in expected:
                    assert stable==expected[id],(engine.name,id,cycle,{key:{"before":expected[id][key],"after":stable[key]} for key in stable if stable[key]!=expected[id][key]})
                else:
                    expected[id]=stable
                assert other.evaluate("""()=>Object.keys(localStorage).every(k=>
                  !/^ella-account-v1-(backup-|base-|conflict-|last-backup)/.test(k))""")
                other.reload()
                other.wait_for_load_state("networkidle")
                assert saved(other)["accountId"]==id
                other.locator('[data-parent-entry]').click()
        assert not errors, errors
        final_bytes=other.evaluate("()=>Object.keys(localStorage).reduce((n,k)=>n+2*(k.length+localStorage.getItem(k).length),0)")
        print(engine.name + ": quota-filled legacy startup + bank upgrade, first password + confirmation, existing password, legacy cache migration, mobile, offline, cross-device resume, rewards, account isolation, 18 consecutive switches across six accounts + reload PASS; localStorage bytes before="+str(legacy_bytes)+" after="+str(final_bytes))
        first.close()
        second.close()
        browser.close()
