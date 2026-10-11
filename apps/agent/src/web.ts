// Local website server. Credentials remain here; the browser receives public views only.
// History comes from Tiger when it's configured, otherwise from data/fixtures (see data/history.ts).
// Darwin Growth: each generation is a fruit; Approve / Reject is stored in the database
// and pushed to Darwin (see data/evolution.ts).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { loadOrgData } from "./data/org.ts";
import { people, departments, source } from "./data/fixtures.ts";
import { createHistory } from "./data/history.ts";
import { createDecisionStore, Evolution, type Decision } from "./data/evolution.ts";

const root = resolve(fileURLToPath(new URL("../../../docs/design/v6/", import.meta.url)));
const history = createHistory();
const evolution = new Evolution(createDecisionStore());
const orgStatus = await loadOrgData();
console.log(`[web] directory: ${orgStatus.source} · history: ${history.source} · Darwin decisions: ${evolution.store.kind === "tiger" ? "Tiger events" : "logs/darwin-decisions.json"}`);
const duration = (hours: number) => `${Math.floor(hours)} h ${Math.round((hours % 1) * 60)} m`;

async function snapshot() {
  const [{ requests, hops, saved, summary, weekly, deptStats, routes, events }, evo] = await Promise.all([history.load(), evolution.view()]);
  const org = departments.map(d => ({ id:d.id, name:d.name, subs:[{id:`${d.id}_team`, name:d.name, people:people.filter(p => p.department_id===d.id).map(p => p.name)}] }));
  const directory = people.map(p => ({id:p.id,name:p.name,first:p.name.split(' ')[0],dept:p.department_id,deptName:departments.find(d=>d.id===p.department_id)?.name ?? p.department_id,sub:`${p.department_id}_team`,subName:p.role}));
  const me = directory.find(p=>p.id==='p_leo') ?? directory[0];
  const personId = (id: string) => directory.some(p=>p.id===id) ? id : departments.find(d=>d.id===id)?.head_id ?? me.id;
  const queries = requests.map(r => {
    const trail = hops.filter(h=>h.request_id===r.id).map(h=>({who:personId(h.to_id),verdict:({bounced:'redirect',delegated:'delegate',handled:'answer',forwarded:'approve'} as Record<string,string>)[h.outcome] ?? 'pending',msg:h.note ?? '',at:new Date(h.at).toLocaleString('en-US')}));
    return {id:r.id,title:r.title,status:r.status==='resolved'?'done':'active',started:new Date(r.created_at).toLocaleString('en-US'),elapsed:duration((new Date(r.resolved_at ?? Date.now()).getTime()-new Date(r.created_at).getTime())/3600000),usual:'Historical request',type:r.task_type,requester:personId(r.requester_id),hops:trail.length?trail:[{who:personId(r.requester_id),verdict:'pending',msg:'Waiting for routing',at:''}]};
  });
  const hopAverage = hops.length / Math.max(requests.length,1);
  const stats = {hoursSaved:saved.filter(s=>s.kind==='saved').reduce((n,s)=>n+Number(s.hours),0),peopleHelped:summary.people,departments:org.length,subDepartments:org.length,requestsRouted:summary.requests,avgHopsBefore:hopAverage,avgHopsAfter:hopAverage,introsMade:events.find(e=>e.type==='introduction_sent')?.n ?? 0,approvalsByText:events.find(e=>e.type==='approved')?.n ?? 0,medianMinutes:Number(summary.median)*60,medianResolve:duration(Number(summary.median)),medianBefore:'Historical data'};
  const series = weekly.map(w=>({week:new Date(w.week).toLocaleDateString('en-US'),requests:w.requests,resolved:w.resolved,hops:Number(w.hops),hoursSaved:0}));
  // Two points keep spark lines valid when the database contains only one week.
  if(series.length<2) series.unshift({week:'Earlier',requests:0,resolved:0,hops:0,hoursSaved:0});
  const byDept=org.map(d=>{const s=deptStats.find(s=>s.department_id===d.id); return {id:d.id,name:d.name,hoursSaved:0,hoursHeld:Number(s?.total_hours ?? 0),requests:Number(s?.hops_received ?? 0),hopsBefore:hopAverage,hopsAfter:hopAverage};});
  return {org,people:directory,me,queries,transactions:Object.fromEntries(queries.map(q=>[q.id,q.hops.map(h=>({t:h.at,from:h.who,kind:'msg',text:h.msg}))])),matches:[],stats,series,byDept,
    routing:routes.filter(r=>org.some(d=>d.id===r.a)&&org.some(d=>d.id===r.b)).map(r=>[r.a,r.b,r.volume]),
    darwin:evo.generations,rules:[],darwinReplayed:evo.replayed,
    connection:{directory:source,database:history.source,darwin:evo.connected,decisions:evo.store,updatedAt:new Date().toISOString()}};
}

// Existing prototype templates use innerHTML, so escape DB strings before they reach them.
function htmlSafe(value: unknown): unknown {
  if(typeof value==='string') return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  if(Array.isArray(value)) return value.map(htmlSafe);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,htmlSafe(v)]));
  return value;
}
const json=(res: import('node:http').ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const mime: Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const path=new URL(req.url ?? '/', 'http://localhost').pathname;
  // Darwin Growth: POST /api/darwin/generations/<n>/approve|reject
  const decision=req.method==='POST' && path.match(/^\/api\/darwin\/generations\/(\d{1,3})\/(approve|reject)$/);
  if(decision){
    try{
      const out=await evolution.decide(Number(decision[1]), (decision[2]==='approve'?'approved':'rejected') as Decision);
      console.log(`[web] Darwin generation ${out.gen} ${out.status} (${out.store}) · rules: ${out.rules.map(r=>`${r.id}=${r.status}`).join(', ')}`);
      json(res,200,out);
    }catch(err){json(res,(err as {status?:number}).status ?? 502,{error:(err as Error).message});}
    return;
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  try {
    if(path==='/api/data' || path==='/shared/data.js'){
      const data=await snapshot();
      if(path==='/api/data'){json(res,200,data);return;}
      res.writeHead(200,{'Content-Type':'text/javascript'});
      res.end(`window.WF=${JSON.stringify(htmlSafe(data))};Object.assign(WF,{person:id=>WF.people.find(p=>p.id===id),dept:id=>WF.org.find(d=>d.id===id),query:id=>WF.queries.find(q=>q.id===id)||WF.queries[0],nameOf:id=>id==='wf'?'Wayfinder':(WF.people.find(p=>p.id===id)?.first??id)});document.addEventListener('DOMContentLoaded',()=>{const c=WF.connection,b=document.createElement('div');b.textContent=(c.database==='tiger'?'Connected to Tiger Data':'Offline: history from fixtures')+' · Directory: '+c.directory+(c.darwin?' · Darwin live':' · Darwin offline')+' · Decisions saved to '+(c.decisions==='tiger'?'Tiger':'local file');b.style.cssText='position:fixed;top:8px;left:8px;z-index:10000;background:white;color:#174b42;padding:8px 12px;border-radius:12px;font:12px system-ui';document.body.append(b)});`);
      return;
    }
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep) && file!==resolve(root,'index.html')){res.writeHead(403);res.end();return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)] ?? 'application/octet-stream'});res.end(content);
  }catch(err){
    const missing=(err as NodeJS.ErrnoException).code==='ENOENT';
    res.writeHead(missing?404:503,{'Content-Type':'text/plain'});
    res.end(missing?'Page not found':'Website data unavailable. Check the server database connection.');
    if(!missing) console.warn(`[web] request failed: ${(err as Error).message}`);
  }
});
await history.check();
const port=Number(process.env.WEB_PORT || 3000);
server.listen(port,'127.0.0.1',()=>console.log(`[web] http://localhost:${port} · history from ${history.source === 'tiger' ? 'Tiger Data (wayfinder_web)' : 'data/fixtures (Tiger not configured)'}`));
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{server.close();void Promise.allSettled([history.close(),evolution.store.close()]).finally(()=>process.exit(0));});
