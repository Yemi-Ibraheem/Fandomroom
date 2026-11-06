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
    let scope = 'episode';
    let markedSpoiler = false;
    let toastTimer;
    let messages = TalkAnimeBackend.configured ? { episode: [], anime: [] } : {
      episode: read(episodeKey(), seed.episode),
      anime: read(animeKey(), seed.anime)
    };
    function read(key, fallback) {
      try { const data = JSON.parse(localStorage.getItem(key)); return Array.isArray(data) ? data : structuredClone(fallback); }
      catch { return structuredClone(fallback); }
    }
    function save() { if (TalkAnimeBackend.configured) return; try { localStorage.setItem(scope === 'episode' ? episodeKey() : animeKey(), JSON.stringify(messages[scope])); } catch {} }
    function toast(message) {
      const el = $('#toast'); el.textContent = message; el.classList.add('visible');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2200);
    }
    function escapeText(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
    function render() {
      const query = $('#search').value.trim().toLowerCase();
      const newestFirst = $('#sortOrder').value === 'newest';
      const list = [...messages[scope]].sort((a, b) => newestFirst ? Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '') : Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
      const filtered = query ? list.filter(m => `${m.user} ${m.text}`.toLowerCase().includes(query)) : list;
      feed.innerHTML = '';
      if (!filtered.length) { feed.innerHTML = `<div class="empty">${query ? 'No messages match your search.' : 'No messages here yet. Start the conversation.'}</div>`; }
      for (const message of filtered) feed.appendChild(messageElement(message));
      const count = TalkAnimeBackend.configured ? list.length : scope === 'episode' ? 128 + Math.max(0, messages.episode.length - seed.episode.length) : 412 + Math.max(0, messages.anime.length - seed.anime.length);
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
        try { if (TalkAnimeBackend.configured && !String(target.id).startsWith('local-')) { await TalkAnimeBackend.toggleLike(target.id, wasLiked); await syncBackendRoom(); } else save(); }
        catch (error) { target.liked = wasLiked; target.likes = Math.max(0, (target.likes || 0) + (wasLiked ? 1 : -1)); render(); toast(error.message); }
      });
      $('.reply-button', article).addEventListener('click', () => { const form = $('.reply-input', article); form.hidden = !form.hidden; if (!form.hidden) $('input', form).focus(); });
      $('.replies-button', article)?.addEventListener('click', e => { const box = $('.reply-list', article); box.classList.toggle('open'); e.currentTarget.textContent = box.classList.contains('open') ? 'Hide replies' : `${message.replies.length} ${message.replies.length === 1 ? 'Reply' : 'Replies'}`; });
      $('.reply-input', article).addEventListener('submit', async e => {
        e.preventDefault(); const input = $('input', e.currentTarget); const value = input.value.trim(); if (!value) return;
        try {
          if (TalkAnimeBackend.configured && !String(message.id).startsWith('local-')) await TalkAnimeBackend.createPost({ animeSlug, scope, season: currentSeason, episode: currentEpisode, body: value, spoiler: false, parentId: message.id });
          else { const target = messages[scope].find(m => m.id === message.id); target.replies = target.replies || []; target.replies.push({ user: 'nao', text: value, time: 'now' }); save(); }
          await syncBackendRoom(); toast('Reply posted');
        } catch (error) { toast(error.message); }
      });
      $('.report', article).addEventListener('click', () => toast('Report received. Thanks for helping keep the room welcoming.'));
      return article;
    }
    function setScope(next) {
      scope = next;
      const whole = scope === 'anime';
      $('#episodeTab').classList.toggle('active', !whole); $('#episodeTab').setAttribute('aria-selected', String(!whole));
      $('#animeTab').classList.toggle('active', whole); $('#animeTab').setAttribute('aria-selected', String(whole));
      $('#roomType').textContent = whole ? 'Whole anime discussion' : 'Episode discussion';
      $('#roomTitle').textContent = whole ? `${currentAnime} - Whole anime discussion` : `${currentEpisode} discussion`;
      $('#seriesSubtitle').textContent = whole ? `All seasons and episodes · ${currentAnime}` : `${currentAnime}${currentSeason ? ` - ${currentSeason}` : ''}`;
      $('#crumbTitle').textContent = whole ? 'Whole anime' : currentEpisode;
      $('#noteTitle').textContent = whole ? 'Room note from the mods' : 'Room note from the mods';
      $('#noteText').textContent = whole ? 'This is the conversation for the whole anime. Mark major plot reveals as spoilers so fans can browse at their own pace.' : `Keep discussion to ${currentEpisode}. Mark anything beyond this episode as a spoiler so everyone can enjoy the reveal at their own pace.`;
      $('#onlineCount').textContent = TalkAnimeBackend.configured ? 'Shared community room' : whole ? '58 super fans here' : '25 super fans here';
      $('#messageInput').placeholder = whole ? `What do you think of ${currentAnime}...` : `What did you think of ${currentEpisode}...`;
      $('#search').value = ''; $('#searchResults').classList.remove('show'); render();
      history.replaceState({}, '', whole ? '#anime' : '#episode-07');
      syncBackendRoom();
    }
    let roomRequest = 0;
    async function syncBackendRoom() {
      if (!TalkAnimeBackend.configured) return;
      const requestId = ++roomRequest;
      const room = { animeSlug, scope, season: currentSeason, episode: currentEpisode };
      try {
        const [posts, following] = await Promise.all([TalkAnimeBackend.loadPosts(room), TalkAnimeBackend.isFollowing(animeSlug)]);
        if (requestId !== roomRequest || animeSlug !== room.animeSlug || scope !== room.scope) return;
        messages[scope] = posts;
        const button = $('#followButton'); button.setAttribute('aria-pressed', String(following)); button.classList.toggle('is-following', following);
        button.innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow';
        render();
      } catch (error) { if (requestId === roomRequest) toast(error.message); }
    }
    $('#episodeTab').addEventListener('click', () => setScope('episode'));
    $('#animeTab').addEventListener('click', () => setScope('anime'));
    $('#sortOrder').addEventListener('change', render);
    $('#spoilerToggle').addEventListener('click', e => {
      markedSpoiler = !markedSpoiler; e.currentTarget.setAttribute('aria-pressed', String(markedSpoiler));
      $('#messageInput').placeholder = markedSpoiler ? 'Write your spoiler here…' : (scope === 'anime' ? `What do you think of ${currentAnime}...` : `What did you think of ${currentEpisode}...`);
    });
    $('#composer').addEventListener('submit', async e => {
      e.preventDefault(); const input = $('#messageInput'); const value = input.value.trim();
      if (!value) { input.focus(); toast('Write a message before posting.'); return; }
      if (TalkAnimeBackend.configured) {
        try {
          await TalkAnimeBackend.createPost({ animeSlug, scope, season: currentSeason, episode: currentEpisode, body: value, spoiler: markedSpoiler });
          input.value = ''; markedSpoiler = false; $('#spoilerToggle').setAttribute('aria-pressed', 'false');
          await syncBackendRoom(); toast('Your message was posted.');
        } catch (error) { toast(error.message); }
        return;
      }
      const posted = { id: `local-${Date.now()}`, user: 'nao', initials: 'N', avatar: 'me', time: 'just now', text: value, spoiler: markedSpoiler, likes: 0, replies: [] };
      messages[scope].push(posted); save(); input.value = ''; markedSpoiler = false; $('#spoilerToggle').setAttribute('aria-pressed', 'false');
      setScope(scope); toast('Your message was posted.');
    });
    $('#followButton').addEventListener('click', async e => {
      const following = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(following));
      e.currentTarget.classList.toggle('is-following', following); e.currentTarget.innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow';
      if (TalkAnimeBackend.configured) {
        try { await TalkAnimeBackend.setFollowing(animeSlug, following); }
        catch (error) { e.currentTarget.setAttribute('aria-pressed', String(!following)); e.currentTarget.classList.toggle('is-following', !following); e.currentTarget.innerHTML = !following ? '✓&nbsp; Following' : '<span>＋</span> Follow'; toast(error.message); }
        return;
      }
      try { localStorage.setItem(followKey(), String(following)); } catch {}
      toast(following ? `${currentAnime} added to your following list.` : `${currentAnime} removed from your following list.`);
    });
    function applyScan(scan) {
      if (!scan) return;
      $('#scanTitle').textContent = scan.title ? `${scan.title}${scan.episode ? ` · ${scan.episode}` : ''}` : scan.site || 'Page scan';
      $('#scanMessage').textContent = scan.message || 'Page scanned.';
      $('#scanStatus').style.display = 'grid';
      if (!scan.title) return;
      const previousSlug = animeSlug;
      const previousEpisode = currentEpisode;
      const previousSeason = currentSeason;
      currentAnime = scan.title;
      animeSlug = scan.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'anime';
      currentEpisode = scan.episode || 'Episode 01';
      currentSeason = scan.season || '';
      if (animeSlug !== previousSlug || currentEpisode !== previousEpisode || currentSeason !== previousSeason) {
        const demoRoom = animeSlug === 'jujutsu-kaisen' && currentEpisode === 'Episode 07' && currentSeason === 'Season 2';
        messages = TalkAnimeBackend.configured ? { episode: [], anime: [] } : { episode: read(episodeKey(), demoRoom ? seed.episode : []), anime: read(animeKey(), animeSlug === 'jujutsu-kaisen' ? seed.anime : []) };
        if (!TalkAnimeBackend.configured) try {
          const following = localStorage.getItem(followKey()) === 'true';
          $('#followButton').setAttribute('aria-pressed', String(following));
          $('#followButton').classList.toggle('is-following', following);
          $('#followButton').innerHTML = following ? '✓&nbsp; Following' : '<span>＋</span> Follow';
        } catch {}
      }
      $('.crumbs span:nth-child(3)').textContent = currentAnime;
      setScope(scan.episode ? 'episode' : 'anime');
    }
    if (globalThis.chrome?.storage?.local) {
      async function loadCurrentScan() {
        try { const { currentScan } = await chrome.storage.local.get('currentScan'); applyScan(currentScan); } catch {}
      }
      loadCurrentScan();
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.currentScan) applyScan(changes.currentScan.newValue);
      });
    }
    if (!TalkAnimeBackend.configured) try { if (localStorage.getItem(followKey()) === 'true') { $('#followButton').setAttribute('aria-pressed', 'true'); $('#followButton').classList.add('is-following'); $('#followButton').innerHTML = '✓&nbsp; Following'; } } catch {}
    $('#shareButton').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Discussion link copied.'); }
      catch { toast('Share this page using your browser’s share menu.'); }
    });
    $('#search').addEventListener('input', e => {
      const value = e.target.value.trim();
      const results = $('#searchResults');
      if (!value) { results.classList.remove('show'); render(); return; }
      results.textContent = `${currentAnime} · ` + (scope === 'anime' ? 'Whole anime discussion' : `${currentEpisode} discussion`);
      results.classList.add('show'); render();
    });
    $('#search').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { $('#searchResults').classList.remove('show'); $('#search').blur(); toast('Showing matching discussion messages.'); } });
    $('#profile').addEventListener('click', () => toast('Profile and account settings are coming soon.'));
    setScope(location.hash === '#anime' ? 'anime' : 'episode');
