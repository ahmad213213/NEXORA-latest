const UA = 'NEXORA/1.0 (game library metadata client)';
const TIMEOUT = 9000;

function text(v){ return typeof v === 'string' ? v.trim() : ''; }
function key(v){ return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' '); }
function similarity(a,b){
  if(!a||!b) return 0;
  const p=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let d=p[0];p[0]=i;for(let j=1;j<=b.length;j++){const u=p[j];p[j]=Math.min(p[j]+1,p[j-1]+1,d+(a[i-1]===b[j-1]?0:1));d=u;}}
  return 1-p[b.length]/Math.max(a.length,b.length);
}
function scoreTitle(q,t){
  q=key(q);t=key(t);if(!q||!t)return 0;if(q===t)return 1;if(t.includes(q)||q.includes(t))return .88;
  const qs=q.split(' '), ts=new Set(t.split(' ')); const overlap=qs.filter(x=>ts.has(x)).length/Math.max(1,qs.length);
  return Math.min(.86, overlap*.65+similarity(q.replace(/\s/g,''),t.replace(/\s/g,''))*.35);
}
async function fetchWithTimeout(url, init={}){
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),TIMEOUT);
  try{
    const r=await fetch(url,{...init,signal:ctl.signal,headers:{'user-agent':UA,accept:'application/json,text/html;q=0.9,*/*;q=0.5',...(init.headers||{})}});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r;
  } finally { clearTimeout(timer); }
}
function candidate(provider,id,title,sourceUrl,coverImageUrl,releaseDate,query){
  return {id:`${provider}:${id}`,provider,providerId:String(id),title,sourceUrl,coverImageUrl:coverImageUrl||null,releaseDate:releaseDate||null,matchScore:scoreTitle(query,title)};
}
async function steamSearch(query,limit){
  const u=new URL('https://store.steampowered.com/api/storesearch/');
  u.searchParams.set('term',query);u.searchParams.set('cc','us');u.searchParams.set('l','en');
  const j=await (await fetchWithTimeout(u)).json();
  return (j.items||[]).slice(0,limit).map(x=>candidate('steam',x.id,text(x.name),`https://store.steampowered.com/app/${x.id}/`,`https://cdn.akamai.steamstatic.com/steam/apps/${x.id}/header.jpg`,null,query)).filter(x=>x.title);
}
async function gogSearch(query,limit){
  const u=new URL('https://embed.gog.com/games/ajax/filtered');
  u.searchParams.set('mediaType','game');u.searchParams.set('search',query);
  const j=await (await fetchWithTimeout(u)).json();
  return (j.products||[]).slice(0,limit).map(x=>{
    const id=x.id??x.slug??x.url; const title=text(x.title);
    const image=x.image? (String(x.image).startsWith('//')?'https:'+x.image:String(x.image)) : null;
    const source=x.url?new URL(x.url,'https://www.gog.com').href:`https://www.gog.com/en/game/${x.slug||''}`;
    return candidate('gog',id,title,source,image,x.releaseDate||null,query);
  }).filter(x=>x.title);
}
function uniqResults(items){
  const seen=new Set(),out=[];
  for(const x of items.sort((a,b)=>b.matchScore-a.matchScore)){
    const k=key(x.title); if(!k||seen.has(k)) continue; seen.add(k); out.push(x);
  }
  return out;
}
export async function searchGames(query,{limit=12}={}){
  const q=text(query); if(!q) return {results:[]};
  const settled=await Promise.allSettled([steamSearch(q,limit),gogSearch(q,limit)]);
  const all=settled.flatMap(x=>x.status==='fulfilled'?x.value:[]);
  return {results:uniqResults(all).slice(0,limit)};
}
async function steamDetails(id){
  const u=new URL('https://store.steampowered.com/api/appdetails');
  u.searchParams.set('appids',id);u.searchParams.set('cc','us');u.searchParams.set('l','en');
  const j=await (await fetchWithTimeout(u)).json(); const row=j?.[id]; if(!row?.success) return null;
  const d=row.data||{};
  return {
    title:text(d.name), description:text(d.short_description),
    releaseDate:text(d.release_date?.date), developers:d.developers||[], publishers:d.publishers||[],
    genres:(d.genres||[]).map(x=>x.description).filter(Boolean),
    platforms:Object.entries(d.platforms||{}).filter(([,v])=>v).map(([k])=>k),
    storeUrl:`https://store.steampowered.com/app/${id}/`,
    coverImageUrl:d.header_image||null,
    coverImageCandidates:[d.header_image, d.capsule_image, d.capsule_imagev5].filter(Boolean),
    screenshots:(d.screenshots||[]).map(x=>x.path_full).filter(Boolean)
  };
}
export async function getGameDetails(title, opts={}){
  let record={title:text(title),storeUrl:opts.preferredSourceUrl||null,coverImageCandidates:[]};
  if(opts.preferredProvider==='steam' && opts.preferredProviderId){
    try{ record={...record,...(await steamDetails(String(opts.preferredProviderId))||{})}; }catch{}
  }
  return {record};
}
export async function downloadBestCover(urls,{timeoutMs=10000}={}){
  for(const raw of urls||[]){
    if(!/^https?:\/\//i.test(String(raw||''))) continue;
    const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await fetch(raw,{signal:ctl.signal,headers:{'user-agent':UA,'accept':'image/*,*/*;q=.5'}});
      if(!r.ok) continue; const buf=Buffer.from(await r.arrayBuffer());
      if(!buf.length || buf.length>25*1024*1024) continue;
      return {buf,contentType:r.headers.get('content-type')||'',url:raw};
    }catch{}finally{clearTimeout(timer);}
  }
  return null;
}
export function safeFolderName(v){
  return String(v||'Game').replace(/[<>:"/\\|?*\x00-\x1F]/g,' ').replace(/\s+/g,' ').trim().slice(0,80)||'Game';
}