import express from 'express';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {qlooFromEnv} from './src/qloo.js';
import {nebiusFromEnv, translatorFromEnv} from './src/llm.js';
import {dailyBudget, rateLimit} from './src/guard.js';
import {buildBrief, localizeResult, readInput} from './src/agent.js';
import {createTasteBriefHandler} from './src/mcp.js';
import {BUSINESSES, CITIES, MARKETS} from './src/catalog.js';

const port=Number(process.env.PORT || 4320);
const isVercel=Boolean(process.env.VERCEL);

// Budgets cap what a public deployment can spend per instance per day.
const providers={
  qloo:dailyBudget(qlooFromEnv(process.env),Number(process.env.QLOO_DAILY_CALLS ?? 400)),
  llm:dailyBudget(nebiusFromEnv(process.env),Number(process.env.NEBIUS_DAILY_CALLS ?? 150)),
  translator:dailyBudget(translatorFromEnv(process.env),Number(process.env.TRANSLATE_DAILY_CALLS ?? 60))
};
const engines={
  data:providers.qloo?'Qloo Taste AI (hackathon API)':'not configured',
  model:providers.llm?`${providers.llm.model} via Nebius Token Factory`:'none (rule-based brief)',
  translation:providers.translator?.model ?? 'none'
};
const QLOO_MONTH_RESERVE=Number(process.env.QLOO_MONTH_RESERVE ?? 1000);
providers.monthReserve=QLOO_MONTH_RESERVE;
const limiter=rateLimit({max:Number(process.env.RATE_LIMIT_PER_10_MIN ?? 12)});
const mcpNodeHandler=toNodeHandler(createTasteBriefHandler(providers));

// Finished briefs are kept for six hours so a repeated question costs nothing.
const briefCache=new Map();
const cacheKey=(input)=>JSON.stringify([input.city.id,input.market.id,input.business.id,input.lang,input.ownPlace?.toLowerCase() ?? '',input.ideas.map((i)=>i.toLowerCase())]);

// How many places Qloo returns with each market's signal per city (scripts/coverage.mjs).
let coverage={counts:{}};
try { coverage=JSON.parse(readFileSync(new URL('./data/coverage.json',import.meta.url),'utf8')); } catch { /* optional */ }

const app=express();
app.disable('x-powered-by');

app.all('/mcp',limiter,async (req,res)=>{
  try {
    await mcpNodeHandler(req,res);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({error:error instanceof Error?error.message:String(error)});
  }
});

app.use(express.json({limit:'32kb'}));

app.get('/health',(_req,res)=>res.json({status:'ok',engines,qlooMonthRemaining:providers.qloo?.meta?.monthRemaining() ?? null}));

app.get('/api/options',(_req,res)=>res.json({
  cities:CITIES.map(({id,label})=>({id,label})),
  markets:MARKETS.map(({id,label,country})=>({id,label,country})),
  businesses:BUSINESSES.map(({id,label})=>({id,label})),
  coverage:coverage.counts,
  engines
}));

const SAMPLE=/^[a-z0-9-]{3,40}$/;
app.get('/api/samples/:id',async (req,res)=>{
  if (!SAMPLE.test(req.params.id)) return res.status(404).json({error:'no such sample'});
  try {
    res.type('json').send(await readFile(new URL(`./data/samples/${req.params.id}.json`,import.meta.url),'utf8'));
  } catch {
    res.status(404).json({error:'no such sample'});
  }
});

// Server-sent events: each agent step as it happens, then the brief.
app.post('/api/brief',limiter,async (req,res)=>{
  let input;
  try {
    input=readInput(req.body ?? {});
  } catch (error) {
    return res.status(400).json({error:error.message});
  }
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'});
  const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const fresh=(hit)=>hit && Date.now()-hit.at<6*60*60*1000;
  const remember=(k,brief)=>{
    briefCache.set(k,{at:Date.now(),brief});
    if (briefCache.size>200) briefCache.delete(briefCache.keys().next().value);
  };
  const key=cacheKey(input);
  const hit=briefCache.get(key);
  if (fresh(hit)) {
    send('step',{ms:0,phase:'cache',label:'Same question answered in the last six hours; returning that brief'});
    send('brief',{...hit.brief,cachedAt:new Date(hit.at).toISOString()});
    return res.end();
  }
  try {
    // A Vietnamese brief is a translation of the English one, so switching language reuses the
    // English analysis instead of asking Qloo again.
    const enKey=cacheKey({...input,lang:'en'});
    let en=fresh(briefCache.get(enKey))?briefCache.get(enKey).brief:null;
    if (en) send('step',{ms:0,phase:'cache',label:'Reusing the English brief answered in the last six hours'});
    if (!en) {
      // Keep part of the monthly Qloo quota for the judging window; saved examples stay available.
      const remaining=providers.qloo?.meta?.monthRemaining();
      if (remaining!==null && remaining!==undefined && remaining<QLOO_MONTH_RESERVE) {
        send('error',{error:`Live briefs are paused to keep the Qloo event quota for judging (${remaining} calls left this month). The saved examples still work.`});
        return res.end();
      }
      en=await buildBrief({...req.body,lang:'en'},{...providers,onEvent:(e)=>send('step',e)});
      en.generatedAt=new Date().toISOString();
      remember(enKey,en);
    }
    let brief=en;
    if (input.lang==='vi') {
      brief=await localizeResult(en,{translator:providers.translator,step:(phase,label,detail=null)=>send('step',{ms:0,phase,label,detail})});
      if (brief.input.lang==='vi') remember(key,brief);
    }
    send('brief',brief);
  } catch (error) {
    send('error',{error:error instanceof Error?error.message:String(error)});
  }
  res.end();
});

app.use(express.static(fileURLToPath(new URL('./public',import.meta.url)),{
  maxAge:0,
  setHeaders(res){res.setHeader('cache-control','no-store');}
}));

app.use((error,_req,res,_next)=>{
  res.status(500).json({error:error instanceof Error?error.message:String(error)});
});

if (!isVercel) {
  app.listen(port,'127.0.0.1',()=>{
    console.log(`Taste brief: http://127.0.0.1:${port}  (MCP: /mcp)`);
    console.log(`Data: ${engines.data}; model: ${engines.model}`);
  });
}

export default app;
