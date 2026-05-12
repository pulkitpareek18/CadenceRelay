/**
 * Always-on visible body unsubscribe link. Skips injection only when the
 * rendered HTML already contains the exact unsubscribe URL we'd add — that
 * way templates using {{unsubscribe_url}} don't get a duplicate, but the
 * "word 'unsubscribe' appears somewhere" loophole that gated the older
 * implementation is closed. Google's bulk-sender rules require a visible,
 * functional opt-out link in the body, regardless of headers.
 *
 * `token` may be either a campaign tracking_token (32 hex) or an HMAC
 * contact unsubscribe token (c_<uuid>.<sig>) — both resolve at the same
 * `/api/v1/t/u/{token}` route.
 */
export function ensureUnsubscribeFooter(html: string, trackingDomain: string, token: string): string {
  const unsubUrl = `${trackingDomain}/api/v1/t/u/${token}`;
  if (html.includes(unsubUrl)) return html;
  const footer = `<div style="text-align:center;padding:20px;font-size:12px;color:#999;">If you no longer want to receive these emails, <a href="${unsubUrl}" style="color:#999;text-decoration:underline;">unsubscribe</a>.</div>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', footer + '</body>');
  }
  return html + footer;
}
