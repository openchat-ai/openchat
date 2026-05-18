import 'package:flutter_test/flutter_test.dart';
import 'package:openchat_flutter/core/models/resident_model.dart';

void main() {
  group('Resident', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 1,
        'name': '测试居民',
        'createdAt': '2026-01-01T00:00:00Z',
        'status': 'active',
        'home': 'bridge-01',
        'activityCount': 5,
        'traits': {'diligence': 0.9, 'curiosity': 0.7},
      };
      final resident = Resident.fromJson(json);
      expect(resident.id, 1);
      expect(resident.name, '测试居民');
      expect(resident.status, 'active');
      expect(resident.isActive, isTrue);
      expect(resident.traitLabels.length, 2);
    });

    test('fromJson parses deleted resident', () {
      final json = {
        'id': 2,
        'name': '已注销',
        'createdAt': '2026-01-01T00:00:00Z',
        'status': 'deleted',
        'home': 'bridge-01',
        'deletedAt': '2026-02-01T00:00:00Z',
      };
      final resident = Resident.fromJson(json);
      expect(resident.status, 'deleted');
      expect(resident.isDeleted, isTrue);
      expect(resident.isActive, isFalse);
    });

    test('fromJson handles empty traits', () {
      final json = {
        'id': 3,
        'name': '朴素',
        'createdAt': '2026-01-01T00:00:00Z',
        'status': 'active',
        'home': 'bridge-01',
      };
      final resident = Resident.fromJson(json);
      expect(resident.traits, isEmpty);
      expect(resident.traitLabels, isEmpty);
    });

    test('traitLabels returns notable traits', () {
      final json = {
        'id': 4,
        'name': '天才',
        'createdAt': '2026-01-01T00:00:00Z',
        'status': 'active',
        'home': 'bridge-01',
        'traits': {'creativity': 0.95, 'curiosity': 0.3, 'diligence': 0.5},
      };
      final resident = Resident.fromJson(json);
      expect(resident.traitLabels, contains('创造'));
    });

    test('equality works', () {
      final json = {
        'id': 1,
        'name': '测试',
        'createdAt': '2026-01-01T00:00:00Z',
        'status': 'active',
        'home': 'bridge',
      };
      final a = Resident.fromJson(json);
      final b = Resident.fromJson({...json});
      expect(a.id, b.id);
      expect(a.name, b.name);
    });
  });

  group('FeedItem', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'feed-1',
        'timestamp': '2026-01-01T00:00:00Z',
        'type': 'born',
        'message': '来了',
        'residentId': 1,
        'residentName': '居民A',
      };
      final item = FeedItem.fromJson(json);
      expect(item.id, 'feed-1');
      expect(item.type, 'born');
      expect(item.residentName, '居民A');
    });

    test('fromJson handles optional fields', () {
      final json = {
        'id': 'feed-2',
        'timestamp': '2026-01-01T00:00:00Z',
        'type': 'task_done',
        'message': '完成了',
        'residentId': 1,
        'residentName': '居民B',
        'agentRole': 'test_engineer',
        'summary': '测试通过',
      };
      final item = FeedItem.fromJson(json);
      expect(item.agentRole, 'test_engineer');
      expect(item.summary, '测试通过');
    });
  });

  group('ResidentActivity', () {
    test('fromJson parses correctly', () {
      final json = {
        'id': 'act-1',
        'timestamp': '2026-01-01T00:00:00Z',
        'type': 'awake',
        'message': '醒了',
      };
      final activity = ResidentActivity.fromJson(json);
      expect(activity.type, 'awake');
      expect(activity.agentRole, isNull);
    });
  });

  group('ChildSummary', () {
    test('fromJson parses with traits', () {
      final json = {
        'id': 5,
        'name': '子代',
        'status': 'active',
        'createdAt': '2026-01-01T00:00:00Z',
        'depth': 1,
        'traits': {'diligence': 0.8},
        'activityCount': 3,
      };
      final child = ChildSummary.fromJson(json);
      expect(child.depth, 1);
      expect(child.isActive, isTrue);
    });
  });
}
