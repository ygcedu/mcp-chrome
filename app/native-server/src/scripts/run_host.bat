@echo off
setlocal enabledelayedexpansion

REM 设置路径
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "LOG_DIR=%SCRIPT_DIR%\logs"
set "NODE_SCRIPT=%SCRIPT_DIR%\index.js"

if not exist "%LOG_DIR%" md "%LOG_DIR%"

REM 生成时间戳
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set "TIMESTAMP=%%i"
set "WRAPPER_LOG=%LOG_DIR%\native_host_wrapper_windows_%TIMESTAMP%.log"
set "STDERR_LOG=%LOG_DIR%\native_host_stderr_windows_%TIMESTAMP%.log"

REM 初始日志记录
echo 包装脚本在 %DATE% %TIME% 被调用 > "%WRAPPER_LOG%"
echo SCRIPT_DIR: %SCRIPT_DIR% >> "%WRAPPER_LOG%"
echo LOG_DIR: %LOG_DIR% >> "%WRAPPER_LOG%"
echo NODE_SCRIPT: %NODE_SCRIPT% >> "%WRAPPER_LOG%"
echo Initial PATH: %PATH% >> "%WRAPPER_LOG%"
echo 用户: %USERNAME% >> "%WRAPPER_LOG%"
echo 当前工作目录: %CD% >> "%WRAPPER_LOG%"

REM Node.js 发现
set "NODE_EXEC="

REM 优先级 1: 安装时的 node 路径
set "NODE_PATH_FILE=%SCRIPT_DIR%\node_path.txt"
echo 检查安装时的 node 路径 >> "%WRAPPER_LOG%"
if exist "%NODE_PATH_FILE%" (
    set /p EXPECTED_NODE=<"%NODE_PATH_FILE%"
    if exist "!EXPECTED_NODE!" (
        set "NODE_EXEC=!EXPECTED_NODE!"
        echo 在 !NODE_EXEC! 找到安装时的 node >> "%WRAPPER_LOG%"
    )
)

REM 优先级 1.5: 回退到相对路径
if not defined NODE_EXEC (
    set "EXPECTED_NODE=%SCRIPT_DIR%\..\..\..\node.exe"
    echo 检查相对路径 >> "%WRAPPER_LOG%"
    if exist "%EXPECTED_NODE%" (
        set "NODE_EXEC=%EXPECTED_NODE%"
        echo 在相对路径找到 node: !NODE_EXEC! >> "%WRAPPER_LOG%"
    )
)

REM 优先级 2: where 命令
if not defined NODE_EXEC (
    echo 尝试 'where node.exe' >> "%WRAPPER_LOG%"
    for /f "delims=" %%i in ('where node.exe 2^>nul') do (
        if not defined NODE_EXEC (
            set "NODE_EXEC=%%i"
            echo 使用 'where' 找到 node: !NODE_EXEC! >> "%WRAPPER_LOG%"
        )
    )
)

REM 优先级 3: 常见路径
if not defined NODE_EXEC (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles%\nodejs\node.exe"
        echo 在 !NODE_EXEC! 找到 node >> "%WRAPPER_LOG%"
    ) else if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
        set "NODE_EXEC=%ProgramFiles(x86)%\nodejs\node.exe"
        echo 在 !NODE_EXEC! 找到 node >> "%WRAPPER_LOG%"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "NODE_EXEC=%LOCALAPPDATA%\Programs\nodejs\node.exe"
        echo 在 !NODE_EXEC! 找到 node >> "%WRAPPER_LOG%"
    )
)

REM 验证
if not defined NODE_EXEC (
    echo 错误: 未找到 Node.js 可执行文件! >> "%WRAPPER_LOG%"
    exit /B 1
)

echo 使用 Node 可执行文件: %NODE_EXEC% >> "%WRAPPER_LOG%"
call "%NODE_EXEC%" -v >> "%WRAPPER_LOG%" 2>>&1

if not exist "%NODE_SCRIPT%" (
    echo 错误: 在 %NODE_SCRIPT% 未找到 Node.js 脚本 >> "%WRAPPER_LOG%"
    exit /B 1
)

echo 执行: "%NODE_EXEC%" "%NODE_SCRIPT%" >> "%WRAPPER_LOG%"
call "%NODE_EXEC%" "%NODE_SCRIPT%" 2>> "%STDERR_LOG%"
set "EXIT_CODE=%ERRORLEVEL%"

echo 退出代码: %EXIT_CODE% >> "%WRAPPER_LOG%"
endlocal
exit /B %EXIT_CODE%