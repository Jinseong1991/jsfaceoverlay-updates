'use strict';
/**
 * Enumerates paired Bluetooth devices on Windows and reads the battery level
 * Windows itself knows about (the same value shown in Settings > Bluetooth).
 *
 * Implementation: one hidden PowerShell process per poll which queries the
 * PnP device tree for BTHENUM\DEV_* (classic) and BTHLE\DEV_* (LE) devices
 * and reads these device properties:
 *   DEVPKEY_Bluetooth_Battery        {104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2
 *   DEVPKEY_Device_IsConnected       {83DA6326-97A6-4088-9453-A1923F573B29} 15
 *   DEVPKEY_Bluetooth_DeviceAddress  {2BD67D8B-8BEB-48D5-87E0-6CDA3428040A} 1
 *
 * Devices that do not report a battery to Windows (many keyboards/mice that
 * only expose it through vendor software) come back with battery = null.
 */
const { execFile } = require('node:child_process');

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$batKey  = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$conKey  = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$addrKey = '{2BD67D8B-8BEB-48D5-87E0-6CDA3428040A} 1'
$result = @()
$devs = Get-PnpDevice | Where-Object { $_.InstanceId -like 'BTHENUM\\DEV_*' -or $_.InstanceId -like 'BTHLE\\DEV_*' }
foreach ($d in $devs) {
  $props = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName $batKey, $conKey, $addrKey
  $bat = $null; $con = $null; $addr = $null
  foreach ($p in $props) {
    if ($p.KeyName -eq $batKey -and $p.Data -ne $null) { $bat = [int]$p.Data }
    if ($p.KeyName -eq $conKey -and $p.Data -ne $null) { $con = [bool]$p.Data }
    if ($p.KeyName -eq $addrKey -and $p.Data -ne $null) { $addr = [string]$p.Data }
  }
  if ($con -eq $null) { $con = ($d.Status -eq 'OK') }
  $result += [pscustomobject]@{
    id        = $d.InstanceId
    name      = $d.FriendlyName
    class     = $d.Class
    status    = $d.Status
    present   = [bool]$d.Present
    connected = $con
    battery   = $bat
    address   = $addr
    le        = ($d.InstanceId -like 'BTHLE\\*')
  }
}
ConvertTo-Json -Compress -Depth 3 @($result)
`;

function runPowerShell(script, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
    execFile('powershell.exe', args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr }));
      resolve(stdout);
    });
  });
}

/** Normalise the raw PowerShell JSON into plain device records. */
function parseDevices(json) {
  const text = (json || '').trim();
  if (!text) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(data)) data = data ? [data] : [];
  return data
    .filter(d => d && d.id)
    .map(d => ({
      id: String(d.id),
      name: String(d.name || d.id),
      address: d.address ? String(d.address).toUpperCase() : null,
      connected: !!d.connected,
      present: !!d.present,
      status: d.status || null,
      le: !!d.le,
      battery: typeof d.battery === 'number' && d.battery >= 0 && d.battery <= 100 ? d.battery : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listDevices() {
  if (process.platform !== 'win32') {
    throw new Error('Bluetooth battery query is only supported on Windows');
  }
  const out = await runPowerShell(PS_SCRIPT);
  return parseDevices(out);
}

module.exports = { listDevices, parseDevices, PS_SCRIPT };
