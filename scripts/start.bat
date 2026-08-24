@echo off
chcp 65001 >nul 2>&1
cd /d C:\Users\snowb\Desktop\work\desktop-main

echo ============================================
echo   AgentSkin - Dev Start
echo ============================================
echo.

start "AgentSkin" cmd /k "npx electron-vite dev"

echo AgentSkin is starting in a new window...
echo.
echo Configure CatPaw MCP:
echo   Type: StreamableHTTP
echo   URL:  http://127.0.0.1:3333/mcp
echo.
