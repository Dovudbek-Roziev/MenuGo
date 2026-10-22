# MenuGo — tanishtiruv sayti

Kafelar uchun QR menyu va buyurtma xizmati g‘oyasini tanishtiruvchi ruscha sayt. Faqat frontend: React + Vite + TypeScript. Server, login, ma’lumotlar bazasi va haqiqiy buyurtma tizimi yo‘q.

## Lokal ishga tushirish

Node.js **20.19+** kerak (20.20.2 bilan tekshirildi). Node.js 22 ishlatilsa, **22.12+** bo‘lsin. npm Node bilan birga o‘rnatiladi.

Terminalni `MenuGo` papkasida oching:

```powershell
cd client
npm install
npm run dev
```

Brauzerda terminal ko‘rsatgan manzilni oching: odatda **http://127.0.0.1:5173/**. Port band bo‘lsa, Vite keyingi portni tanlaydi. To‘xtatish: `Ctrl+C`.

Tekshirish va ishlab chiqarish uchun build (`client/` ichida):

```powershell
npm run typecheck
npm run build
npm run preview
```

`preview` tayyor buildni lokal ko‘rsatadi, odatda http://127.0.0.1:4173/. Build natijasi `client/dist/` ichiga tushadi. Bu deploy emas.

## Tuzilma

- `client/src/App.tsx` — sahifa, telefon va kafe paneli namunalari.
- `client/src/styles.css` — ranglar, responsive dizayn va reduced-motion qoidalari.
- `client/src/main.tsx` — React kirish nuqtasi, lokal Manrope shriftlari.
- `client/public/brand/menugo.jpg` — tasdiqlangan logo, asl fayldan o‘zgartirmasdan nusxalangan.
- `client/index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` — loyiha sozlamalari.

## Dizayn va brend

Asosiy ranglar: to‘q yashil `#103f33`, iliq krem `#f8f5eb`, och yashil aksent `#c4da72`. Manrope shriftining lotin va kirill fayllari npm orqali lokal saqlanadi; Google Fonts yoki tashqi rasm serveriga murojaat yo‘q.

Logo manbasi: foydalanuvchi ko‘rsatgan `Downloads/Telegram Desktop/photo_2026-10-21_22-43-16.jpg`. Asl JPG o‘zgartirilmagan va yakuniy brend blokida to‘liq ko‘rsatiladi. Foydalanuvchining keyingi so‘roviga ko‘ra header uchun `client/public/brand/menugo-symbol.svg` tayyorlangan: asl belgining konturlari vektorga o‘tkazilgan, krem fon uchun «M» va vilka to‘q yashil, barg och yashil qilingan. Headerda bu fonsiz belgi MenuGo yozuvi bilan bir qatorda turadi. Promo video faqat dizayn namunasi, loyihaga kiritilmagan.

Sifatli taom suratlari berilmagan: menyu hozir matnli. Keyingi vizual boyitish uchun tasdiqlangan taom suratlari kerak. Tasodifiy internet rasmlari, emoji va soxta rasm o‘rinbosarlari ishlatilmagan.

## Nima ishlaydi, nima demo

- Navigatsiya, «Как это работает», «Для кафе», «Готовимся к запуску» va «Наверх» havolalari sahifa bo‘limlariga o‘tadi.
- Sahifa telefon va katta ekranlarga moslashadi; klaviatura fokusi, asosiy mazmunga o‘tish havolasi va `prefers-reduced-motion` mavjud.
- Telefon menyusi — statik demo: stol raqami, kategoriyalar, taomlar, tarkib va namunaviy narxlar. Kategoriyalar tugma emas; buyurtma yuborilmaydi.
- Kafe paneli — statik «Пример интерфейса». Stol, holat, taom va narxlar faqat namunaviy ma’lumot; boshqaruv funksiyalari yo‘q.
- Haqiqiy QR, savat, buyurtma, to‘lov, login, obuna, server va ma’lumotlar bazasi qurilmagan. Kontaktlar, tariflar, mijozlar yoki natijalar to‘qib chiqarilmagan.
- Sayt rus tilida. Til almashtirgich yo‘q.

GitHub’ga push va deploy qilinmagan. Keyingi bosqich faqat lokal ko‘rib chiqish va foydalanuvchi tasdig‘idan so‘ng.
