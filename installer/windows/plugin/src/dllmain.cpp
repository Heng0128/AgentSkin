// SPDX-License-Identifier: MPL-2.0
// AgentSkinUI.dll — entry point.
// Replaces DuiLib's UILib.cpp DllMain (excluded from the build);
// keeps a copy of our HMODULE for CPaintManagerUI::SetInstance().
#include <windows.h>

HMODULE g_hModule = NULL;

BOOL APIENTRY DllMain(HMODULE hModule, DWORD dwReason, LPVOID /*lpReserved*/)
{
    if (dwReason == DLL_PROCESS_ATTACH) {
        g_hModule = hModule;
        ::DisableThreadLibraryCalls(hModule);
    }
    return TRUE;
}
