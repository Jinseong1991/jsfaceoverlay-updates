'use strict';
/**
 * Enumerates paired Bluetooth devices on Windows and reads the battery level
 * Windows itself knows about (the same value shown in Settings > Bluetooth).
 *
 * Implementation: one hidden PowerShell process per poll. It collects every
 * PnP node that belongs to the Bluetooth stack (instance ids starting with
 * BTH: BTHENUM, BTHLE, BTHLEDEVICE, BTHHFENUM, ..., plus Bluetooth HID
 * children HID\{0000xxxx-...} and Battery-class devices) and reads, in a single
 * Get-PnpDeviceProperty call, these device properties:
 *   DEVPKEY_Bluetooth_Battery        {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2
 *   DEVPKEY_Device_IsConnected       {83DA6326-97A6-4088-9453-A1923F573B29} 15
 *   DEVPKEY_Bluetooth_DeviceAddress  {2BD67D8B-8BEB-48D5-87E0-6CDA3428040A} 1
 *   DEVPKEY_Device_Parent            {A45C254E-DF1C-4EFD-8020-67D146A850E0} 8
 *
 * The top-level device nodes (BTHENUM\DEV_<addr>, BTHLE\DEV_<addr>) are the
 * devices the user sees in Settings. The battery property is not always on
 * that node: for classic (HFP) headsets it can live on a child service node,
 * so every node is attributed to a top-level device by walking its parent
 * chain (or by the Bluetooth address embedded in its instance id) and the
 * first battery value found in that group is used.
 *
 * Devices that do not report a battery to Windows at all (many keyboards and
 * mice that only expose it through vendor software) come back with
 * battery = null.
 */
const { execFile } = require('node:child_process');

const PS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$batKey    = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$conKey    = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$addrKey   = '{2BD67D8B-8BEB-48D5-87E0-6CDA3428040A} 1'
$parentKey = '{A45C254E-DF1C-4EFD-8020-67D146A850E0} 8'

$all = @(Get-PnpDevice | Where-Object { $_.InstanceId -like 'BTH*' -or $_.InstanceId -like 'HID\\{0000*' -or $_.Class -eq 'Battery' })
$ids = @($all | ForEach-Object { $_.InstanceId })
$props = @{}
if ($ids.Count -gt 0) {
  foreach ($p in (Get-PnpDeviceProperty -InstanceId $ids -KeyName $batKey, $conKey, $addrKey, $parentKey)) {
    $k = $p.InstanceId.ToUpper()
    if (-not $props.ContainsKey($k)) { $props[$k] = @{} }
    if ($p.Data -ne $null -and $p.Type -ne 'Empty') { $props[$k][$p.KeyName] = $p.Data }
  }
}
$nodes = @()
foreach ($d in $all) {
  $k = $d.InstanceId.ToUpper()
  $pr = $props[$k]; if ($pr -eq $null) { $pr = @{} }
  $bat = $null; if ($pr.ContainsKey($batKey)) { $bat = [int]$pr[$batKey] }
  $con = $null; if ($pr.ContainsKey($conKey)) { $con = [bool]$pr[$conKey] }
  $addr = $null; if ($pr.ContainsKey($addrKey)) { $addr = [string]$pr[$addrKey] }
  $parent = $null; if ($pr.ContainsKey($parentKey)) { $parent = [string]$pr[$parentKey] }
  $nodes += [pscustomobject]@{
    id = $d.InstanceId; name = $d.FriendlyName; class = $d.Class; status = $d.Status
    present = [bool]$d.Present; connected = $con; battery = $bat; address = $addr; parent = $parent
    root = (($d.InstanceId -like 'BTHENUM\\DEV_*') -or ($d.InstanceId -like 'BTHLE\\DEV_*'))
  }
}
$batteries = @()
foreach ($b in @(Get-CimInstance -ClassName Win32_Battery)) {
  $batteries += [pscustomobject]@{ name = $b.Name; id = $b.DeviceID; pnp = $b.PNPDeviceID; percent = $b.EstimatedChargeRemaining; status = $b.BatteryStatus }
}
[pscustomobject]@{ nodes = $nodes; batteries = $batteries } | ConvertTo-Json -Compress -Depth 4
`;

function runPowerShell(script, timeoutMs = 40000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
    execFile('powershell.exe', args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr }));
      resolve(stdout);
    });
  });
}

const ADDR_RE = /([0-9A-F]{12})/i;

function addrFromId(id) {
  // BTHENUM\DEV_AABBCCDDEEFF, BTHLE\DEV_AABBCCDDEEFF,
  // BTHENUM\{guid}_VID&...\8&1234&0&AABBCCDDEEFF_C00000000, BTHLEDEVICE\{guid}_AABBCCDDEEFF\...
  const m = ADDR_RE.exec((id || '').replace(/^BTH[A-Z]*\\/i, '').replace(/\{[0-9a-f-]+\}/gi, ''));
  return m ? m[1].toUpperCase() : null;
}

/**
 * Normalise the raw PowerShell JSON into one record per top-level device.
 * Exposed for tests; `raw` is the JSON text printed by PS_SCRIPT.
 */
function parseDevices(raw) {
  const text = (raw || '').trim();
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  let nodes = Array.isArray(data) ? data : (data && data.nodes);
  if (!Array.isArray(nodes)) nodes = nodes ? [nodes] : [];
  nodes = nodes.filter(n => n && n.id).map(n => ({
    id: String(n.id),
    idU: String(n.id).toUpperCase(),
    name: n.name ? String(n.name) : null,
    root: !!n.root,
    present: !!n.present,
    status: n.status || null,
    connected: typeof n.connected === 'boolean' ? n.connected : null,
    battery: typeof n.battery === 'number' && n.battery >= 0 && n.battery <= 100 ? n.battery : null,
    address: n.address ? String(n.address).toUpperCase() : null,
    parent: n.parent ? String(n.parent).toUpperCase() : null,
  }));

  const byId = new Map(nodes.map(n => [n.idU, n]));
  const roots = nodes.filter(n => n.root);
  const rootByAddr = new Map();
  for (const r of roots) {
    const a = r.address || addrFromId(r.id);
    if (a) rootByAddr.set(a, r);
  }
  const findRoot = (n) => {
    let cur = n, hops = 0;
    while (cur && hops < 6) {
      if (cur.root) return cur;
      cur = cur.parent ? byId.get(cur.parent) : null;
      hops++;
    }
    const a = addrFromId(n.id);
    return a ? rootByAddr.get(a) || null : null;
  };

  const out = new Map();
  for (const r of roots) {
    out.set(r.idU, {
      id: r.id,
      name: r.name || r.id,
      address: r.address || addrFromId(r.id),
      connected: r.connected !== null ? r.connected : r.status === 'OK',
      present: r.present,
      status: r.status,
      le: /^BTHLE\\/i.test(r.id),
      battery: r.battery,
      batterySource: r.battery !== null ? r.id : null,
      nodes: 1,
    });
  }
  for (const n of nodes) {
    if (n.root) continue;
    const r = findRoot(n);
    if (!r) continue;
    const rec = out.get(r.idU);
    rec.nodes++;
    if (rec.battery === null && n.battery !== null) {
      rec.battery = n.battery;
      rec.batterySource = n.id;
    }
    if (rec.connected === false && n.connected === true) rec.connected = true;
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let lastRaw = { stdout: '', stderr: '', at: null, error: null };

async function listDevices() {
  if (process.platform !== 'win32') {
    throw new Error('Bluetooth battery query is only supported on Windows');
  }
  try {
    const out = await runPowerShell(PS_SCRIPT);
    lastRaw = { stdout: out, stderr: '', at: Date.now(), error: null };
    return parseDevices(out);
  } catch (e) {
    lastRaw = { stdout: '', stderr: e && e.stderr ? String(e.stderr) : '', at: Date.now(), error: e && e.message ? e.message : String(e) };
    throw e;
  }
}

function getDiagnostics() {
  return lastRaw;
}

module.exports = { listDevices, parseDevices, getDiagnostics, addrFromId, PS_SCRIPT };
