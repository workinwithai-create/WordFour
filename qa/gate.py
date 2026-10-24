# Mic noise gate + monitor gain staging + feedback guard (fake media stream built from Web Audio).
import asyncio, json, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'gate.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
SETUP="""async()=>{ const w=window.__wordfour, c=w.ctx; const d=c.createMediaStreamDestination(); const g=c.createGain(); g.gain.value=0; g.connect(d);
 window.__src={g,d,nodes:[]}; w.state.inputType='mic'; w.state.micRaw=false; await w.setInputStream(d.stream); return true; }"""
# voice: 220 Hz sawtooth with vibrato (harmonic-rich, like a sung vowel); bleed: quiet noise; feedback: loud pure sine
SIG="""(o)=>{ const w=window.__wordfour, c=w.ctx, S=window.__src; S.nodes.forEach(n=>{try{n.stop()}catch(e){}}); S.nodes=[];
 let n; if(o.kind==='noise'){ const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate), x=b.getChannelData(0); for(let i=0;i<x.length;i++) x[i]=Math.random()*2-1; n=c.createBufferSource(); n.buffer=b; n.loop=true; }
 else { n=c.createOscillator(); n.type=o.kind==='voice'?'sawtooth':'sine'; n.frequency.value=o.f; if(o.kind==='voice'){ const l=c.createOscillator(), lg=c.createGain(); l.frequency.value=5; lg.gain.value=4; l.connect(lg); lg.connect(n.frequency); l.start(); S.nodes.push(l);} }
 n.connect(S.g); S.g.gain.value=o.amp; n.start(); S.nodes.push(n); return true; }"""
LEVEL="""(ms)=>new Promise(res=>{ const w=window.__wordfour, a=w.monAn(), b=new Float32Array(a.fftSize); const tap=w.ctx.createAnalyser(); tap.fftSize=2048; w.monTap&&0; let mx=0,k=0;
 const iv=setInterval(()=>{ a.getFloatTimeDomainData(b); let s=0; for(const v of b) s+=v*v; mx=Math.max(mx,Math.sqrt(s/b.length)); if(++k*20>=ms){ clearInterval(iv); res({mon_rms_max:mx, gate_led:document.getElementById('gateLed').classList.contains('open')}); } },20); })"""
async def main():
  r={}; errs=[]
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg=await br.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    r['defaults']={'hear_myself_checked':await pg.is_checked('#inputMon'),'gate_checked':await pg.is_checked('#gate_on'),'gate':await pg.evaluate("()=>window.__wordfour.state.gate"),
      'labels':await pg.eval_on_selector_all('#micPanel label','els=>els.map(e=>e.textContent.replace(/\\s+/g," ").trim())')}
    r['defaults']['pass']=r['defaults']['hear_myself_checked'] and r['defaults']['gate_checked']
    await pg.evaluate(SETUP); await pg.wait_for_timeout(400)
    await pg.evaluate(SIG,{'kind':'noise','amp':0.003}); bleed=await pg.evaluate(LEVEL,800)   # ~ -55 dBFS RMS room/speaker bleed
    await pg.evaluate(SIG,{'kind':'voice','f':220,'amp':0.25}); voice=await pg.evaluate(LEVEL,600)
    await pg.evaluate(SIG,{'kind':'noise','amp':0.003}); await pg.wait_for_timeout(1200); after=await pg.evaluate(LEVEL,500)
    r['gate']={'bleed':bleed,'voice':voice,'bleed_after_phrase':after,'fb_ducks_during_voice':await pg.evaluate("()=>window.__fbMuted||0"),
      'pass':bleed['mon_rms_max']<1e-3 and not bleed['gate_led'] and voice['mon_rms_max']>0.02 and voice['gate_led'] and after['mon_rms_max']<1e-3 and not after['gate_led'] and not await pg.evaluate("()=>window.__fbMuted||0")}
    # gain staging: monitor send with the default vocal chain vs input level (bus.inMon -6 dB, no 2.2x live makeup, comp makeup capped at 3 dB)
    # feedback: loud pure tone
    await pg.evaluate(SIG,{'kind':'sine','f':2400,'amp':0.6}); t0=await pg.evaluate("performance.now()")
    await pg.wait_for_function("()=>(window.__fbMuted||0)>0",timeout=3000); t1=await pg.evaluate("performance.now()")
    g_ducked=await pg.evaluate("()=>window.__wordfour.monGate().gain.value"); msg=await pg.text_content('#monWarn')
    await pg.evaluate(SIG,{'kind':'noise','amp':0.003}); await pg.wait_for_timeout(1800)
    r['feedback']={'detect_ms':round(t1-t0),'gain_while_ducked':g_ducked,'message':msg,'monitor_gain_after':await pg.evaluate("()=>window.__wordfour.monGate().gain.value"),
      'hear_myself_still_on':await pg.is_checked('#inputMon'),'pass':(t1-t0)<700 and g_ducked<0.05 and await pg.is_checked('#inputMon') and await pg.evaluate("()=>window.__wordfour.monGate().gain.value")>0.95}
    # controls apply live + persist
    await pg.evaluate("()=>{const e=document.getElementById('gate_thr'); e.value=-30; e.dispatchEvent(new Event('input'));}")
    await pg.reload(); r['persist']={'thr':await pg.evaluate("()=>window.__wordfour.state.gate.thr"),'hear':await pg.is_checked('#inputMon')}; r['persist']['pass']=r['persist']['thr']==-30 and r['persist']['hear']
    await pg.evaluate("()=>{window.__wordfour.state.gate.thr=-42; window.__wordfour.save()}")
    await pg.locator('#micPanel').scroll_into_view_if_needed(); await pg.screenshot(path='qa/out/gate.png')
  r['errors']=errs; r['summary']={k:v['pass'] for k,v in r.items() if isinstance(v,dict) and 'pass' in v}
  json.dump(r,open(OUT,'w'),indent=1); print(json.dumps(r,indent=1)[:3500])
asyncio.run(main())
