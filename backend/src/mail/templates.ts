import type { MailMessage } from './mail.service.js';

// English only for now; email localization follows the user's language
// preference once it exists (Kiswahili path, AGENTS.md section 4).

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;background:#171717;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#666">Or open this link: ${escapeHtml(action.url)}</p>`
    : '';
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#171717">${body}${button}</div>`;
}

export function verifyEmailMessage(
  to: string,
  name: string,
  url: string,
): MailMessage {
  const lines = [
    `Hello ${name},`,
    'Confirm your email address to finish creating your Kariakoo Shop Manager account. The link expires in 24 hours.',
  ];
  return {
    to,
    subject: 'Confirm your email address',
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Confirm email', url }),
  };
}

export function accountExistsMessage(
  to: string,
  loginUrl: string,
  resetUrl: string,
): MailMessage {
  const lines = [
    'Someone tried to create a Kariakoo Shop Manager account with this email address, but an account already exists.',
    'If it was you, sign in, or reset your password if you have forgotten it. If it was not you, you can ignore this email.',
  ];
  return {
    to,
    subject: 'You already have an account',
    text: `${lines.join('\n\n')}\n\nSign in: ${loginUrl}\nReset password: ${resetUrl}\n`,
    html: layout(lines, { label: 'Sign in', url: loginUrl }),
  };
}

export function passwordResetMessage(to: string, url: string): MailMessage {
  const lines = [
    'We received a request to reset your Kariakoo Shop Manager password. The link expires in 30 minutes and works once.',
    'If you did not ask for this, ignore this email; your password stays the same.',
  ];
  return {
    to,
    subject: 'Reset your password',
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Reset password', url }),
  };
}

export function passwordChangedMessage(to: string): MailMessage {
  const lines = [
    'Your Kariakoo Shop Manager password was just changed and all devices were signed out.',
    'If you did not do this, reset your password immediately and contact support.',
  ];
  return {
    to,
    subject: 'Your password was changed',
    text: lines.join('\n\n'),
    html: layout(lines),
  };
}

export function invitationMessage(
  to: string,
  shopName: string,
  inviterName: string | null,
  url: string,
): MailMessage {
  const lines = [
    `${inviterName ?? 'A shop owner'} invited you to join ${shopName} on Kariakoo Shop Manager.`,
    `Open the link to accept. If you do not have an account yet, create one with this email address (${to}) first. The invitation expires in 7 days and works once.`,
    'If you were not expecting this, you can ignore this email.',
  ];
  return {
    to,
    subject: `Join ${shopName} on Kariakoo Shop Manager`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Accept invitation', url }),
  };
}

/** Dates in subscription emails: day, month and year in East Africa Time. */
function formatDay(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Dar_es_Salaam',
  });
}

export function subscriptionExpiringMessage(
  to: string,
  shopName: string,
  endsAt: Date,
  trial: boolean,
  url: string,
): MailMessage {
  const what = trial ? 'free trial' : 'subscription';
  const lines = [
    `The ${what} for ${shopName} ends on ${formatDay(endsAt)}.`,
    trial
      ? 'Pay for a plan before then to keep recording sales, purchases and stock. After the trial the shop becomes read-only until you pay; nothing is deleted.'
      : 'Pay before then to keep full access. After a short grace period the shop becomes read-only until you pay; nothing is deleted.',
  ];
  return {
    to,
    subject: `${shopName}: your ${what} ends on ${formatDay(endsAt)}`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Open subscription', url }),
  };
}

export function subscriptionExpiredMessage(
  to: string,
  shopName: string,
  graceEndsAt: Date | null,
  url: string,
): MailMessage {
  const lines = [
    graceEndsAt
      ? `The subscription for ${shopName} has ended. You still have full access until ${formatDay(graceEndsAt)}; after that the shop becomes read-only until you pay.`
      : `The free trial for ${shopName} has ended, so the shop is now read-only. You can still view and export your records and record customer debt payments.`,
    'Nothing is deleted. Paying restores full access as soon as the payment is confirmed.',
  ];
  return {
    to,
    subject: `${shopName}: your subscription has ended`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Pay now', url }),
  };
}

export function paymentConfirmedMessage(
  to: string,
  shopName: string,
  planName: string,
  paidUntil: Date,
  url: string,
): MailMessage {
  const lines = [
    `We confirmed your payment for ${planName}. ${shopName} is paid until ${formatDay(paidUntil)}.`,
    'Thank you.',
  ];
  return {
    to,
    subject: `${shopName}: payment confirmed`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Open subscription', url }),
  };
}

export function paymentProblemMessage(
  to: string,
  shopName: string,
  kind: 'failed' | 'reversed',
  note: string | null,
  url: string,
): MailMessage {
  const lines = [
    kind === 'failed'
      ? `A payment for ${shopName} could not be confirmed.`
      : `A payment for ${shopName} was reversed, so the time it paid for was removed.`,
    ...(note ? [`Reason: ${note}`] : []),
    'Check the reference and try again, or contact support if you believe this is wrong.',
  ];
  return {
    to,
    subject: `${shopName}: payment ${kind === 'failed' ? 'not confirmed' : 'reversed'}`,
    text: `${lines.join('\n\n')}\n\n${url}\n`,
    html: layout(lines, { label: 'Open subscription', url }),
  };
}
