# Changelog

## [2.0.0] - 2026-06-21

### 🚀 重大更新：Cloudflare Turnstile 绕过增强

#### 新增功能
- **人类行为模拟**：添加贝塞尔曲线鼠标移动轨迹，模拟真实用户操作
- **自然悬停**：点击前增加 150-350ms 随机悬停时间
- **优化点击时长**：点击持续时间调整为 80-180ms，更接近人类操作
- **多选择器支持**：支持多种 Turnstile checkbox 查找策略
- **双重检测机制**：同时监听 Shadow DOM 和普通 DOM
- **定期轮询**：添加 500ms 轮询机制，防止 MutationObserver 遗漏元素

#### 改进项
- **详细调试日志**：
  - Frame 检测过程的完整输出
  - Checkbox 坐标计算详情
  - iframe 位置和尺寸信息
  - 鼠标移动和点击状态
- **优化 iframe 检测**：优先检查 Cloudflare/Turnstile 域名的 iframe
- **增强注入脚本**：改进 `INJECTED_SCRIPT`，增加容错性和检测成功率

#### 技术细节
- 实现 `generateBezierPath()` 函数，生成自然鼠标移动路径
- 改进 `attemptTurnstileCdp()` 函数，增加详细的状态输出
- 注入脚本支持 5 种不同的选择器策略
- MouseEvent screenX/Y 属性使用 getter 方式覆盖，提高兼容性

#### 文件变更
- `renew.js`: 完整重构点击验证逻辑
- `action_renew.js`: 同步更新，适配 GitHub Actions 环境
- `UPDATE_NOTES.md`: 新增详细更新说明文档

#### 预期效果
- 🎯 显著提高 Turnstile 验证通过率
- 📉 减少 "Please complete the captcha" 错误
- 🔍 更易于调试和问题排查
- 🛡️ 降低被 Cloudflare 检测为自动化的风险

---

## [1.0.0] - Initial Release
- 基础的 Katabump 自动续期功能
- 支持本地 Windows 运行和 GitHub Actions 云端运行
- CDP 协议点击 Cloudflare Turnstile
- 多用户批量续期支持
- Telegram 通知集成
- 代理支持
