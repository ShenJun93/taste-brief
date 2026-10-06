// The taste-brief agent. Three phases:
//   A. fixed Qloo analyses (where the market goes, what sets those places apart, shared culture);
//   B. a Nemotron tool loop that maps the owner's own ideas to Qloo tags or entities and ranks them;
//   C. a written brief that may only cite ledger refs, next to an LLM-only answer for contrast.
// The model never supplies a name, rank or count: the UI takes those from the ledger.

import {Ledger, bridgeCulture, marketPlaces, rankEntities, rankIdeaScores, scoreIdeaInPools, tasteProfile} from './analysis.js';
import {CULTURE_TYPES, businessOf, cityOf, marketOf} from './catalog.js';
import {compactEntity, compactPlace} from './qloo.js';

export function normalize(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
}

export function sameName(a,b) {
  const x=normalize(a);
  const y=normalize(b);
  if (x.length<4 || y.length<4) return x===y && x.length>0;
  return x===y || x.includes(y) || y.includes(x);
}

export function readInput(raw={}) {
  const ideas=(Array.isArray(raw.ideas) ? raw.ideas : String(raw.ideas ?? '').split(/\r?\n/))
    .map((s)=>String(s).trim().slice(0,120)).filter(Boolean).slice(0,6);
  const ownPlace=String(raw.ownPlace ?? '').trim().slice(0,80) || null;
  return {city:cityOf(raw.city),market:marketOf(raw.market),business:businessOf(raw.business),ideas,ownPlace};
}

// --- phase A helpers ---------------------------------------------------------------------------

async function locateOwnPlace({qloo,ledger},{ownPlace,city,market,places}) {
  const found=await qloo.search(`${ownPlace} ${city.label}`,{types:'urn:entity:place',take:8});
  const match=found.entities.find((e)=>city.address.some((key)=>normalize(e.properties?.address ?? e.disambiguation).includes(key)));
  if (!match) return {query:ownPlace,found:false};
  const self=compactPlace(match);
  const peers=places.places.filter((p)=>p.id!==self.id).slice(0,9).map((p)=>p.id);
  const ranked=await rankEntities({qloo,ledger},{market,kind:'place',ids:[self.id,...peers],label:'owner place among market favourites'});
  const mine=ranked.ranked.find((r)=>r.id===self.id);
  return {
    query:ownPlace,
    found:true,
    name:self.name,
    address:self.address,
    tags:self.tags.slice(0,8),
    ref:mine?.ref ?? null,
    rank:mine?.rank ?? null,
    of:ranked.ranked.length,
    noSignal:!mine
  };
}

// --- phase B: idea-mapping tool loop -----------------------------------------------------------

const AGENT_TOOLS=[
  {type:'function',function:{
    name:'find_tags',
    description:'Search Qloo tags by keyword (1-3 words). Returns candidate tag ids with their family (ambience, cuisine, offerings, genre, interests...).',
    parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}
  }},
  {type:'function',function:{
    name:'search_entities',
    description:'Search Qloo entities by name when an idea names a specific film, TV show, artist, book, brand or place.',
    parameters:{type:'object',properties:{query:{type:'string'},kind:{type:'string',enum:['artist','movie','tv_show','book','brand','place','podcast','video_game']}},required:['query','kind']}
  }},
  {type:'function',function:{
    name:'rank_ideas_by_tags',
    description:'Score several ideas together: for each idea\'s Qloo place tag, how many of the visitor market\'s favourite places carry it compared with the city overall. Use tag ids returned by find_tags only.',
    parameters:{type:'object',properties:{mappings:{type:'array',items:{type:'object',properties:{idea:{type:'string'},tag_id:{type:'string'}},required:['idea','tag_id']}}},required:['mappings']}
  }},
  {type:'function',function:{
    name:'rank_ideas_by_entities',
    description:'Rank ideas that map to specific entities of one kind by the visitor market\'s affinity. Use entity ids returned by search_entities only.',
    parameters:{type:'object',properties:{kind:{type:'string',enum:['artist','movie','tv_show','book','brand','place','podcast','video_game']},mappings:{type:'array',items:{type:'object',properties:{idea:{type:'string'},entity_id:{type:'string'}},required:['idea','entity_id']}}},required:['kind','mappings']}
  }}
];

async function runIdeaAgent(ctx,{llm,input,pools,step,maxTurns=10}) {
  const {qloo,ledger}=ctx;
  const {city,market,business,ideas}=input;
  const seenTags=new Map();
  const seenEntities=new Map();
  const results=new Map(ideas.map((idea)=>[idea,{idea,status:'unmapped'}]));
  const matchIdea=(text)=>ideas.find((i)=>i===text) ?? ideas.find((i)=>sameName(i,text));

  const handlers={
    async find_tags({query}) {
      const out=await qloo.tags(String(query).slice(0,40),{parentTypes:'urn:entity:place',take:8});
      // Scoring matches tags by name, so one candidate per name is enough.
      const byName=new Map();
      for (const t of out.tags) {
        const tag={id:t.id ?? t.tag_id,name:t.name,family:(t.type ?? t.subtype ?? '').replace('urn:tag:','')};
        if (!byName.has(tag.name.toLowerCase())) byName.set(tag.name.toLowerCase(),tag);
      }
      const tags=[...byName.values()];
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
      const ranked=rankIdeaScores(valid.map((m)=>scoreIdeaInPools(ctx,pools,{tag:seenTags.get(m.tag_id),idea:matchIdea(m.idea)})));
      for (const r of ranked) results.set(r.idea,{idea:r.idea,status:'ranked',ref:r.ref,via:{kind:'tag',id:r.id,name:r.name},rank:r.rank,of:r.of,verdict:r.verdict,marketCount:r.marketCount,marketTotal:r.marketTotal,cityCount:r.cityCount,cityTotal:r.cityTotal,examples:r.examples});
      const untested=ranked.filter((r)=>r.verdict==='untested').map((r)=>r.idea);
      return {
        ranked:ranked.map((r)=>({ref:r.ref,idea:r.idea,tag:r.name,market_favourites_with_tag:`${r.marketCount}/${r.marketTotal}`,city_places_with_tag:`${r.cityCount}/${r.cityTotal}`,verdict:r.verdict})),
        hint:untested.length?`No place in either pool carries the tag chosen for: ${untested.join('; ')}. If a broader tag still captures what is specific about the idea ("Egg Coffee" rather than "Egg Coffee Workshop", "Live Music" rather than "Jazz Night"), score those ideas again; never fall back to a tag nearly every place has, such as "Coffee" for a cafe. Otherwise leave them untested.`:undefined,
        rejected
      };
    },
    async rank_ideas_by_entities({kind,mappings=[]}) {
      const valid=mappings.filter((m)=>seenEntities.get(m.entity_id)?.kind===kind && matchIdea(m.idea));
      if (!valid.length) return {error:'no valid mappings; use entity ids returned by search_entities with the same kind'};
      const ideaById=Object.fromEntries(valid.map((m)=>[m.entity_id,matchIdea(m.idea)]));
      const out=await rankEntities(ctx,{market,kind,ids:[...new Set(valid.map((m)=>m.entity_id))],label:'owner idea'});
      for (const r of out.ranked) results.set(ideaById[r.id],{idea:ideaById[r.id],status:'ranked',ref:r.ref,via:{kind,id:r.id,name:r.name},rank:r.rank,of:r.of});
      for (const id of out.noSignal) results.set(ideaById[id],{idea:ideaById[id],status:'no-signal',via:{kind,id,name:seenEntities.get(id)?.name}});
      return {ranked:out.ranked.map((r)=>({ref:r.ref,idea:ideaById[r.id],entity:r.name,rank:r.rank,of:r.of})),no_signal:out.noSignal};
    }
  };

  const messages=[
    {role:'system',content:[
      `You research ideas for a small ${business.label.toLowerCase()} in ${city.label}, Vietnam that wants more guests from ${market.label} (${market.country}).`,
      'For each owner idea, find the single Qloo place tag that best captures it with find_tags (short keywords such as "live music", "vegan", "rooftop", "cooking class"). Pick the tag that captures what is specific about the idea (for "egg coffee workshop" that is Egg Coffee, not Coffee), preferring short common names over long, very specific ones, because the score counts real places that carry the tag.',
      'Use search_entities only when an idea names a specific film, show, artist, brand or place.',
      'Then rank ALL mapped tag ideas together in one rank_ideas_by_tags call (and entity ideas in rank_ideas_by_entities).',
      'Copy the idea text exactly as the owner wrote it. If no tag fits an idea, leave it unmapped.',
      'If the scoring says no place carries a tag, retry that idea once with a broader tag. When done, reply with one short sentence and no tool call.'
    ].join(' ')},
    {role:'user',content:`Owner ideas:\n${ideas.map((i,n)=>`${n+1}. ${i}`).join('\n')}`}
  ];

  for (let turn=0; turn<maxTurns; turn+=1) {
    const {message}=await llm.chatTools({messages,tools:AGENT_TOOLS});
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
      step('agent',`${call.function.name}(${JSON.stringify(args).slice(0,140)})`,result.error ? `error: ${result.error}` : summarizeToolResult(call.function.name,result));
      messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,6000)});
    }
  }
  return ideas.map((idea)=>results.get(idea));
}

function summarizeToolResult(name,result) {
  if (name==='find_tags') return `${result.tags.length} tags: ${result.tags.slice(0,4).map((t)=>t.name).join(', ')}`;
  if (name==='search_entities') return `${result.entities.length} matches: ${result.entities.slice(0,3).map((e)=>e.name).join(', ')}`;
  if (name==='rank_ideas_by_tags') return (result.ranked ?? []).map((r)=>`${r.idea} → ${r.tag}: ${r.market_favourites_with_tag} favourites vs ${r.city_places_with_tag} city (${r.verdict})`).join('; ');
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

export function factSheet({input,places,profile,music,screen,own,ideas}) {
  const {city,market,business}=input;
  const lines=[`Business: ${business.label} in ${city.label}, Vietnam. Visitor market: ${market.label}, ${market.country}.`,''];
  if (!places.places.length) lines.push(`Qloo shows no ${city.label} places with a measurable ${market.label} signal, so there are no market favourites to cite. Say so plainly and keep actions to what the other facts support.`);
  else if (places.scope==='all-places') lines.push(`Qloo has too few ${business.label.toLowerCase()}s in ${city.label} with a ${market.label} signal, so this list covers every kind of place (attractions, restaurants, hotels) ranked by the taste of people in ${market.label}; "city rank" is the same list without the market signal:`);
  else lines.push(`Places in ${city.label} (${business.label.toLowerCase()} genre) ranked by the taste of people in ${market.label}; "city rank" is the same list without the market signal:`);
  for (const p of places.places) lines.push(`${p.ref} ${p.name} — market rank ${p.rank}, city rank ${p.cityRank ?? `not in top ${places.baselineList.length}`}${p.tags.length?` — tags: ${p.tags.slice(0,6).map((t)=>t.name).join(', ')}`:''}`);
  lines.push('',`Tags over-represented among ${market.label} favourites vs the city overall:`);
  for (const t of profile) lines.push(`${t.ref} "${t.name}" (${t.family}) — ${t.marketCount}/${t.marketTotal} market favourites vs ${t.baselineCount}/${t.baselineTotal} city-wide — e.g. ${t.places.slice(0,4).join(', ')}`);
  for (const [label,block] of [['Music',music],['TV',screen]]) {
    if (!block) continue;
    lines.push('',`${label} loved in ${market.label} that ${city.label} also loves (bridge):`);
    for (const c of block.bridge) lines.push(`${c.ref} ${c.name} — ${market.label} rank ${c.rank}, ${city.label} rank ${c.localRank}`);
    lines.push(`${label} loved in ${market.label} but not in ${city.label}'s top list (distinct):`);
    for (const c of block.distinct) lines.push(`${c.ref} ${c.name} — ${market.label} rank ${c.rank}`);
  }
  if (own) {
    lines.push('');
    if (!own.found) lines.push(`Owner's place "${own.query}" was not found in Qloo for ${city.label}.`);
    else if (own.noSignal) lines.push(`Owner's place ${own.name} is in Qloo but has no measurable ${market.label} affinity among the market favourites.`);
    else lines.push(`${own.ref} Owner's place ${own.name} ranks ${own.rank} of ${own.of} against the top market favourites for ${market.label} taste.`);
  }
  if (ideas.length) {
    lines.push('','Owner ideas, scored against the same pools (verdicts: over-represented = clearly more common among market favourites than city-wide, a real signal; common = offered by market favourites about as often as city-wide or less, so not a differentiator; untested = no place in either pool offers it, no evidence either way; absent-from-favourites = offered in the city but by none of the market favourites):');
    for (const i of ideas) {
      if (i.status==='ranked' && i.via.kind==='tag') lines.push(`${i.ref} "${i.idea}" → tag "${i.via.name}": carried by ${i.marketCount}/${i.marketTotal} ${market.label} favourites vs ${i.cityCount}/${i.cityTotal} ${city.label} places overall — verdict ${i.verdict} — idea rank ${i.rank} of ${i.of}${i.examples?.length?` — e.g. ${i.examples.join(', ')}`:''}`);
      else if (i.status==='ranked') lines.push(`${i.ref} "${i.idea}" → ${i.via.kind} "${i.via.name}" — rank ${i.rank} of ${i.of} for ${market.label} taste`);
      else if (i.status==='no-places') lines.push(`(no ref) "${i.idea}" → tag "${i.via.name}" — no ${city.label} places carry it yet (untested by this market)`);
      else if (i.status==='no-signal') lines.push(`(no ref) "${i.idea}" → ${i.via.kind} "${i.via.name}" — Qloo returned no affinity for this market`);
      else lines.push(`(no ref) "${i.idea}" — no matching Qloo tag or entity`);
    }
  }
  return lines.join('\n');
}

async function writeBrief(llm,facts,input) {
  const {data}=await llm.chatJSON({
    schemaName:'taste_brief',
    schema:BRIEF_SCHEMA,
    system:[
      'You write a one-page plan for a small hospitality business owner. Plain, concrete English; no hype.',
      'Use ONLY the facts provided. Every action must cite one or more refs (P#, T#, C#, I#) from the facts that support it, in its refs array.',
      'In all text fields write names, never refs (write "Xofa Cafe", not "P2"). Do not state numbers, ranks or names that are not in the facts, and do not invent dishes, products or events the facts do not name.',
      'Describe idea scores with their counts and verdict ("3 of 21 Seoul favourites offer egg coffee, against 4 of 50 city-wide"); an untested idea is a possible differentiator with no evidence either way, not a proven winner.',
      'Qloo results describe aggregate taste of people in a city, not any individual; never claim what a specific guest will do.',
      'headline: one sentence, 8 to 16 words, stating the main finding from the market favourites or over-represented tags; never present an untested idea as something the market favours. summary: two or three sentences.',
      'actions: 3 to 5, each with a short imperative title and a detail of one or two sentences saying what to do and which fact supports it.',
      'partners: up to 4 places from the P refs worth partnering with or recommending to guests, with a one-sentence why.',
      'playlist: up to 6 music refs, bridge artists first, each with a short why. ideas: one note per owner idea that has an I ref, saying whether to lead with it and why.',
      'caveats: two or three things the data does not establish. Fill every field.'
    ].join(' '),
    user:facts
  });
  return data;
}

export function validateBrief(brief,ledger) {
  const kindOf=(ref)=>ledger.get(ref)?.kind;
  // The model is told to write names, not refs; when a ref slips into prose, show the name.
  const text=(s,max)=>String(s ?? '').replace(/\b[PTCI]\d{1,3}\b/g,(ref)=>ledger.get(ref)?.item?.name ?? ref).slice(0,max);
  const okRefs=(refs)=>[...new Set((refs ?? []).filter((r)=>ledger.has(r)))];
  const dropped=[];
  const actions=(brief.actions ?? []).map((a)=>({title:text(a.title,160),detail:text(a.detail,600),refs:okRefs(a.refs)})).filter((a)=>{
    if (a.refs.length) return true;
    dropped.push(a.title);
    return false;
  }).slice(0,5);
  return {
    headline:text(brief.headline,200),
    summary:text(brief.summary,800),
    actions,
    partners:(brief.partners ?? []).filter((p)=>kindOf(p.ref)==='place').slice(0,5).map((p)=>({ref:p.ref,why:text(p.why,300)})),
    playlist:(brief.playlist ?? []).filter((p)=>kindOf(p.ref)==='artist').slice(0,8).map((p)=>({ref:p.ref,why:text(p.why,200)})),
    ideas:(brief.ideas ?? []).filter((i)=>kindOf(i.ref)==='idea' || kindOf(i.ref)==='place' || CULTURE_TYPES[kindOf(i.ref)]).map((i)=>({ref:i.ref,note:text(i.note,400)})),
    caveats:(brief.caveats ?? []).map((c)=>text(c,300)).slice(0,5),
    dropped
  };
}

// Without a model the brief is assembled from the analyses by rule, so the page still works.
export function ruleBrief({input,places,profile,music},reason='no language model configured') {
  const {city,market,business}=input;
  const actions=[];
  if (profile.length) actions.push({title:`Lean into "${profile[0].name}"`,detail:`Among the ${business.label.toLowerCase()}s ${market.label} audiences favour in ${city.label}, ${profile[0].marketCount} of ${profile[0].marketTotal} carry this tag, against ${profile[0].baselineCount} of ${profile[0].baselineTotal} city-wide.`,refs:[profile[0].ref,...profile[0].places.slice(0,3)]});
  const climbers=places.places.filter((p)=>p.lift===null || p.lift>=3).slice(0,3);
  if (climbers.length) actions.push({title:'Study the places this market lifts',detail:'These rank much higher for this market than for the city overall.',refs:climbers.map((p)=>p.ref)});
  if (music?.bridge.length) actions.push({title:'Play music both sides know',detail:`Artists loved in ${market.label} that ${city.label} also loves.`,refs:music.bridge.slice(0,4).map((c)=>c.ref)});
  return {
    headline:`What ${market.label} audiences favour in ${city.label}`,
    summary:`Assembled by rule from Qloo results (${reason}).`,
    actions,
    partners:places.places.slice(0,3).map((p)=>({ref:p.ref,why:`Rank ${p.rank} for ${market.label} taste.`})),
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

// The same question asked of the model alone, then checked against what Qloo returned.
async function llmOnlyBaseline(llm,{input,places,music}) {
  const {city,market,business}=input;
  const {data}=await llm.chatJSON({
    schemaName:'llm_only',
    schema:BASELINE_SCHEMA,
    system:'You are a helpful assistant answering from general knowledge. Fill every field: exactly 5 places, exactly 5 artists, and advice of three to five sentences.',
    user:`I run a ${business.label.toLowerCase()} in ${city.label}, Vietnam and want more guests from ${market.label}, ${market.country}. List 5 specific ${business.label.toLowerCase()}s in ${city.label} that people from ${market.label} love (name only in "name"), 5 music artists for a playlist that would make them feel at home (name only in "name"), and one short paragraph of advice.`
  });
  const placeNames=places.marketList.map((p,i)=>({name:p.name,rank:i+1}));
  const artistNames=(music?.marketItems ?? []).map((a)=>({name:a.name,rank:a.rank}));
  const cityNames=places.baselineList.map((p,i)=>({name:p.name,rank:i+1}));
  const check=(items,pool,second)=>(items ?? []).slice(0,6).map((entry)=>{
    const name=cleanName(entry.name);
    const hit=pool.find((p)=>sameName(p.name,name));
    const other=second?.find((p)=>sameName(p.name,name));
    return {name,why:String(entry.why ?? '').slice(0,200),qlooRank:hit?.rank ?? null,...(second?{cityRank:other?.rank ?? null}:{})};
  });
  return {
    places:check(data.places,placeNames,cityNames),
    artists:check(data.artists,artistNames),
    advice:String(data.advice ?? '').slice(0,900),
    poolSizes:{places:placeNames.length,city:cityNames.length,artists:artistNames.length}
  };
}

// --- entry point -------------------------------------------------------------------------------

export async function buildBrief(rawInput,{qloo,llm,onEvent=()=>{},now=()=>Date.now()}) {
  if (!qloo) throw new Error('QLOO_API_KEY is not configured');
  const input=readInput(rawInput);
  const {city,market,business,ideas,ownPlace}=input;
  const ledger=new Ledger();
  const ctx={qloo,ledger};
  const t0=now();
  const trace=[];
  const step=(phase,label,detail=null)=>{
    const event={ms:now()-t0,phase,label,detail};
    trace.push(event);
    onEvent({type:'step',...event});
  };

  step('qloo',`Rank ${business.label.toLowerCase()}s in ${city.label} by the taste of people in ${market.label}, and without it`);
  step('qloo',`Music and TV loved in ${market.label}, checked against ${city.label}`);
  const [places,music,screen]=await Promise.all([
    marketPlaces(ctx,{city,market,business}),
    bridgeCulture(ctx,{city,market,kind:'artist'}),
    bridgeCulture(ctx,{city,market,kind:'tv_show'}).catch(()=>null)
  ]);
  const profile=tasteProfile(ctx,places);
  step('qloo',`${places.places.length} market favourites, ${profile.length} over-represented tags, ${music.bridge.length} bridge artists`);

  let own=null;
  if (ownPlace) {
    step('qloo',`Find "${ownPlace}" in Qloo and rank it against the market favourites`);
    own=await locateOwnPlace(ctx,{ownPlace,city,market,places}).catch((error)=>({query:ownPlace,found:false,error:error.message}));
  }

  let ideaResults=ideas.map((idea)=>({idea,status:'not-evaluated'}));
  if (llm && ideas.length) {
    step('agent',`Map ${ideas.length} owner idea${ideas.length>1?'s':''} to Qloo tags and rank them for ${market.label}`);
    try {
      ideaResults=await runIdeaAgent(ctx,{llm,input,pools:places,step});
    } catch (error) {
      step('agent','Idea agent failed',error.message);
    }
  }

  const facts=factSheet({input,places,profile,music,screen,own,ideas:ideaResults});
  let brief;
  let baseline=null;
  let engine='rules';
  if (llm) {
    step('model','Write the brief from the fact sheet, and ask the model the same question with no data');
    const [written,contrast]=await Promise.allSettled([
      writeBrief(llm,facts,input),
      llmOnlyBaseline(llm,{input,places,music})
    ]);
    if (written.status==='fulfilled') {
      brief=validateBrief(written.value,ledger);
      engine=`nemotron (${llm.model})`;
    } else {
      step('model','Brief writer failed; using the rule brief',written.reason?.message);
    }
    if (contrast.status==='fulfilled') baseline=contrast.value;
  }
  if (!brief || !brief.actions.length) brief=ruleBrief({input,places,profile,music},llm?'the model brief was unavailable':undefined);
  step('done',`Brief ready (${engine})`);

  return {
    input:{city:city.label,market:market.label,country:market.country,business:business.label,ideas,ownPlace},
    places:places.places,
    poolSizes:{market:places.marketList.length,city:places.baselineList.length},
    scope:places.scope,
    profile,
    music:{bridge:music.bridge,distinct:music.distinct},
    screen:screen?{bridge:screen.bridge,distinct:screen.distinct}:null,
    own,
    ideas:ideaResults,
    brief,
    baseline,
    ledger:ledger.toJSON(),
    trace,
    engine,
    facts
  };
}
