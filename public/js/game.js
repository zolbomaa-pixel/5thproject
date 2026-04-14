'use strict';
/**
 * ⚡ СҮҮЛ ХОЛБОХ — game.js  v3.0
 * ══════════════════════════════════════════════════════
 *
 *  ГОРИМ ХОЁР дэмжинэ:
 *
 *  SINGLE PLAY  →  бүх логик энд (бот AI, таймер, хориг)
 *  MULTIPLAYER  →  зөвхөн UI render + emit
 *                  submitWord()  →  socket.emit('game:word')
 *                  socket.on('game:state')  →  renderGame()
 *
 *  Хамаарал:
 *    socket-client.js  (multiplayer events)
 *    ui.js             (navigation, login, setup)
 */

/* ══════════════════════════════════════════════
   0. ГОРИМ FLAG
   ══════════════════════════════════════════════ */
let GAME_MODE = 'single';  // 'single' | 'multiplayer'

/* ══════════════════════════════════════════════
   1. CONFIGS
   ══════════════════════════════════════════════ */
const ROOM_CFG = {
  2:{time:10,bans:4,rounds:16,banInterval:3},
  3:{time:10,bans:6,rounds:22,banInterval:3},
  4:{time:10,bans:7,rounds:29,banInterval:3},
  5:{time:10,bans:8,rounds:32,banInterval:3},
};
const DIFF_CFG = {
  easy:   {time:30,bans:3, rounds:12,banInterval:3,botDelay:[2800,4500]},
  normal: {time:20,bans:4, rounds:16,banInterval:3,botDelay:[1300,2600]},
  hard:   {time:10,bans:6, rounds:22,banInterval:3,botDelay:[500,1200]},
  extreme:{time:5, bans:10,rounds:50,banInterval:3,botDelay:[250,650]},
};
const BOT_NAMES=['Болд','Сарнай','Ганаа','Мөнх','Цэцэг','Батаа','Номин','Энхэ','Дорж','Нарнай','Гэрэл','Сэлэнгэ','Отгон','Тунгаа','Мягмар'];
const CIRC = 2*Math.PI*19;  // SVG timer dasharray

/* ══════════════════════════════════════════════
   2. DICTIONARY
   ══════════════════════════════════════════════ */
let DICT_BY_LETTER={}, DICT_SET=new Set(), ALL_WORDS=[];

async function loadDictionary(){
  try{
    const r=await fetch('./data/dict-mn.json');
    const j=await r.json();
    DICT_BY_LETTER=j.words||{};
    ALL_WORDS=Object.values(DICT_BY_LETTER).flat();
    DICT_SET=new Set(ALL_WORDS.map(w=>w.toUpperCase()));
    console.log(`📖 ${ALL_WORDS.length} үг`);
  }catch{
    console.warn('⚠️ dict fallback');
    ALL_WORDS=FALLBACK;
    DICT_SET=new Set(ALL_WORDS);
    ALL_WORDS.forEach(w=>{const l=w[0];if(!DICT_BY_LETTER[l])DICT_BY_LETTER[l]=[];DICT_BY_LETTER[l].push(w);});
  }
}

const FALLBACK=['АВДАР','АВАРГА','АГААР','АЛТАН','АЛДАР','АМГАЛАН','АНАР','АРСЛАН','БААТАР','БАЙГАЛЬ','БИЧИГ','БОЛОР','БОРОО','БУУРАЛ','БҮРГЭД','ГАЗАР','ГОВЬ','ГУАЛ','ГУРВАН','ГЭРЭЛ','ДАЛАЙ','ДАРХАН','ДОРНОД','ДЭЛХИЙ','ЗАГАС','ЗОРИГ','ЗОХИОЛ','ЗҮРХ','МАЛЧИН','МАНЛАЙ','МАНДАЛ','МӨНГӨН','МОНГОЛ','МЭРГЭН','НАЙРАГ','НАМАР','НУТАГ','НУУР','ОГНОО','ОРГИЛ','ОРОН','ОЮУН','САЙХАН','САЛХИ','САНАЛ','САНСАР','САРНАЙ','СОЁЛ','СУРГУУЛЬ','ТАЙВАН','ТАРВАГА','ТУЛААН','ТУНГАЛАГ','ТҮҮХ','ТЭНГЭР','УРАН','УРЛАГ','УЯНГА','ХАЙР','ХОЛБОО','ХУВЬСАЛ','ХҮРЭЛ','ХЭЛБЭР','ХӨГЖИЛ','ЦАГААН','ЦЭВЭР','ЦЭРЭГ','ЧАДВАР','ЧУЛУУН','ЧИМЭГ','ШАГНАЛ','ШИНЭ','ШИЙДВЭР','ШИЛДЭГ','ЭРДЭМ','ЭРДЭНЭ','ЭРХЭМ','ЭЦЭГ','ЯЛАЛТ','ЯРУУ'];

/* ══════════════════════════════════════════════
   3. LETTER HELPERS
   ══════════════════════════════════════════════
   Монгол дүрэм:
     Щ Ь Ъ → А  |  Й Ы → И
*/
function convLetter(ch){const u=ch.toUpperCase();if('ЩЬЪщьъ'.includes(u))return'А';if('ЙЫйы'.includes(u))return'И';return u;}
const getLastL  = w => w?convLetter(w.slice(-1)):null;
const isMon     = w => /^[А-Яа-яЁёӨөҮүЫы]+$/.test(w);
const inDict    = w => !DICT_SET.size||DICT_SET.has(w.toUpperCase());

function pickBotWord(req,banned,used){
  const pool=(req&&DICT_BY_LETTER[req])||ALL_WORDS;
  const c=pool.filter(w=>!used.has(w.toUpperCase())&&(!req||w[0]===req)&&!banned.includes(getLastL(w)));
  return c.length?c[Math.floor(Math.random()*c.length)]:null;
}

/* ══════════════════════════════════════════════
   4. GLOBAL STATE  G
   ══════════════════════════════════════════════
   Single play  → G шинэчлэгдэнэ (энд)
   Multiplayer  → G серверийн game:state-аас (socket-client.js)
*/
let G={};

function freshG(players,cfg){
  return{
    players, cfg,
    tourNum:1, tourStep:0, round:1,
    lastWord:'', bannedLetters:[], usedWords:new Set(),
    history:[], eliminations:[],
    currentIdx:Math.floor(Math.random()*players.length),
    timer:null, timeLeft:cfg.time,
    waitingBan:false, banningPlayer:null,
    active:true,
  };
}

/* ══════════════════════════════════════════════
   5. RENDER  ← хоёр горимд ажиллана
   ══════════════════════════════════════════════
   renderGame() нь G объектоос дэлгэцийг бүхэлд нь зурна.
   Дуудагдах үед:
     Single     → processWordLocal() дараа
     Multiplayer → socket.on('game:state') дараа (socket-client.js)
*/
function renderGame(){
  if(!G||!G.players)return;
  const cfg=G.cfg,alive=G.players.filter(p=>!p.eliminated);
  const top=alive.length?alive.reduce((a,b)=>a.score>b.score?a:b):null;

  // Status bar
  setEl('gRound',G.round);setEl('gMax',cfg.rounds);
  setEl('gBans',`${G.bannedLetters.length}/${cfg.bans}`);
  setEl('gTour',`T${G.tourNum}`);

  // Player cards
  document.getElementById('pRow').innerHTML=G.players.map((pl,i)=>{
    const isA=!G.waitingBan&&i===G.currentIdx&&!pl.eliminated;
    const isL=!pl.eliminated&&top&&top.name===pl.name&&top.score>0;
    const cls=pl.eliminated?'elimed':(isA&&isL)?'active leader':isA?'active':isL?'leader':'';
    const mid=(typeof myId!=='undefined')?myId:null;
    const isMe=GAME_MODE==='multiplayer'&&mid&&pl.id===mid;
    return`<div class="pcard ${cls}" id="pc${i}">
      ${isL?'<div class="pc-crown">👑</div>':''}
      <div class="pc-name">${esc(pl.name)}${isMe?' <span style="font-size:7px;color:var(--a2)">(Та)</span>':''}</div>
      <div class="pc-score">${pl.score}</div>
      <div class="pc-tags">
        ${isA?'<span class="pc-tag turn">▶</span>':''}
        ${isL?'<span class="pc-tag lead">👑</span>':''}
        ${pl.eliminated?'<span class="pc-tag elim">💀</span>':''}
      </div>
      ${pl.banCount>0?`<div class="pc-ban">🚫×${pl.banCount}</div>`:''}
    </div>`;
  }).join('');

  // Word chips
  if(G.lastWord){
    document.getElementById('wChips').innerHTML=G.lastWord.toUpperCase().split('').map((l,i)=>`<div class="chip ${i===G.lastWord.length-1?'last':''}">${l}</div>`).join('');
  }else{document.getElementById('wChips').innerHTML='<span style="color:var(--m);font-size:10px;">— Эхний үг оруулна уу —</span>';}

  // Required letter + conversion hint
  const orig=G.lastWord?G.lastWord.toUpperCase().slice(-1):'';
  const convd=orig?convLetter(orig):'';
  const didConv=orig&&orig!==convd;
  setEl('reqLbl',convd?`⚡ Эхлэх үсэг: ${convd}`:'⚡ Эхний үг — чөлөөт');
  const ch=document.getElementById('convH');
  if(didConv){ch.classList.remove('hidden');ch.textContent=`🔁 "${orig}" → "${convd}" болж хувирав`;}
  else ch.classList.add('hidden');

  // Banned letters
  // Multiplayer ban phase: дэлгэц дээр 🔒 харуулна (зөвхөн хориглогч харна — socket-client.js)
  setEl('banCnt',G.bannedLetters.length);
  const bb=document.getElementById('banBadges');
  if(G.bannedLetters.length){
    if(GAME_MODE==='multiplayer'&&G.waitingBan){
      bb.innerHTML='<span style="color:var(--m);font-size:10px;">🔒 Хориглох үе...</span>';
    }else{
      bb.innerHTML=G.bannedLetters.map(l=>`<div class="bbadge">${l}</div>`).join('');
    }
  }else{bb.innerHTML='<span style="color:var(--m);font-size:10px;">Одоохондоо байхгүй</span>';}

  // Turn label
  const cur=G.players[G.currentIdx];
  if(cur&&!cur.eliminated)setEl('gtlbl',`${cur.name.toUpperCase()}-ИЙН ЭЭЛ`);

  // Input enable/disable
  // ┌─────────────────────────────────────────────────────────┐
  // │ Single:      хүний ээлж ирвэл идэвхжинэ               │
  // │ Multiplayer: myId-тай тоглогчийн ээлж ирвэл идэвхжинэ │
  // └─────────────────────────────────────────────────────────┘
  let canType=false;
  if(GAME_MODE==='single'){
    canType=cur&&!cur.isBot&&!cur.eliminated&&!G.waitingBan&&G.active;
  }else{
    const mid=(typeof myId!=='undefined')?myId:null;
    canType=cur&&cur.id===mid&&!cur.eliminated&&!G.waitingBan&&G.active;
  }
  document.getElementById('ginp').disabled=!canType;
  document.getElementById('gsbtn').disabled=!canType;

  // Warning banner
  const wb=document.getElementById('wBanner');
  if(G.bannedLetters.length>=cfg.bans&&cfg.bans>0){
    wb.textContent='⚠️ АНХААР: Бүх хориг тавигдлаа! Эцсийн үе эхэллээ!';
    wb.classList.add('show');
  }else wb.classList.remove('show');

  // Ban-phase banner
  const pb=document.getElementById('pBanner');
  const bname=G.banningPlayer?.name
    ||(G.banningPlayerId&&G.players.find(p=>p.id===G.banningPlayerId)?.name)
    ||null;
  if(G.waitingBan&&bname){pb.textContent=`🔮 ${bname} — хориглох үсэг сонгож байна...`;pb.classList.add('show');}
  else pb.classList.remove('show');
}

/* ══════════════════════════════════════════════
   6. TIMER  (SINGLE PLAY)
   ══════════════════════════════════════════════
   Multiplayer: таймер серверт байна → 'game:tick' ирнэ
*/
function startTimer(){
  if(G.timer)clearInterval(G.timer);
  G.timeLeft=G.cfg.time;updateTimerUI();
  G.timer=setInterval(()=>{
    if(!G.active||G.waitingBan)return;
    if(G.timeLeft<=0){
      clearInterval(G.timer);
      const c=G.players[G.currentIdx];
      if(c&&!c.eliminated){showElimOverlay('⏰',`${c.name} хугацаа хэтрүүлж хасагдлаа!`,'Цаг дуусав');elimPlayer(G.currentIdx,'Хугацаа хэтрүүлсэн');}
      return;
    }
    G.timeLeft--;updateTimerUI();
  },1000);
}

function updateTimerUI(){
  const pct=G.timeLeft/(G.cfg?.time||10);
  const arc=document.getElementById('timerArc'),num=document.getElementById('gTimer');
  if(arc){arc.style.strokeDashoffset=CIRC*(1-pct);arc.style.stroke=pct>.5?'var(--a3)':pct>.25?'var(--a2)':'var(--a)';}
  if(num){num.textContent=G.timeLeft;num.style.color=pct<=.25?'var(--a)':'var(--t)';}
}

/* ══════════════════════════════════════════════
   7. SUBMIT WORD  ← хоёр горимд ажиллана
   ══════════════════════════════════════════════
   ┌─────────────────────────────────────────────────────┐
   │  SINGLE      →  processWordLocal() дуудна           │
   │  MULTIPLAYER →  socket.emit('game:word', ...) илгээ │
   └─────────────────────────────────────────────────────┘
*/
function submitWord(){
  if(!G.active||G.waitingBan)return;
  const inp=document.getElementById('ginp');
  const raw=inp.value.trim().toUpperCase();
  inp.value='';
  if(!raw)return;

  if(GAME_MODE==='multiplayer'){
    // ★ Сервер рүү илгээнэ — шалгалт серверт хийгдэнэ
    if(typeof socket!=='undefined'&&typeof curRoomId!=='undefined'){
      socket.emit('game:word',{roomId:curRoomId,word:raw});
    }
    return;
  }

  // Single play — дотоодод шалгана
  processWordLocal(raw,false);
}

/* ══════════════════════════════════════════════
   8. LOCAL WORD PROCESSING  (SINGLE PLAY ONLY)
   ══════════════════════════════════════════════
   Multiplayer горимд ЭНЭ ФУНКЦ ДУУДАГДАХГҮЙ.
   Серверийн processWord() → server/index.js
*/
function processWordLocal(raw,isBot){
  if(!G.active)return;
  const cur=G.players[G.currentIdx];
  if(!cur||cur.eliminated)return;
  clearInterval(G.timer);

  // ── Шалгалт ─────────────────────────────────
  if(!isMon(raw)){
    if(!isBot){setInp('err');showFb('Зөвхөн монгол үг оруулна уу!','err');}
    startTimer();return;
  }
  if(!isBot&&!inDict(raw)){
    setInp('err');showFb(`"${raw}" монгол толь бичигт байхгүй байна!`,'err');
    startTimer();return;
  }
  if(G.usedWords.has(raw)){
    if(!isBot)showFb(`"${raw}" давтагдсан!`,'err');
    showElimOverlay('💥',`${cur.name} давтагдсан үг хэлэв!`,`"${raw}" өмнө хэлэгдсэн`);
    elimPlayer(G.currentIdx,`Давтагдсан үг ("${raw}")`);return;
  }
  const req=getLastL(G.lastWord);
  if(req&&raw[0]!==req){
    if(!isBot)showFb(`"${req}"-ээр эхлэх ёстой!`,'err');
    showElimOverlay('💥',`${cur.name} сүүл холбоогүй!`,`"${req}"-ээр эхлэх ёстой`);
    elimPlayer(G.currentIdx,'Сүүл холбоогүй');return;
  }
  const ll=getLastL(raw);
  if(G.bannedLetters.includes(ll)){
    if(!isBot)showFb(`"${ll}" хориглосон үсгээр төгссөн!`,'err');
    showElimOverlay('🚫',`${cur.name} "${ll}" үсгээр төгсгөж хасагдлаа!`,`Хориглосон: ${ll}`);
    elimPlayer(G.currentIdx,`Хориглосон үсгээр ("${ll}")`);return;
  }

  // ── Зөв үг ──────────────────────────────────
  if(!isBot){setInp('ok');showFb(`✅ "${raw}" — +${raw.length} оноо!`,'ok');}
  cur.score+=raw.length;G.lastWord=raw;G.usedWords.add(raw);
  G.history.push({word:raw,player:cur.name,points:raw.length});
  G.round++;G.tourStep++;

  const ai=_aliveI();
  if(G.tourStep>=ai.length){
    G.tourStep=0;G.tourNum++;
    const ban=(G.tourNum-1)%G.cfg.banInterval===0&&(G.tourNum-1)>0
           &&G.bannedLetters.length<G.cfg.bans&&G.active;
    if(ban){const t=_topS();if(t){renderGame();triggerBanSingle(t);return;}}
  }

  renderGame();
  if(G.round>G.cfg.rounds&&G.active){endGame('rounds');return;}
  if(G.active)nextTurn();
}

/* ══════════════════════════════════════════════
   9. TURN  (SINGLE PLAY)
   ══════════════════════════════════════════════ */
const _aliveI=()=>G.players.map((p,i)=>!p.eliminated?i:-1).filter(i=>i>=0);
const _topS  =()=>{const a=G.players.filter(p=>!p.eliminated);return a.length?a.reduce((x,y)=>x.score>y.score?x:y):null;};

function nextTurn(){
  if(!G.active)return;
  const ai=_aliveI();if(!ai.length)return;
  const ci=ai.indexOf(G.currentIdx);
  G.currentIdx=ai[(ci+1)%ai.length];
  renderGame();startTimer();flashTurn(G.players[G.currentIdx].name);
  if(G.players[G.currentIdx].isBot)schedBot();
}

function nextTurnAfterElim(from){
  if(!G.active)return;
  G.tourStep=Math.max(0,G.tourStep-1);
  const ai=_aliveI();if(!ai.length)return;
  let next=-1;
  for(let i=from+1;i<G.players.length;i++)if(!G.players[i].eliminated){next=i;break;}
  if(next<0)for(let i=0;i<from;i++)if(!G.players[i].eliminated){next=i;break;}
  G.currentIdx=next>=0?next:ai[0];G.round++;
  if(G.round>G.cfg.rounds&&G.active){endGame('rounds');return;}
  renderGame();startTimer();flashTurn(G.players[G.currentIdx].name);
  if(G.players[G.currentIdx].isBot)schedBot();
}

function elimPlayer(idx,reason){
  if(!G.players[idx]||G.players[idx].eliminated)return;
  G.players[idx].eliminated=true;
  G.eliminations.push({name:G.players[idx].name,round:G.round,reason});
  const card=document.getElementById(`pc${idx}`);if(card)card.classList.add('elimanim');
  setTimeout(()=>{
    const al=G.players.filter(p=>!p.eliminated);
    if(al.length===1&&G.active){endGame('lastman');return;}
    if(al.length===0){endGame('all');return;}
    nextTurnAfterElim(idx);
  },550);
}

/* ══════════════════════════════════════════════
   10. BOT AI  (SINGLE PLAY ONLY)
   ══════════════════════════════════════════════ */
function schedBot(){
  if(!G.active||G.waitingBan)return;
  const[mn,mx]=G.cfg.botDelay||[900,1800];
  setTimeout(()=>{
    if(!G.active||G.waitingBan)return;
    const cur=G.players[G.currentIdx];if(!cur||!cur.isBot||cur.eliminated)return;
    const w=pickBotWord(getLastL(G.lastWord),G.bannedLetters,G.usedWords);
    if(w)processWordLocal(w,true);
    else{showElimOverlay('🤖',`${cur.name} үг олоогүй!`,'Бот хасагдлаа');elimPlayer(G.currentIdx,'Бот үг олж чадаагүй');}
  },mn+Math.random()*(mx-mn));
}

/* ══════════════════════════════════════════════
   11. BAN  (SINGLE PLAY)
   ══════════════════════════════════════════════
   Multiplayer: ban modal → socket-client.js дотор
*/
function triggerBanSingle(leader){
  G.waitingBan=true;G.banningPlayer=leader;renderGame();
  document.getElementById('banTitle').textContent=`👑 ${leader.name} — ХОРИГЛОХ ҮСЭГ`;
  document.getElementById('banSubText').textContent=`${leader.name} тэргүүлж байна!\nХориглох үсгийг оруулна уу.\nОдоогийн хориг: ${G.bannedLetters.length}/${G.cfg.bans}`;
  document.getElementById('banInp').value='';document.getElementById('banErr').textContent='';
  document.getElementById('banModal').classList.add('show');
  if(leader.isBot){
    setTimeout(()=>{
      const ls='АБВГДЕЖЗИЙКЛМНОӨПРСТУҮФХЦЧЭЮЯӨҮ'.split('');
      let l;let t=0;do{l=ls[Math.floor(Math.random()*ls.length)];t++;}while(G.bannedLetters.includes(l)&&t<60);
      document.getElementById('banModal').classList.remove('show');applyBanSingle(l,leader);
    },1400);return;
  }
  const ok=()=>{
    const v=document.getElementById('banInp').value.trim().toUpperCase();
    if(!v){document.getElementById('banErr').textContent='Үсэг оруулна уу!';return;}
    const l=v[0];
    if(!/[А-ЯЁӨҮ]/.test(l)){document.getElementById('banErr').textContent='Монгол үсэг!';return;}
    if(G.bannedLetters.includes(l)){document.getElementById('banErr').textContent='Аль хэдийн хориглогдсон!';return;}
    document.getElementById('banModal').classList.remove('show');applyBanSingle(l,leader);
  };
  const skip=()=>{document.getElementById('banModal').classList.remove('show');applyBanSingle(null,leader);};
  document.getElementById('banOkBtn').onclick=ok;
  document.getElementById('banSkipBtn').onclick=skip;
  document.getElementById('banInp').onkeydown=e=>{if(e.key==='Enter')ok();};
}

function applyBanSingle(letter,leader){
  if(letter){G.bannedLetters.push(letter);leader.banCount++;showToast(`🚫 "${letter}" үсэг хориглогдлоо!`,'warn');showFb(`⚠️ "${letter}" хориглогдлоо! Үгийг "${letter}"-ээр битгий төгсгөөрэй!`,'warn');}
  G.players.forEach(p=>{if(!p.eliminated)p.score=0;});
  G.waitingBan=false;G.banningPlayer=null;renderGame();if(G.active)nextTurn();
}

/* ══════════════════════════════════════════════
   12. END GAME  (хоёр горимд ажиллана)
   ══════════════════════════════════════════════
   Single      → дотоодоос дуудагдана
   Multiplayer → socket-client.js-ийн game:over дотор дуудагдана
*/
function endGame(reason){
  if(!G.active)return;G.active=false;clearInterval(G.timer);
  const alive=G.players.filter(p=>!p.eliminated);
  let winner=null;
  if(reason==='lastman'&&alive.length===1)winner=alive[0];
  else if(alive.length)winner=[...alive].sort((a,b)=>b.banCount-a.banCount||b.score-a.score)[0];
  const board=[...[...G.players.filter(p=>!p.eliminated)].sort((a,b)=>b.banCount-a.banCount||b.score-a.score),...[...G.players.filter(p=>p.eliminated)].sort((a,b)=>b.score-a.score)];
  renderResult(reason,winner,board,G.history,G.eliminations);
  document.getElementById('resBg').classList.add('show');
}

function renderResult(reason,winner,board,history,eliminations){
  const rc=i=>['r1','r2','r3'][i]||'rn';
  const mid=(typeof myId!=='undefined')?myId:null;
  document.getElementById('resBox').innerHTML=`
    <div class="result-crown">🏆</div>
    <div class="result-winner">${winner?esc(winner.name):'?'}</div>
    <div class="result-type">${reason==='lastman'?'СҮҮЛД ҮЛДСЭН · ЯЛАГЧ':reason==='rounds'?'ҮЕ ДУУСАВ · ТЭРГҮҮЛЭГЧ':'БҮГД ХАСАГДСАН'}</div>
    <table class="rtable"><thead><tr><th>#</th><th>ТОГЛОГЧ</th><th>ОНОО</th><th>ХОРИГ</th><th></th></tr></thead>
    <tbody>${(board||[]).map((p,i)=>`<tr>
      <td><span class="rank ${rc(i)}">${i+1}</span></td>
      <td style="font-weight:700">${esc(p.name)}${mid&&p.id===mid?' <span style="color:var(--a2);font-size:9px;">(Та)</span>':''}</td>
      <td style="color:var(--a2)">${p.score}</td>
      <td style="color:var(--a4)">🚫×${p.banCount}</td>
      <td style="color:${p.eliminated?'var(--a)':'var(--a3)'}">${p.eliminated?'💀':'✨'}</td>
    </tr>`).join('')}</tbody></table>
    ${(eliminations||[]).length?`<div class="lbl" style="margin-bottom:5px">⚠️ ХАСАГДСАН</div><div class="hist-list">${eliminations.map(e=>`<div class="hist-item"><span style="color:var(--a)">❗</span><span class="hist-player">${esc(e.name)}</span><span style="font-size:9px;color:var(--m);flex:1">${e.reason} (үе ${e.round})</span></div>`).join('')}</div>`:''}
    <div class="lbl" style="margin-bottom:5px">📖 ҮГС (${(history||[]).length})</div>
    <div class="hist-list">${[...(history||[])].reverse().slice(0,40).map(h=>`<div class="hist-item"><span class="hist-word">${h.word}</span><span class="hist-player">${esc(h.player)}</span><span class="hist-pts">+${h.points}</span></div>`).join('')}</div>
    <div class="result-btns">
      ${GAME_MODE==='multiplayer'
        ?`<button class="btn btn-y" style="flex:1" onclick="if(typeof socket!=='undefined')socket.emit('game:rematch',{roomId:curRoomId})">🔄 ДАХИН ТОГЛОХ</button>`
        :`<button class="btn btn-y" style="flex:1" onclick="rematch()">🔄 ДАХИН ТОГЛОХ</button>`}
      <button class="btn btn-gh" style="flex:1" onclick="closeResult()">◀ ГАРАХ</button>
    </div>`;
}

/* ══════════════════════════════════════════════
   13. INIT / REMATCH / QUIT
   ══════════════════════════════════════════════ */

/** Single play эхлүүлэх */
function initGame(players,cfg){
  GAME_MODE='single';
  G=freshG(players,cfg);
  while(G.players[G.currentIdx].eliminated)G.currentIdx=(G.currentIdx+1)%G.players.length;
  goTo('gameScr');renderGame();startTimer();flashTurn(G.players[G.currentIdx].name);
  if(G.players[G.currentIdx].isBot)schedBot();
}

/**
 * Multiplayer game UI эхлүүлэх
 * socket-client.js-ийн 'game:start' дотроос дуудагдана.
 * Дотоод таймер эхлүүлэхгүй — сервер 'game:tick' илгээнэ.
 */
function initGameMultiplayer(players,cfg){
  GAME_MODE='multiplayer';
  G=freshG(players.map(p=>({...p,score:0,eliminated:false,banCount:0})),cfg);
  goTo('gameScr');
  renderGame();
  // Socket mode-д submit үргэлж socket-client.js-ийн socketSubmitWord → submitWord() руу очно
  document.getElementById('gsbtn').onclick=submitWord;
  document.getElementById('ginp').onkeydown=e=>{if(e.key==='Enter')submitWord();};
}

function rematch(){
  document.getElementById('resBg').classList.remove('show');
  const pl=G.players.map(p=>({...p,score:0,eliminated:false,banCount:0}));
  showCountdown(()=>initGame(pl,G.cfg));
}
function closeResult(){document.getElementById('resBg').classList.remove('show');G.active=false;clearInterval(G.timer);goTo('homeScr');}
function quitGame(){G.active=false;clearInterval(G.timer);document.getElementById('resBg').classList.remove('show');document.getElementById('banModal').classList.remove('show');goTo('homeScr');}

/* ══════════════════════════════════════════════
   14. UI HELPERS  (хоёр горимд хуваалцана)
   ══════════════════════════════════════════════ */
function setEl(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
let _tT;
function showToast(msg,type='ok'){const e=document.getElementById('toast');e.textContent=msg;e.className=`toast show t-${type}`;clearTimeout(_tT);_tT=setTimeout(()=>e.classList.remove('show'),2400);}
function showElimOverlay(icon,title,sub){document.getElementById('elimIcon').textContent=icon;document.getElementById('elimTitle').textContent=title;document.getElementById('elimSub').textContent=sub;const o=document.getElementById('elimOv');o.classList.add('show');setTimeout(()=>o.classList.remove('show'),2400);}
function flashTurn(name){document.querySelectorAll('.turn-flash').forEach(e=>e.remove());if(!name||name.includes('🤖'))return;const t=document.createElement('div');t.className='turn-flash';t.textContent=`⚡ ${name} — ТАНЫ ЭЭЛ`;document.body.appendChild(t);setTimeout(()=>{if(t.parentNode)t.remove();},1700);}
function setInp(s){const e=document.getElementById('ginp');e.className=`game-inp ${s}`;setTimeout(()=>e.className='game-inp',700);}
function showFb(msg,type){const e=document.getElementById('gfb');e.textContent=msg;e.className=`game-fb show ${type}`;setTimeout(()=>e.className='game-fb',3500);}
function showCountdown(cb){const o=document.getElementById('cdOv'),n=document.getElementById('cdNum');o.classList.add('show');let c=3;n.textContent=c;const iv=setInterval(()=>{c--;if(c<=0){clearInterval(iv);o.classList.remove('show');cb();}else n.textContent=c;},1000);}