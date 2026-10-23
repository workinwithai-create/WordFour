// WordFour song model: detect sections from a pasted lyric, then suggest an arrangement with a plain reason for every choice.
// Pure functions (no audio, no DOM). Logic reused from the WorkinWithAI desks named in each reason.
(function(){
const TYPES={intro:"Intro",verse:"Verse",pre:"Pre-chorus",chorus:"Chorus",post:"Post-chorus",bridge:"Bridge",outro:"Outro"};
const LABEL=/^\s*[\[(]?\s*(intro|verse|pre[- ]?chorus|prechorus|pre|chorus|hook|refrain|post[- ]?chorus|bridge|middle ?8|outro|coda|tag)\s*(\d+)?\s*[\])]?\s*:?\s*$/i;
function labelType(w){ w=w.toLowerCase().replace(/[- ]/g,""); if(w==="intro") return "intro"; if(w.startsWith("verse")) return "verse"; if(w.startsWith("pre")) return "pre";
  if(w==="chorus"||w==="hook"||w==="refrain") return "chorus"; if(w.startsWith("post")) return "post"; if(w==="bridge"||w.startsWith("middle")) return "bridge"; return "outro"; }
const norm=l=>l.toLowerCase().replace(/[^a-z0-9' ]/g,"").replace(/\s+/g," ").trim();
function detect(text){
  const blocks=[]; let cur=null;
  for(const raw of String(text||"").split(/\r?\n/)){ const t=raw.trim(), m=LABEL.exec(t);
    if(m){ cur={type:labelType(m[1]),lines:[],explicit:true,why:`Labelled “${t}” in your lyric.`}; blocks.push(cur); continue; }
    if(!t){ if(cur&&cur.lines.length) cur=null; continue; }
    if(!cur){ cur={lines:[],explicit:false}; blocks.push(cur); } cur.lines.push(t.slice(0,120)); }
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
  const num={}; return bl.map(b=>{ num[b.type]=(num[b.type]||0)+1; return {type:b.type,label:TYPES[b.type]+(["verse","chorus","pre"].includes(b.type)?" "+num[b.type]:""),lines:b.lines,why:b.why}; });
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
    if(t==="chorus"||t==="outro"||t==="post"){ s.chords=(m.length===4?[m[3],m[0],m[1],m[2]]:rot(1)).join(" "); R.chords="Starts on a different chord than the verse so the hook isn't a louder verse (Unravel, FormFour)."; }
    else if(t==="pre"){ s.chords=(m.length>=4?[m[1],m[1],m[3],m[3]]:m).join(" "); R.chords="Slower harmonic rhythm that ends on the turnaround chord, so the verse climbs into the hook (ClimbFour, LiftTwo)."; }
    else if(t==="bridge"){ s.chords=(m.length>=4?[m[2],m[3],m[1],m[3]]:rot(2)).join(" "); R.chords="Contrasting order that avoids the home chord, so the bridge goes somewhere new (FormFour)."; }
    else { s.chords=m.join(" "); R.chords="Your main progression."; }
    s.feel="normal"; R.feel="Straight feel.";
    if(t==="bridge"){ s.feel="half"; R.feel="Half-time: kick on 1, snare on 3, the band sits down, so the last chorus hits harder (HalfFour). Same BPM, same grid."; }
    else if(i===dblCh){ s.feel="double"; R.feel="Double-time: snare on every 'and', 16th hats, 8th-note bass, strings hold at the old rate, so this chorus changes gear instead of repeating (DoubleFour). Same BPM."; }
    else if(t==="outro"){ s.feel="half"; R.feel="Half-time so the song sits down at the end (EndEight)."; }
    s.density= t==="chorus"||t==="post" ? "full" : t==="verse" ? (vNo===1?"mid":"full") : t==="pre" ? "mid" : "sparse";
    R.density= t==="chorus"||t==="post" ? "Full band: the hook is the biggest thing in the song (StackEight)." : t==="verse" ? (vNo===1?"Medium: verse 1 leaves room for the words (ThinFour).":"Full: verse 2 adds the kit so it isn't a reprint (AnswerEight).") : t==="pre" ? "Medium, so the build has somewhere to go (PreLift)." : t==="bridge" ? "Sparse: strip back so the return lands (HushFour, FloorEight)." : "Sparse: piano, bass and strings only.";
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
    s.insts={piano:t!=="verse", epiano:t==="verse"||t==="bridge"||t==="intro", gtr:t==="chorus"||t==="post"||(t==="verse"&&vNo>1), bass:true, pad:t!=="verse"||vNo>1, kit:t!=="intro"};
    R.insts= t==="verse" ? "Electric piano carries the verse; acoustic piano is saved for the chorus (RhodesFour, CompFour)." : t==="chorus" ? "Piano, nylon guitar strum, bass, strings and kit: every chair in (StrumFour)." : t==="bridge" ? "Electric piano and strings take over for contrast." : "Piano, bass and strings.";
    s.reasons=R; s.lock={};
    if(prevS && prevS.lock) for(const f of FIELDS) if(prevS.lock[f]){ s[f]=JSON.parse(JSON.stringify(prevS[f])); s.lock[f]=true; s.reasons[f]="Locked by you."; }
    if(prevS && prevS.lock && prevS.lock.label){ s.label=prevS.label; s.lock.label=true; }
    return s; });
}
window.WF_SONG={detect,suggest,TYPES,FIELDS,newId};
})();
