// The same analyses as an MCP server, so any agent (Claude Desktop, an IDE, another app) can ask
// what a visitor market favours in a Vietnamese city and get cited Qloo results back.

import {McpServer, createMcpHandler} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {Ledger, bridgeCulture, ideaDomains, marketPlaces, rankIdeaScores, scoreIdea, tasteProfile} from './analysis.js';
import {BUSINESSES, CITIES, MARKETS, businessOf, cityOf, marketOf} from './catalog.js';
import {buildBrief} from './agent.js';

function result(value) {
  return {content:[{type:'text',text:JSON.stringify(value,null,2)}],structuredContent:value};
}

const city=z.enum(CITIES.map((c)=>c.id)).describe('Vietnamese city');
const market=z.enum(MARKETS.map((m)=>m.id)).describe('Visitor market (a city whose residents\' aggregate taste is used)');
const business=z.enum(BUSINESSES.map((b)=>b.id)).describe('Kind of business');

export function buildMcpServer(providers={}) {
  const {qloo=null,llm=null}=providers;
  const need=()=>{
    if (!qloo) throw new Error('QLOO_API_KEY is not configured on this server');
    const left=qloo.meta?.monthRemaining?.();
    if (left!==null && left!==undefined && left<(providers.monthReserve ?? 1000)) throw new Error(`Paused to keep the Qloo event quota for judging (${left} calls left this month)`);
  };

  const server=new McpServer(
    {name:'qloo-taste-brief',version:'0.1.0'},
    {capabilities:{tools:{}}}
  );

  server.registerTool(
    'market_favourites',
    {
      description:'Places in a Vietnamese city ranked by the taste of people in a visitor market (peers of the given business type, and all kinds of places), each with its city-wide rank, plus the tags clearly over-represented among those favourites.',
      inputSchema:z.object({city,market,business})
    },
    async (args)=>{
      need();
      const ledger=new Ledger();
      const pools=await marketPlaces({qloo,ledger},{city:cityOf(args.city),market:marketOf(args.market),business:businessOf(args.business)});
      const profile=tasteProfile({ledger},pools);
      return result({peers:pools.peers,allPlaces:pools.allPlaces,profile,poolSizes:{peers:pools.peerCount,market:pools.marketList.length,city:pools.baselineList.length},sources:pools.sources});
    }
  );

  server.registerTool(
    'shared_culture',
    {
      description:'Music, TV, film or books loved in a visitor market, split into what the Vietnamese host city also loves (bridge) and what is distinctive to the market.',
      inputSchema:z.object({city,market,kind:z.enum(['artist','tv_show','movie','book','podcast']).default('artist')})
    },
    async (args)=>{
      need();
      const out=await bridgeCulture({qloo,ledger:new Ledger()},{city:cityOf(args.city),market:marketOf(args.market),kind:args.kind});
      return result({kind:out.kind,bridge:out.bridge,distinct:out.distinct,sources:out.sources});
    }
  );

  server.registerTool(
    'find_tags',
    {
      description:'Search Qloo place tags by keyword, to map an idea (a dish, an event, an ambience) to a tag id for score_ideas.',
      inputSchema:z.object({query:z.string().min(2).max(40)})
    },
    async ({query})=>{
      need();
      const out=await qloo.tags(query,{parentTypes:'urn:entity:place',take:8});
      return result({tags:out.tags.map((t)=>({id:t.id ?? t.tag_id,name:t.name,family:(t.type ?? t.subtype ?? '').replace('urn:tag:','')}))});
    }
  );

  server.registerTool(
    'score_ideas',
    {
      description:'Score ideas, each mapped to a Qloo tag, by how many of the market\'s favourite places carry the tag compared with the city overall. Verdicts: over-represented, common, untested, absent-from-favourites.',
      inputSchema:z.object({
        city,market,business,
        ideas:z.array(z.object({idea:z.string().min(1).max(120),tag_id:z.string().min(5),tag_name:z.string().min(1)})).min(1).max(6)
      })
    },
    async (args)=>{
      need();
      const ledger=new Ledger();
      const pools=await marketPlaces({qloo,ledger},{city:cityOf(args.city),market:marketOf(args.market),business:businessOf(args.business)});
      const ranked=rankIdeaScores(args.ideas.map((i)=>scoreIdea({ledger},ideaDomains(pools),{tag:{id:i.tag_id,name:i.tag_name},idea:i.idea})));
      return result({ideas:ranked});
    }
  );

  server.registerTool(
    'taste_brief',
    {
      description:'Run the full agent: Qloo analyses, idea mapping and a written one-page plan whose every action cites a Qloo result. Takes 20-60 seconds.',
      inputSchema:z.object({
        city,market,business,
        ownPlace:z.string().max(80).optional().describe('Name of the owner\'s own place, to locate it in Qloo'),
        lang:z.enum(['en','vi']).optional().describe('Language of the written brief'),
        ideas:z.array(z.string().min(1).max(120)).max(6).optional()
      })
    },
    async (args)=>{
      need();
      const brief=await buildBrief(args,{qloo,llm});
      const {ledger,facts,...rest}=brief;
      return result(rest);
    }
  );

  return server;
}

export function createTasteBriefHandler(providers) {
  return createMcpHandler(()=>buildMcpServer(providers));
}
