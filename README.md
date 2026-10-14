# Friesta POS

Sariling point-of-sale ng **Friesta – House Cut French Fries**. Walang subscription, gumagana offline, at may hiwalay na Back Office para sa reports.

| | App | Ano ang laman |
|---|---|---|
| <img src="pos/icon-192.png" width="56"> | **Friesta POS** (`pos/`) | Menu na may sizes, notes sa kusina, saved orders, discount, cash keypad na may sukli, GCash/Maya/Card, resibo, refund (may manager PIN), shift at cash drawer count, Bluetooth receipt printer, PIN lock bawat empleyado |
| <img src="backoffice/icon-192.png" width="56"> | **Friesta Back Office** (`backoffice/`) | Sales summary sa kahit anong petsa (Gross sales, Refunds, Discounts, Net sales, Gross profit) na may chart at comparison, sales by item / category / employee / payment type, receipts, discounts, shifts, item list na may cost at stock, categories, discounts, employees at PIN, settings, backup at restore |

**Live (kapag naka-on ang GitHub Pages):** https://jiyoilnn.github.io/FriestaPOS/

## Paano gamitin

Basahin ang **[docs/SETUP.md](docs/SETUP.md)** para sa:

1. Pag-on ng GitHub Pages (libreng hosting)
2. Paggawa ng account at mga PIN
3. Pag-install sa phone o tablet
4. Pag-connect ng Bluetooth printer
5. Pag-on ng optional na online sync (Firebase, libre)

## Paano ito gumagana

- Static web apps (HTML, CSS, JavaScript modules). Walang build step at walang server na kailangan.
- **Offline-first:** naka-save ang data sa IndexedDB ng device. Ang POS at Back Office sa parehong device ay iisa ang data at live na nag-a-update.
- **Optional cloud sync:** kapag may `FIREBASE_CONFIG` sa `shared/config.js`, ginagamit ang Firebase Auth at Firestore na may offline cache, kaya nakikita ang benta sa lahat ng device.
- **Accounts:** isang owner account (email + password) bawat tindahan; 4-digit PIN bawat empleyado (naka-hash).

```
index.html            landing page (piliin ang POS o Back Office)
pos/                  Friesta POS app
backoffice/           Friesta Back Office app
shared/               data store, accounts, reports math, printer, styles, logo
shared/config.js      optional Firebase config (null = offline mode)
firestore.rules       security rules para sa online sync
assets/               source SVG ng mga icon
docs/SETUP.md         setup guide (Tagalog)
```
