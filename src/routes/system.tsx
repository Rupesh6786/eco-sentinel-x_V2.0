import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Cpu, HardDrive, MemoryStick, Search, Wifi, Timer } from "lucide-react";
import { useTelemetry, fmtDateTime, fmtUptime, type Reading } from "@/lib/telemetry";
import { PageHeader, Panel, StatCard, StatusBadge } from "@/components/eco/widgets";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/system")({
  head: () => meta("System Logs", "ESP32-S3 diagnostics, link health and an event log derived from device telemetry."),
  component: SystemLogs,
});

type Level = "critical" | "warning" | "info";
type Evt = { ts: number; level: Level; source: string; message: string };

const tone = (l: Level) => (l === "critical" ? "destructive" : l === "warning" ? "warning" : "success") as "destructive" | "warning" | "success";
const mb = (b?: number) => (b === undefined ? "—" : `${(b / 1048576).toFixed(2)} MB`);
const kb = (b?: number) => (b === undefined ? "—" : `${(b / 1024).toFixed(0)} KB`);

function buildEvents(readings: Reading[], th: { mq2: number; mq7: number; mq135: number; pm25: number }): Evt[] {
  const rs = [...readings].sort((a, b) => a.ts - b.ts);
  const out: Evt[] = [];
  const add = (ts: number, level: Level, source: string, message: string) => out.push({ ts, level, source, message });
  rs.forEach((r, i) => {
    const p = rs[i - 1];
    if (!p) { add(r.ts, "info", "SYSTEM", `First packet in window (uptime ${fmtUptime(r.uptime_s)})`); return; }
    if (r.uptime_s < p.uptime_s) add(r.ts, "warning", "SYSTEM", "Device rebooted (uptime reset)");
    if (p.wifi_ok !== false && r.wifi_ok === false) add(r.ts, "critical", "WIFI", "Wi-Fi connection lost");
    if (p.wifi_ok === false && r.wifi_ok !== false) add(r.ts, "info", "WIFI", `Wi-Fi reconnected (${r.rssi} dBm)`);
    if (p.sd_ok !== false && r.sd_ok === false) add(r.ts, "critical", "SD", "SD card not available");
    if (p.sd_ok === false && r.sd_ok !== false) add(r.ts, "info", "SD", "SD card recovered");
    if (p.dust_ok !== false && r.dust_ok === false) add(r.ts, "warning", "DUST", "Dust sensor fault detected");
    if (p.dust_ok === false && r.dust_ok !== false) add(r.ts, "info", "DUST", "Dust sensor recovered");
    if (!p.charging && r.charging) add(r.ts, "info", "POWER", "Charging started");
    if (p.charging && !r.charging) add(r.ts, "info", "POWER", "Charging stopped");
    if (!p.charge_complete && r.charge_complete) add(r.ts, "info", "POWER", "Battery fully charged");
    if (p.battery_percent >= 20 && r.battery_percent < 20) add(r.ts, "warning", "POWER", `Battery low (${r.battery_percent.toFixed(0)}%)`);
    if ((r.uploads_failed ?? 0) > (p.uploads_failed ?? 0)) add(r.ts, "warning", "UPLOAD", `Upload failure (total ${r.uploads_failed})`);
    if (r.rssi > -200 && p.rssi > -75 && r.rssi <= -75) add(r.ts, "warning", "WIFI", `Weak signal (${r.rssi} dBm)`);
    if (p.mq2_ppm < th.mq2 && r.mq2_ppm >= th.mq2) add(r.ts, "critical", "MQ-2", `Smoke/LPG ${r.mq2_ppm.toFixed(0)} ppm over limit`);
    if (p.mq7_ppm < th.mq7 && r.mq7_ppm >= th.mq7) add(r.ts, "critical", "MQ-7", `CO ${r.mq7_ppm.toFixed(0)} ppm over limit`);
    if (p.mq135_ppm < th.mq135 && r.mq135_ppm >= th.mq135) add(r.ts, "critical", "MQ-135", `Air quality ${r.mq135_ppm.toFixed(0)} ppm over limit`);
    if (p.pm25 < th.pm25 && r.pm25 >= th.pm25) add(r.ts, "critical", "DUST", `PM2.5 ${r.pm25.toFixed(0)} µg/m³ over limit`);
    if ((p.chip_temp ?? 0) < 80 && (r.chip_temp ?? 0) >= 80) add(r.ts, "warning", "SYSTEM", `Chip temperature high (${r.chip_temp?.toFixed(1)} °C)`);
  });
  return out.sort((a, b) => b.ts - a.ts);
}

function SystemLogs() {
  const { readings, latest, settings } = useTelemetry();
  const [q, setQ] = useState("");
  const [lvl, setLvl] = useState<"all" | Level>("all");
  const [page, setPage] = useState(0);
  const PAGE = 20;

  const events = useMemo(
    () => buildEvents(readings, { mq2: settings.mq2_threshold, mq7: settings.mq7_threshold, mq135: settings.mq135_threshold, pm25: settings.pm25_threshold }),
    [readings, settings],
  );
  if (!latest) return null;

  const rows = events.filter((e) => (lvl === "all" || e.level === lvl) && (!q || `${e.source} ${e.message} ${fmtDateTime(e.ts)}`.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const count = (l: Level) => events.filter((e) => e.level === l).length;
  const psramUsed = latest.psram_total ? 100 - ((latest.psram_free ?? 0) / latest.psram_total) * 100 : undefined;
  const wifiOk = latest.wifi_ok !== false;
  const sdOk = latest.sd_ok !== false;

  const kv = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1.5 last:border-0"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>
  );

  return (
    <div>
      <PageHeader code="10 / SYSTEM" title="System Logs" subtitle="ESP32-S3 diagnostics, link health and a device event log derived from telemetry." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard accent label="Uptime" value={fmtUptime(latest.uptime_s)} icon={<Timer className="h-4 w-4" />} />
        <StatCard label="Chip Temp" value={latest.chip_temp !== undefined ? latest.chip_temp.toFixed(1) : "—"} unit="°C" icon={<Cpu className="h-4 w-4" />} />
        <StatCard label="Wi-Fi" value={wifiOk ? "Online" : "Offline"} icon={<Wifi className="h-4 w-4" />} sub={`${latest.rssi} dBm`} />
        <StatCard label="SD Card" value={sdOk ? "OK" : "Fault"} icon={<HardDrive className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="ESP32-S3" tag="CHIP">
          <div className="font-mono text-sm">
            {kv("CPU", `${latest.cpu_mhz ?? "—"} MHz × ${latest.cores ?? "—"} cores`)}
            {kv("Chip revision", latest.chip_rev ?? "—")}
            {kv("Flash", latest.flash_mb !== undefined ? `${latest.flash_mb} MB` : "—")}
            {kv("Frame time", latest.frame_ms !== undefined ? `${latest.frame_ms.toFixed(1)} ms` : "—")}
            {kv("Device", latest.deviceId ?? "—")}
          </div>
        </Panel>
        <Panel title="Memory" tag="HEAP · PSRAM">
          <div className="font-mono text-sm">
            {kv("Heap free", kb(latest.free_heap))}
            {kv("Heap min (low-water)", kb(latest.heap_min))}
            {kv("PSRAM total", mb(latest.psram_total))}
            {kv("PSRAM free", mb(latest.psram_free))}
            {kv("PSRAM used", psramUsed !== undefined ? `${psramUsed.toFixed(1)} %` : "—")}
          </div>
          <MemoryStick className="mt-3 h-4 w-4 text-muted-foreground" />
        </Panel>
        <Panel title="Link & Uploads" tag="NETWORK">
          <div className="font-mono text-sm">
            {kv("Wi-Fi", <StatusBadge label={wifiOk ? "Connected" : "Down"} tone={wifiOk ? "success" : "destructive"} />)}
            {kv("RSSI", `${latest.rssi} dBm`)}
            {kv("SD card", <StatusBadge label={sdOk ? "Mounted" : "Fault"} tone={sdOk ? "success" : "destructive"} />)}
            {kv("Uploads OK", latest.uploads_ok ?? "—")}
            {kv("Uploads failed", latest.uploads_failed ?? "—")}
          </div>
        </Panel>
      </div>

      <Panel title="Event Log" tag={`${rows.length} EVENTS`} className="mt-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search events…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          {(["all", "critical", "warning", "info"] as const).map((l) => (
            <Button key={l} size="sm" variant={lvl === l ? "default" : "outline"} onClick={() => { setLvl(l); setPage(0); }}>
              {l === "all" ? `All (${events.length})` : `${l[0]!.toUpperCase()}${l.slice(1)} (${count(l)})`}
            </Button>
          ))}
        </div>
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-max min-w-full text-sm">
            <thead className="bg-secondary">
              <tr>{["Time", "Level", "Source", "Message"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">{h}</th>)}</tr>
            </thead>
            <tbody className="font-mono">
              {view.map((e, i) => (
                <tr key={`${e.ts}-${i}`} className="border-t hover:bg-accent/40">
                  <td className="whitespace-nowrap px-3 py-2">{fmtDateTime(e.ts)}</td>
                  <td className="whitespace-nowrap px-3 py-2"><StatusBadge label={e.level.toUpperCase()} tone={tone(e.level)} /></td>
                  <td className="whitespace-nowrap px-3 py-2">{e.source}</td>
                  <td className="whitespace-nowrap px-3 py-2">{e.message}</td>
                </tr>
              ))}
              {!view.length && <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No events match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
