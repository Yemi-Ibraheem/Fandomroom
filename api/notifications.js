function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function messageFor(event) {
  const link = event.thread_id
    ? `https://www.fandomroom.com/?thread=${encodeURIComponent(event.thread_id)}`
    : 'https://www.fandomroom.com/';
  const actor = escapeHtml(event.actor_username || 'A Fandom Room member');
  const subject = event.type === 'new_signup'
    ? `New Fandom Room signup: ${event.user_email}`
    : event.type === 'comment_reply'
      ? `${event.actor_username || 'Someone'} replied to your comment`
      : event.type === 'thread_comment'
        ? `${event.actor_username || 'Someone'} commented on your thread`
        : `Your post reached ${event.milestone} likes`;

  let detail;
  if (event.type === 'new_signup') {
    detail = `<p>A new member signed up for Fandom Room.</p><p><strong>Email:</strong> ${escapeHtml(event.user_email)}</p><p><strong>User ID:</strong> ${escapeHtml(event.user_id)}</p>`;
  } else if (event.type === 'comment_reply' || event.type === 'thread_comment') {
    detail = `<p>${actor} ${event.type === 'comment_reply' ? 'replied to your comment' : 'commented on your thread'}:</p><blockquote>${escapeHtml(event.body)}</blockquote>`;
  } else {
    detail = `<p>${actor} brought your post to ${event.milestone} likes.</p><blockquote>${escapeHtml(event.body)}</blockquote>`;
  }

  return { subject, html: `<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Fandom Room</h2>${detail}<p><a href="${link}">Open the discussion</a></p></div>` };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end('Method not allowed.'); return; }

  const secret = process.env.NOTIFICATION_WEBHOOK_SECRET;
  if (!secret || req.headers['x-notification-secret'] !== secret) { res.statusCode = 401; res.end('Unauthorized.'); return; }

  const { RESEND_API_KEY: resendKey } = process.env;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'info@fandomroom.com';
  if (!resendKey) { res.statusCode = 503; res.end('Email notifications are not configured.'); return; }

  let event;
  try { event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { res.statusCode = 400; res.end('Invalid event.'); return; }

  if (!event || typeof event.event_id !== 'string' || !['new_signup', 'thread_comment', 'comment_reply', 'like_milestone'].includes(event.type)) {
    res.statusCode = 400; res.end('Invalid event.'); return;
  }

  const recipient = event.type === 'new_signup' ? adminEmail : event.recipient_email;
  if (!recipient || (event.type !== 'new_signup' && !event.recipient_email)) { res.statusCode = 204; res.end(); return; }
  const { subject, html } = messageFor(event);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `fandomroom-${event.event_id}` },
      body: JSON.stringify({ from: process.env.NOTIFICATION_FROM_EMAIL || 'Fandom Room <info@fandomroom.com>', to: [recipient], subject, html })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Resend rejected a Fandom Room notification:', response.status, detail);
      res.statusCode = 502; res.end('Email provider rejected the notification.'); return;
    }
    res.statusCode = 202; res.end('Notification accepted.');
  } catch (error) {
    console.error('Could not send a Fandom Room notification:', error);
    res.statusCode = 502; res.end('Email delivery failed.');
  }
};
