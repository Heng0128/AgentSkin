// SPDX-License-Identifier: MPL-2.0
#include "Bridge.h"
#include "InstallerWindow.h"
#include <UIlib.h>

extern HMODULE g_hModule; // dllmain.cpp

namespace bridge {

State  g_state;
DWORD  g_uiThreadId      = 0;
HANDLE g_hUIThread       = NULL;
HWND   g_hwndUI          = NULL;
HANDLE g_evtUIReady      = NULL;
HANDLE g_evtWizardDone   = NULL;
HANDLE g_evtFinishDone   = NULL;
HANDLE g_evtUninstallDone = NULL;

static bool s_inited = false;

static void EnsureState()
{
    if (s_inited) return;
    ::InitializeCriticalSection(&g_state.lock);
    g_evtUIReady       = ::CreateEventW(NULL, TRUE, FALSE, NULL);
    g_evtWizardDone    = ::CreateEventW(NULL, TRUE, FALSE, NULL);
    g_evtFinishDone    = ::CreateEventW(NULL, TRUE, FALSE, NULL);
    g_evtUninstallDone = ::CreateEventW(NULL, TRUE, FALSE, NULL);
    g_state.mode          = MODE_INSTALL;
    g_state.wizardResult  = 0;
    g_state.uninstallResult = 0;
    g_state.finishResult  = 0;
    g_state.optDesktop    = 1;
    g_state.optStartMenu  = 1;
    g_state.removeUserData = 0;
    g_state.progressPct   = 0;
    g_state.skinDir[0]    = L'\0';
    g_state.defaultDir[0] = L'\0';
    g_state.installDir[0] = L'\0';
    g_state.progressText[0] = L'\0';
    s_inited = true;
}

static DWORD WINAPI UIThreadProc(LPVOID /*lpParam*/)
{
    ::CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    g_uiThreadId = ::GetCurrentThreadId();

    DuiLib::CPaintManagerUI::SetInstance(g_hModule);
    DuiLib::CPaintManagerUI::SetResourceType(DuiLib::UILIB_FILE);
    DuiLib::CPaintManagerUI::SetResourcePath(g_state.skinDir);

    CInstallerWindow* pWnd = new CInstallerWindow();
    // Start hidden: the window appears on the first Show* message.
    DWORD dwStyle = (UI_WNDSTYLE_FRAME & ~WS_VISIBLE);
    pWnd->Create(NULL, _T("AgentSkin"), dwStyle, WS_EX_APPWINDOW,
                 0, 0, 720, 520, NULL);
    g_hwndUI = pWnd->GetHWND();
    ::SetEvent(g_evtUIReady);

    DuiLib::CPaintManagerUI::MessageLoop();

    // The window deletes itself inside OnFinalMessage.
    g_hwndUI = NULL;
    ::CoUninitialize();
    return 0;
}

bool StartUIThread()
{
    EnsureState();
    if (g_hUIThread != NULL) return true;

    ::ResetEvent(g_evtUIReady);
    g_hUIThread = ::CreateThread(NULL, 0, UIThreadProc, NULL, 0, NULL);
    if (g_hUIThread == NULL) return false;

    DWORD wr = ::WaitForSingleObject(g_evtUIReady, 15000);
    if (wr != WAIT_OBJECT_0) {
        KillUIThread();
        return false;
    }
    return true;
}

void StopUIThread()
{
    if (g_hUIThread == NULL) return;
    if (g_hwndUI != NULL) {
        ::PostMessageW(g_hwndUI, WM_AS_SHUTDOWN_UI, 0, 0);
    }
    ::WaitForSingleObject(g_hUIThread, 5000);
    ::CloseHandle(g_hUIThread);
    g_hUIThread  = NULL;
    g_uiThreadId = 0;
    g_hwndUI     = NULL;
}

void KillUIThread()
{
    if (g_hUIThread == NULL) return;
    if (g_hwndUI != NULL) {
        ::PostMessageW(g_hwndUI, WM_AS_SHUTDOWN_UI, 0, 0);
        DWORD wr = ::WaitForSingleObject(g_hUIThread, 1000);
        if (wr == WAIT_OBJECT_0) {
            ::CloseHandle(g_hUIThread);
            g_hUIThread = NULL;
            return;
        }
    }
    ::TerminateThread(g_hUIThread, 0);
    ::CloseHandle(g_hUIThread);
    g_hUIThread  = NULL;
    g_uiThreadId = 0;
    g_hwndUI     = NULL;
}

// ------------------------------------------------------------------
// High-level primitives
// ------------------------------------------------------------------

bool Init(const wchar_t* skinDir, bool uninstallMode, std::wstring& error)
{
    EnsureState();
    if (!skinDir || skinDir[0] == L'\0') {
        error = L"皮肤目录路径为空";
        return false;
    }
    // Probe the skin directory: main.xml must exist.
    wchar_t probe[1100];
    _snwprintf_s(probe, _countof(probe), _TRUNCATE, L"%s\\main.xml", skinDir);
    if (::GetFileAttributesW(probe) == INVALID_FILE_ATTRIBUTES) {
        error = L"皮肤目录中缺少 main.xml";
        return false;
    }

    ::EnterCriticalSection(&g_state.lock);
    wcscpy_s(g_state.skinDir, skinDir);
    g_state.mode = uninstallMode ? MODE_UNINSTALL : MODE_INSTALL;
    g_state.wizardResult = 0;
    g_state.uninstallResult = 0;
    g_state.finishResult = 0;
    g_state.optDesktop = 1;
    g_state.optStartMenu = 1;
    g_state.removeUserData = 0;
    g_state.progressPct = 0;
    g_state.progressText[0] = L'\0';
    ::LeaveCriticalSection(&g_state.lock);

    if (!StartUIThread()) {
        error = L"无法启动界面线程";
        return false;
    }
    return true;
}

void Shutdown()
{
    StopUIThread();
}

bool ShowWizard(const wchar_t* defaultDir,
                int  (&outOpts)[2],
                std::wstring& outInstallDir,
                std::wstring& error)
{
    EnsureState();
    if (g_hwndUI == NULL) {
        error = L"界面未初始化";
        return false;
    }
    ::EnterCriticalSection(&g_state.lock);
    if (defaultDir) wcscpy_s(g_state.defaultDir, defaultDir);
    g_state.wizardResult = 0;
    g_state.installDir[0] = L'\0';
    ::ResetEvent(g_evtWizardDone);
    ::LeaveCriticalSection(&g_state.lock);

    if (!::PostMessageW(g_hwndUI, WM_AS_SHOW_WIZARD, 0, 0)) {
        error = L"无法发送向导消息";
        return false;
    }
    DWORD wr = ::WaitForSingleObject(g_evtWizardDone, 300000); // 5 min
    if (wr != WAIT_OBJECT_0) {
        error = L"向导等待超时";
        return false;
    }

    ::EnterCriticalSection(&g_state.lock);
    int result = g_state.wizardResult;
    outInstallDir = g_state.installDir;
    outOpts[0] = g_state.optDesktop;
    outOpts[1] = g_state.optStartMenu;
    ::LeaveCriticalSection(&g_state.lock);

    return result != 0;
}

bool ShowUninstall(const wchar_t* defaultDir,
                   int& outRemoveUserData,
                   std::wstring& outResult,
                   std::wstring& error)
{
    EnsureState();
    if (g_hwndUI == NULL) {
        error = L"界面未初始化";
        return false;
    }
    ::EnterCriticalSection(&g_state.lock);
    if (defaultDir) wcscpy_s(g_state.defaultDir, defaultDir);
    g_state.uninstallResult = 0;
    g_state.removeUserData = 0;
    ::ResetEvent(g_evtUninstallDone);
    ::LeaveCriticalSection(&g_state.lock);

    if (!::PostMessageW(g_hwndUI, WM_AS_SHOW_UNINSTALL, 0, 0)) {
        error = L"无法发送卸载消息";
        return false;
    }
    DWORD wr = ::WaitForSingleObject(g_evtUninstallDone, 300000);
    if (wr != WAIT_OBJECT_0) {
        error = L"卸载确认等待超时";
        return false;
    }

    ::EnterCriticalSection(&g_state.lock);
    int result = g_state.uninstallResult;
    outRemoveUserData = g_state.removeUserData;
    ::LeaveCriticalSection(&g_state.lock);

    outResult = (result != 0) ? L"uninstall" : L"cancel";
    return result != 0;
}

void SetProgress(int pct, const wchar_t* text)
{
    EnsureState();
    if (g_hwndUI == NULL) return;
    ::EnterCriticalSection(&g_state.lock);
    g_state.progressPct = pct;
    if (text) wcscpy_s(g_state.progressText, text);
    else g_state.progressText[0] = L'\0';
    ::LeaveCriticalSection(&g_state.lock);
    ::PostMessageW(g_hwndUI, WM_AS_PROGRESS, 0, 0);
}

bool ShowFinish(bool uninstallMode, int& outRunAfterFinish, std::wstring& error)
{
    EnsureState();
    if (g_hwndUI == NULL) {
        error = L"界面未初始化";
        return false;
    }
    ::EnterCriticalSection(&g_state.lock);
    g_state.finishResult = 0;
    ::ResetEvent(g_evtFinishDone);
    ::LeaveCriticalSection(&g_state.lock);

    if (!::PostMessageW(g_hwndUI, WM_AS_SHOW_FINISH, uninstallMode ? 1 : 0, 0)) {
        error = L"无法发送完成消息";
        return false;
    }
    DWORD wr = ::WaitForSingleObject(g_evtFinishDone, 300000);
    if (wr != WAIT_OBJECT_0) {
        error = L"完成页等待超时";
        return false;
    }

    ::EnterCriticalSection(&g_state.lock);
    int result = g_state.finishResult;
    ::LeaveCriticalSection(&g_state.lock);

    outRunAfterFinish = result;
    return true;
}

} // namespace bridge
