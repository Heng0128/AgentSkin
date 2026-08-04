# SPDX-License-Identifier: MPL-2.0
# Builds AgentSkinUI.dll — the NSIS plugin that hosts the DuiLib UI.
#
# Layout:
#   ./src                plugin sources (Exports/Bridge/InstallerWindow/dllmain)
#   ./src/nsis           NSIS plugin API headers + import lib
#   ./third_party/DuiLib_Ultimate/DuiLib   vendored DuiLib (all .cpp except UILib.cpp)
#
# Why we don't use DuiLib's UILib.cpp: its DllMain would clash with our own.
# We provide dllmain.cpp (which only stores HMODULE) and link the rest of
# the library sources directly into this plugin DLL. That keeps the plugin
# self-contained: a single AgentSkinUI.dll is all NSIS needs to stage.
#
# Usage (from a "Developer PowerShell for VS 2019" prompt, or after vcvars):
#   cmake -S . -B build -G "Visual Studio 16 2019" -A Win32
#   cmake --build build --config MinSizeRel
#
# IMPORTANT: The platform MUST be Win32 (x86), NOT x64.
# NSIS (makensis.exe) is a 32-bit application and can only load
# 32-bit plugin DLLs. Building with -A x64 produces a DLL that NSIS
# cannot load, and the x86-only pluginapi-x86-unicode.lib won't link.
#
# Outputs (per config):
#   build/<CONFIG>/AgentSkinUI.dll
#   build/<CONFIG>/skin/main.xml  (auto-copied post-build)

cmake_minimum_required(VERSION 3.16)
project(AgentSkinUI CXX)

# ---- Compiler / Unicode setup ---------------------------------------------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Always Unicode. The project never builds in MBCS mode.
# UILIB_EXPORTS is required because we compile DuiLib's sources
# directly into this DLL (instead of linking a prebuilt DuiLib.dll).
# Without it, UILIB_API expands to __declspec(dllimport) and every
# static data member definition inside DuiLib hits C2491.
add_compile_definitions(
  UNICODE
  _UNICODE
  _CRT_SECURE_NO_WARNINGS
  _CRT_NON_CONFORMING_SWPRINTFS
  UILIB_EXPORTS
)

# Source files are UTF-8 (ASCII + Chinese string literals). Force
# MSVC to read them as UTF-8 so it doesn't mis-parse Chinese characters
# in string literals (C2001/C4819).
add_compile_options(/utf-8)

# Silence DuiLib noise: C4091 typedef-leftover, C4273 dll-linkage
# inconsistency (DuiLib headers declare UILIB_API but were never
# compiled with UILIB_EXPORTS in this static-sources build), C4828
# (DuiLib's own headers use /source-charset:utf-8 themselves and emit
# non-Unicode byte sequences when we read them with /utf-8),\n# C4505 unreferenced static helper (DuiLib).
add_compile_options(/wd4251 /wd4189 /wd4121 /wd4505 /wd4091 /wd4273 /wd4828)

# ---- DuiLib (vendored, static sources, no UILib.cpp) -----------------------
set(DUI_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../third_party/DuiLib_Ultimate/DuiLib")
if(NOT EXISTS "${DUI_ROOT}/UIlib.h")
  message(FATAL_ERROR "DuiLib vendor tree missing at ${DUI_ROOT}. "
                      "See README for fetch instructions.")
endif()

# Gather every .cpp under DuiLib except:
#   UILib.cpp   — defines DllMain, conflicts with our dllmain.cpp
#   UIFlash.cpp — needs atlcomcli.h (ATL not installed). Its only export
#                 is the Flash ActiveX host; neither the installer nor the
#                 wizard use it, so there's no point shimming it in.
# Note: DragDropImpl.cpp and UIWebBrowser.cpp are included but rely on
# ATL-free shims we ship in src/atlconv.h and src/atlcomcli.h (ATL/MFC
# is not installed on this build box). The shim headers sit earlier in
# the include path than the system include directories, so #include
# <atlconv.h> / <atlcomcli.h> resolve to them.
file(GLOB_RECURSE DUI_CPP LIST_DIRECTORIES false "${DUI_ROOT}/*.cpp")
list(REMOVE_ITEM DUI_CPP
  "${DUI_ROOT}/UILib.cpp"
  "${DUI_ROOT}/Control/UIFlash.cpp"
)

set(DUI_INCLUDE_DIRS
  "${DUI_ROOT}"
  "${DUI_ROOT}/Control"
  "${DUI_ROOT}/Core"
  "${DUI_ROOT}/Layout"
  "${DUI_ROOT}/Utils"
)

# ---- NSIS plugin API -------------------------------------------------------
set(NSIS_API_DIR "${CMAKE_CURRENT_LIST_DIR}/src/nsis")

# ---- The plugin DLL --------------------------------------------------------
add_library(AgentSkinUI SHARED
  src/Exports.cpp
  src/Bridge.cpp
  src/InstallerWindow.cpp
  src/dllmain.cpp
  ${DUI_CPP}
)

target_include_directories(AgentSkinUI PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/src"
  "${DUI_INCLUDE_DIRS}"
  "${NSIS_API_DIR}"
)

target_link_directories(AgentSkinUI PRIVATE "${NSIS_API_DIR}")
target_link_libraries(AgentSkinUI PRIVATE
  pluginapi-x86-unicode.lib
  gdiplus
  comctl32
  Msimg32
  ole32
  oleaut32
  uuid
  winmm
  imm32
)

set_target_properties(AgentSkinUI PROPERTIES
  # Put next to the build config dir so build/<cfg>/AgentSkinUI.dll
  # and the post-copied skin are siblings.
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/$<CONFIG>"
  # Use the shared CRT (/MD). Some upstream .obj/.lib (notably the
  # NSIS pluginapi .lib) embed a #pragma comment(lib,"LIBC.lib")
  # reference to the obsolete single-threaded CRT. That .lib is
  # long gone from modern MSVC toolkits, so LNK1104 fails the link.
  # Punt it and let /MD pull msvcrt.dll instead.
  MSVC_RUNTIME_LIBRARY "MultiThreadedDLL"
  LINK_OPTIONS "/IGNORE:4199"  # suppress LNK4199 if it appears
  # Tell the linker to ignore any LIBC.lib default-lib reference.
)

# LIBC.lib (obsolete single-threaded CRT) is no longer shipped with
# modern MSISVC — drop any stale references so the /MD build links.
# /SAFESEH:NO is required because pluginapi-x86-unicode.lib was
# compiled without Safe Exception Handlers support (LNK2026).
# We cannot recompile it (no source), and SAFESEH is only a
# defense-in-depth feature — the DLL is loaded by the trusted
# NSIS installer process, not exposed to untrusted input.
target_link_options(AgentSkinUI PRIVATE
  /NODEFAULTLIB:LIBC.lib
  /SAFESEH:NO
)

# ---- Auto-copy the UI skin tree next to the DLL ----------------------------
set(SKIN_SRC "${CMAKE_CURRENT_LIST_DIR}/ui/skin")
set(SKIN_DST "${CMAKE_BINARY_DIR}/$<CONFIG>/skin")

add_custom_command(TARGET AgentSkinUI POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          "${SKIN_SRC}" "${SKIN_DST}"
  COMMENT "Copying UI skin directory next to AgentSkinUI.dll"
  VERBATIM
)

