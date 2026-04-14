'use strict';
let username='',curScr='loginScr',selDiff='normal',bots=[],botCtr=1,lobby={};

function goTo(id){document.getElementById(curScr).classList.add('hidden');document.getElementById(id).classList.remove('hidden');curScr=id;syncU();}
function syncU(){['homeU','homeG','muU','qpU','cuU','laU','lobU','spU','gU','prU'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=username;});}

function initAuth(){
  const s=sessionStorage.getItem('mnwg');if(s){username=s;const i=document.getElementById('loginInp');if(i){i.value=s;document.getElementById('nlen').textContent=s.length;}}
  document.getElementById('loginInp').addEventListener('input',function(){document.getElementById('nlen').textContent=this.value.length;});
  document.getElementById('loginInp').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  document.getElementById('loginBtn').addEventListener('click',doLogin);
}

function doLogin(){
  const n=document.getElementById('loginInp').value.trim();
  if(n.length<2){document.getElementById('loginInp').classList.add('err');setTimeout(()=>document.getElementById('loginInp').classList.remove('err'),500);showToast('Хоч нэр 2-оос дээш тэмдэгт байх ёстой!','err');return;}
  username=n;sessionStorage.setItem('mnwg',username);goTo('homeScr');showToast(`Тавтай морил, ${username}! 🎉`,'ok');
  // Check pending room from URL
  const pr=sessionStorage.getItem('pendingRoom');if(pr){sessionStorage.removeItem('pendingRoom');setTimeout(()=>socketJoinRoom(pr),400);}
}

/* SINGLE */
function setDiff(d){selDiff=d;document.querySelectorAll('.diff-opt').forEach(e=>e.classList.remove('sel'));document.getElementById(`d-${d}`).classList.add('sel');}
function addBot(){if(bots.length>=4){showToast('Хамгийн ихдээ 4 бот!','err');return;}const n=BOT_NAMES[botCtr%BOT_NAMES.length];bots.push({id:botCtr++,name:`🤖 ${n}`});renderBots();}
function removeBot(id){bots=bots.filter(b=>b.id!==id);renderBots();}
function renderBots(){document.getElementById('botChips').innerHTML=bots.map(b=>`<div class="bot-chip">${b.name}<span class="bot-chip-x" onclick="removeBot(${b.id})">✕</span></div>`).join('');}
function initSingleSetup(){addBot();}

function startSingle(){
  const cfg={...DIFF_CFG[selDiff]};
  if(!bots.length){addBot();}
  const pl=[{name:username,isBot:false,score:0,eliminated:false,banCount:0},...bots.map(b=>({name:b.name,isBot:true,score:0,eliminated:false,banCount:0}))];
  showCountdown(()=>initGame(pl,cfg));
}

/* QUICKPLAY (local bots) */
function startQPLocal(n){
  const cfg={...ROOM_CFG[n]};
  const pl=[{name:username,isBot:false,score:0,eliminated:false,banCount:0}];
  for(let i=1;i<n;i++)pl.push({name:`🤖 ${BOT_NAMES[i%BOT_NAMES.length]}`,isBot:true,score:0,eliminated:false,banCount:0});
  showCountdown(()=>initGame(pl,cfg));
}

/* LAN local sim */
function lanHostLocal(){
  const n=clamp(parseInt(document.getElementById('lnP').value)||4,1,15);
  const cfg={time:clamp(parseInt(document.getElementById('lnT').value)||10,5,30),bans:clamp(parseInt(document.getElementById('lnMB').value)||6,1,20),rounds:clamp(parseInt(document.getElementById('lnR').value)||22,5,99),banInterval:clamp(parseInt(document.getElementById('lnBI').value)||3,2,10),botDelay:[800,1600]};
  lobby={isHost:true,cfg,maxPlayers:n,players:[{name:username,isHost:true,ready:true,isBot:false},...Array.from({length:n-1},(_,i)=>({name:`🤖 ${BOT_NAMES[(i+1)%BOT_NAMES.length]}`,isHost:false,ready:true,isBot:true}))]};
  goTo('lobbyScr');renderLobbyLocal();showToast('Өрөө нээгдлээ!','ok');
}

function renderLobbyLocal(){
  const cfg=lobby.cfg;
  document.getElementById('lobbyName').textContent=lobby.isHost?'🖥️ Таны Өрөө':'🚪 Нэгдсэн Өрөө';
  document.getElementById('lobbyCfg').innerHTML=`<span>🔄 <span class="lcfg-val">${cfg.rounds}</span> үе</span><span>⛔ <span class="lcfg-val">${cfg.bans}</span> хориг</span><span>🕐 <span class="lcfg-val">${cfg.time}</span> сек</span><span>📊 <span class="lcfg-val">${cfg.banInterval}</span> тойрог тутамд</span>`;
  let html=lobby.players.map(p=>`<div class="lp-item ${p.isHost?'host':''} ${p.ready?'ready':''}"><div class="lp-avatar">${(p.name.replace(/🤖\s*/,'')||'?')[0]}</div><div class="lp-name">${esc(p.name)}</div>${p.isHost?'<span class="lp-tag ht">HOST</span>':''}<span class="lp-tag ${p.ready?'rd':'wt'}">${p.ready?'✅ БЭЛЭН':'⏳ ХҮЛЭЭЖ'}</span></div>`).join('');
  for(let i=lobby.players.length;i<(lobby.maxPlayers||4);i++)html+=`<div class="lp-empty">⌛ Тоглогч хүлээж байна...</div>`;
  document.getElementById('lobbyPlayers').innerHTML=html;
  document.getElementById('hostCtrl').classList.remove('hidden');document.getElementById('guestCtrl').classList.add('hidden');
  document.getElementById('startBtn').disabled=!lobby.players.every(p=>p.ready);
  document.getElementById('startBtn').onclick=lobStartLocal;
}

function lobStartLocal(){
  const pl=lobby.players.map(p=>({name:p.name,isBot:p.isBot||false,score:0,eliminated:false,banCount:0}));
  showCountdown(()=>initGame(pl,lobby.cfg));
}

function exitLobby(){lobby={};goTo('multiScr');}
function clamp(v,mn,mx){return Math.min(mx,Math.max(mn,v));}