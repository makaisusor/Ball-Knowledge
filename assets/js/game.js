/* Ball Knowledge core gameplay. Expects mlb-player-data.js to load first. */
const players=RAW.map(([id,first,last])=>({id,first,last,name:first+' '+last,key:norm(first+' '+last)}));
const byId=new Map(players.map(p=>[p.id,p]));
const byName=new Map();for(const p of players){let a=byName.get(p.key)||[];a.push(p);byName.set(p.key,a)}
// Add current-season MLB players from the daily GitHub Actions update.
async function loadCurrentMLBPlayers(){
 try{
  const response=await fetch('./mlb-players-latest.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Player update unavailable');
  const data=await response.json();
  if(!Array.isArray(data.players)||data.players.length<700)throw new Error('Incomplete MLB player update');
  let added=0;
  for(const item of data.players){
   if(!item||!Number.isInteger(item.mlbId)||typeof item.name!=='string')continue;
   const name=item.name.trim().replace(/\s+/g,' ');
   const parts=name.split(/\s+/);
   if(parts.length<2)continue;
   const key=norm(name);
   if(byName.has(key))continue;
   const first=parts[0],last=parts.slice(1).join(' ');
   const id='mlb-'+item.mlbId;
   if(byId.has(id))continue;
   const p={id,first,last,name,key,mlbId:item.mlbId};
   players.push(p);byId.set(id,p);byName.set(key,[p]);added++;
  }
  console.info('Ball Knowledge: added '+added+' new MLB names from '+data.season);
 }catch(error){console.warn('Ball Knowledge: using historical player list only',error)}
}
loadCurrentMLBPlayers();
function norm(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase()}
function initial(s){return (s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z]/i)||[''])[0].toUpperCase()}

/* Conservative MLB typo matching: require both a first and last name and preserve the first initial. */
function bkBoundedDistance(a,b,limit){
 if(limit>=1&&a.length===b.length){for(let k=0;k<a.length-1;k++){if(a[k]===b[k+1]&&a[k+1]===b[k]&&a.slice(0,k)===b.slice(0,k)&&a.slice(k+2)===b.slice(k+2))return 1}}
 if(Math.abs(a.length-b.length)>limit)return limit+1;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const next=[i];let best=i;
  for(let j=1;j<=b.length;j++){
   const value=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
   next.push(value);if(value<best)best=value;
  }
  if(best>limit)return limit+1;
  prev=next;
 }
 return prev[b.length];
}
function bkSpellingMatches(typed,requiredLetter,usedIds){
 const words=typed.trim().split(/\s+/).filter(Boolean);
 if(words.length<2)return [];
 const given=norm(words[0]),surname=norm(words.slice(1).join(''));
 if(given.length<2||surname.length<3)return [];
 const candidates=[];
 for(const p of players){
  if(requiredLetter&&initial(p.first)!==requiredLetter)continue;
  if(usedIds?.has(p.id))continue;
  const first=norm(p.first),last=norm(p.last);
  if(first[0]!==given[0])continue;
  const flimit=given.length>=4&&first.length>=4?1:0;
  const fd=bkBoundedDistance(given,first,flimit);if(fd>flimit)continue;
  const llimit=Math.min(surname.length,last.length)>=7?2:1;
  const ld=bkBoundedDistance(surname,last,llimit);if(ld>llimit||fd+ld>2||fd+ld===0)continue;
  candidates.push({player:p,cost:fd+ld});
 }
 candidates.sort((a,b)=>a.cost-b.cost||a.player.name.localeCompare(b.player.name));
 const unique=[],seen=new Set();
 for(const match of candidates){if(seen.has(match.player.key))continue;seen.add(match.player.key);unique.push(match);if(unique.length>=5)break}
 return unique;
}
function bkSpellingChoices(target,candidates,onChoose){
 if(!target)return;
 target.textContent='Did you mean one of these MLB players? ';
 for(const {player} of candidates.slice(0,3)){
  const btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent=player.name;
  btn.style.margin='5px';btn.onclick=()=>onChoose(player);target.appendChild(btn);
 }
}

const app=document.getElementById('app');let mode='solo',duration=20,count=2,profiles=['Player 1','Player 2'],game=null,ticker=null,selected=null,searchMatches=[];
const safe=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Career ranks: count valid human answers, including repeat names across separate matches. */
const bkRankTiers=[
 {name:'Beginner',min:0,icon:'◈'},
 {name:'Advanced',min:200,icon:'◆'},
 {name:'Expert',min:500,icon:'✦'},
 {name:'Legend',min:2000,icon:'★'},
 {name:'GOAT',min:5000,icon:'♛'},
 {name:'Ball Knower',min:10000,icon:'🏆'}
];
function bkRankFor(total){let rank=bkRankTiers[0];for(const t of bkRankTiers)if(total>=t.min)rank=t;return rank}
/* Unique career player IDs are stored per authenticated account in Supabase. */
const bkCareerClient=()=>window.bkSharedClient();
let bkCareerUser=null,bkCareerTotal=0,bkCareerStatus='Sign in to start collecting unique MLB players.',bkCareerSerial=0;
async function bkCareerAuth(){
 const client=bkCareerClient();if(!client)return {client:null,user:null};
 try{return {client,user:await window.bkAuthenticatedUser()}}catch{return {client,user:null}}
}
function bkRankMarkup(total){
 const rank=bkRankFor(total),idx=bkRankTiers.indexOf(rank),next=bkRankTiers[idx+1];
 const pct=next?Math.min(100,100*(total-rank.min)/(next.min-rank.min)):100;
 return '<section class="bk-rank-card"><div class="bk-rank-eyebrow">Unique MLB players · Account only</div><div class="bk-rank-title">'+rank.icon+' '+rank.name+'</div><div class="bk-rank-meta">'+total.toLocaleString()+' unique players named'+(next?' · '+(next.min-total).toLocaleString()+' to '+next.name:' · Highest rank unlocked')+'</div><div class="bk-rank-track"><div class="bk-rank-fill" style="width:'+pct+'%"></div></div><div class="bk-rank-grid">'+bkRankTiers.map(t=>'<div class="bk-rank-tier '+(total>=t.min?'earned':'')+'"><b>'+t.icon+' '+t.name+'</b>'+t.min.toLocaleString()+'+</div>').join('')+'</div><p class="bk-rank-meta" style="margin-top:12px">'+safe(bkCareerStatus)+'</p></section>';
}
function bkDrawCareer(){const root=document.getElementById('bk-career-profile');if(root)root.innerHTML=bkCareerUser?bkRankMarkup(bkCareerTotal):'<section class="bk-rank-card"><div class="bk-rank-eyebrow">Career badges · Account only</div><div class="bk-rank-title">Unlock your rank</div><p class="bk-rank-meta">Sign in or create an account to earn badges for unique MLB players. Guest answers do not count.</p></section>'}
async function bkRefreshCareer(){ /* Career ranking temporarily disabled. */ }
async function bkCreditAnswer(playerId){
 // Unique player progress is credited from verified completed games via record_career_game.
 // Do not write a separate duplicate event for each answer.
}
window.bkRefreshCareer=bkRefreshCareer;
document.getElementById('bk-profile-trigger')?.addEventListener('click',()=>setTimeout(bkRefreshCareer,0));
function getScores(){try{return JSON.parse(localStorage.getItem('bk_scores_v1')||'[]')}catch{return []}}
function saveScores(rows){try{localStorage.setItem('bk_scores_v1',JSON.stringify(rows.slice(-200)))}catch{}}
async function bkRecordGlobalGame(g){
 const userId=window.bkActiveUserId;
 if(!userId)return 'Guest score saved on this device. Sign in for account-linked games.';
 const client=window.bkSharedClient?.();
 if(!client)throw new Error('Supabase is unavailable.');
 const verified=await window.bkAuthenticatedUser();
 if(!verified||verified.id!==userId||window.bkActiveUserId!==userId)throw new Error('Account session was not verified.');
 const humanName=g.people[0]?.name;
 const humanIds=g.history.filter(h=>h.by===humanName&&!(g.mode==='cpu'&&h.by==='Computer')).map(h=>h.player?.id).filter(Boolean);
 const {error}=await client.rpc('record_career_game',{p_mode:g.mode,p_score:humanIds.length,p_player_ids:humanIds});
 if(error)throw error;
 return '✓ Your '+(g.mode==='cpu'?'versus-computer':'solo')+' score is saved to your account.';
}
function bkShowRecentAccountGames(){
 const root=document.getElementById('bk-account-recent-games');
 const accountId=window.bkActiveUserId;
 if(!root||!accountId)return;
 (async()=>{
  try{
   const user=await window.bkAuthenticatedUser();
   if(!user||user.id!==accountId)throw new Error('Sign in again to load scores.');
   const client=window.bkSharedClient?.();
   if(!client)throw new Error('Supabase is unavailable.');
   const {data,error}=await client.from('bk_game_results')
     .select('mode,score,played_at').order('played_at',{ascending:false}).limit(10);
   if(error)throw error;
   if(!root.isConnected||window.bkActiveUserId!==accountId)return;
   root.innerHTML=data?.length?'<ol class="history">'+data.map(g=>
     '<li><span>'+safe(g.mode==='cpu'?'Versus Computer':'Solo')+
     ' <small>· '+safe(new Date(g.played_at).toLocaleDateString())+
     '</small></span><b>'+Number(g.score)+' answers</b></li>'
   ).join('')+'</ol>':'<p class="small">No saved solo or computer games yet.</p>';
  }catch(err){
   if(root.isConnected&&window.bkActiveUserId===accountId){
    root.textContent='Could not load account scores. Refresh or sign in again.';
    console.warn('Account game history:',err?.message||err);
   }
  }
 })();
}
function stopTimer(){if(ticker)clearInterval(ticker);ticker=null}

/* Daily challenge engine. All dates use UTC so everyone gets the same letter.
   Scores are stored on this device; account-synced scores require a future backend. */
const bkDailyLetters=['M','S','A','J','B','C','D','R','T','P','L','E','K','F','G','H','N','W','O','V'];
let bkDailyRound=null,bkDailyTicker=null;
const bkDailyToday=()=>new Date().toISOString().slice(0,10);
function bkDailyDate(offset=0){const d=new Date(bkDailyToday()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)}
function bkDailyLetter(day){const number=Math.floor(Date.parse(day+'T00:00:00Z')/86400000);return bkDailyLetters[((number%bkDailyLetters.length)+bkDailyLetters.length)%bkDailyLetters.length]}
function bkDailyTitle(day){return new Date(day+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}
function bkDailyScope(){return window.bkActiveUserId?'account_'+window.bkActiveUserId:'guest'}
function bkDailyKey(day){return 'bk_letter_daily_v2_'+bkDailyScope()+'_'+day}
function bkDailyRead(day){
 try{const row=JSON.parse(localStorage.getItem(bkDailyKey(day))||'null');if(!row||!Array.isArray(row.answers))return null;
 if(!row.completed&&Number.isFinite(row.deadline)&&Date.now()>=row.deadline){row.completed=true;bkDailySave(day,row)}
 return row;
 }catch{return null}
}
function bkDailySave(day,row){try{localStorage.setItem(bkDailyKey(day),JSON.stringify(row))}catch{}}

/* Account-linked daily attempts use server-timed Supabase RPCs.
   The SQL migration lives at supabase/daily_challenge_account_sync.sql.
   Guests retain browser-only practice and daily results. */
let bkDailyRequestSerial=0;
function bkDailyRemoteToLocal(row){
 const ends=Date.parse(row.ends_at);
 return {deadline:ends,answers:Array.isArray(row.answers)?row.answers:[],
  completed:!!row.completed_at||Date.now()>=ends,server:true};
}
function bkDailyStoreRemote(row){
 if(!row||!row.challenge_date)return null;
 const local=bkDailyRemoteToLocal(row);
 bkDailySave(row.challenge_date,local);
 return local;
}
async function bkDailyRefreshAccount(){
 if(!window.bkActiveUserId)return null;
 const auth=await window.bkAuthenticatedUser().catch(()=>null);
 if(!auth||auth.id!==window.bkActiveUserId)return null;
 const client=window.bkSharedClient();
 if(!client)return null;
 const day=bkDailyToday();
 const {data,error}=await client.from('bk_daily_attempts').select('*').eq('challenge_date',day).maybeSingle();
 if(error){console.warn('Ball Knowledge daily account load:',error.message);return null}
 if(data)return bkDailyStoreRemote(data);
 try{localStorage.removeItem(bkDailyKey(day))}catch{}
 return null;
}
async function bkDailyFetchAccountArchive(){
 if(!window.bkActiveUserId)return;
 const auth=await window.bkAuthenticatedUser().catch(()=>null);
 if(!auth||auth.id!==window.bkActiveUserId)return;
 const client=window.bkSharedClient();
 if(!client)return;
 const {data,error}=await client.from('bk_daily_attempts').select('*')
  .gte('challenge_date',bkDailyDate(-364)).lte('challenge_date',bkDailyToday());
 if(error){console.warn('Daily archive account load:',error.message);return}
 for(const row of data||[])bkDailyStoreRemote(row);
}
function bkDailySyncError(error){
 const raw=error?.message||'Unable to connect to your account.';
 if(error?.code==='42501'&&/permission denied for function bk_daily_/i.test(raw))return 'Supabase rejected the Daily Challenge request as unauthorized. Your browser session may be stale. Reopen Sign in and authenticate again; do not clear Safari website data.';
 if(/schema cache|PGRST202|PGRST205|does not exist|undefined function|undefined table/i.test(raw))return 'Daily Challenge service unavailable ('+(error?.code||'database error')+'). Please retry or contact support. Detail: '+raw;
 return raw;
}

function bkDailyPromptKey(){return 'bk_letter_prompt_v2_'+bkDailyScope()+'_'+bkDailyToday()}
function bkDailyDismiss(markSeen=true){const overlay=document.getElementById('bk-daily-overlay');if(overlay)overlay.remove();if(markSeen)try{localStorage.setItem(bkDailyPromptKey(),'1')}catch{}}
function bkDailyStop(){bkDailyRequestSerial++;if(bkDailyTicker){clearInterval(bkDailyTicker);bkDailyTicker=null}bkDailyRound=null;bkDailyDismiss(false)}

function bkDailyMilestones(){
 let streak=0,played=0,best=0,total=0;
 for(let i=0;i<365;i++){
  const d=bkDailyDate(-i),r=bkDailyRead(d);
  if(r?.completed){played++;const score=r.answers.length;best=Math.max(best,score);total+=score;}
 }
 for(let i=0;i<365;i++){
  const r=bkDailyRead(bkDailyDate(-i));
  if(i===0&&!r?.completed)continue;
  if(!r?.completed)break;
  streak++;
 }
 return {streak,played,best,average:played?(total/played).toFixed(1):'—'};
}
function bkDailyCountdown(){
 const n=Date.now(),seconds=Math.max(0,Math.floor((Math.ceil((n+1)/86400000)*86400000-n)/1000));
 return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(x=>String(x).padStart(2,'0')).join(':');
}
let bkDailyHistoryLoadedFor=null,bkDailyHistoryLoadingFor=null;
function bkDailyRefreshWidgets(){
 const stats=bkDailyMilestones();
 document.querySelectorAll('.bk-next-reset').forEach(el=>el.textContent='Next challenge in '+bkDailyCountdown()+' (UTC)');
 document.querySelectorAll('[data-bk-daily-streak]').forEach(el=>el.textContent='🔥 '+stats.streak+' day streak');
 document.querySelectorAll('[data-bk-daily-best]').forEach(el=>el.textContent='🏆 Best '+stats.best);
}
setInterval(bkDailyRefreshWidgets,1000);
function bkDailyLoadHistoryOnMenu(){
 const user=window.bkActiveUserId;
 if(!user||bkDailyHistoryLoadedFor===user||bkDailyHistoryLoadingFor===user)return;
 bkDailyHistoryLoadingFor=user;
 bkDailyFetchAccountArchive().then(()=>{
  if(window.bkActiveUserId===user){bkDailyHistoryLoadedFor=user;bkDailyRefreshWidgets()}
 }).catch(e=>console.warn('Daily history load:',e)).finally(()=>{if(bkDailyHistoryLoadingFor===user)bkDailyHistoryLoadingFor=null});
}
function bkDailyFeatureMarkup(){
 const day=bkDailyToday(),r=bkDailyRead(day),st=bkDailyMilestones();
 const action=r?.completed?'SEE TODAY’S RESULTS':r?'CONTINUE CHALLENGE':'PLAY TODAY’S CHALLENGE';
 return '<section class="bk-daily-feature bk-v2-hero"><div class="bk-daily-eyebrow">⚾ DAILY MLB CHALLENGE</div><h2>KNOW BALL? <em>PROVE IT.</em></h2><p>Name as many MLB players as you can in two minutes. One letter, one scored attempt each day.</p><div class="bk-v2-letter"><small>TODAY’S LETTER</small><strong>'+bkDailyLetter(day)+'</strong></div><button type="button" class="primary" id="bk-daily-feature-play">'+action+' →</button><div class="bk-v2-metrics"><span data-bk-daily-streak>🔥 '+st.streak+' day streak</span><span data-bk-daily-best>🏆 Best '+st.best+'</span></div><p class="bk-next-reset">Next challenge in '+bkDailyCountdown()+' (UTC)</p><div class="actions"><button type="button" class="secondary" id="bk-daily-feature-archive">Past challenges & stats</button>'+(r?.completed&&!window.bkActiveUserId?'<button type="button" class="secondary" id="bk-daily-feature-practice">Practice today</button>':'')+'</div></section>';
}
function bkDailyMaybePrompt(){
 if(window.bkTeamSetupBusy?.())return;
 const day=bkDailyToday(),row=bkDailyRead(day);
 try{if(localStorage.getItem(bkDailyPromptKey())==='1')return}catch{}
 if(row?.completed)return;
 bkDailyDismiss(false);
 const overlay=document.createElement('div');overlay.id='bk-daily-overlay';overlay.className='bk-daily-overlay';
 overlay.setAttribute('role','presentation');
 overlay.innerHTML='<section class="bk-daily-dialog" role="dialog" aria-modal="true" aria-labelledby="bk-daily-dialog-title"><button type="button" class="bk-daily-close" id="bk-daily-close" aria-label="Dismiss daily challenge">×</button><div class="bk-daily-eyebrow">Your MLB daily challenge</div><h2 id="bk-daily-dialog-title">Letter of the Day</h2><div class="bk-daily-letter">'+bkDailyLetter(day)+'</div><p>Name as many MLB players whose <b>first name</b> starts with '+bkDailyLetter(day)+' as possible in <b>2 minutes</b>.</p><p style="font-size:13px">One scored attempt today. Past letters are replayable any time.</p><div class="actions" style="justify-content:center"><button class="primary" id="bk-daily-prompt-play">'+(row?'Resume Challenge':'Play Today')+'</button><button class="secondary" id="bk-daily-prompt-skip">Not now</button></div></section>';
 document.body.appendChild(overlay);
 overlay.querySelector('#bk-daily-close').onclick=()=>{bkDailyDismiss();menu()};
 overlay.querySelector('#bk-daily-prompt-skip').onclick=()=>{bkDailyDismiss();menu()};
 overlay.querySelector('#bk-daily-prompt-play').onclick=()=>{bkDailyDismiss();bkDailyOpen(day,false)};
 overlay.addEventListener('click',e=>{if(e.target===overlay){bkDailyDismiss();menu()}});
}
function bkDailyWaitFor(promise,label){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timed out after 12 seconds. Check Safari Network for the failed or pending Supabase request.')),12000))])}
async function bkDailyOpen(day,practice){
 bkDailyStop();
 const serial=bkDailyRequestSerial,isToday=day===bkDailyToday();
 if(!isToday)practice=true;
 if(isToday&&!practice&&window.bkActiveUserId){
  app.innerHTML='<section class="panel"><h2>Loading your Daily Challenge…</h2><p>Checking your account and two-minute timer.</p><button type="button" class="secondary" id="bk-daily-loading-back">← Game modes</button></section>';
  app.querySelector('#bk-daily-loading-back').onclick=menu;
  let auth;
  try{const sessionResult=await bkDailyWaitFor(window.bkSharedClient().auth.getSession(),'Session lookup');if(sessionResult.error)throw sessionResult.error;auth=sessionResult.data?.session?.user||null}catch(e){if(serial===bkDailyRequestSerial)bkDailyServerFailure(day,'Account verification failed: '+(e?.message||String(e)));return}
  if(serial!==bkDailyRequestSerial)return;
  const client=window.bkSharedClient();
  if(!auth||!client){bkDailyServerFailure(day,'No verified Supabase session. Sign in to your existing account again.');return}
  if(auth.id!==window.bkActiveUserId){bkDailyServerFailure(day,'Account changed while this page was open. Refresh the game page and try again.');return}
  try{
   const {data,error}=await bkDailyWaitFor(client.rpc('bk_daily_begin',{p_day:day}),'Daily Challenge sync');
   if(serial!==bkDailyRequestSerial)return;
   if(error||!data)throw error||new Error('Could not create daily attempt');
   const local=bkDailyStoreRemote(data);
   if(local.completed){bkDailyResults(day,local,false);return}
   bkDailyRound={day,practice:false,letter:bkDailyLetter(day),deadline:local.deadline,answers:local.answers.slice(),server:true};
   bkDailyRenderGame();
  }catch(error){if(serial===bkDailyRequestSerial)bkDailyServerFailure(day,bkDailySyncError(error))}
  return;
 }
 if(isToday&&!practice){
  const saved=bkDailyRead(day);
  if(saved?.completed){bkDailyResults(day,saved,false);return}
  bkDailyRound=saved&&Number.isFinite(saved.deadline)?{day,practice:false,letter:bkDailyLetter(day),deadline:saved.deadline,answers:saved.answers.slice()}:null;
  if(!bkDailyRound){bkDailyRound={day,practice:false,letter:bkDailyLetter(day),deadline:Date.now()+120000,answers:[]};bkDailySave(day,{deadline:bkDailyRound.deadline,answers:[],completed:false})}
 }else bkDailyRound={day,practice:true,letter:bkDailyLetter(day),deadline:Date.now()+120000,answers:[]};
 bkDailyRenderGame();
}
function bkDailyServerFailure(day,reason){
 app.innerHTML='<section class="panel"><h2>Daily Challenge account sync</h2><p id="bk-daily-server-error" role="alert"></p><p>Your scored attempt has not started. You can retry after the connection is fixed, or play an unscored practice round.</p><div class="actions"><button class="primary" id="bk-daily-server-retry">Retry account sync</button><button class="secondary" id="bk-daily-server-practice">Practice instead</button><button class="secondary" id="bk-daily-server-back">Game modes</button></div></section>';
 app.querySelector('#bk-daily-server-error').textContent=reason;
 app.querySelector('#bk-daily-server-retry').onclick=()=>bkDailyOpen(day,false);
 app.querySelector('#bk-daily-server-practice').onclick=()=>bkDailyOpen(day,true);
 app.querySelector('#bk-daily-server-back').onclick=menu;
}

function bkDailyRenderGame(){
 const round=bkDailyRound;if(!round)return;
 if(Date.now()>=round.deadline){bkDailyFinish();return}
 app.innerHTML='<section class="panel"><div class="bk-daily-toolbar"><span class="tag">⚾ '+(round.practice?'ARCHIVE PRACTICE':'TODAY\'S CHALLENGE')+'</span><button class="secondary" id="bk-daily-exit">← Game modes</button></div><h2 style="margin-top:16px">Letter of the Day · '+safe(bkDailyTitle(round.day))+'</h2><div class="bk-daily-letter">'+round.letter+'</div><p>Name as many MLB players whose <b>first name</b> starts with '+round.letter+' as you can. No repeats.</p><div class="stats"><div class="stat"><b id="bk-daily-score">'+round.answers.length+'</b><span>Correct names</span></div><div class="stat"><b id="bk-daily-clock" class="timer">2:00</b><span>Time remaining</span></div></div><div class="bk-daily-answer-row"><input id="bk-daily-name" type="text" aria-label="MLB player full name" placeholder="Type an MLB player’s full name…" autocomplete="off" autocapitalize="words" spellcheck="false"><button class="primary" id="bk-daily-submit">Submit</button></div><p id="bk-daily-feedback" role="status" class="bk-feedback"></p><h3>Players named</h3><div class="bk-daily-history" id="bk-daily-history"></div><p style="font-size:12px;color:var(--muted)">'+(round.practice?'Practice run · does not replace your daily score':round.server?'Your two-minute attempt and every accepted answer are saved to your signed-in account.':'Your daily attempt continues counting down if you leave. Guest progress is saved on this browser.')+'</p></section>';
 app.querySelector('#bk-daily-exit').onclick=()=>{bkDailyStop();menu()};
 app.querySelector('#bk-daily-submit').onclick=bkDailySubmit;
 app.querySelector('#bk-daily-name').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();bkDailySubmit()}};
 bkDailyDrawHistory();bkDailyTick();bkDailyTicker=setInterval(bkDailyTick,200);
 app.querySelector('#bk-daily-name').focus();
}
function bkDailyDrawHistory(){const r=bkDailyRound;if(!r)return;const el=app.querySelector('#bk-daily-history');if(el)el.innerHTML=r.answers.map(a=>'<span>'+safe(a.name)+'</span>').join('')||'<span style="color:var(--muted)">No players entered yet</span>';const score=app.querySelector('#bk-daily-score');if(score)score.textContent=r.answers.length}

function bkDailyTick(){
 const r=bkDailyRound;if(!r)return;
 const remaining=r.deadline-Date.now(),seconds=Math.max(0,Math.ceil(remaining/1000)),timer=app.querySelector('#bk-daily-clock');
 if(timer)timer.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
 if(remaining<=0&&!r.submitting)bkDailyFinish();
}
async function bkDailyAccept(player,corrected){
 const r=bkDailyRound,input=app.querySelector('#bk-daily-name'),feedback=app.querySelector('#bk-daily-feedback'),button=app.querySelector('#bk-daily-submit');
 if(!r||r.submitting||!input||!feedback||r.answers.some(a=>a.id===player.id))return;
 if(Date.now()>=r.deadline){bkDailyFinish();return}
 r.submitting=true;button.disabled=true;input.disabled=true;
 const original=feedback.textContent;
 feedback.textContent=r.server?'Saving answer to your account…':'Checking answer…';
 try{
  if(r.server){
   const client=window.bkSharedClient();
   const {data,error}=await client.rpc('bk_daily_answer',{
    p_day:r.day,p_player_id:player.id,p_player_name:player.name,p_first_name:player.first
   });
   if(error||!data)throw error||new Error('Could not save answer');
   if(bkDailyRound!==r)return;
   const remote=bkDailyStoreRemote(Array.isArray(data)?data[0]:data);
   r.answers=remote.answers.slice();
  }else{
   r.answers.push({id:player.id,name:player.name});
   if(!r.practice)bkDailySave(r.day,{deadline:r.deadline,answers:r.answers,completed:false});
  }
  if(bkDailyRound!==r)return;
  feedback.textContent='✓ '+player.name+' accepted'+(corrected?' (spelling corrected)':'')+'!';
  bkShowFeedback(true);
  input.value='';
  bkDailyDrawHistory();
 }catch(error){
  if(bkDailyRound!==r)return;
  feedback.textContent='Could not save: '+bkDailySyncError(error)+' Try again.';
  console.warn('Ball Knowledge daily answer sync:',error);
 }finally{
  if(bkDailyRound===r){
   r.submitting=false;button.disabled=false;input.disabled=false;
   if(Date.now()>=r.deadline)bkDailyFinish();else input.focus();
  }
 }
}
function bkDailySubmit(){
 const r=bkDailyRound,input=app.querySelector('#bk-daily-name'),feedback=app.querySelector('#bk-daily-feedback');
 if(!r||!input||!feedback||r.submitting)return;
 if(Date.now()>=r.deadline){bkDailyFinish();return}
 const entered=input.value.trim(),matches=byName.get(norm(entered))||[];
 const used=new Set(r.answers.map(a=>a.id));
 const player=matches.find(p=>initial(p.first)===r.letter&&!used.has(p.id));
 if(!entered){feedback.textContent='Enter a player name.';return}
 if(player){bkDailyAccept(player,false);return}
 if(!matches.length){
  const suggestions=bkSpellingMatches(entered,r.letter,used);
  if(suggestions.length===1){bkDailyAccept(suggestions[0].player,true);return}
  if(suggestions.length>1){
   bkSpellingChoices(feedback,suggestions,player=>{input.value=player.name;bkDailySubmit()});
   input.focus();return;
  }else feedback.textContent='That name is not in the MLB player database.';
 }else if(matches.some(p=>initial(p.first)===r.letter)){
  feedback.textContent='Already used that player.';
 }else feedback.textContent='That player’s first name must start with '+r.letter+'.';
 bkShowFeedback(false);
 input.focus();
}
function bkDailyFinish(){
 const r=bkDailyRound;if(!r||r.submitting)return;
 if(bkDailyTicker){clearInterval(bkDailyTicker);bkDailyTicker=null}
 const result={deadline:r.deadline,answers:r.answers,completed:true,server:!!r.server};
 if(!r.practice)bkDailySave(r.day,result);
 else{try{const k='bk_letter_practice_best_v2_'+bkDailyScope()+'_'+r.day;localStorage.setItem(k,String(Math.max(Number(localStorage.getItem(k)||0),r.answers.length)))}catch{}}
 bkDailyRound=null;bkDailyResults(r.day,result,r.practice);
 if(r.server){
  const client=window.bkSharedClient();
  if(!client)return;
  client.rpc('bk_daily_complete',{p_day:r.day}).then(({data,error})=>{
   const status=app.querySelector('#bk-daily-sync-note');
   if(error){console.warn('Could not finalize daily score:',error);if(status)status.textContent='Your accepted answers were saved, but final account confirmation is pending. Try refreshing.';return}
   bkDailyStoreRemote(Array.isArray(data)?data[0]:data);
   if(status)status.textContent='✓ Your daily challenge and results are saved to your account.';
  }).catch(error=>console.warn('Daily completion:',error));
 }
}

/* Hand-selected recognizable names; not a statistical popularity ranking. */
const bkDailyNotables={
 A:['Aaron Judge','Albert Pujols','Alex Rodriguez','Adrian Beltre','Andrew McCutchen','Al Kaline','Anthony Rizzo'],
 B:['Babe Ruth','Barry Bonds','Bryce Harper','Bob Gibson','Buster Posey','Bo Bichette','Bobby Witt Jr.'],
 C:['Cal Ripken','Clayton Kershaw','Carl Yastrzemski','CC Sabathia','Corey Seager','Carlos Correa','Chris Sale'],
 D:['David Ortiz','Derek Jeter','Darryl Strawberry','Don Mattingly','David Wright','Dwight Gooden'],
 E:['Eddie Murray','Ernie Banks','Eddie Mathews','Edgar Martinez','Evan Longoria','Eric Davis'],
 F:['Frank Thomas','Freddie Freeman','Fernando Tatis Jr.','Felix Hernandez','Francisco Lindor'],
 G:['Greg Maddux','George Brett','Gary Sheffield','Giancarlo Stanton','Gerrit Cole','Goose Gossage'],
 H:['Hank Aaron','Honus Wagner','Hideki Matsui','Hunter Pence','Harmon Killebrew'],
 J:['Jackie Robinson','Justin Verlander','Juan Soto','Jose Altuve','Joe DiMaggio','Jacob deGrom','Julio Rodriguez'],
 K:['Ken Griffey Jr.','Kyle Schwarber','Kris Bryant','Keith Hernandez','Kevin Gausman'],
 L:['Lou Gehrig','Luis Arraez','Lance Berkman','Larry Walker','Luis Robert'],
 M:['Mike Trout','Mookie Betts','Manny Machado','Miguel Cabrera','Max Scherzer','Mariano Rivera','Mark McGwire','Matt Olson'],
 N:['Nolan Ryan','Nelson Cruz','Nick Castellanos','Nico Hoerner','Nomar Garciaparra'],
 O:['Ozzie Smith','Orlando Cepeda','Oscar Charleston','Omar Vizquel','Oneil Cruz'],
 P:['Pete Rose','Pedro Martinez','Paul Goldschmidt','Prince Fielder','Paul Skenes'],
 R:['Randy Johnson','Rickey Henderson','Ronald Acuna Jr.','Roberto Clemente','Roger Clemens','Rafael Devers'],
 S:['Shohei Ohtani','Sammy Sosa','Sandy Koufax','Stan Musial','Stephen Strasburg','Steve Carlton','Satchel Paige','Salvador Perez'],
 T:['Ted Williams','Tony Gwynn','Trea Turner','Tim Lincecum','Trevor Hoffman','Tom Seaver'],
 V:['Vladimir Guerrero','Vladimir Guerrero Jr.','Victor Martinez','Vinnie Pasquantino','Vida Blue'],
 W:['Willie Mays','Walter Johnson','Wade Boggs','Willie McCovey','Wander Franco'],
};
function bkDailyEligibleMissed(day,answers){
 const letter=bkDailyLetter(day),used=new Set((answers||[]).map(a=>a.id)),usedNames=new Set((answers||[]).map(a=>norm(a.name)));
 const seen=new Set();
 return players.filter(p=>{if(initial(p.first)!==letter||used.has(p.id)||usedNames.has(p.key)||seen.has(p.key))return false;seen.add(p.key);return true})
  .sort((a,b)=>a.name.localeCompare(b.name));
}
function bkDailyShowMissed(day,answers){
 const existing=document.getElementById('bk-daily-missed-overlay');if(existing)existing.remove();
 const missed=bkDailyEligibleMissed(day,answers),missedIds=new Set(missed.map(p=>p.id));
 const notables=[];const seen=new Set();
 for(const name of bkDailyNotables[bkDailyLetter(day)]||[]){
  const found=(byName.get(norm(name))||[]).find(p=>missedIds.has(p.id));
  if(found&&!seen.has(found.key)){notables.push(found);seen.add(found.key)}
 }
 const overlay=document.createElement('div');
 overlay.id='bk-daily-missed-overlay';overlay.className='bk-daily-missed-overlay';
 overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="bk-missed-title" class="bk-daily-missed-dialog"><div class="bk-daily-missed-head"><div><div class="bk-daily-eyebrow">⚾ Review your challenge</div><h2 id="bk-missed-title">See who you missed · '+bkDailyLetter(day)+'</h2><p class="bk-missed-count">'+missed.length.toLocaleString()+' eligible players remaining</p></div><button type="button" id="bk-missed-close" aria-label="Close player list">×</button></div><div class="bk-daily-missed-controls"><button type="button" id="bk-missed-notable" aria-pressed="true">Recognizable names</button><button type="button" id="bk-missed-all" aria-pressed="false">All remaining players</button></div><input id="bk-daily-missed-search" type="search" placeholder="Search missed MLB players…" aria-label="Search missed players"><div class="bk-daily-missed-list" id="bk-missed-list"></div><button type="button" class="secondary" id="bk-daily-missed-more" hidden>Show more players</button><p class="bk-missed-count">Tap any player for career statistics and a Baseball-Reference link. Recognizable names are a hand-picked selection, not a popularity ranking.</p></section>';
 document.body.appendChild(overlay);
 const list=overlay.querySelector('#bk-missed-list'),search=overlay.querySelector('#bk-daily-missed-search');
 const more=overlay.querySelector('#bk-daily-missed-more'),notable=overlay.querySelector('#bk-missed-notable'),all=overlay.querySelector('#bk-missed-all');
 let view='notable',limit=60;
 function draw(){
  const q=norm(search.value),base=q?missed.filter(p=>p.key.includes(q)):(view==='notable'&&notables.length?notables:missed);
  list.innerHTML=base.slice(0,limit).map(p=>'<button type="button" class="bk-missed-player" data-bk-player="'+safe(p.id)+'"><span>'+safe(p.name)+'</span><small>Stats ↗</small></button>').join('')||'<p>No players match this search.</p>';
  more.hidden=base.length<=limit;
  notable.setAttribute('aria-pressed',String(view==='notable'));
  all.setAttribute('aria-pressed',String(view==='all'));
  overlay.querySelector('.bk-missed-count').textContent=base.length.toLocaleString()+' '+(q?'matches':view==='notable'&&notables.length?'recognizable players':'eligible players');
 }
 function close(){overlay.remove()}
 overlay.querySelector('#bk-missed-close').onclick=close;
 overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
 list.addEventListener('click',e=>{const b=e.target.closest('[data-bk-player]');if(b)showPlayerInfo(b.dataset.bkPlayer)});
 notable.onclick=()=>{view='notable';search.value='';limit=60;draw()};
 all.onclick=()=>{view='all';search.value='';limit=60;draw()};
 more.onclick=()=>{limit+=60;draw()};
 search.oninput=()=>{limit=60;draw()};
 const onEscape=e=>{if(e.key==='Escape'&&document.getElementById('bk-player-modal').hidden){close();document.removeEventListener('keydown',onEscape)}};
 document.addEventListener('keydown',onEscape);
 draw();
 overlay.querySelector('#bk-missed-close').focus();
}
function bkDailyShareText(day,score,practice){
 const st=bkDailyMilestones();
 return '⚾ BALL KNOWLEDGE · '+(practice?'PRACTICE':'DAILY CHALLENGE')+'\n'+bkDailyTitle(day)+'\n'+score+' MLB players in 2 minutes'+(practice?'':'\n🔥 '+st.streak+' day streak')+'\nCan you beat my score?\nhttps://playballknowledge.github.io/';
}
async function bkDailyShareImage(day,score,practice){
 const st=bkDailyMilestones(),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 canvas.width=1080;canvas.height=1350;
 const g=ctx.createLinearGradient(0,0,1080,1350);g.addColorStop(0,'#214a34');g.addColorStop(1,'#06140d');
 ctx.fillStyle=g;ctx.fillRect(0,0,1080,1350);
 ctx.strokeStyle='#62e5a0';ctx.lineWidth=6;ctx.strokeRect(42,42,996,1266);
 ctx.textAlign='center';ctx.fillStyle='#6aeca7';ctx.font='bold 54px sans-serif';ctx.fillText('⚾  BALL KNOWLEDGE',540,172);
 ctx.fillStyle='#ffffff';ctx.font='bold 72px sans-serif';ctx.fillText(practice?'PRACTICE RUN':'DAILY CHALLENGE',540,330);
 ctx.fillStyle='#d7ecde';ctx.font='42px sans-serif';ctx.fillText(bkDailyTitle(day),540,403);
 ctx.fillStyle='#6aeca7';ctx.font='bold 310px sans-serif';ctx.fillText(String(score),540,800);
 ctx.fillStyle='#ffffff';ctx.font='bold 55px sans-serif';ctx.fillText('MLB PLAYERS NAMED',540,888);
 if(!practice){ctx.font='bold 44px sans-serif';ctx.fillText('🔥  '+st.streak+' DAY STREAK',540,975);}
 ctx.fillStyle='#d7ecde';ctx.font='45px sans-serif';ctx.fillText('CAN YOU BEAT MY SCORE?',540,1114);
 ctx.fillStyle='#6aeca7';ctx.font='bold 37px sans-serif';ctx.fillText('playballknowledge.github.io',540,1198);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob)throw new Error('Could not create image');
 const file=new File([blob],'ball-knowledge-'+day+'.png',{type:'image/png'});
 if(navigator.canShare?.({files:[file]})&&navigator.share){
  try{await navigator.share({files:[file],title:'Ball Knowledge',text:bkDailyShareText(day,score,practice)});return}catch(error){if(error.name==='AbortError')return}
 }
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function bkDailyResults(day,result,practice){
 const answers=Array.isArray(result.answers)?result.answers:[],score=answers.length,st=bkDailyMilestones();
 const syncText=practice?'Practice does not change your daily score.':window.bkActiveUserId?(result.server?'✓ Answers saved to your account.':'This result was saved locally; account sync is not confirmed.'):'Guest results are stored only on this browser.';
 app.innerHTML='<section class="panel" style="text-align:center"><div class="bk-daily-eyebrow">⚾ '+(practice?'Practice complete':'Daily Challenge complete')+'</div><div class="bk-result-card-v2"><h2>KNOW BALL? PROVE IT.</h2><p>'+safe(bkDailyTitle(day))+' · Letter '+bkDailyLetter(day)+'</p><div class="big-score">'+score+'</div><h3>MLB PLAYERS NAMED</h3><div class="bk-v2-statrow"><span>🔥 '+st.streak+' day streak</span><span>🏆 Personal best '+st.best+'</span><span>📅 '+st.played+' days</span></div><p class="bk-next-reset">Next challenge in '+bkDailyCountdown()+' (UTC)</p></div><div class="actions" style="justify-content:center;flex-wrap:wrap"><button type="button" class="primary" id="bk-daily-results-image">📲 Share result image</button><button type="button" class="secondary" id="bk-daily-results-copy">Copy challenge text</button></div><div class="actions" style="justify-content:center;flex-wrap:wrap"><button type="button" class="secondary" id="bk-daily-results-missed">🔎 See Who You Missed</button><button type="button" class="secondary" id="bk-daily-results-archive">Your stats & archive</button><button type="button" class="secondary" id="bk-daily-results-menu">Game modes</button>'+(practice?'<button type="button" class="secondary" id="bk-daily-results-retry">Play again</button>':(!window.bkActiveUserId&&day===bkDailyToday()?'<button type="button" class="secondary" id="bk-daily-results-retry">Practice again</button>':''))+'</div><h3 style="font-size:21px;margin:22px 0 6px">Players you named</h3><p style="font-size:13px">Tap a player to view their MLB career stats.</p><div class="bk-daily-history" id="bk-daily-result-players" style="justify-content:center">'+answers.map(a=>'<button type="button" class="bk-daily-player-button" data-bk-player="'+safe(a.id)+'">'+safe(a.name)+' ⓘ</button>').join('')+'</div><p id="bk-daily-sync-note" style="font-size:12px;color:var(--muted)">'+safe(syncText)+'</p></section>';
 app.querySelector('#bk-daily-results-menu').onclick=menu;
 app.querySelector('#bk-daily-results-archive').onclick=bkDailyArchive;
 app.querySelector('#bk-daily-results-missed').onclick=()=>bkDailyShowMissed(day,answers);
 app.querySelector('#bk-daily-result-players').addEventListener('click',e=>{const button=e.target.closest('[data-bk-player]');if(button)showPlayerInfo(button.dataset.bkPlayer)});
 app.querySelector('#bk-daily-results-image').onclick=()=>bkDailyShareImage(day,score,practice).catch(e=>{console.warn(e);alert('Unable to export image on this browser. Try Copy challenge text instead.')});
 app.querySelector('#bk-daily-results-copy').onclick=()=>{const text=bkDailyShareText(day,score,practice);if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>alert('Result copied!')).catch(()=>prompt('Copy your result:',text));else prompt('Copy your result:',text)};
 const retry=app.querySelector('#bk-daily-results-retry');if(retry)retry.onclick=()=>bkDailyOpen(day,true);
}

function bkDailyArchive(){
 bkDailyStop();bkDailyArchivePaint();
 if(window.bkActiveUserId)bkDailyFetchAccountArchive().then(()=>{if(app.querySelector('#bk-daily-archive-back'))bkDailyArchivePaint()}).catch(e=>console.warn('Daily archive:',e));
}
function bkDailyArchivePaint(){
 const days=Array.from({length:30},(_,i)=>bkDailyDate(-i-1)),st=bkDailyMilestones();
 const last28=Array.from({length:28},(_,i)=>bkDailyDate(i-27));
 app.innerHTML='<section class="panel"><button class="secondary" id="bk-daily-archive-back">← Game modes</button><h2 style="margin-top:16px">Your Daily Challenge stats</h2><p>Your daily progress and past 30 challenges. Account statistics load from your saved Supabase attempts when signed in.</p><div class="bk-v2-statrow"><span>🔥 Streak: '+st.streak+' days</span><span>🏆 Best: '+st.best+'</span><span>📅 Played: '+st.played+'</span><span>📈 Average: '+st.average+'</span></div><h3>Last 28 days</h3><div class="bk-v2-calendar">'+last28.map(day=>{const r=bkDailyRead(day),dateLabel=Number(day.slice(5,7))+'/'+Number(day.slice(8,10))+'/'+day.slice(0,4);return '<span title="'+dateLabel+(r?.completed?' · '+r.answers.length+' names':'')+'" class="'+(r?.completed?'played':'')+'">'+dateLabel+'</span>'}).join('')+'</div><h3 style="margin-top:22px">Previous challenges</h3><p>Replay earlier letters for practice without changing your official score.</p><div class="bk-daily-archive-list">'+days.map(day=>{let best='';try{const score=localStorage.getItem('bk_letter_practice_best_v2_'+bkDailyScope()+'_'+day);const official=bkDailyRead(day);best=score?'Practice best: '+score:official?.completed?'Original score: '+official.answers.length:'Not played'}catch{best='Practice'}return '<button type="button" data-bk-day="'+day+'"><b>'+safe(bkDailyTitle(day))+' · Letter '+bkDailyLetter(day)+'</b><small>'+safe(best)+' · Play →</small></button>'}).join('')+'</div></section>';
 app.querySelector('#bk-daily-archive-back').onclick=menu;
 app.querySelectorAll('[data-bk-day]').forEach(button=>button.onclick=()=>bkDailyOpen(button.dataset.bkDay,true));
}

function leagueMenu(){if(game&&!game.done)return;bkDailyStop();stopTimer();game=null;const privateRoot=document.getElementById('bk-private');if(privateRoot&&privateRoot.parentElement!==document.body)document.body.appendChild(privateRoot);app.innerHTML=`<section class="panel"><h2>Choose your league</h2><p>Test your sports knowledge. Select a league to start playing.</p><div class="bk-leagues"><button class="bk-league available" id="bk-mlb"><img class="bk-league-logo mlb" src="https://www.mlbstatic.com/team-logos/league-on-dark/1.svg" alt="MLB logo" loading="lazy" onerror="this.onerror=null;this.src='https://www.mlbstatic.com/team-logos/league/1.svg'">MLB<small>Play now →</small></button><button class="bk-league soon" disabled><img class="bk-league-logo nba" src="https://upload.wikimedia.org/wikipedia/en/0/03/National_Basketball_Association_logo.svg" alt="NBA logo" loading="lazy" onerror="this.style.display='none'">NBA<small>Coming soon</small></button><button class="bk-league soon" disabled><img class="bk-league-logo nfl" src="https://upload.wikimedia.org/wikipedia/en/a/a2/National_Football_League_logo.svg" alt="NFL logo" loading="lazy" onerror="this.style.display='none'">NFL<small>Coming soon</small></button></div></section>`;document.getElementById('bk-mlb').onclick=menu}
function menu(){bkDailyLoadHistoryOnMenu();bkDailyStop();if(mode==='compete')mode='solo';stopTimer();game=null;const privateRoot=document.getElementById('bk-private');if(privateRoot&&privateRoot.parentElement!==document.body)document.body.appendChild(privateRoot);app.innerHTML=`<section class="panel"><button class="secondary" id="bk-back-leagues" style="margin-bottom:18px">← All leagues</button><h2>⚾ MLB Baseball Games</h2>${bkDailyFeatureMarkup()}<h3 style="margin:25px 0 6px">More ways to play</h3><p style="font-size:13px">Build an MLB name chain. Each player’s first name must start with the previous player’s last-name initial.</p><div class="modes"><button class="mode ${mode==='solo'?'active':''}" data-mode="solo">🏆<br>Solo</button><button class="mode ${mode==='cpu'?'active':''}" data-mode="cpu">🤖<br>Versus Computer</button><button class="mode ${mode==='local'?'active':''}" data-mode="local">👥<br>Multiplayer</button><button class="mode" disabled aria-disabled="true" style="opacity:.48;cursor:not-allowed">🌐<br>Compete<small style="display:block;font-size:11px;margin-top:6px">Coming soon</small></button></div><div class="bk-mode-help" id="bk-mode-help"></div><div id="bk-standard-options" ${mode==='compete'?'hidden':''}><label>Time per turn</label><select id="duration">${[10,20,30,40,50,60].map(n=>`<option value="${n}" ${n===duration?'selected':''}>${n} seconds${n===20?' (default)':''}</option>`).join('')}</select><div id="playerSettings"></div><button class="primary" id="start" style="margin-top:20px">Start game →</button></div><div id="bk-compete-slot" ${mode==='compete'?'':'hidden'} style="margin-top:18px"></div></section>${window.bkActiveUserId?'<section class="panel"><h3 style="font-size:22px">Your recent games</h3><p class="small">Solo and versus-computer scores saved to your account.</p><div id="bk-account-recent-games" role="status">Loading account scores…</div></section>':''}`;bkShowRecentAccountGames();const competeSlot=document.getElementById("bk-compete-slot");if(privateRoot&&competeSlot)competeSlot.appendChild(privateRoot);if(privateRoot){privateRoot.hidden=mode!=='compete';if(mode==='compete'){privateRoot.style.display='block';privateRoot.style.pointerEvents='auto';}else privateRoot.style.display='none';}
app.querySelector('#bk-daily-feature-play').onclick=()=>bkDailyOpen(bkDailyToday(),false);app.querySelector('#bk-daily-feature-archive').onclick=bkDailyArchive;const guestPractice=app.querySelector('#bk-daily-feature-practice');if(guestPractice)guestPractice.onclick=()=>bkDailyOpen(bkDailyToday(),true);app.querySelector('#bk-back-leagues').onclick=leagueMenu;app.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;menu()});const help={solo:'<b>🏆 Solo</b><p>Play solo and build the longest MLB player-name chain you can. Each answer must follow the last-name letter rule. One wrong answer or an expired timer ends your run. Verified leaderboard scoring is coming soon.</p>',cpu:'<b>🤖 Versus Computer</b><p>Practice against the computer. Take turns naming valid MLB players without repeats. If you run out of time or answer incorrectly, you lose.</p>',local:'<b>👥 Multiplayer</b><p>Play with 2–8 people on the same device. Pass the device after each turn; the last player remaining wins.</p>',compete:'<b>🌐 Compete Online</b><p>Create a private room or join friends using a six-character invite code. Up to 12 players can play online.</p>'};app.querySelector('#bk-mode-help').innerHTML=help[mode];const durationSelect=app.querySelector('#duration');if(durationSelect)durationSelect.onchange=e=>{duration=+e.target.value};const startButton=app.querySelector('#start');if(startButton)startButton.onclick=start;renderSettings()}
function renderSettings(){if(mode==='compete')return;let root=document.getElementById('playerSettings');root.innerHTML=`${mode==='local'?`<label>Players (2–8)</label><select id="count">${Array.from({length:7},(_,i)=>i+2).map(n=>`<option ${n===count?'selected':''}>${n}</option>`).join('')}</select>`:''}<label>${mode==='local'?'Player names':'Your name'}</label><div id="names"></div>`;if(mode==='local')root.querySelector('#count').onchange=e=>{count=+e.target.value;renderNames()};renderNames()}
function renderNames(){let n=mode==='local'?count:1;document.getElementById('names').innerHTML=Array.from({length:n},(_,i)=>`<input style="margin:5px 0" maxlength="24" class="profileName" value="${safe(i===0&&mode!=='local'&&window.bkAccountUsername?window.bkAccountUsername:(profiles[i]||'Player '+(i+1)))}" aria-label="Player ${i+1} name">`).join('')}
function showScores(){let rows=getScores().sort((a,b)=>b.chain-a.chain).slice(0,10);if(!document.getElementById('scores'))return;document.getElementById('scores').innerHTML=rows.length?`<ol class="history">${rows.map(r=>`<li><span>${safe(r.name)} <small>· ${safe(r.mode)}</small></span><b>${r.chain} answers</b></li>`).join('')}</ol>`:'<p>No games played yet. Be the first!</p>'}
function start(){const privateRoot=document.getElementById('bk-private');if(privateRoot&&privateRoot.parentElement!==document.body)document.body.appendChild(privateRoot);profiles=Array.from(document.querySelectorAll('.profileName')).map((x,i)=>x.value.trim()||'Player '+(i+1));if(window.bkAccountUsername&&mode!=='local')profiles[0]=window.bkAccountUsername;let names=mode==='local'?profiles.slice():mode==='cpu'?[profiles[0],'Computer']:[profiles[0]];game={mode,duration,people:names.map(n=>({name:n,alive:true,answers:0})),turn:0,used:new Set(),history:[],last:null,endsAt:0,done:false};selected=null;renderGame();beginTurn()}
function current(){return game.people[game.turn]}
function renderGame(){if(!game||game.done)return;let g=game,p=current(),letter=g.last?initial(g.last.last):null;app.innerHTML=`<section class="panel"><div class="row"><span class="tag">${g.mode==='solo'?'RANKED':g.mode==='cpu'?'TRAINING':'MULTIPLAYER'}</span><button class="secondary" id="quit">End game</button></div><div class="stats"><div class="stat"><b>${g.history.length}</b><span>Valid answers</span></div><div class="stat"><b id="clock" class="timer">${g.duration}</b><span>Seconds left</span></div></div><div class="center"><p style="margin:5px">${safe(p.name)}'s turn</p>${g.last?`<p>Last player: <b style="color:white">${safe(g.last.name)}</b></p><div class="letter">${letter}</div><p>Next first name must start with ${letter}</p>`:`<div class="letter">ANY</div><p>Choose any MLB player to begin</p>`}</div><label>Enter MLB player</label><input id="answer" autocomplete="off" autocapitalize="words" placeholder="Type a full MLB player name…" aria-label="Player name"><div id="message"></div><button type="button" class="primary" id="submit" style="margin-top:12px">Submit answer</button><div class="actions"><button class="secondary" id="giveup">${g.mode==='solo'?'Finish run':'Give up / Eliminate'}</button></div><div class="players">${g.people.map((q,i)=>`<span class="playerchip ${q.alive?'':'out'}">${i===g.turn?'▶ ':''}${safe(q.name)} · ${q.answers}</span>`).join('')}</div></section><section class="panel"><h2 style="font-size:18px">Answer history</h2><ol class="history">${g.history.slice().reverse().map(h=>`<li><span>${safe(h.player.name)}</span><small>${safe(h.by)}</small></li>`).join('')||'<li>No answers yet</li>'}</ol></section>`;document.getElementById('quit').onclick=()=>finish('Game ended',true);document.getElementById('giveup').onclick=()=>eliminate('Gave up');document.getElementById('submit').onclick=e=>{e.preventDefault();submit()};let input=document.getElementById('answer');input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit()}};if(g.mode!=='cpu'||g.turn===0)input.focus()}
function message(s,bad=false){let el=document.getElementById('message');if(el)el.innerHTML=`<div class="notice ${bad?'bad':''}">${safe(s)}</div>`}

/* Daily player follows the visitor's local calendar date. */
function bkLocalDay(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function bkDailyPlayer(){
 if(!players.length)return null;
 const day=bkLocalDay();
 let hash=2166136261;
 for(const c of day){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)}
 return players[(hash>>>0)%players.length];
}
async function bkRenderDaily(id){
 const root=document.getElementById(id),p=bkDailyPlayer();if(!root||!p)return;
 const today=new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
 root.innerHTML='<section class="bk-daily"><span class="bk-daily-label">✦ Player of the day · '+safe(today)+'</span><div class="bk-daily-main"><div class="bk-daily-photo" aria-hidden="true"></div><div><div class="bk-daily-name">'+safe(p.name)+'</div><p class="bk-daily-desc">From the Ball Knowledge MLB player database</p></div></div><div class="bk-daily-stats"><div class="bk-daily-stat"><b>—</b><small>GAMES</small></div><div class="bk-daily-stat"><b>—</b><small>STAT</small></div><div class="bk-daily-stat"><b>—</b><small>STAT</small></div></div><p class="bk-daily-desc">Loading career stats…</p></section>';
 const card=root.querySelector('.bk-daily');try{
  const info=await bkLoadPlayer(p);if(!root.isConnected||root.querySelector('.bk-daily')!==card)return;
  const photo=card.querySelector('.bk-daily-photo');
  if(info.mlbId){
   const img=document.createElement('img');img.className='bk-daily-photo';img.alt=p.name+' headshot';
   img.src='https://img.mlbstatic.com/mlb-photos/image/upload/w_200,q_auto:good/v1/people/'+encodeURIComponent(info.mlbId)+'/headshot/67/current';
   img.onerror=()=>{img.replaceWith(document.createElement('div'))};
   photo.replaceWith(img);
  }
  const st=info.hitting||info.pitching;
  const fields=info.hitting?[['G','gamesPlayed'],['HR','homeRuns'],['AVG','avg'],['H','hits'],['RBI','rbi'],['SB','stolenBases']]:[['G','gamesPlayed'],['W','wins'],['ERA','era'],['SO','strikeOuts'],['SV','saves'],['WHIP','whip']];
  const usable=st?fields.filter(([,key])=>st[key]!==undefined&&st[key]!==null).slice(0,6):[];
  card.querySelector('.bk-daily-stats').innerHTML=usable.map(([label,key])=>'<div class="bk-daily-stat"><b>'+safe(st[key])+'</b><small>'+label+'</small></div>').join('')||'<div class="bk-daily-stat" style="grid-column:1/-1"><b>—</b><small>CAREER STATS NOT AVAILABLE</small></div>';
  card.querySelector('.bk-daily-desc:last-child').textContent=info.prizes.length?'Awards: '+info.prizes.slice(0,3).join(' · '):'Career stats from MLB Stats API';
  const a=document.createElement('button');a.className='secondary';a.type='button';a.style.marginTop='12px';a.textContent='View player details →';a.onclick=()=>showPlayerInfo(p.id);card.appendChild(a);
 }catch(err){if(card.isConnected){card.querySelector('.bk-daily-desc:last-child').textContent='Career statistics unavailable for this player.';}}
}
let bkSoundCtx=null;
function bkFeedbackSound(ok){
 try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;bkSoundCtx=bkSoundCtx||new C();if(bkSoundCtx.state==='suspended')bkSoundCtx.resume();const now=bkSoundCtx.currentTime;const notes=ok?[740,988]:[240,165];notes.forEach((freq,i)=>{const osc=bkSoundCtx.createOscillator(),gain=bkSoundCtx.createGain();osc.type=ok?'sine':'triangle';osc.frequency.setValueAtTime(freq,now+i*.09);gain.gain.setValueAtTime(.0001,now+i*.09);gain.gain.exponentialRampToValueAtTime(.07,now+i*.09+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+i*.09+.15);osc.connect(gain).connect(bkSoundCtx.destination);osc.start(now+i*.09);osc.stop(now+i*.09+.16)})}catch(e){}
}
function bkShowFeedback(ok){
 document.querySelectorAll('.bk-feedback.bk-answer-overlay').forEach(n=>n.remove());
 const node=document.createElement('div');node.className='bk-feedback bk-answer-overlay '+(ok?'ok':'no');node.setAttribute('role','status');node.innerHTML='<span class="bk-feedback-icon">'+(ok?'✓':'✕')+'</span><span class="bk-feedback-label">'+(ok?'CORRECT':'INCORRECT')+'</span>';document.body.appendChild(node);bkFeedbackSound(ok);setTimeout(()=>node.remove(),900);
}
function submit(){if(!game||game.done||current().name==='Computer')return;let q=document.getElementById('answer').value.trim();if(!q){message('Enter a player name.',true);return}let candidates=byName.get(norm(q))||[];let p=selected&&selected.key===norm(q)?selected:candidates.find(x=>!game.used.has(x.id))||candidates[0];if(!p){
 const required=game.last?initial(game.last.last):null;
 const suggestions=bkSpellingMatches(q,required,game.used);
 if(suggestions.length===1)p=suggestions[0].player;
 else if(suggestions.length>1){
  bkSpellingChoices(document.getElementById('message'),suggestions,player=>{const input=document.getElementById('answer');if(!input)return;input.value=player.name;selected=player;submit()});
  return;
 }else{eliminate('Invalid player: '+q);return}
}
if(game.used.has(p.id)){eliminate('Repeated player: '+p.name);return}if(game.last&&initial(p.first)!==initial(game.last.last)){eliminate('Wrong starting letter: '+p.name);return}accept(p)}
function accept(p){bkShowFeedback(true);stopTimer();game.used.add(p.id);game.last=p;const human=current().name!=='Computer';current().answers++;game.history.push({player:p,by:current().name});advance();if(human)Promise.resolve().then(()=>bkCreditAnswer(p.id)).catch(e=>console.warn('Career progress sync failed:',e))}
function advance(){let g=game;if(g.mode==='solo'){renderGame();beginTurn();return}let alive=g.people.filter(p=>p.alive);if(alive.length<=1){finish('Winner: '+(alive[0]?.name||'Nobody'));return}let next=g.turn;do{next=(next+1)%g.people.length}while(!g.people[next].alive);g.turn=next;renderGame();beginTurn()}
function eliminate(reason){if(!game||game.done)return;if(reason!=='Time expired'&&reason!=='Computer could not answer')bkShowFeedback(false);stopTimer();let g=game;if(g.mode==='solo'){finish(reason);return}current().alive=false;if(g.people.filter(p=>p.alive).length<=1){finish(reason);return}advance()}
function beginTurn(){if(!game||game.done)return;let g=game;g.endsAt=Date.now()+g.duration*1000;updateClock();ticker=setInterval(()=>{if(!game||game!==g||g.done){stopTimer();return}updateClock();if(Date.now()>=g.endsAt)eliminate('Time expired')},150);if(g.mode==='cpu'&&current().name==='Computer'){let currentGame=g,turn=g.turn;let choices=players.filter(p=>!g.used.has(p.id)&&(!g.last||initial(p.first)===initial(g.last.last)));let delay=1500+Math.random()*2600;setTimeout(()=>{if(game!==currentGame||g.done||g.turn!==turn||current().name!=='Computer')return;if(!choices.length||Math.random()<.08){eliminate('Computer could not answer');return}accept(choices[Math.floor(Math.random()*choices.length)])},delay)}}
function updateClock(){if(!game)return;let el=document.getElementById('clock');if(el){let left=Math.max(0,Math.ceil((game.endsAt-Date.now())/1000));el.textContent=left;el.classList.toggle('urgent',left<=5)}}
const bkPlayerCache=new Map();
async function bkApi(path){
 const res=await fetch('https://statsapi.mlb.com/api/v1/'+path);
 if(!res.ok)throw new Error('MLB statistics unavailable');
 return res.json();
}
function bkStatsGrid(stat,fields){
 return '<div class="bk-stat-grid">'+fields.map(([label,key])=>'<div class="bk-stat"><b>'+safe(stat[key]??'—')+'</b><small>'+label+'</small></div>').join('')+'</div>';
}
async function bkLoadPlayer(p){
 const cached=bkPlayerCache.get(p.id);if(cached)return cached;
 let mlbId=p.mlbId;
 if(!mlbId){
  const found=await bkApi('people/search?names='+encodeURIComponent(p.name));
  const matches=(found.people||[]).filter(x=>norm(x.fullName)===p.key);
  // Names shared by different players cannot be reliably matched without another identifier.
  if(matches.length!==1)throw new Error(matches.length?'Multiple players share this name.':'No matching MLB Stats profile found.');
  mlbId=matches[0].id;
 }
 const [stats,awards]=await Promise.all([
  bkApi('people/'+mlbId+'/stats?stats=career&group=hitting,pitching'),
  bkApi('people/'+mlbId+'/awards').catch(()=>({awards:[]}))
 ]);
 const groups=stats.stats||[];
 const hitting=groups.find(g=>g.group?.displayName==='hitting')?.splits?.[0]?.stat;
 const pitching=groups.find(g=>g.group?.displayName==='pitching')?.splits?.[0]?.stat;
 const awardNames=new Set(['Most Valuable Player','Cy Young Award','Rookie of the Year','Silver Slugger','Gold Glove','All-Star','World Series MVP']);
 const prizes=(awards.awards||[]).filter(a=>awardNames.has(a.name)).map(a=>a.name+(a.season?' ('+a.season+')':''));
 const result={hitting,pitching,prizes,mlbId};bkPlayerCache.set(p.id,result);return result;
}
async function showPlayerInfo(id){
 const p=byId.get(id);if(!p)return;
 const modal=document.getElementById('bk-player-modal'),content=document.getElementById('bk-modal-content');
 const refUrl=p.mlbId?'https://www.baseball-reference.com/search/search.fcgi?search='+encodeURIComponent(p.name):'https://www.baseball-reference.com/players/'+encodeURIComponent(p.id[0])+'/'+encodeURIComponent(p.id)+'.shtml';
 const refLink='<p><a href="'+refUrl+'" target="_blank" rel="noopener noreferrer">'+safe(p.name)+' ↗ Baseball-Reference</a></p>';
 content.innerHTML=refLink+'<p>Loading career statistics…</p>';
 modal.hidden=false;document.getElementById('bk-modal-close').focus();
 try{
  const info=await bkLoadPlayer(p);
  if(modal.hidden)return;
  let html=refLink;
  if(info.hitting)html+='<h3>Career batting</h3>'+bkStatsGrid(info.hitting,[['G','gamesPlayed'],['AB','atBats'],['H','hits'],['R','runs'],['RBI','rbi'],['AVG','avg'],['SB','stolenBases'],['HR','homeRuns'],['OBP','obp']]);
  if(info.pitching)html+='<h3>Career pitching</h3>'+bkStatsGrid(info.pitching,[['G','gamesPlayed'],['W','wins'],['L','losses'],['ERA','era'],['SO','strikeOuts'],['IP','inningsPitched'],['SV','saves'],['WHIP','whip'],['GS','gamesStarted']]);
  if(!info.hitting&&!info.pitching)html+='<p>Career statistics are not available from MLB Stats for this player.</p>';
  if(info.prizes.length)html+='<h3>Awards & honors</h3><p>'+info.prizes.map(safe).join(' · ')+'</p>';
  html+='<p style="font-size:12px">Career stats and available awards: MLB Stats API. Baseball-Reference link opens the player profile or a name search.</p>';
  content.innerHTML=html;
 }catch(err){
  if(!modal.hidden)content.innerHTML=refLink+'<p>Career statistics could not be loaded for this player. '+safe(err.message)+'</p><p>You can still view their Baseball-Reference profile above.</p>';
 }
}
document.getElementById('bk-modal-close').onclick=()=>document.getElementById('bk-player-modal').hidden=true;document.getElementById('bk-player-modal').addEventListener('click',e=>{if(e.target.id==='bk-player-modal')e.currentTarget.hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('bk-player-modal').hidden=true});
function finish(reason,manuallyEnded=false){if(!game||game.done)return;stopTimer();game.done=true;let g=game,sorted=[...g.people].sort((a,b)=>b.answers-a.answers),winner=manuallyEnded?null:g.mode==='solo'?g.people[0]:g.people.find(p=>p.alive);let rows=getScores();for(let p of g.people){if(p.name==='Computer')continue;rows.push({name:p.name,mode:g.mode,chain:p.answers,date:new Date().toISOString()})}saveScores(rows);app.innerHTML=`<section class="panel center"><span class="tag">${manuallyEnded?'GAME ENDED':'GAME OVER'}</span><h2 style="margin-top:18px">${safe(reason)}</h2><p>${manuallyEnded?'Match ended early. No incorrect answer or winner was recorded.':winner?'Top player: '+safe(winner.name):'Thanks for playing!'}</p><div class="stats"><div class="stat"><b>${g.history.length}</b><span>Total answers</span></div><div class="stat"><b>${g.people.length}</b><span>Participants</span></div></div><div class="actions"><button class="primary" id="again">Play again</button><button class="secondary" id="home">Main menu</button></div>${g.mode==='solo'||g.mode==='cpu'?'<p class="small" id="bk-game-sync-note" role="status">'+(window.bkActiveUserId?'Saving game to your account…':'Saved on this device (guest mode).')+'</p>':''}</section><section class="panel"><h2>Full player history</h2><p>Every MLB player named in this game, in order.</p><ol class="history">${g.history.map(h=>`<li><span><button type="button" class="bk-history-player" data-player-id="${safe(h.player.id)}">${safe(h.player.name)} ⓘ</button></span><small>${safe(h.by)}</small></li>`).join('')||'<li>No players named</li>'}</ol><button class="secondary" id="copy">Copy answer list</button></section><section class="panel"><h2>Match results</h2><ol class="history">${sorted.map(p=>`<li><span>${safe(p.name)}</span><b>${p.answers} valid answers</b></li>`).join('')}</ol></section>`;if(g.mode==='solo'||g.mode==='cpu'){
 const note=app.querySelector('#bk-game-sync-note');
 bkRecordGlobalGame(g).then(message=>{if(note?.isConnected)note.textContent=message}).catch(error=>{
  console.warn('Account game sync failed:',error?.message||error);
  if(note?.isConnected)note.textContent='Could not sync to your account. This game score remains on this device.';
 });
}app.querySelectorAll('.bk-history-player').forEach(b=>b.onclick=()=>showPlayerInfo(b.dataset.playerId));document.getElementById('again').onclick=()=>{game=null;start()};document.getElementById('home').onclick=menu;document.getElementById('copy').onclick=()=>{let s=g.history.map((h,i)=>`${i+1}. ${h.player.name} — ${h.by}`).join('\n');navigator.clipboard?.writeText(s).then(()=>alert('Copied!')).catch(()=>prompt('Copy your answers:',s))||prompt('Copy your answers:',s)}}
document.getElementById('bk-logo-home').addEventListener('click',()=>{if(document.body.classList.contains('bk-before-entry'))return;document.body.classList.remove('bk-profile-open');const dropdown=document.getElementById('bk-profile-dropdown');if(dropdown)dropdown.hidden=true;const trigger=document.getElementById('bk-profile-trigger');if(trigger)trigger.setAttribute('aria-expanded','false');stopTimer();game=null;leagueMenu();window.scrollTo({top:0,behavior:'smooth'})});leagueMenu();bkRenderDaily('bk-daily-welcome');bkRefreshCareer();
let bkLastRenderedLocalDay=bkLocalDay();
function bkCheckDailyDate(){const day=bkLocalDay();if(day!==bkLastRenderedLocalDay){bkLastRenderedLocalDay=day;bkRenderDaily('bk-daily-welcome');}}
setInterval(bkCheckDailyDate,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)bkCheckDailyDate()});
