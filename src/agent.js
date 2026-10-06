// The taste-brief agent. Three phases:
//   A. fixed Qloo analyses (where the market goes, what sets those places apart, shared culture);
//   B. a Nemotron tool loop that maps the owner's own ideas to Qloo tags or entities and scores them;
//   C. a written brief that may only cite ledger refs, next to an LLM-only answer checked in Qloo.
// The model never supplies a name, rank or count: the UI takes those from the ledger.

import {Ledger, bridgeCulture, ideaDomains, marketPlaces, rankEntities, rankIdeaScores, scoreIdea, tasteProfile} from './analysis.js';
import {CULTURE_TYPES, businessOf, cityOf, marketOf} from './catalog.js';
import {compactEntity, compactPlace} from './qloo.js';

export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
}

export function sameName(a,b) {
  const x=normalize(a);
  const y=normalize(b);
  if (x.length<4 || y.length<4) return x===y && x.length>0;
  if (x===y || x.includes(y) || y.includes(x)) return true;
  // Word order differs between sources ("Cafe Giang" / "Giang Cafe").
  const words=(s)=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().split(/[^a-z0-9]+/).filter((w)=>w.length>1).sort().join(' ');
  return words(a)===words(b) && words(a).length>3;
}

export const LANGS=['en','vi'];

export function readInput(raw={}) {
  const ideas=(Array.isArray(raw.ideas) ? raw.ideas : String(raw.ideas ?? '').split(/\r?\n/))
    .map((s)=>String(s).trim().slice(0,120)).filter(Boolean).slice(0,6);
  const ownPlace=String(raw.ownPlace ?? '').trim().slice(0,80) || null;
  const lang=LANGS.includes(raw.lang) ? raw.lang : 'en';
  return {city:cityOf(raw.city),market:marketOf(raw.market),business:businessOf(raw.business),ideas,ownPlace,lang};
}

const placeMatchesCity=(entity,city)=>city.address.some((key)=>normalize(entity.properties?.address ?? entity.disambiguation).includes(key));

// --- phase A helpers ---------------------------------------------------------------------------

async function locateOwnPlace({qloo,ledger},{ownPlace,city,market,places}) {
  const found=await qloo.search(`${ownPlace} ${city.label}`,{types:'urn:entity:place',take:8});
  const match=found.entities.find((e)=>placeMatchesCity(e,city));
  if (!match) return {query:ownPlace,found:false};
  const self=compactPlace(match);
  const against=places.peers.length>=3?places.peers:places.allPlaces;
  const peers=against.filter((p)=>p.id!==self.id).slice(0,9).map((p)=>p.id);
  const ranked=await rankEntities({qloo,ledger},{market,kind:'place',ids:[self.id,...peers],label:'owner place among market favourites'});
  const mine=ranked.ranked.find((r)=>r.id===self.id);
  return {
    query:ownPlace,
    found:true,
    name:self.name,
    address:self.address,
    image:self.image,
    against:against===places.peers?'peers':'all',
    ref:mine?.ref ?? null,
    rank:mine?.rank ?? null,
    tied:mine?.tied ?? false,
    of:ranked.ranked.length,
    noSignal:!mine
  };
}

// --- phase B: idea-mapping tool loop -----------------------------------------------------------

const KINDS=['artist','movie','tv_show','book','brand','place','podcast','video_game'];
const AGENT_TOOLS=[
  {type:'function',function:{
    name:'find_tags',
    description:'Search Qloo tags by keyword (1-3 words). Returns candidate tags with how many places, artists and TV shows in the two comparison lists carry each one.',
    parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}
  }},
  {type:'function',function:{
    name:'search_entities',
    description:'Search Qloo entities by name when an idea names a specific film, TV show, artist, book, brand or place.',
    parameters:{type:'object',properties:{query:{type:'string'},kind:{type:'string',enum:KINDS}},required:['query','kind']}
  }},
  {type:'function',function:{
    name:'rank_ideas_by_tags',
    description:'Score several ideas together: for each idea\'s Qloo tag, how many of the visitor market\'s favourites carry it compared with the city\'s top list. Use tag ids returned by find_tags only.',
    parameters:{type:'object',properties:{mappings:{type:'array',items:{type:'object',properties:{idea:{type:'string'},tag_id:{type:'string'}},required:['idea','tag_id']}}},required:['mappings']}
  }},
  {type:'function',function:{
    name:'rank_ideas_by_entities',
    description:'Rank ideas that map to specific entities of one kind by the visitor market\'s affinity. Use entity ids returned by search_entities only.',
    parameters:{type:'object',properties:{kind:{type:'string',enum:KINDS},mappings:{type:'array',items:{type:'object',properties:{idea:{type:'string'},entity_id:{type:'string'}},required:['idea','entity_id']}}},required:['kind','mappings']}
  }}
];

// The most common tag names in the comparison lists, so the agent can map ideas to tags that real
// places and artists actually carry.
function vocabulary(domains,limit) {
  const out=[];
  for (const d of domains) {
    const counts=new Map();
    for (const x of [...d.market,...d.city]) for (const n of new Set(d.kind==='place'?x.tags.map((t)=>t.name):x.allTags)) counts.set(n,(counts.get(n) ?? 0)+1);
    const top=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([n])=>n);
    out.push(`${d.label}: ${top.join(', ')}`);
  }
  return out.join('\n');
}

async function runIdeaAgent(ctx,{llm,input,domains,step,maxTurns=10}) {
  const {qloo,ledger}=ctx;
  const {city,market,business,ideas}=input;
  const seenTags=new Map();
  const seenEntities=new Map();
  const results=new Map(ideas.map((idea)=>[idea,{idea,status:'unmapped'}]));
  const matchIdea=(text)=>ideas.find((i)=>i===text) ?? ideas.find((i)=>sameName(i,text));
  const tagCount=(name)=>{
    const key=name.toLowerCase();
    return Object.fromEntries(domains.map((d)=>[d.label,[...d.market,...d.city].filter((x)=>(x.allTags ?? []).some((n)=>n.toLowerCase()===key)).length]));
  };
  // Re-scoring an idea replaces its earlier score in the ledger.
  const setResult=(idea,value)=>{
    const old=results.get(idea);
    if (old?.ref && old.ref!==value.ref) ledger.remove(old.ref);
    results.set(idea,value);
  };

  const handlers={
    async find_tags({query}) {
      const out=await qloo.tags(String(query).slice(0,40),{take:10});
      const byName=new Map();
      for (const t of out.tags) {
        const tag={id:t.id ?? t.tag_id,name:t.name,family:(t.type ?? t.subtype ?? '').replace('urn:tag:','')};
        if (tag.id && tag.name && !byName.has(tag.name.toLowerCase())) byName.set(tag.name.toLowerCase(),tag);
      }
      const tags=[...byName.values()].map((t)=>({...t,carried_by:tagCount(t.name)}));
      for (const t of tags) seenTags.set(t.id,t);
      return {tags};
    },
    async search_entities({query,kind}) {
      const type=CULTURE_TYPES[kind]?.type;
      if (!type) return {error:`unknown kind ${kind}`};
      const out=await qloo.search(String(query).slice(0,60),{types:type,take:5});
      const entities=out.entities.map((e)=>kind==='place'?compactPlace(e):compactEntity(e)).map((e)=>({id:e.id,name:e.name,detail:e.address ?? e.disambiguation ?? null}));
      for (const e of entities) seenEntities.set(e.id,{...e,kind});
      return {entities};
    },
    async rank_ideas_by_tags({mappings=[]}) {
      const valid=mappings.filter((m)=>seenTags.has(m.tag_id) && matchIdea(m.idea));
      const rejected=mappings.filter((m)=>!valid.includes(m)).map((m)=>({...m,reason:'tag id was not returned by find_tags, or idea text does not match the owner list'}));
      if (!valid.length) return {error:'no valid mappings',rejected};
      const ranked=rankIdeaScores(valid.map((m)=>scoreIdea(ctx,domains,{tag:seenTags.get(m.tag_id),idea:matchIdea(m.idea)})));
      for (const r of ranked) setResult(r.idea,{idea:r.idea,status:'ranked',ref:r.ref,via:{kind:'tag',id:r.id,name:r.name},domain:r.domain,rank:r.rank,of:r.of,verdict:r.verdict,ratio:r.ratio,marketCount:r.marketCount,marketTotal:r.marketTotal,cityCount:r.cityCount,cityTotal:r.cityTotal,examples:r.examples});
      const untested=ranked.filter((r)=>r.verdict==='untested').map((r)=>r.idea);
      return {
        ranked:ranked.map((r)=>({ref:r.ref,idea:r.idea,tag:r.name,in:r.domain,market_favourites_with_tag:`${r.marketCount}/${r.marketTotal}`,city_list_with_tag:`${r.cityCount}/${r.cityTotal}`,verdict:r.verdict})),
        hint:untested.length?`Nothing in either list carries the tag chosen for: ${untested.join('; ')}. Check the carried_by counts from find_tags and pick a tag that real places or artists carry, if one still captures the idea; otherwise leave it untested.`:undefined,
        rejected
      };
    },
    async rank_ideas_by_entities({kind,mappings=[]}) {
      const valid=mappings.filter((m)=>seenEntities.get(m.entity_id)?.kind===kind && matchIdea(m.idea));
      if (!valid.length) return {error:'no valid mappings; use entity ids returned by search_entities with the same kind'};
      const ideaById=Object.fromEntries(valid.map((m)=>[m.entity_id,matchIdea(m.idea)]));
      const out=await rankEntities(ctx,{market,kind,ids:[...new Set(valid.map((m)=>m.entity_id))],label:'owner idea'});
      for (const r of out.ranked) setResult(ideaById[r.id],{idea:ideaById[r.id],status:'ranked',ref:r.ref,via:{kind,id:r.id,name:r.name},rank:r.rank,of:r.of});
      for (const id of out.noSignal) setResult(ideaById[id],{idea:ideaById[id],status:'no-signal',via:{kind,id,name:seenEntities.get(id)?.name}});
      return {ranked:out.ranked.map((r)=>({ref:r.ref,idea:ideaById[r.id],entity:r.name,rank:r.rank,of:r.of})),no_signal:out.noSignal};
    }
  };

  const messages=[
    {role:'system',content:[
      `You research ideas for a small ${business.label.toLowerCase()} in ${city.label}, Vietnam that wants more guests from ${market.label} (${market.country}).`,
      'For each owner idea, find the single Qloo tag that best captures what is specific about it with find_tags (short keywords: "egg coffee", "live music", "cycling", "k-pop").',
      'Prefer a tag whose carried_by counts are above zero: the score compares real places, artists or TV shows that carry it. Music ideas map to music genre tags (K-Pop), place ideas to place tags.',
      'Tag names that occur in the comparison lists:',
      vocabulary(domains,45),
      'Use search_entities only when an idea names a specific film, show, artist, brand or place.',
      'Score ALL mapped tag ideas together in one rank_ideas_by_tags call (entity ideas in rank_ideas_by_entities). Copy each idea exactly as the owner wrote it.',
      'If the hint says nothing carries a tag, retry that idea once. When done, reply with one short sentence and no tool call.'
    ].join('\n')},
    {role:'user',content:`Owner ideas:\n${ideas.map((i,n)=>`${n+1}. ${i}`).join('\n')}`}
  ];

  for (let turn=0; turn<maxTurns; turn+=1) {
    if (turn===maxTurns-3 && [...results.values()].some((r)=>r.status==='unmapped')) {
      messages.push({role:'user',content:'You are almost out of steps. Score every idea now with rank_ideas_by_tags, using the best tags you have already found.'});
    }
    let message;
    try {
      ({message}=await llm.chatTools({messages,tools:AGENT_TOOLS}));
    } catch (error) {
      // One retry for a dropped connection; after that, stop and score with what was found.
      try {
        ({message}=await llm.chatTools({messages,tools:AGENT_TOOLS}));
      } catch {
        step('agent','Model unavailable; scoring with the tags found so far',error.message);
        break;
      }
    }
    const calls=message.tool_calls ?? [];
    messages.push({role:'assistant',content:message.content ?? '',tool_calls:calls.length?calls:undefined});
    if (!calls.length) break;
    for (const call of calls) {
      let args;
      try { args=JSON.parse(call.function.arguments || '{}'); } catch { args={}; }
      const handler=handlers[call.function.name];
      let result;
      try {
        result=handler ? await handler(args) : {error:`unknown tool ${call.function.name}`};
      } catch (error) {
        result={error:error.message};
      }
      step('agent',describeCall(call.function.name,args),result.error ? `error: ${result.error}` : summarizeToolResult(call.function.name,result));
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,6000)});
    }
  }
  // If the model ran out of turns before scoring, score each remaining idea with the tag it found
  // whose name shares the most words with the idea (ties go to the tag more places carry).
  const pending=ideas.filter((idea)=>results.get(idea).status==='unmapped');
  if (pending.length && seenTags.size) {
    const words=(s)=>new Set(String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').split(/[^a-z0-9]+/).filter((w)=>w.length>2));
    const mappings=[];
    for (const idea of pending) {
      const iw=words(idea);
      let best=null;
      for (const tag of seenTags.values()) {
        const overlap=[...words(tag.name)].filter((w)=>iw.has(w)).length;
        const carried=Object.values(tag.carried_by ?? {}).reduce((a,b)=>a+b,0);
        if (overlap && (!best || overlap>best.overlap || (overlap===best.overlap && carried>best.carried))) best={tag,overlap,carried};
      }
      if (best) mappings.push({idea,tag_id:best.tag.id});
    }
    if (mappings.length) {
      const result=await handlers.rank_ideas_by_tags({mappings});
      step('agent',`Score ${mappings.length} remaining idea${mappings.length>1?'s':''} with the closest tags found`,result.error ?? summarizeToolResult('rank_ideas_by_tags',result));
    }
  }
  return ideas.map((idea)=>results.get(idea));
}

function describeCall(name,args) {
  if (name==='find_tags') return `Look up Qloo tags for “${args.query}”`;
  if (name==='search_entities') return `Search Qloo for ${String(args.kind ?? '').replace('_',' ')} “${args.query}”`;
  if (name==='rank_ideas_by_tags') return `Score ${args.mappings?.length ?? 0} idea${args.mappings?.length===1?'':'s'} against the two lists`;
  if (name==='rank_ideas_by_entities') return `Rank ${args.mappings?.length ?? 0} named ${String(args.kind ?? '').replace('_',' ')}s for the market`;
  return name;
}

function summarizeToolResult(name,result) {
  if (name==='find_tags') return result.tags.slice(0,4).map((t)=>t.name).join(', ');
  if (name==='search_entities') return result.entities.slice(0,3).map((e)=>e.name).join(', ');
  if (name==='rank_ideas_by_tags') return (result.ranked ?? []).map((r)=>`${r.idea} → ${r.tag}: ${r.market_favourites_with_tag} vs ${r.city_list_with_tag} (${r.verdict})`).join('; ');
  return `${result.ranked?.length ?? 0} ranked${result.no_signal?.length?`, ${result.no_signal.length} without a market signal`:''}`;
}

// --- phase C: brief and LLM-only contrast ------------------------------------------------------

const BRIEF_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['headline','summary','actions','partners','playlist','ideas','caveats'],
  properties:{
    headline:{type:'string'},
    summary:{type:'string'},
    actions:{type:'array',items:{type:'object',additionalProperties:false,required:['title','detail','refs'],properties:{title:{type:'string'},detail:{type:'string'},refs:{type:'array',items:{type:'string'}}}}},
    partners:{type:'array',items:{type:'object',additionalProperties:false,required:['ref','why'],properties:{ref:{type:'string'},why:{type:'string'}}}},
    playlist:{type:'array',items:{type:'object',additionalProperties:false,required:['ref','why'],properties:{ref:{type:'string'},why:{type:'string'}}}},
    ideas:{type:'array',items:{type:'object',additionalProperties:false,required:['ref','note'],properties:{ref:{type:'string'},note:{type:'string'}}}},
    caveats:{type:'array',items:{type:'string'}}
  }
};

const fmtRatio=(r)=>r===Infinity?'only among their favourites':r===null||r===undefined?'':`${r.toFixed(1)}× as common`;
const rankText=(p)=>`${p.tied?'=':''}${p.rank}`;

export function factSheet({input,places,profile,music,screen,own,ideas,audience}) {
  const {city,market,business}=input;
  const lines=[`Business: ${business.label} in ${city.label}, Vietnam. Visitor market: people living in ${market.label}, ${market.country}.`,''];
  if (places.peers.length) {
    lines.push(`${business.plural} in ${city.label} with a measurable ${market.label} signal (${places.peerCount} found), ranked by the taste of people in ${market.label}; "city rank" is the rank among ${city.label}'s top ${business.plural} without that signal:`);
    for (const p of places.peers) lines.push(`${p.ref} ${p.name}${p.neighborhood?` (${p.neighborhood})`:''} — market rank ${rankText(p)}, city rank ${p.cityRank ?? 'not in the top list'}${p.tags.length?` — tags: ${p.tags.slice(0,6).map((t)=>t.name).join(', ')}`:''}`);
  } else {
    lines.push(`Qloo measures no ${market.label} signal for ${business.plural} in ${city.label}.`);
  }
  if (places.allPlaces.length) {
    lines.push('',`All kinds of places in ${city.label} favoured by people in ${market.label} (hotels, restaurants, attractions), with their city-wide rank:`);
    for (const p of places.allPlaces) lines.push(`${p.ref} ${p.name} (${(p.genre ?? 'place').replace(/_/g,' ').replace('restaurant:','')}${p.neighborhood?`, ${p.neighborhood}`:''}) — market rank ${rankText(p)}, city rank ${p.cityRank ?? 'not in top 50'}`);
  }
  lines.push('',`Tags clearly more common among ALL KINDS of places people in ${market.label} favour in ${city.label} (mostly restaurants, bars and hotels — not specifically ${business.plural}) than among the city's top places. Do not write that people prefer ${business.plural} with these traits; write that these traits are common in the places they favour:`);
  if (!profile.length) lines.push('(none clear enough to report)');
  for (const t of profile) lines.push(`${t.ref} "${t.name}" (${t.family}) — ${t.marketCount}/${t.marketTotal} of their favourites vs ${t.baselineCount}/${t.baselineTotal} city-wide, ${fmtRatio(t.ratio)} — e.g. ${t.places.join(', ')}`);
  if (audience) lines.push('',`Audience of the top favourites (Qloo demographics of each place's audience overall, not only ${market.label}): ${audience.summary}`);
  for (const [label,block] of [['Music',music],['TV',screen]]) {
    if (!block) continue;
    lines.push('',`${label} loved by people in ${market.label} that people in ${city.label} also love (bridge):`);
    if (!block.bridge.length) lines.push('(none in both top lists)');
    for (const c of block.bridge) lines.push(`${c.ref} ${c.name} — ${market.label} rank ${c.rank}, ${city.label} rank ${c.localRank}`);
    lines.push(`${label} loved in ${market.label} but not in ${city.label}'s top list (distinct):`);
    for (const c of block.distinct) lines.push(`${c.ref} ${c.name} — ${market.label} rank ${c.rank}`);
  }
  if (own) {
    lines.push('');
    if (!own.found) lines.push(`Owner's place "${own.query}" was not found in Qloo for ${city.label}.`);
    else if (own.noSignal) lines.push(`Owner's place ${own.name} is in Qloo but shows no measurable ${market.label} affinity next to the market favourites.`);
    else lines.push(`${own.ref} Owner's place ${own.name} ranks ${own.tied?'joint ':''}${own.rank} of ${own.of} when Qloo ranks it with the top market favourites.`);
  }
  if (ideas.length) {
    lines.push('','Owner ideas, scored against the same lists. Verdicts: over-represented = clearly more common among the market\'s favourites (a real signal); common = about as common as city-wide (not a differentiator); under-represented = less common among their favourites; absent-from-favourites = offered in the city but by none of their favourites; too-few = under 3 favourites carry it, too few to tell; untested = nothing in either list carries it.');
    for (const i of ideas) {
      if (i.status==='ranked' && i.via.kind==='tag') {
        const what={places:'places',music:'artists',TV:'TV shows'}[i.domain] ?? i.domain;
        lines.push(`${i.ref} "${i.idea}" → tag "${i.via.name}": carried by ${i.marketCount} of the ${i.marketTotal} ${what} people in ${market.label} favour vs ${i.cityCount} of the ${i.cityTotal} ${what} people in ${city.label} favour — verdict ${i.verdict}${i.examples?.length?` — e.g. ${i.examples.join(', ')}`:''}`);
      }
      else if (i.status==='ranked') lines.push(`${i.ref} "${i.idea}" → ${i.via.kind} "${i.via.name}" — rank ${i.rank} of ${i.of} for ${market.label} taste`);
      else if (i.status==='no-signal') lines.push(`(no ref) "${i.idea}" → ${i.via.kind} "${i.via.name}" — no ${market.label} affinity`);
      else lines.push(`(no ref) "${i.idea}" — no matching Qloo tag or entity`);
    }
  }
  return lines.join('\n');
}

const VIETNAMESE=/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

const TRANSLATION_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['headline','summary','actions','partners','playlist','ideas','caveats','advice'],
  properties:{
    headline:{type:'string'},
    summary:{type:'string'},
    actions:{type:'array',items:{type:'object',additionalProperties:false,required:['title','detail'],properties:{title:{type:'string'},detail:{type:'string'}}}},
    partners:{type:'array',items:{type:'string'}},
    playlist:{type:'array',items:{type:'string'}},
    ideas:{type:'array',items:{type:'string'}},
    caveats:{type:'array',items:{type:'string'}},
    advice:{type:'string'}
  }
};

// Common English words that should not survive a translation (names are exempt because they are
// checked against the protected list).
const ENGLISH_LEFTOVER=/\b(the|and|with|for|your|this|that|several|locally|sourced|guests|visitors|offer|serve|menu)\b/i;

export function translationProblems(src,out,names) {
  const problems=[];
  const lists=['actions','partners','playlist','ideas','caveats'];
  for (const k of lists) if ((out[k] ?? []).length!==(src[k] ?? []).length) problems.push(`${k} count changed`);
  const all=[out.headline,out.summary,...(out.actions ?? []).flatMap((a)=>[a.title,a.detail]),...(out.partners ?? []),...(out.playlist ?? []),...(out.ideas ?? []),...(out.caveats ?? [])].join(' \n ');
  if (!VIETNAMESE.test(out.headline ?? '') || !VIETNAMESE.test(out.summary ?? '')) problems.push('not Vietnamese');
  if (FOREIGN_SCRIPT.test(all)) problems.push('foreign script');
  let stripped=all;
  for (const n of names) if (n) stripped=stripped.split(n).join(' ');
  const leftover=stripped.match(ENGLISH_LEFTOVER);
  if (leftover) problems.push(`English left: ${leftover[0]}`);
  return problems;
}

// Translate the checked English brief with a multilingual model, keeping names exactly. Refs stay
// on the English structure, so citations cannot change. Falls back to English if the result fails
// the checks twice.
export async function translateBrief(translator,brief,{advice='',names=[]}={}) {
  const src={
    headline:brief.headline,summary:brief.summary,
    actions:brief.actions.map((a)=>({title:a.title,detail:a.detail})),
    partners:brief.partners.map((p)=>p.why),
    playlist:brief.playlist.map((p)=>p.why),
    ideas:brief.ideas.map((i)=>i.note),
    caveats:brief.caveats,
    advice
  };
  const protectedNames=[...new Set(names.filter((n)=>n && n.length>1))].slice(0,120);
  let lastProblems=[];
  for (let attempt=0; attempt<2; attempt+=1) {
    const {data}=await translator.chatJSON({
      schemaName:'vietnamese_brief',
      schema:TRANSLATION_SCHEMA,
      system:[
        'Translate this JSON from English into natural, plain Vietnamese for the owner of a small hospitality business in Vietnam.',
        'Keep exactly the same structure and the same number of items in every list.',
        'Do not translate these names; copy them exactly: '+protectedNames.join(' | '),
        'Write numbers as given (8/50, 2.2×). Use no English words other than those names.',
        attempt?'Your previous answer had problems: '+lastProblems.join('; ')+'. Fix them.':''
      ].join('\n'),
      user:JSON.stringify(src)
    });
    lastProblems=translationProblems(src,data,protectedNames);
    if (!lastProblems.length) {
      return {
        brief:{
          ...brief,
          headline:data.headline,
          summary:data.summary,
          actions:brief.actions.map((a,i)=>({...a,title:data.actions[i].title,detail:data.actions[i].detail})),
          partners:brief.partners.map((p,i)=>({...p,why:data.partners[i]})),
          playlist:brief.playlist.map((p,i)=>({...p,why:data.playlist[i]})),
          ideas:brief.ideas.map((x,i)=>({...x,note:data.ideas[i]})),
          caveats:data.caveats,
          lang:'vi'
        },
        advice:data.advice
      };
    }
  }
  throw new Error(`translation rejected: ${lastProblems.join('; ')}`);
}
const FOREIGN_SCRIPT=/[Ѐ-ӿ֐-ۿ]/;

// The brief is always written and checked in English (the name and citation checks work on it);
// a Vietnamese reader gets a translation of the checked brief.
async function writeBrief(llm,facts,input) {
  const {market,business}=input;
  const {data}=await llm.chatJSON({
    schemaName:'taste_brief',
    schema:BRIEF_SCHEMA,
    system:[
      'You write a one-page plan for a small hospitality business owner. Plain, concrete English; no hype.',
      'Use ONLY the facts provided. Every action must cite one or more refs (P#, T#, C#, I#) that support it, in its refs array.',
      'In text fields write names, never refs. Do not name any place, street, river, beach, dish, product or event that is not in the facts.',
      `The tag findings (T refs) describe all kinds of places people in ${market.label} favour — restaurants, bars, hotels — not only ${business.plural}; never say they describe ${business.plural}. Translate them into what a ${business.label.toLowerCase()} can do.`,
      `The signal is the aggregate taste of people living in ${market.label}, not of tourists or of any individual: say "people in ${market.label}" or "${market.label} audiences", and never claim what a specific guest will do.`,
      'headline: one sentence, 8 to 16 words, stating the single most useful finding (name at most two attributes, not a list); never present an untested or too-few idea as something the market favours.',
      'summary: two or three sentences.',
      'actions: 3 to 5, each with a short imperative title and one or two sentences saying what to do and which fact supports it.',
      'Only recommend adding an owner idea when its verdict is over-represented. For common, under-represented or absent ideas, say not to lead with them; for untested or too-few ideas, suggest at most a cheap trial.',
      'partners: up to 4 places from the P refs (any kind) worth partnering with or recommending to guests, with a one-sentence why.',
      'playlist: up to 6 music refs, bridge artists first, each with a short why. ideas: one note per owner idea that has an I ref, consistent with its verdict.',
      'caveats: two or three things the data does not establish. Fill every field.'
    ].join(' '),
    user:facts
  });
  return data;
}

const ADD_WORDS=/\b(add|introduce|launch|offer|host|start|create|feature)\b|thêm|mở|tổ chức|ra mắt|bổ sung/i;
const HOLD_WORDS=/\b(skip|drop|avoid|don'?t|do not|not lead|pause|test|trial|pilot|small|cheap)\b|thử|bỏ|tránh|đừng|không/i;

const PLACE_NOUN=/^(River|Beach|Street|Road|Market|Lake|Temple|Pagoda|Bridge|Island|Mountain|Bay|Park|Square|Tower|Museum|Café|Cafe|Hotel|Resort|Restaurant|Bar|Sông|Bãi|Biển|Chùa|Chợ|Phố|Đường|Hồ|Cầu|Đảo|Núi|Vịnh)$/u;

function withinOneEdit(a,b) {
  if (Math.abs(a.length-b.length)>1) return false;
  let i=0;
  let j=0;
  let edits=0;
  while (i<a.length && j<b.length) {
    if (a[i]===b[j]) { i+=1; j+=1; continue; }
    edits+=1;
    if (edits>1) return false;
    if (a.length>b.length) i+=1; else if (b.length>a.length) j+=1; else { i+=1; j+=1; }
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}

// Capitalised multi-word names in prose that never appear in the facts are likely invented
// (a river, a beach, a dish). Sentence-initial words are ignored, commas and hyphens end a name,
// and a one-letter slip in a known name ("Ritchie" for "Richie") is tolerated.
export function unknownNames(text,facts) {
  const knownText=normalize(facts);
  const knownWords=new Set(String(facts).normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/gi,'d').toLowerCase().split(/[^a-z0-9]+/).filter((w)=>w.length>=3));
  const isKnown=(word)=>{
    const k=normalize(word);
    if (k.length<3 || knownText.includes(k)) return true;
    if (k.length<5) return false;
    for (const w of knownWords) if (withinOneEdit(k,w)) return true;
    return false;
  };
  const found=[];
  for (const sentence of String(text ?? '').split(/(?<=[.!?;:])\s+/)) {
    const tokens=sentence.split(/(\s+|[,()–—\-/;、]+)/);
    let run=[];
    let first=true;
    // A run is suspicious when two of its words are unknown, or when one is unknown and the run
    // names a kind of place ("Thu Bon River", "Chợ Hàn"). A lone unknown adjective ("Muslim
    // Singapore") is not.
    const flush=()=>{
      if (run.length>=2) {
        const unknown=run.filter((w)=>!isKnown(w)).length;
        if (unknown>=2 || (unknown===1 && run.some((w)=>PLACE_NOUN.test(w)))) found.push(run.join(' '));
      }
      run=[];
    };
    for (const token of tokens) {
      if (/^\s+$/.test(token) || token==='') continue;
      if (/^[,()–—\-/;、]+$/.test(token)) { flush(); continue; }
      const word=token.replace(/[^\p{L}\p{N}'’&]/gu,'');
      if (!word) { flush(); continue; }
      if (!first && /^\p{Lu}/u.test(word)) run.push(word); else flush();
      first=false;
    }
    flush();
  }
  return found;
}

export function validateBrief(brief,ledger,facts='') {
  const kindOf=(ref)=>ledger.get(ref)?.kind;
  const verdictOf=(ref)=>ledger.get(ref)?.item?.verdict;
  // The model is told to write names, not refs; when a ref slips into prose, show the name.
  const text=(s,max)=>String(s ?? '').replace(/\b[PTCI]\d{1,3}\b/g,(ref)=>ledger.get(ref)?.item?.name ?? ref).slice(0,max);
  const okRefs=(refs)=>[...new Set((refs ?? []).filter((r)=>ledger.has(r)))];
  const dropped=[];
  const actions=[];
  for (const a of brief.actions ?? []) {
    const action={title:text(a.title,160),detail:text(a.detail,600),refs:okRefs(a.refs)};
    const weakIdea=action.refs.find((r)=>kindOf(r)==='idea' && verdictOf(r)!=='over-represented');
    const invented=facts?unknownNames(action.detail,facts):[];
    if (FOREIGN_SCRIPT.test(`${action.title} ${action.detail}`)) dropped.push({title:action.title,reason:'garbled text'});
    else if (!action.refs.length) dropped.push({title:action.title,reason:'no valid citation'});
    else if (weakIdea && ADD_WORDS.test(action.title) && !HOLD_WORDS.test(`${action.title} ${action.detail}`)) dropped.push({title:action.title,reason:`recommends an idea whose verdict is ${verdictOf(weakIdea)}`});
    else if (invented.length) dropped.push({title:action.title,reason:`names not in the data: ${invented.join(', ')}`});
    else actions.push(action);
  }
  return {
    headline:text(brief.headline,200),
    summary:text(brief.summary,800),
    actions:actions.slice(0,5),
    partners:(brief.partners ?? []).filter((p)=>kindOf(p.ref)==='place').slice(0,4).map((p)=>({ref:p.ref,why:text(p.why,300)})),
    playlist:(brief.playlist ?? []).filter((p)=>kindOf(p.ref)==='artist').slice(0,6).map((p)=>({ref:p.ref,why:text(p.why,200)})),
    ideas:(brief.ideas ?? []).filter((i)=>kindOf(i.ref)==='idea' || kindOf(i.ref)==='place' || CULTURE_TYPES[kindOf(i.ref)]).map((i)=>({ref:i.ref,note:text(i.note,400)})),
    caveats:(brief.caveats ?? []).map((c)=>text(c,300)).slice(0,5),
    dropped
  };
}

// Without a model the brief is assembled from the analyses by rule, so the page still works.
export function ruleBrief({input,places,profile,music},reason='no language model configured') {
  const {city,market,business}=input;
  const actions=[];
  if (profile.length) actions.push({title:`Lean into "${profile[0].name}"`,detail:`Among the places people in ${market.label} favour in ${city.label}, ${profile[0].marketCount} of ${profile[0].marketTotal} carry this tag, against ${profile[0].baselineCount} of ${profile[0].baselineTotal} city-wide.`,refs:[profile[0].ref,...profile[0].places.slice(0,3)]});
  if (places.peers.length) actions.push({title:`Study the ${business.plural} this market favours`,detail:`These ${business.plural} rank highest for the taste of people in ${market.label}.`,refs:places.peers.slice(0,3).map((p)=>p.ref)});
  if (music?.bridge.length) actions.push({title:'Play music both sides know',detail:`Artists loved in ${market.label} that ${city.label} also loves.`,refs:music.bridge.slice(0,4).map((c)=>c.ref)});
  return {
    headline:`What people in ${market.label} favour in ${city.label}`,
    summary:`Assembled by rule from Qloo results (${reason}).`,
    actions,
    partners:places.allPlaces.slice(0,3).map((p)=>({ref:p.ref,why:`Rank ${p.rank} for ${market.label} taste.`})),
    playlist:(music?.bridge ?? []).slice(0,5).map((c)=>({ref:c.ref,why:'Loved in both cities.'})),
    ideas:[],
    caveats:['Qloo describes aggregate taste of people in a city, not any individual guest.'],
    dropped:[]
  };
}

const BASELINE_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['places','artists','advice'],
  properties:{
    places:{type:'array',minItems:5,maxItems:5,items:{type:'object',additionalProperties:false,required:['name','why'],properties:{name:{type:'string'},why:{type:'string'}}}},
    artists:{type:'array',minItems:5,maxItems:5,items:{type:'object',additionalProperties:false,required:['name','why'],properties:{name:{type:'string'},why:{type:'string'}}}},
    advice:{type:'string'}
  }
};

const cleanName=(text)=>String(text ?? '').replace(/[*_`#]/g,'').replace(/^\s*\d+[.)]\s*/,'').split(/\s[–—-]\s|,|\(/)[0].trim().slice(0,80);

// The same question asked of the model alone. Each place it names is then looked up in Qloo and
// ranked with the market signal, so the comparison is fair to well-known places Qloo also knows.
async function llmOnlyBaseline(llm,{qloo,ledger},{input,places,music}) {
  const {city,market,business}=input;
  const {data}=await llm.chatJSON({
    schemaName:'llm_only',
    schema:BASELINE_SCHEMA,
    system:'You are a helpful assistant answering from general knowledge. Fill every field: exactly 5 places, exactly 5 artists, and advice of three to five sentences.',
    user:`I run a ${business.label.toLowerCase()} in ${city.label}, Vietnam and want more guests from ${market.label}, ${market.country}. List 5 specific ${business.plural} in ${city.label} that people from ${market.label} love (name only in "name"), 5 music artists for a playlist that would make them feel at home (name only in "name"), and one short paragraph of advice.`
  });
  const picks=(data.places ?? []).slice(0,5).map((p)=>({name:cleanName(p.name)})).filter((p)=>p.name);
  await Promise.all(picks.map(async (pick)=>{
    try {
      const found=await qloo.search(`${pick.name} ${city.label}`,{types:'urn:entity:place',take:5});
      const hit=found.entities.find((e)=>placeMatchesCity(e,city) && sameName(e.name,pick.name));
      if (hit) { pick.id=hit.entity_id; pick.qlooName=hit.name; }
    } catch { /* leave as not found */ }
  }));
  const ids=[...new Set(picks.filter((p)=>p.id).map((p)=>p.id))];
  let signal=new Map();
  if (ids.length) {
    const out=await rankEntities({qloo,ledger},{market,kind:'place',ids,label:'model pick checked in Qloo'}).catch(()=>null);
    if (out) signal=new Map(out.ranked.map((r)=>[r.id,r]));
  }
  const peerRank=new Map(places.peers.map((p)=>[p.id,p.rank]));
  const allRank=new Map(places.marketList.map((p,i)=>[p.id,i+1]));
  const artistPool=music?.marketItems ?? [];
  const localPool=music?.localItems ?? [];
  return {
    places:picks.map((p)=>({
      name:p.name,
      qlooName:p.qlooName ?? null,
      inQloo:Boolean(p.id),
      marketSignal:p.id?signal.has(p.id):false,
      ref:p.id?signal.get(p.id)?.ref ?? null:null,
      peerRank:p.id?peerRank.get(p.id) ?? null:null,
      allRank:p.id?allRank.get(p.id) ?? null:null
    })),
    artists:(data.artists ?? []).slice(0,6).map((a)=>{
      const name=cleanName(a.name);
      return {name,qlooRank:artistPool.find((x)=>sameName(x.name,name))?.rank ?? null,localRank:localPool.find((x)=>sameName(x.name,name))?.rank ?? null};
    }),
    advice:String(data.advice ?? '').slice(0,900),
    poolSizes:{peers:places.peerCount,all:places.marketList.length,artists:artistPool.length}
  };
}

// Qloo demographics of the top favourites' audiences: which age band and gender over-index.
const AGE_LABEL={'24_and_younger':'24 and under','25_to_29':'25–29','30_to_34':'30–34','35_to_44':'35–44','45_to_54':'45–54','55_and_older':'55+'};
export async function audienceOf({qloo},list) {
  const ids=list.slice(0,6).map((p)=>p.id);
  if (!ids.length) return null;
  const out=await qloo.insights({'filter.type':'urn:demographics','signal.interests.entities':ids});
  const rows=out.body.results?.demographics ?? [];
  if (!rows.length) return null;
  const avg=(pick)=>{
    const sums={};
    for (const r of rows) for (const [k,v] of Object.entries(pick(r.query) ?? {})) sums[k]=(sums[k] ?? 0)+v/rows.length;
    return sums;
  };
  const age=avg((q)=>q?.age);
  const gender=avg((q)=>q?.gender);
  const topAge=Object.entries(age).sort((a,b)=>b[1]-a[1])[0];
  const topGender=Object.entries(gender).sort((a,b)=>b[1]-a[1])[0];
  const summary=[topAge && topAge[1]>0.05?`skews ${AGE_LABEL[topAge[0]] ?? topAge[0]}`:'no clear age skew',topGender && topGender[1]>0.05?`leans ${topGender[0]}`:'balanced by gender'].join(', ');
  return {age,gender,summary,places:rows.length,source:{endpoint:out.path,params:out.params}};
}

// --- entry point -------------------------------------------------------------------------------

export async function buildBrief(rawInput,{qloo,llm,translator=null,onEvent=()=>{},now=()=>Date.now()}) {
  if (!qloo) throw new Error('QLOO_API_KEY is not configured');
  const input=readInput(rawInput);
  const {city,market,business,ideas,ownPlace,lang}=input;
  const ledger=new Ledger();
  const ctx={qloo,ledger};
  const t0=now();
  const trace=[];
  const step=(phase,label,detail=null)=>{
    const event={ms:now()-t0,phase,label,detail};
    trace.push(event);
    onEvent({type:'step',...event});
  };

  step('qloo',`Rank places in ${city.label} by the taste of people in ${market.label}, and without it`);
  step('qloo',`Music and TV loved in ${market.label}, checked against ${city.label}`);
  const [places,music,screen]=await Promise.all([
    marketPlaces(ctx,{city,market,business}),
    bridgeCulture(ctx,{city,market,kind:'artist'}),
    bridgeCulture(ctx,{city,market,kind:'tv_show'}).catch(()=>null)
  ]);
  const profile=tasteProfile(ctx,places);
  const domains=ideaDomains(places,music,screen);
  step('qloo',`${places.peerCount} ${business.plural} and ${places.marketList.length} places with a ${market.label} signal; ${profile.length} tags stand out; ${music.bridge.length} shared artists`);

  const favourites=places.peers.length>=3?places.peers:places.allPlaces;
  const [own,audience]=await Promise.all([
    ownPlace?locateOwnPlace(ctx,{ownPlace,city,market,places}).catch((error)=>({query:ownPlace,found:false,error:error.message})):null,
    audienceOf(ctx,favourites).catch(()=>null)
  ]);
  if (ownPlace) step('qloo',`Look up “${ownPlace}” and rank it with the favourites`,own?.found?`${own.name}: ${own.noSignal?'no market signal':`rank ${own.tied?'=':''}${own.rank} of ${own.of}`}`:'not found in Qloo');
  if (audience) step('qloo','Audience of the top favourites (Qloo demographics)',audience.summary);

  let ideaResults=ideas.map((idea)=>({idea,status:'not-evaluated'}));
  if (llm && ideas.length) {
    step('agent',`Map ${ideas.length} owner idea${ideas.length>1?'s':''} to Qloo tags and score them`);
    try {
      ideaResults=await runIdeaAgent(ctx,{llm,input,domains,step});
    } catch (error) {
      step('agent','Idea agent failed',error.message);
    }
  }

  const facts=factSheet({input,places,profile,music,screen,own,ideas:ideaResults,audience});
  let brief;
  let baseline=null;
  let engine='rules';
  if (llm) {
    step('model','Write the brief from the fact sheet');
    step('model','Ask the model the same question with no data, then look its picks up in Qloo');
    const [written,contrast]=await Promise.allSettled([
      writeBrief(llm,facts,input),
      llmOnlyBaseline(llm,ctx,{input,places,music})
    ]);
    if (written.status==='fulfilled') {
      brief=validateBrief(written.value,ledger,facts);
      engine=`nemotron (${llm.model})`;
    } else {
      step('model','Brief writer failed; using the rule brief',written.reason?.message);
    }
    if (contrast.status==='fulfilled') baseline=contrast.value;
  }
  if (!brief || !brief.actions.length) brief=ruleBrief({input,places,profile,music},llm?'the model brief was unavailable':undefined);

  const result={
    input:{city:city.label,cityId:city.id,market:market.label,marketId:market.id,country:market.country,business:business.label,businessId:business.id,businessPlural:business.plural,ideas,ownPlace,lang:'en'},
    peers:places.peers,
    peerCount:places.peerCount,
    allPlaces:places.allPlaces,
    poolSizes:{market:places.marketList.length,city:places.baselineList.length,peers:places.peerCount,peersCity:places.peerCityCount},
    profile,
    audience,
    music:{bridge:music.bridge,distinct:music.distinct},
    screen:screen?{bridge:screen.bridge,distinct:screen.distinct}:null,
    own,
    ideas:ideaResults,
    brief,
    briefEn:null,
    baseline,
    ledger:ledger.toJSON(),
    trace,
    engine,
    facts
  };
  const final=lang==='vi'?await localizeResult(result,{translator,step}):result;
  step('done',`Brief ready (${final.engine}${brief.dropped?.length?`; ${brief.dropped.length} unsupported action${brief.dropped.length>1?'s':''} removed`:''})`);
  return final;
}

// Turn a finished English result into a Vietnamese one by translating only the written text. All
// Qloo data, refs and checks stay as they are, so the two versions say the same thing.
export async function localizeResult(result,{translator,step=()=>{}}) {
  if (!translator || result.engine==='rules') return {...result,input:{...result.input,lang:'vi'}};
  step('model',`Translate the checked brief into Vietnamese (${translator.model})`);
  const {input,ledger,baseline}=result;
  const names=Object.values(ledger).map((e)=>e.item?.name).concat([input.city,input.market,input.country]);
  try {
    const out=await translateBrief(translator,result.brief,{advice:baseline?.advice ?? '',names});
    return {
      ...result,
      input:{...input,lang:'vi'},
      brief:out.brief,
      briefEn:result.brief,
      baseline:baseline?{...baseline,adviceEn:baseline.advice,advice:out.advice}:baseline,
      engine:`${result.engine}; translated by ${translator.model}`
    };
  } catch (error) {
    step('model','Translation failed; showing the English brief',error.message);
    return {...result,input:{...input,lang:'en'},translationError:error.message};
  }
}
