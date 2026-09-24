/* Glowstep stage engine: Zip the dancer, choreography timing and the stage renderer.
   Shared by /screen (full size) and /admin (preview). Exposes window.GS. */
(() => {
const C = { pink:[255,61,139], cyan:[39,217,245], sun:[255,210,63], violet:[139,92,246], ice:[160,225,255], ink:[246,243,255] };
const rgba = (c,a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const hex = c => rgba(c,1);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DISPLAY = 'Bungee, Impact, "Arial Black", sans-serif';
const BODY = 'Rubik, system-ui, sans-serif';

/* ---------- poses ----------
 pose = [torso, lUpper, lFore, rUpper, rFore, lThigh, lShin, rThigh, rShin, shiftX, air]
 degrees: 0 = down, 90 = screen-right, 180 = up, -90 = screen-left. l = screen-left (cyan). */
const IDX = {t:0,lu:1,lf:2,ru:3,rf:4,lt:5,ls:6,rt:7,rs:8,hx:9,air:10};
const N = [180,-12,-6,12,6,-7,-3,7,3,0,0];
const P = o => { const p = N.slice(); for (const k in o) p[IDX[k]] = o[k]; return p; };
const WIDE = {lt:-24,ls:-18,rt:24,rs:18};
const HIPS = {lu:-40,lf:40,ru:40,rf:-40};
const x4 = (a,b) => [a,b,a,b];

const MOVES = {
  sway:{name:'Get Ready',col:C.violet,hero:0,keys:x4(P({hx:-.08,t:184,lu:-22,ru:6}),P({hx:.08,t:176,lu:-6,ru:22})),say:['Get ready to dance!']},
  count:{name:'3 · 2 · 1',col:C.violet,hero:0,keys:[P({lu:-30,lf:-20,ru:30,rf:20}),P({lu:-30,lf:-20,ru:30,rf:20,hx:.03}),P({lu:-30,lf:-20,ru:30,rf:20}),P({lu:-150,lf:-160,ru:150,rf:160})],say:['Here we go!']},
  clap:{name:'Clap Step',col:C.cyan,hero:0,keys:[
    P({...WIDE,hx:-.18,lu:-150,lf:-165,ru:150,rf:165}),P({hx:-.18,lu:-155,lf:125,ru:155,rf:-125}),
    P({...WIDE,hx:.18,lu:-150,lf:-165,ru:150,rf:165}),P({hx:.18,lu:-155,lf:125,ru:155,rf:-125})],say:['Clap along!','Clap your hands!']},
  hula:{name:'Hip Swing',col:C.pink,hero:0,keys:x4(P({...HIPS,hx:-.16,t:190,lt:-10,rt:12}),P({...HIPS,hx:.16,t:170,lt:-12,rt:10})),say:['Swing those hips!','Wiggle wiggle!']},
  point:{name:'Disco Point',col:C.sun,hero:0,keys:x4(
    P({t:174,hx:.1,ru:135,rf:140,lu:-40,lf:40,lt:-20,ls:-14,rt:14}),P({t:186,hx:-.05,ru:-20,rf:-35,lu:-40,lf:40,rt:20,rs:10})),say:['Disco point!','Point to the sky!']},
  robot:{name:'Robot Arms',col:C.cyan,hero:0,snap:true,keys:x4(P({lu:-90,lf:178,ru:90,rf:2,hx:-.04}),P({lu:-90,lf:2,ru:90,rf:178,hx:.04})),say:['Robot arms!','Robot time!']},
  stomp:{name:'Knee Up',col:C.violet,hero:0,keys:[
    P({lt:-85,ls:0,lu:-35,lf:10,ru:35,rf:-10,t:185,hx:.04}),P({lu:-20,lf:-5,ru:20,rf:5}),
    P({rt:85,rs:0,lu:-35,lf:10,ru:35,rf:-10,t:175,hx:-.04}),P({lu:-20,lf:-5,ru:20,rf:5})],say:['Knees up high!','Stomp it out!']},
  star:{name:'Star Jump',col:C.sun,hero:1,keys:x4(
    P({lt:-48,ls:15,rt:48,rs:-15,lu:-20,lf:20,ru:20,rf:-20}),P({lt:-30,ls:-25,rt:30,rs:25,lu:-140,lf:-140,ru:140,rf:140,air:.45})),say:['EVERYBODY JUMP!','JUMP JUMP JUMP!']},
  wave:{name:'Hands Up Wave',col:C.pink,hero:0,keys:x4(
    P({t:188,hx:-.08,lu:-170,lf:-175,ru:150,rf:160}),P({t:172,hx:.08,lu:-150,lf:-160,ru:170,rf:175})),say:['Hands in the air!','Wave side to side!']},
  punch:{name:'Sky Punch',col:C.cyan,hero:0,snap:true,keys:x4(
    P({ru:178,rf:180,lu:-25,lf:165,hx:.05,t:177}),P({lu:-178,lf:180,ru:25,rf:-165,hx:-.05,t:183})),say:['Punch the sky!','Higher!']},
  windmill:{name:'Windmill',col:C.sun,hero:0,keys:[
    P({...WIDE,lu:180,lf:180,ru:0,rf:0}),P({...WIDE,lu:-90,lf:-90,ru:90,rf:90}),
    P({...WIDE,lu:0,lf:0,ru:180,rf:180}),P({...WIDE,lu:90,lf:90,ru:-90,rf:-90})],say:['Windmill arms!','Spin those arms!']},
  freeze:{name:'Freeze!',col:C.ice,hero:0,still:true,keys:Array(4).fill(P({lt:-28,ls:-18,rt:28,rs:18,ru:140,rf:135,lu:-40,lf:40,t:176,hx:.05})),say:["Don't move a muscle…"]},
  final:{name:'Big Finish',col:C.pink,hero:0,still:true,keys:Array(4).fill(P({lt:-26,ls:-20,rt:26,rs:20,lu:-140,lf:-145,ru:140,rf:145})),say:['BIG FINISH!']}
};
const EDITABLE = ['clap','hula','point','robot','stomp','star','wave','punch','windmill','freeze','sway','count','final'];

/* ---------- maths ---------- */
const RAD = Math.PI/180, D = a => [Math.sin(a*RAD), Math.cos(a*RAD)];
const lerpA = (a,b,f) => { const d = (((b-a)%360)+540)%360-180; return a+d*f; };
function lerpPose(a,b,f){ const p=new Array(11); for(let i=0;i<9;i++)p[i]=lerpA(a[i],b[i],f); p[9]=a[9]+(b[9]-a[9])*f; p[10]=a[10]+(b[10]-a[10])*f; return p; }

// lb = beat position relative to the first downbeat (bar k covers lb in [4k, 4k+4))
function poseAt(lb, moveOf){
  const bar=Math.floor(lb/4), b=lb-bar*4, bi=Math.min(3,Math.floor(b));
  const m=MOVES[moveOf(bar)]||MOVES.sway;
  const k0=m.keys[bi], k1=bi<3?m.keys[bi+1]:(MOVES[moveOf(bar+1)]||MOVES.sway).keys[0];
  let f=b-bi; if(m.snap) f=Math.min(1,f/.35); f=f*f*(3-2*f);
  const p=lerpPose(k0,k1,f);
  if(!m.still){ const d=Math.exp(-(b-bi)*7); p[5]-=12*d; p[6]+=10*d; p[7]+=12*d; p[8]-=10*d; }
  return p;
}

/* ---------- Zip ---------- */
function drawFig(c,p,cx,gy,S,glow){
  const ext=(t,s)=>.62*Math.cos(t*RAD)+.6*Math.cos(s*RAD);
  const hh=Math.max(ext(p[5],p[6]),ext(p[7],p[8]),.3);
  const hip=[cx+p[9]*S, gy-(hh+p[10])*S];
  const v=D(p[0]), pr=[-v[1],v[0]];
  const add=(pt,d,len)=>[pt[0]+d[0]*len*S, pt[1]+d[1]*len*S];
  const hL=add(hip,pr,-.13), hR=add(hip,pr,.13);
  const kL=add(hL,D(p[5]),.62), fL=add(kL,D(p[6]),.6);
  const kR=add(hR,D(p[7]),.62), fR=add(kR,D(p[8]),.6);
  const shB=add(hip,v,.9), shL=add(shB,pr,-.26), shR=add(shB,pr,.26);
  const eL=add(shL,D(p[1]),.55), aL=add(eL,D(p[2]),.5);
  const eR=add(shR,D(p[3]),.55), aR=add(eR,D(p[4]),.5);
  const head=add(hip,v,1.42);
  const cyan=hex(C.cyan), sun=hex(C.sun), pink=hex(C.pink);
  c.save(); c.lineCap='round'; c.lineJoin='round';
  const glowOn=col=>{ if(glow){ c.shadowColor=col; c.shadowBlur=S*.38; } };
  const pl=(pts,col,w)=>{ glowOn(col); c.strokeStyle=col; c.lineWidth=w; c.beginPath(); c.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++)c.lineTo(pts[i][0],pts[i][1]); c.stroke(); };
  const dot=(pt,r,col)=>{ glowOn(col); c.fillStyle=col; c.beginPath(); c.arc(pt[0],pt[1],r,0,Math.PI*2); c.fill(); };
  pl([hL,kL,fL],cyan,S*.21); pl([fL,[fL[0]-S*.17,fL[1]]],cyan,S*.17);
  pl([hR,kR,fR],sun,S*.21);  pl([fR,[fR[0]+S*.17,fR[1]]],sun,S*.17);
  const tL=add(hip,pr,-.17), tR=add(hip,pr,.17);
  glowOn(pink); c.fillStyle=pink; c.strokeStyle=pink; c.lineWidth=S*.16;
  c.beginPath(); c.moveTo(shL[0],shL[1]); c.lineTo(shR[0],shR[1]); c.lineTo(tR[0],tR[1]); c.lineTo(tL[0],tL[1]); c.closePath(); c.fill(); c.stroke();
  pl([shB,head],pink,S*.14);
  pl([shL,eL,aL],cyan,S*.18); dot(aL,S*.11,cyan);
  pl([shR,eR,aR],sun,S*.18);  dot(aR,S*.11,sun);
  c.save(); c.translate(head[0],head[1]); c.rotate(Math.atan2(v[0],-v[1]));
  glowOn('#ffffff');
  c.fillStyle=pink; c.beginPath(); c.moveTo(-S*.2,-S*.2); c.lineTo(-S*.1,-S*.46); c.lineTo(0,-S*.26); c.lineTo(S*.1,-S*.5); c.lineTo(S*.16,-S*.24); c.lineTo(S*.26,-S*.36); c.lineTo(S*.24,-S*.12); c.closePath(); c.fill();
  c.fillStyle='#F6F3FF'; c.beginPath(); c.arc(0,0,S*.3,0,Math.PI*2); c.fill();
  c.shadowBlur=0;
  c.fillStyle='#120E33'; c.beginPath(); c.roundRect(-S*.25,-S*.09,S*.5,S*.14,S*.06); c.fill();
  c.strokeStyle=pink; c.lineWidth=S*.025; c.beginPath(); c.moveTo(-S*.17,-S*.05); c.lineTo(-S*.1,-S*.05); c.moveTo(S*.06,-S*.05); c.lineTo(S*.13,-S*.05); c.stroke();
  c.strokeStyle='#120E33'; c.lineWidth=S*.035; c.beginPath(); c.arc(0,S*.08,S*.11,.15*Math.PI,.85*Math.PI); c.stroke();
  c.restore(); c.restore();
}

// small move icon on its own canvas (admin + menus)
function moveIcon(id, px=120){
  const m=MOVES[id]||MOVES.sway, cv=document.createElement('canvas'); cv.width=cv.height=px;
  const c=cv.getContext('2d');
  c.fillStyle=rgba(m.col,.16); c.beginPath(); c.arc(px/2,px*.55,px*.42,0,Math.PI*2); c.fill();
  drawFig(c,m.keys[m.hero],px/2,px*.92,px*.25,false);
  return cv;
}

/* ---------- song timeline ---------- */
class Timeline{
  constructor(song){
    this.song=song; this.beats=song.beats||[]; this.db=song.downbeat||0; this.bars=song.bars||[];
    this.nudge=(song.nudge||0)/1000;
    this.segs=[];
    this.bars.forEach((b,i)=>{ const l=this.segs[this.segs.length-1]; if(l&&l.m===b.m&&l.b0+l.len===i) l.len++; else this.segs.push({m:b.m,b0:i,len:1}); });
  }
  beatAt(t){
    t-=this.nudge; const b=this.beats, n=b.length;
    if(n<2) return t*2;
    if(t<=b[0]) return (t-b[0])/(b[1]-b[0]);
    if(t>=b[n-1]) return n-1+(t-b[n-1])/(b[n-1]-b[n-2]);
    let lo=0, hi=n-1; while(hi-lo>1){ const mid=(lo+hi)>>1; if(b[mid]<=t) lo=mid; else hi=mid; }
    return lo+(t-b[lo])/(b[lo+1]-b[lo]);
  }
  local(t){ return this.beatAt(t)-this.db; }
  moveOf(k){ return k<0?'sway':(k<this.bars.length?this.bars[k].m:'final'); }
  bar(k){ return this.bars[k]||null; }
  barTime(k){ const i=this.db+4*k; return this.beats[Math.max(0,Math.min(this.beats.length-1,i))]||0; }
}
const LEVEL_COL=[C.violet,C.cyan,C.pink];
const LEVEL_LABEL=['CHILL','GROOVE','PARTY!'];
function barColour(bar){ if(!bar) return C.violet; if(bar.m==='freeze') return C.ice; if(bar.m==='final') return C.sun; if(bar.m==='count'||bar.m==='sway') return C.violet; return LEVEL_COL[bar.l??1]; }
function barLabel(bar){ if(!bar) return 'GET READY'; if(bar.m==='freeze') return 'FREEZE'; if(bar.m==='final') return 'FINALE'; if(bar.m==='count'||bar.m==='sway') return 'GET READY'; return LEVEL_LABEL[bar.l??1]; }

/* ---------- audio ---------- */
let AC=null;
function audioCtx(){ if(!AC){ AC=new (window.AudioContext||window.webkitAudioContext)(); } return AC; }
async function decode(ab){
  const tmp=new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(1,2,44100);
  return await new Promise((res,rej)=>{ const p=tmp.decodeAudioData(ab,res,rej); if(p&&p.then) p.then(res,rej); });
}

/* ---------- Stage ---------- */
class Stage{
  constructor(canvas,opts={}){
    this.cv=canvas; this.g=canvas.getContext('2d'); this.opts=opts;
    this.mode='idle'; this.song=null; this.tl=null; this.buf=null; this.src=null;
    this.t0=0; this.pausedPos=0; this.lastBar=null; this.lastBeat=null;
    this.prompt=null; this.big=null; this.confetti=[]; this.volume=1;
    this.lastFrame=performance.now();
    this.idleLabel=opts.idleLabel||'Next song coming up soon';
    this.onEnded=opts.onEnded||null;
    const loop=now=>{ this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  get soundOn(){ return !!AC && AC.state==='running'; }
  async unlock(){ const a=audioCtx(); if(a.state!=='running'){ try{ await a.resume(); }catch(e){} } if(!this.gain){ this.gain=a.createGain(); this.gain.gain.value=this.volume; this.gain.connect(a.destination); } return this.soundOn; }
  setVolume(v){ this.volume=v; if(this.gain) this.gain.gain.value=v; }
  clock(){ return this.soundOn ? AC.currentTime-(AC.outputLatency||AC.baseLatency||0) : performance.now()/1000; }
  setSong(song,buf){ this.stopAudio(); this.song=song; this.buf=buf; this.tl=song?new Timeline(song):null; this.lastBar=null; this.lastBeat=null; }
  updateSong(song){ this.song=song; this.tl=new Timeline(song); }
  pos(){ if(this.mode==='playing') return this.clock()-this.t0; if(this.mode==='paused') return this.pausedPos; return 0; }
  stopAudio(){ if(this.src){ try{ this.src.onended=null; this.src.stop(); }catch(e){} this.src.disconnect(); this.src=null; } }
  play(pos=0, delay=0){
    if(!this.song) return;
    this.stopAudio();
    const now=this.clock(); this.t0=now+Math.max(0,delay)-pos;
    if(this.soundOn&&this.buf){
      const when=AC.currentTime+Math.max(0,delay)+Math.max(0,-pos), off=Math.max(0,pos);
      if(off<this.buf.duration){ this.src=AC.createBufferSource(); this.src.buffer=this.buf; this.src.connect(this.gain); this.src.start(when,off); }
    }
    this.mode='playing'; this.big=null; this.confetti=[];
    const lb=this.tl.local(Math.max(0,pos)); this.lastBar=Math.floor(lb/4)-(pos<.5?1:0); this.lastBeat=Math.floor(lb)-(pos<.5?1:0);
  }
  pause(pos){ const p=pos??this.pos(); this.stopAudio(); this.pausedPos=p; this.mode='paused'; }
  ready(){ this.stopAudio(); this.mode=this.song?'ready':'idle'; this.big=null; this.prompt=null; }
  idle(){ this.stopAudio(); this.mode='idle'; this.big=null; this.prompt=null; }
  end(){ this.stopAudio(); this.mode='ended'; this.big=null; this.prompt=null; this.burst(); }
  say(text,col=C.sun,big=false){
    if(big) this.big={text,col,at:performance.now(),hold:false,dur:2.2};
    else this.prompt={text,col,at:performance.now()};
  }
  burst(){ const cols=[C.pink,C.cyan,C.sun,C.violet]; this.confetti=[]; for(let i=0;i<(RM?40:170);i++) this.confetti.push({x:Math.random(),y:-Math.random()*.6,vx:(Math.random()-.5)*.05,vy:.08+Math.random()*.15,r:Math.random()*6.3,vr:(Math.random()-.5)*8,s:.5+Math.random()*.6,c:cols[i%4]}); }

  /* ----- per-frame ----- */
  frame(now){
    const dt=Math.min(.05,(now-this.lastFrame)/1000); this.lastFrame=now;
    const cv=this.cv, r=cv.getBoundingClientRect(); if(!r.width||!r.height) return;
    const dpr=Math.min(2,window.devicePixelRatio||1), W=r.width, H=r.height;
    if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); }
    const g=this.g; g.setTransform(dpr,0,0,dpr,0,0);
    const live=(this.mode==='playing'||this.mode==='paused')&&this.tl;
    let lb, moveOf, col=C.violet, freeze=false, pos=0;
    if(live){
      pos=this.pos(); lb=this.tl.local(pos); moveOf=k=>this.tl.moveOf(k);
      const k=Math.floor(lb/4), bar=this.tl.bar(k); col=barColour(bar); freeze=bar?.m==='freeze';
      if(this.mode==='playing') this.cues(lb,k,bar,pos);
      if(this.mode==='playing'&&this.song.duration&&pos>this.song.duration+.3&&this.onEnded){ const f=this.onEnded; f(); }
    }else if(this.mode==='ended'){
      lb=0; moveOf=()=> 'final'; col=C.sun;
    }else{
      const DEMO=['clap','star','robot','wave','punch','windmill','hula','point','stomp'];
      lb=now/1000*2; moveOf=k=>DEMO[Math.floor(k/2)%DEMO.length]; col=MOVES[moveOf(Math.floor(lb/4))].col;
    }
    const stripH=Math.max(56,H*.16), stripTop=H-stripH-Math.max(10,H*.025);
    let cx=W/2, S=Math.min(H*.145,W*.17), gy=live?stripTop-H*.04:H*.86;
    if(!live&&this.mode!=='ended'&&W>H*1.2){ cx=W*.72; S=Math.min(H*.15,W*.11); }
    if(this.mode==='ended'){ S=Math.min(H*.16,W*.16); gy=H*.9; }
    const phase=lb-Math.floor(lb), pulse=freeze||this.mode==='paused'?0:Math.exp(-phase*5);
    this.drawBg(g,W,H,now/1000,pulse,col,freeze,cx,gy,S);
    const p=poseAt(lb,moveOf);
    g.save(); g.globalAlpha=.5; g.fillStyle='#000'; g.beginPath(); g.ellipse(cx+p[9]*S,gy+S*.05,S*Math.max(.2,.9-p[10]*.6),S*.14,0,0,Math.PI*2); g.fill(); g.restore();
    drawFig(g,p,cx,gy,S,true);
    if(live){ this.drawStrip(g,W,H,lb,stripTop,stripH); this.drawHud(g,W,H,lb,pos,col); this.drawMoves(g,W,H,lb,cx,S,stripTop); }
    else if(this.mode==='ended') this.drawResults(g,W,H,dt);
    else this.drawAttract(g,W,H,cx);
    this.drawPrompt(g,W,H); this.drawBig(g,W,H);
    if(this.mode==='paused') this.drawPaused(g,W,H);
  }
  cues(lb,k,bar,pos){
    const beat=Math.floor(lb);
    if(k!==this.lastBar){ this.lastBar=k; if(bar?.p) this.say(bar.p,barColour(bar)); }
    if(beat!==this.lastBeat){ this.lastBeat=beat; const b=((beat%4)+4)%4;
      if(bar?.m==='count') this.big={text:['3','2','1','GO!'][b],col:b===3?C.sun:C.cyan,at:performance.now(),dur:.5};
      if(bar?.m==='freeze') this.big=b<3?{text:'FREEZE!',col:C.ice,at:performance.now(),hold:true}:{text:'DANCE!',col:C.pink,at:performance.now(),dur:.6};
      else if(this.big?.hold) this.big=null;
    }
  }
  drawBg(g,W,H,time,pulse,col,freeze,cx,gy,S){
    const bg=g.createLinearGradient(0,0,0,H); bg.addColorStop(0,'#06051A'); bg.addColorStop(.62,'#1A1248'); bg.addColorStop(1,'#0A0822');
    g.fillStyle=bg; g.fillRect(0,0,W,H);
    const tm=RM?time*.2:time, dim=freeze?.3:1, bc=[C.pink,C.cyan,C.sun,C.violet,C.cyan,C.pink];
    g.globalCompositeOperation='lighter';
    for(let i=0;i<6;i++){
      const sx=W*(.08+i*.168), ang=Math.sin(tm*.55+i*1.3)*.42, len=H*1.25, sp=.075, a=(.07+.16*pulse)*dim;
      const gr=g.createLinearGradient(sx,0,sx+Math.sin(ang)*len,Math.cos(ang)*len); gr.addColorStop(0,rgba(bc[i],a)); gr.addColorStop(1,rgba(bc[i],0));
      g.fillStyle=gr; g.beginPath(); g.moveTo(sx,0); g.lineTo(sx+Math.sin(ang-sp)*len,Math.cos(ang-sp)*len); g.lineTo(sx+Math.sin(ang+sp)*len,Math.cos(ang+sp)*len); g.closePath(); g.fill();
    }
    const halo=g.createRadialGradient(cx,gy-S*1.6,0,cx,gy-S*1.6,Math.max(W,H)*.42);
    halo.addColorStop(0,rgba(col,.2+.14*pulse)); halo.addColorStop(1,rgba(col,0)); g.fillStyle=halo; g.fillRect(0,0,W,H);
    g.globalCompositeOperation='source-over';
    for(let i=0;i<14;i++){ const on=(Math.floor(time*2)+i)%2===0; g.fillStyle=rgba(bc[i%6],on?.9:.25); g.beginPath(); g.arc(W*(i+.5)/14,Math.max(6,H*.018),Math.max(2.5,H*.006),0,Math.PI*2); g.fill(); }
    const fl=g.createLinearGradient(0,gy,0,H); fl.addColorStop(0,'#1A1348'); fl.addColorStop(1,'#07061A'); g.fillStyle=fl; g.fillRect(0,gy,W,H-gy);
    g.strokeStyle=rgba(col,.18+.3*pulse); g.lineWidth=1.5; g.beginPath();
    for(let k=-14;k<=14;k++){ g.moveTo(cx+k*W*.05,gy); g.lineTo(cx+k*W*.22,H); }
    for(let j=0;j<=7;j++){ const y=gy+(H-gy)*Math.pow(j/7,1.8); g.moveTo(0,y); g.lineTo(W,y); }
    g.stroke();
    const sp=g.createRadialGradient(cx,gy,0,cx,gy,S*1.8); sp.addColorStop(0,rgba(col,.45+.25*pulse)); sp.addColorStop(1,rgba(col,0));
    g.save(); g.translate(0,gy); g.scale(1,.22); g.translate(0,-gy); g.fillStyle=sp; g.beginPath(); g.arc(cx,gy,S*1.8,0,Math.PI*2); g.fill(); g.restore();
  }
  drawStrip(g,W,H,lb,y,h){
    const x0=Math.max(34,W*.07), ppb=Math.max(W*.065,34);
    g.save(); g.fillStyle='rgba(7,6,26,.8)'; g.beginPath(); g.roundRect(8,y-8,W-16,h+16,16); g.fill(); g.clip();
    for(const s of this.tl.segs){
      const x=x0+(s.b0*4-lb)*ppb, w=s.len*4*ppb-10; if(x>W||x+w<0) continue;
      const m=MOVES[s.m]||MOVES.sway, cur=lb>=s.b0*4&&lb<(s.b0+s.len)*4, past=lb>=(s.b0+s.len)*4;
      g.globalAlpha=past?.3:1;
      g.fillStyle=cur?rgba(m.col,.26):'rgba(255,255,255,.06)'; g.strokeStyle=cur?hex(m.col):rgba(m.col,.55); g.lineWidth=cur?4:2;
      g.beginPath(); g.roundRect(x,y,w,h,12); g.fill(); g.stroke();
      if(cur){ const pr=(lb-s.b0*4)/(s.len*4); g.fillStyle=hex(m.col); g.beginPath(); g.roundRect(x+8,y+h-11,(w-16)*pr,5,3); g.fill(); }
      const cx0=cur?Math.min(Math.max(x,x0+6),x+w-h*1.6):x, room=w-(cx0-x);
      g.save(); g.beginPath(); g.roundRect(x,y,w,h,12); g.clip();
      drawFig(g,m.keys[m.hero],cx0+h*.5,y+h*.9,h*.235,false);
      if(room>h*1.45){
        const tw=room-h-12; let fs=Math.max(11,h*.2); g.font=`${fs}px ${DISPLAY}`; g.fillStyle='#F6F3FF'; g.textBaseline='top'; g.textAlign='left';
        const widest=Math.max(...m.name.toUpperCase().split(' ').map(w=>g.measureText(w).width));
        if(widest>tw){ fs=Math.max(11,fs*tw/widest); g.font=`${fs}px ${DISPLAY}`; } // shrink rather than spill past the box
        const lines=wrap(g,m.name.toUpperCase(),tw).slice(0,2);
        lines.forEach((ln,i)=>g.fillText(ln,cx0+h*.98,y+h*.2+i*fs*1.1));
        g.font=`600 ${Math.max(10,h*.13)}px ${BODY}`; g.fillStyle=hex(m.col);
        g.fillText(`${s.len*4} beats`,cx0+h*.98,y+h*.2+lines.length*fs*1.1+5);
      }
      g.restore(); g.globalAlpha=1;
    }
    g.restore();
    g.save(); g.shadowColor=hex(C.sun); g.shadowBlur=14; g.strokeStyle=hex(C.sun); g.lineWidth=4;
    g.beginPath(); g.moveTo(x0,y-12); g.lineTo(x0,y+h+5); g.stroke();
    g.fillStyle=hex(C.sun); g.beginPath(); g.moveTo(x0-9,y-20); g.lineTo(x0+9,y-20); g.lineTo(x0,y-9); g.closePath(); g.fill();
    g.shadowBlur=0; g.font=`${Math.max(10,h*.13)}px ${DISPLAY}`; g.textAlign='center'; g.textBaseline='bottom'; g.fillText('NOW',x0,y-22);
    g.restore();
  }
  drawHud(g,W,H,lb,pos,col){
    const pad=Math.max(12,W*.025), t1=Math.max(14,H*.048), dur=this.song.duration||0;
    g.save(); g.textBaseline='top'; g.textAlign='left';
    g.font=`${t1}px ${DISPLAY}`; g.fillStyle='#F6F3FF'; g.shadowColor=hex(C.pink); g.shadowBlur=16;
    g.fillText(fit(g,this.song.title||'Untitled',W*.5),pad,pad+4); g.shadowBlur=0;
    g.font=`600 ${Math.max(11,H*.028)}px ${BODY}`; g.fillStyle='#B3ACDD'; g.fillText('Copy Zip!  Cyan side · Yellow side',pad,pad+t1*1.25+4);
    // right side
    const bar=this.tl.bar(Math.floor(lb/4)), label=barLabel(bar), fs=Math.max(11,H*.03);
    g.font=`${fs}px ${DISPLAY}`; const lw=g.measureText(label).width+fs*1.4, lx=W-pad-lw;
    g.strokeStyle=hex(col); g.lineWidth=2; g.fillStyle='rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(lx,pad,lw,fs*1.8,fs); g.fill(); g.stroke();
    g.fillStyle=hex(col); g.textAlign='center'; g.fillText(label,lx+lw/2,pad+fs*.42);
    const py=pad+fs*1.8+12, pw=Math.max(90,W*.15), dotR=Math.max(4,H*.008), bi=((Math.floor(lb)%4)+4)%4;
    for(let i=0;i<4;i++){ const on=i===bi&&lb>=0; g.fillStyle=on?hex(C.sun):'rgba(255,255,255,.18)'; g.beginPath(); g.arc(W-pad-pw-18-(3-i)*dotR*3.2,py+4,on?dotR*1.35:dotR,0,Math.PI*2); g.fill(); }
    g.fillStyle='rgba(255,255,255,.14)'; g.beginPath(); g.roundRect(W-pad-pw,py,pw,8,4); g.fill();
    const gr=g.createLinearGradient(W-pad-pw,0,W-pad,0); gr.addColorStop(0,hex(C.cyan)); gr.addColorStop(1,hex(C.pink));
    g.fillStyle=gr; g.beginPath(); g.roundRect(W-pad-pw,py,Math.max(2,pw*Math.min(1,dur?pos/dur:0)),8,4); g.fill();
    g.font=`600 ${Math.max(10,H*.024)}px ${BODY}`; g.fillStyle='#B3ACDD'; g.textAlign='right';
    g.fillText(`${fmt(pos)} / ${fmt(dur)}`,W-pad,py+16);
    g.restore();
  }
  // Big "NOW" and "NEXT" move names either side of Zip, sized to read from the back of a crowd.
  drawMoves(g,W,H,lb,cx,S,stripTop){
    if(W<H*1.2) return; // no room beside Zip on portrait screens; the strip still shows the moves
    const k=Math.floor(lb/4), mk=this.tl.moveOf(k), m=MOVES[mk]||MOVES.sway;
    const i=this.tl.segs.findIndex(sg=>k>=sg.b0&&k<sg.b0+sg.len), nx=i<0?(k<0?this.tl.segs[0]:null):this.tl.segs[i+1];
    const nm=nx?MOVES[nx.m]||MOVES.sway:null, inBeats=nx?Math.ceil(nx.b0*4-lb):0;
    // fade out while the giant FREEZE / 3-2-1 text is up
    const hide=this.big&&(this.big.hold||(performance.now()-this.big.at)/1000<this.big.dur);
    const vis=this.moveVis=(this.moveVis??1)+((hide?0:1)-(this.moveVis??1))*.25; if(vis<.02) return;
    const pad=Math.max(12,W*.035), room=cx-S*1.35-pad*1.5, top=H*.34, bottom=stripTop-H*.03;
    if(room<W*.12) return;
    g.save(); g.globalAlpha=vis; g.textBaseline='alphabetic';
    const block=(x,align,label,labelCol,name,col,sub,big)=>{
      g.textAlign=align;
      const ls=Math.max(12,H*.04); g.font=`${ls}px ${DISPLAY}`; g.fillStyle=hex(labelCol); g.shadowColor=hex(labelCol); g.shadowBlur=14;
      g.fillText(label,x,top+ls); g.shadowBlur=0;
      let fs=Math.min(H*(big?.11:.08),W*.06); g.font=`${fs}px ${DISPLAY}`;
      const words=name.toUpperCase().split(' '), widest=Math.max(...words.map(w=>g.measureText(w).width));
      if(widest>room){ fs*=room/widest; g.font=`${fs}px ${DISPLAY}`; }
      const lines=wrap(g,name.toUpperCase(),room).slice(0,3);
      let y=top+ls+fs*1.12;
      for(const ln of lines){ if(y>bottom) break;
        g.fillStyle='#120E33'; g.fillText(ln,x+fs*.05,y+fs*.05);
        g.fillStyle=hex(col); g.shadowColor=rgba(col,.85); g.shadowBlur=big?30:18; g.fillText(ln,x,y); g.shadowBlur=0; y+=fs*1.05; }
      if(sub&&y+H*.02<bottom){ const ss=Math.max(12,H*.042); g.font=`600 ${ss}px ${BODY}`; g.fillStyle='#F6F3FF'; g.fillText(sub,x,y+ss*.35); }
    };
    block(pad,'left','NOW',C.sun,m.name,m.col,'',true);
    if(nm){
      const soon=inBeats<=4;
      block(W-pad,'right','NEXT',soon?C.sun:[179,172,221],nm.name,soon?nm.col:[179,172,221],inBeats>0?`in ${inBeats} beat${inBeats===1?'':'s'}`:'',false);
    }
    g.restore();
  }
  drawAttract(g,W,H,cx){
    const left=W>H*1.2, x=left?W*.07:W/2, al=left?'left':'center';
    g.save(); g.textAlign=al; g.textBaseline='alphabetic';
    const s=Math.min(H*.16,W*(left?.1:.16));
    g.font=`${s}px ${DISPLAY}`; g.shadowColor=hex(C.pink); g.shadowBlur=30;
    if(this.mode==='ready'&&this.song){
      g.fillStyle=hex(C.cyan); g.font=`${s*.3}px ${DISPLAY}`; g.fillText('UP NEXT',x,H*.3);
      g.fillStyle='#F6F3FF'; g.font=`${s*.62}px ${DISPLAY}`;
      const lines=wrap(g,(this.song.title||'Untitled').toUpperCase(),left?W*.5:W*.9).slice(0,3);
      lines.forEach((ln,i)=>g.fillText(ln,x,H*.3+s*.75+i*s*.66));
      g.shadowBlur=0; g.fillStyle=hex(C.sun); g.font=`${s*.24}px ${DISPLAY}`; g.fillText('GET READY TO DANCE!',x,H*.3+s*.75+lines.length*s*.66+s*.2);
    }else{
      g.fillStyle='#F6F3FF'; g.fillText('GLOW',x-(left?0:g.measureText('STEP').width/2),H*.36);
      const gw=g.measureText('GLOW').width; g.fillStyle=hex(C.sun); g.shadowColor=hex(C.violet);
      g.fillText('STEP',left?x+gw:x+gw/2,H*.36);
      g.shadowBlur=0; g.fillStyle='#B3ACDD'; g.font=`600 ${Math.max(14,s*.2)}px ${BODY}`; g.textAlign=al; g.fillText(this.idleLabel,x,H*.36+s*.45);
    }
    g.restore();
  }
  drawResults(g,W,H,dt){
    for(const p of this.confetti){ p.x+=p.vx*dt; p.y+=p.vy*dt; p.r+=p.vr*dt; if(p.y>1.05){ p.y=-.05; p.x=Math.random(); }
      g.save(); g.translate(p.x*W,p.y*H); g.rotate(p.r); g.fillStyle=hex(p.c); const s=p.s*Math.max(6,H*.012); g.fillRect(-s,-s/2,s*2,s); g.restore(); }
    const s=Math.min(H*.13,W*.1); g.save(); g.textAlign='center'; g.textBaseline='alphabetic';
    g.font=`${s}px ${DISPLAY}`; g.fillStyle=hex(C.sun); g.shadowColor=hex(C.pink); g.shadowBlur=30; g.fillText('WHAT A CROWD!',W/2,H*.2);
    g.shadowBlur=0; g.font=`600 ${Math.max(14,s*.24)}px ${BODY}`; g.fillStyle='#F6F3FF';
    g.fillText(`${this.song?.title||'That song'} is done. Give yourselves a massive cheer!`,W/2,H*.2+s*.55);
    if(this.song?.bars){ const cnt=m=>this.song.bars.filter(b=>b.m===m).length;
      const st=[[cnt('star')*2,'STAR JUMPS',C.cyan],[cnt('punch')*4,'SKY PUNCHES',C.pink],[cnt('clap')*4,'CLAPS',C.sun]];
      st.forEach(([n,l,c],i)=>{ const x=W/2+(i-1)*W*.2; g.fillStyle=hex(c); g.font=`${s*.7}px ${DISPLAY}`; g.fillText(String(n),x,H*.2+s*1.55); g.fillStyle='#B3ACDD'; g.font=`600 ${Math.max(12,s*.18)}px ${BODY}`; g.fillText(l,x,H*.2+s*1.85); });
    }
    g.restore();
  }
  drawPrompt(g,W,H){
    const pr=this.prompt; if(!pr) return; const a=(performance.now()-pr.at)/1000; if(a>3.2){ this.prompt=null; return; }
    const sc=a<.3?1+.12*Math.sin(a/.3*Math.PI)-(1-a/.3)*.4:1, al=a<.08?a/.08:(a>2.6?Math.max(0,1-(a-2.6)/.6):1);
    const live=this.mode==='playing'||this.mode==='paused';
    g.save(); g.globalAlpha=al; g.translate(W/2,live?H*.2:H*.12); g.scale(sc,sc);
    let fs=Math.min(H*.1,W*.075); g.font=`${fs}px ${DISPLAY}`;
    const w=g.measureText(pr.text).width; if(w>W*.9){ fs*=W*.9/w; g.font=`${fs}px ${DISPLAY}`; }
    g.textAlign='center'; g.textBaseline='middle'; g.fillStyle='#120E33'; g.fillText(pr.text,4,4);
    g.shadowColor=rgba(pr.col,.9); g.shadowBlur=28; g.fillStyle=hex(pr.col); g.fillText(pr.text,0,0); g.restore();
  }
  drawBig(g,W,H){
    const b=this.big; if(!b) return; const a=(performance.now()-b.at)/1000;
    if(!b.hold&&a>b.dur){ this.big=null; return; }
    const sc=a<.12?1.8-a/.12*.8:1, al=b.hold?1:(a>b.dur*.75?Math.max(0,1-(a-b.dur*.75)/(b.dur*.25)):1);
    g.save(); g.globalAlpha=al; g.translate(W/2,H*.42); g.scale(sc,sc);
    let fs=Math.min(H*.3,W*.2); g.font=`${fs}px ${DISPLAY}`; const w=g.measureText(b.text).width; if(w>W*.92){ fs*=W*.92/w; g.font=`${fs}px ${DISPLAY}`; }
    g.textAlign='center'; g.textBaseline='middle'; g.fillStyle='#120E33'; g.fillText(b.text,6,6);
    g.shadowColor=rgba(b.col,.9); g.shadowBlur=50; g.fillStyle=hex(b.col); g.fillText(b.text,0,0); g.restore();
  }
  drawPaused(g,W,H){
    g.save(); g.fillStyle='rgba(8,6,28,.55)'; g.fillRect(0,0,W,H); g.textAlign='center'; g.textBaseline='middle';
    g.font=`${Math.min(H*.14,W*.1)}px ${DISPLAY}`; g.fillStyle='#F6F3FF'; g.fillText('PAUSED',W/2,H*.42); g.restore();
  }
}
function wrap(g,t,maxW){ const words=t.split(' '), out=[]; let cur=''; for(const w of words){ const s=cur?cur+' '+w:w; if(g.measureText(s).width>maxW&&cur){ out.push(cur); cur=w; } else cur=s; } if(cur) out.push(cur); return out; }
function fit(g,t,maxW){ if(g.measureText(t).width<=maxW) return t; while(t.length>1&&g.measureText(t+'…').width>maxW) t=t.slice(0,-1); return t+'…'; }
function fmt(s){ s=Math.max(0,Math.floor(s||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

window.GS={C,rgba,hex,MOVES,EDITABLE,poseAt,drawFig,moveIcon,Timeline,Stage,audioCtx,decode,fmt,barColour,barLabel};
})();
