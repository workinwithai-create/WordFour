# WordFour input alignment: a click track fed in as the "mic/guitar" stream at known grid times must land on the grid
# in the recorded audio take, in the dry stem and in the processed stem.
import asyncio, base64, json, sys, numpy as np
import io, wave
from playwright.async_api import async_playwright
URL=sys.argv[1]
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
JS_B64="const b64=b=>{let s='';for(let i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768)); return btoa(s)};"
def load(b):
  w=wave.open(io.BytesIO(b)); n=w.getnframes(); raw=np.frombuffer(w.readframes(n),dtype=np.uint8).reshape(-1,3)
  v=(raw[:,0].astype(np.int32)|(raw[:,1].astype(np.int32)<<8)|(raw[:,2].astype(np.int32)<<16)); v[v>=1<<23]-=1<<24
  return w.getframerate(),w.getsampwidth()*8,n,(v/8388607.0).reshape(-1,w.getnchannels())
OUT=sys.argv[2] if len(sys.argv)>2 else 'ain.json'
def onsets(x, exp, sr=48000, thr=0.05):
  out=[]
  for t in exp:
    a=max(0,int((t-0.03)*sr)); seg=np.abs(x[a:a+int(0.08*sr)]); i=np.argmax(seg>thr) if (seg>thr).any() else None
    out.append(None if i is None else (a+i)/sr-t)
  return out
async def run(kind):
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg=await br.new_page()
    await pg.goto(URL); await pg.wait_for_function(LOADED, timeout=60000)
    info=await pg.evaluate("""async(kind)=>{ const w=window.__wordfour; await w.startRec(); w.stop(); w.takes.length=0; const c=w.ctx;
      const d=c.createMediaStreamDestination(); w.state.inputType=kind; w.state.latAuto=false; w.state.latNudge=0; w.state.inputMon=false;
      await w.setInputStream(d.stream); const cal=await w.calibrateInput(d); const tl=w.TL(), sec=tl.secs[1]; w.setLoop(1); await w.startRec(); const T0=window.__recT0, beat=60/w.state.bpm;
      const exp=[]; for(let k=0;k<sec.bars*4;k++){ const t=T0+k*beat; exp.push(k*beat);
        const o=c.createOscillator(), g=c.createGain(); o.frequency.value=1500; g.gain.setValueAtTime(0,t); g.gain.setValueAtTime(0.5,t); g.gain.setValueAtTime(0,t+0.004); o.connect(g); g.connect(d); o.start(t); o.stop(t+0.01); }
      const L=sec.bars*4*beat; await new Promise(r=>setTimeout(r,(T0-c.currentTime+L+0.6)*1000)); w.stop(); await new Promise(r=>setTimeout(r,900));
      const tk=w.takes.find(t=>t.kind==='audio'); if(!tk) return {err:'no audio take', takes:w.takes.map(t=>t.kind+t.inst)};
      return {cal:cal&&cal*1000, nudge:w.state.latNudge, exp, id:tk.id, inst:tk.inst, fx:tk.fx&&tk.fx.kind, frames:tk.frames, L, start:sec.start, bars:sec.bars, pcm:Array.from(w.audioPCM.get(tk.id).filter((_,i)=>true))}; }""", kind)
    if 'err' in info: await br.close(); return {'kind':kind,'pass':False,**info}
    take=np.array(info.pop('pcm'),dtype=np.float32); e_take=onsets(take,info['exp'])
    r=await pg.evaluate("async(o)=>{"+JS_B64+"const r=await window.__wordfour.exportStemsBytes(o); return r.files.map(f=>({name:f.name,b64:b64(f.bytes)}))}",
      {'which':[info['id']],'dryToo':True,'fromBar':info['start'],'bars':info['bars'],'ignoreGate':True})
    res={'calibrated_ms':info['cal'],'nudge_ms':info['nudge'],'kind':kind,'inst':info['inst'],'chain':info['fx'],'take_frames':info['frames'],'expected_frames':round(info['L']*48000),'files':[f['name'] for f in r]}
    def ms(v): return [None if x is None else round(float(x)*1000,2) for x in v]
    res['take_err_ms']=ms(e_take)
    for f in r:
      sr,bits,n,a=load(base64.b64decode(f['b64'])); x=a[:,0]; tag='dry' if f['name'].endswith('-dry.wav') else 'processed'
      res[tag+'_err_ms']=ms(onsets(x/ max(1e-9,np.abs(x).max()),info['exp'],thr=0.25)); res[tag+'_fmt']=[sr,bits]
    def med(v): v=[x for x in v if x is not None]; return float(np.median(v)) if v else None
    def spread(v): m=med(v); return None if m is None else round(max(abs(x-m) for x in v if x is not None),3)
    tk=res['take_err_ms']; m=med(tk); res['take_median_ms']=m; res['take_spread_ms']=spread(tk); res['missed']=sum(x is None for x in tk)
    d=res.get('dry_err_ms',[]); pr=res.get('processed_err_ms',[])
    res['dry_vs_take_ms']=round(abs(med(d)-m),3) if d and m is not None else None; res['processed_vs_dry_ms']=round(med(pr)-med(d),3) if d and pr else None
    res['checks']={'exact_length':abs(res['take_frames']-res['expected_frames'])<=1,
      'steady_within_one_loop_step':res['take_spread_ms'] is not None and res['take_spread_ms']<=3.5,
      'on_grid_after_calibration':m is not None and abs(m)<=8.0,
      'at_most_first_hit_missed':res['missed']<=1,
      'dry_stem_matches_take':res['dry_vs_take_ms'] is not None and res['dry_vs_take_ms']<=0.5,
      'processed_stem_close':res['processed_vs_dry_ms'] is not None and abs(res['processed_vs_dry_ms'])<=8.0,
      'stem_48k_24bit':res.get('dry_fmt')==[48000,24] and res.get('processed_fmt')==[48000,24]}
    res['note']='Headless Chrome feeds the test clicks through a MediaStream loop whose delay jumps in 128-sample steps (measured 14-21 ms); calibration measures it, so the remaining on-grid error is bounded by that jitter.'
    res['pass']=all(res['checks'].values())
    await br.close(); return res
async def main():
  out=[await run('mic'), await run('gtrin')]; json.dump(out,open(OUT,'w'),indent=1)
  for r in out: print(r['kind'], 'PASS' if r['pass'] else 'FAIL', {k:v for k,v in r.items() if k in('take_median_ms','take_spread_ms','dry_vs_take_ms','processed_vs_dry_ms','calibrated_ms','checks','err')})
asyncio.run(main())
