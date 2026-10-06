// Deterministic analyses over Qloo results. Every item that can back a recommendation goes into the
// ledger with a short ref (P3, C2, T1) and the exact request that produced it; the agent may only
// cite refs that exist here, and the UI renders names and numbers from the ledger, not from the model.

import {compactEntity, compactPlace} from './qloo.js';
import {CULTURE_TYPES} from './catalog.js';

const PREFIX={place:'P',tag:'T',idea:'I'};

export class Ledger {
  constructor() { this.items=new Map(); this.counts={}; }
  add(kind,item,source) {
    const existing=[...this.items.values()].find((e)=>e.kind===kind && e.item.id===item.id && item.id);
    if (existing) return existing.ref;
    const prefix=PREFIX[kind] ?? 'C';
    this.counts[prefix]=(this.counts[prefix] ?? 0)+1;
    const ref=`${prefix}${this.counts[prefix]}`;
    this.items.set(ref,{ref,kind,item,source});
    return ref;
  }
  has(ref) { return this.items.has(ref); }
  get(ref) { return this.items.get(ref); }
  toJSON() { return Object.fromEntries(this.items); }
}

function source(out) {
  return {endpoint:out.path,params:out.params,cached:out.cached};
}

function placeParams({city,business,take}) {
  return {'filter.type':'urn:entity:place','filter.location.query':city.query,'filter.tags':business.tags,'operator.filter.tags':'union',take};
}

// Where a visitor market already goes in the city, compared with the city's overall ranking for
// the same kind of business. "lift" is how many places it climbs when the market's taste is applied.
// When Qloo sees too few of the business's peers with a market signal (smaller cities, distant
// markets), widen to every kind of place so the owner still learns where the market goes.
export async function marketPlaces({qloo,ledger},{city,market,business,take=50,keep=12,minMarket=5}) {
  const fetchPair=(params)=>Promise.all([
    qloo.insights({...params,'signal.location.query':market.query}),
    qloo.insights(params)
  ]);
  let scope='business';
  let [withMarket,baseline]=await fetchPair(placeParams({city,business,take}));
  if (withMarket.entities.length<minMarket) {
    const wide=await fetchPair({'filter.type':'urn:entity:place','filter.location.query':city.query,take});
    if (wide[0].entities.length>withMarket.entities.length) {
      [withMarket,baseline]=wide;
      scope='all-places';
    }
  }
  const marketList=withMarket.entities.map(compactPlace);
  const baselineList=baseline.entities.map(compactPlace);
  const baselineRank=new Map(baselineList.map((p,i)=>[p.id,i+1]));
  const places=marketList.slice(0,keep).map((place,i)=>{
    const rank=i+1;
    const cityRank=baselineRank.get(place.id) ?? null;
    const entry={...place,rank,cityRank,lift:cityRank===null?null:cityRank-rank};
    entry.ref=ledger.add('place',entry,source(withMarket));
    return entry;
  });
  return {places,marketList,baselineList,scope,sources:[source(withMarket),source(baseline)]};
}

// Which descriptive tags are over-represented among the market's favourites compared with the city
// overall. Counts each tag once per place.
export function tasteProfile({ledger},{marketList,baselineList,places},{minCount=3,minPool=8,keep=8}={}) {
  const count=(list)=>{
    const m=new Map();
    for (const place of list) for (const tag of place.tags) {
      const row=m.get(tag.name) ?? {name:tag.name,family:tag.family,id:tag.id,ids:[]};
      row.ids.push(place.id);
      m.set(tag.name,row);
    }
    return m;
  };
  if (marketList.length<minPool || !baselineList.length) return [];
  const inMarket=count(marketList);
  const inBaseline=count(baselineList);
  const refByPlace=new Map(places.map((p)=>[p.id,p.ref]));
  const rows=[];
  for (const row of inMarket.values()) {
    const marketShare=row.ids.length/marketList.length;
    const baselineCount=inBaseline.get(row.name)?.ids.length ?? 0;
    const baselineShare=baselineCount/baselineList.length;
    if (row.ids.length<minCount || marketShare<=baselineShare) continue;
    rows.push({
      id:row.id,
      name:row.name,
      family:row.family,
      marketCount:row.ids.length,
      marketTotal:marketList.length,
      baselineCount,
      baselineTotal:baselineList.length,
      gap:marketShare-baselineShare,
      places:row.ids.map((id)=>refByPlace.get(id)).filter(Boolean)
    });
  }
  rows.sort((a,b)=>b.gap-a.gap || b.marketCount-a.marketCount);
  return rows.slice(0,keep).map((row)=>{
    const entry={...row,derived:true};
    entry.ref=ledger.add('tag',entry,{derivedFrom:'marketPlaces',rule:'tag share among market favourites minus share among the city overall'});
    return entry;
  });
}

// Culture the market loves at home, split into what the host city also loves (a bridge both
// visitors and locals enjoy) and what is distinctive to the market.
export async function bridgeCulture({qloo,ledger},{city,market,kind='artist',take=50,keep=6}) {
  const type=CULTURE_TYPES[kind]?.type;
  if (!type) throw new Error(`unknown culture type "${kind}"`);
  const [abroad,local]=await Promise.all([
    qloo.insights({'filter.type':type,'signal.location.query':market.query,take}),
    qloo.insights({'filter.type':type,'signal.location.query':city.query,take})
  ]);
  const localRank=new Map(local.entities.map((e,i)=>[e.entity_id,i+1]));
  const marketItems=abroad.entities.map((e,i)=>({...compactEntity(e),rank:i+1,localRank:localRank.get(e.entity_id) ?? null}));
  const register=(items)=>items.map((item)=>({...item,ref:ledger.add(kind,item,source(abroad))}));
  return {
    kind,
    bridge:register(marketItems.filter((e)=>e.localRank!==null).slice(0,keep)),
    distinct:register(marketItems.filter((e)=>e.localRank===null).slice(0,keep)),
    marketItems,
    sources:[source(abroad),source(local)]
  };
}

// Rank known Qloo entities (resolved earlier) for a market. Entities Qloo returns no affinity for
// are reported as such rather than ranked last.
export async function rankEntities({qloo,ledger},{market,kind,ids,label}) {
  const type=CULTURE_TYPES[kind]?.type;
  if (!type) throw new Error(`unknown entity type "${kind}"`);
  const out=await qloo.insights({'filter.type':type,'filter.results.entities':ids,'signal.location.query':market.query,take:ids.length});
  const ranked=out.entities.map((e,i)=>{
    const item={...(kind==='place'?compactPlace(e):compactEntity(e)),rank:i+1,of:ids.length,question:label ?? null};
    return {...item,ref:ledger.add(kind,item,source(out))};
  });
  const returned=new Set(ranked.map((r)=>r.id));
  return {ranked,noSignal:ids.filter((id)=>!returned.has(id)),source:source(out)};
}

// Score an owner's idea, mapped to a Qloo tag, against the same two pools as the taste profile:
// how many of the market's favourite places carry a tag of that name, against the city overall.
// Matching by name counts "Live Music" whether Qloo filed it under good_for, amenity or ambience.
const tagKey=(name)=>String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');

export function scoreIdeaInPools({ledger},{marketList,baselineList,places},{tag,idea}) {
  const key=tagKey(tag.name);
  const carries=(place)=>(place.allTags ?? []).some((n)=>tagKey(n)===key);
  const inMarket=marketList.filter(carries);
  const inCity=baselineList.filter(carries);
  const marketShare=marketList.length?inMarket.length/marketList.length:0;
  const cityShare=baselineList.length?inCity.length/baselineList.length:0;
  let verdict;
  if (inMarket.length>=2 && marketShare-cityShare>=0.05) verdict='over-represented';
  else if (inMarket.length>=1) verdict='common';
  else if (inCity.length>=1) verdict='absent-from-favourites';
  else verdict='untested';
  const refByPlace=new Map(places.map((p)=>[p.id,p.ref]));
  const item={
    id:tag.id,
    name:tag.name,
    idea,
    marketCount:inMarket.length,
    marketTotal:marketList.length,
    cityCount:inCity.length,
    cityTotal:baselineList.length,
    gap:marketShare-cityShare,
    verdict,
    examples:inMarket.map((p)=>refByPlace.get(p.id)).filter(Boolean).slice(0,4)
  };
  item.ref=ledger.add('idea',item,{derivedFrom:'marketPlaces',rule:'share of market favourites carrying the tag vs share of the city overall'});
  return item;
}

const VERDICT_ORDER={'over-represented':0,common:1,untested:2,'absent-from-favourites':3};

export function rankIdeaScores(scores) {
  const ranked=[...scores].sort((a,b)=>VERDICT_ORDER[a.verdict]-VERDICT_ORDER[b.verdict] || b.gap-a.gap || b.marketCount-a.marketCount);
  return ranked.map((s,i)=>({...s,rank:i+1,of:ranked.length}));
}
