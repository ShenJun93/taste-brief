// Page logic. Every string from Qloo or the model is inserted as text, never as HTML.

const SAMPLES=[
  {id:'hanoi-cafe-seoul',label:'Hanoi café · guests from Seoul'},
  {id:'hoian-stay-sydney',label:'Hoi An homestay · guests from Sydney'},
  {id:'hcmc-cafe-tokyo',label:'Saigon café · guests from Tokyo'}
];
const PHASE_LABEL={qloo:'Qloo',agent:'Agent',model:'Model',done:'Done',cache:'Cache'};
const VERDICT_LABEL={
  'over-represented':'Over-represented',
  common:'Common, not distinctive',
  untested:'Untested',
  'absent-from-favourites':'Absent from their favourites'
};

const $=(id)=>document.getElementById(id);
function h(tag,props={},...children) {
  const el=document.createElement(tag);
  for (const [k,v] of Object.entries(props)) {
    if (v===null || v===undefined || v===false) continue;
    if (k==='class') el.className=v;
    else if (k==='style') el.setAttribute('style',v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2),v);
    else el.setAttribute(k,v===true?'':v);
  }
  for (const c of children.flat()) if (c!==null && c!==undefined && c!==false) el.append(c instanceof Node?c:String(c));
  return el;
}
const pct=(n,d)=>d?Math.round(100*n/d):0;
const fill=(id,...kids)=>$(id).replaceChildren(...kids.flat().filter((k)=>k!==null && k!==undefined && k!==false));

let state={business:'cafe',brief:null};

async function init() {
  const options=await fetch('/api/options').then((r)=>r.json());
  for (const b of options.businesses) {
    $('business').append(h('button',{type:'button',class:'chip','aria-pressed':String(b.id===state.business),'data-id':b.id,onclick:()=>pickBusiness(b.id)},b.label));
  }
  for (const c of options.cities) $('city').append(h('option',{value:c.id},c.label));
  for (const m of options.markets) $('market').append(h('option',{value:m.id},`${m.label}, ${m.country}`));
  $('market').value='seoul';
  for (const s of SAMPLES) $('samples').append(h('button',{type:'button',class:'chip',onclick:()=>openSample(s.id)},s.label));
  $('brief-form').addEventListener('submit',onSubmit);
  document.addEventListener('click',(e)=>{ if (!e.target.closest('.ref') && !e.target.closest('#pop')) $('pop').hidden=true; });
  document.addEventListener('keydown',(e)=>{ if (e.key==='Escape') $('pop').hidden=true; });
}

function pickBusiness(id) {
  state.business=id;
  for (const el of $('business').children) el.setAttribute('aria-pressed',String(el.dataset.id===id));
}

function resetView() {
  $('error').hidden=true;
  $('result').hidden=true;
  $('steps').replaceChildren();
}

function stepRow(e) {
  return h('li',{},
    h('span',{class:'ms'},`${(e.ms/1000).toFixed(1)}s`),
    h('span',{class:`phase ${e.phase}`},PHASE_LABEL[e.phase] ?? e.phase),
    h('span',{},e.label),
    e.detail?h('span',{class:'detail'},e.detail):null
  );
}

async function onSubmit(event) {
  event.preventDefault();
  resetView();
  const body={
    business:state.business,
    city:$('city').value,
    market:$('market').value,
    ownPlace:$('own').value.trim(),
    ideas:$('ideas').value.split('\n').map((s)=>s.trim()).filter(Boolean).slice(0,6)
  };
  $('go').disabled=true;
  $('progress').hidden=false;
  $('steps').append(h('li',{class:'live'},h('span',{class:'ms'},'0.0s'),h('span',{class:'phase qloo'},'Start'),h('span',{},'Sending your question')));
  try {
    const res=await fetch('/api/brief',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if (!res.ok || !res.body) {
      const err=await res.json().catch(()=>({error:`HTTP ${res.status}`}));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer='';
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      buffer+=value;
      let cut;
      while ((cut=buffer.indexOf('\n\n'))>=0) {
        const chunk=buffer.slice(0,cut);
        buffer=buffer.slice(cut+2);
        const event=/^event: (.+)$/m.exec(chunk)?.[1];
        const data=JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? 'null');
        if (event==='step') {
          $('steps').querySelector('.live')?.classList.remove('live');
          const row=stepRow(data);
          row.classList.add('live');
          $('steps').append(row);
        } else if (event==='brief') {
          $('steps').querySelector('.live')?.classList.remove('live');
          render(data);
        } else if (event==='error') {
          throw new Error(data.error);
        }
      }
    }
  } catch (error) {
    $('error').hidden=false;
    $('error').textContent=`Could not build the brief: ${error.message}`;
  } finally {
    $('go').disabled=false;
  }
}

async function openSample(id) {
  resetView();
  $('progress').hidden=true;
  try {
    const brief=await fetch(`/api/samples/${id}`).then((r)=>{ if (!r.ok) throw new Error('sample not found'); return r.json(); });
    render(brief,{sample:true});
  } catch (error) {
    $('error').hidden=false;
    $('error').textContent=error.message;
  }
}

// --- evidence chips ----------------------------------------------------------------------------

function refLabel(ref) {
  const entry=state.brief?.ledger?.[ref];
  if (!entry) return ref;
  const it=entry.item;
  if (entry.kind==='tag') return `${it.name} ${it.marketCount}/${it.marketTotal}`;
  if (entry.kind==='idea') return `${it.idea} → ${it.name}`;
  return it.name;
}

function refDetail(ref) {
  const {input}=state.brief;
  const entry=state.brief.ledger[ref];
  const it=entry.item;
  const lines=[];
  if (entry.kind==='place') {
    if (it.question) lines.push(`Rank ${it.rank} — ${it.question}.`);
    else lines.push(`Rank ${it.rank} among ${input.business.toLowerCase()}s in ${input.city} for people in ${input.market}; ${it.cityRank?`rank ${it.cityRank} city-wide`:'not in the city-wide top list'}.`);
    if (it.address) lines.push(it.address);
    if (it.tags?.length) lines.push(`Tags: ${it.tags.slice(0,8).map((t)=>t.name).join(', ')}`);
  } else if (entry.kind==='tag') {
    lines.push(`Carried by ${it.marketCount} of ${it.marketTotal} places ${input.market} audiences favour, against ${it.baselineCount} of ${it.baselineTotal} city-wide.`);
  } else if (entry.kind==='idea') {
    lines.push(`Owner idea "${it.idea}" mapped to Qloo tag "${it.name}". Carried by ${it.marketCount} of ${it.marketTotal} ${input.market} favourites vs ${it.cityCount} of ${it.cityTotal} city-wide: ${VERDICT_LABEL[it.verdict] ?? it.verdict}.`);
  } else {
    lines.push(`${it.kind?.replace('_',' ') ?? entry.kind} — rank ${it.rank} for people in ${input.market}${it.localRank?`, rank ${it.localRank} in ${input.city}`:''}.`);
  }
  const src=entry.source;
  const request=src?.params?`${src.endpoint}?${Object.entries(src.params).map(([k,v])=>`${k}=${Array.isArray(v)?v.join(','):v}`).join('&')}`:src?.rule ?? '';
  return {title:it.name ?? ref,lines,request};
}

function refChip(ref) {
  return h('button',{type:'button',class:'ref',onclick:(e)=>showPop(e.currentTarget,ref)},h('b',{},ref),refLabel(ref));
}

function showPop(anchor,ref) {
  const pop=$('pop');
  const d=refDetail(ref);
  pop.replaceChildren(h('h5',{},`${ref} · ${d.title}`),...d.lines.map((l)=>h('div',{},l)),d.request?h('div',{class:'src'},`Qloo: ${d.request}`):null);
  pop.hidden=false;
  const r=anchor.getBoundingClientRect();
  const left=Math.min(window.scrollX+r.left,window.scrollX+document.documentElement.clientWidth-pop.offsetWidth-16);
  pop.style.left=`${Math.max(16,left)}px`;
  pop.style.top=`${window.scrollY+r.bottom+6}px`;
}

// --- render ------------------------------------------------------------------------------------

function render(brief,{sample=false}={}) {
  state.brief=brief;
  const {input,brief:b}=brief;
  $('result').hidden=false;

  $('brief-eyebrow').textContent=`${input.business} in ${input.city} · guests from ${input.market}, ${input.country}`;
  $('headline').textContent=b.headline || `What ${input.market} audiences favour in ${input.city}`;
  $('summary').textContent=b.summary ?? '';
  const when=brief.cachedAt ?? brief.generatedAt;
  fill('brief-meta',
    h('span',{},`Written by ${brief.engine}`),
    h('span',{},`${Object.keys(brief.ledger).length} Qloo results in the evidence ledger`),
    when?h('span',{},`${sample?'Saved example from':'Generated'} ${new Date(when).toLocaleString()}`):null,
    b.dropped?.length?h('span',{},`${b.dropped.length} uncited action${b.dropped.length>1?'s':''} removed`):null
  );

  $('actions').replaceChildren(...b.actions.map((a)=>h('li',{},
    h('div',{class:'t'},a.title),
    h('div',{class:'d'},a.detail),
    h('div',{class:'refs'},a.refs.map(refChip))
  )));

  $('places-title').textContent=`Where people from ${input.market} already go`;
  $('places-note').textContent=!brief.places.length
    ?`Qloo shows no ${input.city} places with a measurable ${input.market} signal yet. Try a larger city or another market.`
    :brief.scope==='all-places'
      ?`Qloo sees too few ${input.business.toLowerCase()}s here with a ${input.market} signal, so this covers every kind of place in ${input.city} (${brief.poolSizes.market} with a signal), compared with the city-wide ranking.`
      :`${input.business}s in ${input.city} ranked by Qloo for the taste of people in ${input.market} (${brief.poolSizes.market} with a measurable signal), compared with the city-wide ranking.`;
  $('places').replaceChildren(...brief.places.slice(0,10).map((p)=>{
    const lift=p.cityRank===null?h('span',{class:'lift new'},'not in city top 50'):p.lift>0?h('span',{class:'lift up'},`▲ ${p.lift} vs city #${p.cityRank}`):h('span',{class:'lift'},`city #${p.cityRank}`);
    return h('li',{},
      h('span',{class:'rank'},p.rank),
      h('div',{},h('div',{class:'pname'},p.name),p.address?h('div',{class:'paddr'},p.address):null,p.tags.length?h('div',{class:'ptags'},p.tags.slice(0,4).map((t)=>t.name).join(' · ')):null),
      lift
    );
  }));

  $('profile-note').textContent=brief.profile.length?`Tags that appear more often among the places ${input.market} audiences favour than among ${input.city}'s overall top list.`:`Too few ${input.market} favourites with a signal to compare tags reliably.`;
  fill('profile',
    brief.profile.length?h('li',{class:'legend'},h('span',{},h('i',{style:'background:var(--market)'}),`${input.market} favourites`),h('span',{},h('i',{style:'background:var(--city)'}),`${input.city} overall`)):null,
    ...brief.profile.map((t)=>h('li',{},
      h('div',{class:'lab'},h('span',{},t.name),h('span',{},`${t.marketCount}/${t.marketTotal} vs ${t.baselineCount}/${t.baselineTotal}`)),
      h('div',{class:'bars'},
        h('div',{class:'bar m'},h('i',{style:`width:${pct(t.marketCount,t.marketTotal)}%`})),
        h('div',{class:'bar c'},h('i',{style:`width:${pct(t.baselineCount,t.baselineTotal)}%`}))
      )
    ))
  );

  const notes=new Map((b.ideas ?? []).map((i)=>[i.ref,i.note]));
  $('ideas-card').hidden=!brief.ideas.length && !brief.own;
  $('idea-list').replaceChildren(...brief.ideas.map((i)=>{
    const verdict=i.verdict ?? (i.status==='no-signal'?'untested':i.status==='unmapped'?'untested':null);
    const counts=i.verdict?`${i.marketCount}/${i.marketTotal} ${input.market} favourites vs ${i.cityCount}/${i.cityTotal} city-wide · tag “${i.via.name}”`:i.status==='unmapped'?'No matching Qloo tag found':i.status==='not-evaluated'?'Not evaluated (no model configured)':i.via?`${i.via.kind} “${i.via.name}”: ${i.status==='ranked'?`rank ${i.rank} of ${i.of}`:'no market signal'}`:'';
    return h('li',{},
      h('div',{class:'top'},h('span',{class:'iname'},i.idea),verdict?h('span',{class:`verdict ${verdict}`},VERDICT_LABEL[verdict]):null),
      h('div',{class:'why'},counts),
      notes.get(i.ref)?h('div',{},notes.get(i.ref)):null
    );
  }));
  const own=brief.own;
  $('own-place').replaceChildren(own?(
    !own.found?h('div',{},`“${own.query}” was not found in Qloo for ${input.city}.`):
    own.noSignal?h('div',{},h('strong',{},own.name),` is in Qloo, but shows no measurable ${input.market} affinity next to the favourites above.`):
    h('div',{},h('strong',{},own.name),` ranks ${own.rank} of ${own.of} when Qloo ranks it with the top ${input.market} favourites.`)
  ):'');

  $('music-note').textContent=`Artists loved by people in ${input.market} that people in ${input.city} also love — a playlist both guests and locals know.`;
  const cult=(c,showLocal)=>h('li',{},c.name,h('small',{},`${input.market} #${c.rank}${showLocal&&c.localRank?` · ${input.city} #${c.localRank}`:''}`));
  $('bridge').replaceChildren(...brief.music.bridge.map((c)=>cult(c,true)));
  $('distinct-title').textContent=`Loved in ${input.market}, not in ${input.city}'s top list`;
  $('distinct').replaceChildren(...brief.music.distinct.map((c)=>cult(c,false)));
  $('tv').replaceChildren(brief.screen?.bridge?.length?h('div',{},h('h4',{},'TV both sides watch'),h('ul',{class:'culture'},brief.screen.bridge.map((c)=>cult(c,true)))):'');

  const base=brief.baseline;
  $('llm-places').replaceChildren(...(base?.places ?? []).map((p)=>h('li',{},
    h('span',{class:p.qlooRank?'ok':'no'},p.qlooRank?'✓':'–'),
    h('span',{},p.name,h('small',{},p.qlooRank?`Qloo ${input.market} favourite #${p.qlooRank}`:p.cityRank?`Popular city-wide (#${p.cityRank}), but not among ${input.market} favourites`:`Not in Qloo's ${input.market} favourites or ${input.city}'s top ${base.poolSizes.city}`))
  )));
  $('llm-artists').replaceChildren(...(base?.artists ?? []).map((a)=>h('li',{},
    h('span',{class:a.qlooRank?'ok':'no'},a.qlooRank?'✓':'–'),
    h('span',{},a.name,h('small',{},a.qlooRank?`Qloo ${input.market} #${a.qlooRank}`:`Not in Qloo's top ${base.poolSizes.artists} for ${input.market}`))
  )));
  $('llm-advice').textContent=base?.advice ?? 'No model configured.';

  $('caveats').replaceChildren(...[...(b.caveats ?? []),'Qloo results describe the aggregate taste of people in a city, not any individual guest.'].map((c)=>h('li',{},c)));
  $('ledger').replaceChildren(...Object.keys(brief.ledger).map((ref)=>{
    const d=refDetail(ref);
    return h('div',{class:'ledger-row'},h('strong',{},ref),h('div',{},h('div',{},d.title,' — ',d.lines[0]),d.request?h('code',{},d.request):null));
  }));
  $('trace').replaceChildren(...(brief.trace ?? []).map(stepRow));
  $('result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}

init().catch((error)=>{
  $('error').hidden=false;
  $('error').textContent=`Could not load the page: ${error.message}`;
});
