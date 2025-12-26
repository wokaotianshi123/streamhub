# StreamHub Vision

A modern video streaming application built with React and Vite, optimized for Vercel deployment.

## 部署指南 (Deployment Guide)

### 1. 推送到 GitHub
将本项目的所有文件上传/推送到您的 GitHub 仓库。

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <您的仓库地址>
git push -u origin main
```

### 2. 在 Vercel 上导入
1. 登录 [Vercel](https://vercel.com)。
2. 点击 "Add New..." -> "Project"。
3. 选择 "Import Git Repository" 并连接您的 GitHub 账号。
4. 选择刚刚上传的 `streamhub-vision` 仓库。
5. **Framework Preset** 选择 `Vite`。
6. 点击 **Deploy**。

### 3. 配置说明
- 本项目包含一个 Serverless Function (`api/proxy.js`) 用于解决视频源的跨域(CORS)问题。
- `vercel.json` 已经配置好了单页应用(SPA)的路由重写规则。

## 本地开发

```bash
npm install
npm run dev
```
