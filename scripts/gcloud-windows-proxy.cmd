@echo off
setlocal

if defined GCLOUD_REAL_CMD if exist "%GCLOUD_REAL_CMD%" (
  call "%GCLOUD_REAL_CMD%" %*
  exit /b %ERRORLEVEL%
)

if exist "%ProgramFiles(x86)%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" (
  call "%ProgramFiles(x86)%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" %*
  exit /b %ERRORLEVEL%
)

if exist "%ProgramFiles%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" (
  call "%ProgramFiles%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" %*
  exit /b %ERRORLEVEL%
)

if exist "%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" (
  call "%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" %*
  exit /b %ERRORLEVEL%
)

where gcloud.cmd >nul 2>nul
if not errorlevel 1 (
  call gcloud.cmd %*
  exit /b %ERRORLEVEL%
)

echo Google Cloud CLI nao encontrada pelo proxy seguro. 1>&2
exit /b 1
