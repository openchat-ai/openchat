# Qiniu / S3（按需）
手机端只用 S3 端点 `*.s3.<region>.qiniucs.com`，禁止 `rs.qbox.me`。

| 操作 | 方式 | 端点 |
|------|------|------|
| 上传 | Qiniu 表单 + upload token | upload-z0.qiniup.com |
| GET/LIST/DELETE | S3 V4 预签名（UNSIGNED-PAYLOAD） | *.s3.*.qiniucs.com |

涉及 Qiniu 的改动：先 Node 模拟 Flutter 请求再推。
