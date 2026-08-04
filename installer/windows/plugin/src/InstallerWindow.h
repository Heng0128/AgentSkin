// SPDX-License-Identifier: MPL-2.0
// AgentSkinUI.dll — the single DuiLib window hosting every page:
// welcome -> directory -> progress -> finish, plus the uninstall
// confirm page. Pages are items of an AnimationTabLayout.
#pragma once

#include <UIlib.h>

class CInstallerWindow : public DuiLib::WindowImplBase
{
public:
    CInstallerWindow();

    // ---- WindowImplBase overrides ----
    DuiLib::CDuiString GetSkinFile() override { return _T("main.xml"); }
    LPCTSTR GetWindowClassName() const override { return _T("AgentSkinInstallerUI"); }
    void InitWindow() override;
    void Notify(DuiLib::TNotifyUI& msg) override;
    void OnFinalMessage(HWND hWnd) override;
    LRESULT HandleCustomMessage(UINT uMsg, WPARAM wParam, LPARAM lParam, BOOL& bHandled) override;
    LRESULT OnNcHitTest(UINT uMsg, WPARAM wParam, LPARAM lParam, BOOL& bHandled) override;

private:
    // Page indices inside the TabLayout (must match main.xml order).
    enum PageIndex {
        PAGE_WELCOME   = 0,
        PAGE_DIRECTORY = 1,
        PAGE_PROGRESS  = 2,
        PAGE_FINISH    = 3,
        PAGE_UNINSTALL = 4,
    };

    // Message handlers (called on the UI thread).
    void ShowWizardPages();
    void ShowUninstallPage();
    void ShowFinishPage(bool uninstallMode);
    void ApplyProgress();

    // UI actions.
    void GotoPage(int idx);
    void OnBrowse();
    void OnInstallClicked();
    void CompleteWizard(bool accepted);
    void CompleteUninstall(bool accepted);
    void CompleteFinish(bool runApp);
    void ShowCentered();
    void SetCloseEnabled(bool enabled);

    // Mirrors the NSIS-side path policy (safety.nsh) so the user
    // gets instant feedback; NSIS re-validates authoritative.
    bool ValidatePath(const wchar_t* input, wchar_t* normalized, size_t normalizedLen,
                      DuiLib::CDuiString& errorOut);
    static bool HasPreferredDrive();
    static bool DirLooksOwned(const wchar_t* path);
    static bool DirIsEmptyOrMissing(const wchar_t* path);

private:
    DuiLib::CAnimationTabLayoutUI* m_pPages;
    DuiLib::CEditUI*      m_pEditPath;
    DuiLib::CLabelUI*     m_pLblPathError;
    DuiLib::CProgressUI*  m_pProgress;
    DuiLib::CLabelUI*     m_pLblPercent;
    DuiLib::CLabelUI*     m_pLblStatus;
    DuiLib::CLabelUI*     m_pLblProgressTitle;
    DuiLib::CCheckBoxUI*  m_pChkDesktop;
    DuiLib::CCheckBoxUI*  m_pChkStartMenu;
    DuiLib::CCheckBoxUI*  m_pChkRemoveData;
    DuiLib::CCheckBoxUI*  m_pChkRun;
    DuiLib::CButtonUI*    m_pBtnClose;
    DuiLib::CLabelUI*     m_pLblFinishTitle;
    DuiLib::CLabelUI*     m_pLblFinishSub;
    bool m_progressActive;
};
