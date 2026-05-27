@echo off
setlocal
cd /d "%~dp0"

rem Starts one Python static server that serves both:
rem   - the game     at http://localhost:8081/index.html
rem   - the editor   at http://localhost:8081/editor/    (mounted from
rem                     ..\..\three.js_Editor so the editor shares this
rem                     origin and can save back via /api/save-level).
rem
rem No browser is auto-launched. Open the URLs manually.
rem
rem Prefer the py launcher: it picks the newest installed Python 3,
rem avoiding stale "python" shims (e.g. Anaconda 3.6) that fail on
rem modern syntax.

set PORT=8081

where py >nul 2>&1 && (
  py -3 serve.py
  goto :done
)
where python >nul 2>&1 && (
  python serve.py
  goto :done
)

echo.
echo  Python was not found in PATH. Install Python 3 or run from a terminal:
echo    cd /d "%~dp0"
echo    set PORT=8081
echo    python serve.py
echo.
pause

:done
