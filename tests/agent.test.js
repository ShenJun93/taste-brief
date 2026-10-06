import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ledger, marketPlaces, rankIdeaScores, scoreIdea, tasteProfile, bridgeCulture, verdictFor, ideaDomains} from '../src/analysis.js';
import {cityOf, marketOf, businessOf} from '../src/catalog.js';
import {buildBrief, readInput, sameName, unknownNames, validateBrief} from '../src/agent.js';
import {qlooFromEnv, compactPlace, tiedRanks} from '../src/qloo.js';
import {buildMcpServer} from '../src/mcp.js';

const place=(id,name,tags=[],genre='restaurant:coffee_shop',affinity)=>({
  entity_id:id,name,subtype:'urn:entity:place',
  properties:{address:`${name} St, Hà Nội, Vietnam`,primary_genre:{id:`urn:tag:genre:place:${genre}`}},
  query:affinity===undefined?undefined:{affinity},
  tags:tags.map((t)=>({id:`urn:tag:ambience:qloo:${t.toLowerCase()}`,name:t,type:'urn:tag:ambience:qloo'}))
});
const artist=(id,name,tags=['Pop','Rock','Ballad','Indie'],popularity=0.9)=>({entity_id:id,name,subtype:'urn:entity:artist',popularity,tags:tags.map((t)=>({id:`urn:tag:genre:music:${t.toLowerCase()}`,name:t}))});

// A stand-in for the Qloo client: answers by request shape, records every call.
function fakeQloo({peerMarket=[],peerCity=[],allMarket=[],allCity=[],artistsAbroad=[],artistsLocal=[]}={}) {
  const calls=[];
  return {
    calls,
    name:'qloo',
    meta:{monthRemaining:()=>null},
    async insights(params) {
      calls.push(params);
      const type=params['filter.type'];
      let entities=[];
      if (type==='urn:entity:place') {
        const peer=Boolean(params['filter.tags']);
        const signal=Boolean(params['signal.location.query']);
        entities=peer?(signal?peerMarket:peerCity):(signal?allMarket:allCity);
      } else if (type==='urn:entity:artist') {
        entities=params['signal.location.query']==='Seoul'?artistsAbroad:artistsLocal;
      }
      return {path:'/v2/insights',params,cached:false,entities,tags:[],body:{results:{}}};
    },
    async tags() { return {tags:[]}; },
    async search() { return {entities:[]}; }
  };
}

const hanoi=cityOf('hanoi');
const seoul=marketOf('seoul');
const cafe=businessOf('cafe');

test('readInput validates choices, trims ideas and picks a language', ()=>{
  const input=readInput({city:'hanoi',market:'seoul',business:'cafe',ideas:'a\n\n b \nc\nd\ne\nf\ng',ownPlace:'  ',lang:'vi'});
  assert.deepEqual(input.ideas,['a','b','c','d','e','f']);
  assert.equal(input.ownPlace,null);
  assert.equal(input.lang,'vi');
  assert.equal(readInput({city:'hanoi',market:'seoul',business:'cafe',lang:'fr'}).lang,'en');
  assert.throws(()=>readInput({city:'atlantis',market:'seoul',business:'cafe'}),/unknown city/);
});

test('sameName ignores diacritics, case and word order', ()=>{
  assert.ok(sameName('Phở Quỳnh','pho quynh'));
  assert.ok(sameName('Cafe Giang','Café Giảng'));
  assert.ok(sameName('Giang Cafe','Café Giảng'));
  assert.ok(!sameName('BTS','BLACKPINK'));
});

test('tiedRanks gives equal scores the same rank', ()=>{
  assert.deepEqual(tiedRanks([{affinity:0.9},{affinity:0.8},{affinity:0.8},{affinity:0.7}]).map((r)=>[r.rank,r.tied]),[[1,false],[2,true],[2,true],[4,false]]);
});

test('peers are confirmed by primary genre, so a pho shop is not a café', async ()=>{
  const qloo=fakeQloo({
    peerMarket:[place('pho','Pho Quynh',[],'restaurant:pho',0.99),place('a','Alpha Cafe',[],'restaurant:coffee_shop',0.98)],
    peerCity:[place('b','Beta Cafe'),place('a','Alpha Cafe')],
    allMarket:[place('h','Hotel',[],'hotel',0.97),place('c','Gamma Cafe',[],'restaurant:cafe',0.96)],
    allCity:[place('h','Hotel',[],'hotel')]
  });
  const out=await marketPlaces({qloo,ledger:new Ledger()},{city:hanoi,market:seoul,business:cafe});
  assert.deepEqual(out.peers.map((p)=>[p.name,p.rank,p.cityRank]),[['Alpha Cafe',1,2],['Gamma Cafe',2,null]]);
  assert.equal(out.peerCount,2);
  assert.deepEqual(out.allPlaces.map((p)=>p.name),['Hotel','Gamma Cafe']);
  assert.ok(qloo.calls.some((c)=>c['signal.location.query']==='Seoul' && !c['filter.tags']),'all-places pool requested');
  assert.ok(!cafe.tags.includes('urn:tag:offerings:place:coffee'),'no offerings tag in the café filter');
});

test('tasteProfile keeps only tags clearly more common among the favourites', async ()=>{
  const allMarket=Array.from({length:10},(_,i)=>place(`m${i}`,`M${i}`,[...(i<6?['Boutique']:[]),'Cozy',...(i<5?['Busy']:[])],'restaurant',1-i/100));
  const allCity=Array.from({length:20},(_,i)=>place(`c${i}`,`C${i}`,[...(i<2?['Boutique']:[]),'Cozy',...(i<8?['Busy']:[])],'restaurant'));
  const ledger=new Ledger();
  const pools=await marketPlaces({qloo:fakeQloo({allMarket,allCity}),ledger},{city:hanoi,market:seoul,business:cafe});
  const profile=tasteProfile({ledger},pools);
  assert.deepEqual(profile.map((t)=>t.name),['Boutique'],'Cozy is everywhere; Busy is only 1.25× as common');
  assert.ok(Math.abs(profile[0].ratio-6)<1e-9);
  assert.ok(profile[0].places.every((r)=>ledger.get(r).kind==='place'));
});

test('verdicts separate a real signal from noise', ()=>{
  assert.equal(verdictFor(6,20,2,50),'over-represented');
  assert.equal(verdictFor(4,45,4,50),'common');
  assert.equal(verdictFor(1,45,1,50),'too-few');
  assert.equal(verdictFor(0,45,8,50),'absent-from-favourites');
  assert.equal(verdictFor(0,45,1,50),'too-few');
  assert.equal(verdictFor(0,45,0,50),'untested');
  assert.equal(verdictFor(3,50,12,50),'under-represented');
  assert.equal(verdictFor(3,50,5,50),'common');
});

test('a music idea is scored against artists, a place idea against places', ()=>{
  const ledger=new Ledger();
  const places=Array.from({length:10},(_,i)=>compactPlace(place(`p${i}`,`P${i}`,i<1?['Live Music']:[])));
  const kpop=(n,offset)=>Array.from({length:n},(_,i)=>({id:`a${i+offset}`,name:`A${i+offset}`,allTags:i<n/2?['K Pop']:['Rock']}));
  const domains=[
    {label:'places',kind:'place',market:places,city:places},
    {label:'music',kind:'artist',market:kpop(20,0),city:kpop(6,100).map((a)=>({...a,allTags:['Rock']}))}
  ];
  const music=scoreIdea({ledger},domains,{tag:{id:'urn:tag:genre:music:k_pop',name:'K Pop'},idea:'K-pop playlist'});
  assert.equal(music.domain,'music');
  assert.equal(music.verdict,'over-represented');
  const live=scoreIdea({ledger},domains,{tag:{id:'urn:tag:good_for:qloo:live_music',name:'Live Music'},idea:'live music'});
  assert.equal(live.domain,'places');
  assert.deepEqual(rankIdeaScores([live,music]).map((r)=>r.idea),['K-pop playlist','live music']);
});

test('bridgeCulture splits shared and distinctive taste and hides low-popularity entries', async ()=>{
  const qloo=fakeQloo({artistsAbroad:[artist('0','An Actor',[],0.1),artist('1','IU'),artist('2','BTS'),artist('3','Jennie')],artistsLocal:[artist('3','Jennie'),artist('9','Sơn Tùng M-TP')]});
  const out=await bridgeCulture({qloo,ledger:new Ledger()},{city:hanoi,market:seoul,kind:'artist'});
  assert.deepEqual(out.bridge.map((a)=>[a.name,a.rank,a.localRank]),[['Jennie',4,1]]);
  assert.deepEqual(out.distinct.map((a)=>a.name),['IU','BTS']);
  assert.equal(out.marketItems.length,4,'all entries stay available for scoring');
});

test('unknownNames flags names absent from the facts and tolerates a one-letter slip', ()=>{
  const facts='Taylor Swift, Nicole Richie, Xofa Cafe, Hoi An, people in Singapore';
  assert.deepEqual(unknownNames('Mention nearby Thu Bon River and Chợ Hàn.',facts),['Thu Bon River','Chợ Hàn']);
  assert.deepEqual(unknownNames('Serve Muslim Singapore guests; play Taylor Swift/Nicole Richie.',facts),[]);
  assert.deepEqual(unknownNames('Play Nicole Ritchie, Taylor Swift in Hoi An.',facts),[]);
});

test('validateBrief drops uncited, weak-idea and invented actions', async ()=>{
  const ledger=new Ledger();
  await marketPlaces({qloo:fakeQloo({allMarket:[place('a','Alpha',[],'restaurant',0.9)],allCity:[place('a','Alpha')]}),ledger},{city:hanoi,market:seoul,business:cafe});
  const weak=ledger.add('idea',{id:'t',name:'Egg Coffee',idea:'egg coffee workshop',verdict:'common'},{});
  const facts='P1 Alpha';
  const out=validateBrief({
    headline:'h',summary:'s',
    actions:[
      {title:'cited',detail:'Partner with P1 now',refs:['P1','P99']},
      {title:'invented',detail:'d',refs:['P42']},
      {title:'Add an egg coffee workshop',detail:'Do it.',refs:[weak]},
      {title:'Skip the egg coffee workshop',detail:'It is common.',refs:[weak]},
      {title:'Promote views',detail:'Mention the Thu Bon River nearby.',refs:['P1']}
    ],
    partners:[{ref:'P1',why:'w'},{ref:'C1',why:'w'}],
    playlist:[{ref:'P1',why:'not music'}],
    ideas:[],caveats:['c']
  },ledger,facts);
  assert.deepEqual(out.actions.map((a)=>a.title),['cited','Skip the egg coffee workshop']);
  assert.equal(out.actions[0].detail,'Partner with Alpha now');
  assert.deepEqual(out.dropped.map((d)=>d.title),['invented','Add an egg coffee workshop','Promote views']);
  assert.deepEqual(out.partners.map((p)=>p.ref),['P1']);
  assert.deepEqual(out.playlist,[]);
});

test('buildBrief without a model still returns a cited rule brief', async ()=>{
  const allMarket=Array.from({length:10},(_,i)=>place(`m${i}`,`M${i}`,i<6?['Boutique']:[],'restaurant:cafe',1-i/100));
  const allCity=Array.from({length:20},(_,i)=>place(`c${i}`,`C${i}`,i<1?['Boutique']:[],'restaurant:cafe'));
  const qloo=fakeQloo({allMarket,allCity,artistsAbroad:[artist('3','Jennie')],artistsLocal:[artist('3','Jennie')]});
  const events=[];
  const out=await buildBrief({city:'hanoi',market:'seoul',business:'cafe',ideas:['egg coffee']},{qloo,llm:null,onEvent:(e)=>events.push(e)});
  assert.equal(out.engine,'rules');
  assert.ok(out.brief.actions.length>=2);
  for (const a of out.brief.actions) for (const r of a.refs) assert.ok(out.ledger[r],`${r} is in the ledger`);
  assert.equal(out.ideas[0].status,'not-evaluated');
  assert.equal(out.peers.length,10);
  assert.equal(events.at(-1).phase,'done');
});

test('Qloo client sends the key as a header, caches, and surfaces errors', async ()=>{
  const seen=[];
  const fetchImpl=async (url,init)=>{
    seen.push({url,key:init.headers['X-Api-Key']});
    if (url.includes('bad')) return new Response(JSON.stringify({errors:[{message:'bad param'}]}),{status:400});
    return new Response(JSON.stringify({results:{entities:[{entity_id:'1',name:'A'}]}}),{status:200});
  };
  const qloo=qlooFromEnv({QLOO_API_KEY:'k'},fetchImpl,{sleep:async ()=>{}});
  const a=await qloo.insights({'filter.type':'urn:entity:place',take:5});
  const b=await qloo.insights({take:5,'filter.type':'urn:entity:place'});
  assert.equal(a.cached,false);
  assert.equal(b.cached,true,'parameter order does not defeat the cache');
  assert.equal(seen.length,1);
  assert.equal(seen[0].key,'k');
  assert.ok(!seen[0].url.includes('api_key'));
  await assert.rejects(qloo.insights({'filter.type':'bad'}),/400: bad param/);
  assert.equal(qlooFromEnv({}),null);
});

test('Qloo client paces requests and records the monthly quota', async ()=>{
  let clock=0;
  const sent=[];
  const fetchImpl=async ()=>{
    sent.push(clock);
    return new Response(JSON.stringify({results:{entities:[]}}),{status:200,headers:{'x-month-ratelimit-remaining':'812'}});
  };
  const qloo=qlooFromEnv({QLOO_API_KEY:'k'},fetchImpl,{now:()=>clock,sleep:async (ms)=>{ clock+=ms; },perSecond:4});
  await Promise.all([1,2,3,4,5,6].map((n)=>qloo.insights({take:n})));
  assert.equal(sent.length,6);
  assert.ok(sent.filter((t)=>t<1000).length<=4,'no more than four requests in the first second');
  assert.equal(qloo.meta.monthRemaining(),812);
});

test('Qloo client retries a rate-limited request', async ()=>{
  let calls=0;
  const fetchImpl=async ()=>{
    calls+=1;
    if (calls===1) return new Response(JSON.stringify({error_msg:'Rate limit exceeded'}),{status:429});
    return new Response(JSON.stringify({results:{entities:[{entity_id:'1',name:'A'}]}}),{status:200});
  };
  const qloo=qlooFromEnv({QLOO_API_KEY:'k'},fetchImpl,{sleep:async ()=>{}});
  const out=await qloo.insights({take:1});
  assert.equal(out.entities.length,1);
  assert.equal(calls,2);
});

test('MCP server lists the taste tools', async ()=>{
  const server=buildMcpServer({qloo:null,llm:null});
  const names=Object.keys(server._registeredTools ?? {});
  for (const t of ['market_favourites','shared_culture','find_tags','score_ideas','taste_brief']) assert.ok(names.includes(t),`${t} registered`);
});

test('ideaDomains always includes places and adds culture when present', ()=>{
  const places={marketList:[],baselineList:[],allSource:{}};
  assert.deepEqual(ideaDomains(places).map((d)=>d.label),['places']);
  assert.deepEqual(ideaDomains(places,{marketItems:[],localItems:[]},null).map((d)=>d.label),['places','music']);
});

test('a translated brief keeps citations and must really be Vietnamese', async ()=>{
  const {localizeResult,translationProblems}=await import('../src/agent.js');
  const result={
    input:{city:'Hanoi',market:'Seoul',country:'South Korea',lang:'en'},
    engine:'nemotron',
    ledger:{P1:{kind:'place',item:{name:'Xofa Cafe'}}},
    baseline:{advice:'Add a Korean menu.'},
    brief:{headline:'People in Seoul favour simple places',summary:'Two sentences.',actions:[{title:'Partner with Xofa Cafe',detail:'It ranks first.',refs:['P1']}],partners:[],playlist:[],ideas:[],caveats:['Aggregate only.'],dropped:[]}
  };
  const good={headline:'Người Seoul thích nơi đơn giản',summary:'Hai câu ngắn gọn.',actions:[{title:'Hợp tác với Xofa Cafe',detail:'Quán đứng đầu.'}],partners:[],playlist:[],ideas:[],caveats:['Chỉ là số liệu tổng hợp.'],advice:'Thêm thực đơn tiếng Hàn.'};
  const translator={model:'fake',calls:0,async chatJSON(){ this.calls+=1; return {data:good}; }};
  const vi=await localizeResult(result,{translator});
  assert.equal(vi.input.lang,'vi');
  assert.equal(vi.brief.actions[0].title,'Hợp tác với Xofa Cafe');
  assert.deepEqual(vi.brief.actions[0].refs,['P1'],'refs untouched');
  assert.equal(vi.briefEn.headline,'People in Seoul favour simple places');
  assert.equal(vi.baseline.advice,'Thêm thực đơn tiếng Hàn.');

  assert.ok(translationProblems({actions:[{}]},{...good,headline:'People in Seoul'},['Xofa Cafe']).includes('not Vietnamese'));
  assert.ok(translationProblems({actions:[{}]},{...good,actions:[{title:'Thêm bia',detail:'with several loại bia'}]},[]).some((p)=>p.startsWith('English left')));
  assert.ok(translationProblems({actions:[{},{}]},good,[]).includes('actions count changed'));

  const bad={async chatJSON(){ return {data:{...good,headline:'Still English'}}; },model:'bad'};
  const kept=await localizeResult(result,{translator:bad});
  assert.equal(kept.input.lang,'en','falls back to English when the translation fails the checks');
  assert.match(kept.translationError,/not Vietnamese/);
});
