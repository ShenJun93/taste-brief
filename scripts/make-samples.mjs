// Regenerates the saved examples served by the example buttons, in English and Vietnamese, so
// judges can open a finished brief instantly. The Vietnamese file is a translation of the English
// one (same Qloo data and checks). Run with the same keys as the server:
//   node --env-file=.env scripts/make-samples.mjs [sample-id|all] [en|vi]
// "vi" alone re-translates the saved English file without calling Qloo.
import {readFile, writeFile} from 'node:fs/promises';
import {qlooFromEnv} from '../src/qloo.js';
import {nebiusFromEnv, translatorFromEnv} from '../src/llm.js';
import {buildBrief, localizeResult} from '../src/agent.js';

export const SAMPLES={
  'hanoi-cafe-seoul':{city:'hanoi',market:'seoul',business:'cafe',ownPlace:'Xofa Cafe',ideas:['egg coffee workshop','live music on Fridays','K-pop playlist','vegan cakes']},
  'hoian-stay-sydney':{city:'hoian',market:'sydney',business:'stay',ideas:['cooking class','bicycle tours','rooftop bar','yoga mornings']},
  'hcmc-cafe-tokyo':{city:'hcmc',market:'tokyo',business:'cafe',ideas:['matcha latte','rooftop seating','vinyl records','pour-over coffee']},
  'danang-cafe-seoul':{city:'danang',market:'seoul',business:'cafe',ideas:['sea view terrace','coconut coffee','K-pop playlist','brunch menu']},
  'hcmc-bar-seoul':{city:'hcmc',market:'seoul',business:'bar',ideas:['craft beer','live jazz','karaoke night','rooftop view']},
  'hanoi-stay-tokyo':{city:'hanoi',market:'tokyo',business:'stay',ideas:['onsen-style bath','old quarter walking tour','cooking class','quiet rooms']},
  'hcmc-restaurant-singapore':{city:'hcmc',market:'singapore',business:'restaurant',ideas:['seafood hotpot','halal options','street food tour','late-night menu']}
};

const qloo=qlooFromEnv(process.env);
const llm=nebiusFromEnv(process.env);
const translator=translatorFromEnv(process.env);
const [only,onlyLang]=process.argv.slice(2);
const path=(file)=>new URL(`../data/samples/${file}`,import.meta.url);
const summary=(file,b,started)=>console.log(`${file}: ${b.peerCount} peers, ${b.profile.length} tags, ${b.ideas.filter((i)=>i.status==='ranked').length}/${b.ideas.length} ideas scored, ${b.brief.actions.length} actions (${b.brief.dropped.length} dropped), ${((Date.now()-started)/1000).toFixed(0)}s, ${b.engine}${b.translationError?` [${b.translationError}]`:''}`);

for (const [id,input] of Object.entries(SAMPLES)) {
  if (only && only!=='all' && id!==only) continue;
  let started=Date.now();
  let en;
  if (onlyLang==='vi') {
    en=JSON.parse(await readFile(path(`${id}.json`),'utf8'));
  } else {
    en=await buildBrief({...input,lang:'en'},{qloo,llm});
    en.generatedAt=new Date().toISOString();
    await writeFile(path(`${id}.json`),JSON.stringify(en,null,1));
    summary(`${id}.json`,en,started);
  }
  if (onlyLang==='en') continue;
  started=Date.now();
  const vi=await localizeResult(en,{translator});
  vi.generatedAt=en.generatedAt;
  await writeFile(path(`${id}-vi.json`),JSON.stringify(vi,null,1));
  summary(`${id}-vi.json`,vi,started);
}
console.log('qloo',JSON.stringify(qloo.meta.stats()));
