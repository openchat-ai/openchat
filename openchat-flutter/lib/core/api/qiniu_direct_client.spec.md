# spec: Qiniu Direct Client

> 兼容 S3 V4 签名的七牛直传客户端 + S3 元数据 API。
> 单 721 行文件拆为 9 个单职责模块 (R6)。
> 注：`neural_audio_codec.dart` ↔ `neural-audio-codec.js` 同步性必须保持。

## 数据流

```
客户端启动 → QiniuConfigRegistry.initFromBridge(bridgeUrl)
  → HTTP GET /api/v1/config/storage-config
  → 填充 AK/SK/Bucket/Endpoint/Region (无则用内置默认)

register() → QiniuUdpTransport.setup()
  → IP 发现 (ipify → httpbin → myip)
  → UDP socket bind → 监听 0xBB 协议
  → putBinary(oc/users/{peerId}.json) 写 presence

putBinary(key, Uint8List data)
  → QiniuSigner.uploadToken() → POST upload-z0.qiniup.com (form upload)
  → 失败回退 S3 PUT presignedUrl() (UNSIGNED-PAYLOAD)

getBinary(key) → QiniuSigner.presignedUrl() → GET → bodyBytes

listFiles(prefix) → presignedUrl(prefix, prefix:prefix) → 解析 <Key> XML 标签

deleteFile(key) → presignedUrl(method:'DELETE') → DELETE → 期望 204/200

signaling: sendSignal/pollIncoming → oc/calls/{peerId}/{from}.json
audio: sendEncodedAudio/pollEncodedAudio → oc/audio/{peerId}/{seq}.enc
heartbeat() → 仅重写 presence 文件
```

## 接口签名

```dart
class QiniuDirectClient {
  final String peerId;
  bool get isUdpReady;
  String? get publicIp;
  int? get udpPort;
  int pollIntervalMs = 3000;
  static const int userStaleMs = 120000;

  QiniuDirectClient({required this.peerId});

  // 生命周期
  Future<void> register();
  Future<void> heartbeat();
  Future<void> unregister();
  Future<void> unregisterAndDispose();
  void dispose();

  // 通用 S3 操作
  Future<void> putBinary(String key, Uint8List data);
  Future<Uint8List> getBinary(String key);
  Future<List<String>> listFiles(String prefix);
  Future<void> deleteFile(String key);
  Future<bool> writeFile(String key, dynamic content);

  // Presence
  Future<List<Map<String, dynamic>>> discoverUsers();

  // 信令
  Future<void> sendSignal(String targetPeerId, String action, {Map? data});
  Future<List<Map<String, dynamic>>> pollIncoming();

  // 音频中继
  Future<void> sendEncodedAudio(String targetPeerId, Uint8List data, int seq);
  Future<List<Uint8List>> pollEncodedAudio();
  Future<void> saveEpcRecord(Uint8List epcData);

  // UDP
  void startPunch(String targetIp, int targetPort);
  void sendUdp(List<int> data);
  void log(String level, String msg);
  Future<void> pollDebug();

  // Demo
  Future<void> spawnDemoPeer();

  // 静态方法
  static Future<Map?> fetchConfigFile(String path, {int retries = 2});
  static Future<void> initFromBridge(String bridgeUrl);
  static Map<String, dynamic> get globalStyle;
  static double spacing(String key, [double fallback = 12]);
  static double radius(String key, [double fallback = 12]);
  static Uint8List wavFromPcm(Uint8List pcm);
}

class QiniuConfigRegistry {
  static String get accessKey, secretKey, bucket, endpoint, region;
  static Map<String, dynamic> get globalStyle;
  static double spacing(String key, [double fallback = 12]);
  static double radius(String key, [double fallback = 12]);
  static Future<void> initFromBridge(String bridgeUrl);
  static QiniuConfig snapshot();
  static Future<Map?> fetchConfigFile(String path, {int retries = 2});
}

class QiniuSigner {
  static String presignedUrl(QiniuConfig config, String key,
      {String? prefix, int expires = 300, String method = 'GET'});
  static String uploadToken(QiniuConfig config, String key);
}

class QiniuHttpClient {
  Future<http.Response> get(Uri uri, {Map<String, String>? headers});
  Future<http.StreamedResponse> send(http.BaseRequest request);
  Future<http.Response> put(Uri uri, {required Map<String, String> headers, required dynamic body});
  Future<http.Response> delete(Uri uri);
  void close();
}

class QiniuXmlParser {
  static ListResponse parseListObjects(String xmlBody);
  static String? getETag(String xmlBody);
  static int? getSize(String xmlBody);
  static String? getKey(String xmlBody);
}

class BucketObject {
  final String key, eTag;
  final int size, lastModified;
  BucketObject({required this.key, required this.size, required this.lastModified, required this.eTag});
}

class ListResponse {
  final bool isTruncated;
  final List<BucketObject> contents;
  final List<String> commonPrefixes;
}

class QiniuConfig {
  final String accessKey, secretKey, bucket, endpoint, region;
  factory QiniuConfig.fromJson(Map<String, dynamic> json);
}

class GlobalStyle {
  double spacing(String key, [double fallback = 12]);
  double radius(String key, [double fallback = 12]);
  void update(Map<String, dynamic> style);
}

class QiniuUdpTransport {
  String? get publicIp, udpPort;
  bool get isReady;
  void Function(Uint8List data)? onAudioData;
  Future<void> setup();
  void startPunch(String targetIp, int targetPort);
  void send(List<int> data);
  void close();
}

class QiniuWav {
  static Uint8List wrapPcm(Uint8List pcm);
}

class QiniuDebugClient {
  void log(String level, String msg);
  Future<void> pollDebug();
  void dispose();
}

void markC8(String op, String detail);
void markC9(String action, String detail);
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| Bridge 配置拉取失败 | 用内置 char-code AK/SK 兜底 |
| S3 GET 404 | 抛出 Exception (HTTP 状态码) |
| Qiniu form upload 失败 | 自动回退 S3 PUT (UNSIGNED-PAYLOAD) |
| UDP bind 失败 | 静默忽略 (无 INTERNET 权限或受限环境) |
| 写文件前缀不在白名单 | writeFile() 返回 false |
| 用户 JSON 2 分钟未更新 | discoverUsers() 视为离线 |
| peerId 相同 | discoverUsers() 跳过自身 |
| LIST XML 格式异常 | 跳过该 entry，继续解析其他 |

## 文件清单

| 文件 | 职责 | 行数上限 | 实际行数 |
|------|------|---------|---------|
| `qiniu_client.dart` | QiniuDirectClient 主类 | 200 | 238 |
| `qiniu_s3_sign.dart` | S3 V4 签名算法 + upload token | 150 | 104 |
| `qiniu_models.dart` | BucketObject + ListResponse + QiniuConfig + GlobalStyle | 80 | 67 |
| `qiniu_xml_parser.dart` | ListObjects XML 解析 | 80 | 58 |
| `qiniu_http.dart` | HTTP wrapper (auth + retry + timeout) | 80 | 61 |
| `qiniu_config.dart` | 静态配置加载 + globalStyle | 100 | 133 |
| `qiniu_debug.dart` | markC8/C9 检查点 + 日志 + pollDebug | 100 | 127 |
| `qiniu_udp.dart` | P2P 传输 (UDP + NAT 打洞) | 100 | 95 |
| `qiniu_wav.dart` | WAV 头生成 | 40 | 38 |
| `qiniu_direct_client.dart` | barrel export (向后兼容) | 30 | 21 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C8 | `[C8] put\|get\|delete` | qiniu_client:putBinary/getBinary/deleteFile | `C8 put key=xxx ok` |
| C9 | `[C9] action` | qiniu_debug:markC9 | `C9 action=X detail=Y` |

## 不变量 (invariants)

```
// === invariants ===
// - 所有 S3 API 必须用 UNSIGNED-PAYLOAD (Qiniu 兼容性要求)
// - 所有 HTTP 请求 timeout=8s (GET/LIST/DELETE) / 15s (form upload), retry=2 次
// - putBinary 优先用 Qiniu token upload，失败则回退 S3 PUT
// - getBinary 抛出 Exception 表示 HTTP 非 200 (无 null 返回)
// - register() 初始化时调用一次，后续可重复调用 heartbeat() 刷写 presence
// - 写文件白名单: oc/config/, oc/debug/, oc/logs/, oc/call_recordings/
// - UDP transport: 0xBB 字节为 NAT 打洞响应
// - 静态方法 (wavFromPcm/initFromBridge/spacing/radius/globalStyle) 委托给对应模块
```
