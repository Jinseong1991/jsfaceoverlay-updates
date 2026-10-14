@echo off
chcp 65001 >nul
rem ===== Jinyu 이미지 생성 (D:\jsfo-gen, 그래픽카드 사용) =====
rem 게임 중이면 그래픽카드 메모리가 부족하니 게임을 끄고 실행하세요.
rem 사용법: 이 파일과 jinyu.json 을 D:\jsfo-gen 에 복사한 뒤 더블클릭.

set HF_HOME=D:\jsfo-gen\hf
set HF_HUB_OFFLINE=1
set REMBG_HOME=D:\jsfo-gen\u2net
set OUT=D:\jsfo-gen\out\jinyu

if not exist "%OUT%" mkdir "%OUT%"

echo [1/2] 이미지 생성 중... (장당 수십 초)
D:\jsfo-gen\venv\Scripts\python.exe D:\jsfo-gen\gen.py D:\jsfo-gen\jinyu.json "%OUT%"
if errorlevel 1 goto :fail

echo [2/2] 마스코트 배경 지우기 (투명 PNG)
D:\jsfo-gen\venv\Scripts\python.exe -c "import glob,os; from rembg import remove,new_session; from PIL import Image; s=new_session('isnet-anime'); [remove(Image.open(f),session=s).save(f[:-4]+'_cut.png') for f in glob.glob(r'%OUT%\jinyu_mascot_*.png') if not f.endswith('_cut.png') and not os.path.exists(f[:-4]+'_cut.png')]"
if errorlevel 1 goto :fail

echo.
echo 완료: %OUT%
echo 마음에 드는 그림을 골라 Claude 에게 올려주세요.
explorer "%OUT%"
pause
exit /b 0

:fail
echo.
echo 오류가 났습니다. 위 메시지를 그대로 Claude 에게 보여주세요.
pause
exit /b 1
