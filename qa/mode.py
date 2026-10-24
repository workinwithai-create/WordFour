# Play along vs MIDI drives words: mocked Web MIDI. Sound, clock-driven scroll, no transport start, old mode, reload, full song, exports, iPhone 13.
import asyncio, json, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'mode.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
MOCK="""(()=>{window.__sent=[]; const inp={id:'fake-in',name:'Fake Keys',type:'input',state:'connected',onmidimessage:null};
const acc={inputs:new Map([['fake-in',inp]]),outputs:new Map(),onstatechange:null,sysexEnabled:false};
navigator.requestMIDIAccess=()=>Promise.resolve(acc);
window.__midi=(d)=>{ if(inp.onmidimessage) inp.onmidimessage({data:new Uint8Array(d)}); return !!inp.onmidimessage; };})()"""
LYR="[Verse]\nI keep the porch light on for you\nthe road is long and the night is cold\n\n[Chorus]\nso come on home come on home to me\nI will leave the door wide open"
SOUND="""(n)=>new Promise(res=>{ const B=window.__wordfour; window.__midi([0x90,n,100]); const vo=B.voices.get('midi:'+n); if(!vo) return res({peak:0});
 const an=B.ctx.createAnalyser(); an.fftSize=1024; vo.parts[0].g.connect(an); const buf=new Float32Array(1024); let mx=0,k=0;
 const iv=setInterval(()=>{ an.getFloatTimeDomainData(buf); for(const v of buf) mx=Math.max(mx,Math.abs(v)); if(++k>30){ clearInterval(iv); window.__midi([0x80,n,0]); res({peak:mx}); } },10); })"""
async def boot(pg):
  await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
  await pg.wait_for_function("()=>document.querySelector('#midiIn option[value=\"fake-in\"]')",timeout=10000)
  await pg.evaluate("()=>{const e=document.getElementById('midiIn'); e.value='fake-in'; e.dispatchEvent(new Event('change'))}")
async def main():
  r={}; errs=[]
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    c=await br.new_context(); pg=await c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); await pg.add_init_script(MOCK)
    await boot(pg)
    await pg.fill('#lyrics',LYR); await pg.dispatch_event('#lyrics','input'); await pg.wait_for_timeout(500)
    await pg.select_option('#liveInst','sing')
    labels=await pg.eval_on_selector_all('.modesw label','els=>els.map(e=>e.textContent.trim())')
    r['labels']={'labels':labels,'default':await pg.evaluate("()=>window.__wordfour.state.inputMode"),'checked':await pg.eval_on_selector('input[name=inputMode]:checked','e=>e.value'),
      'pass':labels==['Play along','MIDI drives words'] and await pg.evaluate("()=>window.__wordfour.state.inputMode")=='play'}
    # stopped: note makes sound, transport stays stopped
    s=await pg.evaluate(SOUND,60); await pg.wait_for_timeout(300)
    r['play_stopped']={'peak':s['peak'],'playing_after':await pg.evaluate("()=>window.__wordfour.playing"),'pass':s['peak']>1e-3 and not await pg.evaluate("()=>window.__wordfour.playing")}
    # other instruments + sustain in play mode
    await pg.select_option('#liveInst','piano') if await pg.evaluate("()=>[...document.querySelectorAll('#liveInst option')].some(o=>o.value==='piano')") else None
    inst=await pg.eval_on_selector('#liveInst','e=>e.value'); s2=await pg.evaluate(SOUND,64)
    await pg.evaluate("()=>{window.__midi([0xB0,64,127]); window.__midi([0x90,67,90]); window.__midi([0x80,67,0]);}")
    held=await pg.evaluate("()=>window.__wordfour.voices.has('midi:67')"); await pg.evaluate("()=>window.__midi([0xB0,64,0])"); rel=await pg.evaluate("()=>!window.__wordfour.voices.has('midi:67')")
    r['play_instrument_sustain']={'inst':inst,'peak':s2['peak'],'held_by_pedal':held,'released':rel,'pass':s2['peak']>1e-3 and held and rel}
    await pg.select_option('#liveInst','sing')
    # playing: hammer notes, scroll follows clock
    await pg.click('#playB'); await pg.wait_for_timeout(1500)
    a=await pg.evaluate("()=>({tp:window.__wordfour.tpos(), t:window.__wordfour.ctx.currentTime, kw:(document.querySelector('#karaoke .kw.now')||{}).dataset})")
    await pg.evaluate("()=>window.__liveLog.length=0")
    for i in range(12):
      await pg.evaluate("(n)=>{window.__midi([0x90,n,110]); window.__midi([0x80,n,0]);}",60+i%5); await pg.wait_for_timeout(40)
    b=await pg.evaluate("()=>({tp:window.__wordfour.tpos(), t:window.__wordfour.ctx.currentTime})")
    syls=await pg.evaluate("()=>window.__liveLog.filter(e=>e.ev==='on').map(e=>e.syl)")
    bpm=await pg.evaluate("()=>window.__wordfour.state.bpm"); exp=(b['t']-a['t'])/(60/bpm/4); got=b['tp']['pos']-a['tp']['pos']
    # words never stepped: in 0.5s at most ~2 distinct syllables from the clock (words mode would give 12 distinct)
    r['play_scroll']={'pos_advance':round(got,3),'clock_expected':round(exp,3),'distinct_syllables_from_12_notes':len(set(syls)),'pass':abs(got-exp)<0.05 and len(set(syls))<=3}
    await pg.click('#playB') if await pg.evaluate("()=>window.__wordfour.playing") else None
    await pg.evaluate("()=>window.__wordfour.stop()") if await pg.evaluate("()=>window.__wordfour.playing") else None
    # MIDI drives words: old stepping
    await pg.click('.modesw label:has(input[value=words])')
    await pg.click('#resetWords'); await pg.evaluate("()=>window.__liveLog.length=0")
    for n in [60,62,64,65]:
      await pg.evaluate("(n)=>{window.__midi([0x90,n,100]); window.__midi([0x80,n,0]);}",n); await pg.wait_for_timeout(60)
    ws=await pg.evaluate("()=>window.__liveLog.filter(e=>e.ev==='on').map(e=>[e.syl,e.text])")
    nowk=await pg.evaluate("()=>{const e=document.querySelector('#karaoke .kw.now'); return e&&+e.dataset.g}")
    r['words_mode']={'syllables':ws,'karaoke_now':nowk,'playing':await pg.evaluate("()=>window.__wordfour.playing"),
      'pass':[x[0] for x in ws]==[0,1,2,3] and nowk==3 and not await pg.evaluate("()=>window.__wordfour.playing")}
    # reload persistence
    await pg.reload(); await pg.wait_for_selector('.modesw')
    m1=await pg.eval_on_selector('input[name=inputMode]:checked','e=>e.value'); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    m1b=await pg.eval_on_selector('input[name=inputMode]:checked','e=>e.value')
    await pg.click('.modesw label:has(input[value=play])'); await pg.reload(); await pg.wait_for_selector('.modesw')
    m2=await pg.eval_on_selector('input[name=inputMode]:checked','e=>e.value')
    r['reload']={'after_words':m1,'after_play':m2,'pass':m1=='words' and m2=='play'}
    # full song in play mode with notes during playback
    await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000); await pg.wait_for_timeout(300)
    r['reload']['mode_after_play_reload_state']=await pg.evaluate("()=>window.__wordfour.state.inputMode")
    await pg.wait_for_function("()=>document.querySelector('#midiIn option[value=\"fake-in\"]')"); await pg.evaluate("()=>{const e=document.getElementById('midiIn'); e.value='fake-in'; e.dispatchEvent(new Event('change'))}")
    await pg.fill('#bpm','200'); await pg.dispatch_event('#bpm','change')
    await pg.evaluate("()=>window.__schedLog.length=0"); tl=await pg.evaluate("()=>{const t=window.__wordfour.TL(); return {total:t.total,n:t.secs.length,bars:t.secs.map(s=>s.bars)}}")
    await pg.click('#playB'); bpmN=await pg.evaluate('()=>window.__wordfour.state.bpm'); dur=tl['total']*4*60/bpmN; tl['bpm']=bpmN; k=0
    while await pg.evaluate("()=>window.__wordfour.playing") and k<int(dur*4)+40:
      if k%3==0: await pg.evaluate("(n)=>{window.__midi([0x90,n,100]); setTimeout(()=>window.__midi([0x80,n,0]),80)}",60+k%7)
      await pg.wait_for_timeout(250); k+=1
    log=await pg.evaluate("()=>{const L=window.__schedLog.filter(e=>e.mode==='full'); const c={}; L.forEach(e=>c[e.sec]=(c[e.sec]||0)+1); return {counts:c, n:L.length}}")
    r['full_song']={'song':tl,'counts':log['counts'],'stopped':not await pg.evaluate("()=>window.__wordfour.playing"),
      'pass':all(log['counts'].get(str(i))==b*16 for i,b in enumerate(tl['bars'])) and not await pg.evaluate("()=>window.__wordfour.playing")}
    # exports
    e=await pg.evaluate("async()=>{const B=window.__wordfour; const w=await B.exportWavBytes({}); const m=B.exportMidBytes(); const s=B.exportSheetBytes(); return {wav:[w.name,w.bytes.length,w.bars],mid:[m.name,m.bytes.length,String.fromCharCode(...m.bytes.slice(0,4))],sheet:s.bytes.length, demo:document.getElementById('licState').textContent}}")
    e['pass']=e['wav'][1]>1000 and e['mid'][2]=='MThd' and e['sheet']>50; r['exports']=e
    # iPhone 13
    d=p.devices['iPhone 13']; mc=await br.new_context(**{k:v for k,v in d.items() if k!='default_browser_type'}); mp=await mc.new_page(); await mp.add_init_script(MOCK); await mp.goto(URL)
    await mp.locator('.modesw').scroll_into_view_if_needed(); bb=await mp.locator('.modesw').bounding_box(); vis=await mp.locator('.modesw label').evaluate_all("els=>els.map(e=>{const r=e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.width), r.right<=innerWidth+1]})")
    await mp.locator('.live').first.screenshot(path='qa/out/mode-iphone13.png') if False else await mp.screenshot(path='qa/out/mode-iphone13.png')
    r['iphone13']={'box':bb,'labels':vis,'pass':bool(bb and all(v[2] and v[1]>40 for v in vis))}
    await pg.locator('.modesw').scroll_into_view_if_needed(); await pg.screenshot(path='qa/out/mode-desktop.png')
  r['errors']=errs; r['summary']={k:v['pass'] for k,v in r.items() if isinstance(v,dict) and 'pass' in v}
  json.dump(r,open(OUT,'w'),indent=1); print(json.dumps(r,indent=1)[:4000])
asyncio.run(main())
