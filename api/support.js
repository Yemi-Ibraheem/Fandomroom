function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end('Method not allowed.'); return; }

  const { RESEND_API_KEY: resendKey } = process.env;
  if (!resendKey) { res.statusCode = 503; res.end('Support email is not configured.'); return; }

  let submission;
  try { submission = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { res.statusCode = 400; res.end('Invalid submission.'); return; }

  const types = { suggestion: 'Suggestion', bug: 'Bug report', complaint: 'Complaint' };
  const type = types[submission?.type];
  const message = typeof submission?.message === 'string' ? submission.message.trim() : '';
  const email = typeof submission?.email === 'string' ? submission.email.trim() : '';
  if (!type || message.length < 5 || message.length > 5000 || (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    res.statusCode = 400; res.end('Please check your feedback and try again.'); return;
  }

  const subject = `Fandom Room ${type.toLowerCase()}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#242424;line-height:1.6"><h2>Fandom Room ${escapeHtml(type)}</h2>${email ? `<p><strong>Reply to:</strong> ${escapeHtml(email)}</p>` : ''}<p style="white-space:pre-wrap">${escapeHtml(message)}</p></div>`;
  const text = `Fandom Room ${type}${email ? `\nReply to: ${email}` : ''}\n\n${message}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.NOTIFICATION_FROM_EMAIL || 'Fandom Room <info@fandomroom.com>', to: ['info@fandomroom.com'], ...(email ? { reply_to: email } : {}), subject, html, text })
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Resend rejected Fandom Room support feedback:', response.status, detail);
      res.statusCode = 502; res.end('Could not send your feedback right now.'); return;
    }
    res.statusCode = 202; res.end('Feedback sent.');
  } catch (error) {
    console.error('Could not send Fandom Room support feedback:', error);
    res.statusCode = 502; res.end('Could not send your feedback right now.');
  }
};
