chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.windowId) return;
  let scan = {
    supported: false,
    title: '',
    episode: '',
    season: '',
    url: tab.url || '',
    site: 'Unsupported page',
    message: 'Open a Crunchyroll or AnimeHeaven page, then click Fandom Room again.'
  };

  try {
    const pageUrl = new URL(tab.url || '');
    const supportedHost = /(^|\.)crunchyroll\.com$/i.test(pageUrl.hostname)
      || /(^|\.)animeheaven\.me$/i.test(pageUrl.hostname);
    if (supportedHost) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const visible = (el) => el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
          const headings = [...document.querySelectorAll('h1, h2')].filter(visible).map((el) => clean(el.innerText));
          const metadata = [...document.querySelectorAll('meta[property="og:title"], meta[name="title"], meta[property="og:description"]')]
            .map((el) => clean(el.content));
          return {
            url: location.href,
            pageTitle: clean(document.title),
            headings,
            metadata,
            bodyText: clean(document.body?.innerText).slice(0, 12000)
          };
        }
      });
      scan = identifyAnime(result, pageUrl.hostname);
    }
  } catch (error) {
    scan.message = error?.message?.includes('Cannot access')
      ? 'Chrome could not read this page. Refresh the tab and click Fandom Room again.'
      : 'Could not scan this page. Refresh it and try again.';
  }

  await chrome.storage.local.set({ currentScan: scan });
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

function identifyAnime(page, hostname) {
  const source = [page.pageTitle, ...page.metadata, ...page.headings, page.url, page.bodyText].join(' ');
  const episodeMatch = source.match(/\b(?:season\s*(\d+)\s*(?:[,·:-]?\s*)?)?(?:episode|ep\.?|e)\s*0*(\d{1,3})\b/i)
    || source.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i);
  let episode = episodeMatch ? `Episode ${String(episodeMatch[2]).padStart(2, '0')}` : '';
  let season = episodeMatch?.[1] ? `Season ${episodeMatch[1]}` : '';

  const titleCandidates = [
    page.pageTitle,
    ...page.metadata,
    ...page.headings,
    decodeURIComponent(new URL(page.url).pathname.split('/').filter(Boolean).pop() || '').replace(/[-_]+/g, ' ')
  ].map((value) => value.replace(/\s*[|–—]\s*(Crunchyroll|AnimeHeaven).*$/i, '').replace(/^watch\s+/i, '').trim());
  const title = titleCandidates.map((value) => {
    const prefix = value.split(/\b(?:season\s*\d+|episode\s*\d+|ep\.?\s*\d+|s\d{1,2}\s*e\d{1,3})\b/i)[0].replace(/[\s|–—,:-]+$/, '').trim();
    return prefix.length >= 2 ? prefix : value;
  }).find((value) => value && !/^(watch|home|episode\b|ep\.?\s*\d|related|recommended|next episode|animeheaven|crunchyroll)$/i.test(value)) || '';
  const site = /crunchyroll/i.test(hostname) ? 'Crunchyroll' : 'AnimeHeaven';

  if (!title) return { supported: true, title: '', episode, season, url: page.url, site, message: 'Page scanned, but no anime title was clear. Open the anime or episode details page and click Fandom Room again.' };
  return { supported: true, title, episode, season, url: page.url, site, message: episode ? 'Episode discussion found' : 'Whole anime discussion found' };
}
