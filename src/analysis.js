// Deterministic analyses over Qloo results. Every item that can back a recommendation goes into the
// ledger with a short ref (P3, C2, T1, I1) and the exact request that produced it; the agent may
// only cite refs that exist here, and the UI renders names and numbers from the ledger, not from
// the model.

import {compactEntity, compactPlace, tiedRanks} from './qloo.js';
import {CULTURE_TYPES} from './catalog.js';

const PREFIX={place:'P',tag:'T',idea:'I'};

export class Ledger {
  constructor() { this.items=new Map(); this.counts={}; }
  add(kind,item,source) {
    const existing=[...this.items.values()].find((e)=>e.kind===kind && item.id && e.item.id===item.id && e.item.idea===item.idea);
    if (existing) return existing.ref;
    const prefix=PREFIX[kind] ?? 'C';
    this.counts[prefix]=(this.counts[prefix] ?? 0)+1;
    const ref=`${prefix}${this.counts[prefix]}`;
    this.items.set(ref,{ref,kind,item,source});
    return ref;
  }
  has(ref) { return this.items.has(ref); }
  get(ref) { return this.items.get(ref); }
  remove(ref) { this.items.delete(ref); }
  toJSON() { return Object.fromEntries(this.items); }
}

function source(out) {
  return {endpoint:out.path,params:out.params,cached:out.cached};
}

const byAffinity=(a,b)=>(b.affinity ?? 0)-(a.affinity ?? 0);

function ranked(list,cityList) {
  const cityRank=new Map(cityList.map((p,i)=>[p.id,i+1]));
  const ranks=tiedRanks(list);
  return list.map((p,i)=>{
    const rank=ranks[i].rank;
    const city=cityRank.get(p.id) ?? null;
    return {...p,rank,tied:ranks[i].tied,cityRank:city,lift:city===null?null:city-rank};
  });
}

// Four lists from Qloo, all for the same city:
//   peers  = places of the owner's kind, with and without the visitor market's taste signal;
//   all    = every kind of place, with and without the signal (the pools for the taste profile and
//            idea scores, and the source of partner ideas such as hotels and restaurants nearby).
// Peers are confirmed by primary genre, because tag filters alone let a pho shop count as a café.
export async function marketPlaces({qloo,ledger},{city,market,business,take=50,keepPeers=10,keepAll=12}) {
  const peerParams={'filter.type':'urn:entity:place','filter.location.query':city.query,'filter.tags':business.tags,'operator.filter.tags':'union',take};
  const allParams={'filter.type':'urn:entity:place','filter.location.query':city.query,take};
  const signal={'signal.location.query':market.query};
  const [peerMarket,peerCity,allMarket,allCity]=await Promise.all([
    qloo.insights({...peerParams,...signal}),
    qloo.insights(peerParams),
    qloo.insights({...allParams,...signal}),
    qloo.insights(allParams)
  ]);
  const isPeer=(p)=>business.genre.test(p.genre ?? '');
  const marketList=allMarket.entities.map(compactPlace);
  const baselineList=allCity.entities.map(compactPlace);

  const peerMap=new Map();
  for (const p of [...peerMarket.entities.map(compactPlace),...marketList]) if (isPeer(p) && !peerMap.has(p.id)) peerMap.set(p.id,p);
  const peerList=[...peerMap.values()].sort(byAffinity);
  const peerCityList=peerCity.entities.map(compactPlace).filter(isPeer);

  const peers=ranked(peerList,peerCityList).slice(0,keepPeers).map((p)=>({...p,pool:'peers',ref:ledger.add('place',{...p,pool:'peers'},source(peerMarket))}));
  const allPlaces=ranked(marketList,baselineList).slice(0,keepAll).map((p)=>({...p,pool:'all',ref:ledger.add('place',{...p,pool:'all'},source(allMarket))}));
  return {
    peers,
    peerCount:peerList.length,
    peerCityCount:peerCityList.length,
    allPlaces,
    marketList,
    baselineList,
    allSource:source(allMarket),
    sources:[source(peerMarket),source(peerCity),source(allMarket),source(allCity)]
  };
}

// Smoothed log-odds of a tag among the market's favourites against the city overall; robust for
// small counts and zero city counts.
function logOdds(m,M,c,C) {
  return Math.log(((m+0.5)/(M-m+0.5))/((c+0.5)/(C-c+0.5)));
}

export function shareRatio(m,M,c,C) {
  if (!M || !C) return null;
  if (c===0) return m>0?Infinity:null;
  return (m/M)/(c/C);
}

// Register up to four places carrying a tag as evidence (places beyond the top list included).
function placeRefs(ledger,places,allSource) {
  return places.slice(0,4).map((p)=>ledger.add('place',{...p,pool:'all'},allSource));
}

// Tags (ambience, setting, offerings, cuisine) clearly more common among the market's favourite
// places than among the city's top places. Tags nearly every place carries are left out.
export function tasteProfile({ledger},pools,{minCount=3,minRatio=1.5,minGap=0.1,maxCityShare=0.7,minPool=8,keep=8}={}) {
  const {marketList,baselineList}=pools;
  if (marketList.length<minPool || baselineList.length<minPool) return [];
  const count=(list)=>{
    const m=new Map();
    for (const place of list) for (const tag of place.tags) {
      const row=m.get(tag.name) ?? {name:tag.name,family:tag.family,id:tag.id,places:[]};
      row.places.push(place);
      m.set(tag.name,row);
    }
    return m;
  };
  const inMarket=count(marketList);
  const inCity=count(baselineList);
  const M=marketList.length;
  const C=baselineList.length;
  const rows=[];
  for (const row of inMarket.values()) {
    const m=row.places.length;
    const c=inCity.get(row.name)?.places.length ?? 0;
    const ratio=shareRatio(m,M,c,C);
    if (m<minCount || c/C>maxCityShare || m/M-c/C<minGap || (ratio!==Infinity && ratio<minRatio)) continue;
    rows.push({id:row.id,name:row.name,family:row.family,marketCount:m,marketTotal:M,baselineCount:c,baselineTotal:C,ratio,score:logOdds(m,M,c,C),carriers:row.places});
  }
  rows.sort((a,b)=>b.score-a.score);
  return rows.slice(0,keep).map(({carriers,...row})=>{
    const entry={...row,derived:true,places:placeRefs(ledger,carriers,pools.allSource)};
    entry.ref=ledger.add('tag',entry,{derivedFrom:'all places in the city, with and without the market signal',rule:'share of the market\'s favourite places carrying the tag vs share of the city\'s top places'});
    return entry;
  });
}

// Culture loved by people in the market, split into what people in the host city also love (a
// bridge both visitors and locals enjoy) and what is distinctive to the market. Entities with low
// Qloo popularity or, for artists, fewer than four music tags (actors and celebrities filed as
// artists) are kept for scoring but not shown.
export async function bridgeCulture({qloo,ledger},{city,market,kind='artist',take=50,keep=6,minPopularity=0.5}) {
  const type=CULTURE_TYPES[kind]?.type;
  if (!type) throw new Error(`unknown culture type "${kind}"`);
  const [abroad,local]=await Promise.all([
    qloo.insights({'filter.type':type,'signal.location.query':market.query,take}),
    qloo.insights({'filter.type':type,'signal.location.query':city.query,take})
  ]);
  const localItems=local.entities.map((e,i)=>({...compactEntity(e),rank:i+1}));
  const localRank=new Map(localItems.map((e)=>[e.id,e.rank]));
  const marketItems=abroad.entities.map((e,i)=>({...compactEntity(e),rank:i+1,localRank:localRank.get(e.entity_id) ?? null}));
  const seen=new Set();
  const shown=marketItems.filter((e)=>{
    const key=e.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    if ((e.popularity ?? 0)<minPopularity || seen.has(key) || (kind==='artist' && (e.musicTags ?? 0)<4)) return false;
    seen.add(key);
    return true;
  });
  const register=(items)=>items.map((item)=>({...item,ref:ledger.add(kind,item,source(abroad))}));
  return {
    kind,
    bridge:register(shown.filter((e)=>e.localRank!==null).slice(0,keep)),
    distinct:register(shown.filter((e)=>e.localRank===null).slice(0,keep)),
    marketItems,
    localItems,
    source:source(abroad),
    sources:[source(abroad),source(local)]
  };
}

// Rank known Qloo entities for a market, with ties. Entities Qloo returns no affinity for are
// reported as such rather than ranked last.
export async function rankEntities({qloo,ledger},{market,kind,ids,label}) {
  const type=CULTURE_TYPES[kind]?.type;
  if (!type) throw new Error(`unknown entity type "${kind}"`);
  const out=await qloo.insights({'filter.type':type,'filter.results.entities':ids,'signal.location.query':market.query,take:ids.length});
  const items=out.entities.map((e)=>kind==='place'?compactPlace(e):compactEntity(e));
  const ranks=tiedRanks(items);
  const rankedItems=items.map((item,i)=>{
    const entry={...item,rank:ranks[i].rank,tied:ranks[i].tied,of:ids.length,question:label ?? null};
    return {...entry,ref:ledger.add(kind,entry,source(out))};
  });
  const returned=new Set(rankedItems.map((r)=>r.id));
  return {ranked:rankedItems,noSignal:ids.filter((id)=>!returned.has(id)),source:source(out)};
}

// Score an owner's idea, mapped to a Qloo tag, against the same pools as the taste profile. The tag
// is matched by name in whichever domain carries it: places (ambience, offerings), music (genres)
// or TV. Matching by name counts "Live Music" whether Qloo filed it under good_for or amenity.
const tagKey=(name)=>String(name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

export const VERDICTS=['over-represented','common','too-few','untested','under-represented','absent-from-favourites'];

export function verdictFor(m,M,c,C) {
  if (m===0 && c===0) return 'untested';
  if (m===0) return c>=3?'absent-from-favourites':'too-few';
  if (m<3) return 'too-few';
  const ratio=shareRatio(m,M,c,C);
  if ((ratio===Infinity || ratio>=1.5) && m/M-c/C>=0.05) return 'over-represented';
  if (ratio!==Infinity && ratio<=0.67 && c>=6) return 'under-represented';
  if (m+c<8) return 'too-few';
  return 'common';
}

export function scoreIdea({ledger},domains,{tag,idea}) {
  const key=tagKey(tag.name);
  const carries=(x)=>(x.allTags ?? []).some((n)=>tagKey(n)===key);
  // The tag's own family decides the domain (a music genre is scored against artists); only a tag
  // nobody in its own domain carries falls back to the domain where the name occurs most.
  const family=/^urn:tag:genre:music:/.test(tag.id ?? '')?'music':/^urn:tag:(genre|keyword):(tv|media)/.test(tag.id ?? '')?'TV':'places';
  const counted=domains.map((d)=>{
    const inMarket=d.market.filter(carries);
    const inCity=d.city.filter(carries);
    return {d,inMarket,inCity,total:inMarket.length+inCity.length};
  });
  const own=counted.find((x)=>x.d.label===family);
  const best=own?.total?own:counted.reduce((a,b)=>(b.total>a.total?b:a),own ?? counted[0]);
  const {d,inMarket,inCity}=best;
  const M=d.market.length;
  const C=d.city.length;
  const item={
    id:tag.id,
    name:tag.name,
    idea,
    domain:d.label,
    marketCount:inMarket.length,
    marketTotal:M,
    cityCount:inCity.length,
    cityTotal:C,
    ratio:shareRatio(inMarket.length,M,inCity.length,C),
    verdict:verdictFor(inMarket.length,M,inCity.length,C),
    examples:inMarket.slice(0,4).map((x)=>ledger.add(d.kind,{...x,pool:d.kind==='place'?'all':undefined},d.source))
  };
  item.ref=ledger.add('idea',item,{derivedFrom:d.label,rule:'share of the market\'s favourites carrying the tag vs share of the city\'s top list'});
  return item;
}

const VERDICT_ORDER=Object.fromEntries(VERDICTS.map((v,i)=>[v,i]));

export function rankIdeaScores(scores) {
  const sorted=[...scores].sort((a,b)=>VERDICT_ORDER[a.verdict]-VERDICT_ORDER[b.verdict] || (b.marketCount/b.marketTotal-b.cityCount/b.cityTotal)-(a.marketCount/a.marketTotal-a.cityCount/a.cityTotal));
  return sorted.map((s,i)=>({...s,rank:i+1,of:sorted.length}));
}

export function ideaDomains(places,music,screen) {
  const domains=[{label:'places',kind:'place',market:places.marketList,city:places.baselineList,source:places.allSource}];
  if (music) domains.push({label:'music',kind:'artist',market:music.marketItems,city:music.localItems,source:music.source});
  if (screen) domains.push({label:'TV',kind:'tv_show',market:screen.marketItems,city:screen.localItems,source:screen.source});
  return domains;
}
