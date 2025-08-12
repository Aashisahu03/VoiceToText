@echo off
python -m venv venv
call venv\Scripts\activate.bat
python -m pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
echo.
echo Setup complete! Activate the venv with:
echo    call venv\Scripts\activate.bat
pause
