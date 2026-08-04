// SPDX-License-Identifier: MPL-2.0
#include "InstallerWindow.h"
#include "Bridge.h"
#include <shlobj.h>

using namespace DuiLib;

CInstallerWindow::CInstallerWindow()
    : m_pPages(NULL)
    , m_pEditPath(NULL)
    , m_pLblPathError(NULL)
    , m_pProgress(NULL)
    , m_pLblPercent(NULL)
    , m_pLblStatus(NULL)
    , m_pLblProgressTitle(NULL)
    , m_pChkDesktop(NULL)
    , m_pChkStartMenu(NULL)
    , m_pChkRemoveData(NULL)
    , m_pChkRun(NULL)
    , m_pBtnClose(NULL)
    , m_pLblFinishTitle(NULL)
    , m_pLblFinishSub(NULL)
    , m_progressActive(false)
{
}

// ------------------------------------------------------------------
// WindowImplBase overrides
// ------------------------------------------------------------------

void CInstallerWindow::InitWindow()
{
    WindowImplBase::InitWindow();

    m_pPages            = static_cast<CAnimationTabLayoutUI*>(m_pm.FindControl(_T("pages")));
    m_pEditPath         = static_cast<CEditUI*>    (m_pm.FindControl(_T("edit_path")));
    m_pLblPathError     = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_path_error")));
    m_pProgress         = static_cast<CProgressUI*>(m_pm.FindControl(_T("pbar")));
    m_pLblPercent       = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_percent")));
    m_pLblStatus        = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_status")));
    m_pLblProgressTitle = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_progress_title")));
    m_pChkDesktop       = static_cast<CCheckBoxUI*>(m_pm.FindControl(_T("chk_desktop")));
    m_pChkStartMenu     = static_cast<CCheckBoxUI*>(m_pm.FindControl(_T("chk_startmenu")));
    m_pChkRemoveData    = static_cast<CCheckBoxUI*>(m_pm.FindControl(_T("chk_removedata")));
    m_pChkRun           = static_cast<CCheckBoxUI*>(m_pm.FindControl(_T("chk_run")));
    m_pBtnClose         = static_cast<CButtonUI*>  (m_pm.FindControl(_T("btn_close")));
    m_pLblFinishTitle   = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_finish_title")));
    m_pLblFinishSub     = static_cast<CLabelUI*>   (m_pm.FindControl(_T("lbl_finish_sub")));

    if (m_pProgress) m_pProgress->SetValue(0);
    if (m_pPages)    m_pPages->SelectItem(PAGE_WELCOME);
}

void CInstallerWindow::Notify(TNotifyUI& msg)
{
    if (msg.sType == _T("click")) {
        CDuiString name = msg.pSender->GetName();

        if (name == _T("btn_close")) {
            if (m_progressActive) return; // disabled during progress
            int cur = m_pPages ? m_pPages->GetCurSel() : PAGE_WELCOME;
            if (cur == PAGE_FINISH)         CompleteFinish(false);
            else if (cur == PAGE_UNINSTALL) CompleteUninstall(false);
            else                            CompleteWizard(false);
            return;
        }
        if (name == _T("btn_min")) {
            ::SendMessageW(m_hWnd, WM_SYSCOMMAND, SC_MINIMIZE, 0);
            return;
        }
        if (name == _T("btn_next"))     { GotoPage(PAGE_DIRECTORY); return; }
        if (name == _T("btn_back"))     { GotoPage(PAGE_WELCOME);   return; }
        if (name == _T("btn_cancel"))   { CompleteWizard(false);    return; }
        if (name == _T("btn_browse"))   { OnBrowse();               return; }
        if (name == _T("btn_install"))  { OnInstallClicked();       return; }
        if (name == _T("btn_uninstall")) {
            ::EnterCriticalSection(&bridge::g_state.lock);
            bridge::g_state.removeUserData =
                (m_pChkRemoveData && m_pChkRemoveData->GetCheck()) ? 1 : 0;
            bridge::g_state.progressText[0] = L'\0';
            ::LeaveCriticalSection(&bridge::g_state.lock);
            if (m_pProgress)      m_pProgress->SetValue(0);
            if (m_pLblPercent)    m_pLblPercent->SetText(_T("0%"));
            if (m_pLblProgressTitle) m_pLblProgressTitle->SetText(_T("正在卸载 AgentSkin"));
            if (m_pLblStatus)     m_pLblStatus->SetText(_T("正在准备…"));
            CompleteUninstall(true);
            GotoPage(PAGE_PROGRESS);
            SetCloseEnabled(false);
            return;
        }
        if (name == _T("btn_cancel_un")) { CompleteUninstall(false); return; }
        if (name == _T("btn_finish")) {
            CompleteFinish(m_pChkRun && m_pChkRun->GetCheck());
            return;
        }
    }
    else if (msg.sType == _T("textchanged")) {
        if (msg.pSender == m_pEditPath && m_pLblPathError) {
            m_pLblPathError->SetText(_T(""));
        }
    }

    WindowImplBase::Notify(msg);
}

void CInstallerWindow::OnFinalMessage(HWND hWnd)
{
    WindowImplBase::OnFinalMessage(hWnd);
    ::PostQuitMessage(0);
    delete this;
}

LRESULT CInstallerWindow::HandleCustomMessage(UINT uMsg, WPARAM wParam, LPARAM lParam, BOOL& bHandled)
{
    switch (uMsg) {
    case WM_AS_SHOW_WIZARD:
        ShowWizardPages();
        bHandled = TRUE;
        return 0;
    case WM_AS_PROGRESS:
        ApplyProgress();
        bHandled = TRUE;
        return 0;
    case WM_AS_SHOW_FINISH:
        ShowFinishPage(wParam == 1);
        bHandled = TRUE;
        return 0;
    case WM_AS_SHOW_UNINSTALL:
        ShowUninstallPage();
        bHandled = TRUE;
        return 0;
    case WM_AS_SHUTDOWN_UI:
        Close();
        bHandled = TRUE;
        return 0;
    default:
        break;
    }
    return WindowImplBase::HandleCustomMessage(uMsg, wParam, lParam, bHandled);
}

LRESULT CInstallerWindow::OnNcHitTest(UINT uMsg, WPARAM wParam, LPARAM lParam, BOOL& bHandled)
{
    // Drag the window by the 48px title bar, excluding the min/close
    // buttons in the top-right corner (they must stay clickable).
    POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
    ::ScreenToClient(m_hWnd, &pt);
    RECT rc;
    ::GetClientRect(m_hWnd, &rc);
    if (pt.y >= 0 && pt.y < 48 && pt.x >= 0 && pt.x < rc.right - 84) {
        bHandled = TRUE;
        return HTCAPTION;
    }
    bHandled = TRUE;
    return HTCLIENT;
}

// ------------------------------------------------------------------
// Message handlers
// ------------------------------------------------------------------

void CInstallerWindow::ShowWizardPages()
{
    m_progressActive = false;
    SetCloseEnabled(true);
    if (m_pEditPath) {
        wchar_t dir[1024] = { 0 };
        ::EnterCriticalSection(&bridge::g_state.lock);
        wcscpy_s(dir, bridge::g_state.defaultDir);
        ::LeaveCriticalSection(&bridge::g_state.lock);
        if (dir[0] != L'\0') m_pEditPath->SetText(dir);
    }
    if (m_pLblPathError) m_pLblPathError->SetText(_T(""));
    if (m_pProgress)     m_pProgress->SetValue(0);
    if (m_pLblPercent)   m_pLblPercent->SetText(_T("0%"));
    if (m_pLblProgressTitle) m_pLblProgressTitle->SetText(_T("正在安装 AgentSkin"));
    if (m_pLblStatus)    m_pLblStatus->SetText(_T("正在准备…"));
    GotoPage(PAGE_WELCOME);
    ShowCentered();
}

void CInstallerWindow::ShowUninstallPage()
{
    m_progressActive = false;
    SetCloseEnabled(true);
    if (m_pProgress)   m_pProgress->SetValue(0);
    if (m_pChkRemoveData) m_pChkRemoveData->SetCheck(false);
    GotoPage(PAGE_UNINSTALL);
    ShowCentered();
}

void CInstallerWindow::ShowFinishPage(bool uninstallMode)
{
    m_progressActive = false;
    SetCloseEnabled(true);
    if (m_pProgress)  m_pProgress->SetValue(100);
    if (uninstallMode) {
        if (m_pLblFinishTitle) m_pLblFinishTitle->SetText(_T("卸载完成"));
        if (m_pLblFinishSub)   m_pLblFinishSub->SetText(_T("AgentSkin 已从你的电脑中移除。"));
        if (m_pChkRun)         m_pChkRun->SetVisible(false);
    } else {
        if (m_pLblFinishTitle) m_pLblFinishTitle->SetText(_T("安装完成"));
        if (m_pLblFinishSub)   m_pLblFinishSub->SetText(_T("AgentSkin 已成功安装到你的电脑。"));
        if (m_pChkRun)       { m_pChkRun->SetVisible(true); m_pChkRun->SetCheck(true); }
    }
    GotoPage(PAGE_FINISH);
    ShowCentered();
}

void CInstallerWindow::ApplyProgress()
{
    int pct;
    wchar_t text[256] = { 0 };
    ::EnterCriticalSection(&bridge::g_state.lock);
    pct = bridge::g_state.progressPct;
    wcscpy_s(text, bridge::g_state.progressText);
    ::LeaveCriticalSection(&bridge::g_state.lock);

    if (pct < 0)   pct = 0;
    if (pct > 100) pct = 100;
    if (m_pProgress) m_pProgress->SetValue(pct);
    if (m_pLblPercent) {
        wchar_t buf[16];
        _snwprintf_s(buf, _countof(buf), _TRUNCATE, L"%d%%", pct);
        m_pLblPercent->SetText(buf);
    }
    if (m_pLblStatus && text[0] != L'\0') m_pLblStatus->SetText(text);
}

// ------------------------------------------------------------------
// UI actions
// ------------------------------------------------------------------

void CInstallerWindow::GotoPage(int idx)
{
    if (m_pPages) m_pPages->SelectItem(idx);
}

void CInstallerWindow::OnBrowse()
{
    wchar_t path[MAX_PATH] = { 0 };
    if (m_pEditPath) {
        CDuiString cur = m_pEditPath->GetText();
        wcsncpy_s(path, cur.GetData(), MAX_PATH - 1);
    }

    BROWSEINFOW bi = { 0 };
    bi.hwndOwner = m_hWnd;
    bi.lpszTitle = L"选择 AgentSkin 安装文件夹";
    bi.ulFlags   = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
    LPITEMIDLIST pidl = ::SHBrowseForFolderW(&bi);
    if (pidl == NULL) return;

    wchar_t picked[MAX_PATH] = { 0 };
    if (::SHGetPathFromIDListW(pidl, picked)) {
        // Light normalization: append \AgentSkin when missing (full
        // validation happens on install click).
        size_t len = wcslen(picked);
        while (len > 0 && picked[len - 1] == L'\\') picked[--len] = L'\0';
        const wchar_t* suffix = L"\\AgentSkin";
        size_t sl = wcslen(suffix);
        if (len <= 3 || _wcsicmp(picked + len - sl < picked ? picked : picked + len - sl, suffix) != 0) {
            if (len + sl < MAX_PATH - 1) wcscat_s(picked, suffix);
        }
        if (m_pEditPath) m_pEditPath->SetText(picked);
    }
    ::CoTaskMemFree(pidl);
}

void CInstallerWindow::OnInstallClicked()
{
    CDuiString input;
    if (m_pEditPath) input = m_pEditPath->GetText();

    wchar_t normalized[1024] = { 0 };
    CDuiString error;
    if (!ValidatePath(input.GetData(), normalized, _countof(normalized), error)) {
        if (m_pLblPathError) m_pLblPathError->SetText(error.GetData());
        return;
    }
    if (m_pLblPathError) m_pLblPathError->SetText(_T(""));
    if (m_pEditPath)     m_pEditPath->SetText(normalized);

    ::EnterCriticalSection(&bridge::g_state.lock);
    wcscpy_s(bridge::g_state.installDir, normalized);
    bridge::g_state.optDesktop   = (m_pChkDesktop   && m_pChkDesktop->GetCheck())   ? 1 : 0;
    bridge::g_state.optStartMenu = (m_pChkStartMenu && m_pChkStartMenu->GetCheck()) ? 1 : 0;
    ::LeaveCriticalSection(&bridge::g_state.lock);

    if (m_pProgress)      m_pProgress->SetValue(0);
    if (m_pLblPercent)    m_pLblPercent->SetText(_T("0%"));
    if (m_pLblProgressTitle) m_pLblProgressTitle->SetText(_T("正在安装 AgentSkin"));
    if (m_pLblStatus)     m_pLblStatus->SetText(_T("正在准备…"));

    CompleteWizard(true);
    GotoPage(PAGE_PROGRESS);
    SetCloseEnabled(false);
}

void CInstallerWindow::CompleteWizard(bool accepted)
{
    ::EnterCriticalSection(&bridge::g_state.lock);
    bridge::g_state.wizardResult = accepted ? 1 : 0;
    ::LeaveCriticalSection(&bridge::g_state.lock);
    ::SetEvent(bridge::g_evtWizardDone);
    if (!accepted) ::ShowWindow(m_hWnd, SW_HIDE);
}

void CInstallerWindow::CompleteUninstall(bool accepted)
{
    ::EnterCriticalSection(&bridge::g_state.lock);
    bridge::g_state.uninstallResult = accepted ? 1 : 0;
    ::LeaveCriticalSection(&bridge::g_state.lock);
    ::SetEvent(bridge::g_evtUninstallDone);
    if (!accepted) ::ShowWindow(m_hWnd, SW_HIDE);
}

void CInstallerWindow::CompleteFinish(bool runApp)
{
    ::EnterCriticalSection(&bridge::g_state.lock);
    bridge::g_state.finishResult = runApp ? 1 : 0;
    ::LeaveCriticalSection(&bridge::g_state.lock);
    ::SetEvent(bridge::g_evtFinishDone);
    ::ShowWindow(m_hWnd, SW_HIDE);
}

void CInstallerWindow::ShowCentered()
{
    CenterWindow();
    ::ShowWindow(m_hWnd, SW_SHOW);
    ::SetWindowPos(m_hWnd, HWND_TOPMOST, 0, 0, 0, 0,
                   SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    ::SetWindowPos(m_hWnd, HWND_NOTOPMOST, 0, 0, 0, 0,
                   SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    ::SetForegroundWindow(m_hWnd);
}

void CInstallerWindow::SetCloseEnabled(bool enabled)
{
    m_progressActive = !enabled;
    if (m_pBtnClose) m_pBtnClose->SetEnabled(enabled);
}

// ------------------------------------------------------------------
// Path policy (mirror of nsis/include/safety.nsh)
// ------------------------------------------------------------------

bool CInstallerWindow::ValidatePath(const wchar_t* input, wchar_t* normalized,
                                    size_t normalizedLen, CDuiString& errorOut)
{
    wchar_t buf[1024] = { 0 };
    if (input) wcsncpy_s(buf, input, _countof(buf) - 1);

    // Trim spaces and trailing backslashes.
    wchar_t* s = buf;
    while (*s == L' ') ++s;
    wchar_t* e = s + wcslen(s);
    while (e > s && (e[-1] == L' ' || e[-1] == L'\\')) --e;
    *e = L'\0';

    if (*s == L'\0') {
        errorOut = L"安装目录不能为空。";
        return false;
    }

    wchar_t path[1024] = { 0 };
    wcscpy_s(path, s);

    // Suffix: must end with \AgentSkin (auto-append).
    size_t len = wcslen(path);
    const wchar_t* suffix = L"\\AgentSkin";
    size_t sl = wcslen(suffix);
    if (len <= 3) {
        wcscat_s(path, suffix);
    } else if (len < sl || _wcsicmp(path + len - sl, suffix) != 0) {
        if (len + sl >= _countof(path) - 1) {
            errorOut = L"安装路径过长。";
            return false;
        }
        wcscat_s(path, suffix);
    }

    // Depth guard (>4 backslashes -> reset to <drive>:\AgentSkin).
    int depth = 0;
    for (const wchar_t* p = path; *p; ++p) {
        if (*p == L'\\') ++depth;
    }
    if (depth > 4 && path[1] == L':') {
        wchar_t driveRoot[16] = { path[0], L':', L'\0' };
        wcscat_s(driveRoot, suffix);
        wcscpy_s(path, driveRoot);
    }

    // C-drive policy: refuse when D-Z drives exist and the target
    // is not already an AgentSkin install.
    if ((path[0] == L'C' || path[0] == L'c') && path[1] == L':') {
        if (!DirLooksOwned(path) && HasPreferredDrive()) {
            errorOut = L"检测到这台电脑还有 D-Z 盘，建议安装到非 C 盘（如 D:\\AgentSkin）。";
            return false;
        }
    }

    // Foreign non-empty directory.
    if (!DirIsEmptyOrMissing(path) && !DirLooksOwned(path)) {
        errorOut = L"所选目录不为空，且不属于 AgentSkin。请选择空文件夹。";
        return false;
    }

    wcscpy_s(normalized, normalizedLen, path);
    return true;
}

bool CInstallerWindow::HasPreferredDrive()
{
    wchar_t root[4] = L"D:\\";
    for (wchar_t c = L'D'; c <= L'Z'; ++c) {
        root[0] = c;
        UINT type = ::GetDriveTypeW(root);
        if (type != DRIVE_NO_ROOT_DIR) return true;
    }
    return false;
}

bool CInstallerWindow::DirLooksOwned(const wchar_t* path)
{
    wchar_t probe[1100];
    _snwprintf_s(probe, _countof(probe), _TRUNCATE, L"%s\\.agentskin-install-root", path);
    if (::GetFileAttributesW(probe) != INVALID_FILE_ATTRIBUTES) return true;
    _snwprintf_s(probe, _countof(probe), _TRUNCATE, L"%s\\AgentSkin.exe", path);
    if (::GetFileAttributesW(probe) != INVALID_FILE_ATTRIBUTES) return true;
    return false;
}

bool CInstallerWindow::DirIsEmptyOrMissing(const wchar_t* path)
{
    wchar_t pattern[1100];
    _snwprintf_s(pattern, _countof(pattern), _TRUNCATE, L"%s\\*", path);
    WIN32_FIND_DATAW fd;
    HANDLE h = ::FindFirstFileW(pattern, &fd);
    if (h == INVALID_HANDLE_VALUE) return true; // missing
    bool hasContent = false;
    do {
        if (wcscmp(fd.cFileName, L".") != 0 && wcscmp(fd.cFileName, L"..") != 0) {
            hasContent = true;
            break;
        }
    } while (::FindNextFileW(h, &fd));
    ::FindClose(h);
    return !hasContent;
}
