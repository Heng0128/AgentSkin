---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 6e1e6f4b5984ec0ce4dd25f6a8e5597b_cab9b44484fd11f1afee525400f8a581
    ReservedCode1: FmN7k+AxFQJveCRhy6pItvdhuBb61UCCipNxOwV1J0lyjrb1+BtExJayOsNZJrh23zehOhChAj4NheKk5eRsj7KO+Tmy5fLPGIIgcjz2BTETkznkvEDGX7KwqjVvKS9+/ZSwLq/yMIbOncwa1bXpg306wk4uc90KF6GlzFsA3o59YMomyU13NIpy2/I=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 6e1e6f4b5984ec0ce4dd25f6a8e5597b_cab9b44484fd11f1afee525400f8a581
    ReservedCode2: FmN7k+AxFQJveCRhy6pItvdhuBb61UCCipNxOwV1J0lyjrb1+BtExJayOsNZJrh23zehOhChAj4NheKk5eRsj7KO+Tmy5fLPGIIgcjz2BTETkznkvEDGX7KwqjVvKS9+/ZSwLq/yMIbOncwa1bXpg306wk4uc90KF6GlzFsA3o59YMomyU13NIpy2/I=
---

# AgentSkin — Agent Icon Sources

Last updated: 2026-07-21

## Official Icon Sources

| Agent | Source File | Resolution | File Size | Extraction Method |
|-------|------------|------------|-----------|-------------------|
| TRAE Work CN | `TRAE SOLO CN.exe` → `resources/app/resources/win32/bower.ico` | 256×256 | 24.1 KB | Extracted via System.Drawing.Icon, resized to 256×256, saved as PNG |
| QoderWork CN | `QoderWork CN.exe` → `resources/tray-icon.png` | 512×512 | 14.6 KB | Copied directly from installation directory tray-icon.png |
| WorkBuddy | `WorkBuddy.exe` → `resources/app.asar.unpacked/resources/icon.png` | 256×256 | 31.9 KB | Resized from 1024×1024 source, saved as 256×256 PNG |

## Project Path

All icons stored in: `src/ui/assets/apps/`

- `traework.png` — TRAE Work CN
- `qoderwork.png` — QoderWork CN
- `workbuddy.png` — WorkBuddy

## Verification

- [x] TRAE Work CN: Official bower.ico from ByteDance TRAE SOLO CN installation
- [x] QoderWork CN: Official tray-icon.png from Tencent QoderWork CN installation
- [x] WorkBuddy: Official icon.png from WorkBuddy installation resources

## Notes

- All icons are derived from the actual installed application binaries, not AI-generated.
- TRAE installation directory name is "TRAE SOLO CN" (brand name), but `product.json` confirms `nameAlias: "TRAE Work CN"`.
- QoderWork CN tray-icon.png was already 512×512 — no resizing needed.
*（内容由AI生成，仅供参考）*
