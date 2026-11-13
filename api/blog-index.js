require('../supabase/config.js');
const fs=require('node:fs');
const path=require('node:path');
const { url,publishableKey }=globalThis.FANDOMROOM_SUPABASE||{};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value)):'';
module.exports=async(_req,res)=>{
  if(!url||!publishableKey){res.statusCode=503;res.end('Fandom Room is not configured.');return;}
  try{
    const query=new URLSearchParams({select:'slug,title,excerpt,cover_image,topic,published_at,author:profiles!blog_posts_author_id_fkey(username)',published:'eq.true',order:'published_at.desc',limit:'50'});
    const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/blog_posts?${query}`,{headers:{apikey:publishableKey}});
    if(!response.ok)throw new Error('Could not load articles.');
    const posts=await response.json();
    const articles=posts.length?posts.map(post=>`<a class="t-story" href="/threads/${encodeURIComponent(post.slug)}"><div><span class="t-kicker">${esc(post.topic||'Anime')}</span><h3>${esc(post.title)}</h3><p>${esc(post.excerpt)}</p><div class="t-meta">${esc(post.author?.username||'Fandom Room')} · ${date(post.published_at)}</div></div>${post.cover_image?`<img src="${esc(post.cover_image)}" alt="" loading="lazy">`:'<span class="t-story-placeholder" aria-hidden="true">FR</span>'}</a>`).join(''):'<p class="t-status">The first story is on its way. Check back soon.</p>';
    let html=fs.readFileSync(path.join(__dirname,'..','threads.html'),'utf8');
    html=html.replace('<div id="articleList" class="t-list" aria-live="polite"><p class="t-status">Loading the latest stories…</p></div>',`<div id="articleList" class="t-list" aria-live="polite">${articles}</div>`).replace('<span id="storyCount" class="t-count"></span>',`<span id="storyCount" class="t-count">${posts.length} ${posts.length===1?'story':'stories'}</span>`);
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=3600');res.statusCode=200;res.end(html);
  }catch{res.statusCode=502;res.end('Threads could not load right now.');}
};
