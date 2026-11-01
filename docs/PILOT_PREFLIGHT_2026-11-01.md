# Pilot preflight and GPU-PC handoff

Checked on 1 November 2026, Asia/Kolkata. **The GPU pilot was not deployed and is not ready.** The user selected continuing directly on the intended GPU PC; this session still runs on the existing Windows workstation.

## Repository and secret handling

- Starting checkout: clean `voice-desk` at `45b2a99`; `git ls-remote` confirmed the remote branch matched that commit.
- `.env.pilot` and `backups/` are ignored by Git. `.dockerignore` excludes `.env*` and `.cache`.
- No `.env.pilot` exists on this workstation. No real keys, tokens or passwords were read or entered. No model licences were accepted or voices enrolled.

## Measured current-machine results

The preflight was run with the existing Git Bash installation after removing its automatic image-pull behavior. It exited **6**, with six failed checks:

| Check | Observation | Result |
| --- | --- | --- |
| Linux x86_64 environment | Current execution environment is Windows/Git Bash | Fail |
| GPU | NVIDIA Quadro P1000, 4,096 MiB VRAM | Fail for the planned combined model/speech setup |
| Driver | 573.22; script requires r580+ | Fail |
| CUDA compiler | No `nvcc` on PATH | Fail |
| Python in target shell | No `python3` on Git Bash PATH; Windows `python.exe` 3.13 is installed separately | Fail for the required Linux environment |
| RAM | About 31.7 GiB usable on Windows; the script floors its reading to 31 GiB against its 32 GiB minimum | Fail under the script's check |
| Docker daemon | Running, version 29.5.3 | Pass |
| Free disk | About 706–707 GiB | Pass |
| GPU container execution | Not run in default read-only mode | Unverified |

WSL currently lists only Docker Desktop's internal `docker-desktop` distribution, with about 15.5 GiB allocated memory. That internal distribution is not a user-managed FreeToken installation environment. These findings are about this workstation, not the as-yet-uninspected GPU PC.

The vendor's [FreeToken installation requirements](https://github.com/FlashML-org/FreeToken/blob/main/docs/install.md) confirm Linux x86_64, NVIDIA driver r580+, Python 3.10+ and a CUDA 13 toolkit for JIT kernels. Changing only the driver would not resolve this machine's other blockers.

## Preflight corrections and verification

The original supposedly read-only script called `docker run` without `--pull=never`, so it could download the speech image during the initial check. The corrected default starts no containers and downloads nothing. `PILOT_GPU_PROBE=1` explicitly enables a probe, only with an already cached image, `--pull=never` and `--network=none`.

It now checks the CUDA compiler's major version and Docker daemon availability. Five mocked Bash contract tests passed: default read-only behavior; no pull when the probe image is missing; guarded opt-in probe; rejection of CUDA 12; rejection of an unavailable daemon. They use mock hardware and Docker functions, not an actual GPU. Bash syntax checks passed for preflight and backup scripts. The tests are included in CI.

The pilot Compose configuration validates with placeholder values and an explicit temporary validation env file. That was static validation only: no pilot containers, tunnel, FreeToken server, model download or installation was started. Existing local Relay containers were left running.

## Continue on the intended GPU PC

Clone `voice-desk`, or update an existing clean checkout with `git pull --ff-only`, then run:

```bash
bash deploy/pilot-preflight.sh
```

Report that machine's results before installing anything. Follow `VOICE_PILOT.md`; the user must personally handle model licences, secrets and their live enrollment phrase. Do not paste secrets into chat. Do not use the ordinary local demo configuration as evidence that the GPU pilot is deployed.

## Release gates — all still unmeasured on the target GPU PC

| Required gate | Status |
| --- | --- |
| Hosted original and paraphrased HR regression questions have no wrong/off-topic answers | Not run |
| Typical first response within 10 seconds | Not measured |
| Three simultaneous users without timeouts | Not tested |
| Physical-phone recording, transcription and authorized enrollment over HTTPS | Not tested |
| Cloned playback, downloaded audio and revocation on a physical phone | Not tested |
| FreeToken and VoiceStudio stopped mid-run recover/fall back as documented | Not tested |
| Backup schedule and recovery on the target PC | Not configured/tested |

No pilot link was created or shared. Passing static Compose validation or the preflight contract tests does not satisfy these release gates.
