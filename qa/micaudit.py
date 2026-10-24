# Mic path audit: edge counts (double connections), per-stage levels/clipping/NaN, monitor latency, guard ducks, gate flips.
import asyncio, json, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'micaudit.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
PATCH="""(()=>{ let id=0; const tag=n=>n.__id||(n.__id=(n.constructor.name.replace('Node','')+'#'+(++id)));
 window.__edges=new Map(); const oc=AudioNode.prototype.connect, od=AudioNode.prototype.disconnect;
 AudioNode.prototype.connect=function(d,...a){ const k=tag(this)+'->'+(d instanceof AudioNode?tag(d):'param'); window.__edges.set(k,(window.__edges.get(k)||0)+1); return oc.call(this,d,...a); };
 AudioNode.prototype.disconnect=function(d,...a){ for(const k of [...window.__edges.keys()]) if(k.startsWith(tag(this)+'->')&&(!d||k.endsWith(tag(d)))) window.__edges.delete(k); return od.call(this,d,...a); };
 window.__dupes=()=>[...window.__edges].filter(([k,v])=>v>1); })()"""
SETUP="""async()=>{ const w=window.__wordfour, c=w.ctx; const d=c.createMediaStreamDestination(); const g=c.createGain(); g.gain.value=0.6; g.connect(d);
 const o=c.createOscillator(); o.type='sawtooth'; o.frequency.value=220; const l=c.createOscillator(), lg=c.createGain(); l.frequency.value=5; lg.gain.value=4; l.connect(lg); lg.connect(o.frequency);
 const am=c.createGain(); const env=c.createOscillator(), eg=c.createGain(); env.frequency.value=0.5; eg.gain.value=0.5; am.gain.value=0.5; env.connect(eg); eg.connect(am.gain); // phrases: swells in and out every 2 s
 o.connect(am); am.connect(g); o.start(); l.start(); env.start(); window.__src={g,d}; w.state.inputType='mic'; await w.setInputStream(d.stream); return true; }"""
MEASURE="""(ms)=>new Promise(res=>{ const w=window.__wordfour, c=w.ctx, P=w.probes(); const an={}; for(const [k,n] of Object.entries(P)){ if(!n) continue; const a=c.createAnalyser(); a.fftSize=2048; n.connect(a); an[k]={a,pk:0,s:0,n:0,nan:0,clip:0}; }
 const b=new Float32Array(2048); let t=0; const iv=setInterval(()=>{ for(const k in an){ const A=an[k]; A.a.getFloatTimeDomainData(b); for(const v of b){ if(!isFinite(v)) A.nan++; const x=Math.abs(v); if(x>A.pk) A.pk=x; if(x>=0.999) A.clip++; A.s+=v*v; A.n++; } }
  if((t+=50)>=ms){ clearInterval(iv); const out={}; for(const k in an){ const A=an[k]; out[k]={peak_db:+(20*Math.log10(A.pk||1e-9)).toFixed(1),rms_db:+(10*Math.log10(A.s/A.n||1e-18)).toFixed(1),clip:A.clip,nan:A.nan}; try{P[k].disconnect(A.a);}catch(e){} } res(out); } },50); })"""
async def main():
  r={}; errs=[]
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg=await br.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script(PATCH); await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    r['state']=await pg.evaluate("()=>{const s=window.__wordfour.state; return {inputMon:s.inputMon, micClean:s.micClean, vocalPreset:s.vocalPreset, gate:s.gate, liveDb:s.liveDb, ctxLatency:[window.__wordfour.ctx.baseLatency, window.__wordfour.ctx.outputLatency]}}")
    r['mic_cleanup_checkbox_default']=await pg.is_checked('#micClean')
    for i in range(3): await pg.evaluate(SETUP); await pg.wait_for_timeout(300)   # Connect three times
    for pr in ['warm_rnb','rock_grit','clean_pop']:
      await pg.evaluate("(p)=>{const w=window.__wordfour; w.state.vocalPreset=p; w.fxChanged&&w.fxChanged();}",pr); await pg.wait_for_timeout(500)
    r['dupe_edges']=await pg.evaluate("()=>window.__dupes()")
    r['edges_from_input_chain']=await pg.evaluate("()=>[...window.__edges.keys()].filter(k=>/MediaStreamAudioSource|AudioWorklet|DynamicsCompressor#|Analyser/.test(k)).length")
    r['levels']=await pg.evaluate(MEASURE,6000)
    r['gate_flips_6s']=await pg.evaluate("()=>window.__gateLog.length"); r['guard_ducks_6s']=await pg.evaluate("()=>window.__fbMuted||0")
    r['monitor_path']=await pg.evaluate("""()=>{ const w=window.__wordfour, start=w.probes().gate.__id; const E=[...window.__edges.keys()].map(k=>k.split('->')); const seen=new Set([start]), q=[start]; const dests=new Set();
      while(q.length){ const n=q.shift(); for(const [a,b] of E) if(a===n&&b!=='param'&&!seen.has(b)){ seen.add(b); q.push(b); } }
      const comps=[...seen].filter(x=>x.startsWith('DynamicsCompressor')).length, delays=[...seen].filter(x=>x.startsWith('Delay')).length, conv=[...seen].filter(x=>x.startsWith('Convolver')).length;
      return {nodes:seen.size, compressors_in_path:comps, est_lookahead_ms:comps*6, delay_nodes:delays, reverbs:conv, monitor_rebuilds:window.__monBuilds||0}; }""")
    # gate chatter: noise hovering right at the threshold for 4 s
    await pg.evaluate("""()=>{ const w=window.__wordfour,c=w.ctx,S=window.__src; S.g.gain.value=0; const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate),x=b.getChannelData(0); for(let i=0;i<x.length;i++) x[i]=(Math.random()*2-1); const n=c.createBufferSource(); n.buffer=b; n.loop=true; const g=c.createGain(); g.gain.value=Math.pow(10,w.state.gate.thr/20)*1.0; n.connect(g); g.connect(S.d); n.start(); window.__ch={n,g}; window.__gateLog.length=0; }""")
    await pg.wait_for_timeout(4000); r['gate_flips_at_threshold_4s']=await pg.evaluate("()=>window.__gateLog.length")
    r['fb_trace_tail']=await pg.evaluate("()=>window.__fb.slice(-5)")
  r['errors']=errs; json.dump(r,open(OUT,'w'),indent=1); print(json.dumps(r,indent=1))
asyncio.run(main())
