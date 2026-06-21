/**
 * 尝试方案：使用 Playwright 原生点击 + CDP 点击双重保险
 *
 * 在 attemptTurnstileCdp 函数后添加这个新函数
 */

async function attemptTurnstileNativeClick(page) {
    const frames = page.frames();
    console.log(`>> 尝试原生点击 (检查 ${frames.length} 个 frame)...`);

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        try {
            const frameUrl = frame.url();

            if (!frameUrl.includes('cloudflare') && !frameUrl.includes('turnstile')) {
                continue;
            }

            // 尝试直接在 iframe 中找到并点击 checkbox
            const iframeElement = await frame.frameElement();
            if (!iframeElement) continue;

            // 滚动到视野中
            try {
                await iframeElement.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500);
            } catch (e) { }

            // 尝试用 Playwright 原生点击
            try {
                // 方法 1: 点击 iframe 中心
                const box = await iframeElement.boundingBox();
                if (box) {
                    const centerX = box.x + box.width / 2;
                    const centerY = box.y + box.height / 2;

                    console.log(`>> 原生点击 iframe 中心: (${centerX.toFixed(2)}, ${centerY.toFixed(2)})`);

                    // 先移动鼠标
                    await page.mouse.move(centerX, centerY, { steps: 10 });
                    await page.waitForTimeout(200 + Math.random() * 300);

                    // 点击
                    await page.mouse.click(centerX, centerY, {
                        delay: 80 + Math.random() * 100
                    });

                    console.log('>> ✓ 原生点击完成！');
                    return true;
                }
            } catch (e) {
                console.log('>> 原生点击失败:', e.message);
            }
        } catch (e) { }
    }
    return false;
}

// 使用方法：在登录 Turnstile 检测循环中，先尝试原生点击，如果失败再用 CDP
// 示例：
/*
for (let findAttempt = 0; findAttempt < 30; findAttempt++) {
    // 先尝试原生点击
    let clicked = await attemptTurnstileNativeClick(page);

    // 如果原生点击失败，尝试 CDP
    if (!clicked) {
        clicked = await attemptTurnstileCdp(page);
    }

    if (clicked) {
        // 检测 Success...
    }
}
*/
