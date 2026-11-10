    let currentAnime = 'Jujutsu Kaisen';
    let currentEpisode = 'Episode 07';
    let currentSeason = 'Season 2';
    let animeSlug = 'jujutsu-kaisen';
    const episodeKey = () => `talkanime:messages:${animeSlug}:${currentSeason.toLowerCase().replace(/\s+/g, '-')}:${currentEpisode.toLowerCase().replace(/\s+/g, '-')}`;
    const animeKey = () => `talkanime:messages:${animeSlug}:all`;
    const followKey = () => `talkanime:following:${animeSlug}`;
    const seed = {
      episode: [
        { id: 'm1', user: 'kaizoku_ren', initials: 'K', avatar: 'ren', time: '21:04', text: 'That opening scene was incredible. The animation budget showed.', likes: 42, replies: [{ user: 'framebyframe', text: 'The camera movement through the station was unreal.', time: '21:06' }, { user: 'mochi_m', text: 'That whole first minute felt like a movie.', time: '21:09' }] },
        { id: 'm2', user: 'theory_tom', initials: 'T', avatar: 'tom', time: '21:07', text: 'The moment the barriers went up changed everything.', spoiler: true, likes: 8, replies: [] },
        { id: 'm3', user: 'mika_draws', initials: 'M', avatar: 'nova', time: '20:58', text: 'The sound design in this episode deserves its own award.', likes: 15, replies: [] }
      ],
      anime: [
        { id: 'a1', user: 'theory_tom', initials: 'T', avatar: 'tom', time: '21:12', text: 'What do you think the Culling Game is really trying to achieve?', likes: 17, replies: [{ user: 'kaizoku_ren', text: 'I think the rules are the clue. Every one of them has a purpose.', time: '21:16' }] },
        { id: 'a2', user: 'mika_draws', initials: 'M', avatar: 'nova', time: '20:46', text: 'Which arc has your favourite character moment so far?', likes: 12, replies: [] },
        { id: 'a3', user: 'kaizoku_ren', initials: 'K', avatar: 'ren', time: '20:31', text: 'The way the story keeps connecting the smallest details is so satisfying.', spoiler: true, likes: 6, replies: [] }
      ]
    };
    const $ = (selector, root = document) => root.querySelector(selector);
    const feed = $('#feed');
    const extensionMode = Boolean(globalThis.chrome?.runtime?.id);
    let roomReady = !extensionMode;
    let mediaKind = 'series';
    let scope = 'episode';
    let markedSpoiler = false;
    let toastTimer;
    let ratingReturnFocus = null;
    let messages = FandomRoomBackend.configured ? { episode: [], anime: [] } : {
      episode: read(episodeKey(), seed.episode),
      anime: read(animeKey(), seed.anime)
    };
    function read(key, fallback) {
      try { const data = JSON.parse(localStorage.getItem(key)); return Array.isArray(data) ? data : structuredClone(fallback); }
      catch { return structuredClone(fallback); }
    }
    function save() { if (FandomRoomBackend.configured) return; try { localStorage.setItem(scope === 'episode' ? episodeKey() : animeKey(), JSON.stringify(messages[scope])); } catch {} }
    function toast(message) {
      const el = $('#toast'); el.textContent = message; el.classList.add('visible');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2200);
    }
    function escapeText(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
    function render() {
      const newestFirst = $('#sortOrder').value === 'newest';
      const list = [...messages[scope]].sort((a, b) => newestFirst ? Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '') : Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
      const filtered = list;
      feed.innerHTML = '';
      if (!filtered.length) { feed.innerHTML = '<div class="empty">No messages here yet. Start the conversation.</div>'; }
      for (const message of filtered) feed.appendChild(messageElement(message));
      const count = FandomRoomBackend.configured ? list.length : scope === 'episode' ? 128 + Math.max(0, messages.episode.length - seed.episode.length) : 412 + Math.max(0, messages.anime.length - seed.anime.length);
      $('#messageCount').textContent = `${count} ${scope === 'episode' ? 'messages' : 'posts'}`;
    }
    function messageElement(message) {
      const article = document.createElement('article'); article.className = 'message'; article.dataset.id = message.id;
      const safeText = escapeText(message.text);
      article.innerHTML = `<div class="avatar ${message.avatar || 'me'}">${escapeText(message.initials || 'N')}</div>
        <div class="message-body"><div class="message-head"><strong>${escapeText(message.user)}</strong><span class="time">${escapeText(message.time || 'just now')}</span>${message.spoiler ? '<span class="spoiler-label">Spoiler</span>' : ''}</div>
        ${message.spoiler ? `<button type="button" class="spoiler-box hidden-spoiler" aria-label="Reveal spoiler"><span class="click-hint">Contains spoilers · Click to reveal</span><span class="spoiler-content">${safeText}</span></button>` : `<p class="message-text">${safeText}</p>`}
        <div class="message-actions"><button type="button" class="small-action like ${message.liked ? 'liked' : ''}" aria-pressed="${Boolean(message.liked)}">♥&nbsp; ${message.likes || 0}</button><button type="button" class="small-action reply-button">Reply</button><button type="button" class="small-action report">Report</button></div>
        ${message.replies?.length ? `<div class="reply-thread"><button type="button" class="small-action replies-button">${message.replies.length} ${message.replies.length === 1 ? 'Reply' : 'Replies'}</button></div>` : ''}
        <div class="reply-list">${(message.replies || []).map(reply => `<p class="reply-item"><strong>${escapeText(reply.user)}</strong>${escapeText(reply.text)}<span>${escapeText(reply.time || '')}</span></p>`).join('')}</div>
        <form class="reply-input" hidden><input aria-label="Write a reply" placeholder="Write a reply…" maxlength="500"><button type="submit">Reply</button></form></div>`;
      $('.spoiler-box', article)?.addEventListener('click', e => { e.currentTarget.classList.remove('hidden-spoiler'); e.currentTarget.disabled = true; });
      $('.like', article).addEventListener('click', async e => {
        const target = messages[scope].find(m => m.id === message.id); if (!target) return;
        const wasLiked = Boolean(target.liked); target.liked = !wasLiked; target.likes = Math.max(0, (target.likes || 0) + (target.liked ? 1 : -1)); render();
        try { if (FandomRoomBackend.configured && !String(target.id).startsWith('local-')) { await FandomRoomBackend.toggleLike(target.id, wasLiked); await syncBackendRoom(); } else save(); }
        catch (error) { target.liked = wasLiked; target.likes = Math.max(0, (target.likes || 0) + (wasLiked ? 1 : -1)); render(); toast(error.message); }
      });
      $('.reply-button', article).addEventListener('click', () => { const form = $('.reply-input', article); form.hidden = !form.hidden; if (!form.hidden) $('input', form).focus(); });
      $('.replies-button', article)?.addEventListener('click', e => { const box = $('.reply-list', article); box.classList.toggle('open'); e.currentTarget.textContent = box.classList.contains('open') ? 'Hide replies' : `${message.replies.length} ${message.replies.length === 1 ? 'Reply' : 'Replies'}`; });
      $('.reply-input', article).addEventListener('submit', async e => {
        e.preventDefault(); const input = $('input', e.currentTarget); const value = input.value.trim(); if (!value) return;
        try {
          if (FandomRoomBackend.configured && !String(message.id).startsWith('local-')) await FandomRoomBackend.createPost({ animeSlug, scope, season: currentSeason, episode: currentEpisode, body: value, spoiler: false, parentId: message.id });
          else { const target = messages[scope].find(m => m.id === message.id); target.replies = target.replies || []; target.replies.push({ user: 'nao', text: value, time: 'now' }); save(); }
          await syncBackendRoom(); toast('Reply posted');
        } catch (error) { toast(error.message); }
      });
      $('.report', article).addEventListener('click', () => toast('Report received. Thanks for helping keep the room welcoming.'));
      return article;
    }
    function setScope(next) {
      scope = next === 'episode' && currentEpisode ? 'episode' : 'anime';
      const whole = scope === 'anime';
      $('#episodeTab').hidden = !currentEpisode;
      $('#episodeTab').classList.toggle('active', !whole); $('#episodeTab').setAttribute('aria-selected', String(!whole));
      $('#animeTab').classList.toggle('active', whole); $('#animeTab').setAttribute('aria-selected', String(whole));
      $('#animeTab').textContent = mediaKind === 'movie' ? 'Movie discussion'
        : mediaKind === 'video' ? 'Video discussion' : 'Whole show discussion';
      const ratingSubject = whole ? mediaKind === 'movie' ? 'movie' : mediaKind === 'video' ? 'video' : 'show' : 'episode';
      $('#ratingBlock').setAttribute('aria-label', `${ratingSubject[0].toUpperCase()}${ratingSubject.slice(1)} rating`);
      $('.rating-label').textContent = `${ratingSubject} rating`;
      $('.rating-summary').setAttribute('aria-label', `No ${ratingSubject} rating yet`);
      $('#rateButton').innerHTML = `<span aria-hidden="true">☆</span> Rate ${ratingSubject}`;
      $('#rateCopy').textContent = `To help prevent review bombing and keep ${ratingSubject} ratings as true as possible, only Super Members can rate ${ratingSubject === 'episode' ? 'an' : 'a'} ${ratingSubject}. Subscribe to become a Super Member.`;
      $('#onlineCount').textContent = FandomRoomBackend.configured ? 'Shared community room' : whole ? '58 super fans here' : '25 super fans here';
      const commentPrompt = whole
        ? mediaKind === 'movie' ? 'What did you think about the movie?' : mediaKind === 'video' ? 'What did you think about the video?' : 'What did you think about the show?'
        : 'What did you think about the episode?';
      $('#messageInput').placeholder = commentPrompt;
      $('#messageInput').setAttribute('aria-label', commentPrompt);
      render();
      history.replaceState({}, '', whole ? '#anime' : '#episode-07');
      syncBackendRoom();
    }
    let roomRequest = 0;
    async function syncBackendRoom() {
      if (!roomReady || !FandomRoomBackend.configured) return;
      const requestId = ++roomRequest;
      const room = { animeSlug, scope, season: currentSeason, episode: currentEpisode };
      try {
        const [posts, following] = await Promise.all([FandomRoomBackend.loadPosts(room), FandomRoomBackend.isFollowing(animeSlug)]);
        if (requestId !== roomRequest || animeSlug !== room.animeSlug || scope !== room.scope) return;
        messages[scope] = posts;
        const button = $('#followButton'); button.setAttribute('aria-pressed', String(following)); button.classList.toggle('is-following', following);
        button.innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow show';
        render();
      } catch (error) { if (requestId === roomRequest) toast(error.message); }
    }
    $('#episodeTab').addEventListener('click', () => setScope('episode'));
    $('#animeTab').addEventListener('click', () => setScope('anime'));
    $('#sortOrder').addEventListener('change', render);
    const composer = $('#composer');
    const messageInput = $('#messageInput');
    const postComment = $('#postComment');
    const emojiPicker = $('#emojiPicker');
    function expandComposer() { composer.classList.add('is-expanded'); }
    function resetComposer() {
      messageInput.value = '';
      messageInput.style.height = '';
      markedSpoiler = false;
      $('#spoilerToggle').setAttribute('aria-pressed', 'false');
      postComment.disabled = true;
      composer.classList.remove('is-expanded');
      emojiPicker.classList.remove('open');
      $('#emojiButton').setAttribute('aria-expanded', 'false');
      messageInput.blur();
    }
    messageInput.addEventListener('focus', expandComposer);
    messageInput.addEventListener('input', () => {
      expandComposer();
      postComment.disabled = !messageInput.value.trim();
      messageInput.style.height = 'auto';
      messageInput.style.height = `${Math.min(messageInput.scrollHeight, 110)}px`;
    });
    $('#cancelComment').addEventListener('click', resetComposer);
    $('#emojiButton').addEventListener('click', () => {
      expandComposer();
      const isOpen = emojiPicker.classList.toggle('open');
      $('#emojiButton').setAttribute('aria-expanded', String(isOpen));
    });
    emojiPicker.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      expandComposer();
      const start = messageInput.selectionStart;
      const end = messageInput.selectionEnd;
      messageInput.setRangeText(button.textContent, start, end, 'end');
      messageInput.dispatchEvent(new Event('input', { bubbles: true }));
      emojiPicker.classList.remove('open');
      $('#emojiButton').setAttribute('aria-expanded', 'false');
      messageInput.focus();
    });
    $('#spoilerToggle').addEventListener('click', e => {
      markedSpoiler = !markedSpoiler; e.currentTarget.setAttribute('aria-pressed', String(markedSpoiler));
      expandComposer();
    });
    composer.addEventListener('submit', async e => {
      e.preventDefault(); const input = $('#messageInput'); const value = input.value.trim();
      if (!roomReady) return;
      if (!value) { input.focus(); toast('Write a message before posting.'); return; }
      if (FandomRoomBackend.configured) {
        try {
          await FandomRoomBackend.createPost({ animeSlug, scope, season: currentSeason, episode: currentEpisode, body: value, spoiler: markedSpoiler });
          resetComposer();
          await syncBackendRoom(); toast('Your message was posted.');
        } catch (error) { toast(error.message); }
        return;
      }
      const posted = { id: `local-${Date.now()}`, user: 'nao', initials: 'N', avatar: 'me', time: 'just now', text: value, spoiler: markedSpoiler, likes: 0, replies: [] };
      messages[scope].push(posted); save(); resetComposer();
      setScope(scope); toast('Your message was posted.');
    });
    $('#followButton').addEventListener('click', async e => {
      const following = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(following));
      e.currentTarget.classList.toggle('is-following', following); e.currentTarget.innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow show';
      if (FandomRoomBackend.configured) {
        try { await FandomRoomBackend.setFollowing(animeSlug, following); }
        catch (error) { e.currentTarget.setAttribute('aria-pressed', String(!following)); e.currentTarget.classList.toggle('is-following', !following); e.currentTarget.innerHTML = !following ? '✓&nbsp; Following' : '<span>＋</span> Follow show'; toast(error.message); }
        return;
      }
      try { localStorage.setItem(followKey(), String(following)); } catch {}
      toast(following ? `${currentAnime} added to your following list.` : `${currentAnime} removed from your following list.`);
    });
    function applyScan(scan) {
      const detectedTitle = scan.title?.trim() || '';
      const details = [detectedTitle, scan.season, scan.episode].filter(Boolean);
      $('#scanTitle').textContent = detectedTitle ? details.join(' · ')
        : scan.supported ? 'No match yet' : 'Page could not be scanned';
      $('#scanMessage').textContent = scan.message;
      $('#manualScan').hidden = Boolean(detectedTitle);
      $('#manualScan').open = !detectedTitle;
      $('#manualTitle').value = detectedTitle;
      $('#manualSeason').value = scan.season?.replace(/^Season /, '') || '';
      $('#manualEpisode').value = scan.episode?.replace(/^Episode /, '') || '';
      if (!detectedTitle) return;

      roomReady = true;
      $('main').classList.remove('no-room');
      const previousSlug = animeSlug;
      const previousEpisode = currentEpisode;
      const previousSeason = currentSeason;
      currentAnime = detectedTitle;
      const normalizedTitle = detectedTitle.toLowerCase().normalize('NFKD');
      const letters = normalizedTitle.replace(/\p{M}/gu, '');
      const hasOtherScript = [...letters].some((letter) => /[\p{L}\p{N}]/u.test(letter) && !/[a-z0-9]/.test(letter));
      animeSlug = (hasOtherScript ? letters.replace(/[^\p{L}\p{N}]+/gu, '-')
        : normalizedTitle.replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '') || 'untitled';
      currentEpisode = scan.episode || '';
      currentSeason = scan.season || '';
      mediaKind = scan.kind || 'series';
      if (animeSlug !== previousSlug || currentEpisode !== previousEpisode || currentSeason !== previousSeason) {
        resetComposer();
        const demoRoom = animeSlug === 'jujutsu-kaisen' && currentEpisode === 'Episode 07' && currentSeason === 'Season 2';
        messages = FandomRoomBackend.configured ? { episode: [], anime: [] } : { episode: read(episodeKey(), demoRoom ? seed.episode : []), anime: read(animeKey(), animeSlug === 'jujutsu-kaisen' ? seed.anime : []) };
        if (!FandomRoomBackend.configured) try {
          const following = localStorage.getItem(followKey()) === 'true';
          $('#followButton').setAttribute('aria-pressed', String(following));
          $('#followButton').classList.toggle('is-following', following);
          $('#followButton').innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow show';
        } catch {}
      }
      setScope(scan.episode ? 'episode' : 'anime');
    }
    $('#manualScanForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const title = $('#manualTitle').value.trim();
      if (!/[\p{L}\p{N}]/u.test(title)) {
        toast('Enter the title of what you’re watching.');
        $('#manualTitle').focus();
        return;
      }
      const seasonValue = $('#manualSeason').value;
      const episodeValue = $('#manualEpisode').value;
      applyScan({
        title,
        season: seasonValue ? 'Season ' + Number(seasonValue) : '',
        episode: episodeValue ? 'Episode ' + String(Number(episodeValue)).padStart(2, '0') : '',
        kind: episodeValue || !roomReady ? 'series' : mediaKind,
        message: 'Discussion opened with the details you entered.'
      });
    });
    if (!FandomRoomBackend.configured) try { if (localStorage.getItem(followKey()) === 'true') { $('#followButton').setAttribute('aria-pressed', 'true'); $('#followButton').classList.add('is-following'); $('#followButton').innerHTML = '✓&nbsp; Following'; } } catch {}
    const rateGate = $('#rateGate');
    const rateDialog = $('.rate-dialog', rateGate);
    function closeRatingGate() {
      rateGate.hidden = true;
      ratingReturnFocus?.focus();
    }
    $('#rateButton').addEventListener('click', () => {
      ratingReturnFocus = $('#rateButton');
      rateGate.hidden = false;
      rateDialog.focus();
    });
    $('#rateClose').addEventListener('click', closeRatingGate);
    $('#rateDismiss').addEventListener('click', closeRatingGate);
    rateGate.addEventListener('click', event => { if (event.target === rateGate) closeRatingGate(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !rateGate.hidden) closeRatingGate(); });
    const refreshScanButton = $('#refreshScan');
    let scanRequest = 0;
    function clearRoom(title, message) {
      roomReady = false;
      ++roomRequest;
      $('main').classList.add('no-room');
      $('#manualScan').hidden = true;
      $('#scanTitle').textContent = title;
      $('#scanMessage').textContent = message;
    }
    function resetScanButton() {
      refreshScanButton.disabled = false;
      refreshScanButton.textContent = '↻ Refresh & scan';
    }
    async function scanActiveTab() {
      const request = ++scanRequest;
      clearRoom('Scanning this page', 'Looking for the title and episode.');
      refreshScanButton.disabled = true;
      refreshScanButton.textContent = 'Scanning page…';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (request !== scanRequest) return;
        if (tab?.id == null) throw new Error('Open a viewing page and try again.');
        const result = await chrome.runtime.sendMessage({ type: 'FANDOMROOM_REFRESH_SCAN', tabId: tab.id });
        if (request !== scanRequest) return;
        if (!result?.ok) throw new Error(result?.error || 'Could not scan this page.');
        applyScan(result.scan);
      } catch (error) {
        if (request === scanRequest) applyScan({ supported: false, message: error.message || 'Could not scan this page.' });
      } finally {
        if (request === scanRequest) resetScanButton();
      }
    }
    refreshScanButton.addEventListener('click', scanActiveTab);
    if (extensionMode) {
      const panelWindow = chrome.windows.getCurrent();
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type !== 'FANDOMROOM_TOOLBAR_SCAN') return;
        panelWindow.then(({ id }) => {
          if (message.windowId === id) scanActiveTab();
        });
      });
      scanActiveTab();
    } else {
      refreshScanButton.hidden = true;
      setScope(location.hash === '#anime' ? 'anime' : 'episode');
    }
