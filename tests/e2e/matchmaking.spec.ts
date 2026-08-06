import { expect, test } from "@playwright/test";

test("two guests can start a private Pong match", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("/");
  await host.getByTestId("nickname").fill("Laser");
  await host.getByRole("button", { name: /enter multipong/i }).click();
  await host.screenshot({ path: "test-results/lobby.png", fullPage: true });
  await host.getByTestId("create-room").click();
  const code = (await host.locator(".room-code").innerText()).slice(0, 5);

  await guest.goto("/");
  await guest.getByTestId("nickname").fill("Ghost");
  await guest.getByRole("button", { name: /enter multipong/i }).click();
  await guest.getByTestId("room-code-input").fill(code);
  await guest.getByTestId("join-room").click();

  await expect(host.getByTestId("match-view")).toBeVisible();
  await expect(guest.getByTestId("match-view")).toBeVisible();
  await host.screenshot({ path: "test-results/private-match.png", fullPage: true });
  await host.keyboard.down("w");
  await host.waitForTimeout(120);
  await host.keyboard.up("w");

  await hostContext.close();
  await guestContext.close();
});

test("quick match recovers the same seat after a browser reconnect", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  let second = await secondContext.newPage();

  await register(first, "North");
  await register(second, "South");
  await first.getByTestId("quick-match").click();
  await second.getByTestId("quick-match").click();
  await expect(first.getByTestId("match-view")).toBeVisible();
  await expect(second.getByTestId("match-view")).toBeVisible();

  await second.close();
  await expect(first.getByText("Holding the table")).toBeVisible();
  second = await secondContext.newPage();
  await second.goto("/");
  await expect(second.getByTestId("match-view")).toBeVisible();
  await expect(first.getByText("Holding the table")).toBeHidden();

  await firstContext.close();
  await secondContext.close();
});

async function register(page: import("@playwright/test").Page, nickname: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("nickname").fill(nickname);
  await page.getByRole("button", { name: /enter multipong/i }).click();
  await expect(page.getByTestId("quick-match")).toBeVisible();
}
