// mSkool landing behaviour, moved from docs/design/landing/landing-v5.html.
// Each language is its own page now, so there is no runtime translation here.
// The page passes its language and copy in <script type="application/json" id="page-data">.
const PAGE=JSON.parse(document.getElementById('page-data').textContent);
const lang=document.documentElement.lang;
const ANS={[lang]:PAGE.ans};
const CHAT_HI={[lang]:PAGE.chatHi};
const NO_LABEL=document.querySelector('#nBtn span')?.textContent||'';
const QZ_TAP=document.querySelector('#qres span')?.textContent||'';
if('scrollRestoration' in history)history.scrollRestoration='manual';
if(!location.hash)window.scrollTo(0,0);
function rowTo(b){const r=b.parentElement;if(!r||r.scrollWidth<=r.clientWidth)return;r.scrollTo({left:b.offsetLeft-r.offsetLeft-(r.clientWidth-b.offsetWidth)/2,behavior:'smooth'})}
const stampIt=el=>{el.classList.remove('hit');void el.offsetWidth;el.classList.add('hit')};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* nav + dock */
const nav=document.getElementById('nav'),dock=document.getElementById('dock');
new IntersectionObserver(([e])=>nav.classList.toggle('solid',!e.isIntersecting)).observe(document.getElementById('topSentinel'));
let heroIn=true,applyIn=false;const dockSync=()=>dock.classList.toggle('up',!heroIn&&!applyIn);
new IntersectionObserver(([e])=>{heroIn=e.isIntersecting;dockSync()},{threshold:.1}).observe(document.getElementById('hero'));
new IntersectionObserver(([e])=>{applyIn=e.isIntersecting;dockSync()},{threshold:.05}).observe(document.getElementById('apply'));

/* reveals + stamps */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target;el.classList.add('in');
  if(el.classList.contains('nv-row'))setTimeout(()=>stampIt(el.querySelector('.stamp')),reduce?0:500);io.unobserve(el)}),{threshold:.2,rootMargin:'0px 0px -60px 0px'});
document.querySelectorAll('.rv').forEach(e=>io.observe(e));

/* strip: arrows + dots */
const strip=document.getElementById('strip'),cards=[...strip.children],dots=[...document.querySelectorAll('#dots i')];
const step=()=>cards[0].getBoundingClientRect().width+16;
document.getElementById('prev').onclick=()=>strip.scrollBy({left:-step(),behavior:'smooth'});
document.getElementById('next').onclick=()=>strip.scrollBy({left:step(),behavior:'smooth'});
const dio=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting&&e.intersectionRatio>.6){const i=cards.indexOf(e.target);dots.forEach((d,j)=>d.classList.toggle('on',i===j))}}),{root:strip,threshold:[.6]});
cards.forEach(c=>dio.observe(c));

/* attendance */
const grid=document.getElementById('grid'),attSave=document.getElementById('attSave'),attStamp=document.getElementById('attStamp');
for(let i=1;i<=38;i++){const b=document.createElement('button');b.textContent=i;b.setAttribute('aria-pressed',i===14?'true':'false');b.setAttribute('aria-label','Roll '+i);grid.appendChild(b)}
function attCount(){const a=grid.querySelectorAll('[aria-pressed=true]').length;document.getElementById('cP').firstChild.nodeValue=38-a;document.getElementById('cA').firstChild.nodeValue=a;document.getElementById('attLbl').textContent='Save · '+(38-a)+' present'}
grid.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true');attCount();attSave.classList.remove('done');attStamp.classList.remove('hit')});
attSave.onclick=()=>{attSave.classList.add('done');document.getElementById('attLbl').textContent='Saved';stampIt(attStamp)};

/* fees: collect, receipt sheet, next number */
let rno=1482,pi=0;const payers=[["Ishita Roy","VI A"],["Mohd. Faiz Alam","VI A"],["Riya Saha","IX B"],["Debanjan Pal","XI Sci"]];
const sheet=document.getElementById('sheet');
document.getElementById('collect').onclick=()=>{document.getElementById('rno').textContent='MAIN/26-27/0'+rno;sheet.classList.add('open');setTimeout(()=>stampIt(document.getElementById('feeStamp')),reduce?0:450)};
document.getElementById('nextR').onclick=()=>{sheet.classList.remove('open');rno++;pi=(pi+1)%payers.length;document.getElementById('feeName').textContent=payers[pi][0];document.getElementById('feeStamp').classList.remove('hit')};

/* results */
const pubSw=document.getElementById('pubSw');
pubSw.onclick=()=>{const on=pubSw.getAttribute('aria-checked')!=='true';pubSw.setAttribute('aria-checked',on);
  document.getElementById('pubT').textContent=on?'Published 3:10 pm':'Not published';
  document.getElementById('pubS').textContent=on?'38 families can see them now':"Families can't see these marks";
  document.getElementById('famT').innerHTML=on?'Family app: <b>Half-yearly results are out</b>':'Family app: <b>Results not out yet</b>';
  document.getElementById('fam').classList.toggle('live',on);
  const s=document.getElementById('pubStamp');on?stampIt(s):s.classList.remove('hit')};

/* family */
const kids=[
 {hi:"Hi Ishita",st:"12-day homework streak",rows:[["ph-check-circle","var(--att)","var(--att-bg)","Present today","Marked 8:48 am"],["ph-book-open-text","var(--hw)","var(--hw-bg)","Fractions worksheet","Maths, due tomorrow"],["ph-receipt","var(--fee)","var(--fee-bg)","October fees paid","Receipt 01482"],["ph-medal","var(--ex)","var(--ex-bg)","Half-yearly results","Mathematics A1"]]},
 {hi:"Hi Arnav",st:"4-day homework streak",rows:[["ph-check-circle","var(--att)","var(--att-bg)","Present today","Marked 8:41 am"],["ph-paint-brush","var(--hw)","var(--hw-bg)","Draw your family","Art, due Friday"],["ph-currency-inr","var(--fee)","var(--fee-bg)","November fees due","₹1,850 by 20 Nov"],["ph-medal","var(--ex)","var(--ex-bg)","Unit test 2","English 31 of 40"]]}];
const famRows=document.getElementById('famRows');
function showKid(i){const k=kids[i];document.getElementById('kidHi').textContent=k.hi;document.getElementById('kidStreak').textContent=k.st;
  famRows.innerHTML=k.rows.map(r=>`<div class="frow"><span class="tile" style="background:${r[2]};color:${r[1]}"><i class="ph ${r[0]}"></i></span><div><b>${r[3]}</b><span>${r[4]}</span></div></div>`).join('');
  document.querySelectorAll('.kids button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.kid==i))}
document.querySelectorAll('.kids button').forEach(b=>b.onclick=()=>showKid(+b.dataset.kid));showKid(0);

/* ask bookie: a chat */
const msgs=document.getElementById('msgs'),chips=[...document.querySelectorAll('#chips button')];
const now=()=>{const d=new Date();return d.getHours()%12+':'+String(d.getMinutes()).padStart(2,'0')};
function addMsg(cls,text){const m=document.createElement('div');m.className='msg '+cls;m.innerHTML=text+`<time>${now()}</time>`;msgs.appendChild(m);msgs.scrollTop=msgs.scrollHeight;return m}
function resetChat(){msgs.innerHTML='';addMsg('b',CHAT_HI[lang]);chips.forEach(c=>c.disabled=false)}
let busy=false;
chips.forEach(c=>c.onclick=()=>{if(busy)return;busy=true;c.disabled=true;addMsg('u',c.textContent);
  const t=document.createElement('div');t.className='msg b typing';t.innerHTML='<i></i><i></i><i></i>';msgs.appendChild(t);msgs.scrollTop=msgs.scrollHeight;
  setTimeout(()=>{t.remove();addMsg('b',ANS[lang][c.dataset.q]);busy=false},reduce?0:900)});
resetChat();

/* demo form (not wired yet: nothing is sent) */
const letter=document.getElementById('letter');
letter.addEventListener('submit',e=>{e.preventDefault();const empty=[...letter.querySelectorAll('input[required]')].find(i=>!i.value.trim());
  letter.classList.toggle('invalid',!!empty);if(empty){empty.focus();return}
  letter.classList.add('sent')});

/* ================= rotating hero line ================= */
const HERO={[lang]:PAGE.hero};
const LIT=['.o-reg','.o-rcpt','.o-rc','.o-hw',null];
const h1=document.getElementById('h1');let hi=0,heroTimer=null,wordEls=[];
const svgNS='http://www.w3.org/2000/svg';
function renderHero(){
  const H=HERO[lang];h1.querySelector('.pre').textContent=H.pre;h1.querySelector('.suf').textContent=H.suf;
  const rot=h1.querySelector('.rot');rot.innerHTML='';
  wordEls=H.words.map(w=>{const s=document.createElement('span');s.className='w'+(H.split?'':' whole');
    if(H.split){[...w].forEach((c,i)=>{const ch=document.createElement('span');ch.className='ch';ch.style.setProperty('--i',i);ch.textContent=c;s.appendChild(ch)})}else s.textContent=w;
    rot.appendChild(s);return s});
  const svg=document.createElementNS(svgNS,'svg');svg.setAttribute('viewBox','0 0 100 10');svg.setAttribute('preserveAspectRatio','none');
  const p=document.createElementNS(svgNS,'path');p.setAttribute('d','M2 6 C 20 2, 35 9, 52 5 S 85 2, 98 6');p.setAttribute('pathLength','1');p.setAttribute('vector-effect','non-scaling-stroke');svg.appendChild(p);rot.appendChild(svg);
  fitWords();hi=0;showWord(0,true);
}
function fitWords(){const rot=h1.querySelector('.rot'),cw=rot.clientWidth;wordEls.forEach(s=>{s.style.fontSize='';const w=s.scrollWidth;if(w>cw)s.style.fontSize=(cw/w)+'em'})}
function showWord(i,first){
  const prev=wordEls[hi];
  if(!first&&prev&&prev!==wordEls[i]){prev.classList.remove('on');prev.classList.add('out');setTimeout(()=>prev.classList.remove('out'),900)}
  wordEls[i].classList.remove('out');wordEls[i].classList.add('on');
  const svg=h1.querySelector('.rot svg'),txt=wordEls[i];
  const w=txt.getBoundingClientRect().width;
  svg.style.width=Math.max(40,w*.92)+'px';svg.classList.remove('draw');void svg.getBoundingClientRect();svg.classList.add('draw');
  document.querySelectorAll('.obj').forEach(o=>o.classList.remove('lit'));if(LIT[i])document.querySelector(LIT[i])?.classList.add('lit');
  hi=i;
}
function startHero(){if(reduce||heroTimer)return;heroTimer=setInterval(()=>{if(heroIn)showWord((hi+1)%wordEls.length)},2700)}
addEventListener('resize',()=>{fitWords()});
renderHero();startHero();

/* ================= gadgets ================= */
/* receipt printer: the number only goes up */
const slip=document.getElementById('slip');let rno2=1481,pi2=0,printedOnce=false;
const PAY2=[["Ishita Roy","VI A","Aug, Sep",5100,"UPI"],["Mohd. Faiz Alam","VI A","Oct",2550,"Cash"],["Riya Saha","IX B","Oct, Nov",6800,"UPI"],["Arnav Roy","II B","Nov",1850,"Cheque"],["Debanjan Pal","XI Sci","Q3",9450,"UPI"]];
const inr2=n=>'₹'+n.toLocaleString('en-IN')+'.00';
function printNext(){printedOnce=true;rno2++;const p=PAY2[pi2++%PAY2.length];
  slip.classList.remove('out');void slip.offsetWidth;
  slip.innerHTML=`<div class="bn">রোজউড পাবলিক স্কুল</div><div class="c">ROSEWOOD PUBLIC SCHOOL</div><div class="c">FEE RECEIPT</div><hr><div class="r"><span>No.</span><span class="no">MAIN/26-27/0${rno2}</span></div><div class="r"><span>Date</span><span>16-11-2026 11:20</span></div><hr><div class="r"><span>${p[0]}</span><span>${p[1]}</span></div><div class="r"><span>Tuition (${p[2]})</span><span>${inr2(p[3])}</span></div><hr><div class="r tot"><span>TOTAL</span><span>${inr2(p[3])}</span></div><div class="r"><span>Paid by</span><span>${p[4]}</span></div><hr><div class="c">Thank you</div>`;
  requestAnimationFrame(()=>requestAnimationFrame(()=>slip.classList.add('out')))}
document.getElementById('printBtn').onclick=printNext;

/* id cards: deal, then flip */
const STU=[["Aarav Banerjee","01","#FDE7D3"],["Ishita Roy","02","#DDF1F5"],["Mohd. Faiz Alam","03","#ECE6FB"],["Priya Mondal","04","#FFEBDB"],["Sourav Das","05","#DDF0E5"]];
const idbox=document.getElementById('idbox'),idBtn=document.getElementById('idBtn'),idHint=document.getElementById('idHint');
function idCard(s,k){const d=document.createElement('div');d.className='idcard';d.style.setProperty('--x',((k-2)*26)+'px');d.style.setProperty('--r',((k-2)*5)+'deg');d.style.zIndex=k+1;
  d.innerHTML=`<div class="in"><div class="idf"><div class="sch">ROSEWOOD</div><div class="ph" style="--bg:${s[2]}"></div><b>${s[0]}</b>Class VI A · Roll ${s[1]}<div class="bar"></div></div><div class="idb"><b>Rosewood Public School</b>12 Station Road<br>Barasat 700124<br><br>Blood group: B+<br>Emergency: 98310 47726<br><br>Valid till Mar 2027</div></div>`;
  d.onclick=()=>d.classList.toggle('flip');return d}
idBtn.onclick=()=>{idbox.querySelectorAll('.idcard').forEach(c=>c.remove());idBtn.disabled=true;idHint.textContent='';
  STU.forEach((s,k)=>{const c=idCard(s,k);idbox.appendChild(c);setTimeout(()=>c.classList.add('dealt'),reduce?0:120+k*260)});
  setTimeout(()=>{idBtn.disabled=false;idHint.textContent=({en:'tap a card to flip it',hi:'कार्ड पलटने के लिए दबाइए',bn:'কার্ড উল্টাতে টিপুন'})[lang]},reduce?0:120+STU.length*260+400)};

/* photo day */
const NAMES=["Aarav Banerjee","Ishita Roy","Mohd. Faiz Alam","Priya Mondal","Sourav Das","Ananya Ghosh","Kabir Sen","Tanisha Kumari"];
const BGS=["#FDE7D3","#DDF1F5","#ECE6FB","#FFEBDB","#DDF0E5","#E8F1FD","#FBEAF7","#FFFAEB"];
let ph=0;const subj=document.getElementById('subj'),thumbs=document.getElementById('thumbs');
subj.style.setProperty('--bg',BGS[0]);
document.getElementById('shutter').onclick=()=>{const f=document.getElementById('flash');f.classList.remove('go');void f.offsetWidth;f.classList.add('go');
  const slots=[...thumbs.children];if(ph>=slots.length){slots.forEach(t=>{t.className='';t.style.removeProperty('--bg')})}
  const t=slots[ph%slots.length];t.style.setProperty('--bg',BGS[ph%BGS.length]);t.className='t';
  ph++;document.getElementById('phCnt').textContent=Math.min(ph,38)+' / 38';
  subj.classList.add('swap');setTimeout(()=>{const n=ph%NAMES.length;subj.style.setProperty('--bg',BGS[n]);document.getElementById('phName').textContent='Roll '+String(ph+1).padStart(2,'0')+' · '+NAMES[n];subj.classList.remove('swap')},reduce?0:320)};

/* due notices */
const pile=document.getElementById('pile'),nBtn=document.getElementById('nBtn'),nNum=document.getElementById('nNum'),nStat=document.getElementById('nStat');
let nDone=false;
nBtn.onclick=()=>{if(nDone){nStat.innerHTML='<b>Sent.</b> 18 PDFs shared to WhatsApp';nBtn.disabled=true;setTimeout(resetNotices,2600);return}
  nBtn.disabled=true;pile.innerHTML='';let k=0;const amts=[2550,1850,5100,3200,2550,6800,1850,2550];
  const tick=setInterval(()=>{k++;nNum.textContent=k;if(k<=8){const s=document.createElement('div');s.className='sheetm';s.style.setProperty('--k',k-1);s.innerHTML=`<div class="h">রোজউড পাবলিক স্কুল</div>Fee due notice<div class="a">₹${amts[k-1].toLocaleString('en-IN')}</div>Due by 10 Nov<div class="q"></div>`;pile.appendChild(s)}
    if(k>=18){clearInterval(tick);nStat.innerHTML='<b>18 notices ready.</b> One PDF each, with a UPI QR.';nBtn.classList.add('wa-btn');nBtn.innerHTML='<i class="ph-fill ph-whatsapp-logo"></i>Share on WhatsApp';nBtn.disabled=false;nDone=true}},reduce?0:110)};
function resetNotices(){nDone=false;pile.innerHTML='';nNum.textContent='0';nStat.textContent='VI A, October fees';nBtn.classList.remove('wa-btn');nBtn.innerHTML='<i class="ph ph-files"></i><span>'+NO_LABEL+'</span>';nBtn.disabled=false}

/* quiz */
const opts=[...document.querySelectorAll('#opts button')],qres=document.getElementById('qres');
opts.forEach(b=>b.onclick=()=>{if(qres.dataset.done)return;qres.dataset.done=1;const ok=b.dataset.ok;
  b.classList.add(ok?'right':'wrong');if(!ok)opts.find(o=>o.dataset.ok).classList.add('right');
  qres.innerHTML=(ok?'<span><b>Correct.</b> Checked automatically. 31 of 38 got this right.</span>':'<span><b>Not quite.</b> It is 7/8. Checked automatically.</span>')+'<button id="qAgain">Try again</button>';
  document.getElementById('qAgain').onclick=()=>{delete qres.dataset.done;opts.forEach(o=>o.className='');qres.innerHTML='<span>'+QZ_TAP+'</span>'}});

/* attendance calendar: Nov 2026 starts on a Sunday */
const cal=document.getElementById('cal'),cdet=document.getElementById('cdet');
const ST={3:['a','Absent','Fever, note from parent'],11:['a','Absent','No reason given yet'],6:['l','Late','Came in at 9:05 am'],1:['h','Holiday','Sunday'],8:['h','Holiday','Sunday'],15:['h','Holiday','Sunday'],9:['h','Holiday','Kali Puja']};
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
cal.innerHTML=['M','T','W','T','F','S','S'].map(d=>`<span class="wd">${d}</span>`).join('')+'<span></span>'.repeat(6);
for(let d=1;d<=30;d++){const b=document.createElement('button');b.textContent=d;const s=ST[d];
  if(d>16)b.className='f';else if(s)b.className=s[0];if(d===16)b.classList.add('today');
  b.onclick=()=>{if(d>16)return;cal.querySelectorAll('.sel').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');const wd=WD[d%7];
    cdet.innerHTML=s?`<b>${wd} ${d} Nov</b> · ${s[1]}, ${s[2]}`:`<b>${wd} ${d} Nov</b> · Present, marked 8:4${d%10} am`};
  cal.appendChild(b)}

/* ================= feature chips: two rows that drift, and can be swiped ================= */
(function(){
  const C={att:['var(--att)','var(--att-bg)'],fee:['var(--fee)','var(--fee-bg)'],ex:['var(--ex)','var(--ex-bg)'],hw:['var(--hw)','var(--hw-bg)'],stu:['var(--stu)','var(--stu-bg)'],tch:['var(--tch)','var(--tch-bg)'],tr:['var(--trust)','#EFE9F7'],fam:['#1D63C7','#E8F1FD']};
  const F={
   att:[['list-checks','Daily attendance'],['clock','Period attendance'],['hourglass','Late and leave'],['calendar-check','Attendance calendar'],['clock-counter-clockwise','Corrections with history'],['chart-bar','Live school totals']],
   fee:[['squares-four','Fee structures'],['seal-percent','Concessions'],['calendar-blank','Instalments'],['timer','Late fees'],['wallet','Cash, UPI and cheque'],['bank','Cheque clearing'],['printer','58 mm thermal receipts'],['file-text','A4 and half-page receipts'],['qr-code','Due notices with UPI QR'],['book-bookmark','Day book'],['warning-circle','Who owes'],['arrow-u-up-left','Refunds'],['certificate','No-dues certificate'],['receipt','Fee statements']],
   ex:[['pencil-line','Marks entry'],['medal','Grading'],['file-pdf','Report cards'],['paper-plane-tilt','Publish results']],
   hw:[['book-open-text','Homework'],['check-square','Auto-checked quizzes'],['fire','Homework streaks']],
   stu:[['user-plus','Admissions'],['identification-badge','Student profiles'],['users-three','Guardians and siblings'],['camera','Photo day'],['identification-card','ID cards'],['flag','Student status']],
   tch:[['user-gear','Staff roles'],['chalkboard-teacher','Class teachers'],['chalkboard','Subject teachers'],['graph','Teaching assignments']],
   tr:[['buildings','Multi-branch trusts'],['swap','Branch switching'],['calendar','Academic sessions'],['sliders','Academic setup']],
   fam:[['house-line','Family app'],['users','One login for all children'],['whatsapp-logo','WhatsApp sharing'],['translate','Bengali and Hindi headings'],['device-mobile','Android and iPhone'],['desktop','Web for the office']]};
  // round-robin across areas so colours mix
  const keys=Object.keys(F),all=[];let k=0;while(all.length<keys.reduce((n,x)=>n+F[x].length,0)){const key=keys[k%keys.length],arr=F[key],idx=Math.floor(k/keys.length);if(arr[idx])all.push([key,...arr[idx]]);k++}
  const rows=[...document.querySelectorAll('.chiprow')],half=[all.filter((_,i)=>i%2===0),all.filter((_,i)=>i%2===1)];
  const chip=([a,ic,l])=>`<span class="fc" style="--f:${C[a][0]};--b:${C[a][1]}"><i class="ph ph-${ic}"></i>${l}</span>`;
  rows.forEach((r,ri)=>{const html=half[ri].map(chip).join('');r.innerHTML=html+html;r.setAttribute('aria-label',half[ri].map(x=>x[2]).join(', '))});
  if(reduce)return;
  const state=rows.map((r,ri)=>({r,dir:ri?-1:1,idle:0,pos:0}));
  requestAnimationFrame(()=>state.forEach(s=>{if(s.dir<0)s.r.scrollLeft=s.r.scrollWidth/4;s.pos=s.r.scrollLeft}));
  const hold=s=>{s.idle=performance.now()+2500};
  state.forEach(s=>['pointerdown','touchstart','wheel'].forEach(ev=>s.r.addEventListener(ev,()=>hold(s),{passive:true})));
  state.forEach(s=>s.r.addEventListener('scroll',()=>{if(performance.now()<s.idle)s.pos=s.r.scrollLeft},{passive:true}));
  let last=performance.now();
  function tick(t){const dt=Math.min(50,t-last);last=t;
    if(heroIn)state.forEach(s=>{if(t<s.idle)return;const half=s.r.scrollWidth/2;s.pos+=s.dir*dt*.035;if(s.pos>=half)s.pos-=half;if(s.pos<=0)s.pos+=half;s.r.scrollLeft=s.pos});
    requestAnimationFrame(tick)}
  requestAnimationFrame(tick);
})();

/* ================= gadget carousel: auto-swipe and play each demo ================= */
(function(){
  const gal=document.querySelector('.gal'),tiles=[...gal.children],ctl=document.getElementById('gctl'),DUR=7000;
  ctl.style.setProperty('--dur',DUR+'ms');
  let gi=-1,gTimer=null,playT=[],paused=false,manual=false,inView=false,auto=false,resumeT=null;
  const btns=tiles.map((_,i)=>{const b=document.createElement('button');b.className='gc';b.innerHTML='<span></span><i class="bar"></i>';b.onclick=()=>{userTouch();go(i)};ctl.insertBefore(b,ctl.querySelector('.gplay'));return b});
  const label=()=>btns.forEach((b,i)=>b.firstChild.textContent=tiles[i].querySelector('h3').textContent);label();
  const later=(f,ms)=>playT.push(setTimeout(f,reduce?0:ms));
  const plays=[
    ()=>printNext(),
    ()=>{idBtn.click();later(()=>idbox.querySelector('.idcard:last-child')?.classList.add('flip'),2200)},
    ()=>{[300,1150,2000].forEach(ms=>later(()=>document.getElementById('shutter').click(),ms))},
    ()=>{if(nDone)resetNotices();later(()=>nBtn.click(),300);later(()=>{if(nDone)nBtn.click()},3600)},
    ()=>{document.getElementById('qAgain')?.click();later(()=>opts.find(o=>o.dataset.ok).click(),1100)},
    ()=>{[3,6,9,11,16].forEach((d,k)=>later(()=>cal.querySelectorAll('button')[d-1].click(),500+k*800))}];
  function center(i){auto=true;const t=tiles[i];gal.scrollTo({left:t.offsetLeft-(gal.clientWidth-t.offsetWidth)/2,behavior:reduce?'auto':'smooth'});clearTimeout(center.t);center.t=setTimeout(()=>auto=false,800)}
  function activate(i){if(i===gi)return;gi=i;playT.forEach(clearTimeout);playT=[];
    tiles.forEach((t,j)=>t.classList.toggle('cur',j===i));
    btns.forEach((b,j)=>{b.classList.remove('cur');if(j===i){void b.offsetWidth;b.classList.add('cur')}});
    rowTo(btns[i]);
    plays[i]();schedule()}
  function go(i){i=(i+tiles.length)%tiles.length;center(i);activate(i)}
  function schedule(){clearTimeout(gTimer);if(paused||manual||!inView||reduce)return;gTimer=setTimeout(()=>go(gi+1),DUR)}
  function setPaused(p){paused=p;ctl.classList.toggle('paused',p||manual);const pb=ctl.querySelector('.gplay i');pb.className='ph-fill '+(manual?'ph-play':'ph-pause');if(!p&&!manual){const b=btns[gi];b.classList.remove('cur');void b.offsetWidth;b.classList.add('cur')}schedule()}
  function userTouch(){setPaused(true);clearTimeout(resumeT);resumeT=setTimeout(()=>setPaused(false),9000)}
  tiles.forEach(t=>t.addEventListener('pointerdown',userTouch,{passive:true}));
  gal.addEventListener('touchstart',userTouch,{passive:true});
  ctl.querySelector('.gplay').onclick=()=>{manual=!manual;clearTimeout(resumeT);setPaused(false)};
  const tileIO=new IntersectionObserver(es=>es.forEach(e=>{if(auto||!e.isIntersecting||gi<0)return;const i=tiles.indexOf(e.target);if(i!==gi)activate(i)}),{root:gal,threshold:.75});
  tiles.forEach(t=>tileIO.observe(t));
  new IntersectionObserver(([e])=>{inView=e.isIntersecting;if(inView&&gi<0){go(0)}else schedule()},{threshold:.12}).observe(gal);
})();
/* ================= family app showcase ================= */
(function(){
  const tabs=[...document.querySelectorAll('#famTabs button')],scr=[...document.querySelectorAll('#famPhone .fscr')],bar=[...document.querySelectorAll('#famTabbar span')];
  const icons=['house','book-open','medal','currency-inr'];let fi=0,ft=null,fpaused=false,fin=false;
  function show(i){fi=i;tabs.forEach((t,j)=>{t.setAttribute('aria-selected',j===i);if(j===i){const b=t.querySelector('.bar');b.style.animation='none';void b.offsetWidth;b.style.animation=''}});
    scr.forEach((s,j)=>s.classList.toggle('on',j===i));
    bar.forEach((b,j)=>{if(j>3)return;b.classList.toggle('on',j===i);b.querySelector('i').className=(j===i?'ph-fill ph-':'ph ph-')+icons[j]});
    sched()}
  function sched(){clearTimeout(ft);if(fpaused||!fin||reduce)return;ft=setTimeout(()=>show((fi+1)%4),4500)}
  tabs.forEach((t,i)=>t.onclick=()=>{fpaused=true;document.getElementById('famTabs').classList.add('paused');show(i)});
  bar.forEach((b,i)=>{if(i<4){b.style.cursor='pointer';b.onclick=()=>tabs[i].click()}});
  new IntersectionObserver(([e])=>{fin=e.isIntersecting;sched()},{threshold:.12}).observe(document.getElementById('family'));
})();

/* ================= roles ================= */
(function(){
  const R=[
   ['Owner','buildings','var(--trust)','#EFE9F7','The whole trust, every branch, one account.',[['chart-bar','All-branch dashboard'],['currency-inr','Fee collection by branch'],['users-three','Students across branches'],['user-gear','Staff roles and access'],['calendar','Academic sessions'],['swap','Switch branch in one tap']]],
   ['Principal','graduation-cap','var(--ex)','var(--ex-bg)','Approves, publishes, and sees the whole branch.',[['paper-plane-tilt','Publish results'],['seal-percent','Approve concessions'],['clock-counter-clockwise','Attendance corrections'],['chalkboard-teacher','Teaching assignments'],['sliders','Classes, sections, subjects'],['flag','Student status changes'],['file-pdf','Report cards']]],
   ['Teacher','chalkboard-teacher','var(--att)','var(--att-bg)','Their classes and subjects, nothing else.',[['list-checks','Mark attendance'],['calendar-check','Attendance calendar'],['book-open-text','Homework'],['check-square','Auto-checked quizzes'],['eye','Check answers'],['pencil-line','Marks for their subjects'],['identification-badge','Student profiles'],['camera','Photo day']]],
   ['Accountant','currency-inr','var(--fee)','var(--fee-bg)','The fee counter, fast and exact.',[['hand-coins','Collect fees'],['wallet','Cash, UPI and cheque'],['printer','58 mm and A4 receipts'],['bank','Cheque clearing'],['qr-code','Due notices with UPI QR'],['book-bookmark','Day book'],['warning-circle','Who owes'],['arrow-u-up-left','Refunds'],['certificate','No-dues certificate'],['receipt','Fee statements']]],
   ['Front office','identification-card','var(--stu)','var(--stu-bg)','Admissions and student records.',[['user-plus','Admissions'],['users-three','Guardians and siblings'],['identification-card','ID cards'],['camera','Photo day'],['folder-user','Student records'],['flag','Student status']]],
   ['Parents and students','house-line','var(--hw)','var(--hw-bg)','One login for every child in the family.',[['book-open-text','Homework and quizzes'],['fire','Homework streaks'],['check-circle','Daily attendance'],['medal','Results and report cards'],['receipt','Fees and receipts'],['users','All children, one login']]]];
  const tabs=document.getElementById('rlTabs'),panel=document.getElementById('rlPanel');
  const btns=R.map((r,i)=>{const b=document.createElement('button');b.setAttribute('role','tab');b.style.setProperty('--f',r[2]);b.style.setProperty('--b',r[3]);b.innerHTML=`<i class="ph-fill ph-${r[1]}"></i>${r[0]}<small>${r[5].length}</small>`;b.onclick=()=>show(i);tabs.appendChild(b);return b});
  function show(i){const r=R[i];btns.forEach((b,j)=>b.setAttribute('aria-selected',j===i));
    panel.style.setProperty('--f',r[2]);panel.style.setProperty('--b',r[3]);
    document.getElementById('rlIcon').className='ph-fill ph-'+r[1];document.getElementById('rlName').textContent=r[0];document.getElementById('rlLine').textContent=r[4];
    document.getElementById('rlList').innerHTML=r[5].map((f,k)=>`<li style="--k:${k}"><i class="ph ph-${f[0]}"></i>${f[1]}</li>`).join('');
    rowTo(btns[i])}
  show(0);
  // gently walk through the roles until someone taps one
  let ri=0,rt=null,rlIn=false,touched=false;
  btns.forEach(b=>b.addEventListener('click',()=>{touched=true;clearInterval(rt)}));
  if(!reduce)new IntersectionObserver(([e])=>{rlIn=e.isIntersecting;clearInterval(rt);if(rlIn&&!touched)rt=setInterval(()=>{ri=(ri+1)%R.length;show(ri)},4000)},{threshold:.2}).observe(document.getElementById('roles'));
})();
