import { chromium } from 'playwright';

const TARGET_URL = 'https://amoremall.com/kr/ko/aibc/web/';  // 크롤링할 내 페이지
const KEEP_MS = 600000; // 10분 동안 대기

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  // requestId -> url 매핑 (url 보려면 필요)
  const urlByRequestId = new Map<string, string>();

  cdp.on('Network.requestWillBeSent', (e: any) => {
    if (e.type === 'EventSource') {
      urlByRequestId.set(e.requestId, e.request.url);
    }
  });

  // SSE 프레임 도착하면 바로 로그
  cdp.on('Network.eventSourceMessageReceived', (e: any) => {
    const url = urlByRequestId.get(e.requestId) ?? '';
    console.log('[SSE]', url, e.eventName ?? 'message', e.data);
  });

  await page.goto(TARGET_URL, { waitUntil: 'load' });
  await page.waitForTimeout(KEEP_MS);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});