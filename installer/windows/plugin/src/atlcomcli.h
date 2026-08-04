#pragma once
// Minimal ATL-free shim for DuiLib_Ultimate's atlcomcli.h consumers.
// Reimplements the >90% of ATL's CComPtr / CComQIPtr surface that DuiLib
// actually uses: get_Document(&spC), copy ctor, operator=(T*),
// operator->, Attach/Detach, operator T*(). None of the Release callback
// machinery or ATL::_ATL_BAD_THUNK machinery is needed.

#ifndef _ATL_NO_DEBUG_CRT
#define ATLASSERT(cond) ((void)0)
#endif
#define ATLTRACE(...)   ((void)0)

namespace ATL
{
    struct _ATL_CREATORDATA_CHECK {};
    template <class T>
    class CComPtrBase
    {
    protected:
        CComPtrBase() throw() : p(nullptr) {}
        CComPtrBase(T* lp) throw() : p(lp) { if (p) p->AddRef(); }
        void Release() throw() {
            T* pt = p;
            if (pt) { p = nullptr; pt->Release(); }
        }
        T* p;
    };

    template <class T>
    class CComPtr : public CComPtrBase<T>
    {
    public:
        CComPtr() throw() {}
        CComPtr(T* lp) throw() : CComPtrBase<T>(lp) {}
        CComPtr(const CComPtr& lp) throw() : CComPtrBase<T>(lp.p) {}
        ~CComPtr() throw() { this->Release(); }

        operator T*() const throw() { return this->p; }
        T& operator*() const throw() { return *this->p; }
        T* operator=(T* lp) throw() {
            if (this->p != lp) {
                CComPtr(lp).Swap(*this);
            }
            return lp;
        }
        T* operator=(const CComPtr& lp) throw() {
            if (this->p != lp.p) { CComPtr(lp).Swap(*this); }
            return this->p;
        }
        T* operator->() const throw() { return this->p; }
        bool operator!() const throw() { return this->p == nullptr; }
        bool operator==(_In_opt_ T* pT) const throw() { return pT == this->p; }
        bool operator!=(_In_opt_ T* pT) const throw() { return pT != this->p; }

        void Swap(CComPtr& other) throw() {
            T* pTemp = this->p;
            this->p = other.p;
            other.p = pTemp;
        }

        T** operator&() throw() {
            ATLASSERT(this->p == nullptr);
            return &this->p;
        }

        void Attach(T* p2) throw() {
            if (this->p) this->p->Release();
            this->p = p2;
        }
        T* Detach() throw() {
            T* pt = this->p;
            this->p = nullptr;
            return pt;
        }

        HRESULT CopyTo(_Outptr_ T** ppT) throw() {
            ATLASSERT(ppT != nullptr);
            if (ppT == nullptr) return E_POINTER;
            *ppT = this->p;
            if (this->p) this->p->AddRef();
            return S_OK;
        }
    };

    template <class T, const IID* piid = &__uuidof(T)>
    class CComQIPtr : public CComPtr<T>
    {
    public:
        CComQIPtr() throw() {}
        CComQIPtr(T* lp) throw() : CComPtr<T>(lp) {}
        CComQIPtr(IUnknown* lp) throw() {
            if (lp != nullptr) {
                if (lp->QueryInterface(*piid, (void**)&this->p) != S_OK)
                    this->p = nullptr;
            }
        }
        CComQIPtr(const CComQIPtr& lp) throw() : CComPtr<T>(lp.p) {}
        T* operator=(T* lp) throw() {
            CComPtr<T>::operator=(lp);
            return lp;
        }
        T* operator=(const CComQIPtr& lp) throw() {
            CComPtr<T>::operator=(lp);
            return this->p;
        }
		T* operator=(IUnknown* lp) throw() {
			if (CComPtr<T>::operator=(lp))
				return this->p;
			// attempt QI
			if (lp) {
				if (lp->QueryInterface(*piid, (void**)&this->p) != S_OK)
					this->p = nullptr;
			}
			return this->p;
		}
	};
}

// DuiLib_Ultimate calls CComPtr/CComQIPtr without the ATL:: qualifier.
using ATL::CComPtr;
using ATL::CComQIPtr;
