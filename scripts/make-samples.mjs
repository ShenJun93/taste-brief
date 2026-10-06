// Regenerates the saved examples served by the sample buttons, so judges can open a finished brief
// instantly. Run with the same keys as the server: node --env-file=.env scripts/make-samples.mjs
import {writeFile} from 'node:fs/promises';
import {qlooFromEnv} from '../src/qloo.js';
import {nebiusFromEnv} from '../src/llm.js';
import {buildBrief} from '../src/agent.js';

const SAMPLES={
  'hanoi-cafe-seoul':{city:'hanoi',market:'seoul',business:'cafe',ownPlace:'Xofa Cafe',ideas:['egg coffee workshop','live music on Fridays','K-pop playlist','vegan cakes']},
  'hoian-stay-sydney':{city:'hoian',market:'sydney',business:'stay',ideas:['cooking class','bicycle tours','rooftop bar','yoga mornings']},
  'hcmc-cafe-tokyo':{city:'hcmc',market:'tokyo',business:'cafe',ideas:['matcha latte','rooftop seating','vinyl records','pour-over coffee']}
};

const qloo=qlooFromEnv(process.env);
const llm=nebiusFromEnv(process.env);
const only=process.argv[2];
for (const [id,input] of Object.entries(SAMPLES)) {
  if (only && id!==only) continue;
  const started=Date.now();
  const brief=await buildBrief(input,{qloo,llm});
  brief.generatedAt=new Date().toISOString();
  await writeFile(new URL(`../data/samples/${id}.json`,import.meta.url),JSON.stringify(brief,null,1));
  console.log(`${id}: ${brief.places.length} places, ${brief.profile.length} tags, ${brief.ideas.filter((i)=>i.status==='ranked').length}/${brief.ideas.length} ideas scored, ${brief.brief.actions.length} actions, ${((Date.now()-started)/1000).toFixed(0)}s, engine ${brief.engine}`);
}
console.log('qloo',JSON.stringify(qloo.meta.stats()));
