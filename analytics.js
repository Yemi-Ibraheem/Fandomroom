(() => {
  const consentKey = 'fandomroom:analytics-consent';
  const projectToken = 'phc_sYrgBcfXejtYDqDGB8AdEgqPYN7CUYpMhV7WhuZ9kMQV';
  let initialized = false;
  let booted = false;

  function startAnalytics() {
    if (initialized || localStorage.getItem(consentKey) !== 'accepted') return;
    initialized = true;
    if (booted) {
      window.posthog?.opt_in_capturing({ captureEventName: false });
      return;
    }
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split('.');2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement('script')).type='text/javascript',p.crossOrigin='anonymous',p.async=!0,p.src=s.api_host.replace('.i.posthog.com','-assets.i.posthog.com')+'/static/array.js',(r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],Object.defineProperty(u,'toString',{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e}}),Object.defineProperty(u.people,'toString',{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+' (stub)'}}),o='init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetGroups resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags resetPersonPropertiesForFlags reset resetGroups get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init(projectToken, {
      api_host: 'https://eu.i.posthog.com',
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      disable_session_recording: true,
      persistence: 'localStorage+cookie',
      before_send: event => {
        const properties = event?.properties;
        if (properties) {
          for (const field of ['$current_url', '$referrer', '$initial_referrer', '$initial_current_url']) {
            if (typeof properties[field] !== 'string') continue;
            try {
              const url = new URL(properties[field]);
              properties[field] = `${url.origin}${url.pathname}`;
            } catch { delete properties[field]; }
          }
        }
        return event;
      }
    });
    booted = true;
  }

  function setConsent(value) {
    localStorage.setItem(consentKey, value);
    if (value === 'accepted') startAnalytics();
    else if (window.posthog?.opt_out_capturing) {
      window.posthog.opt_out_capturing();
      window.posthog.reset();
      initialized = false;
    }
    render();
  }

  function render() {
    const existing = document.getElementById('analytics-consent');
    existing?.remove();
    const consent = localStorage.getItem(consentKey);
    if (consent) return;
    const panel = document.createElement('aside');
    panel.id = 'analytics-consent';
    panel.setAttribute('aria-label', 'Analytics preferences');
    panel.innerHTML = '<style>#analytics-consent{position:fixed;z-index:9999;inset:auto 20px 20px 20px;max-width:760px;margin-left:auto;padding:18px 20px;border:1px solid #454b3d;border-radius:12px;background:#181a17;color:#f2f3ec;box-shadow:0 12px 40px #0008;font:14px/1.5 Inter,system-ui,sans-serif}#analytics-consent p{margin:0 0 13px;color:#c5c9bd}#analytics-consent a{color:#d4ff54}#analytics-consent .actions{display:flex;gap:10px;flex-wrap:wrap}#analytics-consent button{border:1px solid #777d6d;border-radius:7px;padding:9px 13px;background:transparent;color:#f2f3ec;font:inherit;font-weight:700}#analytics-consent button[data-accept]{border-color:#d4ff54;background:#d4ff54;color:#11130d}@media(max-width:520px){#analytics-consent{inset:auto 10px 10px;padding:15px}}</style><p>Fandom Room uses PostHog analytics to measure visits and feature use, such as sign-ups and votes. If you accept, PostHog stores an analytics identifier on this device and receives usage events. Session recordings are off. We do not send your email, username, or post text to PostHog. <a href="/privacy.html">Privacy details</a>.</p><div class="actions"><button type="button" data-reject>Reject analytics</button><button type="button" data-accept>Accept analytics</button></div>';
    panel.querySelector('[data-reject]').addEventListener('click', () => setConsent('rejected'));
    panel.querySelector('[data-accept]').addEventListener('click', () => setConsent('accepted'));
    document.body.append(panel);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-cookie-settings]')) {
      event.preventDefault();
      localStorage.removeItem(consentKey);
      render();
      document.getElementById('analytics-consent')?.scrollIntoView({ block: 'nearest' });
    }
  });
  document.addEventListener('fandomroom:analytics', event => {
    if (localStorage.getItem(consentKey) === 'accepted' && window.posthog?.capture) {
      window.posthog.capture(event.detail.name, event.detail.properties || {});
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    startAnalytics();
    render();
  });
  if (document.readyState !== 'loading') {
    startAnalytics();
    render();
  }
  window.FandomRoomAnalytics = {
    capture(name, properties = {}) {
      document.dispatchEvent(new CustomEvent('fandomroom:analytics', { detail: { name, properties } }));
    }
  };
})();
