@echo off
rem ============================================================
rem 食有灵 FOOD SOUL —— 一条命令完成「提交 + 部署 + GitHub 同步」
rem 用法：
rem   ship.cmd -m "feat: 这次改了什么"
rem   ship.cmd                       发布当前 HEAD（工作区必须干净）
rem   ship.cmd --status              查看服务器上一次部署结果
rem   ship.cmd --setup               首次接管服务器（幂等）
rem 说明：Windows 上 PowerShell 可能禁止运行 npm.ps1，
rem       这个包装脚本直接调用 node，不受执行策略影响。
rem ============================================================
node "%~dp0scripts\ship.mjs" %*