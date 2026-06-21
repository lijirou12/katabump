/**
 * 简化版 renew.js - 直接使用 Playwright 启动浏览器
 * 不依赖外部 Chrome，使用 Playwright 内置或指定的浏览器
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs');
const path = require('path');

chromium.use(stealth);

console.log('\n========================================');
console.log('  Katabump 自动续期脚本 v2.0');
console.log('========================================\n');

// 注入脚本
const INJECTED_SCRIPT = `
(function() {
    if (window.self === window.top) return;

    try {
        function getRandomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        let screenX = getRandomInt(800, 1200);
        let screenY = getRandomInt(400, 600);

        Object.defineProperty(MouseEvent.prototype, 'screenX', {
            get: function() { return screenX; },
            configurable: true
        });
        Object.defineProperty(MouseEvent.prototype, 'screenY', {
            get: function() { return screenY; },
            configurable: true
        });
    } catch (e) { }

    function findTurnstileCheckbox(root) {
        const selectors = [
            'input[type="checkbox"]',
            'input[name="cf-turnstile-response"]',
            'input.cf-turnstile-response',
            '[role="checkbox"]',
            'input'
        ];

        for (const selector of selectors) {
            const element = root.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    try {
        const originalAttachShadow = Element.prototype.attachShadow;

        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);

            if (shadowRoot) {
                const checkAndReport = () => {
                    const checkbox = findTurnstileCheckbox(shadowRoot);
                    if (checkbox) {
                        const rect = checkbox.getBoundingClientRect();

                        if (rect.width > 0 && rect.height > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
                            const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                            const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                            window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                            return true;
                        }
                    }
                    return false;
                };

                if (!checkAndReport()) {
                    const observer = new MutationObserver(() => {
                        if (checkAndReport()) observer.disconnect();
                    });
                    observer.observe(shadowRoot, { childList: true, subtree: true });

                    const interval = setInterval(() => {
                        if (checkAndReport()) {
                            clearInterval(interval);
                            observer.disconnect();
                        }
                    }, 500);

                    setTimeout(() => {
                        clearInterval(interval);
                        observer.disconnect();
                    }, 30000);
                }
            }
            return shadowRoot;
        };
    } catch (e) { }

    function checkDocument() {
        const checkbox = findTurnstileCheckbox(document);
        if (checkbox) {
            const rect = checkbox.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const xRatio = (rect.left + rect.width / 2) / window.innerWidth;
                const yRatio = (rect.top + rect.height / 2) / window.innerHeight;
                window.__turnstile_data = { xRatio, yRatio, timestamp: Date.now() };
                return true;
            }
        }
        return false;
    }

    const docInterval = setInterval(() => {
        if (checkDocument()) clearInterval(docInterval);
    }, 500);

    setTimeout(() => clearInterval(docInterval), 30000);
})();
`;

function generateBezierPath(startX, startY, endX, endY, steps = 20) {
    const points = [];
    const cp1x = startX + (endX - startX) * (0.25 + Math.random() * 0.25);
    const cp1y = startY + (endY - startY) * (0.1 + Math.random() * 0.3);
    const cp2x = startX + (endX - startX) * (0.5 + Math.random() * 0.25);
    const cp2y = startY + (endY - startY) * (0.7 + Math.random() * 0.2);

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
        const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;
        points.push({ x, y });
    }
    return points;
}

async function attemptTurnstileCdp(page) {
    const frames = page.frames();
    console.log(`>> 检查 ${frames.length} 个 frame...`);

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
            const frameUrl = frame.url();

            if (!frameUrl.includes('cloudflare') && !frameUrl.includes('turnstile')) {
                continue;
            }

            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log(`>> ✓ 找到 Turnstile checkbox！`);

                const iframeElement = await frame.frameElement();
                if (!iframeElement) continue;

                const box = await iframeElement.boundingBox();
                if (!box) continue;

                const clickX = box.x + (box.width * data.xRatio);
                const clickY = box.y + (box.height * data.yRatio);

                console.log(`>> 目标坐标: (${clickX.toFixed(2)}, ${clickY.toFixed(2)})`);

                const client = await page.context().newCDPSession(page);

                const startX = clickX + (Math.random() - 0.5) * 200;
                const startY = clickY + (Math.random() - 0.5) * 200;

                console.log(`>> 模拟鼠标移动...`);
                const path = generateBezierPath(startX, startY, clickX, clickY, 25);

                for (const point of path) {
                    await client.send('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x: point.x,
                        y: point.y
                    });
                    await new Promise(r => setTimeout(r, 2 + Math.random() * 3));
                }

                console.log(`>> 悬停...`);
                await page.waitForTimeout(150 + Math.random() * 200);

                console.log(`>> 点击...`);
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mousePressed',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                await new Promise(r => setTimeout(r, 80 + Math.random() * 100));

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseReleased',
                    x: clickX,
                    y: clickY,
                    button: 'left',
                    clickCount: 1
                });

                console.log(`>> ✓ 点击完成！`);
                await client.detach();
                return true;
            }
        } catch (e) { }
    }
    return false;
}

function getUsers() {
    try {
        const data = fs.readFileSync(path.join(__dirname, 'login.json'), 'utf8');
        const json = JSON.parse(data);
        return Array.isArray(json) ? json : (json.users || []);
    } catch (e) {
        console.error('读取 login.json 错误:', e.message);
        return [];
    }
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('❌ 未在 login.json 中找到用户');
        return;
    }

    console.log(`📋 找到 ${users.length} 个账号\n`);

    console.log('🚀 启动浏览器...');
    const browser = await chromium.launch({
        headless: false,  // 显示窗口
        channel: 'msedge',  // 使用 Microsoft Edge
        args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    await page.addInitScript(INJECTED_SCRIPT);
    console.log('✓ 注入脚本已加载\n');

    const photoDir = path.join(__dirname, 'photo');
    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n${'='.repeat(50)}`);
        console.log(`处理账号 ${i + 1}/${users.length}: ${user.username.substring(0, 20)}...`);
        console.log('='.repeat(50));

        try {
            // 登录
            await page.goto('https://dashboard.katabump.com/auth/login');
            await page.waitForTimeout(2000);

            console.log('📝 输入账号密码...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);

                // 登录前的 Turnstile
                console.log('🔍 检查登录页 Turnstile...');
                let cdpClickResult = false;
                for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                    cdpClickResult = await attemptTurnstileCdp(page);
                    if (cdpClickResult) {
                        console.log('   >> CDP 点击已发送，等待 Cloudflare 验证...');

                        // 等待验证成功的标志
                        let verifySuccess = false;
                        for (let verifySec = 0; verifySec < 12; verifySec++) {
                            const frames = page.frames();
                            for (const f of frames) {
                                if (f.url().includes('cloudflare')) {
                                    try {
                                        if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                            console.log('   >> ✅ 登录前 Turnstile 验证成功！');
                                            verifySuccess = true;
                                            break;
                                        }
                                    } catch (e) { }
                                }
                            }
                            if (verifySuccess) break;
                            await page.waitForTimeout(1000);
                        }

                        if (verifySuccess) {
                            break; // 验证成功，跳出查找循环
                        } else {
                            console.log('   >> ⚠ 点击后未检测到 Success 标志，继续尝试...');
                            cdpClickResult = false; // 重置，继续查找
                        }
                    }
                    console.log(`   >> [尝试 ${findAttempt + 1}/30] 等待 Turnstile...`);
                    await page.waitForTimeout(1000);
                }

                if (cdpClickResult) {
                    console.log('✓ 登录 Turnstile 已点击，等待验证...');

                    // 等待 Success 标志
                    for (let waitSec = 0; waitSec < 15; waitSec++) {
                        const frames = page.frames();
                        let isSuccess = false;
                        for (const f of frames) {
                            if (f.url().includes('cloudflare')) {
                                try {
                                    if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                        console.log('✅ Turnstile 验证成功！');
                                        isSuccess = true;
                                        break;
                                    }
                                } catch (e) { }
                            }
                        }
                        if (isSuccess) break;
                        await page.waitForTimeout(1000);
                    }
                }

                await page.getByRole('button', { name: 'Login', exact: true }).click();

                // 等待页面跳转
                await page.waitForTimeout(5000);

                // 登录后截图
                const safeUser = user.username.replace(/[^a-z0-9]/gi, '_');
                const loginScreenshot = path.join(photoDir, `${safeUser}_after_login.png`);
                try {
                    await page.screenshot({ path: loginScreenshot, fullPage: true });
                    console.log(`📸 登录后截图: ${loginScreenshot}`);
                } catch (e) { }

                console.log(`📍 当前 URL: ${page.url()}`);

                // 检查密码错误
                try {
                    const errorMsg = page.getByText('Incorrect password or no account');
                    if (await errorMsg.isVisible({ timeout: 3000 })) {
                        console.error(`❌ 登录失败: 密码错误`);
                        continue;
                    }
                } catch (e) { }

            } catch (e) {
                console.log('登录表单交互错误:', e.message);
            }

            console.log('🔍 等待 "See" 链接...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('未找到 "See" 按钮');
                continue;
            }

            // 续期逻辑
            let renewSuccess = false;
            for (let attempt = 1; attempt <= 20; attempt++) {
                let hasCaptchaError = false;

                console.log(`\n[尝试 ${attempt}/20] 寻找 Renew 按钮...`);

                const renewBtn = page.getByRole('button', { name: 'Renew', exact: true }).first();
                try {
                    await renewBtn.waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) { }

                if (await renewBtn.isVisible()) {
                    await renewBtn.click();
                    console.log('✓ Renew 按钮已点击');

                    const modal = page.locator('#renew-modal');
                    try { await modal.waitFor({ state: 'visible', timeout: 5000 }); } catch (e) {
                        console.log('模态框未出现，重试...');
                        continue;
                    }

                    // 鼠标移动
                    try {
                        const box = await modal.boundingBox();
                        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                    } catch (e) { }

                    // 找 Turnstile
                    console.log('🔍 检查模态框 Turnstile...');
                    let cdpClickResult = false;
                    for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
                        cdpClickResult = await attemptTurnstileCdp(page);
                        if (cdpClickResult) {
                            console.log(`   >> CDP 点击已发送，等待 Cloudflare 验证...`);

                            // 等待验证成功的标志
                            let verifySuccess = false;
                            for (let verifySec = 0; verifySec < 12; verifySec++) {
                                const frames = page.frames();
                                for (const f of frames) {
                                    if (f.url().includes('cloudflare')) {
                                        try {
                                            if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                                console.log('   >> ✅ Cloudflare 验证成功！');
                                                verifySuccess = true;
                                                break;
                                            }
                                        } catch (e) { }
                                    }
                                }
                                if (verifySuccess) break;
                                await page.waitForTimeout(1000);
                            }

                            if (verifySuccess) {
                                break; // 验证成功，跳出查找循环
                            } else {
                                console.log('   >> ⚠ 点击后未检测到 Success 标志，继续尝试...');
                                cdpClickResult = false; // 重置，继续查找
                            }
                        }
                        console.log(`   >> [${findAttempt + 1}/30] 等待 Turnstile...`);
                        await page.waitForTimeout(1000);
                    }

                    if (cdpClickResult) {
                        console.log('✅ Turnstile 已验证成功！');
                    } else {
                        console.log('⚠ 未能验证 Turnstile，尝试直接提交...');
                    }

                    // 点击确认
                    const confirmBtn = modal.getByRole('button', { name: 'Renew' });
                    if (await confirmBtn.isVisible()) {
                        // 截图
                        const safeUser = user.username.replace(/[^a-z0-9]/gi, '_');
                        const tsScreenshotName = `${safeUser}_Turnstile_${attempt}.png`;
                        try {
                            await page.screenshot({ path: path.join(photoDir, tsScreenshotName), fullPage: true });
                            console.log(`📸 截图: ${tsScreenshotName}`);
                        } catch (e) { }

                        console.log('✓ 点击确认按钮...');
                        await confirmBtn.click();

                        // 检查错误
                        try {
                            const startVerifyTime = Date.now();
                            while (Date.now() - startVerifyTime < 3000) {
                                if (await page.getByText('Please complete the captcha to continue').isVisible()) {
                                    console.log('⚠️ 验证码错误，刷新重试...');
                                    hasCaptchaError = true;
                                    break;
                                }

                                const notTimeLoc = page.getByText("You can't renew your server yet");
                                if (await notTimeLoc.isVisible()) {
                                    const text = await notTimeLoc.innerText();
                                    const match = text.match(/as of\s+(.*?)\s+\(/);
                                    let dateStr = match ? match[1] : '未知日期';
                                    console.log(`⏳ 暂时无法续期，下次可用时间: ${dateStr}`);
                                    renewSuccess = true;
                                    try {
                                        const closeBtn = modal.getByLabel('Close');
                                        if (await closeBtn.isVisible()) await closeBtn.click();
                                    } catch (e) { }
                                    break;
                                }

                                await page.waitForTimeout(200);
                            }
                        } catch (e) { }

                        if (renewSuccess) break;

                        if (hasCaptchaError) {
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue;
                        }

                        // 检查成功
                        await page.waitForTimeout(2000);
                        if (!await modal.isVisible()) {
                            console.log('✅ 续期成功！');

                            const successShotPath = path.join(photoDir, `${safeUser}_success.png`);
                            try { await page.screenshot({ path: successShotPath, fullPage: true }); } catch (e) { }

                            renewSuccess = true;
                            break;
                        } else {
                            console.log('⚠ 模态框仍打开，刷新重试...');
                            await page.reload();
                            await page.waitForTimeout(3000);
                            continue;
                        }
                    } else {
                        console.log('未找到确认按钮，刷新重试...');
                        await page.reload();
                        await page.waitForTimeout(3000);
                        continue;
                    }

                } else {
                    console.log('未找到 Renew 按钮（可能已续期）');
                    break;
                }
            }

        } catch (err) {
            console.error(`处理账号时出错:`, err.message);
        }

        // 截图
        const safeUsername = user.username.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(photoDir, `${safeUsername}.png`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 最终截图: ${screenshotPath}`);
        } catch (e) { }

        console.log(`✓ 账号处理完成`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 所有账号处理完成！');
    console.log('='.repeat(50));
    console.log(`📂 截图保存在: ${photoDir}`);

    await browser.close();
})();
