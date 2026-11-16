import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Firestore } from "firebase/firestore";
import { firebaseReady } from "./firebase";
import { useAuth, type SensorKey } from "./auth";

export type Reading = {
  id: string;
  ts: number;
  deviceId: string;
  mq2_ppm: number;
  mq7_ppm: number;
  mq135_ppm: number;
  pm25: number;
  pm10: number;
  dust_density: number;
  temperature: number;
  humidity: number;
  battery_voltage: number;
  battery_percent: number;
  boost_voltage: number;
  charging: boolean;
  rssi: number;
  free_heap: number;
  uptime_s: number;
  aqi: number;
  // --- added fields (firmware: environment / air / power / esp32s3 / link) ---
  lux: number;
  probe_temp: number; // Dallas DS18B20, 0 when probe missing
  pressure?: number | undefined;
  dew_point?: number | undefined;
  dust_vo_v?: number | undefined;
  dust_baseline_v?: number | undefined;
  dust_ok?: boolean | undefined;
  current_ma?: number | undefined;
  power_mw?: number | undefined;
  charge_complete?: boolean | undefined;
  chip_temp?: number | undefined;
  cpu_mhz?: number | undefined;
  cores?: number | undefined;
  chip_rev?: number | undefined;
  flash_mb?: number | undefined;
  psram_total?: number | undefined;
  psram_free?: number | undefined;
  heap_min?: number | undefined;
  frame_ms?: number | undefined;
  wifi_ok?: boolean | undefined;
  sd_ok?: boolean | undefined;
  uploads_ok?: number | undefined;
  uploads_failed?: number | undefined;
};

export type Settings = {
  sample_interval_s: number;
  buzzer_enabled: boolean;
  mq2_threshold: number;
  mq7_threshold: number;
  mq135_threshold: number;
  pm25_threshold: number;
  wifi_ssid: string;
  mqtt_broker: string;
  firmware_version: string;
};

export const defaultSettings: Settings = {
  sample_interval_s: 10,
  buzzer_enabled: true,
  mq2_threshold: 300,
  mq7_threshold: 50,
  mq135_threshold: 100,
  pm25_threshold: 60,
  wifi_ssid: "",
  mqtt_broker: "",
  firmware_version: "1.0.0",
};

export type TelemetryStatus = "connecting" | "live" | "demo" | "error";

type Ctx = {
  readings: Reading[]; // oldest -> newest
  latest: Reading | null;
  status: TelemetryStatus;
  error: string | null;
  db: Firestore | null;
  nodeId: string | null;
  settings: Settings;
  enabled: (k: SensorKey) => boolean;
  saveSettings: (s: Settings) => Promise<void>;
};

const TelemetryContext = createContext<Ctx | null>(null);

const num = (v: unknown, d = 0) => (typeof v === "number" && !Number.isNaN(v) ? v : typeof v === "string" && v !== "" && !Number.isNaN(+v) ? +v : d);

function toMs(v: any): number {
  if (!v) return Date.now();
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") return new Date(v).getTime();
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return Date.now();
}

export function computeAqi(pm25: number) {
  const bp: [number, number, number, number][] = [
    [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500, 301, 500],
  ];
  for (const [cl, ch, il, ih] of bp) if (pm25 <= ch) return Math.round(((ih - il) / (ch - cl)) * (pm25 - cl) + il);
  return 500;
}

const onum = (v: unknown): number | undefined => (typeof v === "number" && !Number.isNaN(v) ? v : undefined);
const obool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

// Supports the nested firmware payload (environment / gas / air / power / esp32s3 / link)
// and keeps the older flat / alternate field names as fallbacks.
function normalize(id: string, d: any): Reading {
  const env = d.environment ?? {}, gas = d.gas ?? {}, air = d.air ?? d.particulate ?? {};
  const pw = d.power ?? {}, hw = d.esp32s3 ?? d.system ?? {}, lk = d.link ?? d.system ?? {};
  const pm25 = num(d.pm25 ?? air.pm25);
  return {
    id,
    ts: toMs(d.timestamp ?? d.ts ?? d.createdAt),
    deviceId: d.deviceId ?? "esp32",
    mq2_ppm: num(d.mq2_ppm ?? gas.mq2_ppm),
    mq7_ppm: num(d.mq7_ppm ?? gas.mq7_ppm),
    mq135_ppm: num(d.mq135_ppm ?? gas.mq135_ppm),
    pm25,
    pm10: num(d.pm10 ?? air.pm10),
    dust_density: num(d.dust_density ?? air.dust_mg_m3 ?? air.dust_density),
    temperature: num(d.temperature ?? env.temperature_c ?? env.temperature),
    humidity: num(d.humidity ?? env.humidity_pct ?? env.humidity),
    battery_voltage: num(d.battery_voltage ?? pw.battery_v ?? pw.battery_voltage),
    battery_percent: num(d.battery_percent ?? pw.battery_pct ?? pw.battery_percent),
    boost_voltage: num(d.boost_voltage ?? pw.boost_v ?? pw.boost_voltage),
    charging: Boolean(d.charging ?? pw.charging),
    rssi: num(d.rssi ?? lk.rssi_dbm ?? lk.rssi, -100),
    free_heap: num(d.free_heap ?? hw.heap_free ?? hw.free_heap),
    uptime_s: num(d.uptime_s ?? hw.uptime_s),
    aqi: num(d.aqi ?? air.aqi, computeAqi(pm25)),
    lux: num(d.lux ?? env.lux),
    probe_temp: num(d.probe_temp ?? env.probe_temperature_c),
    pressure: onum(env.pressure_hpa),
    dew_point: onum(env.dew_point_c),
    dust_vo_v: onum(air.dust_vo_v),
    dust_baseline_v: onum(air.dust_baseline_v),
    dust_ok: obool(air.dust_sensor_ok),
    current_ma: onum(pw.current_ma),
    power_mw: onum(pw.power_mw),
    charge_complete: obool(pw.charge_complete),
    chip_temp: onum(hw.chip_temp_c),
    cpu_mhz: onum(hw.cpu_mhz),
    cores: onum(hw.cores),
    chip_rev: onum(hw.chip_rev),
    flash_mb: onum(hw.flash_mb),
    psram_total: onum(hw.psram_total),
    psram_free: onum(hw.psram_free),
    heap_min: onum(hw.heap_min),
    frame_ms: onum(hw.frame_ms),
    wifi_ok: obool(lk.wifi_ok),
    sd_ok: obool(lk.sd_ok),
    uploads_ok: onum(lk.uploads_ok),
    uploads_failed: onum(lk.uploads_failed),
  };
}

function demoData(): Reading[] {
  const now = Date.now();
  const out: Reading[] = [];
  for (let i = 119; i >= 0; i--) {
    const t = now - i * 60_000;
    const w = Math.sin(i / 9);
    const spike = i % 37 < 3 ? 40 : 0;
    const pm25 = Math.max(4, 28 + w * 14 + spike + Math.random() * 6);
    out.push({
      id: `demo-${i}`, ts: t, deviceId: "esp32_node_01",
      mq2_ppm: 180 + w * 60 + Math.random() * 30 + spike * 3,
      mq7_ppm: 18 + w * 8 + Math.random() * 4 + spike / 3,
      mq135_ppm: 55 + w * 25 + Math.random() * 10 + spike,
      pm25, pm10: pm25 * 1.6 + Math.random() * 8,
      dust_density: pm25 / 1000 + 0.02,
      temperature: 29 + Math.cos(i / 20) * 3 + Math.random(),
      humidity: 58 + Math.sin(i / 15) * 10 + Math.random() * 2,
      battery_voltage: 3.7 + (120 - i) * 0.003, battery_percent: Math.min(100, 62 + (120 - i) * 0.25),
      boost_voltage: 5.02 + Math.random() * 0.05, charging: true,
      rssi: -58 - Math.round(Math.random() * 12), free_heap: 182000 - Math.round(Math.random() * 15000),
      uptime_s: (240 - i) * 60, aqi: computeAqi(pm25),
      lux: Math.max(0, 450 + Math.sin(i / 12) * 300 + Math.random() * 60),
      probe_temp: 27.5 + Math.cos(i / 20) * 2.5 + Math.random() * 0.4,
      pressure: 1008 + Math.sin(i / 30) * 2, dew_point: 20 + Math.random(),
      dust_vo_v: 0.6 + Math.random() * 0.05, dust_baseline_v: 0.55, dust_ok: true,
      current_ma: 120 + Math.random() * 30, power_mw: 600 + Math.random() * 100, charge_complete: false,
      chip_temp: 46 + Math.random() * 4, cpu_mhz: 240, cores: 2, chip_rev: 2, flash_mb: 16,
      psram_total: 8388608, psram_free: 8100000 - Math.round(Math.random() * 20000),
      heap_min: 150000, frame_ms: 40 + Math.random() * 10,
      wifi_ok: true, sd_ok: true, uploads_ok: 1000 - i, uploads_failed: 2,
    });
  }
  return out;
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, profile } = useAuth();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [status, setStatus] = useState<TelemetryStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const nodeId = authStatus === "ready" && profile ? profile.nodeId : null;

  useEffect(() => {
    if (!nodeId) return;
    let unsubs: (() => void)[] = [];
    let cancelled = false;
    (async () => {
      try {
        const { firestore } = await firebaseReady();
        const fs = await import("firebase/firestore");
        if (cancelled) return;
        setDb(firestore);
        const q = fs.query(fs.collection(firestore, "nodes", nodeId, "readings"), fs.orderBy("timestamp", "desc"), fs.limit(500));
        unsubs.push(
          fs.onSnapshot(q, (snap) => {
            if (snap.empty) { setReadings(demoData()); setStatus("demo"); return; }
            const rows = snap.docs.map((d) => normalize(d.id, d.data())).sort((a, b) => a.ts - b.ts);
            setReadings(rows); setStatus("live"); setError(null);
          }, (e) => { setError(e.message); setReadings(demoData()); setStatus("error"); }),
        );
        unsubs.push(
          fs.onSnapshot(fs.doc(firestore, "nodes", nodeId, "settings", "config"), (s) => {
            if (s.exists()) setSettings({ ...defaultSettings, ...(s.data() as Partial<Settings>) });
          }, () => {}),
        );
      } catch (e: any) {
        setError(e?.message ?? String(e)); setReadings(demoData()); setStatus("error");
      }
    })();
    return () => { cancelled = true; unsubs.forEach((u) => u()); };
  }, [nodeId]);

  const value = useMemo<Ctx>(() => ({
    readings,
    latest: readings.at(-1) ?? null,
    status,
    error,
    db,
    nodeId,
    settings,
    enabled: (k: SensorKey) => (profile ? profile.sensors.includes(k) : true),
    saveSettings: async (s: Settings) => {
      if (!db || !nodeId) throw new Error("Firestore not connected");
      const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
      await setDoc(doc(db, "nodes", nodeId, "settings", "config"), { ...s, updatedAt: serverTimestamp() }, { merge: true });
    },
  }), [readings, status, error, db, nodeId, settings, profile]);

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): Ctx {
  const c = useContext(TelemetryContext);
  if (!c) throw new Error("useTelemetry outside provider");
  return c;
}

export function classify(value: number, warn: number, danger: number) {
  if (value >= danger) return { label: "Hazardous", tone: "destructive" as const };
  if (value >= warn) return { label: "Moderate", tone: "warning" as const };
  return { label: "Good", tone: "success" as const };
}

export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (ts: number) => new Date(ts).toLocaleString();
export const fmtUptime = (s: number) => `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
