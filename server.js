import express from 'express';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {qlooFromEnv} from './src/qloo.js';
import {nebiusFromEnv} from './src/llm.js';
import {dailyBudget, rateLimit} from './src/guard.js';
import {buildBrief, readInput} from './src/agent.js';
import {createTasteBriefHandler} from './src/mcp.js';
import {BUSINESSES, CITIES, MARKETS} from './src/catalog.js';

const port=Number(process.env.PORT || 4320);
const isVercel=Boolean(process.env.VERCEL);

// Budgets cap what a public deployment can spend per instance per day.
const providers={
  qloo:dailyBudget(qlooFromEnv(process.env),Number(process.env.QLOO_DAILY_CALLS ?? 1500)),
  llm:dailyBudget(nebiusFromEnv(process.env),Number(process.env.NEBIUS_DAILY_CALLS ?? 150))
};
const engines={
  data:providers.qloo?'Qloo Taste AI (hackathon API)':'not configured',
  model:providers.llm?`${providers.llm.model} via Nebius Token Factory`:'none (rule-based brief)'
};
const limiter=rateLimit({max:Number(process.env.RATE_LIMIT_PER_10_MIN ?? 12)});
const mcpNodeHandler=toNodeHandler(createTasteBriefHandler(providers));

// Finished briefs are kept for six hours so a repeated question costs nothing.
const briefCache=new Map();
const cacheKey=(input)=>JSON.stringify([input.city.id,input.market.id,input.business.id,input.ownPlace?.toLowerCase() ?? '',input.ideas.map((i)=>i.toLowerCase())]);

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

app.get('/health',(_req,res)=>res.json({status:'ok',engines}));

app.get('/api/options',(_req,res)=>res.json({
  cities:CITIES.map(({id,label})=>({id,label})),
  markets:MARKETS.map(({id,label,country})=>({id,label,country})),
  businesses:BUSINESSES.map(({id,label})=>({id,label})),
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
  const key=cacheKey(input);
  const hit=briefCache.get(key);
  if (hit && Date.now()-hit.at<6*60*60*1000) {
    send('step',{ms:0,phase:'cache',label:'Same question answered in the last six hours; returning that brief'});
    send('brief',{...hit.brief,cachedAt:new Date(hit.at).toISOString()});
    return res.end();
  }
  try {
    const brief=await buildBrief(req.body,{...providers,onEvent:(e)=>send('step',e)});
    brief.generatedAt=new Date().toISOString();
    briefCache.set(key,{at:Date.now(),brief});
    if (briefCache.size>200) briefCache.delete(briefCache.keys().next().value);
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
