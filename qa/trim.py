# Trim audit: dB range/default, bad saved values reset, smoothed gain (no zipper), no reconnects while dragging, level == dB, no clip at 0 dB, peak meter + clip light.
import asyncio, json, sys
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'trim.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
CAP="""if(!window.__capReady){ const src="class C extends AudioWorkletProcessor{process(i){const x=i[0]&&i[0][0]; if(x) this.port.postMessage(x.slice()); return true;}} registerProcessor('qa-cap',C);";
 await c.audioWorklet.addModule(URL.createObjectURL(new Blob([src],{type:'application/javascript'}))); window.__capReady=true; }"""
DRAG="""async()=>{ const w=window.__wordfour, c=w.ctx; """+CAP+"""
 const d=c.createMediaStreamDestination(); const k=c.createConstantSource(); k.offset.value=0.25; k.connect(d); k.start();
 w.state.inputType='mic'; await w.setInputStream(d.stream); await new Promise(r=>setTimeout(r,500));
 const g=w.probes().input, src0=g; const cap=new AudioWorkletNode(c,'qa-cap'); const z=c.createGain(); z.gain.value=0; cap.connect(z); z.connect(c.destination); g.connect(cap);
 const chunks=[]; cap.port.onmessage=e=>chunks.push(e.data);
 let conns=0, gum=0; const oc=AudioNode.prototype.connect, od=AudioNode.prototype.disconnect; AudioNode.prototype.connect=function(){conns++; return oc.apply(this,arguments)}; AudioNode.prototype.disconnect=function(){conns++; return od.apply(this,arguments)};
 const ogum=navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia=function(){gum++; return ogum.apply(this,arguments)};
 const tr=document.getElementById('inputTrim'); await new Promise(r=>setTimeout(r,200)); chunks.length=0;
 for(let rep=0;rep<3;rep++){ for(let v=-24;v<=12;v+=0.5){ tr.value=v; tr.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,4)); }
   for(let v=12;v>=-24;v-=0.5){ tr.value=v; tr.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,4)); } }
 for(const v of [12,-24,12,0]){ tr.value=v; tr.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,30)); }  /* full-range jumps */
 await new Promise(r=>setTimeout(r,300)); AudioNode.prototype.connect=oc; AudioNode.prototype.disconnect=od; navigator.mediaDevices.getUserMedia=ogum;
 let mx=0, n=0, prev=null, nan=0; for(const b of chunks) for(const s of b){ if(!Number.isFinite(s)) nan++; if(prev!==null) mx=Math.max(mx,Math.abs(s-prev)); prev=s; n++; }
 return {samples:n, max_step:mx, max_step_db_equiv_at_0dB:+(20*Math.log10((0.25+mx)/0.25)).toFixed(3), nan, reconnects:conns, getUserMedia_calls:gum, same_node:w.probes().input===src0}; }"""
LEVEL="""async()=>{ const w=window.__wordfour, c=w.ctx, out={};
 const d=c.createMediaStreamDestination(); const o=c.createOscillator(); o.frequency.value=440; const a=c.createGain(); a.gain.value=0.9; o.connect(a); a.connect(d); o.start();
 await w.setInputStream(d.stream); await new Promise(r=>setTimeout(r,400)); const g=w.probes().input, an=c.createAnalyser(); an.fftSize=8192; g.connect(an);
 const tr=document.getElementById('inputTrim'); const meas=()=>{ const b=new Float32Array(8192); an.getFloatTimeDomainData(b); let s=0,p=0; for(const v of b){ s+=v*v; p=Math.max(p,Math.abs(v)); } return [Math.sqrt(s/b.length), p]; };
 const ref=0.9/Math.SQRT2; for(const v of [-24,-12,-6,0,6,12]){ tr.value=v; tr.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,400)); const [r,p]=meas(); out[v]={measured_db:+(20*Math.log10(r/ref)).toFixed(2), peak:+p.toFixed(3), clip_led:document.getElementById('clipLed').classList.contains('on'), meter:document.getElementById('trimPk').textContent}; }
 tr.value=0; tr.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,1800)); out.clip_led_at_0_after=document.getElementById('clipLed').classList.contains('on'); out.meter_at_0=document.getElementById('trimPk').textContent; return out; }"""
async def page(br,seed):
  pg=await br.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
  if seed is not None: await pg.add_init_script("try{const k=Object.keys(localStorage).find(k=>k.endsWith('-v2'))||'wordfour-v2'; if(!sessionStorage.seeded){ sessionStorage.seeded=1; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.inTrim=%s; delete s.trimVer; localStorage.setItem(k,JSON.stringify(s)); }}catch(e){}"%json.dumps(seed))
  await pg.goto(BASE); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000); return pg,errs
async def main():
  r={}
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg,errs=await page(br,None)
    r['range']=await pg.evaluate("()=>{const t=document.getElementById('inputTrim'); return {min:+t.min,max:+t.max,step:+t.step,value:+t.value,state:window.__wordfour.state.inTrim, label:document.getElementById('trimVal').textContent}}")
    r['range']['pass']=r['range']['min']==-24 and r['range']['max']==12 and r['range']['value']==0
    r['drag']=await pg.evaluate(DRAG); dg=r['drag']
    dg['pass']=dg['samples']>40000 and dg['max_step']<0.01 and dg['nan']==0 and dg['reconnects']==0 and dg['getUserMedia_calls']==0 and dg['same_node']
    r['level']=await pg.evaluate(LEVEL); lv=r['level']
    lv['pass']=all(abs(lv[str(v)]['measured_db']-v)<0.2 for v in [-24,-12,-6,0,6,12]) and lv['0']['peak']<0.95 and not lv['0']['clip_led'] and lv['12']['clip_led'] and not lv['clip_led_at_0_after']
    r['level']['errors']=errs; lv['pass']=lv['pass'] and not errs
    ls=await pg.evaluate("()=>new Promise(r=>setTimeout(()=>r(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-v2')))).inTrim),600))"); r['saved_after_drag']={'value':ls,'pass':ls==0}
    await pg.close()
    for name,seed in [('bad_saved_24',24),('bad_saved_nan','"abc"'),('old_in_range_6',6)]:
      pg,errs=await page(br,json.loads(seed) if isinstance(seed,str) else seed)
      x=await pg.evaluate("()=>{const w=window.__wordfour; return {state:w.state.inTrim, ver:w.state.trimVer, slider:+document.getElementById('inputTrim').value, label:document.getElementById('trimVal').textContent}}")
      await pg.reload(); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
      x['after_reload']=await pg.evaluate("()=>window.__wordfour.state.inTrim"); x['errors']=errs
      x['pass']=x['state']==0 and x['slider']==0 and x['ver']==2 and not errs; r[name]=x; await pg.close()
    # a user value set in this version persists
    pg,errs=await page(br,None); await pg.evaluate("()=>{const t=document.getElementById('inputTrim'); t.value=-6; t.dispatchEvent(new Event('input'))}"); await pg.wait_for_timeout(700); await pg.reload(); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    v=await pg.evaluate("()=>window.__wordfour.state.inTrim"); r['persist_new_value']={'value':v,'pass':v==-6}; await pg.close()
  r['summary']={k:v['pass'] for k,v in r.items() if isinstance(v,dict) and 'pass' in v}; json.dump(r,open(OUT,'w'),indent=1); print(json.dumps(r,indent=1))
asyncio.run(main())
