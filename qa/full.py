# WordFour full-song playback: Play runs every section in order (bar counts, audio-clock timing, no drift at boundaries),
# playhead/karaoke follow, it stops at the end (or loops with "Loop song"), section click jumps, section loop is opt-in,
# a full-song recording pass becomes one aligned take, and the free demo never limits playback.
import asyncio, json, sys
from playwright.async_api import async_playwright
URL=sys.argv[1]; OUT=sys.argv[2] if len(sys.argv)>2 else 'full.json'
LOADED="/seated (\\d+)\\/\\1/.test(document.getElementById('status').textContent)"
LYR="[Verse]\nI keep the porch light on for you\nthe road is long and the night is cold\n\n[Chorus]\nso come on home come on home to me\nI will leave the door wide open\n\n[Verse 2]\nevery mile I wait for you\ncounting cars that pass me by\n\n[Chorus]\nso come on home come on home to me\nI will leave the door wide open"
SAMPLE="""()=>{const n=document.querySelector('.seg.now'), k=document.querySelector('#karaoke .kw.now'); return {sec:n?+n.dataset.i:-1, kw:k?k.textContent:null, t:window.__wordfour.ctx.currentTime}}"""
async def main():
  res={}
  async with async_playwright() as p:
    br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); pg=await br.new_page()
    await pg.goto(URL); await pg.click('#tapBtn'); await pg.wait_for_function(LOADED,timeout=90000)
    await pg.fill('#bpm','180'); await pg.dispatch_event('#bpm','change')
    await pg.fill('#lyrics',LYR); await pg.dispatch_event('#lyrics','input'); await pg.wait_for_function("()=>window.__wordfour.TL().secs.length===4",timeout=10000)
    tl=await pg.evaluate("()=>{const t=window.__wordfour.TL(); return {total:t.total, secs:t.secs.map(s=>({label:s.label,start:s.start,bars:s.bars,feel:s.feel,end:s.end}))}}")
    res['song']=tl; res['licensed']=await pg.evaluate("()=>window.__wordfour.lic&&window.__wordfour.lic.valid")
    # 1) full play-through from the main Play button
    await pg.evaluate("()=>{window.__schedLog.length=0}"); await pg.click('#playB')
    samples=[]; total_s=tl['total']*4*60/180
    for _ in range(int(total_s/0.25)+16):
      await pg.wait_for_timeout(250)
      st=await pg.evaluate("()=>({playing:window.__wordfour.playing})")
      if not st['playing']: break
      samples.append(await pg.evaluate(SAMPLE))
    log=await pg.evaluate("()=>window.__schedLog.filter(e=>e.mode==='full').map(e=>({step:e.step,time:e.time,sec:e.sec,feel:e.feel}))")
    playing_after=await pg.evaluate("()=>window.__wordfour.playing")
    sd=60/180/4; t0=log[0]['time']; steps=[e['step'] for e in log]
    drift=max(abs((e['time']-t0)-(e['step']-log[0]['step'])*sd) for e in log)
    order=[]; counts={}
    for e in log:
      if not order or order[-1]!=e['sec']: order.append(e['sec'])
      counts[e['sec']]=counts.get(e['sec'],0)+1
    bounds=[]
    for s in tl['secs'][1:]:
      e=next(x for x in log if x['step']==s['start']*16); bounds.append(round(((e['time']-t0)-s['start']*16*sd)*1e6,3))
    kar=[]; 
    for s in samples:
      if s['sec']>=0 and (not kar or kar[-1]!=s['sec']): kar.append(s['sec'])
    words=len(set(s['kw'] for s in samples if s['kw']))
    res['full']={'section_order':order,'steps_per_section':counts,'expected_steps':{i:s['bars']*16 for i,s in enumerate(tl['secs'])},
      'first_step':steps[0],'last_step':steps[-1],'contiguous':steps==list(range(steps[0],steps[-1]+1)),'max_drift_us':round(drift*1e6,3),
      'boundary_error_us':bounds,'playhead_sections_seen':kar,'karaoke_words_seen':words,'stopped_at_end':not playing_after,
      'feels':sorted(set(e['feel'] for e in log))}
    f=res['full']; f['pass']=bool(order==[0,1,2,3] and all(counts.get(i)==s['bars']*16 for i,s in enumerate(tl['secs'])) and f['contiguous'] and steps[0]==0
      and steps[-1]==tl['total']*16-1 and drift<1e-6 and kar==[0,1,2,3] and words>=8 and f['stopped_at_end'])
    # 2) Loop song: wraps back to bar 0 instead of stopping
    await pg.check('#loopSong'); await pg.evaluate("()=>{window.__schedLog.length=0}"); await pg.click('#playB')
    await pg.wait_for_timeout(int((total_s+2.5)*1000)); w=await pg.evaluate("()=>({playing:window.__wordfour.playing, steps:window.__schedLog.map(e=>e.step)})")
    wrap=[i for i in range(1,len(w['steps'])) if w['steps'][i]<w['steps'][i-1]]
    res['loop_song']={'still_playing':w['playing'],'wrapped_to':[w['steps'][i] for i in wrap],'pass':bool(w['playing'] and wrap and w['steps'][wrap[0]]==0)}
    await pg.click('#stop'); await pg.uncheck('#loopSong')
    # 3) clicking a section moves the playhead (on the next bar line) without trapping playback; section loop is opt-in
    await pg.evaluate("()=>{window.__schedLog.length=0}"); await pg.click('#playTop'); await pg.wait_for_timeout(1200)
    tclick=await pg.evaluate("()=>window.__wordfour.ctx.currentTime"); await pg.click('.seg[data-i="2"]'); await pg.wait_for_timeout(int(tl['secs'][2]['bars']*4*60/180*1000)+2500)
    l2=await pg.evaluate("()=>window.__schedLog.map(e=>({step:e.step,time:e.time,sec:e.sec}))"); await pg.click('#stop')
    j=next((x for x in l2 if x['sec']==2), None); after=[x['sec'] for x in l2 if j and x['time']>j['time']]
    res['section_click']={'jump_delay_s':round(j['time']-tclick,3) if j else None,'jump_step':j and j['step'],'continued_into':sorted(set(after)),'loop_checkbox_default':await pg.is_checked('#loopSecChk'),
      'pass':bool(j and j['step']==tl['secs'][2]['start']*16 and j['time']-tclick<=16*sd+0.45 and 3 in after and not await pg.is_checked('#loopSecChk'))}
    await pg.click('.seg[data-i="1"]'); await pg.check('#loopSecChk'); await pg.evaluate("()=>{window.__schedLog.length=0}"); await pg.click('#playB')
    await pg.wait_for_timeout(int(tl['secs'][1]['bars']*4*60/180*1000*2)+1500); l3=await pg.evaluate("()=>window.__schedLog.map(e=>e.sec)"); await pg.click('#stop')
    res['section_loop_opt_in']={'sections':sorted(set(l3)),'pass':set(l3)=={1}}; await pg.uncheck('#loopSecChk')
    # 4) full-song recording pass: one take covering the whole song, exact length, ends by itself
    rec=await pg.evaluate("""async()=>{ const w=window.__wordfour; w.takes.length=0; const c=w.ctx, d=c.createMediaStreamDestination(); w.state.latAuto=false; w.state.latNudge=0; w.state.inputType='gtrin';
      await w.setInputStream(d.stream); const o=c.createOscillator(), gn=c.createGain(); gn.gain.value=0.2; o.connect(gn); gn.connect(d); o.start();
      await w.startRec(); const T0=window.__recT0, total=w.TL().total, L=total*4*60/w.state.bpm;
      await new Promise(r=>setTimeout(r,(T0-c.currentTime+L+1.6)*1000)); o.stop(); const playing=w.playing; await new Promise(r=>setTimeout(r,600));
      const tk=w.takes.find(t=>t.kind==='audio'); return {stopped_by_itself:!playing, scope:tk&&tk.scope, frames:tk&&tk.frames, expected:Math.round(L*48000)}; }""")
    rec['pass']=bool(rec['stopped_by_itself'] and rec['scope']=='song' and rec['frames'] is not None and abs(rec['frames']-rec['expected'])<=1); res['record_full_pass']=rec
    # 5) demo limit: playback reached the last section while unlicensed; the page says export-only
    lt=await pg.text_content('#licState'); res['demo_limit']={'licensed':res['licensed'],'played_last_section':3 in res['full']['section_order'],'text':lt,
      'pass':bool(3 in res['full']['section_order'] and 'whole song always plays' in lt)}
    await br.close()
  res['summary']={k:v['pass'] for k,v in res.items() if isinstance(v,dict) and 'pass' in v}
  json.dump(res,open(OUT,'w'),indent=1); print(json.dumps(res['summary'])); print(json.dumps(res['full'])[:900])
asyncio.run(main())
