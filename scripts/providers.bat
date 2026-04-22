@echo off
REM OpenChat Provider 管理工具快捷方式

if "%1"=="" goto help

node manage-providers.js %*
goto end

:help
echo.
echo OpenChat Provider 管理工具
echo.
echo 使用方法:
echo   providers list              列出所有服务商
echo   providers add ^<id^> ^<key^>   添加 API Key
echo   providers test ^<id^>         测试连接
echo   providers switch ^<id^>       切换服务商
echo   providers current           查看当前配置
echo   providers help              显示帮助
echo.
echo 示例:
echo   providers add anthropic sk-ant-xxx...
echo   providers test anthropic
echo   providers switch anthropic
echo.

:end
