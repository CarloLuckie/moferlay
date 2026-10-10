/* MOFERLAY — quiniela de NFL compartida. */
const $ = (q) => document.querySelector(q);
const $$ = (q) => [...document.querySelectorAll(q)];
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (n) => new Intl.NumberFormat('es-MX',{maximumFractionDigits:1}).format(n);
const cfg = window.NFL_PICKEM_CONFIG || {};
const isLive = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
const db = isLive && window.supabase ? window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}}) : null;
const YEAR = new Date().getUTCMonth() < 2 ? new Date().getUTCFullYear()-1 : new Date().getUTCFullYear();
const START = new Date(`${YEAR}-09-10T00:00:00Z`).getTime();
const initialWeek = Math.max(1,Math.min(18,Math.floor((Date.now()-START)/604800000)+1));
const params = new URLSearchParams(location.search);
const requestedGroup = params.get('g');
const state = {
  season: YEAR, week: initialWeek, tab: 'picks', scope: 'week', group: null,
  user: null, members: [], allGames: [], allPicks: [], draft: {},
  isLoading: false, isSaving: false, lastError: '',
};
const DEMO_MATCHUPS = [
  ['2026-10-09T00:15:00Z','TB','DAL','Tampa Bay Buccaneers','Dallas Cowboys'],
  ['2026-10-11T13:30:00Z','PHI','JAX','Philadelphia Eagles','Jacksonville Jaguars'],
  ['2026-10-11T17:00:00Z','CIN','MIA','Cincinnati Bengals','Miami Dolphins'],
  ['2026-10-11T17:00:00Z','LV','NE','Las Vegas Raiders','New England Patriots'],
  ['2026-10-11T17:00:00Z','MIN','NO','Minnesota Vikings','New Orleans Saints'],
  ['2026-10-11T17:00:00Z','CLE','NYJ','Cleveland Browns','New York Jets'],
  ['2026-10-11T17:00:00Z','IND','PIT','Indianapolis Colts','Pittsburgh Steelers'],
  ['2026-10-11T17:00:00Z','HOU','TEN','Houston Texans','Tennessee Titans'],
  ['2026-10-11T17:00:00Z','NYG','WAS','New York Giants','Washington Commanders'],
  ['2026-10-11T20:05:00Z','DEN','LAC','Denver Broncos','Los Angeles Chargers'],
  ['2026-10-11T20:25:00Z','DET','ARI','Detroit Lions','Arizona Cardinals'],
  ['2026-10-11T20:25:00Z','CHI','GB','Chicago Bears','Green Bay Packers'],
  ['2026-10-11T20:25:00Z','SF','SEA','San Francisco 49ers','Seattle Seahawks'],
  ['2026-10-12T00:20:00Z','BAL','ATL','Baltimore Ravens','Atlanta Falcons'],
  ['2026-10-13T00:15:00Z','BUF','LAR','Buffalo Bills','Los Angeles Rams'],
].map(([kickoff_at,away_team,home_team,away_name,home_name],i)=>({
  season:2026,week:5,event_id:`demo-${i+1}`,kickoff_at,away_team,home_team,away_name,home_name,
  away_logo:null,home_logo:null,status:'pre',winner:null,away_score:null,home_score:null
}));
const duration = (ts) => new Date(ts).toLocaleString('es-MX',{timeZone:'America/Merida',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).replace(/\./g,'');
const gameKey = (g) => `${g.season}|${g.week}|${g.event_id}`;
const locked = (g) => new Date(g.kickoff_at).getTime() <= Date.now() || g.status !== 'pre';
const gamesWeek = () => state.allGames.filter(g=>g.season===state.season && g.week===state.week).sort((a,b)=>new Date(a.kickoff_at)-new Date(b.kickoff_at));
const picksWeek = () => state.allPicks.filter(p=>p.season===state.season && p.week===state.week);
const mine = () => picksWeek().filter(p=>p.user_id===state.user?.id);
function gameConfidenceLimit(){return gamesWeek().length;}
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}
function seedDemo(){
  const ids=['you','marcos','sofia','fer','luis'];
  const names=['Tú','Marcos','Sofía','Fer','Luis'];
  state.group={id:'demo',name:'MOFERLAY'};
  state.user={id:'you',nickname:'Tú'};
  state.members=ids.map((id,i)=>({user_id:id,nickname:names[i]}));
  const saved=JSON.parse(localStorage.getItem('sunday-club-demo-picks')||'null');
  if(saved && Array.isArray(saved)){state.allPicks=saved;return;}
  state.allPicks=DEMO_MATCHUPS.flatMap((g,i)=>ids.slice(1).map((id,j)=>({
    group_id:'demo',user_id:id,season:2026,week:5,event_id:g.event_id,
    pick_team:((i*7+j*3)%9<5?g.home_team:g.away_team),confidence:((i+j*4)%15)+1
  })));
  localStorage.setItem('sunday-club-demo-picks',JSON.stringify(state.allPicks));
}
function mapEspn(payload,season,week){
  return (payload.events||[]).map(ev=>{
    const comp=ev.competitions?.[0];
    const home=comp?.competitors?.find(c=>c.homeAway==='home');
    const away=comp?.competitors?.find(c=>c.homeAway==='away');
    if(!home||!away)return null;
    const finished=!!ev.status?.type?.completed;
    const hScore=Number(home.score??0),aScore=Number(away.score??0);
    const winner=finished?(hScore>aScore?home.team.abbreviation:aScore>hScore?away.team.abbreviation:null):null;
    return {season,week,event_id:String(ev.id),kickoff_at:ev.date,
      home_team:home.team.abbreviation,away_team:away.team.abbreviation,
      home_name:home.team.displayName,away_name:away.team.displayName,
      home_logo:home.team.logo||null,away_logo:away.team.logo||null,
      status:finished?'post':ev.status?.type?.state==='in'?'in':'pre',
      winner,home_score:finished||ev.status?.type?.state==='in'?hScore:null,
      away_score:finished||ev.status?.type?.state==='in'?aScore:null};
  }).filter(Boolean);
}
async function fetchEspn(season,week){
  const endpoint=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=50`;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
  try{const r=await fetch(endpoint,{signal:controller.signal});if(!r.ok)throw new Error('API NFL no disponible');return mapEspn(await r.json(),season,week)}finally{clearTimeout(timer)}
}
async function boot(){
  if(!isLive){seedDemo();$('#account-name').textContent='Tú · Demo';await loadDemoWeek();return;}
  if(!db){fatal('No se pudo cargar el SDK de Supabase. Revisa la conexión.');return;}
  $('#mode-badge').textContent='LIGA ONLINE';$('#mode-badge').className='pill pill-green';$('#demo-note').textContent='Tus picks se guardan en tu cuenta y puedes entrar desde celular o computadora.';
  try{
    const resultUser=await db.auth.getUser();
    const user=resultUser.data?.user;
    // Ya no se crean cuentas anónimas. Si existía una sesión antigua, solicitamos correo y contraseña.
    if(!user || user.is_anonymous){showLogin();return;}
    state.group=null;
    state.user={id:user.id,nickname:''};
    // Recupera la liga de otro dispositivo aunque no tenga datos en localStorage.
    let groupId=requestedGroup||localStorage.getItem('sunday-club-group');
    if(groupId){
      const membership=await db.from('group_members').select('nickname').eq('group_id',groupId).eq('user_id',user.id).maybeSingle();
      if(membership.error)throw membership.error;
      if(membership.data){
        const group=await db.from('groups').select('id,name').eq('id',groupId).single();
        if(group.error)throw group.error;
        state.group=group.data;state.user.nickname=membership.data.nickname;
      }
    }
    if(!state.group && !requestedGroup){
      // La membresía se guarda en Supabase; no depende del navegador o dispositivo.
      const memberships=await db.from('group_members').select('group_id,nickname').eq('user_id',user.id).order('joined_at',{ascending:false}).limit(1);
      if(memberships.error)throw memberships.error;
      const member=memberships.data?.[0];
      if(member){
        groupId=member.group_id;
        const group=await db.from('groups').select('id,name').eq('id',groupId).single();
        if(group.error)throw group.error;
        state.group=group.data;state.user.nickname=member.nickname;
      }
    }
    if(!state.group){showSetup(!!requestedGroup);return;}
    localStorage.setItem('sunday-club-group',state.group.id);
    await loadLive();subscribeChanges();
  }catch(e){fatal(`No se pudo iniciar la liga: ${e.message||e}`)}
}
// Inicio de sesión solo para cuentas creadas por el administrador en Supabase.
function initializeAuthUI(){
  if(!isLive)return;
  const dialog=document.createElement('dialog');
  dialog.id='login-dialog';dialog.className='modal login-modal';
  dialog.innerHTML=`<form id="login-form" autocomplete="on">
    <div class="modal-eyebrow">BIENVENIDO A MOFERLAY</div>
    <h2>¿Qué onda? Entra a la quiniela.</h2>
    <p>Usa el correo y la contraseña que te pasó el administrador de la liga.</p>
    <label for="login-email">TU CORREO</label>
    <input id="login-email" type="email" name="email" autocomplete="username" required placeholder="correo@ejemplo.com" />
    <label for="login-password">TU CONTRASEÑA</label>
    <input id="login-password" type="password" name="password" autocomplete="current-password" required placeholder="La que te asignaron" />
    <p id="login-error" class="form-error" role="alert"></p>
    <button class="button button-primary wide" type="submit" id="login-submit">Entrar a MOFERLAY</button>
    <p class="fineprint">¿No tienes acceso? Pídeselo al administrador. Aquí nadie se registra por su cuenta.</p>
  </form>`;
  document.body.append(dialog);
  const logout=document.createElement('button');
  logout.type='button';logout.className='account-logout';logout.id='logout-btn';logout.textContent='Salir';
  logout.title='Cerrar sesión en este dispositivo';
  $('#account-name').after(logout);
  logout.addEventListener('click',async()=>{
    if(!confirm('¿Quieres cerrar tu sesión de MOFERLAY en este dispositivo?'))return;
    const {error}=await db.auth.signOut();
    if(error){toast('No pudimos cerrar la sesión: '+error.message);return;}
    window.location.reload();
  });
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const email=$('#login-email').value.trim().toLowerCase();
    const password=$('#login-password').value;
    const button=$('#login-submit');button.disabled=true;
    $('#login-error').textContent='';
    try{
      const {error}=await db.auth.signInWithPassword({email,password});
      if(error)throw error;
      $('#login-password').value='';dialog.close();
      await boot();
    }catch(error){
      $('#login-error').textContent='No se pudo entrar. Revisa tu correo y contraseña, y confirma con el administrador que tu cuenta esté activa.';
      console.warn('MOFERLAY login failed:',error.message);
    }finally{button.disabled=false;}
  });
}
function showLogin(){
  const dialog=$('#login-dialog');
  if(!dialog){fatal('No se pudo abrir el inicio de sesión. Recarga la página.');return;}
  if(!dialog.open)dialog.showModal();
  $('#login-email').focus();
}
function fatal(message){$('#content').innerHTML=`<div class="empty-state">${escapeHtml(message)}</div>`;toast(message)}
function showSetup(join){
  const d=$('#setup-dialog');$('#dialog-title').textContent=join?'Únete a la quiniela':'Crea tu liga';
  $('#dialog-text').textContent=join?'Estás entrando con un enlace de invitación.':'Crea una liga privada y comparte el enlace con tus amigos.';
  $('#new-group-field').hidden=join;
  $('#new-group-name').required=!join;
  $('#setup-error').textContent='';d.showModal();$('#nickname').focus();
}
$('#setup-form').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const nickname=$('#nickname').value.trim(),groupName=$('#new-group-name').value.trim();
  if(nickname.length<2)return;
  const joinId=requestedGroup||localStorage.getItem('sunday-club-group');
  $('#setup-confirm').disabled=true;$('#setup-error').textContent='';
  try{
    let groupId=joinId;
    if(groupId){const out=await db.rpc('join_group',{p_group_id:groupId,p_nickname:nickname});if(out.error)throw out.error;}
    else {const out=await db.rpc('create_group',{p_name:groupName,p_nickname:nickname});if(out.error)throw out.error;groupId=out.data;}
    localStorage.setItem('sunday-club-group',groupId);history.replaceState(null,'',`?g=${groupId}`);
    const {data:group,error}=await db.from('groups').select('id,name').eq('id',groupId).single();if(error)throw error;
    state.group=group;state.user.nickname=nickname;
    $('#setup-dialog').close();await loadLive();subscribeChanges();
  }catch(err){$('#setup-error').textContent=err.message||'No se pudo entrar. Revisa el apodo o enlace.';}
  finally{$('#setup-confirm').disabled=false;}
});
async function loadDemoWeek(){
  // Muestra la demo de inmediato, sin depender de una conexión externa.
  state.allGames=state.season===2026&&state.week===5?DEMO_MATCHUPS:[];
  state.isLoading=false;resetDraft();render();
  try{const fixtures=await fetchEspn(state.season,state.week);
    state.allGames=fixtures.length?fixtures:(state.season===2026&&state.week===5?DEMO_MATCHUPS:[]);
    // Picks de la demo no se mezclan con eventos ESPN: se mapean por el orden cronológico.
    if(fixtures.length&&state.season===2026&&state.week===5){
      const oldIds=DEMO_MATCHUPS.map(g=>g.event_id),newIds=fixtures.map(g=>g.event_id);
      const demoPicks=state.allPicks.filter(p=>p.season===2026&&p.week===5);
      if(demoPicks.some(p=>oldIds.includes(p.event_id))){
        // El calendario de ESPN puede ordenar partidos del mismo horario de otra forma;
        // reasignamos usando los equipos conocidos, no solamente el indice.
        const mapping=new Map(DEMO_MATCHUPS.map(g=>[g.event_id,fixtures.find(f=>f.home_team===g.home_team&&f.away_team===g.away_team)?.event_id]));
        state.allPicks=state.allPicks.map(p=>({...p,event_id:mapping.get(p.event_id)||p.event_id}));
      }
    }
  }catch(e){state.allGames=state.season===2026&&state.week===5?DEMO_MATCHUPS:[];toast('Sin conexión con marcadores: se muestra el calendario de respaldo cuando está disponible.');}
  state.isLoading=false;resetDraft();render();
}
// PostgREST devuelve como máximo 1,000 filas por consulta de forma predeterminada.
// Paginar evita truncar la clasificación de temporada cuando hay varios amigos.
async function fetchAllPicks(groupId,season){
  const pageSize=1000;
  let offset=0;
  const results=[];
  while(true){
    const page=await db.from('picks')
      .select('group_id,user_id,season,week,event_id,pick_team,confidence')
      .eq('group_id',groupId).eq('season',season)
      .order('week',{ascending:true})
      .order('event_id',{ascending:true})
      .order('user_id',{ascending:true})
      .range(offset,offset+pageSize-1);
    if(page.error)throw page.error;
    const rows=page.data||[];
    results.push(...rows);
    if(rows.length<pageSize)break;
    offset+=rows.length;
  }
  return {data:results};
}
async function loadLive(){
  // Retener picks locales no guardados mientras llegan cambios de otros usuarios.
  const draftCopy=structuredClone(state.draft);
  const savedDraft=Object.fromEntries(mine().map(p=>[p.event_id,{team:p.pick_team,confidence:p.confidence}]));
  const normalized=(obj)=>JSON.stringify(Object.entries(obj).sort(([a],[b])=>a.localeCompare(b)));
  const hadLocalChanges=normalized(draftCopy)!==normalized(savedDraft);
  const oldWeek=state.week;
  state.isLoading=true;render();
  const groupId=state.group.id;
  try{
    const [members,picks,games]=await Promise.all([
      db.from('group_members').select('user_id,nickname').eq('group_id',groupId),
      fetchAllPicks(groupId,state.season),
      db.from('games').select('*').eq('season',state.season).order('kickoff_at',{ascending:true})
    ]);
    if(members.error)throw members.error;if(picks.error)throw picks.error;if(games.error)throw games.error;
    state.members=members.data||[];state.allPicks=picks.data||[];state.allGames=games.data||[];
    resetDraft();if(hadLocalChanges && oldWeek===state.week)state.draft=draftCopy;state.lastError='';
  }catch(e){state.lastError=e.message||String(e);toast(`Error de conexión: ${state.lastError}`);}
  state.isLoading=false;render();
}
let subbed=false;
function subscribeChanges(){
  if(!db||subbed)return;subbed=true;
  db.channel('club-'+state.group.id).on('postgres_changes',{event:'*',schema:'public',table:'picks',filter:`group_id=eq.${state.group.id}`},()=>loadLive()).on('postgres_changes',{event:'*',schema:'public',table:'games'},()=>loadLive()).on('postgres_changes',{event:'*',schema:'public',table:'group_members',filter:`group_id=eq.${state.group.id}`},()=>loadLive()).subscribe();
}
function resetDraft(){state.draft={};for(const p of mine())state.draft[p.event_id]={team:p.pick_team,confidence:p.confidence};}
// Los porcentajes son solo una encuesta de confianza, NO otorgan puntos extra.
// Cada ganador correcto gana 30 puntos si lo eligio la mayoria (o si hay empate
// en cantidad de votos), y 50 puntos si lo eligio la minoria.
// La mayoria se decide por NUMERO DE PERSONAS, no por el slider de confianza.
// Cada pick queda inmutable al kickoff, por lo que un resultado final no cambia
// aunque mas adelante se unan nuevas personas a la liga.
const SCORE_MAJORITY = 30;
const SCORE_MINORITY = 50;
function gameVoteCounts(g, votes=state.allPicks){
  let home=0,away=0;
  for(const v of votes){
    if(v.season!==g.season||v.week!==g.week||v.event_id!==g.event_id)continue;
    if(v.pick_team===g.home_team)home++;
    else if(v.pick_team===g.away_team)away++;
  }
  return {home,away,total:home+away};
}
function pickVotePosition(g,team,counts=gameVoteCounts(g)){
  const own=team===g.home_team?counts.home:team===g.away_team?counts.away:0;
  const opposing=team===g.home_team?counts.away:counts.home;
  if(!own)return null;
  return own<opposing?'minority':own>opposing?'majority':'tie';
}
function pointsForWinningPick(g,team,counts=gameVoteCounts(g)){
  return pickVotePosition(g,team,counts)==='minority'?SCORE_MINORITY:SCORE_MAJORITY;
}
function memberStats(scope='week'){
  const all=scope==='season'?state.allGames:gamesWeek();
  const keys=new Map(all.map(g=>[gameKey(g),g]));
  const counts=new Map(all.map(g=>[gameKey(g),gameVoteCounts(g)]));
  const leaderboard=state.members.map(m=>{
    let points=0,correct=0,judged=0,projected=0,minorityCorrect=0,majorityCorrect=0,tiedCorrect=0;
    for(const p of state.allPicks){
      if(p.user_id!==m.user_id)continue;
      const key=gameKey(p),g=keys.get(key);if(!g)continue;
      const votes=counts.get(key);
      const position=pickVotePosition(g,p.pick_team,votes);
      if(g.status==='post'){
        // Un empate real de NFL no cuenta ni como acierto ni como error.
        if(!g.winner)continue;
        judged++;
        if(g.winner===p.pick_team){
          correct++;
          points+=pointsForWinningPick(g,p.pick_team,votes);
          if(position==='minority')minorityCorrect++;
          else if(position==='majority')majorityCorrect++;
          else tiedCorrect++;
        }
      }else {
        // Estimacion social simple, NO probabilidad estadistica de ganar.
        // Los puntos esperados usan el apoyo por cantidad de votos,
        // mientras que el slider solo interviene en la barra de consenso.
        const own=p.pick_team===g.home_team?votes.home:votes.away;
        const socialShare=votes.total?own/votes.total:0.5;
        projected+=socialShare*pointsForWinningPick(g,p.pick_team,votes);
      }
    }
    return {...m,points,correct,judged,minorityCorrect,majorityCorrect,tiedCorrect,
      precision:judged?correct/judged:0,projected:points+projected};
  });
  leaderboard.sort((a,b)=>b.points-a.points||b.correct-a.correct||a.nickname.localeCompare(b.nickname));
  return leaderboard;
}
function totalGroupAccuracy(scope='week'){
  const ranks=memberStats(scope);const right=ranks.reduce((v,r)=>v+r.correct,0),judged=ranks.reduce((v,r)=>v+r.judged,0);
  return {right,judged,accuracy:judged?Math.round(right/judged*100):null};
}
function consensusAccuracy(){
  let correct=0,judged=0;
  for(const g of gamesWeek()){
    if(g.status!=='post')continue;
    const s=getSupport(g);
    if(!s.total||s.home===s.away)continue;
    const predicted=s.home>s.away?g.home_team:g.away_team;
    judged++;
    if(predicted===g.winner)correct++;
  }
  return {correct,judged,ratio:judged?Math.round(100*correct/judged):null};
}
function topProjected(){return [...memberStats('week')].sort((a,b)=>b.projected-a.projected)[0]||null;}
const TEAM_COLORS={
 ARI:['#97233F','#FFB612'],ATL:['#A71930','#000000'],BAL:['#241773','#9E7C0C'],BUF:['#00338D','#C60C30'],
 CAR:['#0085CA','#101820'],CHI:['#C83803','#0B162A'],CIN:['#FB4F14','#171717'],CLE:['#FF3C00','#311D00'],
 DAL:['#003594','#869397'],DEN:['#FB4F14','#002244'],DET:['#0076B6','#B0B7BC'],GB:['#203731','#FFB612'],
 HOU:['#03202F','#A71930'],IND:['#002C5F','#A2AAAD'],JAX:['#006778','#D7A22A'],KC:['#E31837','#FFB81C'],
 LAC:['#0080C6','#FFC20E'],LAR:['#003594','#FFA300'],LA:['#003594','#FFA300'],LV:['#555555','#A5ACAF'],
 MIA:['#008E97','#FC4C02'],MIN:['#4F2683','#FFC62F'],NE:['#002244','#C60C30'],NO:['#D3BC8D','#101820'],
 NYG:['#0B2265','#A71930'],NYJ:['#125740','#FFFFFF'],PHI:['#004C54','#A5ACAF'],PIT:['#FFB612','#101820'],
 SF:['#AA0000','#B3995D'],SEA:['#002244','#69BE28'],TB:['#D50A0A','#FF7900'],TEN:['#0C2340','#4B92DB'],
 WAS:['#5A1414','#FFB612'],WSH:['#5A1414','#FFB612']
};
function teamGradient(team){
 const c=TEAM_COLORS[team]||['#47647F','#859BB0'];
 return `linear-gradient(110deg,${c[0]},${c[1]})`;
}
// Cada partido tiene su propio porcentaje real de confianza: 0 a 100.
function confidencePercent(confidence){
 if(confidence == null || !Number.isFinite(Number(confidence)))return 0;
 return Math.max(0,Math.min(100,Math.round(Number(confidence))));
}
function getSupport(g){
 const ps=picksWeek().filter(p=>p.event_id===g.event_id),away=ps.filter(p=>p.pick_team===g.away_team).reduce((s,p)=>s+p.confidence,0),home=ps.filter(p=>p.pick_team===g.home_team).reduce((s,p)=>s+p.confidence,0);
 const votes=gameVoteCounts(g,ps);
 return {away,home,total:away+home,participants:ps.length,ballots:ps,awayVotes:votes.away,homeVotes:votes.home};
}
function teamBar(g,awayPct,homePct,hasVotes=true){
 return `<div class="bar team-bar" role="img" aria-label="${escapeHtml(g.away_name)} ${hasVotes?awayPct+'%':'sin votos'}; ${escapeHtml(g.home_name)} ${hasVotes?homePct+'%':'sin votos'}">
 <span class="team-bar-side" style="width:${awayPct}%;background:${hasVotes?teamGradient(g.away_team):'#394554'}"></span>
 <span class="team-bar-side" style="width:${homePct}%;background:${hasVotes?teamGradient(g.home_team):'#394554'}"></span></div>`;
}
function parlayConsensus(){
 return gamesWeek().map(g=>{
   const v=getSupport(g);const drawn=v.total>0 && v.away===v.home;
   const team=v.total&&!drawn?(v.away>v.home?g.away_team:g.home_team):null;
   const name=team===g.away_team?g.away_name:g.home_name;
   const support=team?(team===g.away_team?v.away:v.home)/v.total:0;
   const ballots=v.ballots;
   const complete=state.members.length>0 && ballots.length===state.members.length;
   const lock=complete && ballots.length>0 && ballots.every(p=>p.pick_team===team && confidencePercent(p.confidence,gamesWeek().length)>=80);
   return {g,v,team,name,support,complete,lock,drawn};
 });
}

function render(){
  $('#season-label').textContent=state.season;
  $('#week-label').textContent=`SEMANA ${String(state.week).padStart(2,'0')}`;
  $('#prev-week').disabled=state.week<=1;$('#next-week').disabled=state.week>=18;
  $('#account-name').textContent=state.user?.nickname||'Invitado';
  $('#group-title').textContent=state.group?.name||'Tu grupo';
  $('#side-members').textContent=state.members.length;
  $('#side-week').textContent=String(state.week).padStart(2,'0')+' / 18';
  const fixtures=gamesWeek();const own=mine(),rank=memberStats('week').find(m=>m.user_id===state.user?.id);
  $('#stat-games').textContent=fixtures.length||'—';
  $('#stat-picks').textContent=`${own.length}/${fixtures.length}`;
  $('#stat-points').textContent=rank?.points??0;
  $('#stat-members').textContent=state.members.length;
  $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===state.tab));
  const projected=topProjected();
  $('#forecast').innerHTML=projected?`<div class="forecast-person">${escapeHtml(projected.nickname)}</div><div class="forecast-score">${number(projected.projected)} <small style="font-size:12px;color:#9cacbc;letter-spacing:0">pts estimados</small></div><div class="forecast-info">${number(projected.points)} puntos confirmados · líder proyectado de la semana</div>`:'<span class="forecast-info">Aún no hay pronósticos.</span>';
  if(state.isLoading){$('#content').innerHTML='<div class="empty-state">Cargando partidos y votos…</div>';return}
  if(state.lastError){$('#content').innerHTML=`<div class="empty-state">${escapeHtml(state.lastError)}<p>Revisa las credenciales y las políticas de Supabase.</p></div>`;return}
  $('#content').innerHTML=state.tab==='picks'?renderPicks():state.tab==='consensus'?renderConsensus():state.tab==='parlay'?renderParlay():renderRanking();
}
function logo(team,name,url){
  if(url && /^https:\/\//.test(url))return `<img class="team-logo" loading="lazy" src="${escapeHtml(url)}" alt="" />`;
  return `<span class="team-abbr">${escapeHtml(team)}</span>`;
}
function renderPicks(){
  const gs=gamesWeek(),n=gs.length,closed=gs.filter(locked).length;
  if(!gs.length)return `<div class="section-head"><div><h2>Jornada ${state.week}</h2><p>No hay partidos cargados para esta semana.</p></div></div><div class="empty-state">${isLive?'Ejecuta la sincronización inicial de la NFL desde GitHub Actions.':'La API no devolvió partidos. El calendario de respaldo está disponible para la Semana 5 de 2026.'}</div>`;
  const blocks=gs.map(g=>{
    const d=state.draft[g.event_id]||{},isLocked=locked(g),isFinal=g.status==='post';
    const team=(side)=>{const name=side==='home'?g.home_name:g.away_name,short=side==='home'?g.home_team:g.away_team,lg=side==='home'?g.home_logo:g.away_logo;
      return `<button type="button" class="team ${d.team===short?'selected':''} ${isFinal&&g.winner===short?'won':''}" data-pick="${escapeHtml(g.event_id)}" data-team="${escapeHtml(short)}" ${isLocked?'disabled':''}>${logo(short,name,lg)}<span><b>${escapeHtml(name)}</b><small>${d.team===short?'TU ELECCIÓN':side==='home'?'LOCAL':'VISITANTE'}</small></span></button>`};
    const pct=confidencePercent(d.confidence,n);
    const date=duration(g.kickoff_at).toUpperCase();
    return `<article class="game"><div class="game-top"><span>${escapeHtml(date)} · ${escapeHtml(g.event_id.startsWith('demo-')?'NFL':'NFL')}</span><span class="${isFinal?'final':''}">${isFinal?'FINAL':g.status==='in'?'EN VIVO':isLocked?'CERRADO':'ABIERTO'}${g.home_score!=null&&g.away_score!=null?' · '+escapeHtml(g.away_score)+' – '+escapeHtml(g.home_score):''}</span></div><div class="game-bottom"><div class="teams">${team('away')}<span class="vs">VS</span>${team('home')}</div><div class="confidence"><div class="confidence-heading"><label for="confidence-${escapeHtml(g.event_id)}">¿QUÉ TAN SEGURO?</label><strong class="confidence-value" data-percent-for="${escapeHtml(g.event_id)}">${d.team?pct+'%':'—'}</strong></div><input type="range" min="0" max="100" step="5" id="confidence-${escapeHtml(g.event_id)}" data-confidence="${escapeHtml(g.event_id)}" value="${d.confidence ?? 50}" style="--progress:${pct}%" ${isLocked||!d.team?'disabled':''} aria-label="Confianza: MOFE a LOCK"/><div class="confidence-extremes"><span>MOFE</span><span>LOCK</span></div></div></div></article>`;
  }).join('');
  const changed=JSON.stringify(Object.entries(state.draft).sort())!==JSON.stringify(Object.entries(Object.fromEntries(mine().map(p=>[p.event_id,{team:p.pick_team,confidence:p.confidence}]))).sort());
  return `<div class="section-head"><div><h2>Mis picks de la semana</h2><p>Elige ganador y ajusta tu confianza: MOFE = 0%, LOCK = 100%. ¡El porcentaje no afecta tus puntos! Acierta con la mayoría: +30; contra la mayoría: +50.</p></div><span class="count-tag">${closed} CERRADOS · ${n-closed} ABIERTOS</span></div><div class="games">${blocks}</div><div class="foot-action"><p>${changed?'<span class="save-status">Cambios sin guardar</span>':'Los porcentajes son niveles de confianza, no puntos del marcador. Puedes editar hasta el kickoff.'}<br />Los picks cerrados ya no se pueden modificar.</p><button class="button button-primary" id="save-picks" ${state.isSaving?'disabled':''}>${state.isSaving?'Guardando…':'Guardar mis pronósticos →'}</button></div>`;
}
function renderConsensus(){
 const gs=gamesWeek(),accuracy=totalGroupAccuracy('week'),collective=consensusAccuracy();
 if(!gs.length)return '<div class="empty-state">No hay partidos en esta jornada.</div>';
 return `<div class="section-head"><div><h2>El pronóstico del grupo</h2><p>La barra usa los porcentajes de confianza. Para el ranking, la mayoría se cuenta por cantidad de amigos, no por confianza.</p></div><span class="count-tag">${state.members.length} PARTICIPANTES</span></div><div class="projection"><div class="projection-row"><span class="matchup">PRECISIÓN COLECTIVA</span><strong>${accuracy.accuracy==null?'POR DEFINIR':accuracy.accuracy+'%'}</strong></div><div class="forecast-info">${accuracy.right} aciertos en ${accuracy.judged} pronósticos individuales evaluados. · Consenso del grupo: ${collective.ratio===null?'sin partidos cerrados':collective.ratio+'%'} (${collective.correct}/${collective.judged}).</div></div>${gs.map(g=>{
  const v=getSupport(g),awayPct=v.total?Math.round(v.away/v.total*100):50,homePct=100-awayPct;
  const f=v.total?(v.away>v.home?g.away_name:v.home>v.away?g.home_name:'Empate en el grupo'):'Sin votos';
  return `<div class="projection"><div class="projection-row"><div class="matchup">${escapeHtml(g.away_name)} <span style="color:#617083">vs.</span> ${escapeHtml(g.home_name)}<small>${v.participants} pronósticos · ${escapeHtml(duration(g.kickoff_at))}</small></div><strong>${escapeHtml(f)}</strong></div>${teamBar(g,awayPct,homePct,!!v.total)}<div class="bar-labels"><span>${escapeHtml(g.away_team)} ${v.total?awayPct+'%':'—'} · ${v.awayVotes} votos</span><span>${v.homeVotes} votos · ${v.total?homePct+'%':'—'} ${escapeHtml(g.home_team)}</span></div></div>`;
 }).join('')}<p class="fineprint">Estos porcentajes son respaldo ponderado del grupo, no la probabilidad estadística de victoria de los equipos.</p>`;
}
function renderParlay(){
 const decisions=parlayConsensus();
 if(!decisions.length)return '<div class="empty-state">Primero hay que cargar los partidos de la semana.</div>';
 const valid=decisions.filter(d=>d.team).sort((a,b)=>Number(b.complete)-Number(a.complete)||b.support-a.support||b.v.ballots.length-a.v.ballots.length);
 const lockedPicks=valid.filter(d=>d.lock);
 const everyone=state.members.length;
 const picksMarkup=(data,empty)=>data.length?data.map(({g,team,name,support,complete,lock,v})=>{
   const pct=Math.round(support*100);
   const pending=Math.max(0,everyone-v.ballots.length);
   const winnerStatus=g.status==='post'?(g.winner===team?'ACERTAMOS':'FALLAMOS'):g.status==='in'?'EN JUEGO':'POR JUGAR';
   return `<div class="parlay-leg" style="--team-edge:${TEAM_COLORS[team]?.[0]||'#b4f268'}">
     <div class="parlay-leg-main"><div class="parlay-team">${logo(team,name,team===g.away_team?g.away_logo:g.home_logo)}<div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(g.away_team)} vs. ${escapeHtml(g.home_team)} · ${escapeHtml(duration(g.kickoff_at))}</small></div></div>
       <div class="parlay-metric"><strong>${pct}%</strong><small>RESPALDO</small></div></div>
     <div class="parlay-leg-foot"><span>${v.ballots.length}/${everyone} votos · ${complete?'la banda ya votó':pending+' por votar'}</span><span>${lock?'LOCK DE TODOS · ':''}${winnerStatus}</span></div>
   </div>`;
 }).join(''):`<div class="empty-state">${empty}</div>`;
 const tentative=valid.some(d=>!d.complete);
 return `<div class="section-head"><div><h2>El parlay de la banda</h2><p>Aquí se arma la combinada con los picks de TODOS. No mostramos boletas individuales.</p></div><span class="count-tag">${everyone} EN LA LIGA</span></div>
 <div class="parlay-summary"><div><span class="parlay-kicker">LA COMBINADA DEL GRUPO</span><strong>${valid.length} selecciones</strong><p>Elegimos el equipo con mayor suma de confianza en cada juego. ${tentative?'Algunos picks todavía son provisionales hasta que vote toda la banda.':'Todos los participantes ya votaron en los picks marcados como completos.'}</p></div><span class="parlay-count">${valid.length}/${decisions.length}</span></div>
 <div class="parlay-list">${picksMarkup(valid,'Todavía no hay votos para armar la combinada de esta semana.')}</div>
 ${decisions.some(d=>d.drawn)?'<p class="parlay-caution">Los juegos empatados en respaldo no entran en la combinada hasta romper el empate.</p>':''}
 <div class="section-head lock-head"><div><h2>LOCK de la banda</h2><p>Solo entra si TODOS eligieron el mismo equipo y cada uno le dio al menos 80% de confianza.</p></div><span class="count-tag">${lockedPicks.length} LOCKS</span></div>
 <div class="parlay-list">${picksMarkup(lockedPicks,'Aún no tenemos un LOCK unánime de 80% o más. Falta convencer a la banda.')}</div>
 <p class="fineprint">MOFERLAY solo organiza el consenso de sus integrantes. No genera boletos, cuotas ni apuestas. Un LOCK no garantiza que gane el equipo.</p>`;
}
function renderRanking(){
 const leaders=memberStats(state.scope),accuracy=totalGroupAccuracy(state.scope),onWeek=state.scope==='week';
 const dates=state.allGames.filter(g=>g.season===state.season&&g.week===state.week),max=dates.length*SCORE_MINORITY;
 return `<div class="section-head"><div><h2>El marcador de la liga</h2><p>+30 por acertar con la mayoría (o en empate de votos). +50 por acertar contra la mayoría. Fallar = 0. Tu % de confianza no suma puntos.</p></div><span class="count-tag">${onWeek?`${max} PTS POSIBLES`:'TEMPORADA '+state.season}</span></div><div style="display:flex;gap:8px;margin:0 0 17px"><button class="button ${onWeek?'button-primary':'button-ghost'}" data-scope="week">Esta semana</button><button class="button ${!onWeek?'button-primary':'button-ghost'}" data-scope="season">Temporada</button></div><div class="projection"><div class="projection-row"><div><div class="matchup">PRECISIÓN DEL GRUPO</div><span class="forecast-info">Todos los picks evaluados ${onWeek?'esta semana':'en la temporada'}</span></div><strong style="font-size:23px">${accuracy.accuracy==null?'—':accuracy.accuracy+'%'}</strong></div><div class="forecast-info">${accuracy.right} correctos de ${accuracy.judged} pronósticos finalizados</div></div><div class="ranking-list">${leaders.map((r,i)=>`<div class="rank-card"><div class="rank-pos">${String(i+1).padStart(2,'0')}</div><div><div class="rank-name">${escapeHtml(r.nickname)} ${r.user_id===state.user?.id?'<span style="color:#9edc6a;font-size:10px">(TÚ)</span>':''}</div><div class="rank-detail">${r.correct} aciertos / ${r.judged} evaluados · ${r.judged?Math.round(r.precision*100)+'%':'Sin resultados'} de precisión · ${r.minorityCorrect} contra la banda (+50) · ${r.majorityCorrect+r.tiedCorrect} con la banda/empate (+30)</div></div><div class="rank-score">${r.points}<small>PUNTOS</small></div></div>`).join('')||'<div class="empty-state">Aún no hay participantes.</div>'}</div>`;
}
function editTeam(gameId,team){
 const g=gamesWeek().find(g=>g.event_id===gameId);if(!g||locked(g))return;
 const d=state.draft[gameId];if(d?.team===team){delete state.draft[gameId];render();return;}
 const confidence=d?.confidence ?? 50;
 state.draft[gameId]={team,confidence};render();
}
function changeConfidence(gameId,value){
 const g=gamesWeek().find(g=>g.event_id===gameId),current=state.draft[gameId];
 if(!g||locked(g)||!current?.team)return;
 const val=Number(value);
 if(!Number.isInteger(val)||val<0||val>100)return;
 // No intercambiamos la confianza con ningún otro partido.
 state.draft[gameId]={...current,confidence:val};
 render();
}
async function savePicks(){
 if(!state.user||state.isSaving)return;
 const all=gamesWeek();const open=all.filter(g=>!locked(g));
 const toSave=open.filter(g=>state.draft[g.event_id]?.team).map(g=>({event_id:g.event_id,pick_team:state.draft[g.event_id].team,confidence:Number(state.draft[g.event_id].confidence)}));
 if(toSave.some(p=>!Number.isInteger(p.confidence)||p.confidence<0||p.confidence>100)){
   toast('La confianza debe estar entre 0% y 100%.');return;
 }
 state.isSaving=true;render();
 try{
  if(isLive){const r=await db.rpc('submit_week_picks',{p_group_id:state.group.id,p_season:state.season,p_week:state.week,p_picks:toSave});if(r.error)throw r.error;await loadLive();}
  else{
    state.allPicks=state.allPicks.filter(p=>!(p.user_id==='you'&&p.season===state.season&&p.week===state.week&&open.some(g=>g.event_id===p.event_id)));
    state.allPicks.push(...toSave.map(p=>({...p,group_id:'demo',user_id:'you',season:state.season,week:state.week})));
    localStorage.setItem('sunday-club-demo-picks',JSON.stringify(state.allPicks));resetDraft();
  }
  toast('Pronósticos guardados. ¡Que empiece el juego!');
 }catch(e){toast('No se pudieron guardar los picks: '+(e.message||e));}
 finally{state.isSaving=false;render()}
}
$('#content').addEventListener('click',e=>{const p=e.target.closest('[data-pick]');if(p)return editTeam(p.dataset.pick,p.dataset.team);const scope=e.target.closest('[data-scope]');if(scope){state.scope=scope.dataset.scope;render();return}if(e.target.closest('#save-picks'))savePicks()});
$('#content').addEventListener('input',e=>{
  if(!e.target.matches('input[type=range][data-confidence]'))return;
  const pct=confidencePercent(e.target.value);
  const out=$(`[data-percent-for="${e.target.dataset.confidence}"]`);
  if(out)out.textContent=pct+'%';
  e.target.style.setProperty('--progress',pct+'%');
});
$('#content').addEventListener('change',e=>{if(e.target.matches('[data-confidence]'))changeConfidence(e.target.dataset.confidence,e.target.value)});
function addParlayTab(){
 const tabs=$('.tabs');
 if(tabs && !tabs.querySelector('[data-tab="parlay"]')){
   const tab=document.createElement('button');tab.className='tab';tab.dataset.tab='parlay';tab.type='button';tab.textContent='Parlay de la banda';
   tabs.append(tab);
 }
}
addParlayTab();
// Las instrucciones originales del HTML explicaban la puntuacion antigua.
// Se actualizan aqui para conservar la personalizacion de index.html.
function updateRules(){
 const rules=document.querySelector('.how-panel ol');
 if(rules)rules.innerHTML=`<li>Elige el equipo que crees que va a ganar.</li><li>Usa el slider MOFE (0%) a LOCK (100%) para decir qué tan seguro estás. No suma ni resta puntos.</li><li>Si aciertas y tu equipo fue el más elegido: <b>+30 puntos</b>. Si aciertas contra la mayoría: <b>+50 puntos</b>.</li><li>Si la cantidad de votos quedó empatada y aciertas: <b>+30 puntos</b>. Si fallas: 0. El pick se bloquea al iniciar el juego.</li>`;
 const note=document.querySelector('.forecast-panel .fineprint');
 if(note)note.textContent='Proyección aproximada a partir de los votos del grupo. La mayoría se define por número de votos, no por porcentajes de confianza. No es una probabilidad real.';
}
updateRules();
initializeAuthUI();
$$('.tab').forEach(t=>t.addEventListener('click',()=>{state.tab=t.dataset.tab;render()}));
async function goWeek(delta){const next=state.week+delta;if(next<1||next>18)return;state.week=next;state.tab='picks';if(isLive){resetDraft();render()}else await loadDemoWeek()}
$('#prev-week').addEventListener('click',()=>goWeek(-1));$('#next-week').addEventListener('click',()=>goWeek(1));
function share(){if(!isLive){toast('La demo no es compartida. Configura Supabase para invitar amigos.');return;}
 const link=`${location.origin}${location.pathname}?g=${state.group.id}`;
 navigator.clipboard.writeText(link).then(()=>toast('Enlace de invitación copiado.')).catch(()=>prompt('Copia este enlace:',link));
}
$('#share-btn').addEventListener('click',share);$('#invite-btn').addEventListener('click',share);
// Marcadores sincronizados periódicamente. Las predicciones también usan cambios en tiempo real.
if(isLive)setInterval(()=>{if(state.group&&!state.isLoading&&!state.isSaving)loadLive()},60000);
else setInterval(()=>{if(!state.isLoading)render()},60000);
boot();
