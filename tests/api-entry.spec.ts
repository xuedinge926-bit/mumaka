import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { createSpotifyHandler } from '../server/spotify';

let server:Server;
let origin:string;
let previous:string|undefined;
let handler:ReturnType<typeof createSpotifyHandler>;
test.beforeAll(async()=>{
  previous=process.env.SPOTIFY_ALLOWED_ORIGINS;
  process.env.SPOTIFY_ALLOWED_ORIGINS='https://xuedinge926-bit.github.io';
  // Vercel sets environment before loading the function module on cold start.
  handler=(await import('../api/spotify')).default;
  server=createServer((req,res)=>{void handler(req,res);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
test.afterAll(async()=>{
  if(previous===undefined)delete process.env.SPOTIFY_ALLOWED_ORIGINS;else process.env.SPOTIFY_ALLOWED_ORIGINS=previous;
  await new Promise<void>(resolve=>server.close(()=>resolve()));
});
test('Vercel 实际入口响应前端 action 契约与精确 Pages CORS，无上游调用',async()=>{
  const response=await fetch(origin+'/api/spotify?action=status',{headers:{Origin:'https://xuedinge926-bit.github.io'},signal:AbortSignal.timeout(3000)});
  expect(response.status).toBe(200);
  expect(typeof (await response.json()).data.configured).toBe('boolean');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://xuedinge926-bit.github.io');
  const denied=await fetch(origin+'/api/spotify?action=status',{headers:{Origin:'https://elsewhere.test'},signal:AbortSignal.timeout(3000)});
  expect(denied.status).toBe(403);
});
