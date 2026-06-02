# spec: Qiniu Direct Client

> 兼容 S3 V4 签名的七牛直传客户端 + S3 元数据 API。
> 单 721 行文件需按 R6 分拆 (≥5 个职责混杂)。

## 数据流

```
注册 (fetchConfigFile)
  → oc/users/{peerId}.json → _register → 更新 AK/SK/Bucket (隐藏)

上传: putBinary(key, Uint8List data)
  → S3 V4 签名 GET /{bucket}?upload → Qiniu token upload (form upload)
  → S3 V4 POST fallback (Content-Type: application/octet-stream)

下载: getBinary(key)
  → S3 V4 签名 GET /{bucket}/{key} → fetch() with Authorization

轮询: pollForNewFiles(prefix, since, limit=32)
  → S3 V4 签名 GET /{bucket}?prefix={prefix}&max-keys=32
  → 解析 XML → 返回 {key, size, lastModified} 列表

删除: deleteKey(key)
  → S3 V4 签名 DELETE /{bucket}/{key}

列出目录: listFiles(String prefix)
  → S3 V4 签名 GET /{bucket}?prefix={prefix}&delimiter=/
  → 解析 XML → 返回 {commonPrefixes, contents}
```

## 接口签名

```dart
class QiniuDirectClient {
  static Future<Map<String, dynamic>?> fetchConfigFile(String key);
  static Map<String, dynamic> get globalStyle;
  static double spacing(String key, [double fallback = 12]);
  static double radius(String key, [double fallback = 12]);

  String peerId;
  String? _secretToken;  // 服务端注册后填充
  bool get isRegistered => _secretToken != null;

  QiniuDirectClient({required this.peerId});
  Future<void> register();
  Future<void> putBinary(String key, Uint8List data);
  Future<Uint8List?> getBinary(String key); 
  Future<List<dynamic>> pollForNewFiles(String prefix, {String? sinceKey, int limit = 32});
  Future<void> deleteKey(String key);
  Future<Map<String, dynamic>> listFiles(String prefix);
  Future<QiniuDirectClient> clone();
  void dispose();
}

// 检查点标记函数 (供日志 grep)
void markC8(String op, String detail);
void markC9(String action, String detail);
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| peerId 为空 | register() 用 `p_${timestamp}_${random}` 替代 |
| _secretToken 未设置 | putBinary/getBinary 立即抛异常 |
| 网络超时/失败 | 所有 API 自动 retry(2 次) 后抛出 http.Exception |
| 上传文件 >2MB | 不分片上传，直接失败 (应由调用方拆片) |
| 签名 key 包含中文 | UTF-8 encode → URI escape(V4 签名) |
| S3 listFiles 返回 ≥1000 项 | max-keys 固定为 1000，不支持分页 |
| getBinary 返回 404 | 返回 null |
| Qiniu token upload 失败 | 用 S3 POST fallback |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `qiniu_client.dart` | QiniuDirectClient 主类 + 注册 | 150 |
| `qiniu_s3_sign.dart` | S3 V4 签名算法 | 150 |
| `qiniu_models.dart` | BucketObject + ListResponse 结构体 | 50 |
| `qiniu_xml_parser.dart` | ListObjects XML 解析 | 80 |
| `qiniu_http.dart` | fetch() wrapper (auth + retry + timeout) | 80 |
| `qiniu_config.dart` | 静态配置加载 (fetchConfigFile + globalStyle) | 60 |
| `qiniu_debug.dart` | markC8/C9 检查点标记 + 日志 | 40 |

> 注：`neural_audio_codec.dart` ↔ `neural-audio-codec.js` 同步性必须保持 (Codec 同步规则)

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C8 | `[C8] put\|get\|poll\|delete` | putBinary/getBinary/pollForNewFiles/deleteKey | `C8 put key=xxx size=N` |
| C9 | `[C9] register` | register | `C9 register peerId=xxx` |
| C15-C17 | 已在 `room_screen.spec.md` | 聊天轮询 | `C15-C17` 保留 |

## 不变量 (invariants)

```
// === invariants ===
// - 所有 S3 API 必须用 UNSIGNED-PAYLOAD (Qiniu 兼容性要求)
// - 所有 HTTP 请求 timeout=8s, retry=2 次 (移动网络容错)
// - register() 并行调用只执行一次 (内部 mutex)
// - putBinary 优先用 Qiniu token upload，失败则回退 S3 POST
// - getBinary 返回 null 表示 404 (调用方必须 null 检查)
```
