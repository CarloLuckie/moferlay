/** Sincroniza partidos de temporada regular y finales desde el feed publico de ESPN.
 * Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-nfl.mjs
 * Semanas opcionales: NFL_WEEKS=1-18 o NFL_WEEKS=5,6,7
 * Nota: ESPN es un endpoint no oficial para terceros; puede cambiar.
 */
import {createClient} from '@supabase/supabase-js';
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
const now=new Date(),season=Number(process.env.NFL_SEASON || (now.getUTCMonth()<2?now.getUTCFullYear()-1:now.getUTCFullYear()));
const guessed=Math.max(1,Math.min(18,Math.floor((Date.now()-Date.parse(`${season}-09-10T00:00:00Z`))/604800000)+1));
const weeksInput=process.env.NFL_WEEKS;
let weeks=weeksInput ? (weeksInput==='1-18' ? Array.from({length:18},(_,i)=>i+1) : weeksInput.split(',').map(Number)) : [Math.max(1,guessed-1),guessed,Math.min(18,guessed+1)];
weeks=[...new Set(weeks)].filter(w=>Number.isInteger(w)&&w>=1&&w<=18);
for(const week of weeks){
  const endpoint=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=50`;
  const response=await fetch(endpoint,{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`ESPN ${response.status} (semana ${week})`);
  const payload=await response.json();
  const games=(payload.events||[]).map(e=>{
    const c=e.competitions?.[0],home=c?.competitors?.find(x=>x.homeAway==='home'),away=c?.competitors?.find(x=>x.homeAway==='away');
    if(!home||!away)return null;
    const h=Number(home.score??0),a=Number(away.score??0),finished=!!e.status?.type?.completed;
    return {season,week,event_id:String(e.id),kickoff_at:e.date,
      home_team:home.team.abbreviation,away_team:away.team.abbreviation,
      home_name:home.team.displayName,away_name:away.team.displayName,
      home_logo:home.team.logo||null,away_logo:away.team.logo||null,
      home_score:finished||e.status?.type?.state==='in'?h:null,
      away_score:finished||e.status?.type?.state==='in'?a:null,
      winner:finished?(h>a?home.team.abbreviation:a>h?away.team.abbreviation:null):null,
      status:finished?'post':e.status?.type?.state==='in'?'in':'pre',updated_at:new Date().toISOString()};
  }).filter(Boolean);
  if(!games.length){console.log(`Semana ${week}: sin eventos`);continue;}
  const {error}=await db.from('games').upsert(games,{onConflict:'season,week,event_id'});
  if(error)throw error;
  console.log(`Semana ${week}: ${games.length} juegos sincronizados (${games.filter(g=>g.status==='post').length} finales)`);
}
