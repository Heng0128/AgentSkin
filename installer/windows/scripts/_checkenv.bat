@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x86 -host_arch=x64
where cl
cl 2>&1 | findstr /C:"Version"

