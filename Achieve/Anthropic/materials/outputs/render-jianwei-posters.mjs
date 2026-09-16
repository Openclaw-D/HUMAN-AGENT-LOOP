import { chromium } from "file:///C:/Users/22673/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const input = path.resolve("C:/Users/22673/Desktop/Anthropic/outputs/jianwei-architecture-posters-standalone.html");
const outputDir = path.resolve("C:/Users/22673/Desktop/Anthropic/outputs");
const views = ["a", "b", "c", "d", "e"];

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({
  viewport: { width: 736, height: 1200 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
await page.goto(pathToFileURL(input).href, { waitUntil: "load" });

for (const view of views) {
  const frame = page.frameLocator('iframe');
  await frame.locator('[data-panel]').evaluateAll((panels, currentView) => {
    for (const panel of panels) panel.hidden = panel.dataset.panel !== currentView;
  }, view);
  const poster = frame.locator(`[data-panel="${view}"]`);
  await poster.waitFor({ state: "visible" });
  await poster.screenshot({
    path: path.join(outputDir, `jianwei-architecture-poster-${view.toUpperCase()}.png`),
    type: "png",
  });
}

await browser.close();
