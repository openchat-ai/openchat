# Qiniu Direct Architecture

Phone ←→ Qiniu (S3) ←→ Phone, no Bridge dependency for P2P voice.

## Why

Bridge runs behind NAT without port forwarding. Phone on 5G cannot reach Bridge HTTP/TCP. Solution: both sides talk to Qiniu's S3-compatible API directly, using embedded credentials.

## Data Model

All keys prefixed with `oc/` (peertalk).

| Key pattern | Content | Purpose |
|---|---|---|
| `oc/users/{peerId}.json` | `{peerId, publicIp, udpPort, status, ts}` | Registration + UDP endpoint |
| `oc/calls/{targetPeerId}/{fromPeerId}.json` | `{action, fromPeerId, publicIp, udpPort, data, ts}` | Call signaling |
| `oc/audio/{targetPeerId}/{fromPeerId}_{seq}.wav` | `{from, seq, data(base64), ts}` | Audio relay fallback |

## Flow

### Registration
1. Phone discovers public IP via `api.ipify.org` (HTTP GET)
2. Binds `RawDatagramSocket` on random port → gets UDP port
3. PUTs `oc/users/{peerId}.json` to Qiniu S3 with `publicIp` + `udpPort`

### User Discovery
1. Phone LISTs `oc/users/` prefix on Qiniu S3
2. Reads each `.json` → gets list of online peers with their UDP endpoints

### Call (UDP Hole Punch)
1. Caller reads callee's registration → gets `targetIp` + `targetPort`
2. Caller sends 0xBB punch packets to `targetIp:targetPort` every 200ms (up to 25 attempts)
3. Callee receives punch → `_punched = true`
4. Both sides now have working UDP channel
5. Audio sent as raw UDP datagrams

### Call (Qiniu Relay Fallback)
1. If UDP punch fails after 25 attempts (5 seconds)
2. Audio chunks sent as base64 via PUT to `oc/audio/{target}/{from}_{seq}.wav`
3. Receiver polls LIST `oc/audio/{myPeerId}/` every 1.2s
4. Higher latency (~200-500ms) but works through any NAT

### Call Signaling
1. Caller PUTs `oc/calls/callee/caller.json` with `action: "call-request"`
2. Callee polls LIST `oc/calls/{myPeerId}/` → reads request
3. Callee PUTs `oc/calls/caller/callee.json` with `action: "call-accept"`
4. Caller polls LIST → reads accept
5. Both sides switch to connected state
6. Hangup: PUT with `action: "call-end"`

## S3 API

Using Qiniu S3-compatible endpoint: `https://{bucket}.s3.{region}.qiniucs.com`

Authentication: AWS Signature V4 (HMAC-SHA256)

- PUT: create/update object
- GET: read object
- LIST: list objects by prefix
- DELETE: remove object

Credentials embedded in APK (private project, acceptable risk).

## Bridge Role (Optional)

Bridge runs independently for AI residents, agent system, administration.
Its `/users` endpoint also polls Qiniu for phone registrations.
Phone does NOT need Bridge for P2P voice.

## Code Map

| File | Role |
|---|---|
| `lib/core/api/qiniu_direct_client.dart` | S3 client + IP discovery + UDP hole punch |
| `lib/ui/screens/people_screen.dart` | User list + incoming call dialog |
| `lib/ui/screens/voice_room_screen.dart` | Call state machine + audio relay |
| `bridge/src/core/qiniu-signaling.js` | Bridge-side Qiniu operations + listObjects |
| `bridge/src/api/server.js` | `/users` endpoint + Qiniu poller |
