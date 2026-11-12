(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = globalThis.FandomRoomWeb;
  let filter = 'all';
  let searchText = '';
  let currentThread = null;
  let currentUser = null;
  let pendingAction = null;
  let authMode = 'signup';
  let selectedPollItems = [];
  let rankedItems = [];
  let myResponse = [];
  let pollResults = [];
  let ownThreads = false;
  let toastTimer;
  const translationLanguages = {
    fr: { flag: '🇫🇷', name: 'French' },
    es: { flag: '🇪🇸', name: 'Spanish' },
    pt: { flag: '🇧🇷', name: 'Portuguese' },
    ja: { flag: '🇯🇵', name: 'Japanese' }
  };
  let translationLanguage = localStorage.getItem('fandomroom-translation-language') || 'fr';

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function toast(message) {
    const element = $('#toast'); element.textContent = message; element.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
  }
  function niceError(error) {
    const text = error?.message || 'Something went wrong. Please try again.';
    if (/relation .* does not exist|function .* does not exist|schema cache/i.test(text)) return 'Fandom Room’s thread database is not ready yet. Please try again shortly.';
    if (/Failed to fetch|NetworkError/i.test(text)) return 'Could not reach Fandom Room. Check your connection and try again.';
    return text;
  }
  function timeAgo(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
  function authorName(row) { return row?.author?.username || 'anime_fan'; }
  function initials(name) { return (name || 'F').slice(0, 1).toUpperCase(); }
  function setTranslationLanguage(language) {
    translationLanguage = translationLanguages[language] ? language : 'fr';
    $('#translationLanguage').value = translationLanguage;
    $('#languageFlag').textContent = translationLanguages[translationLanguage].flag;
    localStorage.setItem('fandomroom-translation-language', translationLanguage);
  }
  async function translateComment(button) {
    const comment = button.closest('[data-comment-body]');
    const original = comment?.dataset.commentBody;
    if (!original) return;
    const translation = $('.comment-translation', comment);
    if (translation && !translation.hidden && translation.dataset.language === translationLanguage) {
      translation.hidden = true;
      $('.comment-original', comment).hidden = false;
      button.textContent = `Show translation · ${translationLanguages[translationLanguage].name}`;
      return;
    }
    const language = translationLanguage;
    const { name } = translationLanguages[language];
    button.disabled = true;
    button.textContent = 'Translating…';
    try {
      const query = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: language, dt: 't', q: original });
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`);
      if (!response.ok) throw new Error('Translation unavailable');
      const result = await response.json();
      const translated = (result[0] || []).map(part => part[0] || '').join('');
      if (!translated) throw new Error('No translation returned');
      let output = $('.comment-translation', comment);
      if (!output) {
        output = document.createElement('span');
        output.className = 'comment-translation';
        button.before(output);
      }
      output.dataset.language = language;
      output.dataset.languageName = name;
      output.textContent = translated;
      output.hidden = false;
      $('.comment-original', comment).hidden = true;
      button.textContent = 'Show original';
    } catch {
      button.textContent = 'Translation unavailable · try again';
    } finally {
      button.disabled = false;
    }
  }
  function openBackdrop(id) { $(`#${id}`).classList.add('open'); }
  function closeBackdrop(id) { $(`#${id}`).classList.remove('open'); }
  function requireAuth(action) {
    if (currentUser) return action();
    pendingAction = action;
    openAuth();
  }
  function requirePremium(action) {
    if (currentUser?.app_metadata?.plan === 'premium') return action();
    if (!currentUser) { pendingAction = () => requirePremium(action); openAuth(); return; }
    openBackdrop('premiumBackdrop');
  }
  function openAuth(mode = 'signup') {
    authMode = mode; updateAuthMode(); openBackdrop('authBackdrop');
    (authMode === 'signup' ? $('#authUsername') : $('#authEmail')).focus();
  }
  function updateAuthMode() {
    const signup = authMode === 'signup';
    $('#authTitle').textContent = signup ? 'Join Fandom Room' : 'Welcome back';
    $('#authIntro').textContent = signup ? 'Create a room for the fandoms you love.' : 'Sign in to vote, rank, create threads, and reply.';
    $('#authSubmit').textContent = signup ? 'Create account' : 'Sign in';
    $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('#signupFields').hidden = !signup;
    $('#authUsername').required = signup;
    $('#authCountry').required = signup;
    $('#authTabSignup').classList.toggle('active', signup);
    $('#authTabSignup').setAttribute('aria-selected', String(signup));
    $('#authTabSignin').classList.toggle('active', !signup);
    $('#authTabSignin').setAttribute('aria-selected', String(!signup));
    $('#authForm').setAttribute('aria-labelledby', signup ? 'authTabSignup' : 'authTabSignin');
    $('#authError').textContent = '';
  }
  async function syncHeader() {
    const session = await api.getSession(); currentUser = session?.user || null;
    const button = $('#authButton');
    button.textContent = currentUser ? 'Sign out' : 'Sign up';
    button.setAttribute('aria-label', currentUser ? 'Sign out of Fandom Room' : 'Sign up for Fandom Room');
  }
  function routeToThread(id) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('thread', id); else url.searchParams.delete('thread');
    history.pushState(null, '', url.pathname + url.search);
    renderRoute();
  }
  function shareUrl(id) { return `${location.origin}/api/share?thread=${encodeURIComponent(id)}`; }
  async function shareThread(thread) {
    const url = shareUrl(thread.id);
    const title = thread.title;
    const text = `Join the ${thread.thread_type} and discussion on Fandom Room.`;
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else { await navigator.clipboard.writeText(url); toast('Thread link copied.'); }
    } catch (error) {
      if (error.name !== 'AbortError') {
        try { await navigator.clipboard.writeText(url); toast('Thread link copied.'); }
        catch { toast('Use your browser’s share menu to share this thread.'); }
      }
    }
  }
  function goHome() {
    currentThread = null;
    $('#threadDetail').hidden = true; $('#threadFeed').hidden = false; $('#typeSwitch').hidden = false;
    $('#pageTitle').textContent = 'Fan questions, open floor.'; $('#breadcrumb').innerHTML = 'Discover <b>/</b> Community';
    renderFeed();
  }
  async function renderRoute() {
    const id = new URLSearchParams(location.search).get('thread');
    if (!id) { goHome(); return; }
    $('#threadFeed').hidden = true; $('#typeSwitch').hidden = true; $('#threadDetail').hidden = false;
    $('#feedState').hidden = true; $('#pageTitle').textContent = 'Fandom Room thread';
    $('#breadcrumb').innerHTML = 'Discover <b>/</b> <span>Thread</span>';
    $('#threadDetail').innerHTML = '<div class="state-message">Loading this thread…</div>';
    try {
      const thread = await api.loadThread(id);
      if (!thread) { $('#threadDetail').innerHTML = '<div class="empty"><strong>Thread not found</strong>This link may be out of date.</div>'; return; }
      currentThread = thread; await renderThread(thread);
    } catch (error) {
      $('#threadDetail').innerHTML = `<div class="empty"><strong>Could not load this thread</strong>${escapeHtml(niceError(error))}</div>`;
    }
  }
  async function renderFeed() {
    const state = $('#feedState'); const root = $('#threadFeed');
    if ($('#threadDetail').hidden === false) return;
    state.hidden = false; state.textContent = 'Finding the latest threads…'; root.innerHTML = '';
    try {
      const rows = await api.listThreads(filter, searchText, ownThreads ? currentUser?.id : '');
      if (!rows.length) {
        state.innerHTML = `<div class="empty"><strong>${searchText ? 'No matching threads' : 'Start the conversation'}</strong>${searchText ? 'Try another search.' : 'Create the first poll or ranking for your fandom.'}</div>`;
        return;
      }
      state.hidden = true;
      for (const row of rows) root.append(makeThreadCard(row));
    } catch (error) {
      state.innerHTML = `<div class="empty"><strong>Threads could not load</strong>${escapeHtml(niceError(error))}</div>`;
    }
  }
  function makeThreadCard(thread) {
    const card = document.createElement('article'); card.className = 'thread-card'; card.tabIndex = 0;
    card.setAttribute('role', 'link'); card.setAttribute('aria-label', `Open ${thread.thread_type}: ${thread.title}`);
    const name = authorName(thread); const items = [...(thread.items || [])].sort((a, b) => a.position - b.position);
    const strip = items.slice(0, 4).map(item => `<div class="thumb"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.label)}" loading="lazy"></div>`).join('');
    card.innerHTML = `<div class="thread-top"><div class="avatar">${escapeHtml(initials(name))}</div><div><div class="author">${escapeHtml(name)}</div><div class="meta">${escapeHtml(timeAgo(thread.created_at))} · ${escapeHtml(thread.topic)}</div></div><span class="type-tag">${thread.thread_type === 'poll' ? 'Image poll' : 'Ranking'}</span></div><h2 class="thread-card-title">${escapeHtml(thread.title)}</h2>${thread.context ? `<p class="thread-desc">${escapeHtml(thread.context)}</p>` : ''}<div class="thumb-strip">${strip}</div><div class="thread-card-foot"><span>${items.length} choices</span><span>${thread.thread_type === 'poll' ? (thread.poll_mode === 'single' ? 'Choose one' : 'Choose multiple') : (thread.ranking_mode === 'full' ? 'Order every item' : 'Top three')}</span><span class="open-label">Open discussion&nbsp; ↗</span></div>`;
    card.addEventListener('click', () => routeToThread(thread.id));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); routeToThread(thread.id); } });
    return card;
  }
  function renderItems(thread, mode, results = [], selected = []) {
    const resultsById = new Map(results.map(row => [row.item_id, row]));
    return [...(thread.items || [])].sort((a, b) => a.position - b.position).map(item => {
      const result = resultsById.get(item.id); const isSelected = selected.includes(item.id);
      let stats = '';
      if (mode === 'poll' && result) {
        const total = results.reduce((sum, value) => sum + Number(value.response_count || 0), 0);
        const pct = total ? Math.round((Number(result.response_count || 0) / total) * 100) : 0;
        stats = `<div class="choice-stats"><span>${Number(result.response_count || 0)} votes</span><span>${pct}%</span></div><div class="result-bar"><i style="width:${pct}%"></i></div>`;
      } else if (mode === 'ranking' && result && Number(result.ranking_count)) {
        stats = `<div class="choice-stats"><span>Community average</span><span>#${result.average_position}</span></div>`;
      }
      const input = mode === 'ranking' && thread.ranking_mode === 'top_three'
        ? `<input class="rank-select" type="checkbox" data-rank-select="${escapeHtml(item.id)}" aria-label="Include ${escapeHtml(item.label)} in your top three" ${isSelected ? 'checked' : ''}>`
        : '';
      return `<div class="detail-choice ${isSelected ? 'selected' : ''}" data-item-id="${escapeHtml(item.id)}" ${mode === 'poll' ? `role="button" tabindex="0" aria-pressed="${isSelected}"` : ''}><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.label)}"><div class="choice-info"><strong>${escapeHtml(item.label)}</strong>${stats}</div>${input}</div>`;
    }).join('');
  }
  async function renderThread(thread) {
    myResponse = []; pollResults = [];
    try { myResponse = await api.loadMyResponse(thread.id); } catch {}
    const hasVoted = thread.thread_type === 'poll' && myResponse.length > 0;
    const existingRank = thread.thread_type === 'ranking' ? myResponse : [];
    rankedItems = existingRank.length ? existingRank.map(row => row.item_id) : thread.ranking_mode === 'top_three' ? [] : [...(thread.items || [])].sort((a, b) => a.position - b.position).map(item => item.id);
    selectedPollItems = hasVoted ? myResponse.map(row => row.item_id) : [];
    if (hasVoted) { try { pollResults = await api.pollResults(thread.id); } catch {} }
    let communityRankings = [];
    if (thread.thread_type === 'ranking') { try { communityRankings = await api.rankingResults(thread.id); } catch {} }
    let comments = [];
    try { comments = await api.loadComments(thread.id); } catch {}
    const name = authorName(thread); const items = [...(thread.items || [])].sort((a, b) => a.position - b.position);
    const closed = thread.closes_at && new Date(thread.closes_at) <= new Date();
    const mode = thread.thread_type;
    const hasResponse = mode === 'poll' ? hasVoted : existingRank.length > 0;
    const responseAction = mode === 'poll' ? (closed ? 'Poll closed' : hasVoted ? 'Change my vote' : 'Cast your vote') : (hasResponse ? 'Update my ranking' : 'Submit my ranking');
    let rankingRows = '';
    if (mode === 'ranking') {
      const communityOrder = new Map(communityRankings.map((row, index) => [row.item_id, { ...row, place: index + 1 }]));
      const orderToRender = thread.ranking_mode === 'top_three'
        ? [...rankedItems.filter(id => myResponse.some(r => r.item_id === id)), ...items.map(i => i.id).filter(id => !rankedItems.includes(id))]
        : rankedItems;
      rankingRows = orderToRender.map((id, index) => {
        const item = items.find(row => row.id === id); if (!item) return '';
        const result = communityOrder.get(id);
        const rankingStat = result ? `Community #${result.place} · avg ${result.average_position}` : 'No community rankings yet';
        const control = thread.ranking_mode === 'top_three' ? '' : `<div class="rank-move"><button type="button" data-move="up" data-item="${id}" aria-label="Move ${escapeHtml(item.label)} up">↑</button><button type="button" data-move="down" data-item="${id}" aria-label="Move ${escapeHtml(item.label)} down">↓</button></div>`;
        const selectedRank = rankedItems.indexOf(id);
        const position = thread.ranking_mode === 'full' ? index + 1 : selectedRank < 0 ? '' : selectedRank + 1;
        const selectControl = `<input class="rank-select" type="checkbox" data-rank-select="${id}" aria-label="Include ${escapeHtml(item.label)} in your top three" ${rankedItems.includes(id) ? 'checked' : ''}>`;
        const topThreeControls = rankedItems.includes(id) ? `<div class="rank-controls"><input class="rank-select" type="checkbox" data-rank-select="${id}" aria-label="Include ${escapeHtml(item.label)} in your top three" checked><div class="rank-move"><button type="button" data-move="up" data-item="${id}" aria-label="Move ${escapeHtml(item.label)} up">↑</button><button type="button" data-move="down" data-item="${id}" aria-label="Move ${escapeHtml(item.label)} down">↓</button></div></div>` : selectControl;
        return `<div class="rank-row ${selectedRank >= 0 ? 'selected' : ''}" data-rank-row="${id}"><div class="rank-position">${position}</div><img src="${escapeHtml(item.image_url)}" alt=""><div><div class="rank-name">${escapeHtml(item.label)}</div><div class="rank-stat">${escapeHtml(rankingStat)}</div></div>${thread.ranking_mode === 'top_three' ? topThreeControls : control}</div>`;
      }).join('');
    }
    $('#pageTitle').textContent = 'Fandom Room thread';
    $('#breadcrumb').innerHTML = `Discover <b>/</b> ${escapeHtml(thread.topic)}`;
    const pollResponseCount = pollResults.reduce((sum, row) => sum + Number(row.response_count || 0), 0);
    const pollResultLabel = thread.poll_mode === 'multiple' ? 'selections' : 'votes';
    $('#threadDetail').innerHTML = `<article class="thread-detail" data-thread-id="${thread.id}"><button class="back-link" id="backHome">← Back to discover</button><div class="thread-top"><div class="avatar">${escapeHtml(initials(name))}</div><div><div class="author">${escapeHtml(name)}</div><div class="meta">${escapeHtml(timeAgo(thread.created_at))} · ${escapeHtml(thread.topic)}</div></div><span class="type-tag">${mode === 'poll' ? 'Image poll' : 'Ranking'}</span></div><span class="detail-topic">${escapeHtml(thread.topic)}</span><h2 class="thread-title">${escapeHtml(thread.title)}</h2>${thread.context ? `<p class="detail-context">${escapeHtml(thread.context)}</p>` : ''}${mode === 'poll' ? `<div class="detail-items" id="pollChoices">${renderItems(thread, 'poll', hasVoted ? pollResults : [], selectedPollItems)}</div>` : `<div class="rank-list" id="rankingChoices">${rankingRows}</div><p class="rank-stat">${thread.ranking_mode === 'full' ? 'Reorder every item to submit your list.' : `Choose ${Math.min(3, items.length)} items in your preferred order. Use arrows to adjust.`}</p>`}<div class="detail-actions"><span>${mode === 'poll' ? (hasVoted ? `${pollResponseCount} ${pollResultLabel} · results revealed` : 'Results are visible after your vote') : (hasResponse ? 'Your ranking is saved. You can update it.' : 'Rankings show each item’s community average.')}</span><button class="share-thread" id="shareThread">↗ Share thread</button></div><button class="response-button" id="responseButton" ${closed ? 'disabled' : ''}>${responseAction}</button><section class="discussion"><div class="discussion-head"><h3>Discussion</h3><span>${comments.length} ${comments.length === 1 ? 'reply' : 'replies'}</span></div><div id="commentList">${renderComments(comments)}</div><form class="comment-form" id="commentForm"><input maxlength="2000" placeholder="Add to the discussion…" aria-label="Add to the discussion"><button>Reply</button></form></section></article>`;
    $('#backHome').addEventListener('click', () => { history.pushState(null, '', location.pathname); goHome(); });
    $('#shareThread').addEventListener('click', () => shareThread(thread));
    $('#responseButton').addEventListener('click', () => requireAuth(() => submitResponse(thread)));
    if (mode === 'poll') $$('#pollChoices .detail-choice').forEach(choice => {
      choice.addEventListener('click', event => { if (event.target.matches('input')) return; selectPollChoice(choice.dataset.itemId, thread); });
      choice.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPollChoice(choice.dataset.itemId, thread); } });
    });
    if (mode === 'ranking') {
      $$('[data-move]', $('#rankingChoices')).forEach(button => button.addEventListener('click', () => moveRankItem(button.dataset.item, button.dataset.move, thread)));
      $$('[data-rank-select]', $('#rankingChoices')).forEach(input => input.addEventListener('change', () => toggleTopThree(input.dataset.rankSelect, input.checked, thread)));
    }
    $('#commentForm').addEventListener('submit', event => { event.preventDefault(); const input = $('input', event.currentTarget); const body = input.value.trim(); if (!body) return; requireAuth(async () => { try { await api.addComment(thread.id, body); await renderThread(thread); toast('Your reply is posted.'); } catch (error) { toast(niceError(error)); } }); });
    $('#commentList').addEventListener('click', event => {
      const button = event.target.closest('[data-translate]');
      if (button) translateComment(button);
    });
    $$('[data-reply]', $('#commentList')).forEach(button => button.addEventListener('click', () => showReplyForm(button.dataset.reply, button.closest('.comment'))));
  }
  function renderComments(rows) {
    if (!rows.length) return '<div class="empty">No replies yet. Start the conversation.</div>';
    const byParent = new Map();
    for (const row of rows) { const key = row.parent_id || 'root'; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(row); }
    const renderComment = (row, isReply = false) => {
      const name = authorName(row);
      return `<div class="comment ${isReply ? 'comment-reply' : ''}"><div class="avatar">${escapeHtml(initials(name))}</div><div class="comment-body" data-comment-body="${escapeHtml(row.body)}"><strong>${escapeHtml(name)}</strong><time>${escapeHtml(timeAgo(row.created_at))}</time><br><span class="comment-original">${escapeHtml(row.body)}</span><span class="comment-translation" hidden></span><button type="button" class="reply-button translate-button" data-translate>Show translation · ${translationLanguages[translationLanguage].name}</button>${isReply ? '' : `<button type="button" class="reply-button" data-reply="${escapeHtml(row.id)}">Reply</button>`}${(byParent.get(row.id) || []).map(reply => renderComment(reply, true)).join('')}</div></div>`;
    };
    return (byParent.get('root') || []).map(row => renderComment(row)).join('');
  }
  function showReplyForm(parentId, container) {
    if ($('.reply-box', container)) return;
    const form = document.createElement('form'); form.className = 'reply-box';
    form.innerHTML = '<input maxlength="2000" placeholder="Write a reply…" aria-label="Write a reply"><button>Reply</button>';
    form.addEventListener('submit', event => { event.preventDefault(); const input = $('input', form); const body = input.value.trim(); if (!body) return; requireAuth(async () => { try { await api.addComment(currentThread.id, body, parentId); await renderThread(currentThread); toast('Your reply is posted.'); } catch (error) { toast(niceError(error)); } }); });
    container.append(form); $('input', form).focus();
  }
  function selectPollChoice(itemId, thread) {
    if (thread.poll_mode === 'single') selectedPollItems = [itemId];
    else selectedPollItems = selectedPollItems.includes(itemId) ? selectedPollItems.filter(id => id !== itemId) : [...selectedPollItems, itemId];
    $$('#pollChoices .detail-choice').forEach(choice => { const selected = selectedPollItems.includes(choice.dataset.itemId); choice.classList.toggle('selected', selected); });
  }
  function moveRankItem(id, direction, thread) {
    const index = rankedItems.indexOf(id); const next = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || next < 0 || next >= rankedItems.length) return;
    [rankedItems[index], rankedItems[next]] = [rankedItems[next], rankedItems[index]];
    const row = $(`[data-rank-row="${CSS.escape(id)}"]`, $('#rankingChoices'));
    const neighbor = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (direction === 'up') row.parentNode.insertBefore(row, neighbor); else row.parentNode.insertBefore(neighbor, row);
    $$('.rank-row', $('#rankingChoices')).forEach((rankRow, i) => { const selectedIndex = rankedItems.indexOf(rankRow.dataset.rankRow); $('.rank-position', rankRow).textContent = thread.ranking_mode === 'full' ? i + 1 : selectedIndex < 0 ? '' : selectedIndex + 1; });
  }
  function toggleTopThree(id, checked, thread) {
    if (checked) {
      if (rankedItems.length >= Math.min(3, thread.items.length)) { const input = $(`[data-rank-select="${CSS.escape(id)}"]`); input.checked = false; toast(`Choose up to ${Math.min(3, thread.items.length)} items.`); return; }
      rankedItems.push(id);
    } else rankedItems = rankedItems.filter(item => item !== id);
    const root = $('#rankingChoices');
    const order = [...rankedItems, ...thread.items.map(item => item.id).filter(itemId => !rankedItems.includes(itemId))];
    for (const itemId of order) { const row = $(`[data-rank-row="${CSS.escape(itemId)}"]`, root); if (row) root.append(row); }
    $$('.rank-row', root).forEach(row => {
      const selectedIndex = rankedItems.indexOf(row.dataset.rankRow);
      $('.rank-position', row).textContent = selectedIndex < 0 ? '' : selectedIndex + 1;
      row.classList.toggle('selected', selectedIndex >= 0);
      const name = escapeHtml($('.rank-name', row).textContent);
      if (selectedIndex < 0) row.lastElementChild.outerHTML = `<input class="rank-select" type="checkbox" data-rank-select="${row.dataset.rankRow}" aria-label="Include ${name} in your top three">`;
      else row.lastElementChild.outerHTML = `<div class="rank-controls"><input class="rank-select" type="checkbox" data-rank-select="${row.dataset.rankRow}" aria-label="Include ${name} in your top three" checked><div class="rank-move"><button type="button" data-move="up" data-item="${row.dataset.rankRow}" aria-label="Move ${name} up">↑</button><button type="button" data-move="down" data-item="${row.dataset.rankRow}" aria-label="Move ${name} down">↓</button></div></div>`;
    });
    $$('[data-move]', root).forEach(button => button.addEventListener('click', () => moveRankItem(button.dataset.item, button.dataset.move, thread)));
    $$('[data-rank-select]', root).forEach(input => input.addEventListener('change', () => toggleTopThree(input.dataset.rankSelect, input.checked, thread)));
  }
  async function submitResponse(thread) {
    try {
      if (thread.thread_type === 'poll') {
        if (!selectedPollItems.length) { toast('Choose an option first.'); return; }
        await api.vote(thread.id, selectedPollItems);
      } else {
        const ids = thread.ranking_mode === 'full' ? rankedItems : rankedItems.filter(id => $(`[data-rank-select="${CSS.escape(id)}"]`, $('#rankingChoices'))?.checked);
        if (thread.ranking_mode === 'top_three' && ids.length !== Math.min(3, thread.items.length)) { toast(`Choose ${Math.min(3, thread.items.length)} items and set your order.`); return; }
        await api.rank(thread.id, ids);
      }
      await syncHeader(); await renderThread(thread); toast(thread.thread_type === 'poll' ? 'Vote saved. Poll results are now visible.' : 'Your ranking is saved.');
    } catch (error) { toast(niceError(error)); }
  }
  function setFilter(next, keepOwnThreads = false) {
    if (!keepOwnThreads) ownThreads = false;
    filter = next; $('#threadDetail').hidden = true; $('#threadFeed').hidden = false; $('#typeSwitch').hidden = false;
    $$('#typeSwitch button').forEach(button => button.classList.toggle('active', button.dataset.mode === filter));
    $$('.side-link[data-filter-link]').forEach(link => link.classList.toggle('active', link.dataset.filterLink === filter));
    $('#pageTitle').textContent = ownThreads ? 'Your threads' : filter === 'poll' ? 'Image polls' : filter === 'ranking' ? 'Community rankings' : 'Fan questions, open floor.';
    renderFeed();
  }
  function addChoiceRow(label = '', file = null) {
    const root = $('#choiceFields'); if (root.children.length >= 12) { toast('A thread can have up to 12 choices.'); return; }
    const row = document.createElement('div'); row.className = 'choice-row';
    row.innerHTML = `<span class="choice-index" aria-hidden="true">${String(root.children.length + 1).padStart(2, '0')}</span><input class="choice-label" maxlength="100" placeholder="${root.children.length < 2 ? 'Choice name' : 'Another choice'}" value="${escapeHtml(label)}" aria-label="Edit choice name" required><input class="choice-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Image for choice ${root.children.length + 1}" required><img class="choice-image-preview" alt="" hidden><div class="choice-order-controls"><button type="button" data-choice-move="up" aria-label="Move choice up">↑</button><button type="button" data-choice-move="down" aria-label="Move choice down">↓</button></div><button class="remove-choice" type="button" aria-label="Remove choice">×</button>`;
    $('.choice-file', row).addEventListener('change', event => { const image = $('.choice-image-preview', row); const selected = event.target.files[0]; if (selected) { image.src = URL.createObjectURL(selected); image.hidden = false; } });
    $('.remove-choice', row).addEventListener('click', () => { if ($('#createType').value === 'poll' && root.children.length <= 2) { toast('Keep at least two choices.'); return; } row.remove(); refreshChoiceRows(); });
    $$('[data-choice-move]', row).forEach(button => button.addEventListener('click', () => {
      const sibling = button.dataset.choiceMove === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return;
      root.insertBefore(button.dataset.choiceMove === 'up' ? row : sibling, button.dataset.choiceMove === 'up' ? sibling : row);
      refreshChoiceRows();
    }));
    root.append(row);
    if (file) { const transfer = new DataTransfer(); transfer.items.add(file); $('.choice-file', row).files = transfer.files; $('.choice-image-preview', row).src = URL.createObjectURL(file); $('.choice-image-preview', row).hidden = false; }
    refreshChoiceRows();
  }
  function refreshChoiceRows() {
    const rows = $$('#choiceFields .choice-row');
    rows.forEach((row, index) => {
      $('.choice-index', row).textContent = String(index + 1).padStart(2, '0');
      const up = $('[data-choice-move="up"]', row), down = $('[data-choice-move="down"]', row);
      up.disabled = index === 0; down.disabled = index === rows.length - 1;
      $('.choice-file', row).setAttribute('aria-label', `Image for choice ${index + 1}`);
    });
    const ranking = $('#createType').value === 'ranking';
    $('#choiceField').classList.toggle('ranking-editor', ranking);
    $('#addChoice').textContent = ranking ? (rows.length ? '＋ Add more images' : '＋ Add images to your ranking') : '＋ Add another choice';
    $('#addChoice').classList.toggle('is-empty-ranking', ranking && rows.length === 0);
    $('#rankingEmptyHint').hidden = !ranking || rows.length > 0;
  }
  function setCreateMode(type) {
    const ranking = type === 'ranking';
    $('#createBackdrop').classList.toggle('ranking-workspace-open', ranking);
    $('#createForm').classList.toggle('ranking-workspace-form', ranking);
    $('#createHeading').textContent = ranking ? 'Build your ranking' : 'Start a thread';
    $('#pollSettings').hidden = ranking; $('#rankingSettings').hidden = !ranking;
    $('#choiceFieldLabel').firstChild.textContent = ranking ? 'Ranking chart ' : 'Choices and images ';
    refreshChoiceRows();
  }
  function openCreate() {
    $('#createError').textContent = ''; $('#createForm').reset(); $('#choiceFields').innerHTML = '';
    $('#createType').value = filter === 'ranking' ? 'ranking' : 'poll';
    if ($('#createType').value === 'poll') { addChoiceRow(); addChoiceRow(); }
    setCreateMode($('#createType').value); openBackdrop('createBackdrop'); $('#threadTitleInput').focus();
  }
  async function submitCreate(event) {
    event.preventDefault(); $('#createError').textContent = '';
    const rows = $$('.choice-row', $('#choiceFields'));
    const items = rows.map(row => ({ label: $('.choice-label', row).value, file: $('.choice-file', row).files[0] }));
    if (items.length < 2) { $('#createError').textContent = 'Add at least two images to build this thread.'; return; }
    if (items.some(item => !item.label.trim() || !item.file)) { $('#createError').textContent = 'Add a label and image for every choice.'; return; }
    const type = $('#createType').value; const closeDays = Number($('#pollClose').value);
    const draft = { type, title: $('#threadTitleInput').value.trim(), topic: $('#threadTopic').value.trim(), context: $('#threadContext').value.trim(), items,
      pollMode: $('#pollMode').value, rankingMode: $('#rankingMode').value, closesAt: type === 'poll' && closeDays ? new Date(Date.now() + closeDays * 86400000).toISOString() : null };
    $('#publishThread').disabled = true; $('#publishThread').textContent = 'Publishing…';
    try {
      const id = await api.createThread(draft); closeBackdrop('createBackdrop'); toast('Your thread is live.'); routeToThread(id); await syncHeader();
    } catch (error) { $('#createError').textContent = niceError(error); }
    finally { $('#publishThread').disabled = false; $('#publishThread').textContent = 'Publish thread'; }
  }
  async function submitAuth(event) {
    event.preventDefault(); $('#authError').textContent = '';
    const email = $('#authEmail').value.trim(); const password = $('#authPassword').value;
    $('#authSubmit').disabled = true; $('#authSubmit').textContent = authMode === 'signup' ? 'Creating…' : 'Signing in…';
    try {
      if (authMode === 'signup') {
        const username = $('#authUsername').value.trim().toLowerCase();
        const country = $('#authCountry').value.trim();
        if (country.length < 2) throw new Error('Enter your country.');
        if (!(await api.isUsernameAvailable(username))) throw new Error('That username is already taken. Choose another one.');
        const result = await api.signUp(email, password, { username, country });
        if (result.needsEmailConfirmation) { closeBackdrop('authBackdrop'); toast('Check your email to confirm your Fandom Room account.'); return; }
      } else await api.signIn(email, password);
      await syncHeader(); closeBackdrop('authBackdrop'); toast('You’re signed in.');
      const next = pendingAction; pendingAction = null; if (next) await next();
    } catch (error) { $('#authError').textContent = niceError(error); }
    finally { $('#authSubmit').disabled = false; updateAuthMode(); }
  }
  function initTheme() {
    const body = document.body;
    const savedTheme = localStorage.getItem('fandomroom-theme');
    body.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
    const button = $('#themeToggle');
    const updateButton = () => {
      const dark = body.dataset.theme === 'dark';
      button.textContent = dark ? '☀' : '☾';
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      button.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
    };
    updateButton();
    button.addEventListener('click', () => {
      body.dataset.theme = body.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('fandomroom-theme', body.dataset.theme);
      updateButton();
    });
  }
  async function init() {
    if (!api?.configured) { $('#feedState').innerHTML = '<div class="empty"><strong>Setup needed</strong>Fandom Room is missing its public Supabase configuration.</div>'; return; }
    try { await api.resumeLinkSession(); } catch (error) { toast(niceError(error)); }
    await syncHeader(); await renderRoute();
    $('#authButton').addEventListener('click', async () => {
      if (!currentUser) { openAuth(); return; }
      await api.signOut(); await syncHeader(); if (currentThread) await renderThread(currentThread); toast('You’re signed out.');
    });
    $('#authForm').addEventListener('submit', submitAuth);
    $('#googleAuth').addEventListener('click', async () => {
      $('#authError').textContent = '';
      try {
        if (authMode === 'signup') {
          for (const field of [$('#authUsername'), $('#authCountry')]) {
            if (!field.checkValidity()) { field.reportValidity(); return; }
          }
          const username = $('#authUsername').value.trim().toLowerCase();
          const country = $('#authCountry').value.trim();
          if (country.length < 2) throw new Error('Enter your country.');
          if (!(await api.isUsernameAvailable(username))) throw new Error('That username is already taken. Choose another one.');
          api.signInWithGoogle({ username, country });
        } else api.signInWithGoogle();
      } catch (error) { $('#authError').textContent = niceError(error); }
    });
    $('#authTabSignup').addEventListener('click', () => { authMode = 'signup'; updateAuthMode(); });
    $('#authTabSignin').addEventListener('click', () => { authMode = 'signin'; updateAuthMode(); });
    $('#createButton').addEventListener('click', () => requireAuth(openCreate));
    $('#createForm').addEventListener('submit', event => { event.preventDefault(); requireAuth(() => submitCreate(event)); });
    $('#createType').addEventListener('change', event => {
      const poll = event.target.value === 'poll';
      $('#choiceFields').innerHTML = '';
      if (poll) { addChoiceRow(); addChoiceRow(); }
      setCreateMode(event.target.value);
    });
    $('#addChoice').addEventListener('click', () => {
      if ($('#createType').value === 'ranking') { $('#rankingImageInput').click(); return; }
      addChoiceRow();
    });
    $('#rankingImageInput').addEventListener('change', event => {
      const files = [...event.target.files]; const remaining = 12 - $('#choiceFields').children.length;
      files.slice(0, remaining).forEach(file => addChoiceRow(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 100), file));
      if (files.length > remaining) toast('A ranking can have up to 12 images.');
      event.target.value = '';
    });
    $('#searchInput').addEventListener('input', event => { searchText = event.target.value.trim(); if (currentThread) return; renderFeed(); });
    $$('#typeSwitch button').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.mode)));
    $$('[data-filter-link]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); setFilter(link.dataset.filterLink); $('#community').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $('#myThreads').addEventListener('click', () => { if (!currentUser) { pendingAction = () => { ownThreads = true; setFilter('all', true); }; openAuth(); return; } ownThreads = !ownThreads; setFilter('all', ownThreads); });
    $$('[data-close="auth"]').forEach(button => button.addEventListener('click', () => closeBackdrop('authBackdrop')));
    $$('[data-close="premium"]').forEach(button => button.addEventListener('click', () => closeBackdrop('premiumBackdrop')));
    $$('[data-close="create"]').forEach(button => button.addEventListener('click', () => closeBackdrop('createBackdrop')));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeBackdrop(backdrop.id); }));
    window.addEventListener('popstate', renderRoute);
  }
  function initLandingCarousel() {
    const slides = $$('.landing-slide'), dots = $$('.landing-dot');
    if (!slides.length) return;
    const names = ['JUJUTSU KAISEN', 'DEMON SLAYER', 'BLEACH', 'BLACK CLOVER'];
    let active = 0, carouselTimer;
    function show(index) {
      active = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('active', i === active));
      dots.forEach((dot, i) => dot.classList.toggle('active', i === active));
      $('#landingSlideNumber').textContent = String(active + 1).padStart(2, '0');
      $('#landingSlideName').textContent = names[active];
    }
    function restart() {
      clearInterval(carouselTimer);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) carouselTimer = setInterval(() => show(active + 1), 6000);
    }
    dots.forEach((dot, i) => dot.addEventListener('click', () => { show(i); restart(); }));
    $('#landingNext').addEventListener('click', () => { show(active + 1); restart(); });
    $('#landingPrev').addEventListener('click', () => { show(active - 1); restart(); });
    restart();
  }
  function initFeaturedRanking() {
    const board = $('#featuredTierBoard');
    if (!board) return;
    const updateControls = () => $$('[data-tier]', board).forEach((row, index, rows) => {
      $('[data-tier-move="up"]', row).disabled = index === 0;
      $('[data-tier-move="down"]', row).disabled = index === rows.length - 1;
    });
    const reorder = (row, direction) => {
      const sibling = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!sibling) return false;
      board.insertBefore(direction === 'up' ? row : sibling, direction === 'up' ? sibling : row);
      return true;
    };
    $$('[data-tier-move]', board).forEach(button => button.addEventListener('click', () => requirePremium(() => {
      if (reorder(button.closest('[data-tier]'), button.dataset.tierMove)) {
        updateControls();
        toast('Preview order changed for this session.');
      }
    })));
    $$('.tier-name', board).forEach(input => input.addEventListener('click', () => requirePremium(() => {
      input.readOnly = false;
      input.focus();
      input.select();
    })));
    $('#rateFeaturedRanking').addEventListener('click', () => requirePremium(() => toast('Your rating is saved in this preview only.')));
    $('#premiumSignIn').addEventListener('click', async event => {
      const button = event.currentTarget;
      closeBackdrop('premiumBackdrop');
      if (!currentUser) { pendingAction = () => startPremiumCheckout(button); openAuth(); return; }
      await startPremiumCheckout(button);
    });
    updateControls();
  }
  async function startPremiumCheckout(button) {
    button.disabled = true;
    button.textContent = 'Opening secure checkout…';
    try {
      const session = await api.getSession();
      if (!session?.access_token) throw new Error('Sign in before starting checkout.');
      const response = await fetch('/api/create-checkout-session', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'Could not start checkout.');
      location.assign(result.url);
    } catch (error) {
      toast(error.message || 'Could not start checkout. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Subscribe to Premium';
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    setTranslationLanguage(translationLanguage);
    $('#translationLanguage').addEventListener('change', event => setTranslationLanguage(event.target.value));
    initTheme(); init();
  });
  document.addEventListener('DOMContentLoaded', () => { initLandingCarousel(); initFeaturedRanking(); });
})();

