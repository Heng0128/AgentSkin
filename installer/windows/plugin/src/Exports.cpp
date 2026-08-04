// SPDX-License-Identifier: MPL-2.0
// AgentSkinUI.dll — NSIS plugin exports.
//
// Each export has the NSIS plugin signature:
//   void __declspec(dllexport) Name(HWND, int, TCHAR*, stack_t**)
// On the Unicode build (this DLL) TCHAR == wchar_t, and the helpers
// popstring / pushstring / setuservariant from pluginapi.h work on
// wide strings.
//
// Return values are pushed wide strings; NSIS pops them as $R0.
#include <windows.h>
#include "nsis/pluginapi.h"
#include "Bridge.h"

static std::wstring PopString()
{
    // g_stringsize is the wide-char capacity (NOT bytes) on Unicode.
    std::wstring s;
    s.resize(g_stringsize);
    popstring(&s[0]);
    // popstring writes a null terminator; trim the spare buffer.
    s.resize(wcslen(s.c_str()));
    return s;
}

static void PushString(const wchar_t* s)
{
    pushstring(const_cast<LPWSTR>(s));
}

static bool VarToInt(const std::wstring& s, int& out)
{
    if (s.empty()) return false;
    wchar_t* end = NULL;
    long v = wcstol(s.c_str(), &end, 10);
    if (end == s.c_str()) return false;
    out = (int)v;
    return true;
}

extern "C" {

__declspec(dllexport)
void Init(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    std::wstring skinDir = PopString();
    std::wstring mode    = PopString();

    std::wstring error;
    bool uninstallMode = (mode == L"uninstall");
    bool ok = bridge::Init(skinDir.c_str(), uninstallMode, error);
    if (!ok) {
        std::wstring msg = std::wstring(L"error:") + error;
        PushString(msg.c_str());
    } else {
        PushString(L"ok");
    }
}

__declspec(dllexport)
void Shutdown(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    bridge::Shutdown();
    PushString(L"ok");
}

__declspec(dllexport)
void ShowWizard(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    std::wstring defaultDir = PopString();

    int opts[2] = { 0, 0 };
    std::wstring installDir;
    std::wstring error;
    bool accepted = bridge::ShowWizard(defaultDir.c_str(), opts, installDir, error);

    if (!accepted) {
        if (!error.empty()) PushString(std::wstring(L"error:" + error).c_str());
        else                PushString(L"cancel");
        return;
    }
    // Encode the result as a single packed string; NSIS splits on '|'.
    // Format: "install|<dir>|<desktop>|<startmenu>"
    wchar_t buf[4096];
    _snwprintf_s(buf, _countof(buf), _TRUNCATE,
                 L"install|%s|%d|%d",
                 installDir.c_str(), opts[0], opts[1]);
    PushString(buf);
}

__declspec(dllexport)
void SetProgress(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    std::wstring pctS  = PopString();
    std::wstring text  = PopString();
    int pct = 0;
    VarToInt(pctS, pct);
    if (pct < 0)   pct = 0;
    if (pct > 100) pct = 100;
    bridge::SetProgress(pct, text.c_str());
    PushString(L"ok");
}

__declspec(dllexport)
void ShowFinish(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    std::wstring mode = PopString();
    bool uninstallMode = (mode == L"uninstall");
    int runAfterFinish = 0;
    std::wstring error;
    bool ok = bridge::ShowFinish(uninstallMode, runAfterFinish, error);
    if (!ok) {
        PushString(std::wstring(L"error:" + error).c_str());
        return;
    }
    PushString(runAfterFinish ? L"run" : L"close");
}

__declspec(dllexport)
void ShowUninstall(HWND hwndParent, int string_size, TCHAR* variables, stack_t** stacktop)
{
    EXDLL_INIT();
    std::wstring defaultDir = PopString();

    int removeData = 0;
    std::wstring result;
    std::wstring error;
    bool accepted = bridge::ShowUninstall(defaultDir.c_str(), removeData, result, error);

    if (!accepted) {
        if (!error.empty()) PushString(std::wstring(L"error:" + error).c_str());
        else                PushString(L"cancel");
        return;
    }
    // Format: "uninstall|<removeUserData>"
    wchar_t buf[256];
    _snwprintf_s(buf, _countof(buf), _TRUNCATE,
                 L"uninstall|%d", removeData);
    PushString(buf);
}

} // extern "C"
