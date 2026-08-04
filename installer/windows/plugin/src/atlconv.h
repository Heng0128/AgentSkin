#pragma once
// Minimal ATL-free shim for DuiLib_Ultimate's atlconv.h consumers.
// No ATL/MFC installed on this build box, but all real conversions used
// by DuiLib are W==W (we build Unicode only). These macros are therefore
// identity casts.

#define T2A(x)       (LPCSTR)(x)        // never used; UNICODE only
#define A2T(x)       (LPCWSTR)(x)       // never used; UNICODE only
#define T2W(x)       (LPCWSTR)(x)
#define W2T(x)       (LPCWSTR)(x)
#define T2CA(x)      (LPCSTR)(x)
#define A2CT(x)      (LPCWSTR)(x)
#define T2CW(x)      (LPCWSTR)(x)
#define W2CT(x)      (LPCWSTR)(x)
#define A2W(x)       (LPCWSTR)(x)
#define W2A(x)       (LPCSTR)(x)
// T2BSTR is just a cast — the caller either SysAllocString's it or
// uses it directly as a BSTR input parameter.
#define T2BSTR(x)    ((BSTR)(LPCWSTR)(x))
#define A2BSTR(x)    ((BSTR)(LPCWSTR)(x))
#define W2BSTR(x)    (BSTR)(LPCWSTR)(x)
