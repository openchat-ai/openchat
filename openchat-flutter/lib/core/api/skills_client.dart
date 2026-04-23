import 'package:openchat_flutter/core/api/base_client.dart';

class SkillsClient extends BaseClient {
  SkillsClient({required super.baseUrl, super.token});

  Future<Skill> createSkill({required String name, required String type, required String code, String? description, String? tests, String? documentation}) async {
    final response = await dio.post('$baseUrl/api/v1/skills', data: {'name': name, 'type': type, 'code': code, 'description': description, 'tests': tests, 'documentation': documentation});
    return Skill.fromJson(response.data);
  }

  Future<SkillList> getSkills({String? type, double? minRating, int limit = 20}) async {
    final response = await dio.get('$baseUrl/api/v1/skills', queryParameters: {'type': type, 'minRating': minRating, 'limit': limit});
    return SkillList.fromJson(response.data);
  }

  Future<SkillList> searchSkills({String? query, String? type, double? minRating, int limit = 20}) async {
    final response = await dio.get('$baseUrl/api/v1/skills/search', queryParameters: {'query': query, 'type': type, 'minRating': minRating, 'limit': limit});
    return SkillList.fromJson(response.data);
  }

  Future<Skill> getSkill(String skillId) async {
    final response = await dio.get('$baseUrl/api/v1/skills/$skillId');
    return Skill.fromJson(response.data);
  }

  Future<SkillValidationResult> validateSkill(String skillId) async {
    final response = await dio.post('$baseUrl/api/v1/skills/$skillId/validate');
    return SkillValidationResult.fromJson(response.data);
  }

  Future<Skill> publishSkill(String skillId) async {
    final response = await dio.post('$baseUrl/api/v1/skills/$skillId/publish');
    return Skill.fromJson(response.data);
  }

  Future<RatingResult> rateSkill(String skillId, {required int rating, String? comment}) async {
    final response = await dio.post('$baseUrl/api/v1/skills/$skillId/rate', data: {'rating': rating, 'comment': comment});
    return RatingResult.fromJson(response.data);
  }
}

class Skill {
  final String id, name, description, type, code, version, author, status;
  final SkillRating ratings;
  final String? createdAt, validatedAt, publishedAt;

  Skill({required this.id, required this.name, required this.description, required this.type, required this.code, required this.version, required this.author, required this.status, required this.ratings, this.createdAt, this.validatedAt, this.publishedAt});

  factory Skill.fromJson(Map<String, dynamic> json) {
    return Skill(
      id: json['id'] ?? '', name: json['name'] ?? '', description: json['description'] ?? '', type: json['type'] ?? '',
      code: json['code'] ?? '', version: json['version'] ?? '', author: json['author'] ?? '', status: json['status'] ?? '',
      ratings: SkillRating.fromJson(json['ratings'] ?? {}), createdAt: json['createdAt'], validatedAt: json['validatedAt'], publishedAt: json['publishedAt'],
    );
  }
}

class SkillRating {
  final double average;
  final int count;

  SkillRating({required this.average, required this.count});

  factory SkillRating.fromJson(Map<String, dynamic> json) {
    return SkillRating(average: (json['average'] ?? 0).toDouble(), count: json['count'] ?? 0);
  }
}

class SkillList {
  final List<Skill> skills;
  final int total;
  final String? query;

  SkillList({required this.skills, required this.total, this.query});

  factory SkillList.fromJson(Map<String, dynamic> json) {
    return SkillList(skills: (json['skills'] as List? ?? []).map((s) => Skill.fromJson(s)).toList(), total: json['total'] ?? 0, query: json['query']);
  }
}

class SkillValidationResult {
  final String id, status;
  final String? validatedAt;

  SkillValidationResult({required this.id, required this.status, this.validatedAt});

  factory SkillValidationResult.fromJson(Map<String, dynamic> json) {
    return SkillValidationResult(id: json['id'] ?? '', status: json['status'] ?? '', validatedAt: json['validatedAt']);
  }
}

class RatingResult {
  final String skillId;
  final double rating;
  final int totalRatings;

  RatingResult({required this.skillId, required this.rating, required this.totalRatings});

  factory RatingResult.fromJson(Map<String, dynamic> json) {
    return RatingResult(skillId: json['skillId'] ?? '', rating: (json['rating'] ?? 0).toDouble(), totalRatings: json['totalRatings'] ?? 0);
  }
}