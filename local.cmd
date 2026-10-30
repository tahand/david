@echo off
rem Local Docker test environment for Windows. Usage: local.cmd [start|stop|restart|reset|logs|status|admin|psql|help]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local.ps1" %*
