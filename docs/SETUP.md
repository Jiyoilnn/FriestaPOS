# Paano i-setup ang Friesta POS at Back Office

May dalawang app sa repository na ito:

| App | Folder | Para saan |
|---|---|---|
| **Friesta POS** | `pos/` | Pagbebenta sa counter: menu, order, cash/GCash/Maya/Card, resibo, shift, Bluetooth printer. Bubuksan gamit ang 4-digit PIN ng bawat empleyado. |
| **Friesta Back Office** | `backoffice/` | Reports sa kahit anong petsa (Gross sales, Refunds, Discounts, Net sales, Cost of goods, Gross profit), sales by item/category/employee/payment, receipts, shifts, items at cost, discounts, employees at PIN, settings, backup. |

Parehong **gumagana offline** at puwedeng i-install sa home screen na parang app.

---

## 1. I-on ang GitHub Pages (libreng hosting) — isang beses lang

1. Sa GitHub, buksan ang repository **FriestaPOS** → **Settings** → **Pages**.
2. Sa **Build and deployment → Source**, piliin ang **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Maghintay ng 1–2 minuto. Ang link ng Friesta mo ay:
   **https://jiyoilnn.github.io/FriestaPOS/**

   - POS: `https://jiyoilnn.github.io/FriestaPOS/pos/`
   - Back Office: `https://jiyoilnn.github.io/FriestaPOS/backoffice/`

## 2. Gumawa ng account at PIN

1. Buksan ang POS link sa phone o tablet na gagamitin sa tindahan.
2. Ilagay ang pangalan ng tindahan, pangalan mo, email, password at **owner PIN** (4 na numero).
3. Pagkatapos, lalabas ang PIN screen. Ilagay ang PIN mo para makapagbenta.
4. Sa **Back Office → Employees & PIN**, mag-add ng cashier o manager at bigyan sila ng sariling PIN.

> **Account** (email + password) = pang-login sa device at sa Back Office.
> **PIN** = pang-unlock ng POS ng bawat empleyado. Naka-record sa bawat benta kung sino ang nagbenta.

## 3. I-install bilang app

- **Android (Chrome):** menu ⋮ → **Install app** (o **Add to Home screen**). Gawin ito para sa POS at sa Back Office; magkaiba ang icon nila.
- **iPhone/iPad (Safari):** Share → **Add to Home Screen**.

Kapag naka-install na, gumagana ito kahit walang internet.

## 4. Bluetooth receipt printer

- Kailangan: **Chrome sa Android** (o Windows/Mac/ChromeOS) at printer na may **Bluetooth Low Energy (BLE / 4.0)**. Ang printer na "Bluetooth 2.0 / SPP" lang ay hindi gagana sa web app.
- **iPhone/iPad:** hindi pinapayagan ng Apple ang Bluetooth sa Safari o Chrome. Gamitin ang libreng **Bluefy** browser app para mag-print.
- Sa POS: **Settings → Connect printer** → piliin ang printer → **Test print**. Huwag i-pair sa Bluetooth settings ng phone.
- Puwedeng i-on ang **kitchen slip** (malaking order number at items para sa nagpi-prito).

## 5. Offline o online?

### Offline mode (default, walang kailangang i-setup)
- Naka-save ang lahat sa device.
- Kung bubuksan mo ang POS at Back Office **sa parehong device**, pareho ang data nila at live itong nag-a-update.
- Mag-download ng backup linggo-linggo: **Back Office → Settings → Download backup**.

### Online sync (optional, libre) — para makita ang benta mula sa ibang phone
Gamitin ito kung nasa tablet sa tindahan ang POS at gusto mong makita ang reports sa phone mo kahit nasa bahay ka. Gumagana pa rin ito offline: naka-save ang benta sa device at magsi-sync pagbalik ng internet.

1. Pumunta sa **https://console.firebase.google.com** → **Create a project** (hal. `friesta-pos`). Puwedeng i-off ang Google Analytics.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database** → piliin ang location na `asia-southeast1` (Singapore) → **Start in production mode**.
4. Sa Firestore, buksan ang tab na **Rules**, palitan ang laman ng nasa file na **`firestore.rules`** sa repository na ito, tapos **Publish**.
5. **Project settings (⚙️) → General → Your apps → Web (`</>`)** → mag-register ng app (hal. "Friesta") → kopyahin ang `firebaseConfig`.
6. Sa GitHub, buksan ang **`shared/config.js`** → ✏️ Edit → palitan ang `export const FIREBASE_CONFIG = null;` ng config mo, halimbawa:
   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "friesta-pos.firebaseapp.com",
     projectId: "friesta-pos",
     storageBucket: "friesta-pos.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```
   → **Commit changes**.
7. Sa Firebase **Authentication → Settings → Authorized domains**, idagdag ang **`jiyoilnn.github.io`**.
8. Buksan ulit ang POS (online). Gumawa ng account (o mag-sign in). Sa ibang device, mag-sign in gamit ang parehong email at password.

**Paglipat ng data mula offline papuntang online:** buksan ang Back Office sa device na may offline data, mag-sign in sa online account, tapos **Settings → Import to cloud**. (Puwede ring Download backup / Restore backup.) I-add ulit ang employees at PIN sa Employees & PIN.

> Ligtas na i-commit ang Firebase web config; ang proteksyon ay galing sa `firestore.rules` (tanging ang may-ari ng account ang makakabasa at makakasulat ng data ng tindahan).

## 6. Paglipat mula sa lumang Friesta POS (sa Claude)

1. Sa lumang Friesta POS page: **Settings → Download backup**.
2. Sa bagong **Back Office → Settings → Restore backup** → piliin ang file.
3. Lilipat ang items, receipts, shifts at settings. Lagyan ng **cost** ang mga items para lumabas ang Gross profit.

## 7. Paano mag-update

I-edit o palitan ang files sa GitHub. Makukuha ng app ang bagong version kapag online at in-open ulit. Kapag may lumabas na "May bagong version", pindutin ang **I-reload**.

## Mga sukatan sa Back Office (kapareho ng Loyverse)

| Sukatan | Ibig sabihin |
|---|---|
| Gross sales | Kabuuang presyo ng nabenta bago ang discount |
| Refunds | Halagang ni-refund sa panahong iyon (binibilang sa araw ng refund) |
| Discounts | Kabuuang discount na ibinigay |
| **Net sales** | Gross sales − Discounts − Refunds |
| Cost of goods | Cost ng nabenta (mula sa cost na nilagay sa Items) − cost ng ni-refund |
| **Gross profit** | Net sales − Cost of goods |

## Kapag may problema sa online sync

**"Tinanggihan ng Firebase ang pag-save (Firestore Rules)"**
Hindi pa naka-publish ang tamang Firestore Rules. Sa Firebase console: **Firestore Database → Rules**, burahin ang lahat ng nandoon, i-paste ang laman ng `firestore.rules`, tapos **Publish**. Hindi nawawala ang benta habang inaayos ito: naka-save muna sa device at kusang ipapadala ulit kapag pinayagan na ng Firebase (makikita sa POS ang "Syncing" na may bilang).

**"Hindi mabasa ang data sa Firebase"**
Parehong dahilan: i-publish ang Firestore Rules.

**Walang PIN na gumagana sa unang bukas**
Pindutin ang **Gamitin ang account password** sa PIN screen. Kapag wala pang owner PIN, hihingin ng app na gumawa ng bago.

## BIR: paalala sa resibo at X/Z-reading

**Hindi BIR-accredited ang Friesta POS** at wala itong Permit to Use (PTU). Kaya may nakalagay na **"THIS IS NOT A BIR SALES INVOICE"** sa ibaba ng bawat resibo (screen, kopya at printed). Mag-isyu ng BIR-registered sales invoice nang hiwalay kapag kailangan. Puwedeng palitan ang paalala o i-off sa **Back Office → Settings**. I-off lang kapag may PTU ka na.

Sa **Back Office → Settings**, ilagay din ang **Registered business name**, **TIN** at kung **VAT-registered** ka. Lalabas ang mga ito sa resibo at sa Z-reading.

**Receipt numbers:** sunod-sunod at hindi nare-reset bawat device (hal. `7MS20W-000123`). Ang unang bahagi ay ang code ng device.

**X-reading** (POS → Shift): tinitingnan ang benta mula sa huling Z-reading. Walang nire-reset.

**Z-reading** (POS → Shift → Z-reading (end of day)): gawin sa pagsasara. Ise-save nito ang:
- unang at huling receipt number at bilang ng transactions
- gross sales, Senior/PWD discount, ibang discount, refunds, **net sales**
- VATable sales, VAT 12% at VAT-exempt (Senior/PWD) kung VAT-registered
- bawat payment type
- **accumulated sales** (beginning at ending), na tuloy-tuloy at hindi nare-reset

Makikita lahat ng Z-reading sa **Back Office → Z-readings**, na may CSV download.

> Paalala: ang X/Z-reading at sunod-sunod na numero ay bahagi lang ng hinihingi ng BIR. Kung balak mong ipa-accredit o ipa-register ang Friesta POS, kumonsulta sa RDO o accountant mo para sa kumpletong requirements.
