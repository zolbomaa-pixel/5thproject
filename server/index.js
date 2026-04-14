'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');
const path     = require('path');
const fs       = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));
// index.js-ийн 15-р мөрийг үүгээр соль:
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
/* ── DICTIONARY ── */
let DICT = new Set();
try {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/dict-mn.json'),'utf8'));
  Object.values(j.words).flat().forEach(w => DICT.add(w));
  console.log(`📖 Үгийн сан: ${DICT.size} үг`);
} catch { console.warn('⚠️  dict-mn.json олдсонгүй'); }

/* ── LETTER HELPERS ── */
function conv(ch) {
  const u = ch.toUpperCase();
  if ('ЩЬЪщьъ'.includes(u)) return 'А';
  if ('ЙЫйы'.includes(u))   return 'И';
  return u;
}
function lastL(w)   { return w ? conv(w.slice(-1)) : null; }
function isMon(w)   { return /^[А-Яа-яЁёӨөҮүЫы]+$/.test(w); }
function inDict(w)  { return !DICT.size || DICT.has(w.toUpperCase()); }

/* ── ROOM CONFIGS ── */
const QP = {
  2:{time:10,bans:4,rounds:16,banInterval:3},
  3:{time:10,bans:6,rounds:22,banInterval:3},
  4:{time:10,bans:7,rounds:29,banInterval:3},
  5:{time:10,bans:8,rounds:32,banInterval:3}
};

/* ── STORES ── */
const rooms  = {};
const queues = {2:[],3:[],4:[],5:[]};

/* ── HELPERS ── */
const alive  = g => g.players.filter(p=>!p.eliminated);
const aliveI = g => g.players.map((p,i)=>!p.eliminated?i:-1).filter(i=>i>=0);
const topP   = g => { const a=alive(g); return a.length?a.reduce((x,y)=>x.score>y.score?x:y):null; };

function lobState(room) {
  return {
    roomId:   room.id,
    type:     room.type,
    hostId:   room.hostId,
    cfg:      room.cfg,
    players:  room.players.map(p=>({id:p.id,name:p.name,ready:!!p.ready,isHost:p.id===room.hostId})),
    allReady: room.players.length>1 && room.players.every(p=>p.ready),
    state:    room.state
  };
}

function broadcast(room) {
  const g = room.game;
  if (!g) return;
  io.to(room.id).emit('game:state', {
    players:g.players, tourNum:g.tourNum, round:g.round,
    totalRounds:g.cfg.rounds, lastWord:g.lastWord,
    bannedLetters:g.bannedLetters, usedWords:[...g.usedWords],
    history:g.history.slice(-30), eliminations:g.eliminations,
    currentIdx:g.currentIdx, timeLeft:g.timeLeft,
    waitingBan:g.waitingBan, banningPlayerId:g.banningPlayerId,
    cfg:g.cfg, active:g.active
  });
}

/* ── GAME INIT ── */
function newGame(players, cfg) {
  return {
    players: players.map(p=>({id:p.id,name:p.name,score:0,eliminated:false,banCount:0})),
    cfg, tourNum:1, tourStep:0, round:1,
    lastWord:'', bannedLetters:[], usedWords:new Set(),
    history:[], eliminations:[],
    currentIdx: Math.floor(Math.random()*players.length),
    timer:null, banTimeout:null, timeLeft:cfg.time,
    waitingBan:false, banningPlayerId:null, active:true
  };
}

/* ── TIMER ── */
function startTimer(room) {
  const g = room.game;
  if (!g||!g.active) return;
  clearInterval(g.timer);
  g.timeLeft = g.cfg.time;
  g.timer = setInterval(()=>{
    if (!g.active||g.waitingBan) return;
    if (g.timeLeft<=0) {
      clearInterval(g.timer);
      const cur = g.players[g.currentIdx];
      if (cur&&!cur.eliminated) {
        io.to(room.id).emit('game:eliminated',{playerId:cur.id,playerName:cur.name,reason:'Хугацаа хэтрүүлсэн',icon:'⏰'});
        doElim(room, g.currentIdx, 'Хугацаа хэтрүүлсэн');
      }
      return;
    }
    g.timeLeft--;
    io.to(room.id).emit('game:tick',{timeLeft:g.timeLeft});
  }, 1000);
}

/* ── ELIMINATE ── */
function doElim(room, idx, reason) {
  const g = room.game;
  if (!g||!g.players[idx]||g.players[idx].eliminated) return;
  g.players[idx].eliminated = true;
  g.eliminations.push({name:g.players[idx].name,round:g.round,reason});
  const ai = aliveI(g);
  if (ai.length===1) { doEnd(room,'lastman'); return; }
  if (ai.length===0) { doEnd(room,'all');     return; }
  g.tourStep = Math.max(0,g.tourStep-1);
  let next=-1;
  for (let i=idx+1;i<g.players.length;i++) if (!g.players[i].eliminated){next=i;break;}
  if (next===-1) for (let i=0;i<idx;i++) if (!g.players[i].eliminated){next=i;break;}
  g.currentIdx = next>=0 ? next : ai[0];
  g.round++;
  if (g.round>g.cfg.rounds) { doEnd(room,'rounds'); return; }
  broadcast(room); startTimer(room);
}

/* ── PROCESS WORD ── */
function doWord(room, pid, raw) {
  const g = room.game;
  if (!g||!g.active||g.waitingBan) return;
  const cur = g.players[g.currentIdx];
  if (!cur||cur.id!==pid||cur.eliminated) return;
  clearInterval(g.timer);
  const word = raw.trim().toUpperCase();

  const reject = msg => { io.to(pid).emit('game:word_rejected',{reason:msg}); startTimer(room); };

  if (!isMon(word))   return reject('Зөвхөн монгол үг оруулна уу!');
  if (!inDict(word))  return reject(`"${word}" толь бичигт байхгүй байна!`);
  if (g.usedWords.has(word)) {
    io.to(room.id).emit('game:eliminated',{playerId:cur.id,playerName:cur.name,reason:`Давтагдсан үг ("${word}")`,icon:'💥'});
    return doElim(room,g.currentIdx,`Давтагдсан үг ("${word}")`);
  }
  const req = lastL(g.lastWord);
  if (req && word[0]!==req) {
    io.to(room.id).emit('game:eliminated',{playerId:cur.id,playerName:cur.name,reason:`Сүүл холбоогүй ("${req}"-ээр эхлэх ёстой)`,icon:'💥'});
    return doElim(room,g.currentIdx,'Сүүл холбоогүй');
  }
  const ll = lastL(word);
  if (g.bannedLetters.includes(ll)) {
    io.to(room.id).emit('game:eliminated',{playerId:cur.id,playerName:cur.name,reason:`Хориглосон үсгээр ("${ll}") төгссөн`,icon:'🚫'});
    return doElim(room,g.currentIdx,`Хориглосон үсгээр төгссөн ("${ll}")`);
  }

  // ✅ Accept
  cur.score += word.length;
  g.lastWord = word;
  g.usedWords.add(word);
  g.history.push({word,player:cur.name,points:word.length});
  g.round++;
  io.to(room.id).emit('game:word_accepted',{word,playerId:pid,playerName:cur.name,points:word.length});

  // Tour
  g.tourStep++;
  const ai = aliveI(g);
  if (g.tourStep>=ai.length) {
    g.tourStep=0; g.tourNum++;
    const ban = (g.tourNum-1)%g.cfg.banInterval===0
             && (g.tourNum-1)>0
             && g.bannedLetters.length<g.cfg.bans
             && g.active;
    if (ban) { const top=topP(g); if(top){doBanPhase(room,top);return;} }
  }
  if (g.round>g.cfg.rounds) { doEnd(room,'rounds'); return; }
  const ci=ai.indexOf(g.currentIdx);
  g.currentIdx=ai[(ci+1)%ai.length];
  broadcast(room); startTimer(room);
}

/* ── BAN PHASE ── */
function doBanPhase(room, leader) {
  const g = room.game;
  g.waitingBan=true; g.banningPlayerId=leader.id;
  broadcast(room);
  io.to(leader.id).emit('game:ban_your_turn',{
    currentBans:g.bannedLetters,maxBans:g.cfg.bans,
    message:`${leader.name} та хориглох үсэг сонгоно уу!`
  });
  g.banTimeout = setTimeout(()=>{
    if (g.waitingBan&&g.banningPlayerId===leader.id) doApplyBan(room,leader.id,null);
  },25000);
}

function doApplyBan(room, pid, letter) {
  const g = room.game;
  if (!g||!g.waitingBan||g.banningPlayerId!==pid) return;
  clearTimeout(g.banTimeout);
  if (letter&&!g.bannedLetters.includes(letter)) {
    g.bannedLetters.push(letter);
    const banner=g.players.find(p=>p.id===pid);
    if (banner) banner.banCount++;
    io.to(room.id).emit('game:ban_applied',{letter,bannerName:banner?.name||'?',totalBans:g.bannedLetters.length,maxBans:g.cfg.bans});
  }
  g.players.forEach(p=>{ if(!p.eliminated) p.score=0; });
  g.waitingBan=false; g.banningPlayerId=null;
  const ai=aliveI(g);
  const ci=ai.indexOf(g.currentIdx);
  g.currentIdx=ai[(ci+1)%ai.length];
  broadcast(room); if(g.active) startTimer(room);
}

/* ── END GAME ── */
function doEnd(room, reason) {
  const g = room.game;
  if (!g||!g.active) return;
  g.active=false; clearInterval(g.timer); room.state='finished';
  const al=alive(g);
  let winner=null;
  if (reason==='lastman'&&al.length===1) winner=al[0];
  else if (al.length) winner=[...al].sort((a,b)=>b.banCount-a.banCount||b.score-a.score)[0];
  const board=[
    ...[...g.players.filter(p=>!p.eliminated)].sort((a,b)=>b.banCount-a.banCount||b.score-a.score),
    ...[...g.players.filter(p=> p.eliminated)].sort((a,b)=>b.score-a.score)
  ];
  io.to(room.id).emit('game:over',{reason,winner,leaderboard:board,history:g.history,eliminations:g.eliminations});
}

/* ── SOCKET EVENTS ── */
io.on('connection', socket => {
  console.log(`+ ${socket.id}`);

  /* QUICKPLAY */
  socket.on('quickplay:join',({name,size})=>{
    if (!name||!QP[size]) return;
    const p={id:socket.id,name,score:0,eliminated:false,banCount:0,ready:true};
    queues[size].push(p);
    socket.emit('quickplay:queued',{size,position:queues[size].length});
    if (queues[size].length>=size) {
      const group=queues[size].splice(0,size);
      const rid='qp_'+uuid().slice(0,8);
      const room={id:rid,type:'quickplay',cfg:QP[size],players:group,hostId:group[0].id,state:'playing',game:null};
      rooms[rid]=room;
      group.forEach(pl=>{ const s=io.sockets.sockets.get(pl.id); if(s)s.join(rid); });
      room.game=newGame(group,room.cfg);
      io.to(rid).emit('game:start',{roomId:rid,players:room.game.players,cfg:room.cfg,firstPlayerName:room.game.players[room.game.currentIdx].name});
      broadcast(room); startTimer(room);
    }
  });

  /* PRIVATE ROOM */
  socket.on('private:create',({name,cfg})=>{
    if (!name) return;
    const rid=uuid().slice(0,6).toUpperCase();
    const p={id:socket.id,name,score:0,eliminated:false,banCount:0,ready:true,isHost:true};
    const room={id:rid,type:'private',cfg:{time:cfg?.time||10,bans:cfg?.bans||6,rounds:cfg?.rounds||22,banInterval:cfg?.banInterval||3},players:[p],hostId:socket.id,state:'lobby',game:null};
    rooms[rid]=room; socket.join(rid);
    socket.emit('private:created',{roomId:rid});
    io.to(rid).emit('lobby:state',lobState(room));
  });

  /* JOIN ROOM */
  socket.on('room:join',({name,roomId})=>{
    const room=rooms[roomId];
    if (!room) { socket.emit('error',{msg:`Өрөө "${roomId}" олдсонгүй!`}); return; }
    if (room.state!=='lobby') { socket.emit('error',{msg:'Тоглоом аль хэдийн эхэлсэн байна!'}); return; }
    if (room.players.length>=15) { socket.emit('error',{msg:'Өрөө дүүрэн байна!'}); return; }
    const p={id:socket.id,name,score:0,eliminated:false,banCount:0,ready:false,isHost:false};
    room.players.push(p); socket.join(roomId);
    socket.emit('room:joined',{roomId,isHost:false});
    io.to(roomId).emit('lobby:state',lobState(room));
  });

  /* LAN CREATE */
  socket.on('lan:create',({name,cfg})=>{
    if (!name) return;
    const rid='lan_'+uuid().slice(0,6);
    const p={id:socket.id,name,score:0,eliminated:false,banCount:0,ready:true,isHost:true};
    const room={id:rid,type:'lan',cfg:{
      time:Math.min(30,Math.max(5,cfg?.time||10)),
      bans:Math.min(20,Math.max(1,cfg?.bans||6)),
      rounds:Math.min(99,Math.max(5,cfg?.rounds||22)),
      banInterval:Math.min(10,Math.max(2,cfg?.banInterval||3))
    },players:[p],hostId:socket.id,state:'lobby',game:null};
    rooms[rid]=room; socket.join(rid);
    socket.emit('lan:created',{roomId:rid});
    io.to(rid).emit('lobby:state',lobState(room));
    console.log(`🖥️  LAN: ${rid} by ${name}`);
  });

  /* READY */
  socket.on('lobby:ready',({roomId})=>{
    const room=rooms[roomId]; if(!room) return;
    const p=room.players.find(p=>p.id===socket.id); if(p) p.ready=!p.ready;
    io.to(roomId).emit('lobby:state',lobState(room));
  });

  /* START */
  socket.on('lobby:start',({roomId})=>{
    const room=rooms[roomId];
    if (!room||room.hostId!==socket.id) return;
    if (!room.players.every(p=>p.ready)) { socket.emit('error',{msg:'Бүх тоглогч бэлэн болоогүй!'}); return; }
    if (room.players.length<2) { socket.emit('error',{msg:'Хамгийн багадаа 2 тоглогч хэрэгтэй!'}); return; }
    room.state='playing';
    room.game=newGame(room.players,room.cfg);
    io.to(roomId).emit('game:start',{roomId,players:room.game.players,cfg:room.cfg,firstPlayerName:room.game.players[room.game.currentIdx].name});
    broadcast(room); startTimer(room);
  });

  /* WORD */
  socket.on('game:word',({roomId,word})=>{
    const room=rooms[roomId]; if(room) doWord(room,socket.id,word);
  });

  /* BAN */
  socket.on('game:ban',({roomId,letter})=>{
    const room=rooms[roomId]; if(!room||!room.game) return;
    doApplyBan(room,socket.id,letter?letter.toUpperCase()[0]:null);
  });

  /* REMATCH */
  socket.on('game:rematch',({roomId})=>{
    const room=rooms[roomId];
    if (!room||room.hostId!==socket.id) return;
    room.players.forEach(p=>{p.score=0;p.eliminated=false;p.banCount=0;p.ready=false;});
    room.state='lobby'; room.game=null;
    io.to(roomId).emit('lobby:rematch',lobState(room));
  });

  /* UPDATE CONFIG (host only) */
  socket.on('lobby:updateCfg',({roomId,cfg})=>{
    const room=rooms[roomId];
    if (!room||room.hostId!==socket.id||room.state!=='lobby') return;
    room.cfg={...room.cfg,...cfg};
    io.to(roomId).emit('lobby:state',lobState(room));
  });

  /* DISCONNECT */
  socket.on('disconnect',()=>{
    console.log(`- ${socket.id}`);
    Object.keys(queues).forEach(sz=>{ queues[sz]=queues[sz].filter(p=>p.id!==socket.id); });
    Object.values(rooms).forEach(room=>{
      const idx=room.players.findIndex(p=>p.id===socket.id);
      if (idx<0) return;
      if (room.state==='playing'&&room.game) {
        if (!room.game.players[idx]?.eliminated) {
          io.to(room.id).emit('game:eliminated',{playerId:socket.id,playerName:room.players[idx].name,reason:'Сүлжээнээс тасарсан',icon:'🔌'});
          doElim(room,idx,'Сүлжээнээс тасарсан');
        }
      } else {
        room.players.splice(idx,1);
        if (room.hostId===socket.id&&room.players.length>0) {
          room.hostId=room.players[0].id;
          room.players[0].isHost=true;
          io.to(room.hostId).emit('lobby:you_are_host');
        }
        if (room.players.length===0) delete rooms[room.id];
        else io.to(room.id).emit('lobby:state',lobState(room));
      }
    });
  });
});

server.listen(PORT,()=>{
  console.log(`\n⚡ СҮҮЛ ХОЛБОХ сервер: http://localhost:${PORT}\n`);
});