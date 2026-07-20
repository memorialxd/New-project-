import { BrowserContext, Page, expect } from '@playwright/test';

export interface E2EUser {
  email: string;
  password: string;
  expectedPath: '/order' | '/store' | '/driver' | '/admin';
}

export const users = {
  customer: {
    email: process.env.E2E_CUSTOMER_EMAIL!,
    password: process.env.E2E_CUSTOMER_PASSWORD!,
    expectedPath: '/order' as const,
  },
  store: {
    email: process.env.E2E_STORE_EMAIL!,
    password: process.env.E2E_STORE_PASSWORD!,
    expectedPath: '/store' as const,
  },
  driver: {
    email: process.env.E2E_DRIVER_EMAIL!,
    password: process.env.E2E_DRIVER_PASSWORD!,
    expectedPath: '/driver' as const,
  },
  driver2: {
    email: process.env.E2E_DRIVER2_EMAIL!,
    password: process.env.E2E_DRIVER2_PASSWORD!,
    expectedPath: '/driver' as const,
  },
};

export async function loginAs(ctx: BrowserContext, user: E2EUser): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/auth');
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/κωδικός/i).fill(user.password);
  await page.getByRole('button', { name: /σύνδεση/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith(user.expectedPath), { timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(user.expectedPath));
  return page;
}
