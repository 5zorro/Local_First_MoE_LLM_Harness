# Connecting OpenClaw (WSL2) → Ollama on Windows

The harness runs in **WSL2**; if your models run in **Ollama on the Windows host**, OpenClaw has to
reach across the WSL↔Windows network boundary. This trips most people up once, so here's the whole
picture.

## The problem
By default Ollama binds to `127.0.0.1` (loopback) on Windows, and WSL2 is a separate network
namespace — so `localhost:11434` from inside WSL does **not** reach Windows Ollama. You need to (1)
make Ollama listen on all interfaces, (2) reach it by the right address, and (3) let it through the
Windows firewall.

## 1. Make Ollama listen on all interfaces (Windows)
Set the `OLLAMA_HOST` environment variable on Windows and restart Ollama:
- **GUI:** Settings → Environment Variables → add a user variable `OLLAMA_HOST = 0.0.0.0:11434`, then
  quit Ollama from the tray and relaunch.
- **PowerShell (persistent):**
  ```powershell
  setx OLLAMA_HOST "0.0.0.0:11434"
  ```
  then fully quit and reopen Ollama.

Verify on Windows: `netstat -ano | findstr 11434` should show `0.0.0.0:11434` (not `127.0.0.1:11434`).

## 2. Find the address WSL should use
There are two common WSL networking modes:

- **NAT mode (default):** reach the Windows host via the WSL **default gateway** IP. From inside WSL:
  ```bash
  ip route | awk '/^default/ {print $3}'        # e.g. 172.x.x.1
  # or:
  cat /etc/resolv.conf | awk '/nameserver/ {print $2}'
  ```
  Use `http://<that-ip>:11434`. (This IP can change across reboots — see "Stability" below.)
- **Mirrored mode** (Windows 11, `.wslconfig` → `[wsl2] networkingMode=mirrored`): `localhost` works,
  so `http://127.0.0.1:11434` reaches Windows Ollama directly.

Test from WSL:
```bash
curl http://<host-ip-or-localhost>:11434/api/tags    # should return your models as JSON
```

## 3. Windows Firewall
If the curl test times out (vs. "connection refused"), Windows Firewall is likely blocking it. Add an
inbound rule allowing TCP **11434** (PowerShell, admin):
```powershell
New-NetFirewallRule -DisplayName "Ollama WSL" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow
```

## 4. Point the harness at it
In `~/.openclaw/openclaw.json` set the Ollama provider base URL (the template ships as a placeholder):
```json
"models": { "providers": { "ollama": { "baseUrl": "http://<host-ip-or-localhost>:11434", "api": "ollama" } } }
```
Then `openclaw gateway restart` and confirm with `scripts/validate-model-config.sh` (it queries this
URL and reports each model's real context window vs. your config).

## Stability (NAT mode IP changes)
The WSL gateway IP can change on reboot. Options:
- Use **mirrored networking** (Windows 11) so `localhost` is stable.
- Or resolve the gateway dynamically at startup instead of hardcoding it.
- Or run Ollama **inside WSL** (`curl -fsSL https://ollama.com/install.sh | sh`) so it's just
  `http://localhost:11434` — simplest if your GPU is usable from WSL.

## Quick checklist
- [ ] `OLLAMA_HOST=0.0.0.0:11434` set on Windows + Ollama restarted
- [ ] `curl http://<addr>:11434/api/tags` returns JSON from inside WSL
- [ ] Firewall allows inbound TCP 11434 (if it was timing out)
- [ ] `openclaw.json` ollama `baseUrl` points at `<addr>`
- [ ] `scripts/validate-model-config.sh` is clean
