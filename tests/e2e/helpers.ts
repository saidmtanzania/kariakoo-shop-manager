import { expect, type Page } from '@playwright/test';

export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const PASSWORD = 'correct horse battery';

export function uniqueEmail(label: string, project: string): string {
  return `${label}.${project}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Waits for the newest email to an address in Mailpit and returns its link. */
export async function linkFromLatestEmail(
  to: string,
  subject: RegExp,
): Promise<string> {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const body = (await res.json()) as { messages: MailpitSummary[] };
        found = body.messages.find((m) => subject.test(m.Subject));
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`);
  const message = (await res.json()) as { Text: string };
  const link = message.Text.match(/https?:\/\/\S+#token=\S+/)?.[0];
  expect(link, 'email contains a link with a token').toBeTruthy();
  return link!;
}

/** Registers through the UI and confirms the email with the emailed link. */
export async function registerAndVerify(
  page: Page,
  email: string,
  fullName: string,
) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(fullName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();

  const link = await linkFromLatestEmail(email, /confirm your email/i);
  // The email points at the configured web origin; open the same path here.
  const url = new URL(link);
  await page.goto(`${url.pathname}${url.hash}`);
  await expect(page.getByText('Your email is confirmed')).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
