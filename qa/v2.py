# WordFour v2 checks: sections, reasons, edit/lock/re-suggest/undo, half/double feel (grid + audio), full-song WAV, MIDI markers,
# playable instruments -> takes/MIDI/stems, vocal chain + amp (spectrum/level, live == offline, preset change after recording), phones.
import asyncio, base64, json, sys, io, wave, numpy as np
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'v2.json'; SHOTS=sys.argv[3] if len(sys.argv)>3 else '.'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
JS_B64="const b64=b=>{let s='';for(let i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768)); return btoa(s)};"
def load(b):
  w=wave.open(io.BytesIO(b)); n=w.getnframes(); raw=np.frombuffer(w.readframes(n),dtype=np.uint8).reshape(-1,3)
  v=(raw[:,0].astype(np.int32)|(raw[:,1].astype(np.int32)<<8)|(raw[:,2].astype(np.int32)<<16)); v[v>=1<<23]-=1<<24
  return w.getframerate(),w.getsampwidth()*8,n,(v/8388607.0).reshape(-1,w.getnchannels())
async def wav(pg,o):
  r=await pg.evaluate("async(o)=>{"+JS_B64+"const r=await window.__wordfour.exportWavBytes(o); return {name:r.name,b64:b64(r.bytes),bars:r.bars}}",o)
  return r, load(base64.b64decode(r['b64']))
async def stems(pg,o):
  r=await pg.evaluate("async(o)=>{"+JS_B64+"const r=await window.__wordfour.exportStemsBytes(o); return r.files.map(f=>({name:f.name,b64:b64(f.bytes),peak:f.peak}))}",o)
  return {f['name']:(load(base64.b64decode(f['b64'])),f['peak']) for f in r}
db=lambda x: round(20*np.log10(max(1e-12,x)),2)
rms=lambda a: float(np.sqrt((a**2).mean()))
def hf_ratio(x, sr=48000, f=3000):
  X=np.abs(np.fft.rfft(x*np.hanning(len(x)))); fr=np.fft.rfftfreq(len(x),1/sr); return float(X[fr>f].sum()/max(1e-12,X.sum()))
def parse_midi(b):
  assert b[:4]==b'MThd'; ntr=int.from_bytes(b[10:12],'big'); ppq=int.from_bytes(b[12:14],'big'); p=14; tracks=[]
  for _ in range(ntr):
    assert b[p:p+4]==b'MTrk'; L=int.from_bytes(b[p+4:p+8],'big'); d=b[p+8:p+8+L]; p+=8+L; i=0; t=0; ev=[]; rs=0
    while i<len(d):
      v=0
      while True:
        c=d[i]; i+=1; v=(v<<7)|(c&127)
        if c<128: break
      t+=v; s=d[i]
      if s==0xFF:
        ty=d[i+1]; i+=2; l=0
        while True:
          c=d[i]; i+=1; l=(l<<7)|(c&127)
          if c<128: break
        ev.append((t,'meta',ty,bytes(d[i:i+l]))); i+=l
      else:
        if s&0x80: rs=s; i+=1
        n=2 if (rs&0xF0) not in (0xC0,0xD0) else 1; ev.append((t,'ch',rs,bytes(d[i:i+n]))); i+=n
    tracks.append(ev)
  return ppq,tracks
async def main():
  res={}
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx=await br.new_context(viewport={'width':1200,'height':1000}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=180000); await pg.wait_for_function("document.getElementById('tap').classList.contains('hide')")
    # ---- 1. section detection (default lyric + labelled lyric + the QA sample)
    sample=open(__file__.rsplit('/',1)[0]+'/sample-lyric.txt').read()
    det=await pg.evaluate("t=>[window.__wordfour.TL().secs.map(s=>s.label), window.__wordfour.SONG.detect(t).map(d=>d.label), window.__wordfour.SONG.detect('[Verse]\\na b c\\n\\n[Chorus]\\nla la la\\nla la\\n\\n[Verse]\\nd e f\\n\\n[Chorus]\\n\\n[Bridge]\\nx y').map(d=>d.label+':'+d.lines.length)]",sample)
    res['detect']={'default':det[0],'sample':det[1],'labelled':det[2],
      'pass': det[0]==['Verse 1','Pre-chorus 1','Chorus 1','Verse 2','Pre-chorus 2','Chorus 2','Bridge','Chorus 3','Outro'] and det[2]==['Verse 1:1','Chorus 1:2','Verse 2:1','Chorus 2:2','Bridge:1'] and 'Bridge' in det[1]}
    print('# ---- 2.',flush=True)
    # ---- 2. every move has a visible reason
    rs=await pg.evaluate("()=>window.__wordfour.TL().secs.map(s=>({label:s.label,feel:s.feel,end:s.end,shift:s.shift,drop:s.drop,density:s.density,r:s.reasons}))")
    await pg.click('.seg[data-i="6"]'); why=await pg.text_content('#why')
    res['reasons']={'moves':[f"{x['label']}: {x['feel']}/{x['density']}/{x['end']}/+{x['shift']}{'/drop' if x['drop'] else ''}" for x in rs],
      'all_have_reasons':all(all(x['r'].get(f) for f in ('feel','density','end','shift','chords','bars','insts')) for x in rs),'bridge_panel':why[:300],
      'has_half':any(x['feel']=='half' for x in rs),'has_double':any(x['feel']=='double' for x in rs),'has_stop':any(x['end']=='stop' for x in rs),'has_build':any(x['end']=='build' for x in rs),
      'has_fill':any(x['end']=='fill' for x in rs),'has_drop':any(x['drop'] for x in rs),'lift_le_2':max(x['shift'] for x in rs)==2}
    res['reasons']['pass']=all(v for k,v in res['reasons'].items() if k not in ('moves','bridge_panel')) and 'Half-time' in why
    await pg.screenshot(path=f'{SHOTS}/desktop-timeline.png')
    print('# ---- 3.',flush=True)
    # ---- 3. edit / lock / re-suggest / undo / reorder / persist
    await pg.click('.seg[data-i="0"]'); await pg.click('#editToggle'); await pg.wait_for_selector('#editor:not([hidden])')
    await pg.select_option('#editor select[data-f=feel]','double'); await pg.check('#editor [data-lock=feel]')
    await pg.select_option('#editor select[data-f=end]','stop')   # not locked: re-suggest should change it back
    await pg.screenshot(path=f'{SHOTS}/desktop-editor.png')
    await pg.click('#resuggest'); a=await pg.evaluate("()=>{const s=window.__wordfour.state.song.sections[0]; return {feel:s.feel,end:s.end,lock:s.lock,reason:s.reasons.feel}}")
    d0=await pg.evaluate("()=>window.__wordfour.undoDepth")
    await pg.click('#undoBtn'); b=await pg.evaluate("()=>{const s=window.__wordfour.state.song.sections[0]; return {feel:s.feel,end:s.end}}")
    n0=await pg.evaluate("()=>window.__wordfour.state.song.sections.map(s=>s.label)")
    await pg.click('#editor [data-act=down]'); n1=await pg.evaluate("()=>window.__wordfour.state.song.sections.map(s=>s.label)")
    await pg.click('#editor [data-act=add]'); n2=await pg.evaluate("()=>window.__wordfour.state.song.sections.length")
    await pg.click('#editor [data-act=del]'); n3=await pg.evaluate("()=>window.__wordfour.state.song.sections.length")
    await pg.click('#undoBtn'); await pg.click('#undoBtn'); await pg.click('#undoBtn'); n4=await pg.evaluate("()=>window.__wordfour.state.song.sections.map(s=>s.label)")
    await pg.reload(); await pg.wait_for_function(LOADED,timeout=180000)
    c=await pg.evaluate("()=>{const s=window.__wordfour.state.song.sections[0]; return {feel:s.feel,lock:s.lock}}")
    res['edit']={'after_resuggest':a,'undo_depth':d0,'after_undo':b,'order0':n0[:3],'after_move':n1[:3],'add':n2,'remove':n3,'after_3_undos':n4[:3],'after_reload':c,
      'pass': a['feel']=='double' and a['lock'].get('feel') and a['end']!='stop' and a['reason']=='Locked by you.' and b['end']=='stop' and n1[:2]==[n0[1],n0[0]] and n2==len(n0)+1 and n3==len(n0) and n4==n0 and c['feel']=='double' and c['lock'].get('feel')}
    # put the arrangement back to the suggestion for the rest of the run
    await pg.evaluate("()=>{const w=window.__wordfour; w.state.song.sections.forEach(s=>s.lock={}); w.buildSong(false);}")
    await pg.click('#tapBtn'); await pg.wait_for_function("document.getElementById('tap').classList.contains('hide')")
    print('# ---- 4.',flush=True)
    # ---- 4. half / double: gridded events and audible in a kit-only render (same BPM)
    grid=await pg.evaluate("""()=>{const w=window.__wordfour, tl=w.TL(), st=w.state, out={};
      for(const lab of ['Chorus 1','Chorus 2','Bridge']){ const s=tl.secs.find(x=>x.label===lab), g0=(s.start+1)*16, k=[],sn=[],hh=[];
        for(let i=0;i<16;i++) for(const e of w.stepEvents(g0+i,st,tl,{noLead:true})) if(e.part==='kit'){ if(e.note===36) k.push(i); if(e.note===38) sn.push(i); if(e.note===42) hh.push(i); }
        out[lab]={feel:s.feel,kick:k,snare:sn,hats:hh.length,bar:s.start+1}; } return out;}""")
    au={}
    for lab,v in grid.items():
      r,(sr,bits,n,x)=await wav(pg,{'fromBar':v['bar'],'bars':1,'parts':['kit'],'noLead':True}); m=np.abs(x.mean(1)); sd=int(round(48000*60/92/4))
      env=np.array([rms(m[i*sd:i*sd+480]) for i in range(16)]); pre=np.array([rms(m[i*sd-480:i*sd]) if i else 0.0 for i in range(16)])
      on=[i for i in range(16) if env[i]>2.5*pre[i]+1e-4 and env[i]>0.05*env.max()]
      au[lab]={'onsets_16th':on,'n':len(on),'frames':n}
    res['feel']={'grid':grid,'audio_onsets':au,'one_bpm':True,
      'pass': grid['Bridge']['kick']==[0] and grid['Bridge']['snare']==[8] and grid['Chorus 2']['kick']==[0,4,8,12] and grid['Chorus 2']['snare']==[2,6,10,14] and grid['Chorus 2']['hats']==16
              and au['Chorus 2']['n']>au['Chorus 1']['n']>au['Bridge']['n'] and len({v['frames'] for v in au.values()})==1}
    # live: loop the double-time chorus, the scheduler reports double feel at the same BPM; switching loop lands on a bar line
    await pg.evaluate("()=>{window.__wordfour.setLoop(5); window.__schedLog.length=0}"); await pg.click('#playB'); await pg.wait_for_timeout(2500)
    t0=await pg.evaluate("()=>window.__wordfour.ctx.currentTime"); await pg.evaluate("()=>window.__wordfour.setLoop(6)"); await pg.wait_for_timeout(4000)
    lg=await pg.evaluate("()=>window.__schedLog"); await pg.click('#stop')
    first6=[e for e in lg if e['sec']==6]; before=[e for e in lg if e['time']<t0]
    res['feel']['live']={'double_steps':sum(1 for e in before if e['feel']=='double'),'bpms':sorted({e['bpm'] for e in lg}),'switch_step_mod16':first6[0]['step']%16 if first6 else None,
      'switch_delay_s':round(first6[0]['time']-t0,3) if first6 else None,'bar_s':round(4*60/92,3)}
    res['feel']['pass']=res['feel']['pass'] and res['feel']['live']['double_steps']>0 and res['feel']['live']['switch_step_mod16']==0 and res['feel']['live']['switch_delay_s']<=4*60/92+0.25  # next bar line + schedule-ahead + test round-trip
    await pg.evaluate("()=>window.__wordfour.setLoop(-1)")
    print('# ---- 5.',flush=True)
    # ---- 5. full-song WAV exact length + demo gate
    tot=await pg.evaluate("()=>window.__wordfour.TL().total"); demo=await pg.evaluate("()=>{const t=window.__wordfour.TL(); return t.secs[0].bars+t.secs[1].bars}")
    r,(sr,bits,n,x)=await wav(pg,{'ignoreGate':True}); exp=round(tot*4*60/92*48000); open(f"{SHOTS}/{r['name']}",'wb').write(base64.b64decode(r['b64']))
    rd,(_,_,nd,_)=await wav(pg,{})
    res['wav']={'name':r['name'],'bars':tot,'frames':n,'expected':exp,'sr':sr,'bits':bits,'peak_dBFS':db(np.abs(x).max()),'seconds':round(n/48000,3),'demo_bars':rd['bars'],'demo_frames':nd,'demo_expected':round(demo*4*60/92*48000)}
    res['wav']['pass']=n==exp and sr==48000 and bits==24 and res['wav']['peak_dBFS']<=-1.0 and rd['bars']==demo and nd==res['wav']['demo_expected']
    print('# ---- 6.',flush=True)
    # ---- 6. instruments: record piano + drums + electric guitar + sung words into takes over a looped section
    await pg.evaluate("()=>{const e=document.getElementById('bpm'); e.value=150; e.dispatchEvent(new Event('change')); window.__wordfour.setLoop(1)}")
    insts=await pg.evaluate("()=>[...document.querySelectorAll('#liveInst option')].map(o=>o.value+'|'+o.textContent)")
    await pg.evaluate("()=>window.__wordfour.startRec()"); await pg.wait_for_timeout(1600+200)
    seq=[('piano',[60,64,67]),('kit',[36,38,42,43]),('egtr',[52,55,59]),('sing',[69,72,74])]
    for inst,notes in seq:
      await pg.select_option('#liveInst',inst)
      for nn in notes: await pg.evaluate(f"()=>window.__wordfour.liveOn({nn},0.9,'midi')"); await pg.wait_for_timeout(180); await pg.evaluate(f"()=>window.__wordfour.liveOff({nn},'midi')"); await pg.wait_for_timeout(60)
    await pg.wait_for_timeout(1500); await pg.click('#stop'); await pg.wait_for_timeout(300)
    tk=await pg.evaluate("()=>window.__wordfour.takes.map(t=>({id:t.id,name:t.name,inst:t.inst,scope:t.scope,n:t.notes.length,fx:t.fx&&t.fx.preset,texts:t.notes.map(n=>n.text).filter(Boolean)}))")
    log=await pg.evaluate("()=>window.__liveLog.filter(e=>e.ev==='on').map(e=>e.inst+':'+e.played)")
    await pg.screenshot(path=f'{SHOTS}/desktop-takes.png')
    mid=await pg.evaluate("()=>{"+JS_B64+"const r=window.__wordfour.exportMidBytes(); return {name:r.name,b64:b64(r.bytes)}}"); mb=base64.b64decode(mid['b64']); open(f"{SHOTS}/{mid['name']}",'wb').write(mb)
    ppq,trs=parse_midi(mb); names=[next((e[3].decode() for e in t if e[1]=='meta' and e[2]==3),'') for t in trs]
    tempos=[e for t in trs for e in t if e[1]=='meta' and e[2]==0x51]; markers=[(e[0],e[3].decode()) for e in trs[0] if e[1]=='meta' and e[2]==6]
    lyr=[e for t in trs for e in t if e[1]=='meta' and e[2]==5]
    starts=await pg.evaluate("()=>window.__wordfour.TL().secs.map(s=>s.start*4*480)")
    played_tracks=[n for n in names if n.startswith('Played:')]
    res['midi']={'name':mid['name'],'tracks':names,'tempo_events':len(tempos),'bpm':round(60000000/int.from_bytes(tempos[0][3],'big'),2),'markers':markers,'marker_ticks_match':[m[0] for m in markers]==starts,'lyric_events':len(lyr)}
    res['midi']['pass']=len(tempos)==1 and res['midi']['bpm']==150 and res['midi']['marker_ticks_match'] and len(markers)==len(starts) and len(lyr)>20
    st=await stems(pg,{'fromBar':6,'bars':4,'dryToo':True}); print('stems ok',flush=True)
    res['instruments']={'picker':insts,'takes':tk,'live_log':log,'midi_played_tracks':played_tracks,'stems':{k:{'peak_dBFS':db(np.abs(v[0][3]).max()),'rms_dB':db(rms(v[0][3]))} for k,v in st.items()}}
    got={t['inst'] for t in tk}; scope_ok=all(t['scope']!='song' for t in tk)
    res['instruments']['pass']=len(insts)==8 and insts[0].startswith('sing|') and {'piano','kit','egtr','sing'}<=got and scope_ok and len(played_tracks)>=3 \
      and any('piano' in k for k in st) and any('kit' in k for k in st) and any('egtr-processed' in k for k in st) and any('egtr-dry' in k for k in st) \
      and all(v['peak_dBFS']<=-1.0 for v in res['instruments']['stems'].values()) and all(v['rms_dB']>-80 for k,v in res['instruments']['stems'].items() if 'take' in k)
    sungtake=[t for t in tk if t['inst']=='sing']; res['instruments']['sung_words']=sungtake[0]['texts'] if sungtake else []
    print('# ---- 7.',flush=True)
    # ---- 7. FX: spectrum/level change, live == offline, preset change after recording changes the exported stem
    await pg.evaluate("()=>{const e=document.getElementById('bpm'); e.value=92; e.dispatchEvent(new Event('change')); window.__wordfour.setLoop(-1)}")
    vid=await pg.evaluate("""()=>{const w=window.__wordfour; const ns=[]; for(let i=0;i<8;i++) ns.push({pos:i*8,len:6,vel:0.9,note:[57,60,64,62,60,57,55,57][i],syl:i,text:'la'});
       const t=w.addTake(ns,'sing',w.TL().secs[0].id,'test'); t.name='FX test vocal'; t.fx={kind:'vocal',preset:'clean_pop',cfg:w.FX.clone(w.FX.VOCAL_PRESETS.clean_pop)};
       const ns2=[]; for(let i=0;i<8;i++) ns2.push({pos:i*8,len:6,vel:0.9,note:[40,47,52,55,52,47,45,52][i]});
       const g=w.addTake(ns2,'egtr',w.TL().secs[0].id,'test'); g.name='FX test guitar'; g.fx={kind:'amp',preset:'clean_jazz',cfg:w.FX.clone(w.FX.AMP_PRESETS.clean_jazz)}; w.saveTakes(); w.renderTakes(); return [t.id,g.id];}""")
    def one(sts,frag): return next(v for k,v in sts.items() if frag in k)
    s1=await stems(pg,{'which':vid,'ignoreGate':True,'dryToo':True,'fromBar':0,'bars':6})
    vp,vd=one(s1,'fx-test-vocal-vocal-processed')[0][3],one(s1,'fx-test-vocal-vocal-dry')[0][3]; gp,gd=one(s1,'fx-test-guitar-egtr-processed')[0][3],one(s1,'fx-test-guitar-egtr-dry')[0][3]
    # change the guitar's amp to High Gain and the vocal to Radio AFTER recording, from the takes list UI
    await pg.evaluate("()=>{}"); lis=await pg.query_selector_all('#takes .take')
    for li in lis:
      t=await li.text_content()
      if 'FX test guitar' in t: await (await li.query_selector('select[data-act=fx]')).select_option('high_gain')
    lis=await pg.query_selector_all('#takes .take')
    for li in lis:
      t=await li.text_content()
      if 'FX test vocal' in t: await (await li.query_selector('select[data-act=fx]')).select_option('radio')
    s2=await stems(pg,{'which':vid,'ignoreGate':True,'dryToo':True,'fromBar':0,'bars':6})
    vp2,vd2=one(s2,'fx-test-vocal-vocal-processed')[0][3],one(s2,'fx-test-vocal-vocal-dry')[0][3]; gp2,gd2=one(s2,'fx-test-guitar-egtr-processed')[0][3],one(s2,'fx-test-guitar-egtr-dry')[0][3]
    crest=lambda a: float(np.abs(a).max()/max(1e-9,rms(a)))
    fx={'vocal_clean_pop':{'hf_ratio_dry':round(hf_ratio(vd.mean(1)),4),'hf_ratio_proc':round(hf_ratio(vp.mean(1)),4),'rms_dry_dB':db(rms(vd)),'rms_proc_dB':db(rms(vp)),'peak_proc_dBFS':db(np.abs(vp).max())},
        'vocal_radio_after_rec':{'hf_ratio':round(hf_ratio(vp2.mean(1)),4),'rms_dB':db(rms(vp2)),'diff_vs_before_dB':db(rms(vp2-vp))},
        'guitar_clean_jazz':{'hf_ratio':round(hf_ratio(gp.mean(1)),4),'crest':round(crest(gp),2),'hf_dry':round(hf_ratio(gd.mean(1)),4)},
        'guitar_high_gain_after_rec':{'hf_ratio':round(hf_ratio(gp2.mean(1)),4),'crest':round(crest(gp2),2),'diff_vs_before_dB':db(rms(gp2-gp))},
        'dry_stems_unchanged':bool(np.allclose(vd,vd2,atol=1e-6) and np.allclose(gd,gd2,atol=1e-6))}
    fx['spectrum_level_pass']=abs(fx['vocal_clean_pop']['hf_ratio_proc']-fx['vocal_clean_pop']['hf_ratio_dry'])>0.01 and abs(fx['guitar_high_gain_after_rec']['hf_ratio']-fx['guitar_clean_jazz']['hf_ratio'])>0.02 and fx['guitar_high_gain_after_rec']['crest']<fx['guitar_clean_jazz']['crest']
    fx['preset_after_rec_pass']=fx['vocal_radio_after_rec']['diff_vs_before_dB']>-40 and fx['guitar_high_gain_after_rec']['diff_vs_before_dB']>-40 and fx['dry_stems_unchanged']
    # live == offline: the same chain (same code, same settings) on the running AudioContext vs an OfflineAudioContext, same input
    lo=await pg.evaluate("""async()=>{const w=window.__wordfour, FX=w.FX, ac=w.ctx, SR=48000, N=SR*2, out={};
      const sig=c=>{const b=c.createBuffer(1,N,SR), d=b.getChannelData(0); let s=1; for(let i=0;i<N;i++){ s=(s*16807)%2147483647; const env=Math.exp(-((i%12000)/3000)); d[i]=0.4*env*Math.sin(2*Math.PI*(220+440*((i%12000)/12000))*i/SR)+0.02*env*((s/2147483647)*2-1);} return b;};
      for(const [kind,cfg] of [['vocal',FX.VOCAL_PRESETS.warm_rnb],['amp',FX.AMP_PRESETS.crunch]]){
        const oc=new OfflineAudioContext(2,N,SR); await FX.ready(oc); const ch=FX.build(oc,kind,cfg,92,oc.destination); const s=oc.createBufferSource(); s.buffer=sig(oc); s.connect(ch.input); s.start(0);
        const off=(await oc.startRendering()).getChannelData(0).slice();
        await FX.ready(ac); const cap=new Float32Array(N+SR); let k=0, started=false; const sp=ac.createScriptProcessor(4096,2,2), mute=ac.createGain(); mute.gain.value=0; sp.connect(mute); mute.connect(ac.destination);
        const ch2=FX.build(ac,kind,cfg,92,sp); sp.onaudioprocess=e=>{ const x=e.inputBuffer.getChannelData(0); if(!started){ for(let i=0;i<x.length;i++) if(Math.abs(x[i])>1e-5){ started=true; break; } } if(started) for(let i=0;i<x.length&&k<cap.length;i++) cap[k++]=x[i]; };
        const s2=ac.createBufferSource(); s2.buffer=sig(ac); s2.connect(ch2.input); s2.start(ac.currentTime+0.1);
        await new Promise(r=>setTimeout(r,3200)); sp.disconnect(); ch2.dispose&&ch2.dispose();
        // align (live capture starts at the first non-silent block), then compare
        let best=0,bv=-1e9; const a0=off.findIndex(v=>Math.abs(v)>1e-5);
        for(let L=-4096;L<=4096;L++){ let c=0; for(let i=SR*0.2;i<SR*0.2+8192;i+=2){ const j=i-a0+L; if(j>=0&&j<k) c+=off[i]*cap[j]; } if(c>bv){bv=c;best=L;} }
        let num=0,den=0,sa=0,sb=0; for(let i=a0;i<N-4096;i++){ const j=i-a0+best; if(j<0||j>=k) continue; const a=off[i],b=cap[j]; num+=a*b; sa+=a*a; sb+=b*b; den+=(a-b)*(a-b); }
        out[kind]={corr:num/Math.sqrt(sa*sb), err_dB:10*Math.log10(den/sa), lag:best, captured:k, desc:ch.desc}; }
      return out;}""")
    fx['live_vs_offline']={k:{'corr':round(v['corr'],5),'err_dB':round(v['err_dB'],1),'desc':v['desc']} for k,v in lo.items()}
    fx['live_eq_offline_pass']=all(v['corr']>0.99 for v in lo.values())
    fx['peaks_le_-1']=all(db(np.abs(a).max())<=-1.0 for a in (vp,vd,gp,gd,vp2,gp2))
    fx['pass']=fx['spectrum_level_pass'] and fx['preset_after_rec_pass'] and fx['live_eq_offline_pass'] and fx['peaks_le_-1']
    res['fx']=fx
    # live monitor path: limiter + faders present, live chain description recorded
    res['live_bus']=await pg.evaluate("()=>{const b=window.__wordfour.bus; return {limiter_thr:b.lim.threshold.value,limiter_ratio:b.lim.ratio.value,you:b.you.gain.value,band:b.band.gain.value,master:b.user.gain.value,monitor_desc:Object.keys(window.__monitorDesc)}}")
    await pg.click('summary >> text=Vocal chain'); await pg.screenshot(path=f'{SHOTS}/desktop-vocal-chain.png',full_page=False)
    res['errors']=errs
    print('# ---- 8.',flush=True)
    # ---- 8. phones
    for dev in ('iPhone 13','Pixel 7'):
      d=p.devices[dev]; b2=await (p.webkit if dev=='iPhone 13' else p.chromium).launch() if False else br
      c2=await br.new_context(**{k:v for k,v in d.items() if k!='default_browser_type'}); m=await c2.new_page(); e2=[]; m.on('pageerror',lambda e:e2.append(str(e)))
      await m.goto(URL); await m.click('#tapBtn'); await m.wait_for_function(LOADED,timeout=180000)
      info=await m.evaluate("()=>({w:innerWidth,sw:document.documentElement.scrollWidth,segs:document.querySelectorAll('.seg').length,tl:document.getElementById('timeline').getBoundingClientRect().width,dock:document.querySelector('.dock').getBoundingClientRect().height})")
      await m.click('#playB'); await m.wait_for_timeout(2500); playing=await m.evaluate("()=>window.__wordfour.playing"); await m.screenshot(path=f"{SHOTS}/{dev.replace(' ','-')}.png"); await m.click('#stop')
      await m.click('.seg[data-i="5"]'); await m.click('#editToggle'); await m.screenshot(path=f"{SHOTS}/{dev.replace(' ','-')}-editor.png")
      res[dev]={**info,'playing':playing,'errors':e2,'pass':info['sw']<=info['w']+1 and info['segs']==9 and playing and not e2}
      await c2.close()
    await br.close()
  res['summary']={k:v['pass'] for k,v in res.items() if isinstance(v,dict) and 'pass' in v}
  json.dump(res,open(OUT,'w'),indent=1,default=str); print(json.dumps(res['summary'])); print('errors',res.get('errors'))
asyncio.run(main())
