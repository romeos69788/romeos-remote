/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MQTT_WS_URL?: string;
  readonly VITE_MQTT_USER?: string;
  readonly VITE_MQTT_PASS?: string;
  readonly VITE_MQTT_DEVICE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
