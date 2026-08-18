// 诊断: 列出某应用真实 PID、CDP 监听端口、以及各进程的 CDP 启动参数（验证 target/端口 stale）。
// 用法: node debug-tools/probe-app-ports.mjs <processName字样>
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const ef = promisify(execFile);
const needle = process.argv[2] ?? "WorkBuddy";

const ps = (await ef("tasklist", ["/FO", "CSV"])).stdout;
const rows = ps
  .split(/\r?\n/)
  .filter((l) => l.toLowerCase().includes(needle.toLowerCase()))
  .map((l) => {
    const parts = /"([^"]+)"\s*,\s*"?(\d+)/.exec(l);
    return parts ? { name: parts[1], pid: parts[2] } : null;
  })
  .filter(Boolean);
const want = new Set(rows.map((r) => r.pid));
const ns = (await ef("netstat", ["-ano"]).catch(() => ({ stdout: "" }))).stdout;
const list = [];
const pidPort = new Map();
for (const l of ns.split(/\r?\n/)) {
  const t = l.trim();
  if (!t.includes("LISTENING")) continue;
  const p = t.split(/\s+/);
  if (p.length < 5) continue;
  const pid = p[p.length - 1];
  if (want.has(pid)) {
    const local = p[1];
    if (local.startsWith("127.0.0.1") || local.startsWith("[::1]")) {
      const port = local.split(":")[local.split(":").length - 1];
      list.push(local);
      if (!pidPort.has(pid)) pidPort.set(pid, []);
      pidPort.get(pid).push(port);
    }
  }
}
console.log(`匹配「${needle}」的进程:`, JSON.stringify(rows));
console.log("CDP 回环监听端口:", JSON.stringify(list));

// 检查各进程命令行里是否带 remote-debugging / remote-debugging-address
let wmic = "";
try { wmic = String((await ef("wmic", ["process", "get", "processid,commandline", "/format:list"])).stdout ?? ""); } catch { wmic = ""; }
for (const pid of want) {
  const block = wmic.split(/\r?\n\s*\r?\n/).find((b) => new RegExp(`CommandLine=.*\\b${pid}\\b`, "i").test(b) || b.includes(`ProcessId=${pid}`));
  const cmd = block?.match(/CommandLine=(.*)/)?.[1] ?? "";
  const hasRemote = /remote-debugging/i.test(cmd);
  if (hasRemote) {
    console.log(`  PID ${pid} 命令行含 remote-debugging:`);
    const m = cmd.match(/(--remote-debugging-port=\S+|--remote-debugging-address=\S+|--user-data-dir=\S+)/g);
    console.log(`    ${(m ?? []).join("  ") || "(参数但无法解析)"}`);
  }
}

// 列出每个端口下的 page targets
for (const local of list) {
  const port = local.split(":")[local.split(":").length - 1];
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pages = targets
      .filter((t) => t.type === "page")
      .map((t) => `[page] ${t.title} | ${t.url}`);
    if (pages.length === 0) pages.push("(无 page target)");
    console.log(`\n端口 ${port} 的 page targets:`);
    pages.forEach((p) => console.log("  " + p));
  } catch (e) {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    console.log(`\n端口 ${port}: /json/list 不可用（${e?.message || "error"}）; /json/version: ${resp ? `${resp.status} ${resp.statusText}` : "连接失败"}`);
  }
}