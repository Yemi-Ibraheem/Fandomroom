(() => {
  const config = globalThis.FANDOMROOM_SUPABASE || {};
  const baseUrl = (config.url || '').replace(/\/$/, '');
  const apiKey = config.publishableKey || '';
  const configured = Boolean(baseUrl && apiKey && !apiKey.includes('PASTE_'));
  const sessionKey = 'talkanime:supabase-session';
  let session = null;

  async function getSession() {
    if (!session) {
      try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
    }
    if (session?.access_token && session.expires_at > Date.now() + 60_000) return session;
    if (session?.refresh_token) {
      const renewed = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (renewed.ok) return storeSession(await renewed.json());
    }
    const response = await fetch(`${baseUrl}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} })
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.msg || result.message || 'Could not start an anonymous Fandom Room session.');
    return storeSession(result);
  }
  function storeSession(value) {
    session = { ...value, expires_at: Date.now() + (value.expires_in || 3600) * 1000 };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    return session;
  }
  async function request(path, options = {}, needsAuth = false) {
    if (!configured) throw new Error('Add the Supabase publishable key in supabase/config.js first.');
    const token = needsAuth ? (await getSession()).access_token : null;
    const headers = { apikey: apiKey, 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      headers
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.details || result.hint || 'Supabase request failed.');
    return result;
  }
  const filters = values => new URLSearchParams(values).toString();
  async function signIn(email, password) {
    if (!configured) throw new Error('Fandom Room sign-in is not configured.');
    const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || 'Could not sign in to Fandom Room.');
    return storeSession(result);
  }
  async function getMembership() {
    if (!session) {
      try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
    }
    if (!session?.access_token) return { active: false, status: 'inactive' };
    const active = await getSession();
    if (active.user?.is_anonymous) return { active: false, status: 'inactive' };
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${active.access_token}` }
    });
    if (!response.ok) throw new Error('Could not check your Premium membership. Please sign in again.');
    const user = await response.json();
    const isPremium = user.app_metadata?.plan === 'premium';
    if (isPremium && active.user?.app_metadata?.plan !== 'premium' && active.refresh_token) {
      const renewed = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: active.refresh_token })
      });
      if (renewed.ok) storeSession(await renewed.json());
    }
    return { active: isPremium, status: isPremium ? 'premium' : 'inactive' };
  }
  async function ratingSummary({ animeSlug, scope, season = '', episode = '' }) {
    const rows = await request(`media_ratings?${filters({ select: 'rating', anime_slug: `eq.${animeSlug}`, scope: `eq.${scope}`, season: `eq.${season}`, episode: `eq.${episode}` })}`);
    const count = rows.length;
    return { count, average: count ? rows.reduce((total, row) => total + Number(row.rating), 0) / count : null };
  }
  async function myRating({ animeSlug, scope, season = '', episode = '' }) {
    const active = await getSession();
    if (active.user?.is_anonymous) return null;
    return request('rpc/get_my_fandomroom_rating', { method: 'POST', body: JSON.stringify({ p_anime_slug: animeSlug, p_scope: scope, p_season: season, p_episode: episode }) }, true);
  }
  async function rateMedia({ animeSlug, scope, season = '', episode = '', rating }) {
    const active = await getSession();
    if (active.user?.is_anonymous) throw new Error('Sign in to your Fandom Room account to rate.');
    const membership = await getMembership();
    if (!membership.active) throw new Error('A Premium membership is required to rate.');
    return request('rpc/rate_fandomroom_media', { method: 'POST', body: JSON.stringify({ p_anime_slug: animeSlug, p_scope: scope, p_season: season, p_episode: episode, p_rating: rating }) }, true);
  }
  async function loadPosts({ animeSlug, scope, season, episode }) {
    const where = { select: 'id,anime_slug,scope,season,episode,parent_id,author_id,body,spoiler,created_at,author:profiles!posts_author_id_fkey(username),likes:post_likes(user_id)', anime_slug: `eq.${animeSlug}`, scope: `eq.${scope}`, parent_id: 'is.null', order: 'created_at.desc' };
    if (scope === 'episode') { where.season = `eq.${season || ''}`; where.episode = `eq.${episode || ''}`; }
    const posts = await request(`posts?${filters(where)}`);
    if (!posts.length) return [];
    const ids = posts.map(post => post.id).join(',');
    const replies = await request(`posts?${filters({ select: 'id,parent_id,author_id,body,created_at,author:profiles!posts_author_id_fkey(username)', parent_id: `in.(${ids})`, order: 'created_at.asc' })}`);
    const replyLikes = replies.length ? await request(`post_likes?${filters({ select: 'post_id,user_id', post_id: `in.(${replies.map(reply => reply.id).join(',')})` })}`) : [];
    return posts.map(post => ({
      id: post.id, createdAt: post.created_at, user: post.author?.username || 'anime_fan', initials: (post.author?.username || 'A').slice(0, 1).toUpperCase(),
      avatar: 'nova', time: new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: post.body, spoiler: post.spoiler, likes: post.likes?.length || 0,
      liked: post.likes?.some(like => like.user_id === session?.user?.id) || false,
      replies: replies.filter(reply => reply.parent_id === post.id).map(reply => ({ id: reply.id, createdAt: reply.created_at, user: reply.author?.username || 'anime_fan', text: reply.body, time: new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), liked: replyLikes.some(like => like.post_id === reply.id && like.user_id === session?.user?.id) }))
    }));
  }
  async function createPost({ animeSlug, scope, season, episode, body, spoiler, parentId = null }) {
    const active = await getSession();
    await request('posts?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ anime_slug: animeSlug, scope, season: season || '', episode: episode || '', body, spoiler, parent_id: parentId, author_id: active.user.id }) }, true);
  }
  async function toggleLike(postId, liked) {
    const active = await getSession();
    const where = filters({ post_id: `eq.${postId}`, user_id: `eq.${active.user.id}` });
    if (liked) await request(`post_likes?${where}`, { method: 'DELETE' }, true);
    else await request('post_likes', { method: 'POST', body: JSON.stringify({ post_id: postId, user_id: active.user.id }) }, true);
  }
  async function isFollowing(animeSlug) {
    if (!session) {
      try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
    }
    if (!session?.access_token) return false;
    const active = await getSession();
    const rows = await request(`follows?${filters({ select: 'anime_slug', user_id: `eq.${active.user.id}`, anime_slug: `eq.${animeSlug}`, limit: '1' })}`, {}, true);
    return rows.length > 0;
  }
  async function setFollowing(animeSlug, follow) {
    const active = await getSession();
    const where = filters({ user_id: `eq.${active.user.id}`, anime_slug: `eq.${animeSlug}` });
    if (follow) await request('follows', { method: 'POST', body: JSON.stringify({ user_id: active.user.id, anime_slug: animeSlug }) }, true);
    else await request(`follows?${where}`, { method: 'DELETE' }, true);
  }
  globalThis.FandomRoomBackend = { configured, createPost, isFollowing, loadPosts, setFollowing, toggleLike, signIn, getMembership, ratingSummary, myRating, rateMedia };
})();
