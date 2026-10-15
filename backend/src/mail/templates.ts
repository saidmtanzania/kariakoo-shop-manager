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
