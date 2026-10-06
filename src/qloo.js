// Server-side client for the Qloo hackathon API. The key never leaves the server; responses are
// cached so repeated briefs (and the sample buttons) do not spend the event quota again.

export const QLOO_BASE_URL='https://hackathon.api.qloo.com';

export class QlooError extends Error {
  constructor(message,{status,retryable=false}={}) {
    super(message);
    this.name='QlooError';
    this.status=status;
    this.retryable=retryable;
  }
}

function encodeParams(params) {
  const entries=Object.entries(params)
    .filter(([,v])=>v!==undefined && v!==null && v!=='' && !(Array.isArray(v) && v.length===0))
    .map(([k,v])=>[k,Array.isArray(v)?v.join(','):String(v)])
    .sort(([a],[b])=>a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function qlooFromEnv(env=process.env,fetchImpl=fetch,{ttlMs=12*60*60*1000,maxEntries=800,perSecond=4,now=()=>Date.now(),sleep=(ms)=>new Promise((r)=>setTimeout(r,ms))}={}) {
  const apiKey=env.QLOO_API_KEY;
  if (!apiKey) return null;
  const baseUrl=(env.QLOO_BASE_URL || QLOO_BASE_URL).replace(/\/$/,'');
  const cache=new Map();
  let liveCalls=0;
  // The hackathon key allows 5 requests a second and 10,000 a month (from the response headers).
  let monthRemaining=null;
  const stamps=[];

  async function slot() {
    for (;;) {
      const t=now();
      while (stamps.length && t-stamps[0]>=1000) stamps.shift();
      if (stamps.length<perSecond) { stamps.push(t); return; }
      await sleep(1000-(t-stamps[0])+25);
    }
  }

  async function get(path,params) {
    const query=encodeParams(params);
    const key=`${path}?${query}`;
    const hit=cache.get(key);
    if (hit && now()-hit.at<ttlMs) return {...hit.value,cached:true};

    let lastError;
    for (let attempt=0; attempt<3; attempt+=1) {
      if (attempt>0) await sleep(1100*attempt);
      await slot();
      liveCalls+=1;
      let res;
      let text;
      try {
        // The timeout covers reading the body too, so both sit inside the retry.
        res=await fetchImpl(`${baseUrl}${key}`,{headers:{'X-Api-Key':apiKey},signal:AbortSignal.timeout(25000)});
        text=await res.text();
      } catch (error) {
        lastError=new QlooError(`Qloo request failed: ${error.message}`,{retryable:true});
        continue;
      }
      const remaining=Number(res.headers?.get?.('x-month-ratelimit-remaining'));
      if (Number.isFinite(remaining) && res.headers.get('x-month-ratelimit-remaining')!==null) monthRemaining=remaining;
      let body;
      try { body=JSON.parse(text); } catch { body={}; }
      if (res.ok) {
        const value={path,params,body};
        cache.set(key,{at:now(),value});
        if (cache.size>maxEntries) cache.delete(cache.keys().next().value);
        return {...value,cached:false};
      }
      const detail=body.errors?.[0]?.message ?? body.error_msg ?? body.error ?? text.slice(0,160);
      const retryable=res.status===429 || res.status>=500;
      lastError=new QlooError(`Qloo ${path} responded ${res.status}: ${detail}`,{status:res.status,retryable});
      if (!retryable) break;
    }
    throw lastError;
  }

  return {
    name:'qloo',
    // Not wrapped by the daily budget (it only wraps top-level functions).
    meta:{stats:()=>({liveCalls,cached:cache.size,monthRemaining}),monthRemaining:()=>monthRemaining},
    async search(query,{types,take=5}={}) {
      const out=await get('/search',{query,types,take});
      return {...out,entities:out.body.results ?? []};
    },
    async tags(query,{tagTypes,parentTypes,take=8}={}) {
      const out=await get('/v2/tags',{'filter.query':query,'filter.tag.types':tagTypes,'filter.parents.types':parentTypes,take});
      return {...out,tags:out.body.results?.tags ?? []};
    },
    async insights(params) {
      const out=await get('/v2/insights',params);
      return {...out,entities:out.body.results?.entities ?? [],tags:out.body.results?.tags ?? []};
    }
  };
}

// Tag families that describe how a place feels and what it serves; the rest (genre, service type,
// nearby attraction) say little about taste.
const DESCRIPTIVE_TAG=/^urn:tag:(ambience|decor|setting|offerings|beverage_offering|good_for|interests|specialty_dish|menu_highlight|cuisine):/;

export function compactPlace(entity) {
  const p=entity.properties ?? {};
  const seen=new Set();
  const tags=[];
  const allTags=[...new Set((entity.tags ?? []).map((t)=>t.name).filter(Boolean))];
  for (const tag of entity.tags ?? []) {
    if (!DESCRIPTIVE_TAG.test(tag.id ?? '') || seen.has(tag.name)) continue;
    seen.add(tag.name);
    tags.push({id:tag.id,name:tag.name,family:tag.id.split(':')[2]});
  }
  const image=(p.images ?? []).find((i)=>typeof i?.url==='string' && i.url.startsWith('https://'));
  return {
    id:entity.entity_id,
    name:entity.name,
    kind:'place',
    genre:(p.primary_genre?.id ?? '').replace('urn:tag:genre:place:','') || null,
    address:p.address ?? null,
    neighborhood:p.neighborhood ?? null,
    priceLevel:p.price_level ?? null,
    rating:p.business_rating ?? null,
    summary:p.short_description ?? null,
    image:image?.url ?? null,
    lat:entity.location?.lat ?? null,
    lon:entity.location?.lon ?? null,
    popularity:entity.popularity ?? null,
    affinity:entity.query?.affinity ?? null,
    tags,
    allTags
  };
}

export function compactEntity(entity) {
  return {
    id:entity.entity_id,
    name:entity.name,
    kind:(entity.subtype ?? entity.type ?? '').replace('urn:entity:',''),
    disambiguation:entity.disambiguation ?? null,
    popularity:entity.popularity ?? null,
    affinity:entity.query?.affinity ?? null,
    allTags:[...new Set((entity.tags ?? []).map((t)=>t.name).filter(Boolean))],
    // How many music-specific tags (genre, music style, instrument) Qloo attaches; actors and
    // celebrities filed as artists carry few or none.
    musicTags:(entity.tags ?? []).filter((t)=>/^urn:tag:(genre:music|music:qloo|instrument:qloo)/.test(String(t.id ?? ''))).length
  };
}

// Rank by affinity with ties: places Qloo scores identically share a rank ("=8") instead of being
// ordered by an arbitrary tie-break.
export function tiedRanks(items,score=(x)=>x.affinity) {
  return items.map((item)=>{
    const s=score(item);
    if (typeof s!=='number') return {rank:items.indexOf(item)+1,tied:false};
    const above=items.filter((o)=>typeof score(o)==='number' && score(o)>s).length;
    const same=items.filter((o)=>score(o)===s).length;
    return {rank:above+1,tied:same>1};
  });
}
