import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('./pilot-preflight.sh',import.meta.url),'utf8');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
// All hardware/daemon commands are fixtures. No image, container or model is used.
function preflight({probe='0',cached=true,cuda='13',daemon=true}={}){
 const setup=`
probe_calls=0; pull_calls=0; unexpected_calls=0
trap 'printf "PREFLIGHT_TEST_CALLS run=%s pull=%s unexpected=%s\\n" "$probe_calls" "$pull_calls" "$unexpected_calls" >&2' EXIT
uname(){ if [ "$1" = "-s" ]; then echo Linux; else echo x86_64; fi; }
nvidia-smi(){ echo 'NVIDIA RTX 4090, 24576, 580.100'; }
nvcc(){ echo 'Cuda compilation tools, release ${cuda}.0, V${cuda}.0'; }
python3(){ return 0; }
awk(){ echo 64; }
df(){ printf 'Avail\\n500G\\n'; }
docker(){
 case "$1" in
  info) return ${daemon?0:1};;
  image) return ${cached?0:1};;
  run)
    probe_calls=$((probe_calls + 1))
    case " $* " in *' --pull=never '*) ;; *) return 91;; esac
    case " $* " in *' --network=none '*) ;; *) return 92;; esac
    return 0;;
  pull) pull_calls=$((pull_calls + 1)); return 98;;
  *) unexpected_calls=$((unexpected_calls + 1)); return 99;;
 esac
}
command(){ if [ "$1" = "-v" ]; then printf '/mock/%s\\n' "$2"; else builtin command "$@"; fi; }
export PILOT_GPU_PROBE='${probe}'
`;
 const r=spawnSync(bash,['-s'],{input:setup+'\n'+source,encoding:'utf8',timeout:10000});
 if(r.error)throw r.error;
 return r;
}
test('default preflight never starts containers or pulls images',()=>{
 const r=preflight();assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/read-only mode/);assert.match(r.stderr,/run=0 pull=0 unexpected=0/);
});
test('an opt-in GPU probe cannot pull a missing image',()=>{
 const r=preflight({probe:'1',cached:false});assert.notEqual(r.status,0);assert.match(r.stdout,/no image was pulled/);assert.match(r.stderr,/run=0 pull=0 unexpected=0/);
});
test('the opt-in cached-image probe explicitly disables pulls and networking',()=>{
 const r=preflight({probe:'1'});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/Docker can use the GPU/);assert.match(r.stderr,/run=1 pull=0 unexpected=0/);
});
test('an installed CUDA 12 compiler does not pass the CUDA 13 requirement',()=>{
 const r=preflight({cuda:'12'});assert.notEqual(r.status,0);assert.match(r.stdout,/CUDA 13 toolkit needed; nvcc reports major 12/);
});
test('an unavailable Docker daemon fails static checks without starting a container',()=>{
 const r=preflight({daemon:false});assert.notEqual(r.status,0);assert.match(r.stdout,/running Docker daemon/);assert.match(r.stderr,/run=0 pull=0 unexpected=0/);
});
