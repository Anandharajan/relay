#!/usr/bin/env bash
# Read-only check of a GPU PC before installing the Relay Voice pilot. Changes nothing.
set -u
fails=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fails=$((fails + 1)); }
warn() { echo "warn  $1"; }

[ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] && ok "Linux x86_64" || bad "FreeToken's install guide needs Linux x86_64 (WSL2 on Windows)"
grep -qi microsoft /proc/version 2>/dev/null && warn "WSL2: FreeToken's docs say pinned memory is capped near half of RAM"

if command -v nvidia-smi >/dev/null; then
  IFS=',' read -r name vram driver <<<"$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits | head -1)"
  echo "      GPU:$name,$vram MiB, driver$driver"
  echo "$name" | grep -Eq 'RTX( PRO)? *[0-9]|RTX *[345][0-9]{3}' && ok "RTX GPU" || warn "FreeToken lists RTX 30/40/50 and workstation cards; check this one"
  [ "${driver%%.*}" -ge 580 ] 2>/dev/null && ok "Driver r580 or newer" || bad "Driver r580+ needed"
  if [ "$vram" -ge 24000 ] 2>/dev/null; then ok "VRAM $vram MiB"
  elif [ "$vram" -ge 12000 ] 2>/dev/null; then warn "VRAM $vram MiB: model and speech may not fit together; measure before sharing"
  else bad "VRAM $vram MiB: unlikely to fit model and speech engines together"; fi
else
  bad "nvidia-smi not found"
fi

command -v nvcc >/dev/null && ok "nvcc found" || bad "CUDA 13 toolkit with nvcc on PATH is needed"
command -v python3 >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' && ok "Python 3.10+" || bad "Python 3.10+ needed"
command -v docker >/dev/null && ok "Docker found" || bad "Docker needed"
docker run --rm --gpus all --entrypoint true ghcr.io/debpalash/voicestudio:stable >/dev/null 2>&1 && ok "Docker can use the GPU" || warn "Could not confirm GPU access in Docker (needs the image pulled and the NVIDIA runtime)"

ram=$(awk '/MemTotal/ {print int($2 / 1048576)}' /proc/meminfo 2>/dev/null || echo 0)
[ "$ram" -ge 32 ] && ok "RAM ${ram} GB" || bad "RAM ${ram} GB: the smallest reported FreeToken setup has 32 GB"
disk=$(df -BG --output=avail . 2>/dev/null | tail -1 | tr -dc 0-9)
[ "${disk:-0}" -ge 150 ] && ok "Disk ${disk} GB free" || bad "Disk ${disk:-0} GB free: allow 150 GB for images and model weights"

echo
[ "$fails" -eq 0 ] && echo "Preflight passed. This does not prove speed: measure it on the running pilot." || echo "$fails check(s) failed."
exit "$fails"
