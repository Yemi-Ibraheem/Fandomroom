(() => {
  const $ = (q, r = document) => r.querySelector(q);
  const api = globalThis.FandomRoomWeb;
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = s => s ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric'}).format(new Date(s)) : '';
  const toast = message => { const el=$('#tToast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600); };
  let activePost = null;
  async function updateAccess() {
    const session = await api?.getSession(); if (!session) return false;
    const premium = session.user?.app_metadata?.plan === 'premium';
    let editor = premium;
    try { if (!editor) editor = await api.isBlogEditor(); } catch {}
    $('#writeToggle').hidden = !editor;
    $('.t-login').textContent = session.user?.user_metadata?.username || 'Account';
    $('#tCommentNote')?.replaceWith(Object.assign(document.createElement('p'),{id:'tCommentNote',className:'t-comment-note',textContent:'You’re signed in. Add your take below.'}));
    return editor;
  }
  async function loadListing() {
    const target=$('#articleList'); if(!target) return;
    try {
      const rows=await api.listArticles(); $('#storyCount').textContent=`${rows.length} ${rows.length===1?'story':'stories'}`;
      if(!rows.length){target.innerHTML='<p class="t-status">The first story is on its way. Check back soon.</p>';return;}
      target.innerHTML=rows.map(post=>`<a class="t-story" href="/blog/${encodeURIComponent(post.slug)}"><div><span class="t-kicker">${escapeHtml(post.topic||'Anime')}</span><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt)}</p><div class="t-meta">${escapeHtml(post.author?.username||'Fandom Room')} · ${date(post.published_at)}</div></div>${post.cover_image?`<img src="${escapeHtml(post.cover_image)}" alt="" loading="lazy">`:'<span class="t-story-placeholder" aria-hidden="true">FR</span>'}</a>`).join('');
    } catch { target.innerHTML='<p class="t-status">Stories could not be loaded right now. Please refresh the page.</p>'; }
  }
  function renderComments(rows) { const box=$('#tComments'); if(!box)return; box.innerHTML=rows.length?rows.map(c=>`<article class="t-comment"><b>${escapeHtml(c.author?.username||'anime_fan')}</b><small>${date(c.created_at)}</small><p>${escapeHtml(c.body)}</p></article>`).join(''):'<p class="t-comment-note">Be the first to add a comment.</p>'; }
  async function setupArticle() {
    const shell=$('#articleBody'); if(!shell)return;
    const slug=shell.dataset.slug;
    try { activePost=await api.loadArticle(slug); if(!activePost){shell.innerHTML='<p>This article could not be found.</p>';return;}
      $('#tCommentForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('textarea',e.currentTarget);const body=input.value.trim();if(!body)return;try{await api.addBlogComment(activePost.id,body);input.value='';renderComments(await api.listBlogComments(activePost.id));toast('Your comment is posted.');}catch(err){if(/sign in/i.test(err.message)){openLogin();return;}toast(err.message||'Could not post the comment.');}});
      renderComments(await api.listBlogComments(activePost.id));
    }catch{ $('#tComments').innerHTML='<p class="t-comment-note">Comments could not be loaded.</p>'; }
  }
  function openLogin(){ $('#loginDialog').showModal(); }
  const slugify=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100).replace(/-+$/,'');
  function openEditor(){ $('#editor').hidden=false;$('#editor').scrollIntoView({behavior:'smooth',block:'start'}); }
  function draft(){return {id:$('#postId').value||null,slug:$('#postSlug').value.trim(),title:$('#postTitle').value.trim(),excerpt:$('#postExcerpt').value.trim(),topic:$('#postTopic').value.trim()||'Anime',content:$('#postContent').value.trim(),cover_image:$('#postCover').dataset.url||null};}
  async function save(publish){const error=$('#editorError');error.textContent='';const button=publish?$('#publishPost'):$('#saveDraft');button.disabled=true;button.textContent=publish?'Publishing…':'Saving…';try{const data=draft();if($('#postCover').files[0])data.cover_image=await api.uploadBlogCover($('#postCover').files[0],(await api.getSession()).user.id);const saved=await api.saveArticle(data,publish);$('#postId').value=saved.id;$('#postCover').dataset.url=saved.cover_image||'';$('#postCover').value='';toast(publish?'Article published.':'Draft saved.');if(publish){location.assign(`/blog/${encodeURIComponent(saved.slug)}`);}else $('#editorHeading').textContent='Draft saved · continue writing';}catch(err){error.textContent=err.message||'Could not save the article.';}finally{button.disabled=false;button.textContent=publish?'Publish article':'Save draft';}}
  async function init(){if(!api)return;try{await api.resumeLinkSession();}catch{}await updateAccess();$('.t-login')?.addEventListener('click',e=>{if(e.currentTarget.textContent.trim()!=='Sign in')return;e.preventDefault();openLogin();});$('#writeToggle')?.addEventListener('click',openEditor);$('#closeEditor')?.addEventListener('click',()=>$('#editor').hidden=true);$('#postTitle')?.addEventListener('input',()=>{if(!$('#postId').value)$('#postSlug').value=slugify($('#postTitle').value);});$('#saveDraft')?.addEventListener('click',()=>save(false));$('#articleForm')?.addEventListener('submit',e=>{e.preventDefault();save(true);});$('#loginSubmit')?.addEventListener('click',async()=>{const b=$('#loginSubmit');b.disabled=true;$('#loginError').textContent='';try{await api.signIn($('#loginEmail').value,$('#loginPassword').value);$('#loginDialog').close();await updateAccess();toast('You’re signed in.');}catch(err){$('#loginError').textContent=err.message||'Could not sign in.';}finally{b.disabled=false;}});$('#loginDialog')?.addEventListener('click',e=>{if(e.target===$('#loginDialog'))$('#loginDialog').close();});await loadListing();await setupArticle();}
  document.addEventListener('DOMContentLoaded',init);
})();
