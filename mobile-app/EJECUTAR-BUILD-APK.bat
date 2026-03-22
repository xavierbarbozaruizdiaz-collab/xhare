@echo off
title Build APK Release (LOCAL) - Xhare
cd /d "%~dp0"

echo.
echo Generando APK RELEASE LOCAL (flujo oficial)
echo.
echo Paso 1/2: gradlew clean
echo Paso 2/2: expo run:android --variant release
echo.
pause

pushd android
call gradlew.bat clean
popd
if errorlevel 1 goto :error

call npx expo run:android --variant release
if errorlevel 1 goto :error

echo.
echo APK generado en:
echo   android\app\build\outputs\apk\release\app-release.apk
pause
exit /b 0

:error
echo.
echo ERROR: la build fallo. Revisa el log arriba.
pause
exit /b 1
