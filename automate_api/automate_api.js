const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.config') });

async function automate() {
    const applyReference = process.env.APPLY_REFERENCE || '참고자료';
    const applyPurpose = process.env.APPLY_PURPOSE || '데이터 활용';

    const urlsFile = path.join(__dirname, 'api_urls.txt'); 
    if (!fs.existsSync(urlsFile)) return;
    
    let content = fs.readFileSync(urlsFile, 'utf8');
    if (content.startsWith('\ufeff')) content = content.slice(1);
    const urls = content.split(/\r?\n/).map(u => u.trim()).filter(u => u.startsWith('http'));

    console.log(`🚀 Starting automation for ${urls.length} APIs...`);

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: path.join(process.env.USERPROFILE, '.cache', 'chrome-devtools-mcp', 'chrome-profile'),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000']
    });

    const pages = await browser.pages();
    const mainPage = pages[0]; // 메인 페이지 저장
    
    let alreadyApplied = false;

    // 다이얼로그 핸들러 (브라우저 수준에서 등록)
    browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
            const newPage = await target.page();
            newPage.on('dialog', async dialog => {
                const msg = dialog.message();
                console.log(`💬 Alert: ${msg}`);
                if (msg.includes('이미') || msg.includes('신청을 하였습니다')) {
                    alreadyApplied = true;
                }
                await dialog.accept();
            });
        }
    });

    // 메인 페이지에도 핸들러 등록
    mainPage.on('dialog', async dialog => {
        const msg = dialog.message();
        console.log(`💬 Alert: ${msg}`);
        if (msg.includes('이미') || msg.includes('신청을 하였습니다')) {
            alreadyApplied = true;
        }
        await dialog.accept();
    });

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${new Date().toLocaleTimeString()}] (${i+1}/${urls.length}) ${url}`);
        
        alreadyApplied = false;

        try {
            await mainPage.bringToFront(); // 메인 페이지 활성화
            await mainPage.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // 로그인 체크
            const isOut = await mainPage.evaluate(() => document.body.innerText.includes('로그인') && !document.body.innerText.includes('로그아웃'));
            if (isOut) {
                console.log("👉 로그인이 필요합니다...");
                await mainPage.waitForFunction(() => document.body.innerText.includes('로그아웃'), { timeout: 0 });
                await mainPage.goto(url, { waitUntil: 'networkidle2' });
            }

            // 활용신청 버튼 클릭
            const btnHandle = await mainPage.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.trim() === '활용신청' && el.offsetWidth > 0);
            });

            if (btnHandle.asElement()) {
                console.log("Clicking button...");
                await btnHandle.click();
            } else {
                console.log("⚠️ Button not found.");
                continue;
            }

            // 폼 페이지 대기 및 리다이렉트 감지
            let formPage = null;
            const startTime = Date.now();
            while (Date.now() - startTime < 6000) {
                if (alreadyApplied) break;
                const allPages = await browser.pages();
                formPage = allPages.find(p => p.url().includes('selectDevAcountRequestForm'));
                if (formPage) break;
                if (mainPage.url().includes('selectAcountList')) {
                    alreadyApplied = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            if (formPage) {
                console.log("📝 Filling Form...");
                await formPage.bringToFront();
                await new Promise(r => setTimeout(r, 2000));
                await formPage.evaluate((refText, purposeText) => {
                    const findL = (t) => Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(t));
                    const ref = findL(refText);
                    if (ref) document.getElementById(ref.getAttribute('for'))?.click();
                    const p = document.querySelector('textarea');
                    if (p) p.value = purposeText;
                    const c = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(el => document.querySelector(`label[for="${el.id}"]`)?.textContent.includes('동의합니다'));
                    if (c && !c.checked) c.click();
                    const btn = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.trim() === '활용신청');
                    if (btn) btn.click();
                }, applyReference, applyPurpose);
                await new Promise(r => setTimeout(r, 4000));
                console.log("🚀 Submitted.");
            } else {
                console.log("⏩ Already applied or Redirected.");
            }

            // 🔥 중요: 매 루프 종료 시 메인 페이지를 제외한 모든 탭 닫기
            const currentPages = await browser.pages();
            for (const p of currentPages) {
                if (p !== mainPage) {
                    await p.close().catch(() => {}); // 오류 무시하고 닫기
                }
            }

        } catch (error) {
            console.error(`❗ Error: ${error.message}`);
        }
    }

    console.log("\n✨ Automation Complete.");
    await browser.close();
}

automate();
