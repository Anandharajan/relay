# Relay camera check-in agent (add-on)

Marks opted-in visitors as arrived when the reception camera recognises them. Runs **on your premises**;
Relay never receives video, photos or face templates, only `client_id` + confidence.

1. In Relay: **Settings → Add-ons → Camera check-in → Register a device** and copy the device token.
2. On the reception PC: `pip install face_recognition opencv-python requests`
3. Visitors opt in on their visit page ("Faster check-in with the reception camera").
4. At the desk, with the visitor present: `python agent.py enroll <client_id>` (ids come from `GET /edge/expected`).
5. Run: `RELAY_URL=https://<your-relay>/edge RELAY_DEVICE_TOKEN=edge_… python agent.py run 0`
   (or an RTSP URL instead of `0`).
6. Schedule `python agent.py purge` nightly. Templates are kept for the visit day only.

Consent can be withdrawn on the visit page at any time; the next sync stops matching that person.
Treat this as biometric data under the DPDP Act: put up signage at reception, and keep the consent records
(Relay logs `consent.camera_granted` / `consent.camera_withdrawn` in the audit trail).
