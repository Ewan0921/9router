# 自建 CLI 产物部署指南

本文说明如何基于本仓库发布定制版 `9router` 安装包，以及如何在 VPS 上安装、运行和回滚。VPS **只安装产物、不在本机构建**。

当前定制版本号：`0.5.69-ewan.1`  
发布 tag 前缀：`cli-v*`（例如 `cli-v0.5.69-ewan.1`）  
工作流：[.github/workflows/cli-release.yml](.github/workflows/cli-release.yml)  
首次产物：[CLI 0.5.69-ewan.1 Release](https://github.com/Ewan0921/9router/releases/tag/cli-v0.5.69-ewan.1)

## 原则

- 用户数据在 `/root/.9router`（主要是 `db/data.sqlite`、`jwt-secret`、`auth/`）。安装或回滚全局包都不会改这个目录。
- **不要**设置 `DATA_DIR`。留空才会使用 `~/.9router`。不要照抄 `.env.example` 里的 `/var/lib/9router`。
- **不要**设置 `JWT_SECRET`。一旦设置，会跳过已有的 `~/.9router/jwt-secret`，所有已登录会话立即失效。
- 启动时必须带 `--skip-update`。否则 CLI 可能提示执行 `npm i -g 9router@latest`，把定制版覆盖成官方版。定制版号带 `-ewan.N` 后缀，semver 上低于官方同号版本，更新检查会认为官方更新。
- Windows 开发必须保持 LF 换行。仓库根目录已有 `.gitattributes`。不要提交 `cli/cli.js` 的 CRLF，否则 Linux 上执行 `9router` 会报 `env: 'node\r': No such file or directory`。

## 日常发布（本机改代码 → GitHub Actions 出包）

1. 在本机改定制功能，提交到 `master`（或你的工作分支并合并进 `master`）。
2. 只改 [`cli/package.json`](cli/package.json) 的 `version`。例如 `0.5.69-ewan.1` → `0.5.69-ewan.2`。`cli/scripts/build-cli.js` 打包时会把该版本同步到根 `package.json`，不必手改两处。
3. 提交版本号变更并推送：

```bash
git add cli/package.json
git commit -m "Release CLI 0.5.69-ewan.2"
git push origin master
```

4. 打 **annotated** tag 并推送。tag 必须是 `cli-v` + 版本号，才能触发 CLI 工作流，且不会误触发 Docker 工作流的 `v*`：

```bash
git tag -a cli-v0.5.69-ewan.2 -m "CLI 0.5.69-ewan.2"
git push origin cli-v0.5.69-ewan.2
```

5. 在 GitHub Actions 中等待 **Build and Release CLI Package**。成功后 Release 页面会出现 `9router-<版本>.tgz`。

也可以在 Actions 页面对该工作流点 **Run workflow**（`workflow_dispatch`）。未推 tag 时，工作流会按 `cli/package.json` 的 version 创建名为 `cli-v<version>` 的 Release；若该 tag 已存在，重复运行会覆盖同一 Release 的附件。

仓库 `.gitignore` 忽略了 `package-lock.json`，工作流使用 `npm install` 而不是 `npm ci`。根目录和 `cli/` 都会装依赖。

## VPS 安装与升级

数据目录保持不动。安装前建议先停服务并备份：

```bash
# 停当前进程（父进程会带走 next-server）
pkill -TERM -f '/usr/lib/node_modules/9router/cli.js' || true

# 备份
tar -czf /root/9router-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /root .9router
```

安装或升级到指定 Release（把版本号换成实际值）：

```bash
npm i -g https://github.com/Ewan0921/9router/releases/download/cli-v0.5.69-ewan.1/9router-0.5.69-ewan.1.tgz
```

`postinstall` 会把 `sql.js` / `better-sqlite3` / `systray2` 预热到 `~/.9router/runtime`。`/usr/bin/9router` 会指向新包。

确认版本：

```bash
9router --version
```

应显示定制版本号，而不是官方的 `0.5.69`。

## 运行

与官方 CLI 相同，但必须带 `--skip-update`：

```bash
9router --tray --skip-update -p 20128
```

- 端口默认 `20128`，监听 `0.0.0.0`。
- 不要设置 `DATA_DIR`、`JWT_SECRET`。
- 需要后台常驻时，用 systemd、tmux 或你现有的启动方式包一层上述命令即可；崩溃重启时同样带上 `--skip-update`。

## 回滚

安装包和数据目录是分开的。回滚全局包不会动用户数据：

```bash
# 回到 npm 官方 0.5.69
npm i -g 9router@0.5.69
9router --tray --skip-update -p 20128
```

或回到上一个自建 Release：

```bash
npm i -g https://github.com/Ewan0921/9router/releases/download/cli-v0.5.69-ewan.1/9router-0.5.69-ewan.1.tgz
```

只有数据损坏时才需要从备份恢复：

```bash
# 先停服务
tar -xzf /root/9router-backup-YYYYMMDD-HHMMSS.tar.gz -C /root
```

本机最近一次全量备份：`/root/9router-backup-20260909-231759.tar.gz`（含 `db/data.sqlite` 约 18MB）。

## 本机不要做的事

- 不要在这台 1 核 / 1GB 内存的 VPS 上跑 `npm run build` 或 `npm run cli:pack`。
- 不要执行 `npm i -g 9router@latest`。
- 不要把构建产物提交进 git。产物只作为 GitHub Release 附件。
