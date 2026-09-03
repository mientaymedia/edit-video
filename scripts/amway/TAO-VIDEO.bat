@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ==========================================================
echo   TAO VIDEO AMWAY - giong doc tieng Viet
echo ==========================================================
echo.
echo Thu muc lam viec: %cd%
echo.

rem ---------- 1. Kiem tra Node ----------
where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js.
  echo       Tai va cai tai: https://nodejs.org  ^(ban LTS^)
  echo       Cai xong dong cua so nay, mo lai file TAO-VIDEO.bat
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node %%v

rem ---------- 2. Kiem tra Python ----------
set PY=
where python >nul 2>&1 && set PY=python
if "%PY%"=="" (
  where py >nul 2>&1 && set PY=py
)
if "%PY%"=="" (
  echo [LOI] Khong tim thay Python.
  echo       Tai va cai tai: https://python.org  ^(nho tick "Add Python to PATH"^)
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('%PY% --version') do echo [OK] %%v
echo.

rem ---------- 3. Cai thu vien Node ----------
if not exist "node_modules" (
  echo [1/4] Cai thu vien Node ^(lan dau mat vai phut^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [LOI] npm install that bai. Kiem tra ket noi mang roi chay lai.
    pause
    exit /b 1
  )
) else (
  echo [1/4] Thu vien Node da co, bo qua.
)
echo.

rem ---------- 4. Cai VieNeu-TTS ----------
echo [2/4] Cai giong doc tieng Viet ^(VieNeu-TTS^)...
%PY% -m pip install --quiet --upgrade vieneu
if errorlevel 1 (
  echo.
  echo [LOI] Khong cai duoc vieneu. Thu chay tay:  %PY% -m pip install vieneu
  pause
  exit /b 1
)
echo [OK] Da cai xong.
echo.

rem ---------- 5. Liet ke giong ----------
echo [3/4] Cac giong tieng Viet dang co ^(dau sao la giong khop yeu cau^):
echo.
call node build.mjs --voices
if errorlevel 1 (
  echo.
  echo [LOI] Khong doc duoc danh sach giong.
  echo       Lan dau chay se tai model khoang 1GB, can mang on dinh.
  echo       Chup man hinh loi nay gui lai de duoc ho tro.
  pause
  exit /b 1
)
echo.

rem ---------- 6. Dung video ----------
echo [4/4] Bat dau dung video. Buoc nay lau nhat - moi video vai phut.
echo       Cu de cua so nay chay, dung tat.
echo.
call node build.mjs --all
if errorlevel 1 (
  echo.
  echo [LOI] Dung video that bai. Chup man hinh loi nay gui lai de duoc ho tro.
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo   XONG. Video nam trong thu muc:  %cd%\out
echo ==========================================================
echo.
echo Truoc khi dang, xem lai tung video mot luot voi danh sach cam
echo trong file README.md ^(muc "Truoc khi dang - bat buoc"^).
echo.
start "" "%cd%\out"
pause
