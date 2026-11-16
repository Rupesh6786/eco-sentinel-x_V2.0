import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Wind, Flame, Sparkles, Thermometer, Droplets, Battery, Wifi, Cpu, ShieldCheck, AlertTriangle, FlaskConical, Lightbulb, ThermometerSun } from "lucide-react";
import { useTelemetry, classify, fmtTime, fmtUptime } from "@/lib/telemetry";
import { PageHeader, Panel, StatCard, Gauge, StatusBadge, ProgressBar, chartTooltip, axis } from "@/components/eco/widgets";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  head: () => meta("Command Center", "Live overview of every ESP32 sensor: AQI, gases, particulates, climate and power."),
  component: Dashboard,
});

// AQI scale segments (width is proportional to the 0-300 gauge range)
const AQI_SCALE = [
  { label: "Good", to: 50, cls: "bg-success/80" },
  { label: "Moderate", to: 100, cls: "bg-warning/80" },
  { label: "Sensitive", to: 150, cls: "bg-warning" },
  { label: "Unhealthy", to: 200, cls: "bg-destructive/80" },
  { label: "Very unhealthy", to: 300, cls: "bg-destructive" },
];

function AqiScale({ value }: { value: number }) {
  const pos = Math.min(100, Math.max(0, (value / 300) * 100));
  let prev = 0;
  return (
    <div className="mt-5 w-full">
      <div className="relative">
        <div className="flex h-2 w-full overflow-hidden rounded-full">
          {AQI_SCALE.map((s) => {
            const w = ((s.to - prev) / 300) * 100;
            prev = s.to;
            return <div key={s.label} className={s.cls} style={{ width: `${w}%` }} title={s.label} />;
          })}
        </div>
        <div className="absolute -top-1 h-4 w-0.5 rounded bg-foreground shadow" style={{ left: `calc(${pos}% - 1px)` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>0</span><span>50</span><span>100</span><span>150</span><span>200</span><span>300</span>
      </div>
    </div>
  );
}

function Dashboard() {
  const { readings, latest, settings, enabled } = useTelemetry();
  if (!latest) return <div className="p-10 text-muted-foreground">Waiting for telemetry…</div>;
  const data = readings.slice(-60).map((r) => ({ t: fmtTime(r.ts), ...r }));
  const aqiC = classify(latest.aqi, 100, 150);
  const alerts = [
    enabled("mq2") && latest.mq2_ppm >= settings.mq2_threshold && `Smoke/LPG ${latest.mq2_ppm.toFixed(0)} ppm exceeds limit`,
    enabled("mq7") && latest.mq7_ppm >= settings.mq7_threshold && `CO ${latest.mq7_ppm.toFixed(0)} ppm exceeds limit`,
    enabled("mq135") && latest.mq135_ppm >= settings.mq135_threshold && `MQ-135 ${latest.mq135_ppm.toFixed(0)} ppm exceeds limit`,
    enabled("dust") && latest.pm25 >= settings.pm25_threshold && `PM2.5 ${latest.pm25.toFixed(0)} µg/m³ exceeds limit`,
    enabled("power") && latest.battery_percent < 20 && "Battery low",
  ].filter(Boolean) as string[];
  const lux = latest.lux ?? 0;
  const probeOk = (latest.probe_temp ?? 0) !== 0;

  // Gas sensor config drives the cards, the chart series and threshold lines
  const gas = [
    { key: "mq2", dk: "mq2_ppm", name: "MQ-2 · Smoke/LPG", short: "MQ-2", color: "var(--chart-1)", axis: "l", thr: settings.mq2_threshold, max: 1000, v: latest.mq2_ppm, dec: 0, icon: <Flame className="h-4 w-4" />, label: "Smoke / LPG" },
    { key: "mq7", dk: "mq7_ppm", name: "MQ-7 · CO", short: "MQ-7 CO", color: "var(--chart-3)", axis: "r", thr: settings.mq7_threshold, max: 200, v: latest.mq7_ppm, dec: 1, icon: <Wind className="h-4 w-4" />, label: "Carbon Monoxide" },
    { key: "mq135", dk: "mq135_ppm", name: "MQ-135 · Air", short: "MQ-135", color: "var(--chart-2)", axis: "r", thr: settings.mq135_threshold, max: 500, v: latest.mq135_ppm, dec: 1, icon: <FlaskConical className="h-4 w-4" />, label: "Air Quality (MQ-135)" },
  ].filter((g) => enabled(g.key as "mq2" | "mq7" | "mq135"));
  const anyGas = gas.length > 0;
  const hasLeft = gas.some((g) => g.axis === "l");
  const hasRight = gas.some((g) => g.axis === "r");

  return (
    <div>
      <PageHeader code="01 / OVERVIEW" title="Command Center" subtitle="Every enabled sensor at a glance, streaming from Firestore in real time." />

      <div className={`panel mb-6 flex items-center gap-3 p-4 ${alerts.length ? "border-destructive/50" : "border-success/40"}`}>
        {alerts.length ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-success" />}
        <div className="text-sm">
          <span className="font-semibold">{alerts.length ? "Attention required" : "All systems nominal"}</span>
          <span className="ml-2 text-muted-foreground">{alerts.length ? alerts.join(" · ") : `Uptime ${fmtUptime(latest.uptime_s)} · RSSI ${latest.rssi} dBm`}</span>
        </div>
      </div>

      {/* ───────── Hero: AQI + gas analytics ───────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="Overall AQI" tag="PM2.5 DERIVED" className={`glow flex flex-col items-center ${anyGas ? "lg:col-span-5" : "lg:col-span-12"}`}>
          <Gauge value={latest.aqi} max={300} label="Air Quality Index" unit="AQI" warn={100} danger={150} size={240} />
          <div className="mt-2"><StatusBadge {...aqiC} /></div>
          <div className="mt-2 text-xs text-muted-foreground">PM2.5 {latest.pm25.toFixed(0)} µg/m³ · PM10 {latest.pm10.toFixed(0)} µg/m³</div>
          <AqiScale value={latest.aqi} />
          {anyGas && (
            <div className="mt-5 grid w-full grid-cols-3 gap-2 border-t pt-4 text-center">
              {gas.map((g) => (
                <Gauge key={g.key} value={g.v} max={g.max} label={g.short} unit="ppm" warn={g.thr * 0.7} danger={g.thr} size={104} />
              ))}
            </div>
          )}
        </Panel>

        {anyGas && (
          <div className="flex flex-col gap-4 lg:col-span-7">
            <div className={`grid grid-cols-1 gap-4 ${gas.length === 1 ? "sm:grid-cols-1" : gas.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
              {gas.map((g, i) => {
                const c = classify(g.v, g.thr * 0.7, g.thr);
                return (
                  <StatCard
                    key={g.key}
                    accent={i === 0}
                    label={g.label}
                    value={g.v.toFixed(g.dec)}
                    unit="ppm"
                    icon={g.icon}
                    sub={<span className="flex items-center justify-between gap-2"><StatusBadge {...c} /><Link to="/air-quality" className="text-primary">Details →</Link></span>}
                  />
                );
              })}
            </div>

            <Panel title="Gas Trends" tag="LIVE · 60 SAMPLES · DASHED = LIMIT" className="flex-1">
              <ResponsiveContainer width="100%" height={330}>
                <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    {gas.map((g) => (
                      <linearGradient key={g.key} id={`gas-${g.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={g.color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={g.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" {...axis} minTickGap={32} />
                  {hasLeft && <YAxis yAxisId="l" {...axis} width={44} />}
                  {hasRight && <YAxis yAxisId="r" orientation="right" {...axis} width={40} />}
                  <Tooltip {...chartTooltip} />
                  <Legend verticalAlign="top" align="right" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  {gas.map((g) => (
                    <ReferenceLine key={`thr-${g.key}`} yAxisId={g.axis} y={g.thr} stroke={g.color} strokeDasharray="5 4" strokeOpacity={0.55} />
                  ))}
                  {gas.map((g) => (
                    <Area key={g.key} yAxisId={g.axis} type="monotone" dataKey={g.dk} name={g.name} stroke={g.color} strokeWidth={2} fill={`url(#gas-${g.key})`} dot={false} activeDot={{ r: 4 }} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {hasLeft && "Left axis: MQ-2 (ppm). "}{hasRight && "Right axis: MQ-7 / MQ-135 (ppm)."}
              </div>
            </Panel>
          </div>
        )}
      </div>

      {/* ───────── Compact sensor cards ───────── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enabled("dust") && <StatCard label="PM2.5 / PM10" value={`${latest.pm25.toFixed(0)}/${latest.pm10.toFixed(0)}`} unit="µg/m³" icon={<Sparkles className="h-4 w-4" />} sub={<Link to="/particulate" className="text-primary">Particulates →</Link>} />}
        {enabled("env") && <>
          <StatCard label="Temperature" value={latest.temperature.toFixed(1)} unit="°C" icon={<Thermometer className="h-4 w-4" />} sub={<Link to="/environmental" className="text-primary">DHT11 →</Link>} />
          <StatCard label="Humidity" value={latest.humidity.toFixed(0)} unit="%" icon={<Droplets className="h-4 w-4" />} sub={latest.humidity > 70 ? "Humid" : latest.humidity < 30 ? "Dry" : "Comfortable"} />
        </>}
        <StatCard label="Light Intensity" value={lux >= 10000 ? `${(lux / 1000).toFixed(1)}k` : lux.toFixed(0)} unit="lx" icon={<Lightbulb className="h-4 w-4" />} sub={<Link to="/light" className="text-primary">Light details →</Link>} />
        <StatCard label="Probe Temp (DS18B20)" value={probeOk ? latest.probe_temp!.toFixed(1) : "—"} {...(probeOk ? { unit: "°C" } : {})} icon={<ThermometerSun className="h-4 w-4" />} sub={probeOk ? (enabled("env") ? `Ambient ${latest.temperature.toFixed(1)} °C` : "Dallas probe") : "Probe not detected"} />
        {enabled("power") && (
          <div className="panel p-4">
            <div className="flex justify-between text-xs uppercase tracking-wider text-muted-foreground"><span>Battery</span><Battery className="h-4 w-4 text-primary" /></div>
            <div className="mt-2 font-mono text-3xl font-bold">{latest.battery_percent.toFixed(0)}<span className="text-sm text-muted-foreground">%</span></div>
            <div className="mt-2"><ProgressBar value={latest.battery_percent} tone={latest.battery_percent < 20 ? "destructive" : "primary"} /></div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{latest.battery_voltage.toFixed(2)} V</span><span className="flex items-center gap-1"><Wifi className="h-3 w-3" />{latest.rssi} dBm</span><span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{(latest.free_heap / 1024).toFixed(0)} KB</span></div>
          </div>
        )}
      </div>

      {/* ───────── Trend charts ───────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {enabled("dust") && (
          <Panel title="Particulate Trend" tag="PM2.5 · PM10">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" {...axis} minTickGap={30} /><YAxis {...axis} />
                <Tooltip {...chartTooltip} />
                <Legend verticalAlign="top" align="right" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={settings.pm25_threshold} stroke="var(--destructive)" strokeDasharray="5 4" strokeOpacity={0.6} />
                <Area type="monotone" dataKey="pm10" name="PM10" stroke="var(--chart-2)" fill="none" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="pm25" name="PM2.5" stroke="var(--chart-1)" fill="url(#g1)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        )}
        <Panel title="Light Intensity" tag="LUX · 60 SAMPLES">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <defs><linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.4} /><stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={30} /><YAxis {...axis} />
              <Tooltip {...chartTooltip} />
              <Area type="monotone" dataKey="lux" name="Lux" stroke="var(--chart-3)" fill="url(#gl)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        {enabled("env") && (
          <Panel title="Temperature & Humidity" tag="DUAL AXIS">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" {...axis} minTickGap={30} />
                <YAxis yAxisId="l" {...axis} domain={["auto", "auto"]} /><YAxis yAxisId="r" orientation="right" {...axis} />
                <Tooltip {...chartTooltip} />
                <Legend verticalAlign="top" align="right" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" type="monotone" dataKey="temperature" name="Temp °C" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="humidity" name="Humidity %" stroke="var(--chart-4)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}
        <Panel title="Dallas Probe vs Ambient" tag="DS18B20 · °C">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={30} /><YAxis {...axis} domain={["auto", "auto"]} />
              <Tooltip {...chartTooltip} />
              <Legend verticalAlign="top" align="right" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="probe_temp" name="Probe °C" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="temperature" name="Ambient °C" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}
