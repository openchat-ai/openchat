import 'dart:convert';
import 'dart:core';
import 'qiniu_models.dart';

/// Simple XML parser for S3 ListObjects responses.
class QiniuXmlParser {
  static ListResponse parseListObjects(String xmlBody) {
    final contents = <BucketObject>[];
    final prefixes = <String>[];

    // Parse <Contents> entries
    final contentsRegex = RegExp(
        r'<Contents>[\s\S]*?<Key>([^<]+)</Key>[\s\S]*?<LastModified>([^<]+)</LastModified>[\s\S]*?<ETag>([^<]+)</ETag>[\s\S]*?<Size>([^<]+)</Size>[\s\S]*?</Contents>',
        multiLine: true,
        caseSensitive: false);
    for (final match in contentsRegex.allMatches(xmlBody)) {
      try {
        final key = match.group(1)!;
        // LastModified is ISO 8601, convert to epoch ms
        final lastModifiedStr = match.group(2)!;
        final lastModified = DateTime.parse(lastModifiedStr).millisecondsSinceEpoch;
        final eTag = match.group(3)!;
        final size = int.parse(match.group(4)!);
        contents.add(BucketObject(
            key: key, size: size, lastModified: lastModified, eTag: eTag));
      } catch (_) {
        // skip malformed entry
      }
    }

    // Parse <CommonPrefixes> entries (for delimiters)
    final prefixRegex = RegExp(
        r'<CommonPrefixes>[\s\S]*?<Prefix>([^<]+)</Prefix>[\s\S]*?</CommonPrefixes>',
        multiLine: true,
        caseSensitive: false);
    for (final match in prefixRegex.allMatches(xmlBody)) {
      prefixes.add(match.group(1)!);
    }

    final isTruncated = xmlBody.contains('<IsTruncated>true</IsTruncated>');

    return ListResponse(
        isTruncated: isTruncated,
        contents: contents,
        commonPrefixes: prefixes);
  }

  /// Extract a single value from an XML tag.
  static String? _extract(String xml, String tag) {
    final regex = RegExp(r'<$tag>([^<]+)</$tag>', caseSensitive: false);
    final match = regex.firstMatch(xml);
    return match?.group(1);
  }

  static String? getETag(String xmlBody) => _extract(xmlBody, 'ETag');
  static int? getSize(String xmlBody) => int.tryParse(_extract(xmlBody, 'Size') ?? '');
  static String? getKey(String xmlBody) => _extract(xmlBody, 'Key');
}
