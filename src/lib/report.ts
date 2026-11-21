// src/lib/report.ts
// Builds the 3-page Eco-Sentinal-X daily report as a PDF in the browser.
// Charts are drawn as vector graphics with jsPDF, so no extra chart library is needed.
import type { jsPDF } from "jspdf";
import { computeAqi, type Reading } from "./telemetry";

export type ReportThresholds = { mq2: number; mq7: number; mq135: number; pm25: number };
export type ReportInput = {
  readings: Reading[];
  day: Date; // any time on the day being reported (local time)
  nodeId: string;
  thresholds: ReportThresholds;
  sample?: boolean;
};

// ---------------------------------------------------------------- constants
const PW = 595.28, PH = 841.89, M = 34, CW = PW - 2 * M;
const C = { ink: "#161614", yel: "#FAD61E", teal: "#12A594", blue: "#3B6FE0", red: "#E5484D", org: "#F2842B", purp: "#8E4EC6", grey: "#6B6B66", light: "#F5F4EF", line: "#E4E2DA", gold: "#D4A800", white: "#FFFFFF", mute: "#BDBBB2" };
const SITE = "Eco-Sentinal-X";
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const tint = (h: string, a: number): RGB => hex(h).map((v) => Math.round(255 - (255 - v) * a)) as RGB;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const fmt = (v: number | undefined | null, d = 1) => (isNum(v) ? v.toFixed(d) : "-");

function aqiCat(a: number) {
  if (a <= 50) return { label: "Good", color: "#2FA84F", text: C.white };
  if (a <= 100) return { label: "Moderate", color: "#F2C500", text: C.ink };
  if (a <= 150) return { label: "Unhealthy for sensitive groups", color: "#F28C28", text: C.white };
  if (a <= 200) return { label: "Unhealthy", color: C.red, text: C.white };
  if (a <= 300) return { label: "Very unhealthy", color: "#8F3F97", text: C.white };
  return { label: "Hazardous", color: "#7E0023", text: C.white };
}
const dewComfort = (d: number) => (d < 10 ? "dry and comfortable" : d < 16 ? "comfortable" : d < 18 ? "slightly humid" : d < 21 ? "humid" : d < 24 ? "oppressive" : "miserable");
const outlook = (d: number) =>
  d <= -3 ? "a rapid fall that often signals stormy or unsettled weather"
  : d < -1 ? "falling pressure, so cloud build-up or showers become more likely"
  : d >= 3 ? "a rapid rise that usually brings clearing, windier conditions"
  : d > 1 ? "rising pressure, so conditions are improving"
  : "steady pressure, so no major change is expected";

// ---------------------------------------------------------------- data helpers
type Pt = { x: number; y: number }; // x = hour of day (0..24)

function bucketSeries(rs: Reading[], start: number, pick: (r: Reading) => number | undefined, bucketMin = 15): Pt[] {
  const n = (24 * 60) / bucketMin;
  const sum = new Array<number>(n).fill(0), cnt = new Array<number>(n).fill(0);
  for (const r of rs) {
    const v = pick(r);
    if (!isNum(v)) continue;
    const i = Math.min(n - 1, Math.floor((r.ts - start) / (bucketMin * 60_000)));
    if (i < 0) continue;
    sum[i]! += v; cnt[i]! += 1;
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (cnt[i]) out.push({ x: ((i + 0.5) * bucketMin) / 60, y: sum[i]! / cnt[i]! });
  return out;
}

type Stat = { min: number; avg: number; max: number; tMax: number; tMin: number };
function stat(rs: Reading[], pick: (r: Reading) => number | undefined): Stat | null {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, tMax = 0, tMin = 0;
  for (const r of rs) {
    const v = pick(r);
    if (!isNum(v)) continue;
    if (v < min) { min = v; tMin = r.ts; }
    if (v > max) { max = v; tMax = r.ts; }
    sum += v; n++;
  }
  return n ? { min, avg: sum / n, max, tMax, tMin } : null;
}

type Evt = { ts: number; level: "critical" | "warning" | "info"; source: string; message: string };
function buildEvents(rs: Reading[], th: ReportThresholds): Evt[] {
  const out: Evt[] = [];
  const add = (ts: number, level: Evt["level"], source: string, message: string) => out.push({ ts, level, source, message });
  rs.forEach((r, i) => {
    const p = rs[i - 1];
    if (!p) { add(r.ts, "info", "SYSTEM", "First packet of the day"); return; }
    if (r.uptime_s < p.uptime_s) add(r.ts, "warning", "SYSTEM", "Device rebooted (uptime reset)");
    if (p.wifi_ok !== false && r.wifi_ok === false) add(r.ts, "critical", "WIFI", "Wi-Fi connection lost");
    if (p.wifi_ok === false && r.wifi_ok !== false) add(r.ts, "info", "WIFI", `Wi-Fi reconnected (${r.rssi} dBm)`);
    if (p.sd_ok !== false && r.sd_ok === false) add(r.ts, "critical", "SD", "SD card not available");
    if (p.dust_ok !== false && r.dust_ok === false) add(r.ts, "warning", "DUST", "Dust sensor fault detected");
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

// ---------------------------------------------------------------- drawing kit
// Round an automatic axis to 4 even, human-friendly steps (1, 2, 2.5, 5 x 10^n).
function niceRange(lo: number, hi: number, fixLo?: number, fixHi?: number): [number, number] {
  const raw = (hi - lo) / 4;
  if (!(raw > 0) || fixLo !== undefined && fixHi !== undefined) return [lo, hi];
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [mag, mag * 10]) for (const f of [1, 2, 2.5, 5, 10]) {
    const st = f * m;
    if (st < raw - 1e-12) continue;
    if (fixLo !== undefined) { if (fixLo + 4 * st >= hi - 1e-9) return [fixLo, fixLo + 4 * st]; }
    else if (fixHi !== undefined) { if (fixHi - 4 * st <= lo + 1e-9) return [fixHi - 4 * st, fixHi]; }
    else { const l = Math.floor(lo / st + 1e-9) * st; if (l + 4 * st >= hi - 1e-9) return [l, l + 4 * st]; }
  }
  return [lo, hi];
}

type Line = { name: string; color: string; pts: Pt[]; fillTo?: number; width?: number };
type Ref = { y: number; color: string; label: string };

class Kit {
  doc: jsPDF;
  // visible part of the day on every time-axis chart (hours, 0..24); set from the data in buildReport
  xLo = 0;
  xHi = 24;
  // a silence longer than this (hours) breaks a line chart instead of being bridged
  gapH = 0.5;
  constructor(doc: jsPDF) { this.doc = doc; }
  fill(h: string) { this.doc.setFillColor(...hex(h)); }
  stroke(h: string) { this.doc.setDrawColor(...hex(h)); }
  ink(h: string) { this.doc.setTextColor(...hex(h)); }
  text(s: string, x: number, y: number, size = 8, color = C.ink, bold = false, align: "left" | "right" | "center" = "left") {
    this.doc.setFont("helvetica", bold ? "bold" : "normal"); this.doc.setFontSize(size); this.ink(color);
    this.doc.text(s, x, y, { align });
  }
  rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, r = 0) {
    if (fill) this.fill(fill);
    if (stroke) { this.stroke(stroke); this.doc.setLineWidth(0.6); }
    const style = fill && stroke ? "FD" : fill ? "F" : "S";
    if (r) this.doc.roundedRect(x, y, w, h, r, r, style); else this.doc.rect(x, y, w, h, style);
  }
  poly(pts: [number, number][], fillRgb: RGB) {
    if (pts.length < 3) return;
    this.doc.setFillColor(...fillRgb);
    const [x0, y0] = pts[0]!;
    const seg = pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]);
    this.doc.lines(seg, x0, y0, [1, 1], "F", true);
  }
  polyline(pts: [number, number][], color: string, width: number) {
    this.stroke(color); this.doc.setLineWidth(width);
    if (pts.length === 1) { this.fill(color); this.doc.circle(pts[0]![0], pts[0]![1], width, "F"); return; }
    const [x0, y0] = pts[0]!;
    const seg = pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]);
    this.doc.lines(seg, x0, y0, [1, 1], "S", false);
  }
  stripe(y: number, h: number) {
    this.rect(0, y, PW, h, C.ink);
    for (let x = 0; x < PW; x += 16) this.poly([[x, y + h], [x + 8, y + h], [x + 8 + h, y], [x + h, y]], hex(C.yel));
  }
  logo(x: number, y: number, s: number) {
    this.rect(x, y, s, s, C.yel, undefined, 6);
    const cx = x + s / 2, cy = y + s / 2;
    this.fill(C.ink); this.doc.circle(cx, cy, s * 0.09, "F");
    this.stroke(C.ink); this.doc.setLineWidth(1.2);
    this.doc.circle(cx, cy, s * 0.22, "S"); this.doc.circle(cx, cy, s * 0.36, "S");
  }
  card(x: number, y: number, w: number, h: number, title: string, unit: string, color: string) {
    this.rect(x, y, w, h, C.white, C.line, 5);
    this.rect(x + 9, y + 7, 3, 8, color);
    this.text(title, x + 16, y + 14, 8, C.ink, true);
    if (unit) this.text(unit, x + w - 9, y + 14, 6.5, C.grey, false, "right");
  }
  section(y: number, label: string, sub = "") {
    this.rect(M, y, 4, 12, C.yel);
    this.text(label, M + 10, y + 10, 11.5, C.ink, true);
    if (sub) this.text(sub, PW - M, y + 10, 7, C.grey, false, "right");
  }
  paragraph(lead: string, body: string, x: number, y: number, w: number, size = 8.2, color = C.ink, leadColor = C.ink): number {
    this.doc.setFont("helvetica", "bold"); this.doc.setFontSize(size);
    const lw = this.doc.getTextWidth(lead) + 3;
    this.doc.setFont("helvetica", "normal");
    const nbsp = Math.ceil(lw / this.doc.getTextWidth(" "));
    const lines = this.doc.splitTextToSize("\u00A0".repeat(nbsp) + body, w) as string[];
    const lead_h = size * 1.35;
    this.text(lead, x, y + size, size, leadColor, true);
    lines.forEach((l, i) => this.text(l, x, y + size + i * lead_h, size, color));
    return lines.length * lead_h;
  }

  empty(x: number, y: number, w: number, h: number) { this.text("No data for this sensor on the selected day", x + w / 2, y + h / 2, 7.5, C.grey, false, "center"); }

  lineChart(x: number, y: number, w: number, h: number, lines: Line[], o: { min?: number; max?: number; refs?: Ref[] } = {}) {
    const live = lines.filter((l) => l.pts.length);
    if (!live.length) return this.empty(x, y, w, h);
    const pl = 32, pr = 10, pt = lines.length > 1 ? 15 : 8, pb = 14;
    const px = x + pl, py = y + pt, pw = w - pl - pr, ph = h - pt - pb;
    let lo = o.min ?? Infinity, hi = o.max ?? -Infinity;
    if (o.min === undefined || o.max === undefined) {
      for (const l of live) for (const p of l.pts) { if (o.min === undefined) lo = Math.min(lo, p.y); if (o.max === undefined) hi = Math.max(hi, p.y); }
      for (const r of o.refs ?? []) { if (o.min === undefined) lo = Math.min(lo, r.y); if (o.max === undefined) hi = Math.max(hi, r.y); }
      if (hi - lo < 1e-9) hi = lo + 1;
      const pad = (hi - lo) * 0.03;
      if (o.min === undefined) lo -= pad;
      if (o.max === undefined) hi += pad;
      [lo, hi] = niceRange(lo, hi, o.min, o.max);
    }
    const sx = (v: number) => px + ((v - this.xLo) / (this.xHi - this.xLo)) * pw;
    const sy = (v: number) => py + ph - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ph;
    const range = hi - lo, d = range >= 20 ? 0 : range >= 2 ? 1 : 2;
    this.doc.setLineWidth(0.4);
    for (let i = 0; i <= 4; i++) {
      const v = lo + (range * i) / 4, yy = sy(v);
      this.stroke(C.line); this.doc.line(px, yy, px + pw, yy);
      this.text(v.toFixed(d), px - 4, yy + 2, 6, C.grey, false, "right");
    }
    // time axis: only the hours that have data, with a tick step that keeps about 6 labels
    const span = this.xHi - this.xLo;
    const step = [0.25, 0.5, 1, 2, 3, 4, 6].find((s) => span / s <= 6) ?? 6;
    for (let t = Math.ceil(this.xLo / step - 1e-9) * step; t <= this.xHi + 1e-9; t += step) {
      const hh = Math.floor(t + 1e-9), mm = Math.round((t - hh) * 60);
      const tx = sx(t);
      this.stroke(C.line); this.doc.setLineWidth(0.4); this.doc.line(tx, py, tx, py + ph);
      this.text(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, tx, py + ph + 10, 6, C.grey, false, "center");
    }
    // Break every line wherever the node sent nothing for a while, so gaps are shown as gaps
    // instead of being joined by a misleading straight line.
    const segs = (pts: Pt[]) => {
      const out: Pt[][] = []; let cur: Pt[] = [];
      for (const p of pts) {
        if (cur.length && p.x - cur[cur.length - 1]!.x > this.gapH) { out.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) out.push(cur);
      return out.map((s) => s.map((p) => [sx(p.x), sy(p.y)] as [number, number]));
    };
    for (const l of live) {
      if (l.fillTo === undefined) continue;
      const base = sy(l.fillTo);
      for (const s of segs(l.pts)) if (s.length > 1) this.poly([[s[0]![0], base], ...s, [s[s.length - 1]![0], base]], tint(l.color, 0.16));
    }
    for (const r of o.refs ?? []) {
      const yy = sy(r.y);
      this.stroke(r.color); this.doc.setLineWidth(0.7); this.doc.setLineDashPattern([3, 2], 0); this.doc.line(px, yy, px + pw, yy); this.doc.setLineDashPattern([], 0);
      this.text(r.label, px + pw - 2, yy - 2, 5.8, r.color, false, "right");
    }
    this.stroke(C.mute); this.doc.setLineWidth(0.5); this.doc.line(px, py + ph, px + pw, py + ph);
    for (const l of live) for (const s of segs(l.pts)) this.polyline(s, l.color, l.width ?? 1.1);
    if (lines.length > 1) {
      let lx = px + 2;
      for (const l of lines) {
        this.rect(lx, y + 4, 8, 3, l.color); this.text(l.name, lx + 11, y + 8, 6.2, C.grey);
        lx += 11 + this.doc.getTextWidth(l.name) + 12;
      }
    }
  }

  bars(x: number, y: number, w: number, h: number, vals: { v: number; color: string; label?: string; none?: boolean }[], max: number) {
    const pl = 28, pb = 14, pt = 6, pw = w - pl - 8, ph = h - pb - pt, py = y + pt, px = x + pl;
    this.doc.setLineWidth(0.4);
    for (let i = 0; i <= 4; i++) {
      const yy = py + ph - (ph * i) / 4;
      this.stroke(C.line); this.doc.line(px, yy, px + pw, yy);
      this.text(((max * i) / 4).toFixed(0), px - 4, yy + 2, 6, C.grey, false, "right");
    }
    const bw = pw / vals.length;
    vals.forEach((b, i) => {
      const bh = Math.min(1, Math.max(0, b.v / max)) * ph;
      if (b.none) this.rect(px + i * bw + bw * 0.14, py + ph - 2, bw * 0.72, 2, C.line);
      else if (bh > 0) this.rect(px + i * bw + bw * 0.14, py + ph - bh, bw * 0.72, bh, b.color);
      if (b.label) this.text(b.label, px + i * bw + bw / 2, py + ph + 10, 6, C.grey, false, "center");
    });
  }

  hBars(x: number, y: number, w: number, h: number, items: { label: string; v: number; color: string }[]) {
    const lw = 92, max = Math.max(1, ...items.map((i) => i.v)), rowH = (h - 8) / items.length, bw = w - lw - 34;
    items.forEach((it, i) => {
      const yy = y + 4 + i * rowH;
      this.text(it.label, x + lw - 6, yy + rowH / 2 + 2, 6.4, C.grey, false, "right");
      const len = (it.v / max) * bw;
      if (len > 0) this.rect(x + lw, yy + rowH * 0.2, len, rowH * 0.6, it.color);
      this.text(String(it.v), x + lw + len + 4, yy + rowH / 2 + 2, 6.4, C.ink);
    });
  }
}

// ---------------------------------------------------------------- report
export async function buildReport({ readings, day, nodeId, thresholds: th, sample = false }: ReportInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const rs = readings.filter((r) => r.ts >= start && r.ts < start + 86_400_000).sort((a, b) => a.ts - b.ts);
  if (!rs.length) throw new Error("No readings for this day");
  const last = rs[rs.length - 1]!;
  const dateLong = new Date(start).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
  const weekday = new Date(start).toLocaleDateString(undefined, { weekday: "long" });
  const dateShort = new Date(start).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({ title: `Environmental Monitoring Report - ${dateLong}`, author: SITE, subject: "Daily sensor report" });
  const k = new Kit(doc);
  // Plot only the part of the day that has data (whole hours), and size the averaging bucket to that span.
  const hrOf = (ts: number) => (ts - start) / 3_600_000;
  const xLo = Math.max(0, Math.floor(hrOf(rs[0]!.ts)));
  const xHi = Math.min(24, Math.max(xLo + 1, Math.ceil(hrOf(last.ts))));
  k.xLo = xLo; k.xHi = xHi;
  const spanH = xHi - xLo;
  const bucketMin = spanH <= 3 ? 2 : spanH <= 8 ? 5 : spanH <= 14 ? 10 : 15;
  const ser = (pick: (r: Reading) => number | undefined) => bucketSeries(rs, start, pick, bucketMin);
  const hasP = rs.some((r) => isNum(r.pressure) && r.pressure > 300);
  const pPick = (r: Reading) => (isNum(r.pressure) && r.pressure > 300 ? r.pressure : undefined);
  const dewPick = (r: Reading) => (isNum(r.dew_point) ? r.dew_point : undefined);
  // Dallas DS18B20 reports 0 when the probe is missing, so treat 0 as "no reading"
  const probePick = (r: Reading) => (isNum(r.probe_temp) && r.probe_temp !== 0 ? r.probe_temp : undefined);
  const hasProbe = rs.some((r) => probePick(r) !== undefined);
  // typical sample interval (minutes): drives the "no data" gap threshold on the charts and the coverage strip
  const gaps = rs.slice(1).map((r, i) => (r.ts - rs[i]!.ts) / 60_000).filter((v) => v > 0).sort((a, b) => a - b);
  const medMin = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 5;
  k.gapH = Math.max(bucketMin * 3, medMin * 3, 15) / 60;

  const S = {
    aqi: stat(rs, (r) => r.aqi), pm25: stat(rs, (r) => r.pm25), pm10: stat(rs, (r) => r.pm10), tmp: stat(rs, (r) => r.temperature),
    hum: stat(rs, (r) => r.humidity), probe: stat(rs, probePick), dew: stat(rs, dewPick), prs: stat(rs, pPick), lux: stat(rs, (r) => r.lux),
    mq2: stat(rs, (r) => r.mq2_ppm), mq7: stat(rs, (r) => r.mq7_ppm), mq135: stat(rs, (r) => r.mq135_ppm),
  };
  const aqiMean = S.aqi?.avg ?? computeAqi(S.pm25?.avg ?? 0);
  const cat = aqiCat(aqiMean);
  const over = rs.filter((r) => r.pm25 >= th.pm25).length;
  const pr = rs.filter((r) => pPick(r) !== undefined);
  const pFirst = pr[0] ? pPick(pr[0]) : undefined, pLast = pr.length ? pPick(pr[pr.length - 1]!) : undefined;
  const t3 = last.ts - 3 * 3_600_000;
  const pRef = pr.find((r) => r.ts >= t3);
  const d3 = hasP && pRef && isNum(pLast) ? pLast - (pPick(pRef) ?? pLast) : 0;
  const dDay = isNum(pFirst) && isNum(pLast) ? pLast - pFirst : 0;
  const hw = (CW - 12) / 2;

  const generated = new Date().toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const footer = (n: number) => {
    k.stroke(C.line); doc.setLineWidth(0.6); doc.line(M, 812, PW - M, 812);
    k.text(`${SITE}  |  Environmental Monitoring Report  |  ${nodeId}  |  ${dateShort} ${new Date(start).getFullYear()}  |  Generated ${generated}`, M, 824, 6.8, C.grey);
    k.text(`Page ${n} of 3`, PW - M, 824, 6.8, C.grey, true, "right");
    if (sample) k.text("SAMPLE DATA - generated to preview the report layout. Real reports use readings stored in your Firestore node.", M, 834, 6.2, C.red);
  };
  const slim = (title: string) => {
    k.stripe(0, 5); k.rect(0, 5, PW, 35, C.ink); k.logo(M, 12, 22);
    k.text(SITE, M + 30, 22, 10, C.white, true); k.text("IoT air monitor", M + 30, 32, 6.5, C.mute);
    k.text(title, PW - M, 25, 11, C.yel, true, "right");
  };

  // ============================== PAGE 1
  k.stripe(0, 6); k.rect(0, 6, PW, 106, C.ink); k.logo(M, 22, 30);
  k.text(SITE, M + 40, 36, 13, C.white, true); k.text("IoT air and weather monitoring", M + 40, 48, 7.5, C.mute);
  k.text("Environmental Monitoring Report", M, 80, 24, C.white, true);
  k.text("Daily air quality, weather and sensor performance summary", M, 97, 9, "#D8D6CC");
  k.text(dateLong, PW - M, 40, 15, C.yel, true, "right"); k.text(weekday, PW - M, 53, 8, "#D8D6CC", false, "right");
  k.text(`Data window  ${hhmm(rs[0]!.ts)} - ${hhmm(last.ts)}  (${rs.length} readings)`, PW - M, 66, 7, C.mute, false, "right");
  k.text("Node ID", PW - M, 84, 6.8, C.mute, false, "right"); doc.setFont("courier", "bold"); doc.setFontSize(10); k.ink(C.white); doc.text(nodeId, PW - M, 96, { align: "right" });

  const y0 = 126;
  const BH = 152;
  k.rect(M, y0, CW, BH, C.light, C.line, 6);
  k.rect(M + 10, y0 + 10, 104, BH - 20, cat.color, undefined, 6);
  k.text("MEAN AQI", M + 62, y0 + 26, 7.5, cat.text, true, "center");
  k.text(aqiMean.toFixed(0), M + 62, y0 + 66, 38, cat.text, true, "center");
  // measure the label with the font it is drawn in (bold 8.5), otherwise the wrap width is wrong
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  const catLines = doc.splitTextToSize(cat.label, 90) as string[];
  const ly = y0 + 88;
  catLines.forEach((l, i) => k.text(l, M + 62, ly + i * 10.5, 8.5, cat.text, true, "center"));
  k.stroke(cat.text); doc.setLineWidth(0.4); doc.line(M + 26, y0 + BH - 38, M + 98, y0 + BH - 38);
  k.text(`peak ${fmt(S.aqi?.max, 0)} at ${S.aqi ? hhmm(S.aqi.tMax) : "-"}`, M + 62, y0 + BH - 26, 7, cat.text, false, "center");

  const tx = M + 126, tw = CW - 136;
  let yy = y0 + 14;
  k.text("Weather expert summary", tx, yy + 4, 9.5, C.ink, true); yy += 14;
  const alarmTxt = over > 0
    ? `crossed your ${th.pm25} µg/m³ alarm limit in ${over} readings (${((over / rs.length) * 100).toFixed(1)}% of the day), mainly around ${S.pm25 ? hhmm(S.pm25.tMax) : "-"}`
    : `stayed below your ${th.pm25} µg/m³ alarm limit, peaking at ${fmt(S.pm25?.max)} µg/m³ at ${S.pm25 ? hhmm(S.pm25.tMax) : "-"}`;
  yy += k.paragraph("Air.", `Air quality averaged AQI ${aqiMean.toFixed(0)} (${cat.label.toLowerCase()}). PM2.5 averaged ${fmt(S.pm25?.avg)} µg/m³, about ${((S.pm25?.avg ?? 0) / 15).toFixed(1)}x the WHO 24-hour guideline of 15 µg/m³, and ${alarmTxt}.`, tx, yy, tw) + 4;
  if (S.tmp) {
    const off = S.probe ? S.tmp.avg - S.probe.avg : undefined;
    yy += k.paragraph("Thermal comfort.", `The AHT20 read ${S.tmp.min.toFixed(1)} to ${S.tmp.max.toFixed(1)} °C (mean ${S.tmp.avg.toFixed(1)}), peaking at ${hhmm(S.tmp.tMax)}.${S.probe && isNum(off) ? ` The Dallas probe averaged ${S.probe.avg.toFixed(1)} °C, so the AHT20 ran ${Math.abs(off).toFixed(1)} °C ${off >= 0 ? "warmer" : "cooler"}${off >= 1.5 ? " (likely enclosure heating)" : ""}.` : ""}${S.hum ? ` Humidity swung between ${S.hum.min.toFixed(0)}% and ${S.hum.max.toFixed(0)}%` : ""}${S.dew ? `, with a mean dew point of ${S.dew.avg.toFixed(1)} °C (${dewComfort(S.dew.avg)} air)` : ""}${S.hum ? "." : ""}`, tx, yy, tw) + 4;
  }
  if (hasP && isNum(pFirst) && isNum(pLast)) yy += k.paragraph("Pressure.", `Pressure moved from ${pFirst.toFixed(1)} to ${pLast.toFixed(1)} hPa (${dDay >= 0 ? "+" : ""}${dDay.toFixed(1)} hPa on the day) and changed ${d3 >= 0 ? "+" : ""}${d3.toFixed(1)} hPa over the last three hours, which points to ${outlook(d3)}.`, tx, yy, tw) + 4;

  const ky = y0 + BH + 12, kw = (CW - 5 * 7) / 6;
  const kpis: [string, string, string, string][] = [
    ["Mean AQI", aqiMean.toFixed(0), cat.label.split(" for")[0]!, cat.color],
    ["PM2.5 mean", fmt(S.pm25?.avg), "µg/m³", C.red],
    ["Temperature", fmt(S.tmp?.avg), S.probe ? `°C  AHT20 | probe ${S.probe.avg.toFixed(1)}` : "°C  AHT20", C.org],
    ["Humidity", fmt(S.hum?.avg, 0), S.dew ? `%  dew pt ${S.dew.avg.toFixed(1)} °C` : "%", C.blue],
    ["Pressure", fmt(S.prs?.avg), hasP ? `hPa  (${dDay >= 0 ? "+" : ""}${dDay.toFixed(1)} on day)` : "no BMP280 data", C.teal],
    ["Peak light", S.lux ? `${(S.lux.max / 1000).toFixed(1)}k` : "-", S.lux ? `lx at ${hhmm(S.lux.tMax)}` : "lx", C.gold],
  ];
  kpis.forEach(([lab, val, sub, colr], i) => {
    const x = M + i * (kw + 7);
    k.rect(x, ky, kw, 56, C.white, C.line, 5); k.rect(x, ky, kw, 3, colr);
    k.text(lab, x + 8, ky + 16, 6.8, C.grey); k.text(val, x + 8, ky + 36, 17, C.ink, true); k.text(sub, x + 8, ky + 48, 6.2, C.grey);
  });

  let cy = ky + 56 + 12;
  k.section(cy, "Particulate matter", `PM2.5 and PM10, ${bucketMin}-minute averages`); cy += 20;
  k.card(M, cy, CW, 166, "PM2.5 and PM10 trend", "µg/m³", C.red);
  k.lineChart(M + 4, cy + 20, CW - 8, 142, [{ name: "PM10", color: C.blue, pts: ser((r) => r.pm10), fillTo: 0 }, { name: "PM2.5", color: C.red, pts: ser((r) => r.pm25), fillTo: 0, width: 1.4 }], { min: 0, refs: [{ y: th.pm25, color: C.red, label: `Alarm limit ${th.pm25}` }] });
  cy += 166 + 12;
  k.section(cy, "Temperature and humidity", "AHT20 air sensor and DS18B20 probe"); cy += 20;
  k.card(M, cy, hw, 138, "Temperature: AHT20 vs Dallas probe", "°C", C.org);
  k.lineChart(M + 4, cy + 20, hw - 8, 114, [
    { name: "AHT20 (air)", color: C.org, pts: ser((r) => r.temperature), width: 1.3 },
    ...(hasProbe ? [{ name: "DS18B20 probe", color: C.teal, pts: ser(probePick), width: 1.3 }] : []),
  ]);
  k.card(M + hw + 12, cy, hw, 138, "Relative humidity", "%", C.blue);
  k.lineChart(M + hw + 16, cy + 20, hw - 8, 114, [{ name: "Humidity (AHT20)", color: C.blue, pts: ser((r) => r.humidity), fillTo: 0 }], { max: 100 });
  cy += 138 + 12;
  k.rect(M, cy, CW, 800 - cy, C.ink, undefined, 6);
  k.text("Expert outlook", M + 12, cy + 17, 9.5, C.yel, true);
  let ay = cy + 26;
  const adv: [string, string][] = [
    ["Ventilation.", S.pm25 ? `Air the rooms around ${hhmm(S.pm25.tMin)}, when PM2.5 was lowest; keep windows closed near the ${hhmm(S.pm25.tMax)} peak.` : "No particulate data was recorded."],
    ["Sensitive groups.", `Children, older adults and people with asthma should limit time outdoors when AQI exceeds 100${S.aqi && S.aqi.max > 100 ? ` (reached ${S.aqi.max.toFixed(0)} at ${hhmm(S.aqi.tMax)})` : ""}.`],
    ["Weather.", hasP ? `Expect ${outlook(d3).replace(/^a /, "a ").replace(", so ", ": ")}.` : "Connect the BMP280 pressure sensor to add a pressure-based outlook."],
  ];
  for (const [lead, body] of adv) ay += k.paragraph(lead, body, M + 12, ay, CW - 24, 7.8, "#EDEBE2", C.yel) + 3;
  footer(1);

  // ============================== PAGE 2
  doc.addPage(); slim("Sensor Analysis");
  let y = 56;
  k.section(y, "Gas sensors", "limits come from your node settings"); y += 20;
  const gas = (x: number, yy2: number, title: string, color: string, pts: Pt[], lim: number, unit = "ppm") => {
    k.card(x, yy2, hw, 132, title, unit, color);
    k.lineChart(x + 4, yy2 + 20, hw - 8, 108, [{ name: title, color, pts, fillTo: 0 }], { min: 0, refs: [{ y: lim, color: C.red, label: `Limit ${lim}` }] });
  };
  gas(M, y, "MQ-2  Smoke / LPG", C.purp, ser((r) => r.mq2_ppm), th.mq2);
  gas(M + hw + 12, y, "MQ-7  Carbon monoxide", C.org, ser((r) => r.mq7_ppm), th.mq7);
  y += 132 + 10;
  gas(M, y, "MQ-135  Air quality", C.teal, ser((r) => r.mq135_ppm), th.mq135);
  k.card(M + hw + 12, y, hw, 132, "BMP280  Barometric pressure", "hPa", C.blue);
  k.lineChart(M + hw + 16, y + 20, hw - 8, 108, [{ name: "Pressure", color: C.blue, pts: ser(pPick), fillTo: S.prs ? S.prs.min - 1 : undefined }], { refs: [{ y: 1013.25, color: C.grey, label: "Std sea level" }] });
  y += 132 + 14;
  k.section(y, "Light and air quality index", "ambient illuminance and hourly AQI"); y += 20;
  k.card(M, y, CW, 124, "Ambient light", "lux", C.gold);
  k.lineChart(M + 4, y + 20, CW - 8, 100, [{ name: "Illuminance", color: C.gold, pts: ser((r) => r.lux), fillTo: 0 }], { min: 0 });
  y += 124 + 10;
  const nBars = xHi - xLo, lblStep = nBars > 16 ? 3 : nBars > 8 ? 2 : 1;
  const hourly = Array.from({ length: nBars }, (_, j) => {
    const h = xLo + j;
    const v = rs.filter((r) => new Date(r.ts).getHours() === h).map((r) => r.aqi).filter(isNum);
    const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    return { v: m, none: !v.length, color: aqiCat(m).color, label: j % lblStep === 0 ? `${String(h).padStart(2, "0")}h` : undefined };
  });
  k.card(M, y, hw, 136, "Hourly mean AQI", "index", C.red);
  k.bars(M + 4, y + 20, hw - 8, 112, hourly, Math.max(100, Math.ceil(Math.max(...hourly.map((b) => b.v)) / 100) * 100));
  const bands: [string, number, number, string][] = [["0-12  Good", 0, 12, "#2FA84F"], ["12-35  Moderate", 12, 35.5, "#F2C500"], ["35-55  Sensitive", 35.5, 55.5, C.org], ["55-150  Unhealthy", 55.5, 150.5, C.red], ["150+  Very unhealthy", 150.5, 1e9, "#8F3F97"]];
  k.card(M + hw + 12, y, hw, 136, "PM2.5 distribution", "samples", C.red);
  k.hBars(M + hw + 16, y + 22, hw - 8, 110, bands.map(([label, lo, hi, color]) => ({ label, color, v: rs.filter((r) => r.pm25 >= lo && r.pm25 < hi).length })));
  y += 136 + 10;
  // hour-by-hour data coverage: how much of each hour the node actually reported (vs its usual sample rate)
  const perHour = Math.max(1, 60 / Math.max(medMin, 0.05));
  const cover = Array.from({ length: 24 }, (_, h) => Math.min(1, rs.filter((r) => new Date(r.ts).getHours() === h).length / perHour));
  k.card(M, y, CW, 56, "Data coverage by hour", `${cover.filter((c) => c > 0).length} of 24 hours with readings`, C.teal);
  const cw = (CW - 24) / 24;
  cover.forEach((c, i) => {
    doc.setFillColor(...(c > 0 ? tint(C.teal, 0.25 + 0.75 * c) : hex(C.line)));
    doc.rect(M + 12 + i * cw + 0.75, y + 22, cw - 1.5, 14, "F");
    if (i % 3 === 0) k.text(`${String(i).padStart(2, "0")}h`, M + 12 + i * cw + cw / 2, y + 47, 6, C.grey, false, "center");
  });
  y += 56 + 10;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const note = doc.splitTextToSize("MQ-series sensors respond to several gases at once and drift with temperature and humidity, so treat them as relative indicators of change rather than lab-grade concentrations. A reading above its limit is a prompt to check the room, not a diagnosis. For calibrated particulate values, compare the dust sensor with a reference monitor when possible.", CW - 24) as string[];
  k.rect(M, y, CW, 30 + note.length * 11 + 6, C.light, C.line, 6);
  k.text("Reading the gas sensors", M + 12, y + 17, 9, C.ink, true);
  note.forEach((l, i) => k.text(l, M + 12, y + 31 + i * 11, 8, C.ink));
  footer(2);

  // ============================== PAGE 3
  doc.addPage(); slim("Power, Statistics and Event Log");
  y = 56;
  k.section(y, "Power and connectivity", "battery, charging and Wi-Fi"); y += 20;
  k.card(M, y, hw, 128, "Battery level and charging", "%", C.teal);
  k.lineChart(M + 4, y + 20, hw - 8, 104, [{ name: "Battery %", color: C.teal, pts: ser((r) => r.battery_percent), fillTo: 0 }], { min: 0, max: 100 });
  k.card(M + hw + 12, y, hw, 128, "Wi-Fi signal strength", "dBm", C.blue);
  k.lineChart(M + hw + 16, y + 20, hw - 8, 104, [{ name: "RSSI", color: C.blue, pts: ser((r) => (r.rssi > -99 ? r.rssi : undefined)) }], { min: -100, max: -20, refs: [{ y: -75, color: C.red, label: "Weak below -75" }] });
  y += 128 + 14;
  k.section(y, "Daily statistics", "min, mean and max for every sensor"); y += 18;
  const row = (label: string, unit: string, pick: (r: Reading) => number | undefined, d = 1): string[] => {
    const s = stat(rs, pick);
    return [label, unit, fmt(s?.min, d), fmt(s?.avg, d), fmt(s?.max, d), s ? hhmm(s.tMax) : "-"];
  };
  const body = [
    row("Air quality index", "AQI", (r) => r.aqi, 0), row("PM2.5", "µg/m³", (r) => r.pm25), row("PM10", "µg/m³", (r) => r.pm10), row("Dust density", "mg/m³", (r) => r.dust_density, 3),
    row("MQ-2 smoke / LPG", "ppm", (r) => r.mq2_ppm, 0), row("MQ-7 carbon monoxide", "ppm", (r) => r.mq7_ppm), row("MQ-135 air quality", "ppm", (r) => r.mq135_ppm),
    row("Temperature (AHT20)", "°C", (r) => r.temperature), row("Probe temperature (Dallas DS18B20)", "°C", probePick), row("Relative humidity (AHT20)", "%", (r) => r.humidity, 0), row("Dew point", "°C", dewPick),
    row("Pressure (BMP280)", "hPa", pPick), row("Ambient light", "lux", (r) => r.lux, 0), row("Battery", "%", (r) => r.battery_percent, 0), row("Boost rail", "V", (r) => r.boost_voltage, 2),
    row("Wi-Fi RSSI", "dBm", (r) => (r.rssi > -99 ? r.rssi : undefined), 0), row("Free heap", "KB", (r) => r.free_heap / 1024, 0),
  ];
  const common = { margin: { left: M, right: M }, theme: "plain" as const, tableWidth: CW };
  autoTable(doc, {
    ...common, startY: y, head: [["Sensor", "Unit", "Min", "Mean", "Max", "Peak at"]], body,
    styles: { fontSize: 7.4, cellPadding: { top: 2, bottom: 2, left: 7, right: 8 }, textColor: hex(C.ink), lineWidth: 0 },
    headStyles: { fillColor: hex(C.yel), textColor: hex(C.ink), fontStyle: "bold" },
    alternateRowStyles: { fillColor: hex(C.light) },
    columnStyles: { 0: { cellWidth: 170 }, 1: { textColor: hex(C.grey) }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "right" }, 5: { halign: "right" } },
    // right-align the numeric column headers so they sit over their values
    didParseCell: (d) => { if (d.section === "head" && d.column.index >= 2) d.cell.styles.halign = "right"; },
  });
  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 14;

  const events = buildEvents(rs, th);
  const room = Math.floor((690 - y - 20) / 13.4);
  const shown = events.slice(0, Math.max(3, Math.min(11, room)));
  k.section(y, "Event log", `${events.length} events, newest first`); y += 18;
  autoTable(doc, {
    ...common, startY: y, head: [["Time", "Level", "Source", "Message"]],
    body: shown.map((e) => [`${dateShort} ${hhmm(e.ts)}`, e.level.toUpperCase(), e.source, e.message]),
    styles: { fontSize: 7.2, cellPadding: { top: 2, bottom: 2, left: 7, right: 6 }, textColor: hex(C.ink), lineWidth: 0 },
    headStyles: { fillColor: hex(C.ink), textColor: hex(C.yel), fontStyle: "bold" },
    alternateRowStyles: { fillColor: hex(C.light) },
    columnStyles: { 0: { cellWidth: 78 }, 1: { cellWidth: 56, fontStyle: "bold" }, 2: { cellWidth: 62 } },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 1) {
        const lv = String(d.cell.raw).toLowerCase();
        d.cell.styles.textColor = hex(lv === "critical" ? C.red : lv === "warning" ? "#D9730D" : C.teal);
      }
    },
  });
  y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 4;
  if (events.length > shown.length) k.text(`+ ${events.length - shown.length} more events on the System Logs page`, M, y + 8, 6.8, C.grey);

  // health strip
  const hy = 700;
  k.section(hy - 24, "System health and data quality", "completeness of this report");
  const hours = new Set(rs.map((r) => new Date(r.ts).getHours())).size;
  const wifiUp = (rs.filter((r) => r.wifi_ok !== false).length / rs.length) * 100;
  const sdBad = rs.filter((r) => r.sd_ok === false).length, dustBad = rs.filter((r) => r.dust_ok === false).length;
  const hk: [string, string, string, string][] = [
    ["Readings used", String(rs.length), "stored in Firestore", C.teal],
    ["Data coverage", `${hours}/24 h`, "hours with at least one reading", hours >= 22 ? C.teal : C.org],
    ["Wi-Fi uptime", `${wifiUp.toFixed(1)}%`, `${last.uploads_failed ?? 0} uploads failed in total`, C.blue],
    ["Storage and dust", sdBad || dustBad ? "Check" : "OK", sdBad || dustBad ? `${sdBad} SD faults, ${dustBad} dust faults` : "no SD or dust faults", sdBad || dustBad ? C.red : "#2FA84F"],
  ];
  const w4 = (CW - 24) / 4;
  hk.forEach(([lab, val, sub, colr], i) => {
    const x = M + i * (w4 + 8);
    k.rect(x, hy, w4, 54, C.white, C.line, 5); k.rect(x, hy, w4, 3, colr);
    k.text(lab, x + 9, hy + 17, 7, C.grey); k.text(val, x + 9, hy + 36, 15, C.ink, true); k.text(sub, x + 9, hy + 48, 6.2, C.grey);
  });
  k.rect(M, hy + 62, CW, 40, C.light, C.line, 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
  const about = doc.splitTextToSize(`Charts plot ${bucketMin}-minute averages of your node's readings for the hours with data on the selected day. A break in a line means the node sent no readings for that period. AQI is calculated from PM2.5 with the US EPA breakpoints. The outlook is a rule-based reading of your own trends, not an official forecast. Alarm limits are the thresholds saved in Settings.`, CW - 24) as string[];
  about.forEach((l, i) => k.text(l, M + 12, hy + 76 + i * 9.5, 7.2, C.ink));
  footer(3);

  const key = `${new Date(start).getFullYear()}-${String(new Date(start).getMonth() + 1).padStart(2, "0")}-${String(new Date(start).getDate()).padStart(2, "0")}`;
  doc.save(`eco-sentinal-x-report-${key}${sample ? "-sample" : ""}.pdf`);
}

// ---------------------------------------------------------------- sample day (for the "Sample report" button)
export function makeSampleDay(day: Date): Reading[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const g = (h: number, c: number, s: number) => Math.exp(-(((h - c) / s) ** 2));
  const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;
  const out: Reading[] = [];
  let batt = 58;
  for (let i = 0; i < 288; i++) {
    const h = (i * 5) / 60, ts = start + i * 300_000;
    const tmp = 27 + 5.5 * Math.sin((2 * Math.PI * (h - 9.5)) / 24) + rnd(0.25);
    const hum = Math.min(99, Math.max(20, 62 - 14 * Math.sin((2 * Math.PI * (h - 9.5)) / 24) + rnd(0.8)));
    const gm = Math.log(hum / 100) + (17.62 * tmp) / (243.12 + tmp);
    const pm25 = Math.max(4, 22 + 11 * g(h, 8, 1.6) + 20 * g(h, 19, 2) + 40 * g(h, 19.4, 0.35) + rnd(2.2));
    const charging = h >= 9.5 && batt < 100 && h < 16.5;
    batt = Math.min(100, batt + (charging ? (10 * 5) / 60 : h >= 9.5 && h < 16.5 ? 0 : (-2 * 5) / 60));
    const day01 = h > 6.2 && h < 17.8 ? Math.max(0, Math.sin((Math.PI * (h - 6.2)) / 11.6)) ** 1.4 : 0;
    out.push({
      id: `sample-${i}`, ts, deviceId: "esp32_sample", mq2_ppm: 150 + 2.2 * (pm25 - 22) + rnd(10), mq7_ppm: 14 + 0.28 * (pm25 - 22) + rnd(1.2), mq135_ppm: 52 + 1.15 * (pm25 - 22) + rnd(3),
      pm25, pm10: pm25 * 1.55 + rnd(3), dust_density: pm25 / 1000 + 0.02, temperature: tmp, humidity: hum, battery_voltage: 3.3 + (0.9 * batt) / 100, battery_percent: batt,
      boost_voltage: 5.02 + rnd(0.02), charging, rssi: Math.round(-62 + rnd(2.5) - 16 * g(h, 14.2, 0.12)), free_heap: Math.round((182 - 6 * Math.sin(h / 3) + rnd(1.5)) * 1024),
      uptime_s: 273_000 + i * 300, aqi: computeAqi(pm25), lux: Math.max(0, 9500 * day01 * (1 - 0.3 * Math.max(0, rnd(1))) + rnd(20) * day01), probe_temp: tmp - 1.4 + rnd(0.15),
      pressure: 1010.2 + 1.8 * Math.sin((2 * Math.PI * (h - 4)) / 12) - 0.09 * h + rnd(0.08), dew_point: (243.12 * gm) / (17.62 - gm),
      charge_complete: batt >= 100 && h >= 9.5 && h < 17, wifi_ok: true, sd_ok: true, dust_ok: true, uploads_ok: 4000 + i, uploads_failed: 2, chip_temp: 46 + rnd(3),
    });
  }
  return out;
}
