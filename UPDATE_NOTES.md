# Katabump 更新说明 - Cloudflare Turnstile 绕过增强版

## 🔧 更新日期
2026年6月21日

## 📋 更新内容

### 1. **增强的点击验证逻辑**
- ✅ 添加贝塞尔曲线鼠标移动轨迹，模拟真实用户行为
- ✅ 增加点击前的自然悬停时间（150-350ms）
- ✅ 优化点击持续时间（80-180ms），更接近人类操作
- ✅ 添加详细的调试日志，便于排查问题

### 2. **改进的 Turnstile 检测**
- ✅ 支持多种选择器策略查找 checkbox：
  - `input[type="checkbox"]`
  - `input[name="cf-turnstile-response"]`
  - `input.cf-turnstile-response`
  - `[role="checkbox"]`
  - 通用 `input` 元素
- ✅ 同时监听 Shadow DOM 和普通 DOM
- ✅ 添加定期轮询机制，防止 MutationObserver 遗漏
- ✅ 优先检查 Cloudflare/Turnstile 域名的 iframe

### 3. **更详细的调试信息**
- ✅ Frame 检测过程的完整日志
- ✅ Checkbox 坐标计算的详细信息
- ✅ iframe 位置和尺寸信息
- ✅ 鼠标移动和点击过程的状态输出

## 🚀 主要改进

### 原有问题
```javascript
// 旧版：直接点击，缺乏人类行为模拟
await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: clickX,
    y: clickY,
    button: 'left',
    clickCount: 1
});
```

### 新版改进
```javascript
// 新版：模拟真实用户行为
1. 从随机位置开始
2. 沿贝塞尔曲线移动鼠标（25个步骤）
3. 悬停 150-350ms
4. 执行点击（持续 80-180ms）
```

## 📦 更新的文件

1. **renew.js** - Windows 本地运行版本
   - 增强的 `attemptTurnstileCdp()` 函数
   - 新增 `generateBezierPath()` 鼠标轨迹生成
   - 改进的注入脚本 `INJECTED_SCRIPT`

2. **action_renew.js** - GitHub Actions 云端版本
   - 相同的增强逻辑
   - 适配 Linux/Headless 环境

## 🔍 技术细节

### 贝塞尔曲线鼠标移动
```
起始点 → 控制点1 → 控制点2 → 目标点
  ↓         ↓          ↓         ↓
随机偏移   25%位置    75%位置   Checkbox中心
```

### 检测流程
```
1. 页面加载 → 注入脚本到所有 iframe
2. Hook attachShadow → 监听 Shadow DOM 创建
3. 多选择器查找 → 定位 Turnstile checkbox
4. 计算相对位置 → 暴露给 Playwright
5. CDP 点击 → 模拟真实鼠标操作
```

## 📝 使用方法

### 本地运行
```bash
# 1. 安装依赖
npm install

# 2. 配置账号（将 login.json.template 重命名为 login.json）
# 3. 运行脚本
node renew.js
```

### GitHub Actions
- 无需修改配置，直接使用
- 更新后的脚本会自动应用到云端运行

## 🐛 调试建议

如果仍然无法通过验证，查看日志中的这些关键信息：

1. **Frame 检测**
   ```
   >> Checking X frames for Turnstile...
   >> Frame 0: https://challenges.cloudflare.com/...
   ```

2. **Checkbox 发现**
   ```
   >> ✓ Found Turnstile checkbox! Ratios: {xRatio: 0.5, yRatio: 0.5}
   ```

3. **坐标计算**
   ```
   >> Target coordinates: (640.00, 360.00)
   >> Iframe box: x=600.00, y=340.00, w=80.00, h=40.00
   ```

4. **点击执行**
   ```
   >> Simulating human-like mouse movement...
   >> Hovering over checkbox...
   >> Clicking...
   >> ✓ Click sequence completed successfully!
   ```

## ⚠️ 注意事项

1. **本地运行时建议**：
   - 首次运行设置 `HEADLESS = false`，观察浏览器行为
   - 查看 `photo/` 目录中的截图，确认 Turnstile 是否出现

2. **GitHub Actions**：
   - 查看 Actions 日志中的详细输出
   - 下载 Screenshots artifact 查看截图

3. **如果仍然失败**：
   - Cloudflare 可能更新了检测机制
   - 考虑使用代理（设置 `HTTP_PROXY` 环境变量）
   - 增加重试次数（脚本已设置最多 30 次查找尝试）

## 🎯 预期效果

- ✅ 更高的 Turnstile 验证通过率
- ✅ 更少的 "Please complete the captcha" 错误
- ✅ 更详细的调试信息便于排查问题
- ✅ 更自然的浏览器行为，降低被检测风险

## 📞 遇到问题？

如果更新后仍有问题，请提供以下信息：

1. 完整的运行日志
2. `photo/` 或 `screenshots/` 目录中的截图
3. 失败时的具体错误信息
4. 是本地运行还是 GitHub Actions

---

**版本**: v2.0 Enhanced  
**更新者**: Claude Code  
**兼容性**: Windows (本地) / Linux (GitHub Actions)
