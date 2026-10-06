// Measures, once, how many places in each Vietnamese city Qloo returns with a measurable signal for
// each visitor market, so the form can warn before a brief would come back thin or empty.
//   node --env-file=.env scripts/coverage.mjs [city-id ...]   (14 Qloo calls per city)
// Cities already in data/coverage.json are kept unless named again.
import {readFile, writeFile} from 'node:fs/promises';
import {qlooFromEnv} from '../src/qloo.js';
import {CITIES, MARKETS} from '../src/catalog.js';

const file=new URL('../data/coverage.json',import.meta.url);
const qloo=qlooFromEnv(process.env);
const previous=await readFile(file,'utf8').then(JSON.parse).catch(()=>({counts:{}}));
const counts={...previous.counts};
const wanted=process.argv.slice(2);
for (const city of CITIES) {
  if (wanted.length ? !wanted.includes(city.id) : counts[city.id]) continue;
  const row={};
  for (const market of MARKETS) {
    const out=await qloo.insights({'filter.type':'urn:entity:place','filter.location.query':city.query,'signal.location.query':market.query,take:50});
    row[market.id]=out.entities.length;
  }
  counts[city.id]=row;
  await writeFile(file,JSON.stringify({measuredAt:new Date().toISOString(),take:50,counts},null,1));
  console.log(city.id,JSON.stringify(row));
}
console.log('qloo',JSON.stringify(qloo.meta.stats()));
