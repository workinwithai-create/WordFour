// WordFour FX: vocal chains and guitar/bass amps, built from plain Web Audio nodes.
// The SAME build function runs on the live AudioContext (monitor + take playback) and on the OfflineAudioContext (WAV/stems).
// Everything is deterministic: impulse responses come from a seeded generator, the chorus LFO is a looped sine buffer.
// Presets are named plainly; they do not model any branded gear.
(function(){
const mulberry=(a)=>()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
const dbLin=db=>Math.pow(10,db/20);
// ---- stage schemas: each stage can be switched on/off and has a few big knobs ----
const VOCAL_STAGES=[
 {id:"hp",   label:"High-pass",      knobs:[{k:"freq",label:"Cut below (Hz)",min:40,max:300,step:5}]},
 {id:"eq",   label:"Subtractive EQ", knobs:[{k:"freq",label:"Mud (Hz)",min:150,max:800,step:10},{k:"cut",label:"Cut (dB)",min:-12,max:0,step:0.5}]},
 {id:"comp", label:"Compressor",     knobs:[{k:"thr",label:"Threshold (dB)",min:-40,max:0,step:1},{k:"ratio",label:"Ratio",min:1,max:12,step:0.5},{k:"makeup",label:"Make-up (dB)",min:0,max:18,step:0.5}]},
 {id:"deess",label:"De-esser",       knobs:[{k:"freq",label:"Split (Hz)",min:3000,max:10000,step:100},{k:"thr",label:"Threshold (dB)",min:-50,max:0,step:1}]},
 {id:"air",  label:"Presence / air", knobs:[{k:"pres",label:"Presence 3 kHz (dB)",min:-6,max:9,step:0.5},{k:"air",label:"Air 10 kHz (dB)",min:-6,max:9,step:0.5}]},
 {id:"sat",  label:"Saturation",     knobs:[{k:"drive",label:"Drive",min:0,max:1,step:0.01}]},
 {id:"verb", label:"Reverb send (synthetic IR)", knobs:[{k:"type",label:"Plate=0 Room=1",min:0,max:1,step:1},{k:"send",label:"Send",min:0,max:1,step:0.01},{k:"size",label:"Length (s)",min:0.3,max:3.5,step:0.1}]},
 {id:"delay",label:"Tempo delay",    knobs:[{k:"beats",label:"Time (beats)",min:0.25,max:1.5,step:0.25},{k:"fb",label:"Feedback",min:0,max:0.8,step:0.01},{k:"send",label:"Send",min:0,max:1,step:0.01}]},
];
const AMP_STAGES=[
 {id:"trim", label:"Input trim",  knobs:[{k:"db",label:"Trim (dB)",min:-12,max:12,step:0.5}]},
 {id:"gate", label:"Noise gate",  knobs:[{k:"thr",label:"Threshold (dB)",min:-90,max:-20,step:1}]},
 {id:"drive",label:"Drive (4x oversampled)", knobs:[{k:"gain",label:"Gain",min:0,max:1,step:0.01},{k:"level",label:"Level (dB)",min:-24,max:6,step:0.5}]},
 {id:"tone", label:"Tone stack",  knobs:[{k:"bass",label:"Bass",min:-12,max:12,step:0.5},{k:"mid",label:"Mid",min:-12,max:12,step:0.5},{k:"treble",label:"Treble",min:-12,max:12,step:0.5}]},
 {id:"cab",  label:"Cab (synthetic speaker IR)", knobs:[{k:"size",label:"1x12=0 4x12=1",min:0,max:1,step:1},{k:"mix",label:"Mix",min:0,max:1,step:0.01}]},
 {id:"chorus",label:"Chorus pedal", knobs:[{k:"rate",label:"Rate (Hz)",min:0.1,max:3,step:0.05},{k:"depth",label:"Depth",min:0,max:1,step:0.01},{k:"mix",label:"Mix",min:0,max:1,step:0.01}]},
 {id:"delay",label:"Delay pedal (tempo)", knobs:[{k:"beats",label:"Time (beats)",min:0.25,max:1.5,step:0.25},{k:"fb",label:"Feedback",min:0,max:0.8,step:0.01},{k:"send",label:"Send",min:0,max:1,step:0.01}]},
 {id:"verb", label:"Reverb pedal (synthetic IR)", knobs:[{k:"send",label:"Send",min:0,max:1,step:0.01},{k:"size",label:"Length (s)",min:0.3,max:3.5,step:0.1}]},
];
const S=(on,o)=>Object.assign({on},o);
const VOCAL_PRESETS={
 clean_pop:{name:"Clean Pop", hp:S(1,{freq:100}), eq:S(1,{freq:350,cut:-3}), comp:S(1,{thr:-20,ratio:4,makeup:6}), deess:S(1,{freq:6500,thr:-30}), air:S(1,{pres:2,air:4}), sat:S(0,{drive:0.1}), verb:S(1,{type:0,send:0.22,size:1.6}), delay:S(1,{beats:0.75,fb:0.25,send:0.12})},
 warm_rnb:{name:"Warm R&B", hp:S(1,{freq:80}), eq:S(1,{freq:450,cut:-2}), comp:S(1,{thr:-24,ratio:3,makeup:7}), deess:S(1,{freq:6000,thr:-32}), air:S(1,{pres:-1,air:2}), sat:S(1,{drive:0.25}), verb:S(1,{type:0,send:0.32,size:2.4}), delay:S(1,{beats:0.5,fb:0.3,send:0.15})},
 rock_grit:{name:"Rock Grit", hp:S(1,{freq:130}), eq:S(1,{freq:300,cut:-4}), comp:S(1,{thr:-28,ratio:8,makeup:10}), deess:S(1,{freq:7000,thr:-28}), air:S(1,{pres:5,air:1}), sat:S(1,{drive:0.65}), verb:S(1,{type:1,send:0.14,size:0.9}), delay:S(1,{beats:0.25,fb:0.15,send:0.1})},
 lofi:{name:"Lo-fi", hp:S(1,{freq:250}), eq:S(1,{freq:600,cut:-1}), comp:S(1,{thr:-26,ratio:6,makeup:9}), deess:S(0,{freq:6000,thr:-30}), air:S(1,{pres:3,air:-6}), sat:S(1,{drive:0.5}), verb:S(1,{type:1,send:0.25,size:0.7}), delay:S(0,{beats:0.5,fb:0.2,send:0.1})},
 radio:{name:"Radio", hp:S(1,{freq:300}), eq:S(1,{freq:500,cut:-2}), comp:S(1,{thr:-30,ratio:10,makeup:12}), deess:S(1,{freq:5000,thr:-34}), air:S(1,{pres:8,air:-6}), sat:S(1,{drive:0.35}), verb:S(0,{type:1,send:0.1,size:0.5}), delay:S(0,{beats:0.5,fb:0.2,send:0.1})},
};
const AMP_PRESETS={
 clean_jazz:{name:"Clean Jazz", trim:S(1,{db:0}), gate:S(0,{thr:-70}), drive:S(1,{gain:0.05,level:0}), tone:S(1,{bass:3,mid:-2,treble:-4}), cab:S(1,{size:0,mix:1}), chorus:S(1,{rate:0.6,depth:0.3,mix:0.3}), delay:S(0,{beats:0.75,fb:0.2,send:0.1}), verb:S(1,{send:0.25,size:1.8})},
 edge:{name:"Edge of Breakup", trim:S(1,{db:2}), gate:S(0,{thr:-65}), drive:S(1,{gain:0.35,level:-3}), tone:S(1,{bass:1,mid:2,treble:1}), cab:S(1,{size:0,mix:1}), chorus:S(0,{rate:0.8,depth:0.3,mix:0.3}), delay:S(1,{beats:0.75,fb:0.25,send:0.12}), verb:S(1,{send:0.2,size:1.4})},
 crunch:{name:"Classic Crunch", trim:S(1,{db:4}), gate:S(1,{thr:-60}), drive:S(1,{gain:0.6,level:-7}), tone:S(1,{bass:2,mid:4,treble:2}), cab:S(1,{size:1,mix:1}), chorus:S(0,{rate:0.8,depth:0.3,mix:0.3}), delay:S(0,{beats:0.5,fb:0.2,send:0.1}), verb:S(1,{send:0.12,size:1.0})},
 high_gain:{name:"High Gain", trim:S(1,{db:6}), gate:S(1,{thr:-50}), drive:S(1,{gain:0.92,level:-12}), tone:S(1,{bass:4,mid:-5,treble:3}), cab:S(1,{size:1,mix:1}), chorus:S(0,{rate:0.8,depth:0.3,mix:0.3}), delay:S(0,{beats:0.25,fb:0.15,send:0.08}), verb:S(1,{send:0.08,size:0.8})},
 bass_amp:{name:"Bass amp", trim:S(1,{db:0}), gate:S(0,{thr:-70}), drive:S(1,{gain:0.15,level:-1}), tone:S(1,{bass:4,mid:1,treble:-3}), cab:S(1,{size:1,mix:0.85}), chorus:S(0,{rate:0.5,depth:0.2,mix:0.2}), delay:S(0,{beats:0.5,fb:0.1,send:0.05}), verb:S(0,{send:0.05,size:0.6})},
};
const clone=o=>JSON.parse(JSON.stringify(o));
// ---- deterministic impulse responses (synthetic, seeded) ----
function reverbIR(ac, seconds, room){ const sr=ac.sampleRate, n=Math.max(1,Math.round(sr*seconds)), b=ac.createBuffer(2,n,sr);
  for(let c=0;c<2;c++){ const d=b.getChannelData(c), r=mulberry(1234+c*77+Math.round(seconds*10)+(room?999:0)); let lp=0;
    const pre=Math.round(sr*(room?0.012:0.004)), k=room?0.55:0.25; // room: darker + earlier reflections; plate: bright + dense
    for(let i=0;i<n;i++){ if(i<pre){ d[i]=0; continue; } const x=r()*2-1; lp+= (x-lp)*(1-k); d[i]=lp*Math.pow(1-(i/n),room?3:2.2)*Math.exp(-3*i/n); }
    if(room) for(let e=1;e<7;e++){ const at=pre+Math.round(sr*0.009*e*(1+0.3*c)); if(at<n) d[at]+=0.5/e; } }
  return b; }
function cabIR(ac, big){ const sr=ac.sampleRate, n=Math.round(sr*(big?0.03:0.02)), b=ac.createBuffer(1,n,sr), d=b.getChannelData(0), r=mulberry(big?42:7);
  // damped resonances of a closed-back speaker: low thump, upper-mid cone peak, steep roll-off above ~5 kHz
  const modes=big?[[110,0.9,0.006],[1800,0.5,0.0025],[3200,0.35,0.0015],[700,0.3,0.003]]:[[140,0.6,0.004],[2400,0.55,0.002],[4000,0.3,0.0012],[900,0.3,0.0025]];
  for(let i=0;i<n;i++){ const t=i/sr; let v=0; for(const [f,a,tau] of modes) v+=a*Math.sin(2*Math.PI*f*t)*Math.exp(-t/tau); v+=(r()*2-1)*0.04*Math.exp(-t/0.0008); d[i]=v; }
  let lp=0; for(let i=0;i<n;i++){ lp+=(d[i]-lp)*0.45; d[i]=lp; } // gentle smoothing = speaker top-end roll-off
  let e=0; for(let i=0;i<n;i++) e+=d[i]*d[i]; const g=1/Math.sqrt(e||1); for(let i=0;i<n;i++) d[i]*=g*0.5; return b; }
function satCurve(drive){ const n=2048, c=new Float32Array(n), k=1+drive*12; for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=Math.tanh(k*x)/Math.tanh(k); } return c; }
function ampCurve(gain){ const n=4096, c=new Float32Array(n), k=1+gain*80; // amp-style: asymmetric (biased) soft clip, harder knee as gain rises
  const f=x=>{ const y=x+0.12*gain; return y>=0 ? Math.tanh(k*y) : Math.tanh(k*y*0.8)/0.95; }, z=f(0), m=Math.max(Math.abs(f(1)-z),Math.abs(f(-1)-z));
  for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; c[i]=(f(x)-z)/m; } return c; }
function sineLoop(ac){ const sr=ac.sampleRate, n=sr, b=ac.createBuffer(1,n,sr), d=b.getChannelData(0); for(let i=0;i<n;i++) d[i]=Math.sin(2*Math.PI*i/n); return b; }
// ---- noise gate: an AudioWorklet (envelope follower + hysteresis), registered once per context ----
const GATE_SRC=`class G extends AudioWorkletProcessor{static get parameterDescriptors(){return[{name:"thr",defaultValue:-60}]}
constructor(){super();this.env=0;this.g=0;}
process(i,o,p){const a=i[0],b=o[0];if(!a||!a.length){return true;}const thr=Math.pow(10,p.thr[0]/20),at=1-Math.exp(-1/(0.001*sampleRate)),rl=1-Math.exp(-1/(0.06*sampleRate)),ga=1-Math.exp(-1/(0.002*sampleRate)),gr=1-Math.exp(-1/(0.08*sampleRate));
for(let s=0;s<a[0].length;s++){let x=0;for(let c=0;c<a.length;c++)x=Math.max(x,Math.abs(a[c][s]));this.env+=(x-this.env)*(x>this.env?at:rl);const want=this.env>thr?1:(this.env>thr*0.5&&this.g>0.5?1:0);this.g+=(want-this.g)*(want>this.g?ga:gr);for(let c=0;c<b.length;c++)b[c][s]=(a[c]||a[0])[s]*this.g;}return true;}}
registerProcessor("wf-gate",G);`;
const gateReady=new WeakMap();
function prepare(ac){ if(!ac.audioWorklet) return Promise.resolve(false); if(!gateReady.has(ac)){ const url=URL.createObjectURL(new Blob([GATE_SRC],{type:"application/javascript"}));
  gateReady.set(ac, ac.audioWorklet.addModule(url).then(()=>true).catch(()=>false)); } return gateReady.get(ac); }
let gateOK=new WeakMap();
// ---- the chain builder: returns {input, output, desc}. desc lists the stages actually built (for tests) ----
function build(ac, kind, cfg, bpm, dest){
  const input=ac.createGain(), out=ac.createGain(); out.connect(dest); const desc=[]; let cur=input;
  const chain=n=>{ cur.connect(n); cur=n; return n; };
  const bq=(type,f,q,g)=>{ const b=ac.createBiquadFilter(); b.type=type; b.frequency.value=f; if(q!=null) b.Q.value=q; if(g!=null) b.gain.value=g; return b; };
  const sends=[];
  const addVerb=(send,size,room)=>{ const s=ac.createGain(); s.gain.value=send; const cv=ac.createConvolver(); cv.normalize=true; cv.buffer=reverbIR(ac,size,room); const r=ac.createGain(); r.gain.value=0.9; s.connect(cv); cv.connect(r); r.connect(out); sends.push(s); desc.push("verb"); };
  const addDelay=(beats,fb,send)=>{ const s=ac.createGain(); s.gain.value=send; const d=ac.createDelay(4); d.delayTime.value=Math.min(3.9,beats*60/bpm); const f=ac.createGain(); f.gain.value=fb; const lp=bq("lowpass",4500,0.7);
    s.connect(d); d.connect(lp); lp.connect(f); f.connect(d); lp.connect(out); sends.push(s); desc.push("delay:"+(beats*60/bpm).toFixed(4)); };
  if(kind==="vocal"){ const c=cfg;
    if(c.hp.on){ chain(bq("highpass",c.hp.freq,0.707)); chain(bq("highpass",c.hp.freq,0.707)); desc.push("hp"); }
    if(c.eq.on){ chain(bq("peaking",c.eq.freq,1.2,c.eq.cut)); desc.push("eq"); }
    if(c.comp.on){ const k=ac.createDynamicsCompressor(); k.threshold.value=c.comp.thr; k.ratio.value=c.comp.ratio; k.knee.value=6; k.attack.value=0.004; k.release.value=0.12; chain(k); const m=ac.createGain(); m.gain.value=dbLin(c.comp.makeup); chain(m); desc.push("comp"); }
    if(c.deess.on){ // split-band: Linkwitz-Riley 4th-order crossover, only the top band is compressed, bands summed back (flat when idle)
      const lo1=bq("lowpass",c.deess.freq,0.707), lo2=bq("lowpass",c.deess.freq,0.707), hi1=bq("highpass",c.deess.freq,0.707), hi2=bq("highpass",c.deess.freq,0.707), k=ac.createDynamicsCompressor(), sum=ac.createGain();
      k.threshold.value=c.deess.thr; k.ratio.value=10; k.knee.value=3; k.attack.value=0.001; k.release.value=0.05;
      cur.connect(lo1); lo1.connect(lo2); lo2.connect(sum); cur.connect(hi1); hi1.connect(hi2); hi2.connect(k); k.connect(sum); cur=sum; desc.push("deess"); }
    if(c.air.on){ chain(bq("peaking",3000,0.9,c.air.pres)); chain(bq("highshelf",10000,null,c.air.air)); desc.push("air"); }
    if(c.sat.on && c.sat.drive>0){ const w=ac.createWaveShaper(); w.curve=satCurve(c.sat.drive); w.oversample="4x"; chain(w); desc.push("sat"); }
    cur.connect(out);
    if(c.verb.on) { addVerb(c.verb.send,c.verb.size,c.verb.type>=0.5); cur.connect(sends[sends.length-1]); }
    if(c.delay.on){ addDelay(c.delay.beats,c.delay.fb,c.delay.send); cur.connect(sends[sends.length-1]); }
  } else { const c=cfg;
    if(c.trim.on){ const g=ac.createGain(); g.gain.value=dbLin(c.trim.db); chain(g); desc.push("trim"); }
    if(c.gate.on && gateOK.get(ac)){ const n=new AudioWorkletNode(ac,"wf-gate",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}); n.parameters.get("thr").value=c.gate.thr; chain(n); desc.push("gate"); }
    if(c.drive.on){ chain(bq("highpass",90,0.707)); const pre=ac.createGain(); pre.gain.value=1+c.drive.gain*6; chain(pre); const w=ac.createWaveShaper(); w.curve=ampCurve(c.drive.gain); w.oversample="4x"; chain(w);
      const lv=ac.createGain(); lv.gain.value=dbLin(c.drive.level); chain(lv); desc.push("drive"); }
    if(c.tone.on){ chain(bq("lowshelf",120,null,c.tone.bass)); chain(bq("peaking",650,0.8,c.tone.mid)); chain(bq("highshelf",3200,null,c.tone.treble)); desc.push("tone"); }
    if(c.cab.on){ const cv=ac.createConvolver(); cv.normalize=false; cv.buffer=cabIR(ac,c.cab.size>=0.5); const wet=ac.createGain(), dry=ac.createGain(), sum=ac.createGain(); wet.gain.value=c.cab.mix*2.2; dry.gain.value=1-c.cab.mix;
      cur.connect(cv); cv.connect(wet); wet.connect(sum); cur.connect(dry); dry.connect(sum); cur=sum; desc.push("cab"); }
    if(c.chorus.on && c.chorus.mix>0){ const d=ac.createDelay(0.05); d.delayTime.value=0.012; const lfo=ac.createBufferSource(); lfo.buffer=sineLoop(ac); lfo.loop=true; lfo.playbackRate.value=c.chorus.rate;
      const dep=ac.createGain(); dep.gain.value=0.004*c.chorus.depth; lfo.connect(dep); dep.connect(d.delayTime); lfo.start(0); const wet=ac.createGain(); wet.gain.value=c.chorus.mix; const sum=ac.createGain();
      cur.connect(sum); cur.connect(d); d.connect(wet); wet.connect(sum); cur=sum; desc.push("chorus"); }
    cur.connect(out);
    if(c.delay.on){ addDelay(c.delay.beats,c.delay.fb,c.delay.send); cur.connect(sends[sends.length-1]); }
    if(c.verb.on){ addVerb(c.verb.send,c.verb.size,true); cur.connect(sends[sends.length-1]); }
  }
  return {input, output:out, desc, dispose(){ try{ input.disconnect(); out.disconnect(); }catch(e){} }};
}
async function ready(ac){ const ok=await prepare(ac); gateOK.set(ac,ok); return ok; }
window.WF_FX={VOCAL_STAGES,AMP_STAGES,VOCAL_PRESETS,AMP_PRESETS,build,ready,clone};
})();
