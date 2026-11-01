#!/usr/bin/env bash
# Read-only by default: never pulls images, installs software or starts containers.
# PILOT_GPU_PROBE=1 opts into a short probe using an ALREADY CACHED image only.
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

if command -v nvcc >/dev/null; then
  cuda_major=$(nvcc --version 2>/dev/null | sed -n 's/.*release \([0-9][0-9]*\)\..*/\1/p' | head -1)
  [ "$cuda_major" = "13" ] && ok "CUDA 13 toolkit" || bad "CUDA 13 toolkit needed; nvcc reports major ${cuda_major:-unknown}"
else
  bad "CUDA 13 toolkit with nvcc on PATH is needed"
fi
command -v python3 >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' && ok "Python 3.10+" || bad "Python 3.10+ needed"
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  ok "Docker daemon available"
  probe_image=ghcr.io/debpalash/voicestudio:stable
  if [ "${PILOT_GPU_PROBE:-0}" = "1" ]; then
    if docker image inspect "$probe_image" >/dev/null 2>&1; then
      docker run --rm --pull=never --network=none --gpus all --entrypoint true "$probe_image" >/dev/null 2>&1 && ok "Docker can use the GPU" || bad "Cached-image GPU probe failed; check NVIDIA container runtime"
    else
      bad "GPU probe image is not cached; no image was pulled"
    fi
  else
    warn "GPU container execution not tested (read-only mode). After reviewing results, PILOT_GPU_PROBE=1 uses a cached image with --pull=never"
  fi
else
  bad "A running Docker daemon is needed"
fi

ram=$(awk '/MemTotal/ {print int($2 / 1048576)}' /proc/meminfo 2>/dev/null || echo 0)
[ "$ram" -ge 32 ] && ok "RAM ${ram} GB" || bad "RAM ${ram} GB: the smallest reported FreeToken setup has 32 GB"
disk=$(df -BG --output=avail . 2>/dev/null | tail -1 | tr -dc 0-9)
[ "${disk:-0}" -ge 150 ] && ok "Disk ${disk} GB free" || bad "Disk ${disk:-0} GB free: allow 150 GB for images and model weights"

echo
[ "$fails" -eq 0 ] && echo "Static preflight passed. This does not prove model fit, GPU runtime access unless probed, voice quality or speed." || echo "$fails check(s) failed. Do not install or start the pilot until these are resolved."
exit "$fails"
