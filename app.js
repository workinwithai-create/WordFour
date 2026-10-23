// WordFour v2 — WorkinWithAI. Paste a whole lyric: WordFour finds the sections, builds a song timeline (each section with its own
// bars, chords, feel, band density and moves), suggests arrangement moves with a reason for each, and lets you change everything.
// Every key you press sings the NEXT syllable (FluidR3 Voice Oohs) or plays a real sampled instrument over a real band.
// Live samples only (FluidR3 + CC0 Virtuosity kit), pinned to commit SHAs. FX (vocal chains, amps) are plain Web Audio nodes.
const APP = "wordfour";
const FLUID_SHA = "044fab8e1456bfafc5776e86dfd6bb8697149aef"; // gleitz/midi-js-soundfonts
const KIT_SHA = "9f04cf9a734527edfbb0a4eee1f674e45bbf71bc";   // sfzinstruments/virtuosity_drums
const FLUID = `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@${FLUID_SHA}/FluidR3_GM`;
const KIT = `https://cdn.jsdelivr.net/gh/sfzinstruments/virtuosity_drums@${KIT_SHA}/Samples`;
const SR = 48000, LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.12, STEPS = 16, MAX_SHIFT = 4;
const NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const FLAT = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
const noteName = n => FLAT[((n%12)+12)%12] + (Math.floor(n/12)-1);
const FX = window.WF_FX, SONG = window.WF_SONG;
// every voice is the sample it is named after; every semitone in range is sampled (no pitch shift)
const INST = {
  voice:  { label:"Voice oohs (FluidR3 Voice Oohs)", prog:"voice_oohs", lo:48, hi:79, hold:true, atk:0.025, rel:0.09 },
  piano:  { label:"Acoustic grand piano (FluidR3)", prog:"acoustic_grand_piano", lo:40, hi:84, rel:0.15 },
  epiano: { label:"Electric piano (FluidR3 Electric Piano 1)", prog:"electric_piano_1", lo:45, hi:84, rel:0.15 },
  nylon:  { label:"Nylon guitar (FluidR3 Acoustic Guitar nylon)", prog:"acoustic_guitar_nylon", lo:40, hi:76, rel:0.1 },
  egtr:   { label:"Clean electric guitar (FluidR3 Electric Guitar clean)", prog:"electric_guitar_clean", lo:40, hi:76, rel:0.08 },
  bass:   { label:"Finger bass (FluidR3 Electric Bass finger)", prog:"electric_bass_finger", lo:28, hi:55, rel:0.06 },
  pad:    { label:"String ensemble (FluidR3 String Ensemble 1)", prog:"string_ensemble_1", lo:48, hi:79, hold:true, atk:0.12, rel:0.25 },
};
const KITMAP = { 36:"kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac", 38:"mid/snare/mid_snare_center_vl24.flac", 42:"mid/hh/mid_hh_closed_vl3_rr1.flac", 49:"mid/crash/mid_crash_crash_vl2_rr1.flac" };
const KITNAME = { 36:"kick", 38:"snare", 42:"closed hi-hat", 49:"crash" };
const KIT_KEYS = [36,36,38,38,42,42,42,49,36,38,42,49]; // VampFour mapping: C/C# kick, D/Eb snare, E-F# hat, G crash, ...
const CHAIRS = [
  { id:"lead",  name:"Your melody (sung on your words)", ch:3, you:true },
  { id:"play",  name:"Your played instruments (takes)", ch:6, you:true },
  { id:"piano", name:"Piano comp (FluidR3 Acoustic Grand)", ch:1, src:"piano" },
  { id:"epiano",name:"Electric piano (FluidR3 Electric Piano 1)", ch:4, src:"epiano" },
  { id:"gtr",   name:"Nylon guitar strum (FluidR3 Nylon)", ch:5, src:"nylon" },
  { id:"bass",  name:"Finger bass (FluidR3 Electric Bass finger)", ch:0, src:"bass" },
  { id:"pad",   name:"String pad (FluidR3 String Ensemble 1)", ch:2, src:"pad" },
  { id:"kit",   name:"Backing kit (Virtuosity Drums, CC0)", ch:9, src:"kit" },
];
const BAND = CHAIRS.filter(c=>!c.you).map(c=>c.id);
const INST_SHORT = { piano:"Piano", epiano:"E-piano", gtr:"Guitar", bass:"Bass", pad:"Strings", kit:"Drums" };
const LIVE = {
  sing:  { label:"Sing lyrics (voice oohs, next syllable per key)", src:"voice", fx:"vocal", ch:3 },
  piano: { label:"Piano", src:"piano", ch:6 },
  epiano:{ label:"Electric piano", src:"epiano", ch:7 },
  nylon: { label:"Nylon guitar (through the amp)", src:"nylon", fx:"amp", ch:8 },
  egtr:  { label:"Electric guitar (clean, through the amp)", src:"egtr", fx:"amp", ch:10 },
  bass:  { label:"Bass (through the bass amp)", src:"bass", fx:"amp", ch:11 },
  strings:{ label:"Strings", src:"pad", ch:12 },
  kit:   { label:"Drum kit (kick, snare, hat, crash)", src:"kit", ch:9 },
};
const recipes = [
  { id:"sixteenths", name:"16ths · in key", blurb:"Starts and ends on the nearest 16th; every pitch snapped into your key. The default." },
  { id:"eighths", name:"8ths · in key", blurb:"Simpler, more singable: 8th-note grid, pitches in key." },
  { id:"chordtones", name:"16ths · land on chords", blurb:"Notes that start on a beat snap to the bar's chord tones, the rest stay in key." },
  { id:"raw", name:"Your feel", blurb:"No quantize, no pitch snap. Exactly what you played." },
];
const SHAPES = [ {id:"arch",name:"Arch"}, {id:"rise",name:"Rise"}, {id:"fall",name:"Fall"}, {id:"wave",name:"Wave"} ];
const grooves = [
  { id:"porch", name:"Porch Light", bpm:92, chords:"Am F C G" },
  { id:"slow",  name:"Slow Ballad", bpm:68, chords:"C Am F G" },
  { id:"drive", name:"Night Drive", bpm:112, chords:"Em C G D" },
];
const FEELS = { normal:"Normal", half:"Half-time", double:"Double-time" }, DENS = { full:"Full", mid:"Medium", sparse:"Sparse" };
const ENDS = { none:"No move", fill:"Fill into next", build:"Build into next", stop:"Stop bar" };
const QUAL = {"":[0,4,7], m:[0,3,7], min:[0,3,7], "7":[0,4,7,10], m7:[0,3,7,10], maj7:[0,4,7,11], dim:[0,3,6], sus2:[0,2,7], sus4:[0,5,7]};
const ROOT = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const pc = x => ((x%12)+12)%12;
const inRange = (n,lo,hi) => { while(n<lo) n+=12; while(n>hi) n-=12; return n; };
const DEFAULT_LYRICS = `I keep the porch light on
for you to-night
the road is long and the night is cold

and every mile I wait for you
counting the cars that pass me by

so come on home
come on home to me
so come on home
I'll be wait-ing up

the kettle hums the clock is slow
I read your letters by the door

and every mile I wait for you
counting the cars that pass me by

so come on home
come on home to me
so come on home
I'll be wait-ing up

maybe the light was never for you
maybe I left it on for me

so come on home
come on home to me
so come on home
I'll be wait-ing up

leave the light on`;

// ---------- state (one mutable object, persisted) ----------
const DEFAULT = { bpm:92, keyRoot:9, chords:"Am F C G", groove:"porch", recipe:"sixteenths", audioOut:"", lyrics:DEFAULT_LYRICS, shape:"arch",
  recClick:true, layer:false, loopSec:-1, editOpen:false, structEdited:false, stemsDry:true,
  mutes:{lead:false,play:false,piano:false,epiano:false,gtr:false,bass:false,pad:false,kit:false},
  gains:{lead:0.85,play:0.8,piano:0.4,epiano:0.42,gtr:0.38,bass:0.8,pad:0.2,kit:0.65},
  midiIn:"", midiOut:"", midiTransport:false, liveInst:"sing", liveOct:4, liveDb:0, bandDb:0, masterDb:0,
  vocalPreset:"clean_pop", ampPreset:"edge", bassPreset:"bass_amp", vocal:null, amp:null, bassAmp:null, song:null };
const state = Object.assign({}, DEFAULT, (()=>{ try{ return JSON.parse(localStorage.getItem(APP+"-v2")||"null") || {}; }catch(e){ return {}; } })());
state.mutes = Object.assign({}, DEFAULT.mutes, state.mutes); state.gains = Object.assign({}, DEFAULT.gains, state.gains);
if(!recipes.some(r=>r.id===state.recipe)) state.recipe="sixteenths";
if(!LIVE[state.liveInst]) state.liveInst="sing";
if(!state.vocal) state.vocal=FX.clone(FX.VOCAL_PRESETS[state.vocalPreset]||FX.VOCAL_PRESETS.clean_pop);
if(!state.amp) state.amp=FX.clone(FX.AMP_PRESETS[state.ampPreset]||FX.AMP_PRESETS.edge);
if(!state.bassAmp) state.bassAmp=FX.clone(FX.AMP_PRESETS.bass_amp);
const save = () => { try{ localStorage.setItem(APP+"-v2", JSON.stringify(state)); }catch(e){} };
function parseChord(s){ const m=/^([A-G])(#|b)?(maj7|min|m7|m|7|dim|sus2|sus4)?$/.exec(String(s).trim()); if(!m) return null;
  return { root:pc(ROOT[m[1]]+(m[2]==="#"?1:m[2]==="b"?-1:0)), ivs:QUAL[m[3]||""], minor:/^m(?!aj)|^min|^dim/.test(m[3]||""), name:String(s).trim() }; }
function parseList(str, min, max){ const t=String(str||"").trim().split(/[\s,|]+/).filter(Boolean); if(t.length<(min||1)||t.length>(max||8)) return null; const c=t.map(parseChord); return c.includes(null)?null:c; }
const parseProg = str => parseList(str,4,4);
let prog = parseProg(state.chords) || parseProg(DEFAULT.chords);
const transpose = () => pc(state.keyRoot - prog[0].root);
const keyLabel = () => NAMES[state.keyRoot].replace("#","s") + (prog[0].minor?"m":"");
const nameOf = (c, shift) => NAMES[pc(c.root+transpose()+(shift||0))] + c.name.replace(/^[A-G](#|b)?/,"");
const scaleAt = (st, pr, shift) => (pr[0].minor ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11]).map(i=>pc(st.keyRoot+(shift||0)+i));
function nearestPc(target, pcs){ for(let d=0; d<=6; d++){ if(pcs.includes(pc(target+d))) return target+d; if(pcs.includes(pc(target-d))) return target-d; } return target; }

// ---------- words -> syllables (deterministic; hyphens in the lyric override the auto split) ----------
const FUNC = new Set("a an the to of and or but in on at for from by with as is am are was were be i you he she we they it its my your his her our their me him us them so if do no not oh yeah that this i'm i'll i've i'd you're it's we're they're don't can't".split(" "));
const UNSTRESSED_PREFIX = /^(a|be|to|de|re|for|un|in|en|ex)$/i;
function splitWord(w){
  if(w.includes("-")) return w.split("-").filter(Boolean);
  { const m=/^(.{2,}[^aeiouy]e)(ly|ness|ful|less|ment)$/i.exec(w); if(m) return [...splitWord(m[1]), m[2]]; }
  const lw=w.toLowerCase(), isV=c=>"aeiouy".includes(c), groups=[];
  for(let i=0;i<lw.length;){ if(isV(lw[i]) && !(lw[i]==="y"&&i===0)){ let j=i; while(j<lw.length&&isV(lw[j])) j++; groups.push([i,j]); i=j; } else i++; }
  if(groups.length>1){ const g=groups[groups.length-1], n=lw.length;
    if(g[0]===n-1 && lw[n-1]==="e" && !/[^aeiouy]le$/.test(lw)) groups.pop();
    else if(g[0]===n-2 && /es$/.test(lw) && !/(ch|sh|s|x|z|g|c)es$/.test(lw)) groups.pop();
    else if(g[0]===n-2 && /ed$/.test(lw) && !/[td]ed$/.test(lw)) groups.pop(); }
  if(groups.length<=1) return [w];
  const out=[]; let p=0;
  for(let k=0;k<groups.length-1;k++){ const a=groups[k][1], b=groups[k+1][0], n=b-a; let cut;
    if(n<=1) cut=a; else if(n===2){ const d=lw.slice(a,a+2); cut = /^(ng|ck)$/.test(d) ? a+2 : /^(th|sh|ch|ph|wh)$/.test(d) ? a : a+1; } else cut=a+1;
    if(cut>p){ out.push(w.slice(p,cut)); p=cut; } }
  out.push(w.slice(p)); return out.filter(Boolean); }
function lineSyls(lines){ const out=[]; lines.forEach((ln,li)=>{ for(const raw of ln.split(/\s+/)){ const w=raw.replace(/[^A-Za-z0-9'\-]/g,""); if(!w) continue;
    const parts=splitWord(w), lw=w.replace(/-/g,"").toLowerCase();
    parts.forEach((pt,k)=>{ const strong = parts.length===1 ? !FUNC.has(lw) : (parts.length===2 && UNSTRESSED_PREFIX.test(parts[0])) ? k===1 : k===0;
      out.push({ text: pt + (k<parts.length-1?"-":""), word:w.replace(/-/g,""), strong, line:li }); }); } }); return out; }

// ---------- the song: sections from the lyric, arrangement suggestions, timeline ----------
const mainNames = () => (state.chords.trim().split(/[\s,|]+/));
function buildSong(keepLocks){ const det=SONG.detect(state.lyrics); const prev=keepLocks&&state.song?state.song.sections:null;
  const secs=SONG.suggest(det.length?det:[{type:"verse",label:"Verse 1",lines:[],why:"No lyric yet: one instrumental verse."}], mainNames(), prev);
  state.song={sections:secs}; state.structEdited=false; }
if(!state.song||!Array.isArray(state.song.sections)||!state.song.sections.length) buildSong(false);
let tlCache={key:null};
function TL(song){ song=song||state.song; const key=JSON.stringify([song,state.keyRoot,state.chords]); if(tlCache.key===key) return tlCache.v;
  const secs=[], bars=[]; let bar=0, gsyl=0;
  song.sections.forEach((s,i)=>{ const ch=parseList(s.chords,1,8)||prog, syl=lineSyls(s.lines||[]).map(x=>Object.assign(x,{sec:i,g:gsyl++}));
    const o={...s, i, start:bar, ch, syl, nlines:Math.max(1,(s.lines||[]).length)}; secs.push(o);
    for(let b=0;b<s.bars;b++){ const c=ch[b%ch.length], r=pc(c.root+transpose()+(s.shift||0)); bars.push({sec:o, local:b, root:r, ivs:c.ivs, tones:c.ivs.map(iv=>pc(r+iv)), name:nameOf(c,s.shift)}); }
    bar+=s.bars; });
  const v={secs, bars, total:bar, syl:secs.flatMap(s=>s.syl)}; tlCache={key,v}; return v; }
const chordAtBar = (tl, bar) => tl.bars[Math.max(0,Math.min(tl.bars.length-1,bar))];

// ---------- sketch: a starting melody FROM the words, per section (deterministic) ----------
function sketchSection(sec, st, tl){ const L=sec.bars*STEPS, n=sec.nlines, notes=[], tonic=inRange(60+pc(st.keyRoot+(sec.shift||0)-60),55,66), scale=scaleAt(st,prog,sec.shift);
  for(let li=0; li<n; li++){ const ln=sec.syl.filter(s=>s.line===li), s0=Math.round(li*L/n/2)*2, s1=Math.round((li+1)*L/n/2)*2, span=s1-s0, k=ln.length; if(!k) continue;
    const stepSz = k*2 <= span-2 ? 2 : 1; let pos=s0;
    ln.forEach((sy,j)=>{ const left=k-j-1;
      if(sy.strong && stepSz===2 && pos%4!==0 && pos+2+left*2 <= s1-2) pos+=2;
      if(pos>=s1-0.5) return;
      const last=j===k-1, len = last ? Math.max(stepSz, Math.min(8, s1-pos-2)) : stepSz, x = k>1 ? j/(k-1) : 0.5, shape=st.shape;
      const h = shape==="rise" ? x*0.7 + li/n*0.3 : shape==="fall" ? (1-x)*0.7 + (1-li/n)*0.3 : shape==="wave" ? 0.5+0.45*Math.sin(2*Math.PI*x + li*Math.PI) : Math.sin(Math.PI*x)*0.85 + (li%2)*0.15;
      const target = tonic - 2 + Math.round(h*9) + (sec.type==="chorus"?2:0), c=chordAtBar(tl, sec.start+Math.floor(pos/STEPS));
      let note = (sy.strong||last||pos%4===0) ? nearestPc(target, c.tones) : nearestPc(target, scale);
      if(last && li===n-1) note = nearestPc(target, [c.root]);
      notes.push({ pos, len, vel: sy.strong?0.9:0.72, note: inRange(note,52,76), syl:sy.g, text:sy.text });
      pos += stepSz; }); }
  return notes; }

// ---------- takes: every loop pass while recording is a NEW take (per section or per full pass). Raw (dry) notes are stored,
// the FX chain is a setting on the take, so you can change it after recording. ----------
const TAKE_CAP=24, TAKE_KEY=APP+"-takes-v2";
const takes=(()=>{ try{ const a=JSON.parse(localStorage.getItem(TAKE_KEY)||"[]"); return Array.isArray(a)?a.filter(t=>t&&Array.isArray(t.notes)):[]; }catch(e){ return []; } })();
let takesVer=1;
function saveTakes(){ takesVer++; srcCache.key=null; lmCache.key=null; try{ localStorage.setItem(TAKE_KEY,JSON.stringify(takes)); }catch(e){ setStatus("Could not save takes in this browser (storage full?). Export them now."); } }
const audible = t => t.mode==="loop" && !t.muted && t.notes.length>0;
const kindOf = inst => (LIVE[inst]||{}).fx || null;
function fxFor(kind, inst){ return kind==="vocal" ? {kind, preset:state.vocalPreset, cfg:FX.clone(state.vocal)} : kind==="amp" ? (inst==="bass" ? {kind, preset:state.bassPreset, cfg:FX.clone(state.bassAmp)} : {kind, preset:state.ampPreset, cfg:FX.clone(state.amp)}) : null; }
function scopeStart(tk, tl){ if(tk.scope==="song") return {g0:0, len:tl.total*STEPS}; const s=tl.secs.find(x=>x.id===tk.scope); return s?{g0:s.start*STEPS, len:s.bars*STEPS, sec:s}:null; }
// recipe transform: one pure function feeds live, WAV and MIDI. Sung melody is monophonic; instruments are polyphonic.
function takeNotes(tk, st, tl){
  const sc=scopeStart(tk,tl); if(!sc) return [];
  const q = st.recipe==="eighths" ? 2 : st.recipe==="raw" ? 0 : 1, out=new Map(), inst=tk.inst||"sing", src=(LIVE[inst]||LIVE.sing).src, kit=src==="kit";
  let tr=pc(st.keyRoot-(tk.key==null?st.keyRoot:tk.key)); if(tr>6) tr-=12;
  const I=INST[src]; let k=0;
  for(const h of tk.notes){ let pos=h.pos, len=Math.max(0.25,h.len||1), note=kit?h.note:h.note+tr;
    if(q){ const end=Math.round((pos+len)/q)*q; pos=Math.round(pos/q)*q; len=Math.max(q,end-pos); }
    if(pos<0) pos=0; if(pos>=sc.len) continue; len=Math.min(len,sc.len-pos);
    if(!kit && st.recipe!=="raw"){ const c=chordAtBar(tl,Math.floor((sc.g0+pos)/STEPS)), sh=c?c.sec.shift||0:0;
      note = (st.recipe==="chordtones" && Math.abs(pos%4)<1e-6) ? nearestPc(note,c.tones) : nearestPc(note,scaleAt(st,prog,sh)); }
    if(!kit) note=inRange(note,I.lo,I.hi);
    const key = inst==="sing" ? String(Math.round(pos*1000)) : Math.round(pos*1000)+":"+note+":"+(k++);
    const prev=out.get(key); if(!prev||prev.vel<h.vel) out.set(key,{pos,len,vel:h.vel,note,text:h.text||"",syl:h.syl==null?-1:h.syl}); }
  const arr=[...out.values()].sort((a,b)=>a.pos-b.pos);
  if(inst==="sing") for(let i=0;i<arr.length-1;i++) arr[i].len=Math.max(0.25,Math.min(arr[i].len, arr[i+1].pos-arr[i].pos));
  for(const n of arr) n.g=sc.g0+n.pos;
  return arr; }
const takeLabel = t => `${t.name} · ${(LIVE[t.inst||"sing"]||LIVE.sing).label.split(" (")[0]} · ${t.scope==="song"?"full song":"section"} (${t.mode==="loop"&&!t.muted?"loop":t.muted?"muted":"silent"})`;
let srcCache={key:null};
function sources(st, tl, rec, all){ // melody + instrument sources placed on the song (audible ones for playback; every take for MIDI)
  const key=JSON.stringify([takesVer,st.recipe,st.keyRoot,st.chords,st.song,st.shape,st.vocal,st.vocalPreset,!!rec,!!all]);
  if(srcCache.key===key) return srcCache.v;
  const out=[], covered=new Set();
  for(const tk of takes){ if(!all && !audible(tk)) continue; const ns=takeNotes(tk,st,tl); if(!ns.length) continue; const inst=tk.inst||"sing";
    out.push({id:tk.id, take:tk, inst, part:inst==="sing"?"lead":"play", fx:tk.fx===undefined?fxFor(kindOf(inst),inst):tk.fx, notes:ns, label:takeLabel(tk)});
    if(inst==="sing" && audible(tk)){ if(tk.scope==="song") tl.secs.forEach(s=>covered.add(s.id)); else covered.add(tk.scope); } }
  if(!rec){ const ns=[]; for(const s of tl.secs) if(!covered.has(s.id)) for(const n of sketchSection(s,st,tl)) ns.push(Object.assign(n,{g:s.start*STEPS+n.pos}));
    if(ns.length) out.push({id:"sketch", inst:"sing", part:"lead", fx:{kind:"vocal",preset:st.vocalPreset,cfg:st.vocal}, notes:ns, label:`Sketch · ${st.shape} (generated from your words, not played)`, demo:true}); }
  srcCache={key,v:out}; return out; }
let lmCache={key:null};
function leadMap(st, tl, rec, only){ // Map(globalStep -> events)
  const list=only?[only]:sources(st,tl,rec,false), key=only?null:srcCache.key;
  if(key&&lmCache.key===key) return lmCache.map;
  const map=new Map();
  for(const s of list) for(const h of s.notes){ const g=Math.floor(h.g), I=(LIVE[s.inst]||LIVE.sing);
    (map.get(g)||map.set(g,[]).get(g)).push({part:s.part, src:I.src, note:h.note, vel:h.vel, off:h.g-g, dur:h.len, text:h.text, syl:h.syl, srcId:s.id, fx:s.fx, ch:I.ch, inst:s.inst}); }
  if(key) lmCache={key,map}; return map; }

// ---------- band: one function feeds live, WAV and MIDI (deterministic). Feel, density and moves per section. ----------
function closeVoicing(tones, lo, hi){ const v=[inRange(lo+pc(tones[0]-lo),lo,lo+11)]; for(const t of tones.slice(1)) v.push(v[0]+pc(t-v[0])); return v.map(n=>inRange(n,lo,hi)).sort((a,b)=>a-b); }
function stepEvents(g, st, tl, opt){
  opt=opt||{}; const out=[], bar=Math.floor(g/STEPS), s=g%STEPS, B=tl.bars[bar]; if(!B) return out;
  const sec=B.sec, feel=sec.feel||"normal", dens=sec.density||"full", ins=sec.insts||{}, last=B.local===sec.bars-1;
  const on = id => !st.mutes[id] && ins[id]!==false && (!opt.parts || opt.parts.includes(id));
  const stopBar = last && sec.end==="stop", fill = last && sec.end==="fill", build = last && sec.end==="build", drop = sec.drop && B.local<2;
  const prevSec = sec.i>0 ? tl.secs[sec.i-1] : null;
  const crash = s===0 && ((B.local===0 && prevSec && (prevSec.end!=="none" || (sec.shift||0)>(prevSec.shift||0) || prevSec.feel!==feel)) || (sec.drop && B.local===2));
  const root=B.root, b=inRange(28+pc(root-28),28,39), f=b+7, pv=closeVoicing(B.tones,57,72), kv=closeVoicing(B.tones,52,67), ev=closeVoicing(B.tones,55,70);
  const add=(part,src,note,dur,vel,off)=>out.push({part,src,note,dur,vel,off:off||0});
  const kit=(n,v,d)=>{ if(on("kit")) add("kit","kit",n,d||1,v); };
  const lead=()=>{ if(!opt.noLead){ const k=leadMap(st, tl, opt.rec, opt.only).get(g); if(k) for(const h of k){ if(st.mutes[h.part]) continue; out.push(Object.assign({},h)); } } return out; };
  if(stopBar){ // HoleFour stop bar: everyone hits beat 1, then a hole
    if(s===0){ kit(36,1); kit(49,0.7,8); if(on("bass")) add("bass","bass",b,2,0.95); if(on("piano")) for(const n of kv) add("piano","piano",n,2,0.7); if(on("epiano")) for(const n of ev) add("epiano","epiano",n,2,0.6);
      if(on("gtr")) kv.forEach((n,k)=>add("gtr","nylon",inRange(n,45,72),2,0.6,k*0.06)); if(on("pad")) for(const n of pv) add("pad","pad",n,3,0.5); }
    return lead(); }
  if(crash) kit(49,0.75,8);
  const kitOn = !drop; // sparse = kick + snare only (no hats), so a half-time bridge is still heard
  if(kitOn && !(fill && s>=12) && !build){
    if(feel==="half"){ if(s===0) kit(36,0.95); if(s===10 && dens==="full") kit(36,0.55); if(s===8) kit(38,0.85); if(s%4===0 && dens==="full") kit(42,s%8?0.35:0.5); }
    else if(feel==="double"){ if(s%4===0) kit(36,s===0?1:0.85); if(s%4===2) kit(38,0.82); if(dens==="full") kit(42,s%2===0?0.45:0.28); }
    else { if(s===0||s===10) kit(36,s?0.75:0.95); if(s===4||s===12) kit(38,0.8); if(dens==="full" && s%2===0) kit(42,s%4?0.35:0.5); if(dens==="mid" && s%4===0) kit(42,0.3); } }
  if(fill && s>=12){ kit(38,0.55+0.1*(s-12)); if(s===12) kit(36,0.8); }                          // RollFour: beat-4 fill
  if(build){ if(s>=8 || s%2===0) kit(38,0.35+0.04*s); if(s%4===0) kit(36,0.8); }                    // LiftTwo: 8ths then 16ths, crescendo
  if(on("bass")){
    if(dens==="sparse"||drop){ if(s===0) add("bass","bass",b,feel==="half"?16:12,0.85); }
    else if(feel==="half"){ if(s===0) add("bass","bass",b,10,0.95); if(s===12) add("bass","bass",f,4,0.7); }
    else if(feel==="double"){ if(s%2===0) add("bass","bass",(s/2)%2===0?b:f,2,s%4===0?0.95:0.8); }
    else { if(s===0) add("bass","bass",b,6,0.95); if(s===8) add("bass","bass",b,4,0.8); if(s===14 && dens==="full") add("bass","bass",b+12,2,0.6); } }
  if(!drop){
    const hits = feel==="half" ? [0] : feel==="double" ? [0,2,4,6,8,10,12,14] : dens==="sparse" ? [0] : [0,8];
    if(on("piano") && hits.includes(s)) for(const n of kv) add("piano","piano",n,feel==="double"?2:feel==="half"?15:7,(s?0.5:0.62)*(feel==="double"?0.8:1));
    const eh = feel==="half" ? [0,8] : feel==="double" ? [0,4,8,12] : dens==="sparse" ? [0] : [0,6,8];
    if(on("epiano") && eh.includes(s)) for(const n of ev) add("epiano","epiano",n,feel==="double"?3:s===6?2:6,s===0?0.6:0.45);
    const gh = feel==="half" ? [0,8] : feel==="double" ? [0,2,4,6,8,10,12,14] : dens==="sparse" ? [0] : [0,3,6,8,11,14];
    if(on("gtr") && gh.includes(s)) kv.forEach((n,k)=>add("gtr","nylon",inRange(n,45,72),feel==="double"?2:3,(s%8===0?0.7:0.5),(s%4===0?k:kv.length-1-k)*0.06)); }
  if(on("pad") && s===0) for(const n of pv) add("pad","pad",n,16,0.5);                            // strings hold at the original rate (DoubleFour)
  return lead();
}

// ---------- samples: pinned CDN, raw ArrayBuffers kept for export ----------
const files = [];
for (const [id,I] of Object.entries(INST)) for (let n=I.lo; n<=I.hi; n++) files.push({ id, note:n, url:`${FLUID}/${I.prog}-mp3/${noteName(n)}.mp3`, label:I.label });
for (const [n,p] of Object.entries(KITMAP)) files.push({ id:"kit", note:+n, url:`${KIT}/${p}`, label:`Kit ${KITNAME[n]} (Virtuosity Drums)` });
const raw = {}, missing = new Set(); let loaded = 0, loadDone = false;
const loadAll = (async () => {
  let i = 0; const worker = async () => { while (i < files.length) { const f = files[i++];
    try { const r = await fetch(f.url); if (!r.ok) throw new Error(r.status); raw[f.url] = await r.arrayBuffer(); }
    catch (e) { missing.add(f.label + " (" + f.url.split("/").pop() + ")"); }
    loaded++; if(loaded%8===0||loaded===files.length) showLoad(); } };
  await Promise.all(Array.from({length:10}, worker)); loadDone = true; showLoad();
})();
const GATED_BTNS=["playA","playB","recBtn","recBtn2","exportWav","exportMid","exportStems","exportSheet"];
function showLoad(){
  const el = document.getElementById("status"); if(!el) return;
  if (missing.size) { el.className="status miss"; const inst=[...new Set([...missing].map(m=>m.replace(/ \(.*$/,"")))];
    el.textContent = `Missing instruments, playback and export disabled: ${inst.join(", ")} — ${missing.size} file(s) failed, e.g. ${[...missing].slice(0,3).join(", ")}`; }
  else el.textContent = loadDone ? `Voice and band seated ${loaded}/${files.length} · live FluidR3 + CC0 kit` : `Seating voice and band ${loaded}/${files.length}`;
  const ok = loadDone && !missing.size; GATED_BTNS.forEach(id=>{ const b=document.getElementById(id); if(b) b.disabled=!ok; });
}
async function decodeAll(c){ const out={};
  await Promise.all(files.map(async f => { const buf = await c.decodeAudioData(raw[f.url].slice(0));
    const d0=buf.getChannelData(0); let pk=0; for(let i=0;i<d0.length;i++){ const a=Math.abs(d0[i]); if(a>pk) pk=a; }
    let on=0; while(on<d0.length && Math.abs(d0[on])<pk*0.01) on++; on=Math.max(0,on-2);
    (out[f.id]=out[f.id]||{})[f.note] = { buf, offset:on/buf.sampleRate }; }));
  return out; }
function pick(id, note){ if(id==="kit") return note; const I=INST[id]; const n=Math.min(I.hi,Math.max(I.lo,note)); if(Math.abs(n-note)>MAX_SHIFT) throw new Error(id+" out of range "+note); return n; }

// ---------- sampler voice ----------
const REL = id => id==="kit" ? 0.03 : INST[id].rel;
function voice(c, bufs, dest, ev, t, sd, track){
  const id = ev.src, r = pick(id, ev.note), smp = bufs[id][r], buf = smp.buf, rate = Math.pow(2,(ev.note-r)/12), hold = id!=="kit" && INST[id].hold;
  t += (ev.off||0)*sd;
  const end = t + ev.dur*sd, rel = REL(id), g = c.createGain(); g.connect(dest);
  const usable = (buf.duration - smp.offset)/rate - 0.05;
  let off = id==="kit" ? t + Math.min(usable, ev.note===42?0.22:ev.note===49?Math.max(0.6,ev.dur*sd):0.7) : end;
  if (!hold) off = Math.min(off, t + usable - rel);
  if (id==="kit") g.gain.setValueAtTime(ev.vel, t);
  else { g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(ev.vel, t+((INST[id].atk)||0.003)); }
  g.gain.setValueAtTime(ev.vel, off); g.gain.linearRampToValueAtTime(0, off+rel);
  const srcs=[]; const XF=0.25, LOOP_FROM=1.0; let segStart=t, segOff=smp.offset, first=true;
  for(;;){
    const s=c.createBufferSource(); s.buffer=buf; s.playbackRate.value=rate; const sg=c.createGain(); s.connect(sg); sg.connect(g);
    const segEnd = segStart + (buf.duration-segOff)/rate - 0.05;
    if(!first){ sg.gain.setValueAtTime(0,segStart); sg.gain.linearRampToValueAtTime(1,segStart+XF); }
    s.start(segStart, segOff);
    if(hold && segEnd < off+rel){ sg.gain.setValueAtTime(1,segEnd-XF); sg.gain.linearRampToValueAtTime(0,segEnd); s.stop(segEnd+0.01); srcs.push(s); segStart=segEnd-XF; segOff=LOOP_FROM; first=false; }
    else { s.stop(off+rel+0.01); srcs.push(s); break; } }
  if(track) for(const s of srcs){ active.add(s); s.onended=()=>active.delete(s); }
}
function makeComp(c){ const k=c.createDynamicsCompressor(); k.threshold.value=-8; k.knee.value=6; k.ratio.value=12; k.attack.value=0.003; k.release.value=0.15; return k; }
const dbLin = db => db <= -40 ? 0 : Math.pow(10, db/20);
const LIVE_MAKEUP = 2.2; // live samples sit under the band mix; this lines a normal performance up at 0 dB, the limiter catches the rest
// Offline (exports): chairs -> master -> comp -> destination (measured latency removed).
// Live: band chairs -> Band fader, your parts + live monitor -> "Your playing" fader, -> master (A/B makeup) -> Master fader -> comp -> limiter -> out.
function buildBus(c, gains, live){ const comp=makeComp(c), master=c.createGain(), chairs={};
  if(!live){ master.connect(comp); comp.connect(c.destination); for(const ch of CHAIRS){ const g=c.createGain(); g.gain.value=gains[ch.id]; g.connect(master); chairs[ch.id]=g; } return {comp,master,chairs}; }
  const band=c.createGain(), you=c.createGain(), user=c.createGain(), lim=c.createDynamicsCompressor();
  lim.threshold.value=-2; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.001; lim.release.value=0.12;
  band.connect(master); you.connect(master); master.connect(user); user.connect(comp); comp.connect(lim); lim.connect(c.destination);
  for(const ch of CHAIRS){ const g=c.createGain(); g.gain.value=gains[ch.id]; g.connect(ch.you?you:band); chairs[ch.id]=g; }
  const mon=c.createGain(); mon.gain.value=LIVE_MAKEUP; mon.connect(you);
  return {comp,master,chairs,band,you,user,lim,mon}; }
function applyFaders(){ if(!bus) return; bus.you.gain.value=dbLin(state.liveDb); bus.band.gain.value=dbLin(state.bandDb); bus.user.gain.value=dbLin(state.masterDb); }
// FX routing: each source (take / sketch) gets its own chain instance per context, keyed by its settings
function fxRouter(c, b, bpm){ const cache=new Map();
  const fn=function dest(ev){ const base=b.chairs[ev.part]; if(!ev.fx || !ev.fx.cfg) return base;
    const key=ev.srcId+"|"+JSON.stringify(ev.fx.cfg)+"|"+bpm; let ch=cache.get(key);
    if(!ch){ ch=FX.build(c, ev.fx.kind, ev.fx.cfg, bpm, base); cache.set(key,ch); fn.descs[key]=ch.desc; }
    return ch.input; }; fn.descs={}; return fn; }

// ---------- live engine: lookahead scheduler on the audio clock, over the song or one looped section ----------
let ctx=null, bus=null, liveBufs=null, timerId=null, nextStepTime=0, g=0, playing=false, mode=null, liveRouter=null, routerBpm=0;
let range={g0:0,g1:0}, pendingRange=null, passNo=0;
const active=new Set(), stepLog=[]; window.__schedLog=[]; window.__monitorDesc={};
async function ensureCtx(){
  if(!ctx){ ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:SR}); bus=buildBus(ctx,state.gains,true); applyFaders(); applySink(); await FX.ready(ctx); }
  await ctx.resume(); if(!liveBufs){ await loadAll; if(!missing.size) liveBufs=await decodeAll(ctx); }
}
function rangeFor(sel){ const tl=TL(); const s=sel>=0?tl.secs[sel]:null; return s?{g0:s.start*STEPS,g1:(s.start+s.bars)*STEPS}:{g0:0,g1:tl.total*STEPS}; }
function setLoop(sel){ state.loopSec=sel; save(); if(playing) pendingRange=rangeFor(sel); paintTimeline(); }
function router(){ if(!liveRouter||routerBpm!==state.bpm){ liveRouter=fxRouter(ctx,bus,state.bpm); routerBpm=state.bpm; } return liveRouter; }
async function start(m, fromG){
  if(!ctx||ctx.state!=="running"||!liveBufs||missing.size) return;
  stop(); range=rangeFor(state.loopSec); pendingRange=null;
  const mk = m==="band" ? await makeupGain() : 1; bus.master.gain.setValueAtTime(mk, ctx.currentTime); mode=m;
  nextStepTime=ctx.currentTime+0.1; g=(fromG!=null&&fromG>=range.g0&&fromG<range.g1)?fromG-(fromG%STEPS):range.g0; stepLog.length=0; playing=true; passNo=0;
  timerId=setInterval(scheduler, LOOKAHEAD_MS); scheduler(); requestAnimationFrame(draw); paintDock();
}
function scheduler(){ while(nextStepTime < ctx.currentTime+SCHEDULE_AHEAD){ scheduleStep(g, nextStepTime); nextStepTime += 60/state.bpm/4; g++;
    if(g%STEPS===0 && pendingRange){ range=pendingRange; pendingRange=null; if(g<range.g0||g>=range.g1) g=range.g0; } // range changes land on the next bar line
    if(g>=range.g1) g=range.g0; }
  if(mode==="rec") recTick(); }
function scheduleStep(st, time){
  const tl=TL(), sd=60/state.bpm/4, evs = stepEvents(st, state, tl, {noLead:mode==="band", rec:mode==="rec"}), R=router();
  if(mode==="rec" && state.recClick && st%4===0) evs.push({part:"kit",src:"kit",note:42,dur:1,vel:st%16===0?0.5:0.3,click:true});
  for(const ev of evs){ voice(ctx, liveBufs, R(ev), ev, time, sd, true); if(!ev.click) midiSend(ev, time, sd); }
  Object.assign(window.__monitorDesc, R.descs);
  if(st===range.g0){ passNo++; if(mode==="rec") recPasses.push({pass:passNo, time, sd, g0:range.g0, g1:range.g1, sel:state.loopSec, done:false}); }
  const B=tl.bars[Math.floor(st/STEPS)];
  stepLog.push({bar:Math.floor(st/STEPS), s:st%STEPS, st, pass:passNo, time, sec:B?B.sec.i:-1}); if(stepLog.length>256) stepLog.shift();
  window.__schedLog.push({step:st, time, bpm:state.bpm, recipe:state.recipe, keyRoot:state.keyRoot, mode, sec:B?B.sec.i:-1, feel:B?B.sec.feel:"", mutes:Object.assign({},state.mutes), notes:evs.map(e=>e.part+":"+e.note)});
  if(window.__schedLog.length>4000) window.__schedLog.shift();
}
function stop(){
  const wasRec = mode==="rec"; const stopAt = ctx ? ctx.currentTime : 0;
  clearInterval(timerId); timerId=null; playing=false; mode=null; pendingRange=null;
  for(const s of active){ try{ s.stop(); }catch(e){} } active.clear();
  if(midiOut) for(const c of [...CHAIRS.map(c=>c.ch),...Object.values(LIVE).map(l=>l.ch)]) midiOut.send([0xB0|c,123,0]);
  document.querySelectorAll(".kw.now").forEach(x=>x.classList.remove("now")); lastK=-2;
  if(wasRec) finishRec(stopAt);
  paintDock(); paintPlayhead(-1);
}
function curEntry(t){ let cur=null; for(const e of stepLog){ if(e.time<=t) cur=e; else break; } return cur; }
function draw(){ if(!playing) return; const now=ctx.currentTime, cur=curEntry(now);
  if(cur){ const frac=Math.min(1,(now-cur.time)/(60/state.bpm/4)); paintPlayhead(cur.st+frac); karaokeAt(mode==="band"?-1:cur.st+frac); }
  updateHint(); requestAnimationFrame(draw); }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden"){ if(playing){ stop(); setStatus("Stopped (tab hidden). Press play to start again."); } liveAllOff(); } });

// ---------- export (OfflineAudioContext; same stepEvents, same FX builder as live) ----------
let compLatency=null;
async function measureCompLatency(){
  if(compLatency!==null) return compLatency;
  const oc=new OfflineAudioContext(1,4096,SR), b=oc.createBuffer(1,600,SR), x=b.getChannelData(0); for(let i=0;i<600;i++) x[i]=0.3*Math.sin(2*Math.PI*60*i/SR);
  const s=oc.createBufferSource(); s.buffer=b; const k=makeComp(oc); s.connect(k); k.connect(oc.destination); s.start(0);
  const d=(await oc.startRendering()).getChannelData(0); let best=0,bv=-Infinity;
  for(let Lg=0;Lg<1024;Lg++){ let c=0; for(let i=0;i<600;i++) c+=x[i]*d[i+Lg]; if(c>bv){bv=c;best=Lg;} } return compLatency=best;
}
function merged(o){ const st=Object.assign({},state,o||{}); st.mutes=Object.assign({},state.mutes,(o||{}).mutes); st.gains=Object.assign({},state.gains,(o||{}).gains); return st; }
const demoBars = tl => tl.secs.slice(0,2).reduce((a,s)=>a+s.bars,0);
async function renderSong(o, noNorm){
  o=o||{}; await loadAll; if(missing.size) throw new Error("Missing samples");
  const st=merged(o), tl=TL(), fromBar=o.fromBar||0, total=tl.total;
  const bars = o.bars || (gatedNow() && !o.ignoreGate ? demoBars(tl) : total - fromBar);
  const N=Math.round(bars*4*60/st.bpm*SR), TAIL=Math.round(3*SR), D=await measureCompLatency();
  const oc=new OfflineAudioContext(2, D+N+TAIL, SR); await FX.ready(oc);
  const bufs=await decodeAll(oc), b=buildBus(oc, st.gains, false), sd=60/st.bpm/4, R=fxRouter(oc,b,st.bpm);
  let only=o.only||null; if(only&&o.dry) only=Object.assign({},only,{fx:null});
  const opt={parts:o.only?[]:o.parts, noLead:!!o.noLead, only};
  for(let s=0;s<bars*STEPS;s++){ const gg=(fromBar*STEPS+s)%(total*STEPS);
    for(const ev of stepEvents(gg, st, tl, opt)){ if(o.dry) ev.fx=null; voice(oc, bufs, R(ev), ev, s*sd, sd, false); } }
  const buf=await oc.startRendering();
  const ch=[0,1].map(i=>{ const d=buf.getChannelData(i), x=new Float32Array(N); x.set(d.subarray(D,D+N)); for(let j=0;j<TAIL;j++) x[j%N]+=d[D+N+j]; return x; });
  if(noNorm) return {ch,N,st,bars,descs:R.descs};
  let pk=0; for(const d of ch) for(let i=0;i<N;i++){ const a=Math.abs(d[i]); if(a>pk) pk=a; }
  let k=pk>0?Math.pow(10,-1.1/20)/pk:1; if(st.stem) k=Math.min(1,k); for(const d of ch) for(let i=0;i<N;i++) d[i]*=k;
  return {ch,N,st,bars,descs:R.descs};
}
// A (band only) and B (band + your parts) at matched loudness: makeup measured offline on the loop range (max 16 bars)
let mkCache={key:null,v:1};
async function makeupGain(){ const tl=TL(), r=rangeFor(state.loopSec), fromBar=r.g0/STEPS, bars=Math.min(16,(r.g1-r.g0)/STEPS);
  const key=JSON.stringify([takesVer,state.recipe,state.gains,state.mutes,state.chords,state.keyRoot,state.bpm,state.song,state.shape,state.vocal,fromBar,bars]);
  if(mkCache.key===key) return mkCache.v;
  try{ const rms=r=>{ let s=0; for(const d of r.ch) for(let i=0;i<r.N;i++) s+=d[i]*d[i]; return Math.sqrt(s/(2*r.N)); };
    const a=await renderSong({fromBar,bars,mutes:{lead:true,play:true}},true), bb=await renderSong({fromBar,bars},true);
    const v=rms(a)>1e-6?Math.min(4,Math.max(0.25,rms(bb)/rms(a))):1; mkCache={key,v}; window.__makeup={A_rms:rms(a),B_rms:rms(bb),gain:v,fromBar,bars}; return v; }
  catch(e){ return 1; } }
function wav24(ch,N){ const nc=2,len=N*nc*3,b=new ArrayBuffer(44+len),v=new DataView(b); let p=0;
  const str=s=>{for(const c of s) v.setUint8(p++,c.charCodeAt(0));}, u32=x=>{v.setUint32(p,x,true);p+=4}, u16=x=>{v.setUint16(p,x,true);p+=2};
  str("RIFF");u32(36+len);str("WAVE");str("fmt ");u32(16);u16(1);u16(nc);u32(SR);u32(SR*nc*3);u16(nc*3);u16(24);str("data");u32(len);
  for(let i=0;i<N;i++) for(let c=0;c<nc;c++){ let x=Math.round(Math.max(-1,Math.min(1,ch[c][i]))*8388607); if(x<0)x+=16777216; v.setUint8(p++,x&255);v.setUint8(p++,(x>>8)&255);v.setUint8(p++,(x>>16)&255); }
  return new Uint8Array(b); }
function midiFile(st){
  const tl=TL(), PPQ=480,T=PPQ/4, total=tl.total*STEPS*T, vlq=n=>{const a=[n&127]; while(n>>=7) a.unshift((n&127)|128); return a;};
  const trk=evs=>{ evs.sort((a,b)=>a.t-b.t||a.o-b.o); let last=0; const d=[]; for(const e of evs){ d.push(...vlq(e.t-last),...e.b); last=e.t; }
    d.push(...vlq(Math.max(0,total-last)),0xFF,0x2F,0); return [0x4D,0x54,0x72,0x6B,(d.length>>>24)&255,(d.length>>16)&255,(d.length>>8)&255,d.length&255,...d]; };
  const meta=(type,s)=>{ const c=[...new TextEncoder().encode(s)]; return [0xFF,type,...vlq(c.length),...c]; }, name=s=>meta(0x03,s), us=Math.round(60000000/st.bpm);
  // ONE tempo for the whole song: half/double-time are feels, not tempo changes. A marker at every section.
  const cond=[{t:0,o:0,b:name(APP+" "+keyLabel()+" "+st.bpm+" BPM")},{t:0,o:1,b:[0xFF,0x51,3,(us>>16)&255,(us>>8)&255,us&255]},{t:0,o:2,b:[0xFF,0x58,4,4,2,24,8]}];
  for(const s of tl.secs) cond.push({t:s.start*STEPS*T,o:3,b:meta(0x06,`${s.label}${s.feel!=="normal"?" ("+FEELS[s.feel]+")":""}`)});
  const tracks=[trk(cond)];
  const add=(evs,ch,note,t0,t1,vel)=>{ const v=Math.max(1,Math.round(vel*110)); evs.push({t:t0,o:2,b:[0x90|ch,note,v]}); evs.push({t:Math.max(t0+1,Math.min(total,t1)),o:1,b:[0x80|ch,note,0]}); };
  for(const c of CHAIRS.filter(c=>!c.you)){ const evs=[{t:0,o:0,b:name(c.name)}];
    for(let s=0;s<tl.total*STEPS;s++) for(const ev of stepEvents(s,st,tl,{noLead:true})) if(ev.part===c.id) add(evs,c.ch,ev.note,Math.round((s+(ev.off||0))*T),Math.round((s+(ev.off||0)+ev.dur)*T),ev.vel);
    tracks.push(trk(evs)); }
  for(const src of sources(st,tl,false,true)){ const I=LIVE[src.inst]||LIVE.sing, evs=[{t:0,o:0,b:name((src.inst==="sing"?"Melody: ":"Played: ")+src.label)}];
    if(!st.mutes[src.part]) for(const h of src.notes){ const t0=Math.round(h.g*T); if(src.inst==="sing"&&h.text) evs.push({t:t0,o:1.5,b:meta(0x05,h.text)}); add(evs,I.ch,h.note,t0,Math.round((h.g+h.len)*T),h.vel); }
    tracks.push(trk(evs)); }
  return new Uint8Array([].concat([0x4D,0x54,0x68,0x64,0,0,0,6,0,1,0,tracks.length,PPQ>>8,PPQ&255],...tracks));
}
function moveText(s){ const m=[]; if(s.feel!=="normal") m.push(FEELS[s.feel]); if(s.density!=="full") m.push(DENS[s.density]+" band"); if(s.drop) m.push("drop-out bars 1-2");
  if(s.end!=="none") m.push(ENDS[s.end]+" (last bar)"); if(s.shift) m.push("lift +"+s.shift); const off=BAND.filter(k=>s.insts&&s.insts[k]===false).map(k=>INST_SHORT[k]); if(off.length) m.push("no "+off.join(", ")); return m.join(" · ")||"as written"; }
function lyricSheet(st){ const tl=TL(), lines=[`${APP.toUpperCase()} song sheet · ${st.bpm} BPM (one tempo; feels are not tempo changes) · key ${NAMES[st.keyRoot]} ${prog[0].minor?"minor":"major"} · recipe ${st.recipe}`,
    `${tl.secs.length} sections · ${tl.total} bars · ${(tl.total*4*60/st.bpm).toFixed(1)} s`, "Notes: the voice sample sings \"ooh\"; your words are attached to every note here and as MIDI lyric events.",""];
  const srcs=sources(st,tl,false,false).filter(s=>s.inst==="sing");
  for(const s of tl.secs){ lines.push(`== ${s.label} · bars ${s.start+1}-${s.start+s.bars} · ${moveText(s)} ==`);
    lines.push("Chords: "+Array.from({length:s.bars},(_,b)=>tl.bars[s.start+b].name).join(" | "));
    for(const ln of s.lines||[]) lines.push("  "+ln);
    for(const src of srcs){ const ns=src.notes.filter(h=>h.g>=s.start*STEPS&&h.g<(s.start+s.bars)*STEPS); if(!ns.length) continue;
      lines.push(`  [${src.label}] `+ns.map(h=>{ const b=Math.floor(h.g/STEPS)-s.start, p=h.g%STEPS; return `${h.text||"·"} ${noteName(h.note)}@${b+1}.${Math.floor(p/4)+1}.${Math.floor(p%4)+1}`; }).join("  ")); }
    lines.push(""); }
  return lines.join("\n"); }
const fileBase = st => `${APP}-${st.recipe}-${st.bpm}bpm-${keyLabel()}`;
function download(bytes,name,type){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([bytes],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); }
async function exportWavBytes(o){ const r=await renderSong(o); return {bytes:wav24(r.ch,r.N), name:fileBase(r.st)+".wav", frames:r.N, bars:r.bars}; }
function exportMidBytes(o){ const st=merged(o); return {bytes:midiFile(st), name:fileBase(st)+".mid"}; }
function exportSheetBytes(o){ const st=merged(o); return {bytes:new TextEncoder().encode(lyricSheet(st)), name:fileBase(st)+"-sheet.txt"}; }
function crc32(b){ let c,crc=-1; for(let i=0;i<b.length;i++){ c=(crc^b[i])&255; for(let k=0;k<8;k++) c=c&1?(c>>>1)^0xEDB88320:c>>>1; crc=(crc>>>8)^c; } return (crc^-1)>>>0; }
function zipStore(fl){ const parts=[], cen=[]; let off=0; const enc=new TextEncoder();
  const le=(n,w)=>{ const a=[]; for(let i=0;i<w;i++) a.push((n>>>(8*i))&255); return a; };
  for(const f of fl){ const nm=enc.encode(f.name), c=crc32(f.bytes), sz=f.bytes.length;
    const h=new Uint8Array([0x50,0x4B,3,4,20,0,0,0,0,0,0,0,0x21,0,...le(c,4),...le(sz,4),...le(sz,4),...le(nm.length,2),0,0,...nm]);
    parts.push(h,f.bytes); cen.push(new Uint8Array([0x50,0x4B,1,2,20,0,20,0,0,0,0,0,0,0,0x21,0,...le(c,4),...le(sz,4),...le(sz,4),...le(nm.length,2),0,0,0,0,0,0,0,0,0,0,0,0,...le(off,4),...nm]));
    off+=h.length+sz; }
  const cl=cen.reduce((a,x)=>a+x.length,0), end=new Uint8Array([0x50,0x4B,5,6,0,0,0,0,...le(fl.length,2),...le(fl.length,2),...le(cl,4),...le(off,4),0,0]);
  const out=new Uint8Array(off+cl+end.length); let p=0; for(const x of [...parts,...cen,end]){ out.set(x,p); p+=x.length; } return out; }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
async function exportStemsBytes(o){ o=o||{}; const st=merged(o), tl=TL(), base=fileBase(st), fl=[], dryToo=o.dryToo!=null?o.dryToo:state.stemsDry;
  const one=async(tag,opt)=>{ const r=await renderSong(Object.assign({},o,opt,{stem:true})); fl.push({name:`${base}-${tag}.wav`,bytes:wav24(r.ch,r.N),frames:r.N,peak:peakOf(r)}); };
  const want=o.which;
  for(const id of BAND){ if(state.mutes[id]||(want&&!want.includes(id))) continue; await one(slug(INST_SHORT[id]),{parts:[id],noLead:true}); }
  for(const src of sources(state,tl,false,false)){ if(want&&!want.includes(src.id)) continue; const tag=src.id==="sketch"?"sketch-melody":slug(src.take.name+"-"+(src.inst==="sing"?"vocal":src.inst));
    await one(tag+(src.fx&&src.fx.cfg?"-processed":""),{only:src});
    if(dryToo && src.fx && src.fx.cfg) await one(tag+"-dry",{only:src,dry:true}); }
  return {files:fl, zip:zipStore(fl), name:`${base}-stems.zip`}; }
function peakOf(r){ let pk=0; for(const d of r.ch) for(let i=0;i<r.N;i++){ const a=Math.abs(d[i]); if(a>pk) pk=a; } return pk; }

// ---------- license gate (Lemon Squeezy License API) ----------
// ONE place to configure checkout. PLACEHOLDERS until Mark creates the Lemon Squeezy product (license keys ON):
// paste checkoutUrl, storeId and productId below. While storeId/productId are null NO key unlocks anything.
const LEMON = { checkoutUrl: "", storeId: null, productId: null, price: "$19 once" };
window.__lemon=LEMON; // test hook (config only, no secrets)
const LS_API="https://api.lemonsqueezy.com/v1/licenses/";
const lic = (()=>{ try{ return JSON.parse(localStorage.getItem(APP+"-license")||'{"valid":false}'); }catch(e){ return {valid:false}; } })();
const configured = () => !!(LEMON.storeId && LEMON.productId);
async function lsCall(action, params){ const r=await fetch(LS_API+action,{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params).toString()}); return r.json(); }
const ours = j => !!j && j.meta && +j.meta.store_id===+LEMON.storeId && +j.meta.product_id===+LEMON.productId;
async function activateKey(key){
  if(!configured()) return {ok:false, reason:"Checkout is not live yet. License keys cannot be checked until the store is set up."};
  const j=await lsCall("activate",{license_key:key, instance_name:"WordFour "+(navigator.platform||"web")});
  if(!j.activated) return {ok:false, reason:j.error||"That key could not be activated."};
  if(!ours(j)){ if(j.instance) lsCall("deactivate",{license_key:key, instance_id:j.instance.id}).catch(()=>{}); return {ok:false, reason:"That key is for a different product."}; }
  return {ok:true, instance:j.instance.id}; }
async function validateKey(key, instance){ if(!configured()) return false; const j=await lsCall("validate", instance?{license_key:key, instance_id:instance}:{license_key:key}); return !!j.valid && ours(j); }
function saveLic(){ localStorage.setItem(APP+"-license",JSON.stringify(lic)); }
const licUI = () => { document.getElementById("licOff").hidden=!lic.valid; document.getElementById("licState").textContent = lic.valid ? "Licensed: full-song WAV and stems unlocked." : `Free demo: everything plays, records and exports MIDI and the song sheet. WAV and stems export the first 2 sections. A license (${LEMON.price}) unlocks the full song.`; };
const gatedNow = () => !lic.valid && TL().secs.length>2;

// ---------- Web MIDI ----------
let midiAccess=null, midiOut=null, midiInPort=null;
function midiSend(ev,time,sd){ if(!midiOut||!ctx) return; const ch=ev.ch!=null?ev.ch:(CHAIRS.find(x=>x.id===ev.part)||{ch:0}).ch, at=performance.now()+(time+(ev.off||0)*sd-ctx.currentTime)*1000, v=Math.max(1,Math.round(ev.vel*110));
  midiOut.send([0x90|ch,ev.note,v],at); midiOut.send([0x80|ch,ev.note,0],at+ev.dur*sd*1000-5); }
function onMidi(e){ const d=e.data, s=d[0], cmd=s&0xF0, n=d[1], v=d[2];
  // Transport: ONLY MIDI realtime Start/Continue/Stop, and only if the user opted in. Notes never touch transport.
  if(s===0xFA||s===0xFB){ if(state.midiTransport&&!playing) ensureCtx().then(()=>start("full")); return; }
  if(s===0xFC){ if(state.midiTransport&&playing) stop(); return; }
  if(s>=0xF0) return;
  if(cmd===0xB0&&n===64){ setSustain(v>=64); return; }
  if(cmd===0xB0&&(n===123||n===120)){ liveAllOff(); return; }
  const on=cmd===0x90&&v>0, off=cmd===0x80||(cmd===0x90&&v===0);
  if(on) liveOn(n,v/127,"midi"); else if(off) liveOff(n,"midi"); }
function refreshMidi(){ if(!midiAccess) return;
  const fill=(sel,ports,cur)=>{ sel.innerHTML='<option value="">(none)</option>'+[...ports.values()].map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(""); sel.value=[...ports.keys()].includes(cur)?cur:""; };
  fill(ui.midiIn,midiAccess.inputs,state.midiIn); fill(ui.midiOut,midiAccess.outputs,state.midiOut);
  if(midiInPort) midiInPort.onmidimessage=null; midiInPort=midiAccess.inputs.get(ui.midiIn.value)||null; if(midiInPort) midiInPort.onmidimessage=onMidi;
  midiOut=midiAccess.outputs.get(ui.midiOut.value)||null; }

// ---------- live play-along (VampFour panel): pick an instrument, play with velocity + sustain; never touches the transport ----------
// "Sing lyrics": every key sings the NEXT syllable of the section under the playhead, mono like a singer, through the vocal chain.
// Guitars and bass go through the amp. Everything lands on the "Your playing" fader, then Master and the limiter.
const liveVoices=new Map(); let sustain=false, wordCursor=0; const liveFx=new Map(); window.__liveLog=[];
const setStatus=t=>{ const el=document.getElementById("status"); if(!el) return; el.className="status"; el.textContent=t; };
function liveChainCfg(inst){ const k=kindOf(inst); return k?fxFor(k,inst):null; }
function liveDest(inst){ const fx=liveChainCfg(inst); if(!fx) return bus.mon;
  const key=fx.kind+"|"+JSON.stringify(fx.cfg)+"|"+state.bpm; let ch=liveFx.get(key);
  if(!ch){ for(const [k,c] of liveFx) if(k.startsWith(fx.kind+"|")&&liveFx.size>6){ try{ c.output.disconnect(); }catch(e){} liveFx.delete(k); }
    ch=FX.build(ctx, fx.kind, fx.cfg, state.bpm, bus.mon); liveFx.set(key,ch); window.__monitorDesc["live:"+inst]=ch.desc; }
  return ch.input; }
function oneVoice(id, n, vg, t, dest){ const r=pick(id,n), smp=liveBufs[id][r], buf=smp.buf, rate=Math.pow(2,(n-r)/12), g=ctx.createGain(); g.connect(dest);
  const s=ctx.createBufferSource(); s.buffer=buf; s.playbackRate.value=rate; const hold=id!=="kit"&&INST[id].hold;
  if(hold){ s.loop=true; s.loopStart=Math.min(1.0,buf.duration*0.4); s.loopEnd=buf.duration-0.05; }
  s.connect(g); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(vg,t+(id==="kit"?0.001:(INST[id].atk||0.003)));
  s.start(t,smp.offset); if(!hold) s.stop(t+(buf.duration-smp.offset)/rate); return {s,g}; }
const passSyl=new Map(); // "pass:section" -> syllables sung so far there (each pass of each section starts from its first word)
function nextSyl(t, peek){ const tl=TL(), p=transportPos(t);
  if(p){ let pass=p.pass, pos=p.pos; if(pos>=range.g1-0.5){ pass++; pos=range.g0; }
    const B=tl.bars[Math.floor(pos/STEPS)], sec=B?B.sec:null;
    if(sec && sec.syl.length){ const key=pass+":"+sec.i, c=passSyl.get(key)||0; if(!peek) passSyl.set(key,c+1); return sec.syl[c%sec.syl.length]; } }
  if(!tl.syl.length) return null; const c=wordCursor; if(!peek) wordCursor++; return tl.syl[c%tl.syl.length]; }
function liveOn(note,vel,src){
  if(!ctx||ctx.state!=="running"||!liveBufs){ setStatus("Tap to start audio first, then play."); return; }
  const key=src+":"+note, t=ctx.currentTime, inst=state.liveInst, L=LIVE[inst];
  if(liveVoices.has(key)){ releaseVoice(liveVoices.get(key),t); recNoteOff(key,t); }
  const vg=Math.max(0.08,Math.pow(vel,1.3)), dest=liveDest(inst); let vo;
  if(inst==="sing"){
    for(const [k,v] of liveVoices) if(v.words){ releaseVoice(v,t); liveVoices.delete(k); recNoteOff(k,t); } // mono: a new syllable cuts the last
    const n=inRange(note,INST.voice.lo,INST.voice.hi), sy=nextSyl(t);
    vo={parts:[oneVoice("voice",n,vg,t,dest)],id:"voice",vg,sustained:false,done:false,notes:[n],words:true,syl:sy?sy.g:-1,text:sy?sy.text:""};
    recNoteOn(key,vel,n,vo.syl,vo.text,t,inst); paintNext(); kSing(vo.syl); }
  else if(L.src==="kit"){ const n=KIT_KEYS[pc(note)]; vo={parts:[oneVoice("kit",n,vg,t,dest)],id:"kit",vg,sustained:false,done:false,notes:[n]}; recNoteOn(key,vel,n,-1,"",t,inst); }
  else { const I=INST[L.src], n=inRange(note,I.lo,I.hi); vo={parts:[oneVoice(L.src,n,vg,t,dest)],id:L.src,vg,sustained:false,done:false,notes:[n]}; recNoteOn(key,vel,n,-1,"",t,inst); }
  if(midiOut) midiOut.send([0x90|L.ch,vo.notes[0],Math.max(1,Math.round(vel*127))]);
  let left=vo.parts.length; for(const p of vo.parts) p.s.onended=()=>{ if(--left<=0){ vo.done=true; if(liveVoices.get(key)===vo) liveVoices.delete(key); } };
  vo.ch=L.ch; liveVoices.set(key,vo); keyVis(note,true);
  window.__liveLog.push({ev:"on",note,vel,src,inst,played:vo.notes[0],syl:vo.syl,text:vo.text,perf:performance.now(),startAt:t,ctxNow:ctx.currentTime}); if(window.__liveLog.length>500) window.__liveLog.shift();
}
function releaseVoice(vo,t){ if(vo.done) return; vo.done=true; const rel=REL(vo.id)||0.1; if(midiOut&&vo.ch!=null) midiOut.send([0x80|vo.ch,vo.notes[0],0]);
  if(vo.id==="kit") return; // drums ring out
  for(const p of vo.parts){ const gg=p.g.gain; gg.cancelScheduledValues(t); gg.setValueAtTime(gg.value,t); gg.linearRampToValueAtTime(0,t+rel); try{ p.s.stop(t+rel+0.02); }catch(e){} } }
function liveOff(note,src){ const key=src+":"+note, vo=liveVoices.get(key); keyVis(note,false);
  window.__liveLog.push({ev:"off",note,src,perf:performance.now(),ctxNow:ctx?ctx.currentTime:0,sustain});
  if(!vo||!ctx) return; if(sustain){ vo.sustained=true; return; } liveVoices.delete(key); releaseVoice(vo,ctx.currentTime); recNoteOff(key,ctx.currentTime); }
function setSustain(down){ sustain=down; if(!down&&ctx) for(const [k,vo] of liveVoices) if(vo.sustained){ liveVoices.delete(k); releaseVoice(vo,ctx.currentTime); recNoteOff(k,ctx.currentTime); } }
function liveAllOff(){ if(!ctx) return; for(const [k,vo] of liveVoices){ releaseVoice(vo,ctx.currentTime); recNoteOff(k,ctx.currentTime); } liveVoices.clear(); sustain=false; document.querySelectorAll(".down").forEach(k=>k.classList.remove("down")); }
function transportPos(t){ if(!playing) return null; const cur=curEntry(t); if(!cur) return null; return {pos:cur.st+(t-cur.time)/(60/state.bpm/4), pass:cur.pass}; }

// ---------- the recorder: every loop pass becomes one take per instrument you played (scope = the looped section or the full song) ----------
let recPasses=[], passNotes=new Map(), openNotes=new Map();
function recNoteOn(key,vel,note,syl,text,t,inst){ if(mode!=="rec") return; const p=transportPos(t); if(!p||p.pass<1) return; let pass=p.pass, pos=p.pos;
  const rp=recPasses.find(x=>x.pass===pass); if(!rp) return;
  let rel=pos-rp.g0; if(pos>=rp.g1-0.5){ rel=0; pass++; } // a press just before the loop wraps belongs to the next pass's downbeat
  const h={pos:+rel.toFixed(4),len:null,vel:+(0.35+0.65*vel).toFixed(3),note,syl,text,t0:t,sd:60/state.bpm/4,pass,inst};
  (passNotes.get(pass)||passNotes.set(pass,[]).get(pass)).push(h); openNotes.set(key,h); }
function recNoteOff(key,t){ const h=openNotes.get(key); if(!h) return; openNotes.delete(key); h.len=+Math.max(0.25,(t-h.t0)/h.sd).toFixed(4); }
function finishPass(p){ p.done=true; const hs=passNotes.get(p.pass)||[], L=p.g1-p.g0; passNotes.delete(p.pass); for(const k of [...passSyl.keys()]) if(k.startsWith(p.pass+":")) passSyl.delete(k);
  for(const h of hs){ if(h.len===null){ h.len=+(L-h.pos).toFixed(4); for(const [k,v] of openNotes) if(v===h) openNotes.delete(k); } h.len=Math.min(h.len,L-h.pos); }
  const tl=TL(), scope=p.sel>=0&&tl.secs[p.sel]?tl.secs[p.sel].id:"song", by=new Map();
  for(const h of hs) (by.get(h.inst)||by.set(h.inst,[]).get(h.inst)).push({pos:h.pos,len:h.len,vel:h.vel,note:h.note,syl:h.syl,text:h.text});
  for(const [inst,ns] of by) addTake(ns,inst,scope,"played"); }
function recTick(){ if(!ctx) return; for(const p of recPasses) if(!p.done && ctx.currentTime > p.time + (p.g1-p.g0)*p.sd + 0.03) finishPass(p); }
function addTake(notes, inst, scope, src){
  inst=inst||"sing"; scope=scope||"song";
  if(takes.length>=TAKE_CAP){ setStatus(`Take limit (${TAKE_CAP}) reached, this pass was not kept. Export or delete takes to record more.`); return null; }
  const n=takes.reduce((m,t)=>Math.max(m,t.n),0)+1;
  if(!state.layer) for(const t of takes) if(t.mode==="loop" && (t.inst||"sing")===inst && (t.scope===scope||t.scope==="song"||scope==="song")) t.mode="silent"; // newest take of that part loops
  const tk={id:Date.now()+"-"+n,n,name:"Take "+n,mode:"loop",muted:false,src:src||"played",inst,scope,bpm:state.bpm,key:state.keyRoot,notes,fx:fxFor(kindOf(inst),inst)};
  takes.push(tk); saveTakes(); renderTakes(); paintTimeline(); return tk; }
async function startRec(){
  await ensureCtx(); if(!liveBufs) return; stop();
  recPasses=[]; passNotes=new Map(); openNotes=new Map(); passSyl.clear(); range=rangeFor(state.loopSec); pendingRange=null;
  bus.master.gain.setValueAtTime(1, ctx.currentTime);
  const bd=4*60/state.bpm, T0=ctx.currentTime+0.15+bd;
  for(let i=0;i<4;i++) voice(ctx, liveBufs, bus.chairs.kit, {src:"kit",note:i?42:38,dur:1,vel:i?0.6:0.85}, T0-bd+i*bd/4, 60/state.bpm/4, true); // count-in
  mode="rec"; nextStepTime=T0; g=range.g0; stepLog.length=0; playing=true; passNo=0; ui.bpm.disabled=true;
  timerId=setInterval(scheduler, LOOKAHEAD_MS); requestAnimationFrame(draw); paintDock(); paintNext();
  const where=state.loopSec>=0?TL().secs[state.loopSec].label:"the full song";
  setStatus(`Recording ${where} on ${LIVE[state.liveInst].label.split(" (")[0]}: one bar count-in, then play. Every pass becomes a new take. Press Stop when done.`);
}
function finishRec(stopAt){
  for(const [k] of [...openNotes]) recNoteOff(k,stopAt);
  for(const p of recPasses) if(!p.done && stopAt>p.time) finishPass(p);
  recPasses=[]; passSyl.clear(); ui.bpm.disabled=false; paintNext(); setStatus(takes.length?`${takes.length} take${takes.length>1?"s":""} saved. Press ▶ Song to hear them with the band.`:"Nothing recorded. Press ● Record and play after the count-in.");
}

// ---------- audio output device (AudioContext.setSinkId where supported) ----------
const sinkOK = () => typeof (window.AudioContext||function(){}).prototype.setSinkId === "function";
async function listOutputs(){ const sel=document.getElementById("audioOut"), note=document.getElementById("audioOutNote");
  if(!sinkOK()){ sel.innerHTML='<option value="">System default</option>'; sel.disabled=true; note.textContent="This browser can't route Web Audio to a chosen device (no AudioContext.setSinkId). Sound goes to your system output; change it in your OS sound settings."; return; }
  let devs=[]; try{ devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="audiooutput"&&d.deviceId&&d.deviceId!=="default"); }catch(e){}
  sel.innerHTML='<option value="">System default</option>'+devs.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||"Audio output "+(i+1))}</option>`).join("");
  sel.value=devs.some(d=>d.deviceId===state.audioOut)?state.audioOut:""; if(sel.value!==state.audioOut&&state.audioOut) note.textContent="Saved output is not connected; using system default.";
  else if(devs.length && !devs[0].label) note.textContent="Device names are hidden until the browser grants media permission; outputs are numbered."; }
async function applySink(){ if(!ctx||!sinkOK()) return; const note=document.getElementById("audioOutNote");
  try{ const want=state.audioOut||""; if((typeof ctx.sinkId==="string"?ctx.sinkId:"")!==want) await ctx.setSinkId(want); note.textContent = state.audioOut ? "Playing through the selected output." : "Playing through the system default output."; }
  catch(e){ note.textContent="Could not switch output ("+e.name+"); staying on the system default."; state.audioOut=""; save(); document.getElementById("audioOut").value=""; } }
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange",listOutputs);

// ---------- UI ----------
const ui={}; ["audioOut","audioOutNote","bpm","key","chords","chordErr","recClick","layer","lyrics","shape","sketchBtn","nextSyl","karaoke","timeline","songInfo","why","editor","editToggle",
  "resuggest","undoBtn","rebuild","loopSel","midiIn","midiOut","midiNote","midiTransport","liveInst","miniKeys","octDn","octUp","octLbl","liveHint","volLive","volBand","volMaster",
  "licKey","licBtn","tap","tapBtn","takes","takeInfo","stemsDry","vocalFx","ampFx","bassFx"].forEach(id=>ui[id]=document.getElementById(id));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
ui.key.innerHTML=NAMES.map((n,i)=>`<option value="${i}">${n}</option>`).join("");
ui.shape.innerHTML=SHAPES.map(s=>`<option value="${s.id}">${s.name}</option>`).join("");
ui.liveInst.innerHTML=Object.entries(LIVE).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join("");
let selSec=0;
// undo: snapshots of the song before every arrangement edit
const undoStack=[];
function snap(){ undoStack.push(JSON.stringify({song:state.song,structEdited:state.structEdited})); if(undoStack.length>60) undoStack.shift(); ui.undoBtn.disabled=false; }
function undo(){ const s=undoStack.pop(); if(!s) return false; const o=JSON.parse(s); state.song=o.song; state.structEdited=o.structEdited; selSec=Math.min(selSec,state.song.sections.length-1); songChanged(); ui.undoBtn.disabled=!undoStack.length; setStatus("Undone."); return true; }
function songChanged(){ srcCache.key=null; lmCache.key=null; save(); if(state.loopSec>=state.song.sections.length) state.loopSec=-1; if(playing) pendingRange=rangeFor(state.loopSec); paintTimeline(); paintEditor(); paintKaraoke(); }
function syncInputs(){ ui.bpm.value=state.bpm; ui.key.value=state.keyRoot; ui.chords.value=state.chords; ui.recClick.checked=state.recClick; ui.layer.checked=state.layer; ui.shape.value=state.shape;
  ui.liveInst.value=state.liveInst; ui.midiTransport.checked=state.midiTransport; ui.stemsDry.checked=state.stemsDry; if(document.activeElement!==ui.lyrics) ui.lyrics.value=state.lyrics;
  [["volLive","liveDb"],["volBand","bandDb"],["volMaster","masterDb"]].forEach(([id,k])=>{ ui[id].value=state[k]; ui[id].nextElementSibling.textContent=(state[k]>0?"+":"")+state[k]+" dB"; }); }
function cards(id, list, on, label, click){ const el=document.getElementById(id); el.innerHTML="";
  list.forEach(x=>{ const b=document.createElement("button"); b.className="card"+(on(x)?" on":""); b.dataset.id=x.id; b.innerHTML=label(x); b.onclick=()=>click(x); el.appendChild(b); }); }
const paintGrooves = () => cards("grooves", grooves, x=>x.id===state.groove, x=>`<b>${x.name}</b><small>${x.bpm} BPM · ${x.chords}</small>`, x=>{ snap(); state.groove=x.id; state.bpm=x.bpm; state.chords=x.chords; prog=parseProg(x.chords); resuggest(true); syncInputs(); render(); });
const paintRecipes = () => cards("recipes", recipes, x=>x.id===state.recipe, x=>`<b>${x.name}</b><small>${x.blurb}</small>`, x=>{ state.recipe=x.id; srcCache.key=null; lmCache.key=null; save(); paintRecipes(); });
function paintChairs(){ document.getElementById("chairs").innerHTML=CHAIRS.map(c=>`<label class="chair${state.mutes[c.id]?" muted":""}"><span>${esc(c.name)}</span>
  <input type="range" min="0" max="1.2" step="0.01" value="${state.gains[c.id]}" data-gain="${c.id}" aria-label="${esc(c.name)} level"><span class="mute"><input type="checkbox" data-mute="${c.id}" ${state.mutes[c.id]?"checked":""}> mute</span></label>`).join(""); }
function onChords(){ const p=parseProg(ui.chords.value); if(!p){ ui.chordErr.textContent="Use exactly 4 chords like Am F C G (m, 7, m7, maj7, dim, sus2, sus4)."; return; }
  ui.chordErr.textContent=""; snap(); state.chords=ui.chords.value.trim().split(/[\s,|]+/).join(" "); prog=p; resuggest(true); render(); }
// ---- timeline strip ----
const TYPE_CLASS = t => "t-"+t;
function badges(s){ const b=[]; if(s.feel==="half") b.push("½×"); if(s.feel==="double") b.push("2×"); if(s.drop) b.push("drop"); if(s.end==="fill") b.push("fill"); if(s.end==="build") b.push("build"); if(s.end==="stop") b.push("stop"); if(s.shift) b.push("+"+s.shift); if(s.density==="sparse") b.push("sparse"); return b; }
function paintTimeline(){ const tl=TL(), el=ui.timeline;
  el.innerHTML=tl.secs.map(s=>`<button class="seg ${TYPE_CLASS(s.type)}${s.i===selSec?" sel":""}${state.loopSec===s.i?" looped":""}" data-i="${s.i}" style="flex:${s.bars} 1 0" title="${esc(s.label)}: ${esc(moveText(s))}">
    <b>${esc(s.label)}</b><small>${s.bars} bars</small><span class="bdg">${badges(s).map(x=>`<i>${x}</i>`).join("")}${Object.keys(s.lock||{}).length?"<i class=lk>🔒</i>":""}</span></button>`).join("")+'<div id="tph" class="tph"></div>';
  ui.loopSel.innerHTML=`<option value="-1">Whole song</option>`+tl.secs.map(s=>`<option value="${s.i}">${esc(s.label)}</option>`).join(""); ui.loopSel.value=state.loopSec;
  ui.songInfo.textContent=`${tl.secs.length} sections · ${tl.total} bars · ${Math.floor(tl.total*4*60/state.bpm/60)}:${String(Math.round(tl.total*4*60/state.bpm%60)).padStart(2,"0")} at ${state.bpm} BPM`;
  paintWhy(); }
function paintPlayhead(pos){ const ph=document.getElementById("tph"); if(!ph) return; const tl=TL(); if(pos<0||!tl.total){ ph.style.display="none"; return; }
  ph.style.display="block"; ph.style.left=(100*pos/(tl.total*STEPS))+"%";
  const si=(tl.bars[Math.floor(pos/STEPS)]||{sec:{i:-1}}).sec.i; document.querySelectorAll(".seg").forEach(b=>b.classList.toggle("now",+b.dataset.i===si)); }
ui.timeline.addEventListener("click",e=>{ const b=e.target.closest(".seg"); if(!b) return; selSec=+b.dataset.i; paintTimeline(); paintEditor(); paintKaraoke(); });
function paintWhy(){ const s=TL().secs[selSec]; if(!s){ ui.why.innerHTML=""; return; } const R=s.reasons||{};
  const row=(f,v)=>`<li><b>${v}</b> — ${esc(R[f]||"")}${s.lock&&s.lock[f]?" 🔒":""}</li>`;
  ui.why.innerHTML=`<h3>${esc(s.label)} <small>${esc(s.detectWhy||"")}</small></h3><ul>
   ${row("feel",FEELS[s.feel])}${row("density",DENS[s.density]+" band")}${row("end",ENDS[s.end])}${s.drop?row("drop","Drop-out"):""}${s.shift?row("shift","Lift +"+s.shift):""}${row("chords",esc(s.chords))}${row("bars",s.bars+" bars")}${row("insts",BAND.filter(k=>s.insts[k]!==false).map(k=>INST_SHORT[k]).join(", "))}</ul>`; }
// ---- section editor (on demand) ----
const opts=(o,v)=>Object.entries(o).map(([k,l])=>`<option value="${k}"${String(k)===String(v)?" selected":""}>${l}</option>`).join("");
const lockBox=(s,f)=>`<label class="lock" title="Lock: Re-suggest keeps this"><input type="checkbox" data-lock="${f}" ${s.lock&&s.lock[f]?"checked":""}>🔒</label>`;
function paintEditor(){ const open=state.editOpen; ui.editor.hidden=!open; ui.editToggle.textContent=open?"Done editing":"✎ Edit section"; ui.editToggle.setAttribute("aria-expanded",open);
  if(!open) return; const secs=state.song.sections, s=secs[selSec]; if(!s){ ui.editor.innerHTML=""; return; }
  ui.editor.innerHTML=`<div class="ed-grid">
   <label>Name <input data-f="label" value="${esc(s.label)}" maxlength="24"></label>
   <label>Type <select data-f="type">${opts(SONG.TYPES,s.type)}</select></label>
   <label>Bars ${lockBox(s,"bars")}<input data-f="bars" type="number" min="1" max="32" value="${s.bars}"></label>
   <label>Chords (1-8, one per bar) ${lockBox(s,"chords")}<input data-f="chords" value="${esc(s.chords)}"></label>
   <label>Feel ${lockBox(s,"feel")}<select data-f="feel">${opts(FEELS,s.feel)}</select></label>
   <label>Band ${lockBox(s,"density")}<select data-f="density">${opts(DENS,s.density)}</select></label>
   <label>Last bar ${lockBox(s,"end")}<select data-f="end">${opts(ENDS,s.end)}</select></label>
   <label>Key lift ${lockBox(s,"shift")}<select data-f="shift">${opts({0:"Home key",1:"+1 semitone",2:"+2 semitones"},s.shift||0)}</select></label>
   <label class="chk"><input type="checkbox" data-f="drop" ${s.drop?"checked":""}> Drop-out first 2 bars ${lockBox(s,"drop")}</label>
   <fieldset class="insts"><legend>Who plays ${lockBox(s,"insts")}</legend>${BAND.map(k=>`<label class="chk"><input type="checkbox" data-inst="${k}" ${s.insts[k]!==false?"checked":""}> ${INST_SHORT[k]}</label>`).join("")}</fieldset>
   <label class="wide">Lyric lines <textarea data-f="lines" rows="3">${esc((s.lines||[]).join("\n"))}</textarea></label></div>
   <div class="ed-act"><button data-act="up" ${selSec?"":"disabled"}>◀ Move earlier</button><button data-act="down" ${selSec<secs.length-1?"":"disabled"}>Move later ▶</button>
   <button data-act="dup">Duplicate</button><button data-act="add">+ Add section after</button><button data-act="del" ${secs.length>1?"":"disabled"}>Remove</button></div><p class="err" id="edErr"></p>`; }
ui.editor.addEventListener("change",e=>{ const s=state.song.sections[selSec]; if(!s) return; const t=e.target, f=t.dataset.f, err=document.getElementById("edErr");
  if(t.dataset.lock){ snap(); s.lock=s.lock||{}; if(t.checked) s.lock[t.dataset.lock]=true; else delete s.lock[t.dataset.lock]; songChanged(); return; }
  if(t.dataset.inst){ snap(); s.insts=Object.assign({},s.insts,{[t.dataset.inst]:t.checked}); s.reasons.insts="Set by you."; songChanged(); return; }
  if(!f) return; let v=t.type==="checkbox"?t.checked:t.value;
  if(f==="bars"){ v=Math.round(+v); if(!(v>=1&&v<=32)){ err.textContent="Bars: 1 to 32."; return; } }
  if(f==="chords"){ if(!parseList(v,1,8)){ err.textContent="Use 1 to 8 chords like Am F C G."; return; } v=v.trim().split(/[\s,|]+/).join(" "); }
  if(f==="shift") v=+v; if(f==="lines"){ v=v.split("\n").map(x=>x.trim()).filter(Boolean); state.structEdited=true; }
  snap(); s[f]=v; if(s.reasons&&f in s.reasons) s.reasons[f]="Set by you."; songChanged(); });
ui.editor.addEventListener("click",e=>{ const a=e.target.dataset.act; if(!a) return; const secs=state.song.sections, s=secs[selSec]; snap(); state.structEdited=true;
  if(a==="up"&&selSec>0){ secs.splice(selSec-1,0,secs.splice(selSec,1)[0]); selSec--; }
  else if(a==="down"&&selSec<secs.length-1){ secs.splice(selSec+1,0,secs.splice(selSec,1)[0]); selSec++; }
  else if(a==="dup"){ const c=JSON.parse(JSON.stringify(s)); c.id=SONG.newId(); c.label=s.label+" (copy)"; secs.splice(selSec+1,0,c); selSec++; }
  else if(a==="add"){ const c=JSON.parse(JSON.stringify(s)); Object.assign(c,{id:SONG.newId(),type:"verse",label:"New section",lines:[],bars:4,chords:state.chords,feel:"normal",density:"full",end:"none",drop:false,shift:0,lock:{},detectWhy:"Added by you."}); secs.splice(selSec+1,0,c); selSec++; }
  else if(a==="del"&&secs.length>1){ secs.splice(selSec,1); selSec=Math.min(selSec,secs.length-1); }
  songChanged(); });
ui.editToggle.onclick=()=>{ state.editOpen=!state.editOpen; save(); paintEditor(); };
function resuggest(silent){ // re-run the arrangement suggestions on the CURRENT sections; locked fields are kept
  const cur=state.song.sections, det=cur.map(s=>({type:s.type,label:s.label,lines:s.lines||[],why:s.detectWhy}));
  const ns=SONG.suggest(det, mainNames(), cur); ns.forEach((n,i)=>{ if(!(cur[i].lock&&cur[i].lock.label)) n.label=cur[i].label; });
  state.song={sections:ns}; songChanged(); if(!silent) setStatus("Re-suggested the arrangement. Locked items were kept."); }
ui.resuggest.onclick=()=>{ snap(); resuggest(false); };
ui.undoBtn.onclick=()=>undo(); ui.undoBtn.disabled=true;
ui.rebuild.onclick=()=>{ snap(); buildSong(true); selSec=0; songChanged(); setStatus("Sections found again from your lyric (locks kept, Undo to go back)."); };
ui.loopSel.onchange=()=>setLoop(+ui.loopSel.value);
document.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==="z"){ const tg=e.target.tagName; if(tg==="INPUT"||tg==="TEXTAREA") return; e.preventDefault(); undo(); } });
// ---- lyric + karaoke ----
let lyrTimer=null;
ui.lyrics.addEventListener("input",()=>{ state.lyrics=ui.lyrics.value.slice(0,6000); save(); clearTimeout(lyrTimer);
  lyrTimer=setTimeout(()=>{ if(state.structEdited){ setStatus("Lyric changed. You edited the structure by hand, so press “Find sections again” to re-detect."); return; } snap(); buildSong(true); selSec=Math.min(selSec,state.song.sections.length-1); wordCursor=0; songChanged(); },500); });
ui.shape.addEventListener("change",()=>{ state.shape=ui.shape.value; save(); srcCache.key=null; lmCache.key=null; });
let lastK=-2;
function paintKaraoke(){ const tl=TL(), s=tl.secs[selSec]||tl.secs[0]; if(!s){ ui.karaoke.innerHTML=""; return; }
  ui.karaoke.innerHTML=`<div class="ksec">${esc(s.label)}</div>`+(s.nlines?Array.from({length:s.nlines},(_,li)=>`<div class="kl">${s.syl.filter(x=>x.line===li).map(x=>`<span class="kw${x.strong?" st":""}" data-g="${x.g}">${esc(x.text)}</span>`).join(" ")}</div>`).join(""):"<div class=kl><i>instrumental</i></div>"); lastK=-2; }
function kSing(gi){ if(gi==null||gi<0) return; const tl=TL(), sy=tl.syl[gi]; if(sy&&sy.sec!==selSec&&!state.editOpen){ selSec=sy.sec; paintKaraoke(); }
  document.querySelectorAll(".kw.now").forEach(x=>x.classList.remove("now")); const el=document.querySelector(`.kw[data-g="${gi}"]`); if(el) el.classList.add("now"); }
function karaokeAt(pos){ if(pos<0) return; const lm=leadMap(state,TL(),mode==="rec",null); let best=-1;
  for(let k=Math.floor(pos);k>=Math.floor(pos)-16&&k>=0;k--){ const evs=lm.get(k); if(evs){ for(const h of evs) if(h.part==="lead"&&h.syl>=0&&k+h.off<=pos&&pos<k+h.off+h.dur+0.5) best=h.syl; if(best>=0) break; } }
  if(best!==lastK){ lastK=best; if(best>=0) kSing(best); else { const tl=TL(), B=tl.bars[Math.floor(pos/STEPS)]; if(B&&B.sec.i!==selSec&&!state.editOpen){ selSec=B.sec.i; paintKaraoke(); paintTimeline(); } } } }
function paintNext(){ if(!ui.nextSyl) return; const t=ctx?ctx.currentTime:0; const sy=state.liveInst==="sing"?nextSyl(t,true):null;
  ui.nextSyl.textContent = state.liveInst!=="sing" ? "—" : sy ? sy.text : "(no words)"; }
ui.sketchBtn.addEventListener("click",()=>{ const tl=TL(), s=tl.secs[selSec]; if(!s) return; const ns=sketchSection(s,state,tl).map(n=>({pos:n.pos,len:n.len,vel:n.vel,note:n.note,syl:n.syl,text:n.text}));
  const t=addTake(ns,"sing",s.id,"sketch"); if(t){ t.name=`Sketch ${s.label} (${state.shape})`; saveTakes(); renderTakes(); setStatus("Sketch saved as a take for "+s.label+". Record over it to make it yours."); } });
document.getElementById("resetWords").addEventListener("click",()=>{ wordCursor=0; passSyl.clear(); paintNext(); });
// ---- takes ----
function fxSelect(t){ const k=kindOf(t.inst||"sing"); if(!k) return "";
  const P=k==="vocal"?FX.VOCAL_PRESETS:FX.AMP_PRESETS, cur=t.fx?t.fx.preset:"dry";
  return `<select data-act="fx" aria-label="${k==="vocal"?"Vocal chain":"Amp"} for ${esc(t.name)}"><option value="dry"${cur==="dry"?" selected":""}>Dry (no ${k==="vocal"?"chain":"amp"})</option>${Object.entries(P).map(([id,p])=>`<option value="${id}"${cur===id?" selected":""}>${esc(p.name)}</option>`).join("")}<option value="panel">Use the panel settings now</option></select>`; }
function renderTakes(){ const tl=TL();
  ui.takes.innerHTML = takes.length ? takes.map((t,i)=>{ const sc=t.scope==="song"?"full song":((tl.secs.find(s=>s.id===t.scope)||{label:"(removed section)"}).label);
    return `<li class="take${audible(t)?" on":""}" data-i="${i}"><b>${esc(t.name)}</b> <small>${esc((LIVE[t.inst||"sing"]||LIVE.sing).label.split(" (")[0])} · ${esc(sc)} · ${t.notes.length} notes</small>
     <select data-act="mode"><option value="loop"${t.mode==="loop"?" selected":""}>Plays</option><option value="silent"${t.mode!=="loop"?" selected":""}>Silent</option></select>
     ${fxSelect(t)}<button data-act="del" aria-label="Delete ${esc(t.name)}">✕</button></li>`; }).join("") : `<li class="empty">No takes yet. Press ● Record, or ✨ Sketch a melody for the selected section.</li>`;
  ui.takeInfo.textContent = takes.length ? `${takes.filter(audible).length} of ${takes.length} takes playing. Sections without a sung take use the sketch melody.` : ""; }
ui.takes.addEventListener("change",e=>{ const li=e.target.closest(".take"); if(!li) return; const t=takes[+li.dataset.i], a=e.target.dataset.act;
  if(a==="mode") t.mode=e.target.value;
  if(a==="fx"){ const k=kindOf(t.inst||"sing"), v=e.target.value; t.fx = v==="dry" ? null : v==="panel" ? fxFor(k,t.inst) : {kind:k,preset:v,cfg:FX.clone((k==="vocal"?FX.VOCAL_PRESETS:FX.AMP_PRESETS)[v])}; }
  saveTakes(); renderTakes(); });
ui.takes.addEventListener("click",e=>{ if(e.target.dataset.act!=="del") return; const i=+e.target.closest(".take").dataset.i, t=takes[i];
  if(!confirm(`Delete ${t.name}? This can't be undone.`)) return; takes.splice(i,1); saveTakes(); renderTakes(); });
document.getElementById("clearTakes").addEventListener("click",()=>{ if(!takes.length||!confirm(`Clear all ${takes.length} takes? This can't be undone.`)) return; takes.length=0; saveTakes(); renderTakes(); });
// ---- FX panels: preset + every stage on/off with big knobs ----
const FXP = { vocalFx:{key:"vocal",pkey:"vocalPreset",stages:FX.VOCAL_STAGES,presets:FX.VOCAL_PRESETS},
  ampFx:{key:"amp",pkey:"ampPreset",stages:FX.AMP_STAGES,presets:FX.AMP_PRESETS}, bassFx:{key:"bassAmp",pkey:"bassPreset",stages:FX.AMP_STAGES,presets:FX.AMP_PRESETS} };
function paintFx(id){ const P=FXP[id], cfg=state[P.key], el=ui[id];
  el.innerHTML=`<label class="preset">Preset <select data-preset>${Object.entries(P.presets).map(([k,p])=>`<option value="${k}"${state[P.pkey]===k?" selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
   <div class="stages">${P.stages.map(sg=>{ const c=cfg[sg.id]||{on:0}; return `<div class="stage${c.on?"":" off"}"><label class="sw"><input type="checkbox" data-stage="${sg.id}" ${c.on?"checked":""}> ${esc(sg.label)}</label>
     ${sg.knobs.map(k=>`<label class="knob">${esc(k.label)} <input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${c[k.k]}" data-stage="${sg.id}" data-k="${k.k}"><output>${c[k.k]}</output></label>`).join("")}</div>`; }).join("")}</div>`; }
function fxChanged(){ srcCache.key=null; lmCache.key=null; save(); }
for(const id of Object.keys(FXP)){ const P=FXP[id];
  ui[id].addEventListener("input",e=>{ const t=e.target, sg=t.dataset.stage; if(t.dataset.preset!==undefined){ state[P.pkey]=t.value; state[P.key]=FX.clone(P.presets[t.value]); fxChanged(); paintFx(id); return; }
    if(!sg) return; const c=state[P.key][sg]=state[P.key][sg]||{on:0};
    if(t.dataset.k){ c[t.dataset.k]=+t.value; t.nextElementSibling.textContent=t.value; } else { c.on=t.checked?1:0; t.closest(".stage").classList.toggle("off",!t.checked); }
    fxChanged(); }); }
ui.stemsDry.addEventListener("change",()=>{ state.stemsDry=ui.stemsDry.checked; save(); });
// ---- live keys: 13 on-screen keys + computer keys (A W S E D F T G Y H U J K), octave Z/X ----
const KEYMAP="awsedftgyhujk"; const kbBase=()=>12*(state.liveOct+1);
function renderKeys(){ const base=kbBase(), kit=state.liveInst==="kit";
  ui.miniKeys.innerHTML=[...Array(KEYMAP.length)].map((_,i)=>{ const n=base+i, blk=[1,3,6,8,10].includes(i%12);
    return `<button class="mk ${blk?"blk":"wht"}" data-n="${n}" aria-label="${kit?KITNAME[KIT_KEYS[i%12]]:NAMES[n%12]+(Math.floor(n/12)-1)}"><span>${kit?KITNAME[KIT_KEYS[i%12]].replace("closed hi-hat","hat"):NAMES[n%12]}</span><i>${KEYMAP[i].toUpperCase()}</i></button>`; }).join("");
  ui.octLbl.textContent="C"+state.liveOct; updateHint(true); paintNext(); }
function keyVis(n,on){ const k=document.querySelector(`.mk[data-n="${n}"]`); if(k) k.classList.toggle("down",on); }
let hintKey="";
function curBar(){ if(!playing||!ctx) return 0; const c=curEntry(ctx.currentTime); return c?c.bar:0; }
function updateHint(force){ const b=curBar(), k=state.liveInst+b+state.keyRoot+state.chords+JSON.stringify(state.song).length; if(k===hintKey&&!force) return; hintKey=k;
  const tl=TL(), c=chordAtBar(tl,b); if(!c) return; const tones=`now <b>${c.name}</b> (${esc(c.sec.label)}): chord tones <b>${c.tones.map(t=>NAMES[t]).join(" ")}</b> (lit keys)`, L=LIVE[state.liveInst];
  ui.liveHint.innerHTML = state.liveInst==="sing" ? `Sing lyrics: every key sings your next syllable at the pitch you play, through the <b>${esc(FX.VOCAL_PRESETS[state.vocalPreset].name)}</b> vocal chain. · ${tones}`
    : state.liveInst==="kit" ? "Drum kit: C/C# kick, D/D# snare, E–F# hi-hat, G crash (repeats up the keys)." : `${esc(L.label)} · ${tones}`;
  document.querySelectorAll(".mk").forEach(el=>{ const p=pc(+el.dataset.n); el.classList.toggle("tone",state.liveInst!=="kit"&&c.tones.includes(p)); el.classList.toggle("root",state.liveInst!=="kit"&&p===c.tones[0]); }); paintNext(); }
function pointerKeys(box, sel){ const down=new Map();
  box.addEventListener("pointerdown",e=>{ const k=e.target.closest(sel); if(!k) return; e.preventDefault(); const n=+k.dataset.n; down.set(e.pointerId,n); liveOn(n,0.9,"tap"); });
  const up=e=>{ if(!down.has(e.pointerId)) return; liveOff(down.get(e.pointerId),"tap"); down.delete(e.pointerId); };
  box.addEventListener("pointerup",up); box.addEventListener("pointercancel",up); box.addEventListener("pointerleave",up); box.addEventListener("contextmenu",e=>e.preventDefault()); }
pointerKeys(ui.miniKeys,".mk");
document.addEventListener("keydown",e=>{ if(e.repeat||e.metaKey||e.ctrlKey||e.altKey) return; const tg=e.target.tagName; if(tg==="INPUT"||tg==="SELECT"||tg==="TEXTAREA") return;
  const k=e.key.toLowerCase();
  if(k==="z"||k==="x"){ state.liveOct=Math.max(1,Math.min(6,state.liveOct+(k==="z"?-1:1))); save(); renderKeys(); return; }
  if(k===" "&&mode!=="rec"){ e.preventDefault(); if(playing) stop(); else go("full")(); return; }
  const i=KEYMAP.indexOf(k); if(i>=0){ e.preventDefault(); liveOn(kbBase()+i,0.85,"kb"); } });
document.addEventListener("keyup",e=>{ const i=KEYMAP.indexOf(e.key.toLowerCase()); if(i>=0) liveOff(kbBase()+i,"kb"); });
window.addEventListener("blur",()=>{ for(const [k] of [...liveVoices]) if(/^(kb|tap):/.test(k)) liveOff(+k.split(":")[1],k.split(":")[0]); });
ui.liveInst.addEventListener("change",()=>{ liveAllOff(); state.liveInst=ui.liveInst.value; save(); renderKeys(); });
ui.octDn.onclick=()=>{ state.liveOct=Math.max(1,state.liveOct-1); save(); renderKeys(); };
ui.octUp.onclick=()=>{ state.liveOct=Math.min(6,state.liveOct+1); save(); renderKeys(); };
[["volLive","liveDb"],["volBand","bandDb"],["volMaster","masterDb"]].forEach(([id,k])=>ui[id].addEventListener("input",()=>{ state[k]=+ui[id].value; ui[id].nextElementSibling.textContent=(state[k]>0?"+":"")+state[k]+" dB"; applyFaders(); save(); }));
function paintDock(){ for(const [id,m] of [["playA","band"],["playB","full"]]){ const b=document.getElementById(id); if(b) b.classList.toggle("on",playing&&mode===m); }
  for(const id of ["recBtn","recBtn2"]){ const b=document.getElementById(id); if(b){ b.classList.toggle("recording",mode==="rec"); b.textContent=mode==="rec"?"■ Stop rec":"● Record"; } } }
function render(){ updateHint(true); paintGrooves(); paintRecipes(); paintChairs(); paintTimeline(); paintEditor(); paintKaraoke(); renderTakes(); }
ui.bpm.addEventListener("change",()=>{ const v=Math.round(+ui.bpm.value); if(!(v>=60&&v<=180)||mode==="rec"){ ui.bpm.value=state.bpm; return; } state.bpm=v; save(); render(); });
ui.key.addEventListener("change",()=>{ state.keyRoot=+ui.key.value; save(); render(); });
ui.chords.addEventListener("change",onChords);
ui.recClick.addEventListener("change",()=>{ state.recClick=ui.recClick.checked; save(); });
ui.layer.addEventListener("change",()=>{ state.layer=ui.layer.checked; save(); });
ui.midiTransport.addEventListener("change",()=>{ state.midiTransport=ui.midiTransport.checked; save(); });
ui.midiIn.addEventListener("change",()=>{ state.midiIn=ui.midiIn.value; save(); refreshMidi(); });
ui.midiOut.addEventListener("change",()=>{ state.midiOut=ui.midiOut.value; save(); refreshMidi(); });
document.getElementById("audioOut").addEventListener("change",e=>{ state.audioOut=e.target.value; save(); applySink(); });
document.getElementById("chairs").addEventListener("input",e=>{ const m=e.target.dataset.mute, gg=e.target.dataset.gain;
  if(m){ state.mutes[m]=e.target.checked; e.target.closest(".chair").classList.toggle("muted",e.target.checked); lmCache.key=null; }
  if(gg){ state.gains[gg]=+e.target.value; if(bus) bus.chairs[gg].gain.setTargetAtTime(state.gains[gg],ctx.currentTime,0.01); }
  save(); });
const go = m => async () => { await ensureCtx(); start(m); };
document.getElementById("playA").onclick=go("band");
document.getElementById("playB").onclick=go("full");
{ const ps=document.getElementById("playSec"); if(ps) ps.onclick=async()=>{ setLoop(selSec); await ensureCtx(); start("full"); }; }
document.getElementById("stop").onclick=stop;
const recClick = ()=>{ if(mode==="rec"){ stop(); return; } startRec(); };
document.getElementById("recBtn").onclick=recClick; document.getElementById("recBtn2").onclick=recClick;
const gateMsg = what => gatedNow() ? ` (demo: first 2 sections; a license unlocks the full song)` : "";
document.getElementById("exportWav").onclick=async()=>{ setStatus("Rendering the song…"); try{ const r=await exportWavBytes(); download(r.bytes,r.name,"audio/wav"); setStatus(`Saved ${r.name} · ${r.bars} bars`+gateMsg()); }catch(e){ setStatus("Export failed: "+e.message); } };
document.getElementById("exportMid").onclick=()=>{ const r=exportMidBytes(); download(r.bytes,r.name,"audio/midi"); setStatus("Saved "+r.name+" (one tempo, a marker per section, your lyric as MIDI lyric events)"); };
document.getElementById("exportSheet").onclick=()=>{ const r=exportSheetBytes(); download(r.bytes,r.name,"text/plain"); setStatus("Saved "+r.name); };
document.getElementById("exportStems").addEventListener("click",async()=>{ setStatus("Rendering stems…"); try{ const r=await exportStemsBytes(); download(r.zip,r.name,"application/zip"); setStatus(`Saved ${r.name} (${r.files.length} WAVs)`+gateMsg()); }catch(e){ setStatus("Stems export failed: "+e.message); } });
ui.tapBtn.onclick=async()=>{ ui.tapBtn.textContent="Starting…"; await ensureCtx(); if(ctx.state==="running") ui.tap.classList.add("hide"); showLoad(); };
ui.licBtn.onclick=async()=>{ const k=ui.licKey.value.trim(); if(!k) return; const st=document.getElementById("licState"); st.textContent="Checking…";
  try{ const r=await activateKey(k); if(r.ok){ Object.assign(lic,{valid:true,key:k,instance:r.instance,checked:Date.now()}); saveLic(); licUI(); } else st.textContent=r.reason; }
  catch(e){ st.textContent="Could not reach Lemon Squeezy. Check your connection and try again."; } };
document.getElementById("licOff").onclick=async()=>{ if(lic.key&&lic.instance&&configured()) await lsCall("deactivate",{license_key:lic.key,instance_id:lic.instance}).catch(()=>{}); for(const k of Object.keys(lic)) delete lic[k]; lic.valid=false; saveLic(); licUI(); };
{ const buy=document.getElementById("buy"); if(LEMON.checkoutUrl){ buy.href=LEMON.checkoutUrl; buy.textContent="Buy WordFour · "+LEMON.price; } else { buy.removeAttribute("href"); buy.setAttribute("aria-disabled","true"); buy.textContent="Checkout opening soon · "+LEMON.price; } }
if(lic.valid&&lic.key) validateKey(lic.key,lic.instance).then(v=>{ lic.valid=v; lic.checked=Date.now(); saveLic(); licUI(); }).catch(()=>{});
if(/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)) document.querySelectorAll(".ios").forEach(e=>e.hidden=false);
window.__wordfour = { state, TL:()=>TL(), stepEvents, takeNotes, sources:(all)=>sources(state,TL(),false,!!all), addTake, exportWavBytes, exportMidBytes, exportStemsBytes, exportSheetBytes, renderSong, loadAll,
  start:(m,f)=>start(m,f), stop, startRec, files, takes, undo, buildSong:(k)=>{ buildSong(k); songChanged(); }, resuggest:()=>{ snap(); resuggest(true); }, setLoop, FX, SONG, splitWord,
  liveOn, liveOff, setSustain, voices:liveVoices, tpos:()=>ctx&&transportPos(ctx.currentTime), monTap:()=>bus&&bus.mon, render, save, saveTakes, renderTakes, select:i=>{ selSec=i; paintTimeline(); paintEditor(); paintKaraoke(); },
  get undoDepth(){return undoStack.length;}, get sustain(){return sustain;}, get playing(){return playing;}, get mode(){return mode;}, get ctx(){return ctx;}, get missing(){return [...missing];}, get lic(){return lic;}, get bus(){return bus;} };
syncInputs(); for(const id of Object.keys(FXP)) paintFx(id); renderKeys(); render(); licUI(); showLoad(); paintDock(); listOutputs();
if(navigator.requestMIDIAccess) navigator.requestMIDIAccess().then(a=>{ midiAccess=a; a.onstatechange=refreshMidi; refreshMidi(); }).catch(()=>{ ui.midiNote.textContent="Web MIDI unavailable or blocked in this browser."; });
else ui.midiNote.textContent="Web MIDI not supported in this browser (try Chrome/Edge). The on-screen keys and computer keys still play.";
