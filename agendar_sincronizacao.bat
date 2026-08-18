@echo off
chcp 65001 > nul
title Agendador de Sincronização Bel Colore — Google Drive

echo ============================================================
echo   Instalador de Sincronização Automática — Bel Colore
echo ============================================================
echo.
echo Este script irá agendar uma tarefa no Windows para verificar
echo e sincronizar o Google Drive a cada 15 minutos automaticamente.
echo.

set SCRIPT_DIR=%~dp0
set SILENT_CMD=wscript.exe "%SCRIPT_DIR%run_silent.vbs"

schtasks /create /tn "BelColore_Drive_Sync" /tr "%SILENT_CMD%" /sc minute /mo 15 /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo ✅ SUCESSO! A tarefa 'BelColore_Drive_Sync' foi agendada.
    echo    O catálogo será sincronizado com o Drive a cada 15 minutos.
    echo ============================================================
) else (
    echo.
    echo ⚠️ Se o agendamento falhou, tente executar este arquivo clicando
    echo    com o botão direito e selecionando "Executar como Administrador".
)

echo.
pause
