// Open the panel during the toolbar click so Chrome grants access to that tab.
// The built-in side panel toggle does not grant activeTab.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  .catch((error) => console.error('Could not configure the side panel:', error));

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId })
    .then(() => chrome.runtime.sendMessage({
      type: 'FANDOMROOM_TOOLBAR_SCAN',
      windowId: tab.windowId
    }).catch(() => {
      // A newly opened panel also scans when it loads.
    }))
    .catch((error) => console.error('Could not open Fandom Room:', error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'FANDOMROOM_REFRESH_SCAN' || !Number.isInteger(message.tabId)) return;
  chrome.tabs.get(message.tabId)
    .then(scanTab)
    .then((scan) => sendResponse({ ok: true, scan }))
    .catch(() => sendResponse({ ok: false, error: 'The tab is no longer available. Open a viewing page and scan again.' }));
  return true;
});

async function scanTab(tab) {
  if (tab.id == null || !tab.url) {
    return { supported: false, message: 'Click the Fandom Room toolbar icon on this tab to grant page access.' };
  }
  if (!/^https?:\/\//i.test(tab.url)) {
    return { supported: false, message: 'Open a viewing website in this tab, then click the Fandom Room toolbar icon.' };
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readAnimePage
    });
    return identifyAnime(result);
  } catch (error) {
    const message = /cannot access|permission/i.test(error?.message || '')
      ? 'Chrome blocked access. Click the Fandom Room toolbar icon on this tab to grant access.'
      : 'The scan could not read this page. Wait for it to load, then click Refresh & scan.';
    return { supported: false, message };
  }
}

function readAnimePage() {
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const meta = (key) => clean(document.querySelector(
    'meta[property="' + key + '"], meta[name="' + key + '"], meta[itemprop="' + key + '"]'
  )?.content);
  const page = {
    url: location.href,
    pageTitle: clean(document.title),
    metaTitle: meta('og:title') || meta('twitter:title') || meta('title'),
    siteName: meta('og:site_name'),
    mediaType: meta('og:type'),
    videoMeta: Boolean(meta('og:video') || meta('og:video:url') || meta('og:video:secure_url')),
    seriesTitle: '',
    episodeLabel: ''
  };

  if (/(^|\.)animeheaven\.me$/i.test(location.hostname)) {
    // AnimeHeaven's gate page identifies the show in its series link.
    const heading = document.querySelector('h1 .linetitle3') || document.querySelector('h1');
    const episodeHeading = /\bepisode\s*\d/i.test(heading?.textContent || '') ? heading : null;
    const seriesLink = [...(episodeHeading?.querySelectorAll('a[href]') || [])].find((link) => (
      link.origin === location.origin && link.pathname === '/anime.php' && link.search
    ));
    page.seriesTitle = clean(seriesLink?.textContent || document.querySelector('.infotitle')?.textContent);
    page.episodeLabel = clean(seriesLink
      ? episodeHeading.textContent.replace(seriesLink.textContent, '')
      : episodeHeading?.textContent);
  }

  const visible = (el) => el.getClientRects().length > 0;
  const heading = [...document.querySelectorAll('h1')].find(visible);
  page.heading = clean(heading?.innerText);
  const playerHeading = document.querySelector('[data-uia="video-title"]');
  const seriesElement = document.querySelector(
    '[data-series-title], [data-show-title], [itemprop="partOfSeries"] [itemprop="name"], .series-title, .show-title, .anime-title'
  ) || playerHeading?.querySelector('h4');
  page.seriesTitle ||= clean(seriesElement?.dataset.seriesTitle || seriesElement?.dataset.showTitle
    || seriesElement?.getAttribute('content') || seriesElement?.textContent);
  page.episodeLabel ||= clean(playerHeading?.innerText || playerHeading?.textContent);

  if (!page.seriesTitle && heading && /(^|\.)crunchyroll\.com$/i.test(location.hostname)) {
    // Crunchyroll puts the show link before the episode heading.
    const seriesLinks = [...document.querySelectorAll('a[href*="/series/"]')]
      .filter((link) => visible(link) && clean(link.innerText)
        && (link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING));
    page.seriesTitle = clean(seriesLinks.at(-1)?.innerText);
  }

  const currentEpisode = document.querySelector(
    '[aria-current="true"][data-episode-number], [aria-current="page"][data-episode-number], [itemprop="episodeNumber"]'
  );
  page.episodeNumber = meta('episodeNumber') || clean(currentEpisode?.dataset.episodeNumber || currentEpisode?.getAttribute('content')
    || currentEpisode?.textContent);
  page.seasonNumber = meta('seasonNumber');

  const videos = [...document.querySelectorAll('video')];
  const playerSize = (el) => {
    const { width, height } = el.getBoundingClientRect();
    return width >= 160 && height >= 90;
  };
  const playingVideo = videos.find((video) => !video.paused && !video.ended && video.readyState >= 2);
  const visibleVideo = playingVideo || videos.find(playerSize);
  const embeddedPlayer = [...document.querySelectorAll('iframe[src]')].find((frame) => (
    playerSize(frame) && (/\b(?:autoplay|fullscreen)\b/i.test(frame.allow)
      || /\/(?:embed|player|watch)(?:[/.?]|$)/i.test(frame.src))
  ));
  page.playing = Boolean(playingVideo);
  page.hasPlayer = Boolean(visibleVideo || embeddedPlayer);
  page.playerTitle = clean(navigator.mediaSession?.metadata?.title || visibleVideo?.title || embeddedPlayer?.title);

  page.jsonLd = [];
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
    if (script.textContent.length > 200000) continue;
    try {
      page.jsonLd.push(JSON.parse(script.textContent));
    } catch {
      // A malformed metadata block should not stop the scan.
    }
  }
  return page;
}

function structuredMedia(documents) {
  const nodes = [];
  const queue = documents.flat().slice(0, 100);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (!node || typeof node !== 'object') continue;
    nodes.push(node);
    for (const child of [node['@graph'], node.mainEntity, node.video]) {
      if (child) queue.push(...[].concat(child).slice(0, 100 - queue.length));
    }
  }
  const byId = new Map(nodes.filter((node) => node['@id']).map((node) => [node['@id'], node]));
  const entity = (value) => {
    const node = [].concat(value || [])[0];
    return node && (node.name || node.seasonNumber != null ? node : byId.get(node['@id']) || node);
  };
  const find = (...names) => nodes.find((node) => [].concat(node['@type'] || []).some(
    (value) => typeof value === 'string' && names.includes(value.split(/[\/#:]/).at(-1))
  ));
  const episode = find('TVEpisode', 'Episode');
  const video = find('VideoObject');
  const season = entity(episode?.partOfSeason || video?.partOfSeason);
  const series = entity(episode?.partOfSeries || episode?.partOfTVSeries || season?.partOfSeries || video?.partOfSeries)
    || (!episode && find('TVSeries', 'CreativeWorkSeries'));
  return { episode, season, series, movie: find('Movie'), video };
}

const episodeMarker = /\b(?:s(?:eason)?[\s_-]*(\d{1,3})[\s_·,:-]*)?(?:episodes?|ep\.?|e)[\s_-]*(\d{1,4}(?:\.\d{1,2})?)\b/i;
const seasonMarker = /\b(?:season[\s_-]*|s)(\d{1,3})\b/i;

function readNumber(value) {
  const text = String(value ?? '').trim();
  return /^\d{1,4}(?:\.\d{1,2})?$/.test(text) ? String(Number(text)) : '';
}

function titleFromLabel(label, brands) {
  let title = label.trim();
  for (const brand of brands) {
    const escaped = brand.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp('[\\s|–—·:-]+' + escaped + '\\s*$', 'i'), '');
    if (title.toLowerCase() === brand.toLowerCase()) return '';
  }
  const match = title.match(episodeMarker);
  if (match) title = title.slice(0, match.index);
  return title.replace(/^watch\s+/i, '').replace(/[\s|–—·,:-]+$/, '').trim();
}

function identifyAnime(page) {
  const url = new URL(page.url);
  const path = url.pathname.split('/').map((segment) => {
    try { return decodeURIComponent(segment).replace(/[-_]/g, ' '); }
    catch { return segment; }
  }).join('/');
  const animeHeaven = /(^|\.)animeheaven\.me$/i.test(url.hostname);
  const crunchyroll = /(^|\.)crunchyroll\.com$/i.test(url.hostname);
  const providerWatch = (animeHeaven && url.pathname === '/gate.php')
    || (crunchyroll && /\/watch\//i.test(url.pathname));
  const providerSeries = (animeHeaven && url.pathname === '/anime.php')
    || (crunchyroll && /\/series\//i.test(url.pathname));
  const watchPath = /\/(?:watch|play|player|stream|episode|video|embed)(?:\/|\.php|$)/i.test(url.pathname);
  const media = structuredMedia(page.jsonLd);
  const labels = [page.episodeLabel, page.heading, page.metaTitle, page.playerTitle, page.pageTitle];
  const episodeMatch = [...labels, path.replace(/\//g, ' ')].map((label) => label.match(episodeMarker)).find(Boolean);
  const episodeNumber = readNumber(media.episode?.episodeNumber) || readNumber(media.video?.episodeNumber)
    || readNumber(page.episodeNumber)
    || readNumber(episodeMatch?.[2]) || readNumber(url.searchParams.get('episode') || url.searchParams.get('ep'));
  const seasonMatch = labels.map((label) => label.match(seasonMarker)).find(Boolean);
  const seasonNumber = readNumber(media.season?.seasonNumber) || readNumber(page.seasonNumber)
    || readNumber(episodeMatch?.[1]) || readNumber(url.searchParams.get('season')) || readNumber(seasonMatch?.[1]);
  const episode = episodeNumber ? 'Episode ' + episodeNumber.padStart(2, '0') : '';
  const season = seasonNumber ? 'Season ' + seasonNumber : '';

  const videoMetadata = page.videoMeta || /^video\./i.test(page.mediaType) || Boolean(media.video);
  const viewing = providerWatch || providerSeries || page.playing
    || ((page.hasPlayer || page.videoMeta) && page.mediaType !== 'article')
    || (watchPath && Boolean(episode || videoMetadata || media.episode || media.movie));
  if (!viewing) {
    return { supported: true, message: 'No player or episode page was detected. Start the video and scan again, or enter the details yourself.' };
  }

  const host = url.hostname.replace(/^www\./i, '');
  const brands = [page.siteName, host, host.split('.')[0], animeHeaven ? 'Anime Heaven' : ''].filter(Boolean);
  const plausibleTitle = (value) => typeof value === 'string' && value.trim().length >= 2
    && value.length <= 180 && /\p{L}/u.test(value)
    && !/^(?:gate|watch|watch online|watch now|home|episode|video|player|(?:\w+ )?video player|sign in|log in|loading|next episode|all episodes)$/i.test(value.trim())
    && !brands.some((brand) => value.trim().toLowerCase() === brand.toLowerCase());

  const seriesPath = path.match(/\/(?:series|anime|show)\/([^/]+)(?:\/|$)/i)?.[1];
  const seriesQuery = url.searchParams.get('series') || url.searchParams.get('anime') || url.searchParams.get('show');
  const movie = Boolean(media.movie || page.mediaType === 'video.movie');
  const episodic = Boolean(episode || media.episode || (!movie && (page.seriesTitle || media.series || providerSeries)));
  const candidates = [media.series?.name, page.seriesTitle, seriesQuery];

  if (episodic) {
    candidates.push(...labels.filter((label) => episodeMarker.test(label)).map((label) => titleFromLabel(label, brands)));
    if (page.episodeNumber && !episodeMarker.test(page.heading)) {
      candidates.push(titleFromLabel(page.heading, brands));
    }
    if (providerSeries) candidates.push(titleFromLabel(page.metaTitle || page.heading || page.pageTitle, brands));
    if (seriesPath && !crunchyroll) candidates.push(titleFromLabel(seriesPath, brands));
    const episodeSlug = path.split('/').find((part) => episodeMarker.test(part));
    if (episodeSlug) candidates.push(titleFromLabel(episodeSlug, brands));
    const watchSlug = path.match(/\/(?:watch|play|stream)\/([^/]+)\/(?:season|episode)(?:[ /\d]|$)/i)?.[1];
    if (watchSlug && !crunchyroll) candidates.push(titleFromLabel(watchSlug, brands));
  } else {
    candidates.push(media.movie?.name, page.playerTitle, media.video?.name,
      ...[page.heading, page.metaTitle, page.pageTitle].map((label) => titleFromLabel(label, brands)));
  }
  const title = candidates.find(plausibleTitle)?.trim();
  if (!title) {
    return { supported: true, episode, season, message: 'The page did not expose a clear title. Enter the title to open the discussion.' };
  }
  const kind = episodic ? 'series' : movie ? 'movie' : 'video';
  return {
    supported: true, title, episode, season, kind,
    message: episode ? 'Episode discussion' : 'Title discussion'
  };
}
