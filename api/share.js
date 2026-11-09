require('../supabase/config.js');
const { url: supabaseUrl, publishableKey } = globalThis.FANDOMROOM_SUPABASE || {};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

module.exports = async (req, res) => {
  const id = new URL(req.url, 'https://fandomroom.com').searchParams.get('thread');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { res.statusCode = 400; res.end('Thread link is invalid.'); return; }
  if (!supabaseUrl || !publishableKey) { res.statusCode = 503; res.end('FandomRoom is not configured.'); return; }

  try {
    const query = new URLSearchParams({ select: 'id,thread_type,title,context,topic,items:thread_items(image_url,label,position)', id: `eq.${id}`, limit: '1' });
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/threads?${query}`, { headers: { apikey: publishableKey } });
    if (!response.ok) { res.statusCode = 502; res.end('Could not load this FandomRoom thread.'); return; }
    const [thread] = await response.json();
    if (!thread) { res.statusCode = 404; res.end('Thread not found.'); return; }

    const appUrl = `https://www.fandomroom.com/?thread=${encodeURIComponent(thread.id)}`;
    const title = `${thread.title} · FandomRoom`;
    const description = `${thread.thread_type === 'ranking' ? 'Rank it and join the conversation' : 'Vote and join the conversation'} in ${thread.topic || 'your fandom'}. ${thread.context || ''}`.slice(0, 260);
    const image = [...(thread.items || [])].sort((a, b) => a.position - b.position)[0]?.image_url || '';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(appUrl)}"><meta property="og:site_name" content="FandomRoom"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(appUrl)}">${image ? `<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(thread.title)}">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}">${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}<meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}"></head><body><p><a href="${escapeHtml(appUrl)}">Open this FandomRoom thread</a></p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.statusCode = 200; res.end(html);
  } catch {
    res.statusCode = 500; res.end('FandomRoom could not create this share preview.');
  }
};
