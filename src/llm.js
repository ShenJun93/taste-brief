// NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible). Two calls: a tool-using chat turn for
// the agent loop, and a JSON-schema turn for the final brief.

export const NEBIUS_BASE_URL='https://api.tokenfactory.nebius.com/v1';
export const DEFAULT_MODEL='nvidia/nemotron-3-super-120b-a12b';

export function parseJsonObject(text) {
  const start=text.indexOf('{');
  const end=text.lastIndexOf('}');
  if (start<0 || end<=start) throw new Error('model reply contained no JSON object');
  return JSON.parse(text.slice(start,end+1));
}

export function nebiusFromEnv(env=process.env,fetchImpl=fetch) {
  const apiKey=env.NEBIUS_API_KEY;
  if (!apiKey) return null;
  const model=env.NEBIUS_MODEL || DEFAULT_MODEL;
  const baseUrl=(env.NEBIUS_BASE_URL || NEBIUS_BASE_URL).replace(/\/$/,'');

  async function complete(body,timeoutMs) {
    const res=await fetchImpl(`${baseUrl}/chat/completions`,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},
      body:JSON.stringify({model,temperature:0,...body}),
      signal:AbortSignal.timeout(timeoutMs)
    });
    const text=await res.text();
    if (!res.ok) throw new Error(`Token Factory responded ${res.status}: ${text.slice(0,200)}`);
    const out=JSON.parse(text);
    const message=out.choices?.[0]?.message;
    if (!message) throw new Error('Token Factory returned no message');
    return {message,usage:out.usage ?? null};
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
