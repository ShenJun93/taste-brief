// Regenerates the saved examples served by the example buttons, in English and Vietnamese, so
// judges can open a finished brief instantly. Run with the same keys as the server:
//   node --env-file=.env scripts/make-samples.mjs [sample-id] [en|vi]
import {writeFile} from 'node:fs/promises';
import {qlooFromEnv} from '../src/qloo.js';
import {nebiusFromEnv} from '../src/llm.js';
import {buildBrief} from '../src/agent.js';

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
const [only,onlyLang]=process.argv.slice(2);
for (const [id,input] of Object.entries(SAMPLES)) {
  if (only && only!=='all' && id!==only) continue;
  for (const lang of ['en','vi']) {
    if (onlyLang && lang!==onlyLang) continue;
    const started=Date.now();
    const brief=await buildBrief({...input,lang},{qloo,llm});
    brief.generatedAt=new Date().toISOString();
    const file=lang==='en'?`${id}.json`:`${id}-vi.json`;
    await writeFile(new URL(`../data/samples/${file}`,import.meta.url),JSON.stringify(brief,null,1));
    console.log(`${file}: ${brief.peerCount} peers, ${brief.profile.length} tags, ${brief.ideas.filter((i)=>i.status==='ranked').length}/${brief.ideas.length} ideas scored, ${brief.brief.actions.length} actions (${brief.brief.dropped.length} dropped), ${((Date.now()-started)/1000).toFixed(0)}s, ${brief.engine}`);
  }
}
console.log('qloo',JSON.stringify(qloo.meta.stats()));
