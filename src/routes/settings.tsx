import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Moon, Save, Sun } from "lucide-react";
import { useTelemetry, type Settings } from "@/lib/telemetry";
import { useAuth, SENSOR_KEYS, SENSOR_META } from "@/lib/auth";
import { DASHBOARD_THEMES, type ThemeMode } from "@/lib/themes";
import { PageHeader, Panel } from "@/components/eco/widgets";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/settings")({
  head: () => meta("Settings & Calibration", "Choose your sensors, alarm thresholds, sampling and Wi-Fi config for your ESP32 node."),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, saveSettings, nodeId } = useTelemetry();
  const { profile, setSensorEnabled, setAppearance } = useAuth();
  const [s, setS] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setS(settings), [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await saveSettings(s);
      toast.success("Settings saved — your ESP32 will pick them up on next sync");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function toggle(k: (typeof SENSOR_KEYS)[number], on: boolean) {
    try { await setSensorEnabled(k, on); toast.success(`${SENSOR_META[k].label} ${on ? "shown" : "hidden"} on every page`); }
    catch (e: any) { toast.error(e.message); }
  }

  async function changeAppearance(themeId: number, themeMode: ThemeMode) {
    try {
      await setAppearance(themeId, themeMode);
      toast.success("Dashboard appearance saved");
    } catch (e: any) { toast.error(e.message); }
  }

  const numField = (k: keyof Settings, label: string, unit: string) => (
    <div className="space-y-1.5">
      <Label>{label} <span className="text-muted-foreground">({unit})</span></Label>
      <Input type="number" value={s[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />
    </div>
  );

  return (
    <div>
      <PageHeader code="07 / CONFIG" title="System Settings & Calibration" subtitle="Choose your sensors and tune your node. Changes are saved to your node's Firestore path." />
      <Panel title="Dashboard Appearance" tag="SAVED TO YOUR ACCOUNT" className="mb-4">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Color mode</div>
            <div className="text-xs text-muted-foreground">Choose a light or dark dashboard.</div>
          </div>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((mode) => (
              <Button key={mode} variant={profile?.themeMode === mode ? "default" : "outline"} size="sm" onClick={() => profile && changeAppearance(profile.themeId, mode)} aria-pressed={profile?.themeMode === mode}>
                {mode === "dark" ? <Moon /> : <Sun />}{mode === "dark" ? "Dark" : "Light"}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {DASHBOARD_THEMES.map((theme) => (
            <Button key={theme.id} variant="outline" aria-pressed={profile?.themeId === theme.id} onClick={() => profile && changeAppearance(theme.id, profile.themeMode)} className={`theme-choice justify-start ${profile?.themeId === theme.id ? "theme-choice-active" : ""}`}>
              <span className="theme-swatch" data-theme={theme.id} aria-hidden="true" />
              <span className="truncate">{theme.name}</span>
              {profile?.themeId === theme.id && <span className="sr-only">Selected</span>}
            </Button>
          ))}
        </div>
      </Panel>
      <Panel title="My Sensors" tag="SHOWN ON ALL PAGES" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SENSOR_KEYS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div><div className="text-sm font-medium">{SENSOR_META[k].label}</div><div className="text-xs text-muted-foreground">{SENSOR_META[k].desc}</div></div>
              <Switch checked={profile?.sensors.includes(k) ?? true} onCheckedChange={(v) => toggle(k, v)} aria-label={SENSOR_META[k].label} />
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sampling">
          <div className="space-y-4">
            {numField("sample_interval_s", "Upload interval", "seconds")}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><div className="text-sm font-medium">Alarm buzzer</div><div className="text-xs text-muted-foreground">Sound buzzer when any threshold is exceeded</div></div>
              <Switch checked={s.buzzer_enabled} onCheckedChange={(v) => set("buzzer_enabled", v)} />
            </div>
          </div>
        </Panel>
        <Panel title="Alarm Thresholds">
          <div className="grid gap-4 sm:grid-cols-2">
            {numField("mq2_threshold", "MQ-2", "ppm")}
            {numField("mq7_threshold", "MQ-7", "ppm")}
            {numField("mq135_threshold", "MQ-135", "ppm")}
            {numField("pm25_threshold", "PM2.5", "µg/m³")}
          </div>
        </Panel>
        <Panel title="Connectivity">
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Wi-Fi SSID</Label><Input value={s.wifi_ssid} onChange={(e) => set("wifi_ssid", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>MQTT broker</Label><Input placeholder="mqtt://broker:1883" value={s.mqtt_broker} onChange={(e) => set("mqtt_broker", e.target.value)} /></div>
          </div>
        </Panel>
        <Panel title="Firmware" tag="ESP32">
          <div className="space-y-2 font-mono text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="text-primary">{settings.firmware_version}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Settings doc</span><span className="truncate">nodes/{nodeId}/settings/config</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Readings</span><span className="truncate">nodes/{nodeId}/readings</span></div>
          </div>
        </Panel>
      </div>
      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={save} disabled={saving} className="font-semibold"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save to Firestore"}</Button>
      </div>
    </div>
  );
}
