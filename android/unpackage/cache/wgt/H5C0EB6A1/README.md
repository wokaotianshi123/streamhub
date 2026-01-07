# StreamHub Vision Android (HBuilderX 5+ App)

此目录包含用于生成 Android APP 的文件。本项目采用 React + Vite 构建，通过 HBuilderX 打包为 Hybrid APP。

## 如何生成 Android APP

1. **生成前端资源**：
   在项目根目录运行以下命令，这将把编译好的前端文件（HTML/CSS/JS）输出到 `android/` 目录中。
   ```bash
   npm run build:android
   ```

2. **使用 HBuilderX 打开**：
   - 打开 HBuilderX。
   - 点击“文件” -> “打开目录”，选择本项目下的 `android` 文件夹。
   - 此时 `android` 文件夹会被识别为一个 5+ App 项目（因包含 `manifest.json`）。

3. **运行或打包**：
   - **真机调试**：连接安卓手机，在 HBuilderX 中点击顶部菜单的“运行” -> “运行到手机或模拟器”。
   - **打包 APK**：点击“发行” -> “原生App-云打包”，按照提示进行打包即可。

## 注意事项

- `manifest.json` 是 HBuilderX 的配置文件，请勿删除。
- 执行 `npm run build:android` 时，Vite 会将编译产物覆盖到此文件夹，但配置了 `--emptyOutDir=false` 以防止删除 `manifest.json`。
- 如果遇到 API 请求跨域问题，请确保代码中已正确检测 `Html5Plus` 环境（已在 `utils/api.ts` 中配置）。
