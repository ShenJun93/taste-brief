import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ledger, marketPlaces, rankIdeaScores, scoreIdeaInPools, tasteProfile, bridgeCulture} from '../src/analysis.js';
import {cityOf, marketOf, businessOf} from '../src/catalog.js';
import {buildBrief, readInput, sameName, validateBrief} from '../src/agent.js';
import {qlooFromEnv, compactPlace} from '../src/qloo.js';
import {buildMcpServer} from '../src/mcp.js';

const place=(id,name,tags=[])=>({entity_id:id,name,subtype:'urn:entity:place',properties:{address:`${name} St, Hà Nội, Vietnam`},tags:tags.map((t)=>({id:`urn:tag:ambience:qloo:${t.toLowerCase()}`,name:t,type:'urn:tag:ambience:qloo'}))});
const artist=(id,name)=>({entity_id:id,name,subtype:'urn:entity:artist'});

// A stand-in for the Qloo client: answers by request shape, records every call.
function fakeQloo({market=[],city=[],wideMarket=[],wideCity=[],artistsAbroad=[],artistsLocal=[]}={}) {
  const calls=[];
  return {
    calls,
    name:'qloo',
    async insights(params) {
      calls.push(params);
      const type=params['filter.type'];
      let entities=[];
      if (type==='urn:entity:place') {
        const wide=!params['filter.tags'];
        entities=params['signal.location.query']?(wide?wideMarket:market):(wide?wideCity:city);
      } else if (type==='urn:entity:artist') {
        entities=params['signal.location.query']==='Seoul'?artistsAbroad:artistsLocal;
      }
      return {path:'/v2/insights',params,cached:false,entities,tags:[]};
    },
    async tags() { return {tags:[]}; },
    async search() { return {entities:[]}; }
  };
}

const hanoi=cityOf('hanoi');
const seoul=marketOf('seoul');
const cafe=businessOf('cafe');

test('readInput validates choices and trims ideas', ()=>{
  const input=readInput({city:'hanoi',market:'seoul',business:'cafe',ideas:'a\n\n b \nc\nd\ne\nf\ng',ownPlace:'  '});
  assert.deepEqual(input.ideas,['a','b','c','d','e','f']);
  assert.equal(input.ownPlace,null);
  assert.throws(()=>readInput({city:'atlantis',market:'seoul',business:'cafe'}),/unknown city/);
});

test('sameName ignores Vietnamese diacritics and case', ()=>{
  assert.ok(sameName('Phở Quỳnh','pho quynh'));
  assert.ok(sameName('Bún Chả Hương Liên','Bun Cha Huong Lien - Obama'));
  assert.ok(!sameName('BTS','BLACKPINK'));
});

test('marketPlaces compares the market ranking with the city ranking', async ()=>{
  const qloo=fakeQloo({
    market:[place('b','Beta'),place('a','Alpha'),place('n','New'),place('c','Gamma'),place('d','Delta')],
    city:[place('a','Alpha'),place('c','Gamma'),place('d','Delta'),place('b','Beta')]
  });
  const ledger=new Ledger();
  const out=await marketPlaces({qloo,ledger},{city:hanoi,market:seoul,business:cafe});
  assert.equal(out.scope,'business');
  assert.deepEqual(out.places.map((p)=>[p.name,p.rank,p.cityRank,p.lift]),[['Beta',1,4,3],['Alpha',2,1,-1],['New',3,null,null],['Gamma',4,2,-2],['Delta',5,3,-2]]);
  assert.equal(out.places[0].ref,'P1');
  assert.equal(ledger.get('P1').item.name,'Beta');
  assert.equal(qloo.calls[0]['signal.location.query'],'Seoul');
  assert.equal(qloo.calls[0]['operator.filter.tags'],'union');
});

test('marketPlaces widens to all places when the market signal is too thin', async ()=>{
  const qloo=fakeQloo({
    market:[place('a','Alpha')],
    city:[place('a','Alpha')],
    wideMarket:[1,2,3,4,5,6].map((i)=>place(`w${i}`,`Wide ${i}`)),
    wideCity:[place('w1','Wide 1')]
  });
  const out=await marketPlaces({qloo,ledger:new Ledger()},{city:hanoi,market:seoul,business:cafe});
  assert.equal(out.scope,'all-places');
  assert.equal(out.places.length,6);
});

test('tasteProfile finds tags over-represented among market favourites', async ()=>{
  const market=Array.from({length:10},(_,i)=>place(`m${i}`,`M${i}`,i<6?['Boutique','Cozy']:['Cozy']));
  const city=Array.from({length:20},(_,i)=>place(`c${i}`,`C${i}`,i<2?['Boutique','Cozy']:['Cozy']));
  const ledger=new Ledger();
  const pools=await marketPlaces({qloo:fakeQloo({market,city}),ledger},{city:hanoi,market:seoul,business:cafe});
  const profile=tasteProfile({ledger},pools);
  assert.equal(profile.length,1,'Cozy is everywhere, only Boutique stands out');
  assert.deepEqual([profile[0].name,profile[0].marketCount,profile[0].marketTotal,profile[0].baselineCount,profile[0].baselineTotal],['Boutique',6,10,2,20]);
  assert.match(profile[0].ref,/^T\d+$/);
  assert.ok(profile[0].places.every((r)=>ledger.get(r).kind==='place'));
});

test('tasteProfile refuses to profile a tiny pool', async ()=>{
  const ledger=new Ledger();
  const pools=await marketPlaces({qloo:fakeQloo({market:[place('a','A',['X']),place('b','B',['X']),place('c','C',['X']),place('d','D',['X']),place('e','E',['X'])],city:[place('z','Z')]}),ledger},{city:hanoi,market:seoul,business:cafe});
  assert.deepEqual(tasteProfile({ledger},pools),[]);
});

test('idea verdicts separate a real signal from a common or untested idea', ()=>{
  const ledger=new Ledger();
  const mk=(n,tags)=>Array.from({length:n},(_,i)=>compactPlace(place(`${tags.join()}${i}`,`P${i}`,tags)));
  const pools={
    marketList:[...mk(4,['Egg Coffee']),...mk(6,['Coffee'])],
    baselineList:[...mk(2,['Egg Coffee']),...mk(18,['Coffee']),...mk(1,['Live Music'])],
    places:[]
  };
  const score=(name,idea)=>scoreIdeaInPools({ledger},pools,{tag:{id:`urn:tag:x:${name}`,name},idea});
  const ranked=rankIdeaScores([score('Coffee','coffee'),score('Live Music','live music'),score('Vegan Cake','vegan cake'),score('Egg Coffee','egg coffee')]);
  assert.deepEqual(ranked.map((r)=>[r.idea,r.verdict]),[
    ['egg coffee','over-represented'],
    ['coffee','common'],
    ['vegan cake','untested'],
    ['live music','absent-from-favourites']
  ]);
});

test('bridgeCulture splits shared and distinctive taste', async ()=>{
  const qloo=fakeQloo({artistsAbroad:[artist('1','IU'),artist('2','BTS'),artist('3','Jennie')],artistsLocal:[artist('3','Jennie'),artist('9','Sơn Tùng M-TP')]});
  const out=await bridgeCulture({qloo,ledger:new Ledger()},{city:hanoi,market:seoul,kind:'artist'});
  assert.deepEqual(out.bridge.map((a)=>[a.name,a.rank,a.localRank]),[['Jennie',3,1]]);
  assert.deepEqual(out.distinct.map((a)=>a.name),['IU','BTS']);
});

test('validateBrief drops uncited actions and refs of the wrong kind', async ()=>{
  const ledger=new Ledger();
  await marketPlaces({qloo:fakeQloo({market:[place('a','Alpha')],city:[place('a','Alpha')]}),ledger},{city:hanoi,market:seoul,business:cafe});
  const out=validateBrief({
    headline:'h',summary:'s',
    actions:[{title:'cited',detail:'Partner with P1 now',refs:['P1','P99']},{title:'invented',detail:'d',refs:['P42']}],
    partners:[{ref:'P1',why:'w'},{ref:'C1',why:'w'}],
    playlist:[{ref:'P1',why:'not music'}],
    ideas:[],caveats:['c']
  },ledger);
  assert.deepEqual(out.actions.map((a)=>[a.title,a.refs]),[['cited',['P1']]]);
  assert.deepEqual(out.dropped,['invented']);
  assert.equal(out.actions[0].detail,'Partner with Alpha now');
  assert.deepEqual(out.partners.map((p)=>p.ref),['P1']);
  assert.deepEqual(out.playlist,[]);
});

test('buildBrief without a model still returns a cited rule brief', async ()=>{
  const market=Array.from({length:10},(_,i)=>place(`m${i}`,`M${i}`,i<6?['Boutique']:[]));
  const city=Array.from({length:20},(_,i)=>place(`c${i}`,`C${i}`,i<1?['Boutique']:[]));
  const qloo=fakeQloo({market,city,artistsAbroad:[artist('3','Jennie')],artistsLocal:[artist('3','Jennie')]});
  const events=[];
  const out=await buildBrief({city:'hanoi',market:'seoul',business:'cafe',ideas:['egg coffee']},{qloo,llm:null,onEvent:(e)=>events.push(e)});
  assert.equal(out.engine,'rules');
  assert.ok(out.brief.actions.length>=2);
  for (const a of out.brief.actions) for (const r of a.refs) assert.ok(out.ledger[r],`${r} is in the ledger`);
  assert.equal(out.ideas[0].status,'not-evaluated');
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
  assert.ok(!seen[0].url.includes('k&') && !seen[0].url.includes('api_key'));
  await assert.rejects(qloo.insights({'filter.type':'bad'}),/400: bad param/);
  assert.equal(qlooFromEnv({}),null);
});

test('MCP server lists the taste tools', async ()=>{
  const server=buildMcpServer({qloo:null,llm:null});
  const names=Object.keys(server._registeredTools ?? {});
  for (const t of ['market_favourites','shared_culture','find_tags','score_ideas','taste_brief']) assert.ok(names.includes(t),`${t} registered`);
});
