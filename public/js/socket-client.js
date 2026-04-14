'use strict';
const socket=io();
let myId=null,curRoom=null;

setTimeout(() => {
  const el = document.getElementById('privateRoomCode');
  if(el) el.textContent = "ХОЛБОГДЛОО";
}, 2000);

socket.on('connect',()=>{myId=socket.id;showToast('Сервертэй холбогдлоо ✅','ok');});
socket.on('disconnect',()=>showToast('Холболт тасарлаа!','err'));
socket.on('error',({msg})=>showToast(msg,'err'));

/* QUICKPLAY */
function socketJoinQuickplay(size){socket.emit('quickplay:join',{name:username,size});showToast(`${size} хүний өрөө хайж байна...`,'warn');}
socket.on('quickplay:queued',({size,position})=>showToast(`${position}/${size} тоглогч... хүлээж байна`,'warn'));

/* PRIVATE */
socket.on('private:created', ({roomId}) => {
  curRoom = roomId;
  
  // 1. Кодыг дэлгэцэнд оноох
  const codeEl = document.getElementById('privateRoomCode');
  if (codeEl) {
    codeEl.textContent = roomId;
  }
  
  // 2. Өрөөний дэлгэцийг хүчээр харуулах (hidden class-ыг устгах)
  const roomScr = document.getElementById('privateRoomScr');
  if (roomScr) {
    roomScr.classList.remove('hidden'); // 'hidden' class-ыг устгаж харагдуулна
    roomScr.style.display = 'block';    // Хэрэв CSS дээр өөрөөр тохируулсан бол хүчээр харуулна
  }

  // 3. Бусад дэлгэцийг нуух (таны goTo функц алдаатай байж магадгүй тул)
  document.querySelectorAll('.screen').forEach(s => {
    if (s.id !== 'privateRoomScr') s.classList.add('hidden');
  });

  showToast(`Өрөө үүслээ: ${roomId}`, 'ok');
});
/* JOIN */
function joinRoomByCode(){
  const code=document.getElementById('joinCode').value.trim().toUpperCase();
  if(!code){showToast('Код оруулна уу!','err');return;}
  socketJoinRoom(code);
}
function socketJoinRoom(roomId){socket.emit('room:join',{name:username,roomId:roomId.toUpperCase().trim()});curRoom=roomId.toUpperCase().trim();}
socket.on('room:joined',({roomId})=>{curRoom=roomId;goTo('lobbyScr');showToast(`Өрөөнд нэгдлээ: ${roomId}`,'ok');});

/* LAN */
function createLanRoom(){
  const cfg={rounds:clamp(parseInt(document.getElementById('lnR').value)||22,5,99),time:clamp(parseInt(document.getElementById('lnT').value)||10,5,30),bans:clamp(parseInt(document.getElementById('lnMB').value)||6,1,20),banInterval:clamp(parseInt(document.getElementById('lnBI').value)||3,2,10)};
  socket.emit('lan:create',{name:username,cfg});
}
socket.on('lan:created',({roomId})=>{curRoom=roomId;goTo('lobbyScr');showToast(`LAN өрөө: ${roomId}`,'ok');});

/* LOBBY */
/* LOBBY */
socket.on('lobby:state', (state) => {
  curRoom = state.roomId;
  
  // 1. Тоглогчдын жагсаалтыг шинэчлэх (lobbyPlayers ID-г ашиглана)
  const container = document.getElementById('lobbyPlayers');
  if (container) {
    container.innerHTML = state.players.map(p => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 8px;">
        <span style="color: white; font-size: 1.1rem;">${p.isHost ? '👑' : ''} ${p.name} ${p.id === myId ? '(Та)' : ''}</span>
        <span style="color: ${p.ready ? '#00ff00' : '#ffcc00'}; font-weight: bold;">
          ${p.ready ? '✅ Бэлэн' : '⏳ Хүлээж байна'}
        </span>
      </div>
    `).join('');
  }

  // 2. Өрөөний кодыг дэлгэцэнд гаргах
  const codeEl = document.getElementById('privateRoomCode');
  if (codeEl) codeEl.textContent = state.roomId;

  // 3. "ТОГЛООМ ЭХЛЭХ" товчийг зөвхөн Host-д харуулах ба идэвхжүүлэх
  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    // Хэрэв бүх тоглогч бэлэн бол товч идэвхжинэ
    startBtn.disabled = !state.allReady;
    // Зөвхөн Host хүнд л энэ товч харагдана
    startBtn.style.display = state.hostId === myId ? 'block' : 'none';
  }

  // 4. Найзад чинь "БЭЛЭН" болох товчийг харуулах (Host-д харагдахгүй)
  const guestCtrl = document.getElementById('guestCtrl');
  if (guestCtrl) {
    if (state.hostId === myId) {
      guestCtrl.style.display = 'none'; // Host бол нуух
    } else {
      guestCtrl.style.display = 'flex'; // Найз бол харуулах
      guestCtrl.classList.remove('hidden');
    }
  }
});

socket.on('lobby:rematch', (state) => {
  document.getElementById('resBg').classList.remove('show');
  curRoom = state.roomId;
  goTo('privateRoomScr'); // Дахин тоглох үед лобби дэлгэц рүү буцна
});

socket.on('lobby:you_are_host', () => showToast('Та HOST болсон! 👑', 'warn'));

function renderServerLobby(state){
  const isHost=state.hostId===myId;
  document.getElementById('lobbyName').textContent=state.type==='lan'?'🖥️ LAN Өрөө':state.type==='private'?`🔒 Өрөө: ${state.roomId}`:'⚡ Quick Play';
  document.getElementById('lobbyCfg').innerHTML=`<span>🔄 <span class="lcfg-val">${state.cfg.rounds}</span> үе</span><span>⛔ <span class="lcfg-val">${state.cfg.bans}</span> хориг</span><span>🕐 <span class="lcfg-val">${state.cfg.time}</span> сек</span><span>📊 <span class="lcfg-val">${state.cfg.banInterval}</span> тойрог тутамд</span>`;
  document.getElementById('lobbyPlayers').innerHTML=state.players.map(p=>`<div class="lp-item ${p.isHost?'host':''} ${p.ready?'ready':''}"><div class="lp-avatar">${(p.name||'?')[0]}</div><div class="lp-name">${esc(p.name)}${p.id===myId?' <span style="color:var(--a2);font-size:9px;">(Та)</span>':''}</div>${p.isHost?'<span class="lp-tag ht">HOST</span>':''}<span class="lp-tag ${p.ready?'rd':'wt'}">${p.ready?'✅ БЭЛЭН':'⏳ ХҮЛЭЭЖ'}</span></div>`).join('');
  if(isHost){document.getElementById('hostCtrl').classList.remove('hidden');document.getElementById('guestCtrl').classList.add('hidden');document.getElementById('startBtn').disabled=!state.allReady;document.getElementById('startBtn').onclick=()=>socket.emit('lobby:start',{roomId:curRoom});}
  else{document.getElementById('hostCtrl').classList.add('hidden');document.getElementById('guestCtrl').classList.remove('hidden');document.getElementById('guestCtrl').style.display='flex';
    const me=state.players.find(p=>p.id===myId);
    document.getElementById('rdyBtn').textContent=me?.ready?'❌ БОЛИХ':'✅ БЭЛЭН';
    document.getElementById('rdyBtn').onclick=()=>socket.emit('lobby:ready',{roomId:curRoom});}
}

function copyRoomCode(){const c=document.getElementById('privateRoomCode').textContent;navigator.clipboard.writeText(c).then(()=>showToast('Код хуулагдлаа!','ok'));}
function socketExitLobby(){curRoom=null;goTo('multiScr');}

/* ── GAME START ──────────────────────────────
   initGameMultiplayer() нь game.js дотор байна.
   GAME_MODE='multiplayer' болгоно,
   дотоод таймер эхлүүлэхгүй (сервер хийнэ).
*/
socket.on('game:start',({roomId,players,cfg,firstPlayerName})=>{
  curRoom=roomId;
  showCountdown(()=>{
    // game.js-ийн initGameMultiplayer() дуудна
    initGameMultiplayer(players,cfg);
    showToast(`⚡ ${firstPlayerName} эхэлж байна!`,'ok');
  });
});

/* ── GAME STATE ──────────────────────────────
   Серверийн game:state ирэх бүрт G шинэчилж
   renderGame() дуудна.
   Зөвхөн МЫ ЭЭЛ ирсэн тоглогчийн input идэвхтэй.
*/
socket.on('game:state',state=>{
  if(!G||!G.cfg)return;
  // G-д серверийн тохирох бүх талбарыг шинэчилнэ
  G.players         = state.players;
  G.tourNum         = state.tourNum;
  G.round           = state.round;
  G.lastWord        = state.lastWord;
  G.bannedLetters   = state.bannedLetters;
  G.usedWords       = new Set(state.usedWords||[]);
  G.history         = state.history;
  G.eliminations    = state.eliminations||G.eliminations||[];
  G.currentIdx      = state.currentIdx;
  G.timeLeft        = state.timeLeft;
  G.waitingBan      = state.waitingBan;
  G.banningPlayerId = state.banningPlayerId; // renderGame()-д ашиглагдана
  G.active          = state.active;
  // renderGame() нь GAME_MODE==='multiplayer' ба myId ашиглан input-г өөрөө зохицуулна
  renderGame();
  updateTimerUI();
});

socket.on('game:tick',({timeLeft})=>{G.timeLeft=timeLeft;updateTimerUI();});
socket.on('game:word_accepted',({word,playerName,points})=>showFb(`✅ ${esc(playerName)}: "${word}" +${points}`,'ok'));
socket.on('game:word_rejected',({reason})=>{setInp('err');showFb(reason,'err');});
socket.on('game:eliminated',({playerId,playerName,reason,icon})=>{
  showElimOverlay(icon||'💥',`${esc(playerName)} хасагдлаа!`,reason);
  if(playerId===myId){showFb('Та хасагдлаа!','err');document.getElementById('ginp').disabled=true;document.getElementById('gsbtn').disabled=true;}
});

socket.on('game:ban_your_turn',({currentBans,maxBans,message})=>{
  document.getElementById('banTitle').textContent='🔮 ТАНЫ ХОРИГЛОХ ҮСЭГ';
  document.getElementById('banSubText').textContent=`${message}\nОдоогийн хориг: ${currentBans.length}/${maxBans}`;
  document.getElementById('banInp').value='';document.getElementById('banErr').textContent='';
  document.getElementById('banModal').classList.add('show');
  const ok=()=>{
    const v=document.getElementById('banInp').value.trim().toUpperCase();
    if(!v){document.getElementById('banErr').textContent='Үсэг оруулна уу!';return;}
    const l=v[0];
    if(!/[А-ЯЁӨҮ]/.test(l)){document.getElementById('banErr').textContent='Монгол үсэг!';return;}
    if(currentBans.includes(l)){document.getElementById('banErr').textContent='Аль хэдийн хориглогдсон!';return;}
    document.getElementById('banModal').classList.remove('show');
    socket.emit('game:ban',{roomId:curRoom,letter:l});
  };
  const skip=()=>{document.getElementById('banModal').classList.remove('show');socket.emit('game:ban',{roomId:curRoom,letter:null});};
  document.getElementById('banOkBtn').onclick=ok;document.getElementById('banSkipBtn').onclick=skip;
  document.getElementById('banInp').onkeydown=e=>{if(e.key==='Enter')ok();};
});

socket.on('game:ban_applied',({letter,bannerName})=>{
  document.getElementById('banModal').classList.remove('show');
  if(letter){showToast(`🚫 ${esc(bannerName)}: "${letter}" хориглолоо`,'warn');showFb(`⚠️ "${letter}" хориглогдлоо!`,'warn');}
});

/* ── GAME OVER ──────────────────────────────
   game.js-ийн renderResult() ашиглана.
   GAME_MODE='multiplayer' → Дахин тоглох = socket rematch
*/
socket.on('game:over',({reason,winner,leaderboard,history,eliminations})=>{
  if(G){G.active=false;G.history=history||[];G.eliminations=eliminations||[];}
  renderResult(reason,winner,leaderboard||[],history||[],eliminations||[]);
  document.getElementById('resBg').classList.add('show');
});
function socketSubmit(){const i=document.getElementById('ginp'),w=i.value.trim();i.value='';if(!w)return;socket.emit('game:word',{roomId:curRoom,word:w});}

/* PRIVATE ROOM FUNCTIONS */
function createPrivateRoom() {
  // 1. Хэрэглэгчийн нэрийг шалгах (ui.js эсвэл sessionStorage-оос авах)
  const uName = typeof username !== 'undefined' ? username : (document.getElementById('loginInp')?.value || 'Тоглогч');

  // 2. index.html дээрх ID-нуудаас утгуудыг маш нарийн авах
  const cfg = {
    rounds: parseInt(document.getElementById('prR')?.value) || 22,
    time: parseInt(document.getElementById('prT')?.value) || 10,й
    bans: parseInt(document.getElementById('prMB')?.value) || 6,
    banInterval: parseInt(document.getElementById('prBI')?.value) || 3
  };

  console.log("🚀 Өрөө үүсгэх хүсэлт илгээж байна...", { name: uName, cfg });

  // 3. Сервер рүү илгээх
  socket.emit('private:create', { name: uName, cfg });
  
  // 4. Дэлгэцийг хүчээр солих (Хэрэв серверээс хариу ирэхэд удаж байвал)
  showToast('Өрөө үүсгэж байна, түр хүлээнэ үү...', 'warn');
}
