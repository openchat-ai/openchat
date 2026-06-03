# spec: QiniuDirectClient

> Qiniu S3 存储客户端：文件上传/下载/列目录/删除，含表单上传 + S3 PUT 回退。

## 数据流

```
register() → _writePresence() → PUT oc/users/{peerId}.json

sendSignal(target, action)
  → PUT oc/calls/{target}/{peerId}.json

pollIncoming()
  → LIST oc/calls/{peerId}/ → GET each → DELETE each

sendEncodedAudio(target, data, seq)
  → PUT oc/audio/{target}/{peerId}_{seq}.enc

pollEncodedAudio()
  → LIST oc/audio/{peerId}/ → GET each .enc → DELETE each

putBinary(key, data)
  → 1) Qiniu 表单上传 (upload-z0.qiniup.com)
  → 2) S3 V4 预签名 PUT (回退)

getBinary(key)
  → S3 V4 预签名 GET

listFiles(prefix)
  → S3 V4 预签名 LIST → XML → <Key> parsed

deleteFile(key)
  → S3 V4 预签名 DELETE
```

## 接口签名

```dart
class QiniuDirectClient {
  final String peerId;
  QiniuDirectClient({required this.peerId});

  Future<void> register();
  Future<void> heartbeat();
  Future<List<Map<String, dynamic>>> discoverUsers();
  Future<void> sendSignal(String targetPeerId, String action, {Map? data});
  Future<List<Map<String, dynamic>>> pollIncoming();
  Future<void> sendEncodedAudio(String targetPeerId, Uint8List data, int seq);
  Future<List<Uint8List>> pollEncodedAudio();
  Future<void> saveEpcRecord(Uint8List epcData);
  Future<void> putBinary(String key, Uint8List data);
  Future<Uint8List> getBinary(String key);
  Future<List<String>> listFiles(String prefix);
  Future<void> deleteFile(String key);
  void startPunch(String targetIp, int targetPort);
  void sendUdp(List<int> data);
  void log(String level, String msg);
  Future<void> pollDebug();
  static Future<Map?> fetchConfigFile(String path, {int retries = 2});
  static Future<void> initFromBridge(String bridgeUrl);
  static Uint8List wavFromPcm(Uint8List pcm, {int sampleRate = 48000});
  bool writeFile(String key, dynamic content);
  Future<void> unregister();
  void dispose();
  Future<void> unregisterAndDispose();
  String? get publicIp;
  int? get udpPort;
  bool get isUdpReady;
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 表单上传失败 | 日志 `[warn] putBinary form upload error:` → 回退 S3 PUT |
| S3 PUT 也失败 | 向上 throw，由调用方 catch |
| LIST 返回空 XML | 返回空列表 |
| XML 格式错误 | `listFiles` 返回空列表 |
| GET 403 | 向上 throw，`pollEncodedAudio` 日志 `[error] pollEncodedAudio:` |
| 网络超时 | TimeoutException → 日志 → 调用方 catch |
| key 不存在 DELETE | S3 返回 404 → 不抛异常（幂等） |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `qiniu_client.dart` | QiniuDirectClient 主类 | 250 |
| `qiniu_config.dart` | QiniuConfigRegistry 静态配置 | 150 |
| `qiniu_s3_sign.dart` | S3 V4 签名 + 上传 token | 200 |
| `qiniu_http.dart` | HTTP 客户端封装 | 100 |
| `qiniu_xml_parser.dart` | XML 解析 | 80 |
| `qiniu_models.dart` | 数据模型 | 50 |
| `qiniu_debug.dart` | 调试命令 + 检查点 | 150 |
| `qiniu_udp.dart` | UDP NAT 穿透 | 150 |
| `qiniu_wav.dart` | WAV 头封装 | 50 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C8 | `[C8] put\|get\|delete` | putBinary/getBinary/deleteFile | `[C8] put key ok` / `[C8] get key ok` |
| C8 | `[C8] put.*(s3)` | putBinary 回退 | `[C8] put key ok (s3)` |

## 不变量 (invariants)

```
// === invariants ===
// - 表单上传和 S3 PUT 均使用 QiniuConfigRegistry.snapshot() 当前配置
// - pollEncodedAudio GET 后立即 DELETE，保证至少一次语义
// - QiniuDebugClient.log 的 _logFlushTimer 在 dispose() 中 cancel
// - writeFile 仅允许 _allowedWritePrefixes 前缀
```
