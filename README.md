# energibrunnar-karta

Interaktiv karta över energiborrhål från [SGU:s Brunnsarkiv](https://www.sgu.se/produkter-och-tjanster/geologiska-data/brunnar--geologiska-data/brunnar/) (öppna data, CC0). Filtrerar `anvandning_kod = ENE` för perioden 2025-10-01 – 2026-03-31.

## Köra lokalt

```bash
npm start
```

Öppna **http://127.0.0.1:8080/**.

## Åtkomst

Lösenordsskydd i webbläsaren (`auth.js` + `auth-config.js`, SHA-256-hash). Sessionen gäller per flik tills den stängs.

## Teknik

Statisk webbapp (HTML/CSS/JS + Leaflet). Hämtar GeoJSON från `api.sgu.se`.

Nybyggda bostäder filtreras mot externt register (`nybygg-register.js`): demoläge utan nyckel, Combify med `x-api-key`, eller egen JSON-URL. Plan: se projektdoc `sbc-nybygg-register-plan.md`.

## Publicera (GitHub Pages / Vercel)

Se projektets `docs/sbc-karta-mobil.md` i Cursor-store eller GitHub wiki/instruktioner från koordinator.
