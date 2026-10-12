#!/usr/bin/env python3
"""
Relay camera check-in agent (add-on). Runs ON-PREMISES on a PC at reception.

Privacy design
  * Only visitors who opted in on their visit page are ever matched (Relay sends their ids, never photos).
  * Enrolment happens at the desk, with the visitor present: `python agent.py enroll <client_id>`.
  * Face templates (128-number encodings, not photos) stay in ./templates on this PC and are deleted
    after the visit day (`python agent.py purge`, run nightly). Video never leaves the building.
  * Relay receives only {client_id, confidence} when someone expected today is recognised.

Usage
  RELAY_URL=https://your-relay/edge RELAY_DEVICE_TOKEN=edge_... python agent.py run [camera_index_or_rtsp_url]
  python agent.py enroll <client_id> [camera]
  python agent.py purge

Requires: pip install face_recognition opencv-python requests
"""
import json, os, sys, time, datetime, pathlib

import requests

API = os.environ.get("RELAY_URL", "http://localhost:8787/edge").rstrip("/")
TOKEN = os.environ.get("RELAY_DEVICE_TOKEN", "")
STORE = pathlib.Path(os.environ.get("TEMPLATE_DIR", "./templates"))
THRESHOLD = float(os.environ.get("MATCH_DISTANCE", "0.45"))  # lower = stricter
HEADERS = {"authorization": f"Bearer {TOKEN}", "content-type": "application/json"}


def expected():
    r = requests.get(f"{API}/expected", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def camera(src):
    import cv2
    cap = cv2.VideoCapture(int(src) if str(src).isdigit() else src)
    if not cap.isOpened():
        sys.exit(f"Cannot open camera {src}")
    return cap


def encodings_from(frame):
    import face_recognition
    rgb = frame[:, :, ::-1]
    boxes = face_recognition.face_locations(rgb, model="hog")
    return face_recognition.face_encodings(rgb, boxes)


def enroll(client_id, src=0):
    allowed = {e["client_id"]: e for e in expected()}
    if client_id not in allowed:
        sys.exit("This visitor has not opted in (or has no appointment today). Ask them to agree on their visit page first.")
    cap = camera(src)
    print("Look at the camera…")
    for _ in range(60):
        ok, frame = cap.read()
        if not ok:
            continue
        enc = encodings_from(frame)
        if len(enc) == 1:
            STORE.mkdir(exist_ok=True)
            day = datetime.date.today().isoformat()
            (STORE / f"{client_id}.json").write_text(json.dumps({"day": day, "encoding": list(map(float, enc[0]))}))
            print(f"Enrolled {allowed[client_id]['first_name']} for today.")
            return
        time.sleep(0.2)
    sys.exit("Could not capture exactly one face. Try again with better light.")


def purge():
    today = datetime.date.today().isoformat()
    for f in STORE.glob("*.json"):
        if json.loads(f.read_text()).get("day") != today:
            f.unlink()
    print("Old templates deleted.")


def run(src=0):
    import numpy as np
    cap = camera(src)
    seen, last_sync, todays = set(), 0.0, set()
    while True:
        if time.time() - last_sync > 60:
            try:
                todays = {e["client_id"] for e in expected() if e["status"] == "booked"}
            except Exception as e:  # keep running through network blips
                print("sync failed:", e)
            last_sync = time.time()
        known = {}
        for f in STORE.glob("*.json"):
            cid = f.stem
            if cid in todays and cid not in seen:
                known[cid] = np.array(json.loads(f.read_text())["encoding"])
        ok, frame = cap.read()
        if not ok or not known:
            time.sleep(0.5)
            continue
        for enc in encodings_from(frame):
            ids = list(known)
            dists = np.linalg.norm(np.stack([known[i] for i in ids]) - enc, axis=1)
            best = int(np.argmin(dists))
            if dists[best] <= THRESHOLD:
                confidence = float(max(0.0, min(1.0, 1 - dists[best] / (THRESHOLD * 2))) + 0.5)
                r = requests.post(f"{API}/arrivals", headers=HEADERS, json={"clientId": ids[best], "confidence": min(confidence, 1.0)}, timeout=15)
                print("arrival", ids[best], r.status_code, r.text[:120])
                seen.add(ids[best])
        time.sleep(0.3)


if __name__ == "__main__":
    if not TOKEN and (len(sys.argv) < 2 or sys.argv[1] != "purge"):
        sys.exit("Set RELAY_DEVICE_TOKEN (Settings → Add-ons → Register a device).")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "enroll":
        enroll(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 0)
    elif cmd == "purge":
        purge()
    else:
        run(sys.argv[2] if len(sys.argv) > 2 else 0)
