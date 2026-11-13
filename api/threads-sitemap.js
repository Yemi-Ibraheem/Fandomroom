require('../supabase/config.js');
const { url, publishableKey } = globalThis.FANDOMROOM_SUPABASE || {};
const esc = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
module.exports = async (_req,res) => {
  if(!url||!publishableKey){res.statusCode=503;res.end('Sitemap unavailable.');return;}
  try {
    const query=new URLSearchParams({select:'slug,published_at',published:'eq.true',order:'published_at.desc',limit:'1000'});
    const response=await fetch(`${url.replace(/\/$/,'')}/rest/v1/blog_posts?${query}`,{headers:{apikey:publishableKey}});
    if(!response.ok)throw new Error('Failed to fetch articles.');
    const rows=await response.json();
    const fixed=[{loc:'https://www.fandomroom.com/threads',lastmod:new Date().toISOString()}];
    const articles=rows.map(post=>({loc:`https://www.fandomroom.com/threads/${encodeURIComponent(post.slug)}`,lastmod:post.published_at}));
    const xml=`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...fixed,...articles].map(row=>`<url><loc>${esc(row.loc)}</loc>${row.lastmod?`<lastmod>${esc(new Date(row.lastmod).toISOString())}</lastmod>`:''}</url>`).join('')}</urlset>`;
    res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('Cache-Control','public, s-maxage=1800, stale-while-revalidate=3600');res.statusCode=200;res.end(xml);
  }catch{res.statusCode=502;res.end('Sitemap unavailable.');}
};
