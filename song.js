// WordFour song model: detect sections from a pasted lyric, then suggest an arrangement with a plain reason for every choice.
// Pure functions (no audio, no DOM). Logic reused from the WorkinWithAI desks named in each reason.
(function(){
const TYPES={intro:"Intro",verse:"Verse",pre:"Pre-chorus",chorus:"Chorus",post:"Post-chorus",bridge:"Bridge",inst:"Instrumental",outro:"Outro"};
const LABEL=/^\s*[\[(]?\s*(intro|verse|pre[- ]?chorus|prechorus|pre|chorus|hook|refrain|post[- ]?chorus|bridge|middle ?8|outro|coda|tag)\s*(\d+)?\s*[\])]?\s*:?\s*$/i;
function labelType(w){ w=w.toLowerCase().replace(/[- ]/g,""); if(w==="intro") return "intro"; if(w.startsWith("verse")) return "verse"; if(w.startsWith("pre")) return "pre";
  if(w==="chorus"||w==="hook"||w==="refrain") return "chorus"; if(w.startsWith("post")) return "post"; if(w==="bridge"||w.startsWith("middle")) return "bridge"; return "outro"; }
// ---- Suno-style lyric tags: [Verse 1: soft], [Final Chorus], [Chorus x2], [Guitar Solo], [Instrumental Break], [Fade Out], [End], [Male Vocal] ...
// Section words (first match wins). Anything else in square brackets is a production note: skipped, never sung.
const SUNO=[[/^(intro|opening|instrumental intro)\b/,"intro"],[/^(pre[- ]?chorus|prechorus|pre[- ]?hook|build[- ]?up|build|lift|climb|channel|ramp)\b/,"pre"],
  [/^(post[- ]?chorus|post[- ]?hook|after[- ]?chorus)\b/,"post"],
  [/^((final|last|big|double|repeat|outro|end|closing)\s+)?(chorus|hook|refrain)\b/,"chorus"],[/^(chorus|hook|refrain)\b/,"chorus"],
  [/^(bridge|middle ?8|middle eight|breakdown|break ?down)\b/,"bridge"],
  [/^(verse|rap( verse)?|spoken( word)?|spoken verse|talking|narration)\b/,"verse"],
  [/^(outro|coda|tag|ending|big finish|finale)\b/,"outro"],
  [/^(instrumental|inst|interlude|break|solo|drop|riff|vamp|groove|jam|melodic interlude)\b|\bsolo\b|\b(break|interlude|instrumental)$/,"inst"]];
const SUNO_END=/^(end|the end|fade ?out|fade|fade to end|stop|silence|outro fade)$/;
const META_LINE=/^\s*(style( of music)?|styles?|genre|title|song title|lyrics|tags?|exclude( styles)?|negative( tags)?|weirdness|bpm|tempo|key|mood|vocal gender|persona)\s*[:=]/i;
const NAMES12=["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"], ROOTS={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
function metaFrom(t, meta){ const b=/\b(\d{2,3})\s?bpm\b/i.exec(t)||/\b(?:bpm|tempo)\s*[:=]?\s*(\d{2,3})\b/i.exec(t); if(b && meta.bpm==null){ const v=+b[1]; if(v>=40&&v<=240) meta.bpm=v; }
  const k=/(?:^|[\s,(:])([A-G])\s?(#|♯|b|♭|[Ss]harp|[Ff]lat)?\s?([Mm]ajor|[Mm]inor|[Mm]aj|[Mm]in|m)(?![A-Za-z])/.exec(t)||/\b[Kk][Ee][Yy]\s*(?:of|:|=)?\s*([A-Ga-g])\s?(#|♯|b|♭|sharp|flat)?(?![A-Za-z])/.exec(t);
  if(k && meta.keyRoot==null){ const acc=(k[2]||"").toLowerCase(); const r=(ROOTS[k[1].toUpperCase()]+(acc==="#"||acc==="♯"||acc==="sharp"?1:acc==="b"||acc==="♭"||acc==="flat"?-1:0)+12)%12;
    const q=(k[3]||"").toLowerCase(); meta.keyRoot=r; meta.keyName=NAMES12[r]+(q==="minor"||q==="min"||q==="m"?" minor":q?" major":""); } }
function titleCase(s){ return s.replace(/\s+/g," ").trim().replace(/\b[a-z]/g,c=>c.toUpperCase()).slice(0,28); }
// One bracketed tag -> {kind:"section",type,label,note,times} | {kind:"end"} | {kind:"meta"}
function readTag(inner){ let t=inner.trim(), times=1; const x=/(?:^|\s|\()[x×]\s?(\d)\)?\s*$|\s(\d)\s?[x×]\s*$/i.exec(t); if(x){ times=Math.max(1,Math.min(4,+(x[1]||x[2]))); t=t.slice(0,x.index).trim(); }
  const parts=t.split(/\s*(?::|\||\s[-–—]\s|,|;)\s*/); const head=(parts[0]||"").toLowerCase().replace(/[^a-z0-9 '\-]/g," ").replace(/\s+/g," ").trim(); const note=parts.slice(1).join(", ").trim();
  if(SUNO_END.test(head)) return {kind:"end"};
  const h2=head.replace(/\s*\d+$/,"");
  for(const [re,type] of SUNO) if(re.test(h2)) return {kind:"section",type,name:type==="inst"?titleCase(h2):"",note,times};
  return {kind:"meta"}; }
const norm=l=>l.toLowerCase().replace(/[^a-z0-9' ]/g,"").replace(/\s+/g," ").trim();
// opts.adlibs: sing whole-line (parenthesised) backing/ad-lib lines too (default off: they are listed as skipped)
function detect(text, opts){
  opts=opts||{}; const blocks=[]; let cur=null, ended=false; const meta={bpm:null,keyRoot:null,keyName:"",skipped:[],tags:0,ended:false};
  const skip=(t,why)=>{ if(meta.skipped.length<40) meta.skipped.push({text:t.length>64?t.slice(0,62)+"…":t,why}); };
  for(const raw of String(text||"").split(/\r?\n/)){ let t=raw.trim(); if(!t){ if(cur&&cur.lines.length) cur=null; continue; }
    if(ended){ const e=/^\[([^\]]{1,80})\]$/.exec(t); skip(t, e&&readTag(e[1]).kind==="end" ? "end of song" : "after the end tag"); continue; }
    if(META_LINE.test(t)){ metaFrom(t,meta); skip(t,"style/meta line"); continue; }
    const m=LABEL.exec(t);
    if(m){ if(/^\s*\[/.test(t)) meta.tags++; cur={type:labelType(m[1]),lines:[],explicit:true,tagged:/^\s*\[/.test(t),why:`Labelled “${t}” in your lyric.`}; blocks.push(cur); continue; }
    const br=/^\[([^\]]{1,80})\]$/.exec(t);
    if(br){ meta.tags++; const g=readTag(br[1]);
      if(g.kind==="end"){ ended=true; meta.ended=true; skip(t,"end of song"); cur=null; continue; }
      if(g.kind==="meta"){ metaFrom(br[1],meta); skip(t,"production note"); continue; }
      cur={type:g.type,name:g.name,lines:[],explicit:true,tagged:true,times:g.times,why:`Suno tag “${t}”`+(g.note?` (note “${g.note}” kept out of the words)`:"")+(g.times>1?`, played ${g.times} times`:"")+"."};
      blocks.push(cur); continue; }
    if(/^\*[^*]+\*$/.test(t)||/^[\[{<][^\]}>]*[\]}>]$/.test(t)){ skip(t,"sound/production note"); continue; }
    if(/^\([^)]*\)$/.test(t) && !opts.adlibs){ skip(t,"ad-lib (backing vocal)"); continue; }
    t=t.replace(/\[[^\]]*\]/g," ").replace(/\*[^*]+\*/g," ").replace(/\s+/g," ").trim(); if(!t) continue;
    if(/\b\d{2,3}\s?bpm\b/i.test(t) && t.split(",").length>=2){ metaFrom(t,meta); skip(t,"style/meta line"); continue; }
    if(!cur){ cur={lines:[],explicit:false}; blocks.push(cur); } cur.lines.push(t.slice(0,120)); }
  // [Chorus x2] -> the section twice
  for(let i=blocks.length-1;i>=0;i--){ const b=blocks[i]; for(let k=1;k<(b.times||1);k++) blocks.splice(i+1,0,Object.assign({},b,{times:1,lines:b.lines.slice(),why:b.why+" Repeat "+(k+1)+"."})); }
  // a bare label like "[Chorus]" with no lines repeats the last section of that type
  const bl=blocks.filter(b=>b.lines.length||b.explicit).slice(0,24);
  const count=new Map(); bl.forEach((b,i)=>new Set(b.lines.map(norm)).forEach(l=>count.set(l,(count.get(l)||0)+1)));
  // pass 1: cluster blocks that share at least half their lines; the biggest repeating cluster is the chorus
  const sets=bl.map(b=>new Set(b.lines.map(norm))), cl=bl.map((_,i)=>i);
  const share=(a,b)=>{ let n=0; for(const l of sets[a]) if(sets[b].has(l)) n++; return n/Math.max(1,Math.min(sets[a].size,sets[b].size)); };
  for(let i=0;i<bl.length;i++) for(let j=0;j<i;j++) if(cl[i]===i && share(i,j)>=0.5){ cl[i]=cl[j]; break; }
  const groups=new Map(); cl.forEach((c,i)=>(groups.get(c)||groups.set(c,[]).get(c)).push(i));
  const labelled=bl.findIndex(b=>b.explicit&&b.type==="chorus"&&b.lines.length); let chorusC=labelled>=0?cl[labelled]:null;
  if(chorusC===null){ let best=0; for(const [c,g] of groups){ if(g.length<2) continue; const score=g.length*100+g.reduce((a,i)=>a+bl[i].lines.length,0); if(score>best){ best=score; chorusC=c; } } }
  const isChorusIdx=i=>cl[i]===chorusC;
  bl.forEach((b,i)=>{ if(b.explicit) return; const g=groups.get(cl[i]);
    if(chorusC!==null && isChorusIdx(i)){ b.type="chorus"; b.why=`These lines come back ${g.length} times in the song, so this is the hook.`; return; }
    if(g.length>=2){ if(g.every(k=>isChorusIdx(k+1))){ b.type="pre"; b.why="These lines come back right before every chorus: a pre-chorus."; }
      else if(g.every(k=>k>0&&isChorusIdx(k-1))){ b.type="post"; b.why="These lines come back right after every chorus: a post-chorus."; } } });
  if(chorusC===null) bl.forEach(b=>{ if(b.explicit||b.type) return; const n=b.lines.map(norm); if(n.length>=2&&n.length<=6&&n.length-new Set(n).size>=1){ b.type="chorus"; b.why="A line repeats inside this block, which is how hooks are written."; } });
  // bare labels like "[Chorus]" with no lines repeat the last section of that type
  bl.forEach((b,i)=>{ if(b.explicit&&!b.lines.length){ const prev=[...bl.slice(0,i)].reverse().find(x=>x.type===b.type&&x.lines.length);
    if(prev){ b.lines=prev.lines.slice(); b.why+=" Repeats the earlier "+TYPES[b.type].toLowerCase()+"."; } } });
  // pass 2: the rest by position
  const isCh=i=>bl[i]&&bl[i].type==="chorus";
  bl.forEach((b,i)=>{ if(b.type) return; const prev=bl[i-1], next=bl[i+1], chBefore=bl.slice(0,i).filter(x=>x.type==="chorus").length;
    if(i===bl.length-1 && i>0 && prev.type==="chorus" && b.lines.length<=4){ b.type="outro"; b.why="Short last block after a chorus, so it ends the song."; return; }
    if(chBefore>=2 && (isCh(i+1)||i>=bl.length-2)){ b.type="bridge"; b.why="New lines after two choruses, heading back to the hook: a bridge."; return; }
    if(isCh(i+1) && prev && prev.type==="verse" && b.lines.length<=prev.lines.length){ b.type="pre"; b.why="Sits between a verse and a chorus and is shorter than the verse: a pre-chorus."; return; }
    b.type="verse"; b.why= chBefore? "New lines after a chorus: the next verse." : "New lines before any repeat: a verse."; });
  if(!bl.some(b=>b.type==="chorus") && bl.length>=3){ const b=bl.find((x,i)=>i>0&&!x.explicit); if(b){ b.type="chorus"; b.why="No repeats found, so the second block is treated as the chorus. Change it if that's wrong."; } }
  const num={}; const out=bl.map(b=>{ num[b.type]=(num[b.type]||0)+1; return {type:b.type,label:(b.type==="inst"&&b.name)?b.name:TYPES[b.type]+(["verse","chorus","pre"].includes(b.type)?" "+num[b.type]:""),lines:b.lines,why:b.why}; });
  out.meta=meta; return out;
}
const FIELDS=["bars","chords","feel","density","end","drop","shift","insts"];
let idc=0; const newId=()=>"s"+Date.now().toString(36)+(idc++).toString(36);
// main = array of chord names (the verse progression). prevSecs = current sections (locked fields are kept).
function suggest(det, main, prevSecs){
  const m=main.length?main:["C","G","Am","F"], rot=k=>m.map((_,i)=>m[(i+k)%m.length]);
  const types=det.map(d=>d.type), chIdx=types.map((t,i)=>t==="chorus"?i:-1).filter(i=>i>=0), lastCh=chIdx[chIdx.length-1], brIdx=types.indexOf("bridge");
  const dblCh = brIdx>0 ? [...chIdx].reverse().find(i=>i<brIdx) : (chIdx.length>=3 ? chIdx[1] : -1);
  let vNo=0, chNo=0;
  return det.map((d,i)=>{ const t=d.type, next=types[i+1], prevS=(prevSecs||[])[i], R={}, s={id:prevS&&prevS.id||newId(), type:t, label:d.label, lines:d.lines, detectWhy:d.why};
    if(t==="verse") vNo++; if(t==="chorus") chNo++;
    const lines=d.lines.length; s.bars= lines ? Math.max(4,Math.min(16,lines*2)) : 4; R.bars= lines ? `${lines} lyric line${lines>1?"s":""} × 2 bars${lines*2>16?", capped at 16":lines*2<4?", at least 4":""}.` : "Instrumental section: 4 bars.";
    const solo = t==="inst" && /solo|jam|riff/i.test(d.label||"");
    if(t==="inst" && !lines){ s.bars= solo?8:4; R.bars= solo ? "Solo: 8 bars, two times round your progression." : "Instrumental break: 4 bars, one breath between sections."; }
    if(t==="chorus"||t==="outro"||t==="post"){ s.chords=(m.length===4?[m[3],m[0],m[1],m[2]]:rot(1)).join(" "); R.chords="Starts on a different chord than the verse so the hook isn't a louder verse (Unravel, FormFour)."; }
    else if(t==="pre"){ s.chords=(m.length>=4?[m[1],m[1],m[3],m[3]]:m).join(" "); R.chords="Slower harmonic rhythm that ends on the turnaround chord, so the verse climbs into the hook (ClimbFour, LiftTwo)."; }
    else if(t==="bridge"){ s.chords=(m.length>=4?[m[2],m[3],m[1],m[3]]:rot(2)).join(" "); R.chords="Contrasting order that avoids the home chord, so the bridge goes somewhere new (FormFour)."; }
    else if(t==="inst"){ s.chords=m.join(" "); R.chords= solo ? "Your main progression, so whoever solos is on familiar ground." : "Your main progression under the break."; }
    else { s.chords=m.join(" "); R.chords="Your main progression."; }
    s.feel="normal"; R.feel="Straight feel.";
    if(t==="bridge"){ s.feel="half"; R.feel="Half-time: kick on 1, snare on 3, the band sits down, so the last chorus hits harder (HalfFour). Same BPM, same grid."; }
    else if(i===dblCh){ s.feel="double"; R.feel="Double-time: snare on every 'and', 16th hats, 8th-note bass, strings hold at the old rate, so this chorus changes gear instead of repeating (DoubleFour). Same BPM."; }
    else if(t==="outro"){ s.feel="half"; R.feel="Half-time so the song sits down at the end (EndEight)."; }
    s.density= t==="inst" ? (solo||/drop/i.test(d.label||"")?"full":"mid") : t==="chorus"||t==="post" ? "full" : t==="verse" ? (vNo===1?"mid":"full") : t==="pre" ? "mid" : "sparse";
    R.density= t==="inst" ? (solo?"Full band behind the solo so it has something to push against.":/drop/i.test(d.label||"")?"Full band: the drop hits like a chorus without words.":"Medium: the band carries the break without words.") : t==="chorus"||t==="post" ? "Full band: the hook is the biggest thing in the song (StackEight)." : t==="verse" ? (vNo===1?"Medium: verse 1 leaves room for the words (ThinFour).":"Full: verse 2 adds the kit so it isn't a reprint (AnswerEight).") : t==="pre" ? "Medium, so the build has somewhere to go (PreLift)." : t==="bridge" ? "Sparse: strip back so the return lands (HushFour, FloorEight)." : "Sparse: piano, bass and strings only.";
    s.end="none"; R.end="Runs straight into the next section.";
    const beforeLast = next==="chorus" && i+1===lastCh && chIdx.length>=2 && i>0;
    if(beforeLast && (t==="bridge"||t==="pre"||t==="verse")){ s.end="stop"; R.end="Stop bar: the whole band hits beat 1 of the last bar and leaves a hole before the last chorus (HoleFour, DieTwice)."; }
    else if(t==="pre"){ s.end="build"; R.end="Build: 8th then 16th snare roll across the last bar into the hook (LiftTwo snare roll)."; }
    else if(next==="chorus"){ s.end="fill"; R.end="Fill: snare and kick on beat 4 of the last bar, crash on the chorus downbeat (RollFour, DoorTwo)."; }
    else if(next==="bridge"){ s.end="fill"; R.end="Fill into the bridge so the gear change is announced (DoorFour)."; }
    else if(t==="outro"||i===det.length-1){ s.end="stop"; R.end="Button ending: everyone hits the last downbeat, then silence (EndEight)."; }
    s.drop = t==="verse" && vNo===2; R.drop = s.drop ? "Drop-out: the first 2 bars of verse 2 are just bass and strings, then the band slams back in bar 3 (AirCut, ThinFour)." : "No drop-out.";
    s.shift=0; R.shift="Home key.";
    if(chIdx.length>=2 && i===lastCh){ s.shift=2; R.shift="Last-chorus lift: up a whole step (+2), crash on the new key (ModEight “Truck Driver”, UpStep)."; }
    else if(chIdx.length>=2 && i>lastCh){ s.shift=2; R.shift="Stays in the lifted key after the last chorus."; }
    if(t==="inst"){ s.insts={piano:true, epiano:!solo, gtr:true, bass:true, pad:true, kit:true}; R.insts= solo ? "Every chair in: piano, guitar, bass, strings and kit. Play the solo yourself on any instrument." : "Piano, electric piano, guitar, bass, strings and kit fill the space where the words would be."; }
    else s.insts={piano:t!=="verse", epiano:t==="verse"||t==="bridge"||t==="intro", gtr:t==="chorus"||t==="post"||(t==="verse"&&vNo>1), bass:true, pad:t!=="verse"||vNo>1, kit:t!=="intro"};
    if(t!=="inst") R.insts= t==="verse" ? "Electric piano carries the verse; acoustic piano is saved for the chorus (RhodesFour, CompFour)." : t==="chorus" ? "Piano, nylon guitar strum, bass, strings and kit: every chair in (StrumFour)." : t==="bridge" ? "Electric piano and strings take over for contrast." : "Piano, bass and strings.";
    s.reasons=R; s.lock={};
    if(prevS && prevS.lock) for(const f of FIELDS) if(prevS.lock[f]){ s[f]=JSON.parse(JSON.stringify(prevS[f])); s.lock[f]=true; s.reasons[f]="Locked by you."; }
    if(prevS && prevS.lock && prevS.lock.label){ s.label=prevS.label; s.lock.label=true; }
    return s; });
}
window.WF_SONG={detect,suggest,TYPES,FIELDS,newId};
})();
