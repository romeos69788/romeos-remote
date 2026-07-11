# Romeos Remote

Μικρή **web εφαρμογή** (React + Vite) που ανοίγει στο **iPhone με Safari** και συνδέεται στο **ίδιο MQTT broker** με τη μητρική (`motherboard-fw` + `mb_mqtt.cpp`).

Δεν είναι εγκατεστημένο από App Store· χρησιμοποίησε **Safari → Κοινοποίηση → Προσθήκη στην αρχική οθόνη** για συμπεριφορά σαν «εφαρμογή».

## Τι κάνει

- Εμφανίζει **JSON κατάστασης** από topic `romeos/<DEVICE_ID>/state` (θερμοκρασίες, ρελέ, setpoint).
- Στέλνει **setpoint** στο `romeos/<DEVICE_ID>/cmd` ως `{"setpoint_c_x10": 190}` (19,0 °C), με quick presets και stepper +/-.
- Περιλαμβάνει κουμπιά **Boiler ON/OFF** που δημοσιεύουν `{"heater":1}` / `{"heater":0}`.
- Δείχνει ένδειξη πρόσφατης τηλεμετρίας (live/stale) ώστε να ξέρεις αν η μητρική απαντάει.

Σημείωση: αν το firmware δεν έχει ακόμα υλοποίηση για `heater`, η εντολή boiler θα σταλεί αλλά δεν θα αλλάξει κατάσταση.

## Broker (παράδειγμα HiveMQ Cloud)

1. Δημιούργησε δωρεάν cluster στο [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/).
2. Στο console: **WebSocket URL** (συνήθως `wss://....hivemq.cloud:8884/mqtt`), **username**, **password**.
3. Στο `motherboard-fw/platformio.ini` πρόσθεσε στα `build_flags` (με **δικά σου** στοιχεία):

```ini
    -DROMEOS_MQTT_HOST=\"xxxx.s1.eu.hivemq.cloud\"
    -DROMEOS_MQTT_USER=\"το_username\"
    -DROMEOS_MQTT_PASS=\"το_password\"
    -DROMEOS_MQTT_DEVICE_ID=\"romeos-mb\"
```

Η μητρική πρέπει να είναι **STA στο οικιακό Wi‑Fi** (με internet) ώστε να φτάσει στον broker.

4. Στην εφαρμογή: ίδιο **WebSocket URL**, χρήστης/κωδικός, **Device ID** όπως το `ROMEOS_MQTT_DEVICE_ID`.

### Προαιρετικά: `.env` για dev

Αντί να πληκτρολογείς κάθε φορά, δημιούργησε `romeos-remote/.env.local`:

```env
VITE_MQTT_WS_URL=wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt
VITE_MQTT_USER=...
VITE_MQTT_PASS=...
VITE_MQTT_DEVICE_ID=romeos-mb
```

Μην κάνεις commit secrets στο git.

## Τρέξιμο τοπικά (Windows + iPhone)

Στο **PC (Windows)**:

```powershell
cd romeos-remote
npm install
npm run dev
```

Το Vite είναι ρυθμισμένο με `host: true` — στο τερματικό θα εμφανιστεί και **δίκτυο (Network)** URL.

Στο **iPhone** (Safari **ή** Chrome — και τα δύο είναι εντάξει για αυτή τη σελίδα):

1. Ίδιο **Wi‑Fi** με τον υπολογιστή.
2. Άνοιξε `http://<IP-του-PC>:5174` (π.χ. `http://192.168.1.42:5174`). Το IP το βλέπεις στο Windows: `ipconfig` → IPv4 Address του Wi‑Fi adapter.
3. (Προαιρετικά) Safari → **Κοινοποίηση** → **Προσθήκη στην αρχική οθόνη** — συμπεριφορά σαν «εφαρμογή».

**Εκτός σπιτιού:** το `npm run dev` τρέχει μόνο τοπικά· για μόνιμο URL από internet χρησιμοποίησε το **GitHub Pages** (μετά το merge στο `main`):

**https://romeos69788.github.io/romeos-remote/**

(Απαιτεί ενεργοποίηση Pages στο repo: Settings → Pages → Source: **GitHub Actions**.)

Εναλλακτικά: `npm run build` + Netlify/Vercel ή tunnel (ngrok). Το **MQTT** (HiveMQ `wss://…`) δουλεύει από το κινητό όπου κι αν είσαι, αρκεί η σελίδα να φορτώνει και τα credentials να είναι σωστά.

## Ασφάλεια

Το firmware χρησιμοποιεί `WiFiClientSecure::setInsecure()` για γρήγορο bench — για παραγωγή προτίμησε **πιστοποιητικό CA** του broker. Μην μοιράζεις κωδικούς MQTT.
