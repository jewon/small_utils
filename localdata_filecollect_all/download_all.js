/**
 * 공공데이터포털 인허가정보 전국 파일 일괄 다운로드 스크립트
 * - 대상: file.localdata.go.kr 의 인허가정보 카테고리 전체 (195개)
 * - 실행: node download_all.js
 * - 이미 받은 파일은 자동 스킵 (재시작 가능)
 * - BROWSER_RESTART_EVERY: 브라우저를 N개마다 재시작 (메모리 누수 방지)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── 설정 ──────────────────────────────────────────────
const BASE_URL   = 'https://file.localdata.go.kr';
const ENTRY_URL  = `${BASE_URL}/file/hospitals/info`;
const REFERER    = 'https://www.data.go.kr/data/15045025/fileData.do';
const OUTPUT_ROOT = path.join(__dirname, 'downloads');
const DELAY_BETWEEN      = 3000;    // 항목 간 대기 (ms)
const DELAY_ON_RATE_LIMIT = 60000;  // 429 시 대기 (ms)
const MAX_RETRY           = 3;
const BROWSER_RESTART_EVERY = 20;   // N개마다 브라우저 재시작
// ──────────────────────────────────────────────────────

async function createContext(browser) {
  return browser.newContext({
    extraHTTPHeaders: { 'Referer': REFERER },
    acceptDownloads: true
  });
}

async function getItemList(browser) {
  const context = await createContext(browser);
  const page = await context.newPage();
  await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const items = await page.evaluate((baseUrl) => {
    const result = [];
    document.querySelectorAll('.sb-sidenav-menu .nav > .mb-2').forEach(div => {
      const catName = div.querySelector('a > span')?.textContent?.trim() || '';
      if (!catName.startsWith('인허가정보_')) return;
      div.querySelectorAll('.collapse a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href || href === '#') return;
        const slug = href.replace('/file/', '').replace('/info', '');
        result.push({
          category: catName,
          name: a.querySelector('span')?.textContent?.trim() || slug,
          infoUrl: `${baseUrl}${href}`,
          downloadUrl: `${baseUrl}/file/download/${slug}/info`
        });
      });
    });
    return result;
  }, BASE_URL);

  await context.close();
  return items;
}

async function downloadItem(page, item, pending) {
  for (let retry = 0; retry < MAX_RETRY; retry++) {
    pending.data = null;
    pending.filename = null;

    try {
      await page.goto(item.infoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const validateStatus = await page.evaluate(async (base) => {
        const res = await fetch(`${base}/file/validate/download-count`);
        return res.status;
      }, BASE_URL);

      if (validateStatus === 429) {
        console.log(`  -> 속도 제한(429), ${DELAY_ON_RATE_LIMIT/1000}초 대기...`);
        await page.waitForTimeout(DELAY_ON_RATE_LIMIT);
        continue;
      }
      if (validateStatus !== 200) {
        console.log(`  -> validate 오류 ${validateStatus}`);
        return null;
      }

      await page.evaluate((url) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
      }, item.downloadUrl);

      for (let w = 0; w < 30; w++) {
        if (pending.data) break;
        await page.waitForTimeout(1000);
      }

      if (pending.data) return pending;

      console.log(`  -> 데이터 미수신, 재시도 ${retry + 1}/${MAX_RETRY}`);
    } catch (err) {
      console.log(`  -> 오류: ${err.message.slice(0, 80)}, 재시도 ${retry + 1}/${MAX_RETRY}`);
      await page.waitForTimeout(3000);
    }
  }
  return null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const saveDir = path.join(OUTPUT_ROOT, today);
  fs.mkdirSync(saveDir, { recursive: true });

  const logFile = path.join(saveDir, '_download.log');
  const log = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logFile, line + '\n');
  };

  log('=== 다운로드 시작 ===');

  // 목록 수집
  let browser = await chromium.launch({ headless: true });
  const allItems = await getItemList(browser);
  log(`수집된 항목 수: ${allItems.length}개`);

  // 이미 받은 파일 확인
  const existing = new Set(fs.readdirSync(saveDir));
  const todo = allItems.filter(item => {
    const expectedName = `${item.name}.csv`;
    if (existing.has(expectedName)) {
      log(`  [스킵] ${item.name} (이미 존재)`);
      return false;
    }
    return true;
  });
  log(`다운로드 대상: ${todo.length}개 (스킵: ${allItems.length - todo.length}개)`);

  let success = 0, fail = 0;
  let context = await createContext(browser);
  let page = await context.newPage();
  const pending = { data: null, filename: null };

  const setupRoute = async (ctx) => {
    await ctx.route(`${BASE_URL}/file/download/**`, async (route) => {
      const response = await route.fetch();
      const buffer = await response.body();
      const cd = response.headers()['content-disposition'] || '';
      const match = cd.match(/filename\*=UTF-8''(.+?)(?:;|$)/i);
      pending.filename = match ? decodeURIComponent(match[1].trim()) : null;
      pending.data = buffer;
      await route.fulfill({ response });
    });
  };
  await setupRoute(context);

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    log(`[${i+1}/${todo.length}] ${item.name}`);

    // N개마다 브라우저 재시작 (메모리 해제)
    if (i > 0 && i % BROWSER_RESTART_EVERY === 0) {
      log(`--- 브라우저 재시작 (메모리 해제) ---`);
      await context.close();
      await browser.close();
      browser = await chromium.launch({ headless: true });
      context = await createContext(browser);
      page = await context.newPage();
      await setupRoute(context);
    }

    const result = await downloadItem(page, item, pending);

    if (result && result.data) {
      const filename = result.filename || `${item.name}.csv`;
      const savePath = path.join(saveDir, filename);
      fs.writeFileSync(savePath, result.data);
      const kb = (result.data.length / 1024).toFixed(1);
      log(`  -> 저장: ${filename} (${kb} KB)`);
      success++;
    } else {
      log(`  -> 최종 실패: ${item.name}`);
      fail++;
    }

    if (i < todo.length - 1) {
      await page.waitForTimeout(DELAY_BETWEEN);
    }
  }

  log('');
  log('=== 완료 ===');
  log(`성공: ${success}개, 실패: ${fail}개, 스킵: ${allItems.length - todo.length}개`);
  log(`저장 위치: ${saveDir}`);

  await context.close();
  await browser.close();
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
