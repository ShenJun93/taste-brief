// Models on Nebius Token Factory (OpenAI-compatible). NVIDIA Nemotron runs the agent loop and writes
// the brief; a multilingual model translates the finished brief when the owner reads Vietnamese.

export const NEBIUS_BASE_URL='https://api.tokenfactory.nebius.com/v1';
export const DEFAULT_MODEL='nvidia/nemotron-3-super-120b-a12b';
export const DEFAULT_TRANSLATE_MODEL='Qwen/Qwen3-235B-A22B-Instruct-2507';

export function parseJsonObject(text) {
  const start=text.indexOf('{');
  const end=text.lastIndexOf('}');
  if (start<0 || end<=start) throw new Error('model reply contained no JSON object');
  return JSON.parse(text.slice(start,end+1));
}

function nebiusClient({apiKey,baseUrl,model,fetchImpl,sleep}) {
  async function complete(body,timeoutMs) {
    // A dropped connection is retried once; HTTP errors are not.
    let lastError;
    for (let attempt=0; attempt<2; attempt+=1) {
      if (attempt>0) await sleep(1500);
      let res;
      let text;
      try {
        res=await fetchImpl(`${baseUrl}/chat/completions`,{
          method:'POST',
          headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},
          body:JSON.stringify({model,temperature:0,...body}),
          signal:AbortSignal.timeout(timeoutMs)
        });
        text=await res.text();
      } catch (error) {
        lastError=new Error(`Token Factory unreachable: ${error.cause?.code ?? error.message}`);
        continue;
      }
      if (!res.ok) throw new Error(`Token Factory responded ${res.status}: ${text.slice(0,200)}`);
      const out=JSON.parse(text);
      const message=out.choices?.[0]?.message;
      if (!message) throw new Error('Token Factory returned no message');
      return {message,usage:out.usage ?? null};
    }
    throw lastError;
  }

  return {
    name:'nebius-token-factory',
    model,
    async chatTools({messages,tools}) {
      return complete({messages,tools,tool_choice:'auto',max_tokens:3000},60000);
    },
    async chatJSON({system,user,schema,schemaName='result'}) {
      // Nemotron reasons before answering; a long reasoning pass can use up the budget and cut the
      // JSON short, so one retry gets a larger budget.
      let lastError;
      for (const maxTokens of [6000,10000]) {
        const {message,usage}=await complete({
          max_tokens:maxTokens,
          messages:[{role:'system',content:system},{role:'user',content:user}],
          response_format:{type:'json_schema',json_schema:{name:schemaName,schema,strict:true}}
        },90000);
        try {
          if (!message.content) throw new Error('Token Factory returned no content');
          return {data:parseJsonObject(message.content),usage};
        } catch (error) {
          lastError=error;
        }
      }
      throw lastError;
    }
  };
}

const defaults=(env,fetchImpl,sleep)=>({
  apiKey:env.NEBIUS_API_KEY,
  baseUrl:(env.NEBIUS_BASE_URL || NEBIUS_BASE_URL).replace(/\/$/,''),
  fetchImpl,
  sleep
});

export function nebiusFromEnv(env=process.env,fetchImpl=fetch,{sleep=(ms)=>new Promise((r)=>setTimeout(r,ms))}={}) {
  if (!env.NEBIUS_API_KEY) return null;
  return nebiusClient({...defaults(env,fetchImpl,sleep),model:env.NEBIUS_MODEL || DEFAULT_MODEL});
}

export function translatorFromEnv(env=process.env,fetchImpl=fetch,{sleep=(ms)=>new Promise((r)=>setTimeout(r,ms))}={}) {
  if (!env.NEBIUS_API_KEY || env.NEBIUS_TRANSLATE_MODEL==='off') return null;
  return nebiusClient({...defaults(env,fetchImpl,sleep),model:env.NEBIUS_TRANSLATE_MODEL || DEFAULT_TRANSLATE_MODEL});
}
