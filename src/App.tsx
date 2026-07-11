import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";

const LS = {
  ws: "romeos_remote_ws",
  user: "romeos_remote_user",
  pass: "romeos_remote_pass",
  device: "romeos_remote_device",
} as const;

export type RomeosState = {
  v?: number;
  flags?: number;
  room_c_x10?: number;
  outdoor_c_x10?: number;
  solar_c_x10?: number;
  boiler_c_x10?: number;
  supply_c_x10?: number;
  return_c_x10?: number;
  relay_k1?: number;
  relay_k2?: number;
  relay_k3?: number;
  relay_k4?: number;
  relay_k5?: number;
  relay_k6?: number;
  heat_pump?: number;
  pump1?: number;
  pump2?: number;
  heater?: number;
  flow_sig_high?: number;
  defrost_active?: number;
  setpoint_c_x10?: number;
  uptime_ms?: number;
};

type RemoteStatus = "off" | "connecting" | "on";

/** Γρήγορα presets °C (το stepper / αποστολή υποστηρίζουν ήδη 5–35). */
const QUICK_PRESETS_LOW: readonly number[] = [19, 20, 21, 22, 23, 24, 25];
const QUICK_PRESETS_HIGH: readonly number[] = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35];

function fmtC(x10: number | undefined): string {
  if (x10 === undefined || Number.isNaN(x10)) {
    return "-";
  }
  const neg = x10 < 0;
  const a = Math.abs(x10);
  const i = Math.floor(a / 10);
  const f = a % 10;
  return `${neg ? "-" : ""}${i},${f} °C`;
}

function loadLs(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveLs(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function App() {
  const [wsUrl, setWsUrl] = useState(
    () =>
      import.meta.env.VITE_MQTT_WS_URL ??
      loadLs(LS.ws, "wss://YOUR_CLUSTER.hivemq.cloud:8884/mqtt"),
  );
  const [user, setUser] = useState(
    () => import.meta.env.VITE_MQTT_USER ?? loadLs(LS.user, ""),
  );
  const [pass, setPass] = useState(
    () => import.meta.env.VITE_MQTT_PASS ?? loadLs(LS.pass, ""),
  );
  const [deviceId, setDeviceId] = useState(
    () => import.meta.env.VITE_MQTT_DEVICE_ID ?? loadLs(LS.device, "romeos-mb"),
  );

  const [status, setStatus] = useState<RemoteStatus>("off");
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<RomeosState | null>(null);
  const [draftSp, setDraftSp] = useState<number>(21);
  const [sendPulse, setSendPulse] = useState(false);
  const [sendShake, setSendShake] = useState(false);
  const [sentHint, setSentHint] = useState<string | null>(null);
  const [lastStateMs, setLastStateMs] = useState<number | null>(null);

  const clientRef = useRef<MqttClient | null>(null);

  const topics = useMemo(() => {
    const d = deviceId.trim() || "romeos-mb";
    return {
      state: `romeos/${d}/state`,
      cmd: `romeos/${d}/cmd`,
    };
  }, [deviceId]);

  const disconnect = useCallback(() => {
    const c = clientRef.current;
    clientRef.current = null;
    if (c) {
      c.removeAllListeners();
      c.end(true);
    }
    setStatus("off");
  }, []);

  const pulseOk = useCallback((hint: string) => {
    setSendPulse(true);
    window.setTimeout(() => setSendPulse(false), 500);
    setSentHint(hint);
    window.setTimeout(() => setSentHint(null), 2800);
  }, []);

  const pulseFail = useCallback((hint: string) => {
    setErr(hint);
    setSendShake(true);
    window.setTimeout(() => setSendShake(false), 450);
  }, []);

  const publishCommand = useCallback(
    (payload: Record<string, number>, successHint: string) => {
      const c = clientRef.current;
      if (!c || !c.connected) {
        pulseFail("Δεν υπάρχει σύνδεση MQTT.");
        return;
      }
      setErr(null);
      c.publish(topics.cmd, JSON.stringify(payload), { qos: 0 }, (e) => {
        if (e) {
          pulseFail(`Publish: ${e.message}`);
          return;
        }
        pulseOk(successHint);
      });
    },
    [pulseFail, pulseOk, topics.cmd],
  );

  const connect = useCallback(() => {
    setErr(null);
    disconnect();
    saveLs(LS.ws, wsUrl);
    saveLs(LS.user, user);
    saveLs(LS.pass, pass);
    saveLs(LS.device, deviceId.trim() || "romeos-mb");

    setStatus("connecting");
    const d = deviceId.trim() || "romeos-mb";
    const stateTopic = `romeos/${d}/state`;

    const c = mqtt.connect(wsUrl, {
      username: user || undefined,
      password: pass || undefined,
      reconnectPeriod: 4000,
      connectTimeout: 20_000,
      clientId: `iphone-${Math.random().toString(16).slice(2, 10)}`,
    });
    clientRef.current = c;

    c.on("connect", () => {
      setStatus("on");
      c.subscribe(stateTopic, { qos: 0 }, (e) => {
        if (e) {
          setErr(`Subscribe: ${e.message}`);
        }
      });
    });

    c.on("reconnect", () => setStatus("connecting"));

    c.on("error", (e) => {
      setErr(e?.message ?? String(e));
    });

    c.on("close", () => {
      if (clientRef.current === c) {
        setStatus("off");
      }
    });

    c.on("message", (topic, payload) => {
      if (topic !== stateTopic) {
        return;
      }
      try {
        const j = JSON.parse(payload.toString()) as RomeosState;
        setState(j);
        setLastStateMs(Date.now());
        if (typeof j.setpoint_c_x10 === "number") {
          setDraftSp(Math.round(j.setpoint_c_x10 / 10));
        }
      } catch {
        setErr("Μη έγκυρο JSON στο state");
      }
    });
  }, [deviceId, disconnect, pass, user, wsUrl]);

  useEffect(() => () => disconnect(), [disconnect]);

  const sendSetpoint = useCallback(() => {
    const x10 = Math.min(35, Math.max(5, draftSp)) * 10;
    const deg = Math.round(x10 / 10);
    publishCommand({ setpoint_c_x10: x10 }, `Στάλθηκε ${deg} °C`);
  }, [draftSp, publishCommand]);

  const sendSetpointDirect = useCallback(
    (deg: number) => {
      const clamped = Math.min(35, Math.max(5, Math.round(deg)));
      setDraftSp(clamped);
      publishCommand(
        { setpoint_c_x10: clamped * 10 },
        `Στάλθηκε ${clamped} °C`,
      );
    },
    [publishCommand],
  );

  const sendBoiler = useCallback(
    (on: boolean) => {
      publishCommand(
        { heater: on ? 1 : 0 },
        on ? "Στάλθηκε Boiler ON" : "Στάλθηκε Boiler OFF",
      );
    },
    [publishCommand],
  );

  /** Από MQTT state: heater flag ή relay K4 (ίδιο hardware στη μητρική). */
  const heaterOnFromTelemetry = useMemo(() => {
    if (!state) {
      return null;
    }
    if (typeof state.heater === "number") {
      return state.heater !== 0;
    }
    if (typeof state.relay_k4 === "number") {
      return state.relay_k4 !== 0;
    }
    return null;
  }, [state]);

  const staleSeconds =
    lastStateMs === null ? null : Math.max(0, Math.floor((Date.now() - lastStateMs) / 1000));
  const telemetryStale = staleSeconds !== null && staleSeconds > 20;
  const needsSetup =
    wsUrl.includes("YOUR_CLUSTER") || !user.trim() || !pass.trim();
  const showTelemetry = status === "on" || state !== null;

  const relayPills = useMemo(() => {
    if (!state) {
      return null;
    }
    const items: { k: string; v: number | undefined }[] = [
      { k: "K1", v: state.relay_k1 },
      { k: "K2", v: state.relay_k2 },
      { k: "K3", v: state.relay_k3 },
      { k: "K4", v: state.relay_k4 },
      { k: "K5", v: state.relay_k5 },
      { k: "K6", v: state.relay_k6 },
    ];
    return (
      <div className="row">
        {items.map(({ k, v }) => (
          <span key={k} className={`pill ${v ? "on" : "off"}`}>
            {k}:{v ? "ON" : "off"}
          </span>
        ))}
      </div>
    );
  }, [state]);

  return (
    <div className="stack">
      <h1>Romeos Remote</h1>
      <p className="muted">
        Web εφαρμογή για iPhone (Safari). Χρειάζεται MQTT broker (π.χ. HiveMQ
        Cloud) και firmware μητρικής με τα ίδια στοιχεία.
      </p>

      {needsSetup ? (
        <div className="banner banner-warn" role="status">
          <strong>Ρύθμιση απαιτείται.</strong> Συμπλήρωσε WebSocket URL, χρήστη
          και κωδικό MQTT (ίδα με τη μητρική), μετά πάτα «Σύνδεση».
        </div>
      ) : null}

      {status === "on" && !state ? (
        <div className="banner banner-info" role="status">
          Συνδεδεμένο στο MQTT — περιμένουμε τηλεμετρία από{" "}
          <code>{topics.state}</code>. Βεβαιώσου ότι η μητρική είναι online και
          στέλνει state.
        </div>
      ) : null}

      <div className="card stack">
        <h2>Σύνδεση</h2>
        <div>
          <label htmlFor="ws">WebSocket URL (wss://…)</label>
          <input
            id="ws"
            type="text"
            autoComplete="off"
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="user">Χρήστης MQTT</label>
          <input
            id="user"
            type="text"
            autoComplete="username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="pass">Κωδικός MQTT</label>
          <input
            id="pass"
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="dev">Device ID (ίδιο με ROMEOS_MQTT_DEVICE_ID)</label>
          <input
            id="dev"
            type="text"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
          />
        </div>
        <div className="row">
          {status === "on" ? (
            <button type="button" className="secondary" onClick={disconnect}>
              Αποσύνδεση
            </button>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={status === "connecting"}
            >
              {status === "connecting" ? "Σύνδεση…" : "Σύνδεση"}
            </button>
          )}
          <span className="muted">
            {status === "on"
              ? "Συνδεδεμένο"
              : status === "connecting"
                ? "Σύνδεση…"
                : "Αποσυνδεδεμένο"}
          </span>
        </div>
        {err ? <div className="err">{err}</div> : null}
      </div>

      {showTelemetry ? (
        <div className="card stack">
          <h2>Κατάσταση (από μητρική)</h2>
          {!state ? (
            <div className="empty-state" role="status">
              Δεν έχουν φτάσει ακόμα δεδομένα. Αν περνάει &gt;20s, έλεγξε Device
              ID και ότι η μητρική δημοσιεύει στο{" "}
              <code>{topics.state}</code>.
            </div>
          ) : null}
          <div className="grid2">
            <div>
              <div className="muted">Χώρος</div>
              <div className={`temp-big ${!state ? "temp-placeholder" : ""}`}>
                {fmtC(state?.room_c_x10)}
              </div>
            </div>
            <div>
              <div className="muted">Setpoint (συσκευή)</div>
              <div className={`temp-big ${!state ? "temp-placeholder" : ""}`}>
                {fmtC(state?.setpoint_c_x10)}
              </div>
            </div>
            <div>
              <div className="muted">Έξω</div>
              <div>{fmtC(state?.outdoor_c_x10)}</div>
            </div>
            <div>
              <div className="muted">Boiler νερό</div>
              <div>{fmtC(state?.boiler_c_x10)}</div>
            </div>
            <div>
              <div className="muted">Solar</div>
              <div>{fmtC(state?.solar_c_x10)}</div>
            </div>
            <div>
              <div className="muted">Supply / Return</div>
              <div>
                {fmtC(state?.supply_c_x10)} / {fmtC(state?.return_c_x10)}
              </div>
            </div>
          </div>
          {state ? (
            <>
              <div className="muted">
                HP {state.heat_pump ? "ON" : "off"} · P1{" "}
                {state.pump1 ? "ON" : "off"} · P2 {state.pump2 ? "ON" : "off"}{" "}
                · Heater {state.heater ? "ON" : "off"} · Flow{" "}
                {state.flow_sig_high ? "H" : "L"} · Defrost{" "}
                {state.defrost_active ? "ON" : "off"}
              </div>
              {relayPills}
            </>
          ) : null}
        </div>
      ) : (
        <div className="card stack">
          <h2>Κατάσταση (από μητρική)</h2>
          <div className="empty-state">
            Πάτα «Σύνδεση» για να δεις θερμοκρασίες και ρελέ από τη μητρική.
          </div>
        </div>
      )}

      <div className="card stack">
        <h2>Αλλαγή setpoint (εκτός σπιτιού)</h2>
        <div className="muted" style={{ marginTop: "-0.25rem" }}>
          Presets 19–25 και 26–35 · χρησιμοποίησε + για ενδιάμεσες τιμές.
        </div>
        <div className="thermo-quick thermo-quick-4">
          {QUICK_PRESETS_LOW.map((v) => (
            <button
              key={v}
              type="button"
              className={`secondary ${draftSp === v ? "preset-on" : ""}`}
              onClick={() => sendSetpointDirect(v)}
              disabled={status !== "on"}
            >
              {v} °C
            </button>
          ))}
        </div>
        <div className="thermo-quick thermo-quick-5">
          {QUICK_PRESETS_HIGH.map((v) => (
            <button
              key={v}
              type="button"
              className={`secondary ${draftSp === v ? "preset-on" : ""}`}
              onClick={() => sendSetpointDirect(v)}
              disabled={status !== "on"}
            >
              {v} °C
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="sp">Θερμοκρασία στόχος (°C, 5–35)</label>
          <div className="stepper">
            <button
              type="button"
              className="secondary"
              onClick={() => setDraftSp((v) => Math.max(5, v - 1))}
              disabled={status !== "on"}
            >
              -
            </button>
            <input
              id="sp"
              type="number"
              min={5}
              max={35}
              step={1}
              value={draftSp}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  setDraftSp(Math.min(35, Math.max(5, Math.round(n))));
                }
              }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => setDraftSp((v) => Math.min(35, v + 1))}
              disabled={status !== "on"}
            >
              +
            </button>
          </div>
        </div>
        <button
          type="button"
          className={[
            sendPulse ? "btn-flash-ok" : "",
            sendShake ? "btn-shake" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={sendSetpoint}
          disabled={status !== "on"}
        >
          Αποστολή στη μητρική
        </button>
        {sentHint ? (
          <div className="send-hint" role="status">
            {sentHint}
          </div>
        ) : null}
        <p className="muted">
          Στέλνει JSON στο <code>{topics.cmd}</code> · η οθόνη στο σπίτι θα δει τη
          νέα τιμή όταν ξανασυγχρονιστεί μέσω UDP (ίδιο setpoint στη μητρική).
        </p>
      </div>

      <div className="card stack">
        <h2>Boiler (χειροκίνητη εντολή)</h2>
        <div className="row boiler-row">
          <button
            type="button"
            className={[
              "secondary",
              heaterOnFromTelemetry === true ? "preset-on" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => sendBoiler(true)}
            disabled={status !== "on"}
          >
            Boiler ON
          </button>
          <button
            type="button"
            className={[
              "secondary",
              heaterOnFromTelemetry === false ? "boiler-off-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => sendBoiler(false)}
            disabled={status !== "on"}
          >
            Boiler OFF
          </button>
        </div>
        {heaterOnFromTelemetry !== null ? (
          <div className="muted" role="status">
            Κατάσταση από μητρική:{" "}
            <strong>{heaterOnFromTelemetry ? "Boiler ON" : "Boiler OFF"}</strong>
            {typeof state?.relay_k4 === "number" ? (
              <span>
                {" "}
                (K4 {state.relay_k4 ? "ON" : "off"})
              </span>
            ) : null}
          </div>
        ) : (
          <div className="muted">Περίμενε τηλεμετρία για ένδειξη ON/OFF.</div>
        )}
        <p className="muted">
          Στέλνει <code>{'{"heater":1|0}'}</code> στο <code>{topics.cmd}</code>.
          Η ένδειξη ON/OFF ενημερώνεται από το MQTT state (<code>heater</code> ή{" "}
          <code>relay_k4</code>).
        </p>
      </div>

      <div className="card stack">
        <h2>Οικογένεια</h2>
        <p className="muted">
          Πολλά κινητά μπορούν να χρησιμοποιούν την ίδια εφαρμογή με τα ίδια MQTT
          στοιχεία. Προτείνεται αλλαγή κωδικού όταν μοιράζεσαι πρόσβαση.
        </p>
        <p className="muted">
          Στην οθόνη του θερμοστάτη: η ένδειξη «σπίτι / Wi‑Fi» είναι το τοπικό
          δίκτυο· η «σύννεφο / internet» είναι η διαθεσιμότητα cloud (π.χ. MQTT).
          Δεν σημαίνει απαραίτητα «δύο Wi‑Fi ταυτόχρονα» — είναι δύο διαφορετικές
          πληροφορίες σύνδεσης.
        </p>
        <div className={`status-chip ${telemetryStale ? "warn" : ""}`}>
          {lastStateMs === null
            ? "Καμία τηλεμετρία ακόμα"
            : telemetryStale
              ? `Τελευταία ενημέρωση πριν ${staleSeconds}s`
              : `Live ενημέρωση (${staleSeconds}s πριν)`}
        </div>
      </div>
    </div>
  );
}
