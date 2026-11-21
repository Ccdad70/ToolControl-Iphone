import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('nevix-web/index.html','utf8');
const proof=source.match(/function isVerifiedLive\(it,now=Date.now\(\)\)\{[\s\S]*?\n\}/)[0];
const verified=vm.runInNewContext('const LIVE_PROOF_TTL=30*60*1000;'+proof+';isVerifiedLive');
const now=100000000,ok={kind:'live',browserPlayable:true,verifiedPlayback:true,testedAt:now-1};
test('verified recent playback exclusively',()=>{assert(verified(ok,now));assert(!verified({...ok,browserPlayable:false},now));assert(!verified({...ok,verifiedPlayback:false},now));assert(!verified({...ok,testedAt:now-1800000},now));assert(!verified({...ok,testedAt:now+1},now));assert(!verified({...ok,kind:'movie'},now));});
test('no untested candidates or external fallback',()=>{const list=source.match(/function allItems\(\)\{[^\n]+/)[0];assert(list.includes('verifiedYoutubeItems()'));assert(list.includes('isVerifiedLive(x)'));assert(!list.includes('venezuelaFeaturedCards()'));const render=source.slice(source.indexOf('function renderLive(){'),source.indexOf('function renderFavorites(){'));assert(render.includes('isVerifiedLive(it)'));assert(!render.includes('renderCountryOfficialAccess(chosen)'));});
test('documentaries not preverified',()=>{const docs=JSON.parse(source.match(/const DOCUMENTARY_EMBEDS=(.*);/)[1]);assert(docs.length>=5);assert(docs.every(x=>x.category==='🌿 Documentales'&&x.embedType==='youtube'&&!x.verifiedPlayback));assert(source.includes('data.isLive===true||duration-first.duration>=1'));});
