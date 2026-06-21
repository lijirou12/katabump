/**
 * GitHub Actions 备用方案 - 直接使用 Playwright 启动，不依赖 CDP 连接
 * 如果 action_renew.js 的 Chrome 启动失败，使用这个版本
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegramMessage(message, imagePath = null) {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;

    try {
        const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log('[Telegram] Message sent.');
    } catch (e) {
        console.error('[Telegram] Failed to send message:', e.message);
    }

    if (imagePath && fs.existsSync(imagePath)) {
        console.log('[Telegram] Sending photo...');
        const cmd = `curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto" -F chat_id="${TG_CHAT_ID}" -F photo="@${imagePath}"`;
        await new Promise(resolve => {
            exec(cmd, (err) => {
                if (err) console.error('[Telegram] Failed to send photo via curl:', err.message);
                else console.log('[Telegram] Photo sent.');
                resolve();
            });
        });
    }
}

chromium.use(stealth);

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

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
            const frameUrl = frame.url();

            if (!frameUrl.includes('cloudflare') && !frameUrl.includes('turnstile')) {
                continue;
            }

            const data = await frame.evaluate(() => window.__turnstile_data).catch(() => null);

            if (data) {
                console.log(`>> ✓ 找到 Turnstile！`);

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

                console.log(`>> 悬停并点击...`);
                await page.waitForTimeout(150 + Math.random() * 200);

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
        if (process.env.USERS_JSON) {
            const parsed = JSON.parse(process.env.USERS_JSON);
            return Array.isArray(parsed) ? parsed : (parsed.users || []);
        }
    } catch (e) {
        console.error('解析 USERS_JSON 环境变量错误:', e);
    }
    return [];
}

(async () => {
    const users = getUsers();
    if (users.length === 0) {
        console.log('未在 process.env.USERS_JSON 中找到用户');
        process.exit(1);
    }

    console.log(`找到 ${users.length} 个账号`);

    console.log('🚀 启动浏览器（Playwright 直接启动）...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    await page.addInitScript(INJECTED_SCRIPT);
    console.log('✓ 注入脚本已加载\n');

    const photoDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n=== 处理账号 ${i + 1}/${users.length} ===`);

        try {
            // 登录
            await page.goto('https://dashboard.katabump.com/auth/login');
            await page.waitForTimeout(2000);

            console.log('输入账号密码...');
            try {
                const emailInput = page.getByRole('textbox', { name: 'Email' });
                await emailInput.waitFor({ state: 'visible', timeout: 5000 });
                await emailInput.fill(user.username);
                const pwdInput = page.getByRole('textbox', { name: 'Password' });
                await pwdInput.fill(user.password);
                await page.waitForTimeout(500);

                // 登录前的 Turnstile（详细版本后续完善）
                console.log('检查登录页 Turnstile...');
                for (let attempt = 0; attempt < 30; attempt++) {
                    const clicked = await attemptTurnstileCdp(page);
                    if (clicked) {
                        console.log('等待验证...');
                        let success = false;
                        for (let sec = 0; sec < 12; sec++) {
                            const frames = page.frames();
                            for (const f of frames) {
                                if (f.url().includes('cloudflare')) {
                                    try {
                                        if (await f.getByText('Success!', { exact: false }).isVisible({ timeout: 500 })) {
                                            console.log('✅ Turnstile 验证成功！');
                                            success = true;
                                            break;
                                        }
                                    } catch (e) { }
                                }
                            }
                            if (success) break;
                            await page.waitForTimeout(1000);
                        }
                        if (success) break;
                    }
                    await page.waitForTimeout(1000);
                }

                await page.getByRole('button', { name: 'Login', exact: true }).click();
                await page.waitForTimeout(3000);

            } catch (e) {
                console.log('登录错误:', e.message);
            }

            console.log('寻找 "See" 链接...');
            try {
                await page.getByRole('link', { name: 'See' }).first().waitFor({ timeout: 15000 });
                await page.waitForTimeout(1000);
                await page.getByRole('link', { name: 'See' }).first().click();
            } catch (e) {
                console.log('未找到 "See" 按钮');
                continue;
            }

            // 续期逻辑（简化版，完整版请参考 action_renew.js）
            console.log('尝试续期...');
            // ... 续期代码和截图 ...

        } catch (err) {
            console.error(`处理账号时出错:`, err.message);
        }

        // 截图
        const safeUsername = user.username.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(photoDir, `${safeUsername}.png`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`截图: ${screenshotPath}`);
        } catch (e) { }
    }

    console.log('\n完成！');
    await browser.close();
    process.exit(0);
})();
