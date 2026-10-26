# WordFour "Paste from Suno" checks (browser): Suno tags -> sections, notes/ad-libs never sung, instrumental sections in the
# timeline/arrangement/audio, opt-in BPM/key from the style line, ad-lib toggle, MIDI markers + lyric events, full-song WAV,
# demo gate unchanged, whole-song playback through the new sections, persistence, iPhone 13 / Pixel 7.
# Usage: python3 qa/suno.py URL out.json [shots_dir]
import asyncio, base64, json, sys, io, wave, os, numpy as np
from playwright.async_api import async_playwright
JS_B64="const b64=b=>{let s='';for(let i=0;i<b.length;i+=32768) s+=String.fromCharCode.apply(null,b.subarray(i,i+32768)); return btoa(s)};"
def load(b):
  w=wave.open(io.BytesIO(b)); n=w.getnframes(); raw=np.frombuffer(w.readframes(n),dtype=np.uint8).reshape(-1,3)
  v=(raw[:,0].astype(np.int32)|(raw[:,1].astype(np.int32)<<8)|(raw[:,2].astype(np.int32)<<16)); v[v>=1<<23]-=1<<24
  return w.getframerate(),w.getsampwidth()*8,n,(v/8388607.0).reshape(-1,w.getnchannels())
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
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'suno.json'; SHOTS=sys.argv[3] if len(sys.argv)>3 else '.'
FX=os.path.join(os.path.dirname(__file__),'fixtures'); VALLEY=open(f'{FX}/suno-valley.txt').read(); POP=open(f'{FX}/suno-pop.txt').read()
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
EXP=["Intro","Verse 1","Pre-chorus 1","Chorus 1","Instrumental Break","Verse 2","Chorus 2","Guitar Solo","Bridge","Chorus 3","Outro"]
async def paste(pg, text, n):
  await pg.fill('#lyrics', text); await pg.dispatch_event('#lyrics','input')
  await pg.wait_for_function(f"()=>window.__wordfour.TL().secs.length==={n}", timeout=10000); await pg.wait_for_timeout(100)
async def main():
  res={}; os.makedirs(SHOTS, exist_ok=True)
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx=await br.new_context(viewport={'width':1200,'height':1000}); pg=await ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
    await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    await pg.evaluate("()=>{localStorage.clear()}")
    await paste(pg, VALLEY, 11)
    tl=await pg.evaluate("()=>{const t=window.__wordfour.TL(); return {labels:t.secs.map(s=>s.label), types:t.secs.map(s=>s.type), bars:t.secs.map(s=>s.bars), total:t.total, syl:t.syl.map(x=>x.text)}}")
    segs=await pg.evaluate("()=>[...document.querySelectorAll('#timeline .seg')].map(e=>e.className)")
    bad=[s for s in tl['syl'] if any(c in s for c in '[]*()')]
    res['sections']={'labels':tl['labels'],'types':tl['types'],'bars':tl['bars'],'total_bars':tl['total'],'inst_segments':sum('t-inst' in c for c in segs),'syllables':len(tl['syl']),'tag_or_note_syllables':bad}
    res['sections']['pass']=tl['labels']==EXP and res['sections']['inst_segments']==2 and not bad and tl['bars'][7]==8 and tl['bars'][4]==4
    await pg.click('#timeline .seg[data-i="7"]'); await pg.wait_for_timeout(150)
    kar=await pg.text_content('#karaoke'); res['karaoke_solo']={'text':kar.strip(),'pass':'Guitar Solo' in kar and 'instrumental' in kar}
    await pg.click('#timeline .seg[data-i="0"]')
    info=await pg.text_content('#sunoInfo'); btn=await pg.evaluate("()=>{const b=document.getElementById('sunoUse'); return {hidden:b.hidden, text:b.textContent}}")
    before=await pg.evaluate("()=>({bpm:window.__wordfour.state.bpm,key:window.__wordfour.state.keyRoot})")
    await pg.screenshot(path=f'{SHOTS}/desktop-suno-pasted.png')
    await pg.click('#sunoUse'); await pg.wait_for_timeout(150)
    after=await pg.evaluate("()=>({status:document.getElementById('status').textContent,bpm:window.__wordfour.state.bpm,key:window.__wordfour.state.keyRoot,ui:+document.getElementById('bpm').value,uiKey:+document.getElementById('key').value,hidden:document.getElementById('sunoUse').hidden})")
    res['style_line']={'info':info,'button':btn,'before':before,'after':after,
      'pass':(not btn['hidden']) and btn['text']=='Use 104 BPM · key D from your Suno style' and before=={'bpm':92,'key':9} and {k:after[k] for k in ('bpm','key','ui','uiKey','hidden')}=={'bpm':104,'key':2,'ui':104,'uiKey':2,'hidden':True} and 'Suno says D major' in after['status'] and 'Read ' in info and 'Not sung' in info and '(yeah, yeah)' in info and '[Male Vocal]' in info}
    # ad-lib toggle (opt-in)
    await pg.check('#sunoAdlibs'); await pg.wait_for_timeout(200); on=await pg.evaluate("()=>window.__wordfour.TL().secs[1].lines")
    await pg.uncheck('#sunoAdlibs'); await pg.wait_for_timeout(200); off=await pg.evaluate("()=>window.__wordfour.TL().secs[1].lines")
    res['adlib_toggle']={'on':on,'off':off,'pass':'(yeah, yeah)' in on and '(yeah, yeah)' not in off}
    # MIDI: one tempo (104), markers = sections in order at the right ticks, lyric events without tags
    mid=await pg.evaluate("()=>{"+JS_B64+"const r=window.__wordfour.exportMidBytes(); return {name:r.name,b64:b64(r.bytes)}}"); mb=base64.b64decode(mid['b64']); open(f"{SHOTS}/{mid['name']}",'wb').write(mb)
    ppq,trs=parse_midi(mb); tempos=[e for t in trs for e in t if e[1]=='meta' and e[2]==0x51]
    markers=[(e[0],e[3].decode()) for e in trs[0] if e[1]=='meta' and e[2]==6]; lyr=[e[3].decode('utf-8','replace') for t in trs for e in t if e[1]=='meta' and e[2]==5]
    starts=await pg.evaluate("()=>window.__wordfour.TL().secs.map(s=>s.start*4*480)")
    res['midi']={'name':mid['name'],'tempo_events':len(tempos),'bpm':round(60000000/int.from_bytes(tempos[0][3],'big'),2),'markers':[m[1] for m in markers],'marker_ticks_match':[m[0] for m in markers]==starts,'lyric_events':len(lyr),'lyric_with_tags':[l for l in lyr if any(c in l for c in '[]*')]}
    res['midi']['pass']=res['midi']['tempo_events']==1 and res['midi']['bpm']==104 and res['midi']['marker_ticks_match'] and all(any(lbl in m for m in res['midi']['markers']) for lbl in EXP) and res['midi']['lyric_events']>40 and not res['midi']['lyric_with_tags'] and mid['name']=='wordfour-sixteenths-104bpm-Dm.mid'
    # sheet
    sh=await pg.evaluate("()=>new TextDecoder().decode(window.__wordfour.exportSheetBytes().bytes)")
    res['sheet']={'has_solo':'Guitar Solo' in sh,'has_break':'Instrumental Break' in sh,'leaks':[x for x in ['[Male Vocal]','*harmonica*','Style:','after the end','[Fade Out]'] if x in sh]}
    res['sheet']['pass']=res['sheet']['has_solo'] and res['sheet']['has_break'] and not res['sheet']['leaks']
    # WAV: demo gate (first 2 sections) and full song with the gate ignored: exact length, peak, band plays in the solo/break
    rd=await pg.evaluate("async()=>{"+JS_B64+"const r=await window.__wordfour.exportWavBytes({}); return {name:r.name,b64:b64(r.bytes),bars:r.bars}}")
    sr,bits,n,x=load(base64.b64decode(rd['b64'])); demo_exp=round(8*4*60/104*48000)
    rf=await pg.evaluate("async()=>{"+JS_B64+"const r=await window.__wordfour.exportWavBytes({ignoreGate:true}); return {name:r.name,b64:b64(r.bytes),bars:r.bars}}")
    fb=base64.b64decode(rf['b64']); open(f"{SHOTS}/{rf['name']}",'wb').write(fb); sr2,bits2,n2,x2=load(fb); full_exp=round(tl['total']*4*60/104*48000)
    bar=48000*4*60/104; st=await pg.evaluate("()=>window.__wordfour.TL().secs.map(s=>[s.start,s.bars])")
    rms=lambda a: float(np.sqrt((a**2).mean())); seg=lambda i: x2[int(st[i][0]*bar):int((st[i][0]+st[i][1])*bar)]
    m=x2.mean(1); pk=np.abs(x2).max()
    res['wav']={'demo':{'name':rd['name'],'frames':n,'expected':demo_exp,'bars':rd['bars']},'full':{'name':rf['name'],'sr':sr2,'bits':bits2,'frames':n2,'expected':full_exp,'peak_dBFS':round(20*np.log10(pk),2),'first_onset_ms':round(int(np.argmax(np.abs(m)>0.01*pk))/48,3)},
      'rms_dB':{'Instrumental Break':round(20*np.log10(rms(seg(4))),1),'Guitar Solo':round(20*np.log10(rms(seg(7))),1),'Chorus 1':round(20*np.log10(rms(seg(3))),1)}}
    res['wav']['pass']=n==demo_exp and rd['bars']==8 and n2==full_exp and sr2==48000 and bits2==24 and res['wav']['full']['peak_dBFS']<=-1.0 and res['wav']['rms_dB']['Guitar Solo']>-40 and res['wav']['rms_dB']['Instrumental Break']>-40 and rf['name']=='wordfour-sixteenths-104bpm-Dm.wav'
    # whole-song playback through the new sections (pop fixture at 180 BPM)
    await paste(pg, POP, 6); await pg.fill('#bpm','180'); await pg.dispatch_event('#bpm','change')
    plabels=await pg.evaluate("()=>window.__wordfour.TL().secs.map(s=>s.label+':'+s.bars)")
    await pg.evaluate("()=>{window.__schedLog.length=0}"); await pg.click('#playB'); total=await pg.evaluate("()=>window.__wordfour.TL().total")
    for _ in range(int(total*4*60/180/0.25)+20):
      await pg.wait_for_timeout(250)
      if not await pg.evaluate("()=>window.__wordfour.playing"): break
    log=await pg.evaluate("()=>window.__schedLog.filter(e=>e.mode==='full').map(e=>[e.step,e.time,e.sec])")
    order=[]; [order.append(e[2]) for e in log if not order or order[-1]!=e[2]]
    counts={i:sum(1 for e in log if e[2]==i) for i in range(6)}; sd=60/180/4; t0=log[0][1]
    drift=max(abs((e[1]-t0)-(e[0]-log[0][0])*sd) for e in log); stopped=not await pg.evaluate("()=>window.__wordfour.playing")
    res['playback']={'sections':plabels,'order':order,'steps_per_section':counts,'max_drift_us':round(drift*1e6,2),'stopped_at_end':stopped}
    res['playback']['pass']=order==[0,1,2,3,4,5] and all(v==64 for v in counts.values()) and drift<1e-6 and stopped
    # persistence
    await pg.check('#sunoAdlibs'); await pg.wait_for_timeout(300); await pg.reload(); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=120000)
    pers=await pg.evaluate("()=>({labels:window.__wordfour.TL().secs.map(s=>s.label), adl:document.getElementById('sunoAdlibs').checked, info:document.getElementById('sunoInfo').textContent})")
    res['persist']={**pers,'pass':pers['labels']==[l.split(':')[0] for l in plabels] and pers['adl'] is True}
    await pg.uncheck('#sunoAdlibs')
    res['console_errors']=errs; await ctx.close()
    # phones
    res['mobile']={}
    for name in ['iPhone 13','Pixel 7']:
      c=await br.new_context(**p.devices[name]); m=await c.new_page(); merr=[]; m.on('pageerror',lambda e:merr.append(str(e)))
      await m.goto(URL); tapgate=await m.is_visible('#tapBtn'); await m.tap('#tapBtn'); await m.wait_for_function(LOADED,timeout=120000)
      await m.fill('#lyrics',VALLEY); await m.dispatch_event('#lyrics','input'); await m.wait_for_function("()=>window.__wordfour.TL().secs.length===11",timeout=10000); await m.wait_for_timeout(200)
      await m.evaluate("()=>document.getElementById('sunoUse').scrollIntoView({block:'center'})"); await m.wait_for_timeout(150); await m.screenshot(path=f"{SHOTS}/mobile-{name.replace(' ','-')}-suno.png")
      ov=await m.evaluate("()=>document.documentElement.scrollWidth-document.documentElement.clientWidth")
      bw=await m.evaluate("()=>{const r=document.getElementById('sunoUse').getBoundingClientRect(); return [Math.round(r.left),Math.round(r.right),window.innerWidth]}")
      await m.tap('#sunoUse'); await m.wait_for_timeout(150); st2=await m.evaluate("()=>[window.__wordfour.state.bpm,window.__wordfour.state.keyRoot,window.__wordfour.ctx&&window.__wordfour.ctx.state]")
      ios=await m.evaluate("()=>{const e=[...document.querySelectorAll('*')].find(x=>/silent switch/i.test(x.textContent)&&x.children.length===0); return !!e && e.offsetParent!==null}")
      res['mobile'][name]={'tap_gate':tapgate,'overflow_px':ov,'button_box':bw,'after_tap':st2,'ios_note_visible':ios,'errors':merr,
        'pass':tapgate and ov<=0 and bw[0]>=0 and bw[1]<=bw[2] and st2[0]==104 and st2[1]==2 and st2[2]=='running' and not merr}
      await c.close()
    await br.close()
  res['all_pass']=all(v.get('pass') for k,v in res.items() if isinstance(v,dict) and 'pass' in v) and all(v['pass'] for v in res['mobile'].values()) and not res['console_errors']
  json.dump(res,open(OUT,'w'),indent=1); print(json.dumps({k:(v.get('pass') if isinstance(v,dict) and 'pass' in v else v) for k,v in res.items() if k!='mobile'}), {k:v['pass'] for k,v in res['mobile'].items()})
asyncio.run(main())
