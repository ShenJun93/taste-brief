// Keeps a public deployment from spending the owner's Nebius and Tavily credits without bound.
// Limits are per server instance (serverless instances do not share memory), which is enough
// to stop a casual loop; the hard stop is the provider account's own trial limit.

export function dailyBudget(provider,limit,now=()=>Date.now()) {
  if (!provider || !(limit>0)) return provider;
  let day=new Date(now()).toISOString().slice(0,10);
  let used=0;
  const take=()=>{
    const today=new Date(now()).toISOString().slice(0,10);
    if (today!==day) { day=today; used=0; }
    if (used>=limit) throw new Error(`daily ${provider.name} budget of ${limit} calls reached; using the rules until tomorrow`);
    used+=1;
  };
  const wrapped={...provider};
  for (const [key,value] of Object.entries(provider)) {
    if (typeof value==='function') wrapped[key]=async(...args)=>{ take(); return value.apply(provider,args); };
  }
  return wrapped;
}

export function rateLimit({windowMs=10*60*1000,max=40,now=()=>Date.now()}={}) {
  const hits=new Map();
  return (req,res,next)=>{
    const ip=(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    const t=now();
    const recent=(hits.get(ip) ?? []).filter((ts)=>t-ts<windowMs);
    if (recent.length>=max) {
      res.status(429).json({error:'Too many requests from this address; please wait a few minutes.'});
      return;
    }
    recent.push(t);
    hits.set(ip,recent);
    if (hits.size>5000) hits.clear();
    next();
  };
}
