// SPDX-License-Identifier: MPL-2.0
// AgentSkinUI.dll — NSIS <-> DuiLib bridge.
//
// Threading model:
//   The DuiLib window lives on a dedicated UI thread created by
//   StartUIThread(). NSIS calls exports on its own thread; each
//   export posts a message to the UI window and (for interactive
//   steps) blocks on an event until the user responds.
#pragma once

#include <windows.h>
#include <string>

// Custom window messages posted to the DuiLib window.
#define WM_AS_SHOW_WIZARD    (WM_APP + 101)
#define WM_AS_PROGRESS       (WM_APP + 102)
#define WM_AS_SHOW_FINISH    (WM_APP + 103)
#define WM_AS_SHOW_UNINSTALL (WM_APP + 104)
#define WM_AS_SHUTDOWN_UI    (WM_APP + 105)

namespace bridge {

enum UIMode { MODE_INSTALL = 0, MODE_UNINSTALL = 1 };

struct State {
    CRITICAL_SECTION lock;

    // ---- input (written by NSIS thread before posting) ----
    wchar_t skinDir[1024];
    wchar_t defaultDir[1024];
    int     mode;             // UIMode

    // ---- wizard output ----
    int     wizardResult;     // 1 = accepted (INSTALL), 0 = cancelled
    wchar_t installDir[1024];
    int     optDesktop;       // 0/1
    int     optStartMenu;     // 0/1

    // ---- uninstall output ----
    int     uninstallResult;  // 1 = accepted (UNINSTALL), 0 = cancelled
    int     removeUserData;   // 0/1

    // ---- finish output ----
    int     finishResult;     // 1 run app after finishing (install), 0 = close

    // ---- progress input ----
    int     progressPct;      // 0..100
    wchar_t progressText[256];
};

extern State  g_state;
extern DWORD  g_uiThreadId;
extern HANDLE g_hUIThread;
extern HWND   g_hwndUI;
extern HANDLE g_evtUIReady;
extern HANDLE g_evtWizardDone;
extern HANDLE g_evtFinishDone;
extern HANDLE g_evtUninstallDone;

// Create the UI thread and wait for the window.
bool StartUIThread();
// Graceful shutdown + join.
void StopUIThread();
// Forceful last-resort cleanup (NSPIM_UNLOAD path).
void KillUIThread();

// ---- High-level primitives used by the NSIS exports ----
// Returns true on success and writes "Init OK"; on failure returns false
// with a Chinese error string (without the "error:" prefix — the
// exporter adds it).
bool Init(const wchar_t* skinDir, bool uninstallMode, std::wstring& error);
void Shutdown();

// ShowWizard: true = accepted (INSTALL_OUT). Returns user-chosen installDir
// and options, or false (cancelled or error). On error, `error` carries
// a Chinese message.
bool ShowWizard(const wchar_t* defaultDir,
                int  (&outOpts)[2],   // [0]=desktop, [1]=startMenu flags
                std::wstring& outInstallDir,
                std::wstring& error);

bool ShowUninstall(const wchar_t* defaultDir,
                   int& outRemoveUserData,
                   std::wstring& outResult,   // "uninstall" / "cancel"
                   std::wstring& error);

// Non-blocking progress feed.
void SetProgress(int pct, const wchar_t* text);

// ShowFinish: returns true and sets outRunAfterFinish when the user asks
// to run the app after install.
bool ShowFinish(bool uninstallMode, int& outRunAfterFinish, std::wstring& error);

} // namespace bridge
