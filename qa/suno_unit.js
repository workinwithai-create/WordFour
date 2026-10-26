// Offline unit test for the Suno lyric reader in song.js (no browser): node qa/suno_unit.js
// Checks section detection, skipped notes, style-line BPM/key, [Chorus x2], ad-lib option, instrumental arrangement,
// and that plain (non-Suno) lyrics still detect exactly as the shipped v2 parser did (snapshot in qa/fixtures/plain-expected.json).
const fs=require("fs"), path=require("path"), dir=__dirname;
global.window={}; eval(fs.readFileSync(path.join(dir,"..","song.js"),"utf8")); const S=window.WF_SONG;
let fails=0; const ok=(name,cond,info)=>{ console.log((cond?"PASS ":"FAIL ")+name+(info!==undefined?"  "+JSON.stringify(info):"")); if(!cond) fails++; };
const rd=f=>fs.readFileSync(path.join(dir,"fixtures",f),"utf8");
const noTag=d=>d.every(s=>s.lines.every(l=>!/[\[\]*]/.test(l)));
// 1. Valley Road (Suno format with style line, ad-lib, sound note, production note, end tags)
const v=S.detect(rd("suno-valley.txt"));
ok("valley sections",JSON.stringify(v.map(s=>s.label))===JSON.stringify(["Intro","Verse 1","Pre-chorus 1","Chorus 1","Instrumental Break","Verse 2","Chorus 2","Guitar Solo","Bridge","Chorus 3","Outro"]),v.map(s=>s.label));
ok("valley types",v.map(s=>s.type).join(",")==="intro,verse,pre,chorus,inst,verse,chorus,inst,bridge,chorus,outro");
ok("valley no tags/notes in sung lines",noTag(v));
ok("valley bare [Chorus] repeats chorus 1",JSON.stringify(v[6].lines)===JSON.stringify(v[3].lines)&&v[6].lines.length===4);
ok("valley ad-lib skipped",!v.some(s=>s.lines.includes("(yeah, yeah)"))&&v.meta.skipped.some(x=>x.text==="(yeah, yeah)"));
ok("valley style BPM/key read",v.meta.bpm===104&&v.meta.keyRoot===2&&v.meta.keyName==="D major",{bpm:v.meta.bpm,key:v.meta.keyName});
ok("valley title/style not sung",!v.some(s=>s.lines.some(l=>/Title|Style/.test(l))));
ok("valley after [End] ignored",v.meta.ended&&!v.some(s=>s.lines.some(l=>/after the end/.test(l)))&&v.meta.skipped.some(x=>x.text==="[End]"&&x.why==="end of song")&&v.meta.skipped.some(x=>/after the end/.test(x.text)&&x.why==="after the end tag"));
ok("valley tag count",v.meta.tags===13,v.meta.tags);
ok("valley [Male Vocal] skipped",v.meta.skipped.some(x=>x.text==="[Male Vocal]"&&x.why==="production note"));
ok("valley Pre-Chorus note kept out of words",v[2].lines.length===1&&/soft/.test(v[2].why));
const va=S.detect(rd("suno-valley.txt"),{adlibs:true});
ok("ad-lib option sings (yeah, yeah)",va[1].lines.includes("(yeah, yeah)"));
const sg=S.suggest(v,["Am","F","C","G"]); const byL=Object.fromEntries(sg.map(s=>[s.label,s]));
ok("solo 8 bars full band",byL["Guitar Solo"].bars===8&&byL["Guitar Solo"].density==="full"&&byL["Guitar Solo"].insts.kit&&byL["Guitar Solo"].insts.gtr,{bars:byL["Guitar Solo"].bars});
ok("break 4 bars mid",byL["Instrumental Break"].bars===4&&byL["Instrumental Break"].density==="mid");
ok("every section has reasons",sg.every(s=>S.FIELDS.every(f=>typeof s.reasons[f]==="string"&&s.reasons[f].length>3)));
ok("last chorus lift kept",byL["Chorus 3"].shift===2);
// 2. pop: [Verse 1 - whispered], inline [whisper], [Chorus x2], inline (echo) kept, [Rap], [Drop], bare [Chorus]
const p=S.detect(rd("suno-pop.txt"));
ok("pop sections",p.map(s=>s.label).join("|")==="Verse 1|Chorus 1|Chorus 2|Verse 2|Drop|Chorus 3",p.map(s=>s.label));
ok("pop inline [whisper] stripped",p[0].lines[0]==="hello there city lights");
ok("pop [Chorus x2] twice, same lines",JSON.stringify(p[1].lines)===JSON.stringify(p[2].lines)&&p[1].lines.length===2);
ok("pop inline (echo) kept as words",p[1].lines[0].includes("(hold on)"));
ok("pop bare [Chorus] repeats",JSON.stringify(p[5].lines)===JSON.stringify(p[1].lines));
const ps=S.suggest(p,["C","G","Am","F"]); ok("pop drop full band",ps[4].type==="inst"&&ps[4].density==="full"&&ps[4].bars===4);
// 2b. style-line key reading must not misfire on ordinary words
const km=t=>{ const d=S.detect(t+"\n\n[Verse]\nla la"); return [d.meta.bpm,d.meta.keyName]; };
ok("style: 'Am, 92 bpm'",JSON.stringify(km("Style: folk, Am, 92 bpm"))===JSON.stringify([92,"A minor"]),km("Style: folk, Am, 92 bpm"));
ok("style: 'F# minor'",km("Style: synthwave, F# minor, 118 bpm")[1]==="F# minor");
ok("style: 'Bb major'",km("Style: soul, Bb major")[1]==="Bb major");
ok("style: 'key: e'",km("Key: e")[1]==="E");
ok("style: no false key from words",km("Style: Americana, emo, female vocal, I am lost, dream pop, 90 bpm")[1]==="",km("Style: Americana, emo, female vocal, I am lost, dream pop, 90 bpm"));
// 3. plain lyrics: identical to the v2 parser
const exp=JSON.parse(rd("plain-expected.json")); for(const c of exp){ const got=JSON.stringify(S.detect(c.text)); ok("plain unchanged: "+c.name,got===JSON.stringify(c.expect)); }
console.log(fails?`${fails} FAILED`:"ALL PASS"); process.exit(fails?1:0);
