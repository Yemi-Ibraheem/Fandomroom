(() => {
  const config = globalThis.FANDOMROOM_SUPABASE || {};
  const baseUrl = (config.url || '').replace(/\/$/, '');
  const apiKey = config.publishableKey || '';
  const sessionKey = 'fandomroom:website-session';
  let session = null;

  function readSession() {
    if (session) return session;
    try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
    return session;
  }
  function storeSession(value) {
    session = value ? { ...value, expires_at: value.expires_at || Date.now() + (value.expires_in || 3600) * 1000 } : null;
    try { if (session) localStorage.setItem(sessionKey, JSON.stringify(session)); else localStorage.removeItem(sessionKey); } catch {}
    return session;
  }
  async function authRequest(path, body, method = 'POST') {
    const response = await fetch(`${baseUrl}/auth/v1/${path}`, {
      method, headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Authentication failed.');
    return result;
  }
  async function getSession() {
    let active = readSession();
    if (!active?.access_token) return null;
    if (active.expires_at > Date.now() + 60_000) return active;
    if (!active.refresh_token) { storeSession(null); return null; }
    try {
      const renewed = await authRequest('token?grant_type=refresh_token', { refresh_token: active.refresh_token });
      return storeSession(renewed);
    } catch { storeSession(null); return null; }
  }
  async function resumeLinkSession() {
    const params = new URLSearchParams(location.hash.slice(1));
    const authError = params.get('error_description');
    if (authError) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      throw new Error(authError);
    }
    const accessToken = params.get('access_token');
    if (!accessToken) return false;
    const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` } });
    const user = await response.json().catch(() => ({}));
    if (!response.ok || !user.id) throw new Error('That sign-in link has expired. Please sign in again.');
    storeSession({ access_token: accessToken, refresh_token: params.get('refresh_token') || '', expires_in: Number(params.get('expires_in') || 3600), user });
    const pendingProfile = localStorage.getItem('fandomroom:pending-signup-profile');
    const isSignup = Boolean(pendingProfile);
    if (pendingProfile) {
      try {
        await saveSignupProfile(JSON.parse(pendingProfile), accessToken);
        localStorage.removeItem('fandomroom:pending-signup-profile');
      } catch (error) {
        throw new Error(`${error.message} Please complete signup again.`);
      }
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return isSignup;
  }
  async function signUp(email, password, profile = {}) {
    const redirect = `${location.origin}${location.pathname}`;
    const result = await authRequest(`signup?redirect_to=${encodeURIComponent(redirect)}`, {
      email, password, data: { username: profile.username, country: profile.country }
    });
    if (result.access_token) storeSession(result);
    return { session: readSession(), needsEmailConfirmation: !result.access_token };
  }
  async function signIn(email, password) { return storeSession(await authRequest('token?grant_type=password', { email, password })); }
  async function requestPasswordReset(email) {
    const redirect = `${location.origin}${location.pathname}`;
    return authRequest(`recover?redirect_to=${encodeURIComponent(redirect)}`, { email });
  }
  async function updatePassword(password) {
    const active = await getSession();
    if (!active?.access_token) throw new Error('Your password reset link has expired. Request a new one and try again.');
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: apiKey, Authorization: `Bearer ${active.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Could not change your password. Please try again.');
    storeSession({ ...active, user: result });
    return result;
  }
  async function isUsernameAvailable(username) {
    const rows = await request(`profiles?${params({ select: 'id', username: `eq.${username.toLowerCase()}`, limit: '1' })}`);
    return rows.length === 0;
  }
  async function saveSignupProfile(profile, accessToken) {
    const active = readSession();
    const profileResponse = await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(active.user.id)}`, {
      method: 'PATCH',
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ username: profile.username })
    });
    if (!profileResponse.ok) {
      const error = await profileResponse.json().catch(() => ({}));
      throw new Error(error.message || 'Could not save your username.');
    }
    const authResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { username: profile.username, country: profile.country } })
    });
    const authResult = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok) throw new Error(authResult.msg || authResult.message || 'Could not save your country.');
  }
  function signInWithGoogle(profile = null) {
    if (!baseUrl || !apiKey) throw new Error('Fandom Room sign-in is not configured yet.');
    if (profile) localStorage.setItem('fandomroom:pending-signup-profile', JSON.stringify(profile));
    else localStorage.removeItem('fandomroom:pending-signup-profile');
    const returnTo = `${location.origin}${location.pathname}${location.search}`;
    const authorize = new URL(`${baseUrl}/auth/v1/authorize`);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', returnTo);
    authorize.searchParams.set('apikey', apiKey);
    location.assign(authorize.toString());
  }
  async function signOut() {
    const active = await getSession();
    if (active) {
      await fetch(`${baseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: apiKey, Authorization: `Bearer ${active.access_token}` } }).catch(() => {});
    }
    storeSession(null);
  }
  async function request(path, options = {}, needsAuth = false) {
    const active = needsAuth ? await getSession() : null;
    if (needsAuth && !active) throw new Error('Sign in to continue.');
    const headers = { apikey: apiKey, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
    if (active?.access_token) headers.Authorization = `Bearer ${active.access_token}`;
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, { ...options, headers });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.details || result.hint || 'Fandom Room could not complete that request.');
    return result;
  }
  const params = values => new URLSearchParams(values).toString();
  async function uploadImage(file, ownerId, threadId, index) {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Use a JPG, PNG, WebP, or GIF image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.');
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${ownerId}/${threadId}/${index}-${crypto.randomUUID()}.${ext}`;
    const active = await getSession();
    const response = await fetch(`${baseUrl}/storage/v1/object/thread-images/${path}`, {
      method: 'POST', headers: { apikey: apiKey, Authorization: `Bearer ${active.access_token}`, 'Content-Type': file.type, 'x-upsert': 'false' }, body: file
    });
    if (!response.ok) { const message = await response.json().catch(() => ({})); throw new Error(message.message || 'Could not upload this image.'); }
    return `${baseUrl}/storage/v1/object/public/thread-images/${path}`;
  }
  async function createThread(draft) {
    const active = await getSession();
    if (!active) throw new Error('Sign in to create a thread.');
    const threadId = crypto.randomUUID();
    const uploaded = [];
    try {
      const items = [];
      for (let index = 0; index < draft.items.length; index += 1) {
        const item = draft.items[index];
        const imageUrl = await uploadImage(item.file, active.user.id, threadId, index + 1);
        uploaded.push(imageUrl);
        items.push({ label: item.label.trim(), image_url: imageUrl });
      }
      const poll = draft.type === 'poll';
      await request('rpc/create_fandomroom_thread', { method: 'POST', body: JSON.stringify({
        p_thread_id: threadId, p_thread_type: draft.type, p_title: draft.title, p_context: draft.context,
        p_topic: draft.topic, p_anime_slug: draft.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general',
        p_poll_mode: poll ? draft.pollMode : null, p_ranking_mode: poll ? null : draft.rankingMode,
        p_closes_at: draft.closesAt, p_items: items
      }) }, true);
      return threadId;
    } catch (error) {
      if (uploaded.length) {
        const paths = uploaded.map(url => decodeURIComponent(url.split('/storage/v1/object/public/thread-images/')[1])).map(name => ({ name }));
        const active = await getSession();
        if (active) await fetch(`${baseUrl}/storage/v1/object/thread-images`, { method: 'DELETE', headers: { apikey: apiKey, Authorization: `Bearer ${active.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths.map(item => item.name) }) }).catch(() => {});
      }
      throw error;
    }
  }
  async function listThreads(type = 'all', query = '', authorId = '') {
    const filters = { select: 'id,thread_type,title,context,topic,anime_slug,poll_mode,ranking_mode,closes_at,created_at,author:profiles!threads_author_id_fkey(username),items:thread_items(id,label,image_url,position)', order: 'created_at.desc', limit: '40' };
    if (type !== 'all') filters.thread_type = `eq.${type}`;
    if (authorId) filters.author_id = `eq.${authorId}`;
    if (query) filters.title = `ilike.*${query.replace(/[%,()]/g, '')}*`;
    return request(`threads?${params(filters)}`);
  }
  async function loadThread(id) {
    const rows = await request(`threads?${params({ select: 'id,thread_type,title,context,topic,anime_slug,poll_mode,ranking_mode,closes_at,created_at,author:profiles!threads_author_id_fkey(username),items:thread_items(id,label,image_url,position)', id: `eq.${id}`, limit: '1' })}`);
    return rows[0] || null;
  }
  async function loadMyResponse(id) {
    const active = await getSession();
    if (!active) return [];
    return request(`thread_responses?${params({ select: 'item_id,position', thread_id: `eq.${id}`, user_id: `eq.${active.user.id}`, order: 'position.asc.nullslast' })}`, {}, true);
  }
  async function pollResults(id) { return request('rpc/get_fandomroom_poll_results', { method: 'POST', body: JSON.stringify({ p_thread_id: id }) }, true); }
  async function rankingResults(id) { return request('rpc/get_fandomroom_ranking_results', { method: 'POST', body: JSON.stringify({ p_thread_id: id }) }); }
  async function rankingFeedback(id) { return request('rpc/get_fandomroom_ranking_feedback', { method: 'POST', body: JSON.stringify({ p_thread_id: id }) }); }
  async function voteRankingFeedback(id, opinion) { return request('rpc/submit_fandomroom_ranking_feedback', { method: 'POST', body: JSON.stringify({ p_thread_id: id, p_opinion: opinion }) }, true); }
  async function vote(id, itemIds) { return request('rpc/submit_fandomroom_poll_vote', { method: 'POST', body: JSON.stringify({ p_thread_id: id, p_item_ids: itemIds }) }, true); }
  async function rank(id, itemIds) { return request('rpc/submit_fandomroom_ranking', { method: 'POST', body: JSON.stringify({ p_thread_id: id, p_item_ids: itemIds }) }, true); }
  async function loadComments(id) {
    return request(`thread_comments?${params({ select: 'id,thread_id,parent_id,author_id,body,created_at,author:profiles!thread_comments_author_id_fkey(username)', thread_id: `eq.${id}`, order: 'created_at.asc' })}`);
  }
  async function addComment(id, body, parentId = null) {
    const active = await getSession();
    if (!active) throw new Error('Sign in to join the discussion.');
    return request('thread_comments?select=id,thread_id,parent_id,body,created_at,author:profiles!thread_comments_author_id_fkey(username)', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ thread_id: id, parent_id: parentId, author_id: active.user.id, body })
    }, true);
  }
  async function listArticles() { return request(`blog_posts?${params({ select: 'id,slug,title,excerpt,cover_image,topic,published_at,author:profiles!blog_posts_author_id_fkey(username)', published: 'eq.true', order: 'published_at.desc', limit: '50' })}`); }
  async function loadArticle(slug) { const rows = await request(`blog_posts?${params({ select: 'id,slug,title,excerpt,content,cover_image,topic,published_at,author_id,author:profiles!blog_posts_author_id_fkey(username)', slug: `eq.${slug}`, limit: '1' })}`); return rows[0] || null; }
  async function isBlogEditor() { const active = await getSession(); if (!active) return false; const rows = await request(`blog_editors?${params({ select: 'user_id', user_id: `eq.${active.user.id}`, limit: '1' })}`, {}, true); return rows.length > 0; }
  async function saveArticle(article, publish = false) {
    const active = await getSession(); if (!active) throw new Error('Sign in to save an article.');
    const payload = { slug: article.slug, title: article.title, excerpt: article.excerpt, content: article.content, topic: article.topic || 'Anime', cover_image: article.cover_image || null, published: publish, published_at: publish ? (article.published_at || new Date().toISOString()) : null, updated_at: new Date().toISOString() };
    const path = article.id ? `blog_posts?id=eq.${encodeURIComponent(article.id)}` : 'blog_posts';
    const response = await request(path, { method: article.id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(article.id ? payload : { ...payload, author_id: active.user.id }) }, true);
    return Array.isArray(response) ? response[0] : response;
  }
  async function uploadBlogCover(file, ownerId) { if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Use a JPG, PNG or WebP cover image up to 5 MB.'); const ext = file.type.split('/')[1].replace('jpeg','jpg'); const path = `${ownerId}/${crypto.randomUUID()}.${ext}`; const active = await getSession(); const response = await fetch(`${baseUrl}/storage/v1/object/blog-images/${path}`, { method:'POST', headers:{ apikey:apiKey, Authorization:`Bearer ${active.access_token}`, 'Content-Type':file.type }, body:file }); if (!response.ok) { const err=await response.json().catch(()=>({})); throw new Error(err.message || 'Could not upload the cover image.'); } return `${baseUrl}/storage/v1/object/public/blog-images/${path}`; }
  async function listBlogComments(postId) { return request(`blog_comments?${params({ select: 'id,body,created_at,author:profiles!blog_comments_author_id_fkey(username)', post_id: `eq.${postId}`, order: 'created_at.asc' })}`); }
  async function addBlogComment(postId, body) { const active = await getSession(); if (!active) throw new Error('Sign in to comment.'); return request('blog_comments', { method:'POST', headers:{ Prefer:'return=minimal' }, body:JSON.stringify({ post_id:postId, author_id:active.user.id, body }) }, true); }
  globalThis.FandomRoomWeb = { configured: Boolean(baseUrl && apiKey), getSession, resumeLinkSession, signUp, signIn, requestPasswordReset, updatePassword, signInWithGoogle, isUsernameAvailable, signOut, createThread, listThreads, loadThread, loadMyResponse, pollResults, rankingResults, rankingFeedback, voteRankingFeedback, vote, rank, loadComments, addComment, listArticles, loadArticle, isBlogEditor, saveArticle, uploadBlogCover, listBlogComments, addBlogComment };
})();
