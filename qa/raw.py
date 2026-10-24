# Mic Raw default + device-rate live context + diagnostics + stereo (right-only) input, at 44.1 kHz and the default rate.
import asyncio, json, sys
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'raw.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
RUN="""async()=>{ const w=window.__wordfour, c=w.ctx; const d=c.createMediaStreamDestination(); d.channelCount=2; const m=c.createChannelMerger(2);
 const o=c.createOscillator(); o.frequency.value=1000; const g=c.createGain(); g.gain.value=0.3; o.connect(g); g.connect(m,0,1); m.connect(d); o.start(); // signal on the RIGHT channel only
 w.state.inputType='mic'; await w.setInputStream(d.stream); await new Promise(r=>setTimeout(r,600));
 const rg=w.rawG(), P=w.probes(); const an=x=>{ const a=c.createAnalyser(); a.fftSize=2048; x.connect(a); return a; }; const ar=an(rg), ai=an(P.input), ag=an(P.gate);
 await new Promise(r=>setTimeout(r,400)); const rms=a=>{ const b=new Float32Array(2048); a.getFloatTimeDomainData(b); let s=0; for(const v of b) s+=v*v; return +(10*Math.log10(s/b.length||1e-18)).toFixed(1); };
 w.inputDiag(); return {ctxRate:c.sampleRate, raw_default:w.state.micRaw, raw_checkbox:document.getElementById('micRaw').checked, input_db:rms(ai), raw_out_db:rms(ar), gate_db:rms(ag), raw_gain:rg.gain.value, diag:document.getElementById('inputDiag').textContent,
   diag_visible:!!document.getElementById('inputDiag').offsetParent}; }"""
async def main():
  r={}
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    for q in ['?sr=44100','']:
      pg=await br.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); await pg.goto(BASE+q); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
      x=await pg.evaluate(RUN); x['errors']=errs
      x['pass']=bool(x['raw_default'] and x['raw_checkbox'] and x['input_db']>-30 and abs(x['raw_out_db']-x['input_db'])<0.5 and x['gate_db']<-100 and 'context '+str(x['ctxRate']) in x['diag'] and x['diag_visible'] and not errs)
      if q: x['pass']=x['pass'] and x['ctxRate']==44100
      # export still 48 kHz
      w=await pg.evaluate("async()=>{const r=await window.__wordfour.exportWavBytes({bars:1}); const v=new DataView(r.bytes.buffer); return v.getUint32(24,true)}"); x['export_wav_rate']=w; x['pass']=x['pass'] and w==48000
      r[q or 'default']=x; await pg.close()
  r['summary']={k:v['pass'] for k,v in r.items()}; json.dump(r,open(OUT,'w'),indent=1); print(json.dumps(r,indent=1))
asyncio.run(main())
