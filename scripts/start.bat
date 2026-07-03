@echo off
REM ==========================================
REM AI Video Studio һ�������ű���Windows CMD��
REM ==========================================
REM �÷���˫������ �� �� cmd ��ִ�� scripts\start.bat
REM
REM ְ�𣺼�� Node.js �Ƿ���ã�Ȼ��ί�п�ƽ̨���Ľű���������
REM       �����汾У����������װ������ scripts/lib/run-dev.mjs ͳһ��������
REM ע�⣺���ļ������� GBK ���뱣�棨���� Windows Ĭ�ϴ���ҳ����
REM       ������ UTF-8������ cmd �����롣
REM ==========================================

setlocal

echo.
echo �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
echo   AI Video Studio �� һ������ (Windows)
echo �T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T
echo   ����Ŀ¼: %cd%
echo.

REM ===== ���� 1����� Node.js =====
echo [INFO] [1/2] ��� Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] δ��⵽ Node.js�����Ȱ�װ Node.js v20+��
    echo           ���ص�ַ: https://nodejs.org/zh-cn/download/
    echo           ��ʹ�� nvm-windows: https://github.com/coreybutler/nvm-windows
    echo.
    echo [��ʾ] ��װ��ɺ������´��µ������д��ڣ������б��ű���
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK]   Node: %NODE_VER%

REM ===== Check dependencies (install on first run only) =====
if not exist "%~dp0..\node_modules" (
    echo [INFO] node_modules not found, running npm install...
    pushd "%~dp0.."
    call npm install
    set "NPM_RC=%errorlevel%"
    popd
    if not "%NPM_RC%"=="0" (
        echo.
        echo [ERROR] npm install failed, exit code %NPM_RC%
        echo.
        pause
        exit /b 1
    )
    echo [OK]   Dependencies installed
) else (
    echo [OK]   node_modules exists, skip npm install
)

REM ===== ���� 2��ί�п�ƽ̨���Ľű� =====
echo.
echo [INFO] [2/2] �����������...
echo.

REM %~dp0 ��λ���ű�����Ŀ¼����ĩβ��б�ܣ�
node "%~dp0lib\run-dev.mjs"
set "EXIT_CODE=%errorlevel%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] ����ʧ�ܣ��˳��� %EXIT_CODE%����鿴�Ϸ���־�Ų�
    echo.
    pause
)

endlocal
exit /b %EXIT_CODE%
